import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { freshWorktreeSmoke, hostAlive, worktreeEnv, type WorktreeFlavor } from './fixtures/worktree-task-smoke';
import pkg from '../package.json';

// Compiled current Task coordinator, real native models, dedicated short paths.
const executable = resolve(process.argv[2] ?? 'dist/runweft'), selectedFlavor = process.argv[3];
assert(!selectedFlavor || ['codex', 'claude'].includes(selectedFlavor), 'Optional runtime must be codex or claude');
assert(process.argv.length <= 4, 'Pass candidate and optional codex/claude runtime');
const flavors: WorktreeFlavor[] = selectedFlavor ? [selectedFlavor as WorktreeFlavor] : ['codex', 'claude'];
mkdirSync('.dev-smoke', { recursive: true }); const evidenceDir = mkdtempSync(resolve('.dev-smoke/worktree-tasks-'));
const env = worktreeEnv();
const evidence: any = { evidenceFormat: 'current-worktree-tasks-1', evidenceDir, invokedCLI: executable, hapiRevision: pkg.hapi.revision,
    startedAt: new Date().toISOString(), success: false, checks: [], cases: [], cleanupErrors: [], hostPids: [], hapiSessionIds: [] };
let fixture: Awaited<ReturnType<typeof freshWorktreeSmoke>> | undefined;
let root = evidenceDir;
const save = () => writeFileSync(join(evidenceDir, 'evidence.json'), JSON.stringify(evidence, null, 2), { mode: 0o600 });
function cli(args: string[], cwd = root, timeout = 60_000) {
    return fixture!.cli(fixture!.home, args, { cwd, timeout });
}
function git(cwd: string, ...args: string[]) {
    const result = spawnSync('git', ['-C', cwd, ...args], { env, encoding: 'utf8', timeout: 20_000 });
    assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
}
const alive = hostAlive;
function record(value: string) { evidence.checks.push(value); save(); console.log(`PASS ${value}`); }
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
                    && permission.arguments.command.split(/&&|;/).every((command: string) => {
                        const text = command.trim(), prefix = [`git -C ${detail.cwd} `, 'git '].find(prefix => text.startsWith(prefix));
                        return !!prefix && /^(?:status(?: --(?:short|porcelain(?:=v1)?))?|log --oneline -\d+|diff --stat|rev-parse HEAD)$/.test(text.slice(prefix.length));
                    });
                if (!readGit && !/result\.txt|probe_report|project_probe|worktree-probe|AGENTS\.md|CLAUDE\.md/.test(args + permission.tool)) {
                    throw new Error(`Unreviewed fixture permission: ${permission.tool} (${id}/${roundId}/${requestId})`);
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
    fixture = await freshWorktreeSmoke(executable, env, flavors); root = fixture.root;
    Object.assign(evidence, { root, ownedRoot: fixture.ownedRoot, candidate: fixture.candidate, handoff: fixture.handoff, sourceConfigurations: fixture.sourceConfigurations }); save();
    for (const flavor of flavors) {
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
        const repositoryId: string = await fixture.bind(cwd); const agentId: string = fixture.agent(flavor, repositoryId).id;
        const item: any = { flavor, project, parentCwd: cwd, repositoryId, agentId, base, parentIndex, parentStatus, memory, context, skill, probeLog, approvals: [], rounds: [] }; evidence.cases.push(item);
        if (flavor === 'claude') {
            const hooks = join(root, 'fixture-hooks'); mkdirSync(hooks);
            item.repairHook = join(hooks, 'pre-commit');
            writeFileSync(item.repairHook, '#!/bin/sh\necho fixture-checkpoint-rejected >&2\nexit 1\n', { mode: 0o755 });
            git(project, 'config', 'core.hooksPath', hooks);
        }
        const request = crypto.randomUUID();
        const message = `使用本项目 worktree-probe skill。在当前工作目录把 result.txt 写成 ${marker} 加一个换行，不修改其他文件，不提交。若有 project_probe MCP，调用一次它的 probe_report；若不可用，报告 PROJECT_MCP_UNAVAILABLE，不自行修改配置或安装。记住 ${memory}，不要把这个记忆标记写入文件。最终报告包括工程与 skill 标记和 WRITE_DONE，不委派。`;
        const accepted = cli(['task', 'spawn', agentId, '--workspace-mode', 'worktree', '--base', 'HEAD', '--request-id', request, '--message', message], cwd);
        item.accepted = accepted; item.taskId = accepted.agent_id; save();
        const first = await completed(accepted.agent_id, accepted.round_id, cwd, item); item.rounds.push(first); evidence.hostPids.push(first.host_pid); evidence.hapiSessionIds.push(first.session_id); save();
        if (item.failedFinish) {
            assert.equal(first.session_id, item.failedFinish.session_id); assert.deepEqual(first.inputs, item.failedFinish.inputs); assert.equal(first.inputs.length, 1);
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
        item.projectMcpEvents = probeEvents; evidence.hostPids.push(...probeEvents.map((event: any) => event.pid));
        if (item.projectMcp === 'called') assert(probeEvents.some((event: any) => event.event === 'call' && event.cwd === first.cwd));
        record(`${flavor}: native edit, instructions/skill, project MCP=${item.projectMcp}, automatic Git checkpoint`);
        const next = cli(['task', 'send', accepted.agent_id, '--message', '在 result.txt 末尾追加 SECOND 加一个换行。报告上一轮要求记住但不写入文件的 MEMORY_ 开头标记，原样复述，并附上 RESUME_DONE。不调用 MCP，不读取工程指令或 skill，不委派，不自行提交。'], cwd);
        item.secondAcceptance = next; save();
        const second = await completed(accepted.agent_id, next.round_id, cwd, item); item.rounds.push(second); evidence.hostPids.push(second.host_pid); evidence.hapiSessionIds.push(second.session_id); save();
        assert.equal(second.cwd, first.cwd); assert.equal(second.native_session_id, first.native_session_id); assert.equal(second.resume.outcome, 'resumed');
        assert.equal(second.reconstruction, undefined); assert(second.report.text.includes(memory), 'Native history was not preserved');
        assert.equal(second.git.start_head, first.git.result_head); assert.equal(readFileSync(join(first.cwd, 'result.txt'), 'utf8'), `${marker}\nSECOND\n`);
        assert.equal(git(project, 'show', `${second.git.result_ref}:app/result.txt`), `${marker}\nSECOND`);
        assert.equal(git(project, 'rev-parse', 'HEAD'), base); assert.equal(git(project, 'write-tree'), parentIndex); assert.equal(git(project, 'status', '--porcelain'), parentStatus);
        assert.deepEqual(cli(['task', 'spawn', agentId, '--workspace-mode', 'worktree', '--base', 'HEAD', '--request-id', request, '--message', message], cwd), accepted);
        for (const detail of [first, second]) {
            assert.equal(detail.stop, 'stopped'); assert.equal(detail.finish, 'complete');
            const deadline = Date.now() + 10_000; while (alive(detail.host_pid) && Date.now() < deadline) await Bun.sleep(100);
            assert(!alive(detail.host_pid), 'Native wrapper still running');
        }
        record(`${flavor}: second round reuses cwd/native history, seals its own result, leaves parent HEAD/index/dirty files unchanged`);
    }
    assert.equal(evidence.cases.length, flavors.length); assert.equal(evidence.cases.reduce((n: number, item: any) => n + item.rounds.length, 0), flavors.length * 2);
    evidence.success = true;
} catch (error) { evidence.error = error instanceof Error ? error.stack ?? error.message : String(error); process.exitCode = 1; }
finally {
    for (const item of evidence.cases) if (item.probeLog && existsSync(item.probeLog)) try {
        const events: any[] = [];
        for (const line of readFileSync(item.probeLog, 'utf8').trim().split('\n').filter(Boolean)) try { events.push(JSON.parse(line)); }
        catch { evidence.probeObservationIncomplete = true; evidence.cleanupErrors.push('Malformed owned project MCP observation: ' + item.probeLog); }
        item.projectMcpEvents = events; evidence.hostPids.push(...events.map(event => event.pid));
    } catch { evidence.probeObservationIncomplete = true; evidence.cleanupErrors.push('Cannot read owned project MCP observations: ' + item.probeLog); }
    if (fixture) try { await fixture.close(evidence, evidence.success && !evidence.cleanupErrors.length); } catch (error) { evidence.cleanupErrors.push(...(error instanceof AggregateError ? error.errors.map(String) : [String(error)])); }
    if (evidence.cleanupErrors.length) { evidence.success = false; process.exitCode = 1; }
    evidence.finishedAt = new Date().toISOString(); save();
    console.log(`Evidence: ${join(evidenceDir, 'evidence.json')}`); if (evidence.error) console.error(evidence.error);
}
