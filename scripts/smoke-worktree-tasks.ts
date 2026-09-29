import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { freePort } from '../src/services';
import { HapiClient } from '../src/hapi';
import pkg from '../package.json';

// Explicit native acceptance: private config/data homes, real model calls and scoped fixture edits.
const executable = resolve(process.argv[2] ?? 'dist/runweft');
const selectedFlavor = process.argv[3];
assert(!selectedFlavor || ['codex', 'claude'].includes(selectedFlavor), 'Optional runtime must be codex or claude');
mkdirSync('.dev-smoke', { recursive: true });
const root = mkdtempSync(resolve('.dev-smoke/worktree-tasks-'));
const home = join(root, 'runweft'), codexHome = join(root, 'codex'), claudeHome = join(root, 'claude');
const env: NodeJS.ProcessEnv = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_')) delete env[key];
delete env.HAPI_CODEX_APP_SERVER_BIN; delete env.HAPI_SESSION_ID;
const nativeClaude = Bun.which('iclaude') ?? Bun.which('claude'); assert(nativeClaude && Bun.which('codex'));
function copy(source: string, target: string) {
    if (existsSync(source)) { mkdirSync(dirname(target), { recursive: true, mode: 0o700 }); copyFileSync(source, target); chmodSync(target, 0o600); }
}
const sourceCodex = process.env.CODEX_HOME ?? join(homedir(), '.codex'), sourceClaude = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
for (const file of ['config.toml', 'auth.json']) copy(join(sourceCodex, file), join(codexHome, file));
copy(process.env.CLAUDE_CONFIG_DIR ? join(sourceClaude, '.claude.json') : join(homedir(), '.claude.json'), join(claudeHome, '.claude.json'));
for (const file of ['settings.json', '.credentials.json']) copy(join(sourceClaude, file), join(claudeHome, file));
Object.assign(env, { CODEX_HOME: codexHome, CLAUDE_CONFIG_DIR: claudeHome, HAPI_CLAUDE_PATH: nativeClaude, GIT_CEILING_DIRECTORIES: root });
const codexConfig = join(codexHome, 'config.toml');
for (const name of Object.keys((Bun.TOML.parse(readFileSync(codexConfig, 'utf8')) as any).mcp_servers ?? {})) {
    assert.equal(spawnSync('codex', ['mcp', 'remove', name], { env, stdio: 'pipe' }).status, 0);
}
const claudeConfig = join(claudeHome, '.claude.json'), settings = JSON.parse(readFileSync(claudeConfig, 'utf8'));
settings.mcpServers = {}; writeFileSync(claudeConfig, JSON.stringify(settings));
const evidence: { [key: string]: any; checks: string[]; cleanupErrors: string[]; cases: any[] } = {
    root, executable, hapiRevision: pkg.hapi.revision, startedAt: new Date().toISOString(), success: false, checks: [], cases: [], cleanupErrors: [],
};
let started = false, token: string | undefined, hapi: HapiClient | undefined;
function cli(args: string[], cwd = root, timeout = 60_000) {
    const result = spawnSync(executable, ['--home', home, '--json', ...args], { cwd, env, encoding: 'utf8', timeout });
    if (token) assert(!`${result.stdout}${result.stderr}`.includes(token), 'Credential in CLI output');
    assert.equal(result.status, 0, `${args[0]}: ${result.stderr || result.error || result.signal}`);
    return JSON.parse(result.stdout);
}
function git(cwd: string, ...args: string[]) {
    const result = spawnSync('git', ['-C', cwd, ...args], { env, encoding: 'utf8', timeout: 20_000 });
    assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
}
function alive(pid: number) { try { process.kill(pid, 0); return true; } catch { return false; } }
function record(value: string) { evidence.checks.push(value); console.log(`PASS ${value}`); }
async function completed(id: string, roundId: string, cwd: string, item: any) {
    const deadline = Date.now() + 180_000, approvals = new Set<string>();
    do {
        cli(['task', 'wait', id, '--timeout', '1000'], cwd, 20_000);
        const detail = cli(['task', 'show', id, '--round', roundId], cwd);
        item.lastObserved = detail;
        if (detail.status === 'completed') return detail;
        if (['failed', 'interrupted', 'unknown'].includes(detail.status)) throw new Error(JSON.stringify({ status: detail.status, attention: detail.attention }));
        if (detail.status === 'needs_attention') {
            if (detail.attention?.scope === 'workspace' && detail.git.status === 'needs_attention' && item.repairHook) {
                assert.equal(detail.stop, 'stopped'); assert.equal(detail.native_status[0].phase, 'completed');
                item.failedFinish = detail;
                const hook = item.repairHook; delete item.repairHook;
                writeFileSync(hook, '#!/bin/sh\nexit 0\n');
                cli(['task', 'retry-finish', id, '--round', roundId], cwd);
                continue;
            }
            if (detail.attention?.code !== 'permission_required') throw new Error(JSON.stringify(detail.attention));
            for (const [requestId, permission] of Object.entries(detail.permissions) as [string, any][]) {
                if (approvals.has(requestId)) continue;
                const args = JSON.stringify(permission.arguments);
                const readGit = permission.tool === 'Bash' && typeof permission.arguments?.command === 'string'
                    && permission.arguments.command.split('&&').every((command: string) => {
                        const text = command.trim(), prefix = [`git -C ${detail.cwd} `, 'git '].find(prefix => text.startsWith(prefix));
                        return !!prefix && /^(?:status(?: --(?:short|porcelain(?:=v1)?))?|log --oneline -\d+|diff --stat)$/.test(text.slice(prefix.length));
                    });
                if (!readGit && !/result\.txt|probe_report|project_probe|worktree-probe|AGENTS\.md|CLAUDE\.md/.test(args + permission.tool)) {
                    if (item.pendingPermission !== requestId) console.log(`Fixture permission needs review: ${id}/${roundId}/${requestId} (${permission.tool})`);
                    item.pendingPermission = requestId; continue;
                }
                approvals.add(requestId); item.approvals.push({ roundId, requestId, tool: permission.tool });
                cli(['task', 'permission', id, '--round', roundId, '--request', requestId, '--decision', 'approved'], cwd);
            }
        }
    } while (Date.now() < deadline);
    throw new Error(`Timed out waiting for ${id}/${roundId}`);
}
console.log(`Evidence directory: ${root}`);
try {
    cli(['init']); cli(['config', 'set', 'server.port', String(await freePort())]);
    const service = cli(['start']); started = true;
    token = JSON.parse(readFileSync(join(home, 'server/hapi/settings.json'), 'utf8')).cliApiToken; assert(token);
    hapi = new HapiClient(service.url, token); cli(['machine', 'register']);
    for (const flavor of ['codex', 'claude'] as const) {
        if (selectedFlavor && flavor !== selectedFlavor) continue;
        const project = join(root, flavor + '-project'), cwd = join(project, 'app'); mkdirSync(cwd, { recursive: true });
        git(project, 'init', '-q'); git(project, 'config', 'user.name', 'Worktree Smoke'); git(project, 'config', 'user.email', 'worktree@example.invalid'); git(project, 'config', 'commit.gpgsign', 'false');
        const context = `PROJECT_${crypto.randomUUID()}`, skill = `SKILL_${crypto.randomUUID()}`, memory = `MEMORY_${crypto.randomUUID()}`, marker = `WRITE_${flavor}`;
        const probeLog = join(root, flavor + '-project-mcp.jsonl');
        for (const file of ['AGENTS.md', 'CLAUDE.md']) writeFileSync(join(project, file), `这是专用验收工程。任务报告包含工程标记 ${context}。不要委派，不使用 Runweft MCP。只修改请求指定的文件。\n`);
        for (const directory of ['.agents/skills/worktree-probe', '.claude/skills/worktree-probe']) {
            mkdirSync(join(project, directory), { recursive: true }); writeFileSync(join(project, directory, 'SKILL.md'), `---\nname: worktree-probe\ndescription: 项目独立工作区验收，用户提到 worktree-probe 时使用。\n---\n最终报告附带 ${skill}。\n`);
        }
        mkdirSync(join(project, '.codex'));
        const probe = { command: process.execPath, args: [resolve('scripts/fixtures/mcp-probe.mjs')], env: { RUNWEFT_SMOKE_PROBE_LOG: probeLog } };
        writeFileSync(join(project, '.codex/config.toml'), `[mcp_servers.project_probe]\ncommand = ${JSON.stringify(probe.command)}\nargs = ${JSON.stringify(probe.args)}\n[mcp_servers.project_probe.env]\nRUNWEFT_SMOKE_PROBE_LOG = ${JSON.stringify(probeLog)}\n`);
        writeFileSync(join(project, '.mcp.json'), JSON.stringify({ mcpServers: { project_probe: probe } }));
        writeFileSync(join(cwd, 'base.txt'), 'committed base\n'); git(project, 'add', '.'); git(project, 'commit', '-qm', 'fixture baseline');
        const base = git(project, 'rev-parse', 'HEAD'); writeFileSync(join(cwd, 'base.txt'), 'parent dirty only\n');
        const parentIndex = git(project, 'write-tree'), parentStatus = git(project, 'status', '--porcelain');
        const runtime = cli(['runtime', 'register', flavor], cwd).runtime; cli(['agent', 'init', flavor, '--runtime', runtime.id], cwd);
        const item: any = { flavor, project, base, approvals: [] }; evidence.cases.push(item);
        if (flavor === 'claude') {
            const hooks = join(root, 'fixture-hooks'); mkdirSync(hooks);
            item.repairHook = join(hooks, 'pre-commit');
            writeFileSync(item.repairHook, '#!/bin/sh\necho fixture-checkpoint-rejected >&2\nexit 1\n', { mode: 0o755 });
            git(project, 'config', 'core.hooksPath', hooks);
        }
        const request = crypto.randomUUID();
        const message = `使用本项目 worktree-probe skill。在当前工作目录把 result.txt 写成 ${marker} 加一个换行，不修改其他文件，不提交。若有 project_probe MCP，调用一次它的 probe_report；若不可用，报告 PROJECT_MCP_UNAVAILABLE，不自行修改配置或安装。记住 ${memory}，不要把这个记忆标记写入文件。最终报告包括工程与 skill 标记和 WRITE_DONE，不委派。`;
        const accepted = cli(['task', 'spawn', flavor, '--workspace-mode', 'worktree', '--base', 'HEAD', '--request-id', request, '--message', message], cwd);
        item.accepted = accepted;
        const first = await completed(accepted.agent_id, accepted.round_id, cwd, item); item.first = first;
        if (item.failedFinish) {
            assert.equal(first.session_id, item.failedFinish.session_id); assert.deepEqual(first.inputs, item.failedFinish.inputs);
            assert.equal(first.report.text, item.failedFinish.report.text);
            record(`${flavor}: explicit CLI retry-finish repairs a real failing hook without replaying model input`);
        }
        assert.equal(first.workspace_mode, 'worktree'); assert.equal(first.git.status, 'sealed'); assert.equal(first.git.base_commit, base);
        assert.notEqual(first.cwd, cwd); assert.equal(readFileSync(join(first.cwd, 'result.txt'), 'utf8'), `${marker}\n`);
        assert(first.report.text.includes(context), 'Project instructions not reflected in report'); assert(first.report.text.includes(skill), 'Project skill not reflected in report');
        assert.equal(git(project, 'show', `${first.git.result_ref}:app/result.txt`), marker);
        const probeEvents = existsSync(probeLog) ? readFileSync(probeLog, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
        item.projectMcp = probeEvents.some(event => event.event === 'call') ? 'called' : 'unavailable';
        assert(item.projectMcp === 'called' || first.report.text.includes('PROJECT_MCP_UNAVAILABLE'), 'MCP availability was not reported');
        item.projectMcpEvents = probeEvents;
        record(`${flavor}: native edit, instructions/skill, project MCP=${item.projectMcp}, automatic Git checkpoint`);
        const next = cli(['task', 'send', accepted.agent_id, '--message', '在 result.txt 末尾追加 SECOND 加一个换行。报告上一轮要求记住但不写入文件的 MEMORY_ 开头标记，原样复述，并附上 RESUME_DONE。不调用 MCP，不读取工程指令或 skill，不委派，不自行提交。'], cwd);
        const second = await completed(accepted.agent_id, next.round_id, cwd, item); item.second = second;
        assert.equal(second.cwd, first.cwd); assert.equal(second.native_session_id, first.native_session_id); assert.equal(second.resume.outcome, 'resumed');
        assert.equal(second.reconstruction, undefined); assert(second.report.text.includes(memory), 'Native history was not preserved');
        assert.equal(second.git.start_head, first.git.result_head); assert.equal(readFileSync(join(first.cwd, 'result.txt'), 'utf8'), `${marker}\nSECOND\n`);
        assert.equal(git(project, 'show', `${second.git.result_ref}:app/result.txt`), `${marker}\nSECOND`);
        assert.equal(git(project, 'rev-parse', 'HEAD'), base); assert.equal(git(project, 'write-tree'), parentIndex); assert.equal(git(project, 'status', '--porcelain'), parentStatus);
        assert.deepEqual(cli(['task', 'spawn', flavor, '--workspace-mode', 'worktree', '--base', 'HEAD', '--request-id', request, '--message', message], cwd), accepted);
        for (const detail of [first, second]) {
            assert.equal(detail.stop, 'stopped'); assert.equal(detail.finish, 'complete');
            const deadline = Date.now() + 10_000; while (alive(detail.host_pid) && Date.now() < deadline) await Bun.sleep(100);
            assert(!alive(detail.host_pid), 'Native wrapper still running');
        }
        record(`${flavor}: second round reuses cwd/native history, seals its own result, leaves parent HEAD/index/dirty files unchanged`);
    }
    evidence.success = true;
} catch (error) { evidence.error = error instanceof Error ? error.message : String(error); process.exitCode = 1; }
finally {
    if (hapi) try { for (const session of (await hapi.request('/api/sessions')).sessions) if (session.active) {
        await hapi.request(`/api/sessions/${session.id}/archive`, { method: 'POST', signal: AbortSignal.timeout(45_000) });
    } } catch (error) { evidence.cleanupErrors.push(String(error)); }
    if (started) try { cli(['stop']); } catch (error) { evidence.cleanupErrors.push(String(error)); }
    if (evidence.cleanupErrors.length) { evidence.success = false; process.exitCode = 1; }
    evidence.finishedAt = new Date().toISOString(); writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(`Evidence: ${join(root, 'evidence.json')}`); if (evidence.error) console.error(evidence.error);
}
