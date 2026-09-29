import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { stringify } from 'yaml';
import { parseTOML } from 'toml-eslint-parser';
import { freePort } from '../src/services';
import { HapiClient } from '../src/hapi';
import pkg from '../package.json';

// Explicit real-runtime test, authorized fixtures only. Never prints copied model credentials.
const executable = resolve(process.argv[2] ?? 'dist/runweft');
mkdirSync('.dev-smoke', { recursive: true });
const root = mkdtempSync(resolve('.dev-smoke/task-controls-'));
const home = join(root, 'runweft'), project = join(root, 'project'), codexHome = join(root, 'codex'), claudeHome = join(root, 'claude');
for (const path of [project, codexHome, claudeHome]) mkdirSync(path, { mode: 0o700 });
const env: NodeJS.ProcessEnv = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_')) delete env[key];
delete env.HAPI_CODEX_APP_SERVER_BIN;
function copy(source: string, target: string) { if (existsSync(source)) { mkdirSync(dirname(target), { recursive: true, mode: 0o700 }); copyFileSync(source, target); chmodSync(target, 0o600); } }
const sourceCodex = process.env.CODEX_HOME ?? join(homedir(), '.codex');
for (const file of ['config.toml', 'auth.json']) copy(join(sourceCodex, file), join(codexHome, file));
const sourceClaude = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
copy(process.env.CLAUDE_CONFIG_DIR ? join(sourceClaude, '.claude.json') : join(homedir(), '.claude.json'), join(claudeHome, '.claude.json'));
for (const file of ['settings.json', '.credentials.json']) copy(join(sourceClaude, file), join(claudeHome, file));
Object.assign(env, { CODEX_HOME: codexHome, CLAUDE_CONFIG_DIR: claudeHome, GIT_CEILING_DIRECTORIES: root,
    HAPI_CLAUDE_PATH: process.env.RUNWEFT_SMOKE_CLAUDE || Bun.which('iclaude') || Bun.which('claude') });
const nativeConfig = Bun.TOML.parse(readFileSync(join(codexHome, 'config.toml'), 'utf8')) as any;
for (const name of Object.keys(nativeConfig.mcp_servers ?? {})) assert.equal(spawnSync('codex', ['mcp', 'remove', name], { env, stdio: 'pipe' }).status, 0);
// Only the dedicated copy opts into native approval so this test can exercise explicit decisions.
let copied = readFileSync(join(codexHome, 'config.toml'), 'utf8');
const permissionKeys = new Set(['approval_policy', 'sandbox_mode']);
const edits = parseTOML(copied).body[0].body.filter(node => node.type === 'TOMLKeyValue' && node.key.keys.length === 1
    && permissionKeys.has(node.key.keys[0].type === 'TOMLBare' ? node.key.keys[0].name : node.key.keys[0].value));
for (const node of edits.reverse()) copied = copied.slice(0, node.range[0]) + copied.slice(node.range[1]);
writeFileSync(join(codexHome, 'config.toml'), 'approval_policy = "on-request"\nsandbox_mode = "workspace-write"\n' + copied);
const claudeSettings = join(claudeHome, '.claude.json');
const prefs = existsSync(claudeSettings) ? JSON.parse(readFileSync(claudeSettings, 'utf8')) : {};
prefs.mcpServers = {}; writeFileSync(claudeSettings, JSON.stringify(prefs), { mode: 0o600 });
const models = { codex: { model: process.env.RUNWEFT_SMOKE_CODEX_MODEL || nativeConfig.model, reasoningEffort: process.env.RUNWEFT_SMOKE_CODEX_EFFORT || nativeConfig.model_reasoning_effort },
    claude: { model: process.env.RUNWEFT_SMOKE_CLAUDE_MODEL || 'claude-opus-5-5', reasoningEffort: process.env.RUNWEFT_SMOKE_CLAUDE_EFFORT || 'high' } };
const evidence: { [key: string]: any; checks: string[]; cases: any[]; cleanupErrors: string[] } = {
    root, executable, hapiRevision: pkg.hapi.revision, startedAt: new Date().toISOString(), models, success: false, checks: [], cases: [], cleanupErrors: [],
};
let started = false, token: string | undefined, hapi: HapiClient | undefined;
const pids = new Set<number>();
function alive(pid: number) { try { process.kill(pid, 0); return true; } catch { return false; } }
function cli(args: string[], expected = 0) {
    const result = spawnSync(executable, ['--home', home, '--json', ...args], { cwd: project, env, encoding: 'utf8', timeout: 65_000 });
    if (token) assert(!`${result.stdout}${result.stderr}`.includes(token), 'Credential leaked');
    assert.equal(result.status, expected, `${args[0]}: ${result.stderr || result.error || result.signal}`);
    return result.status === 0 ? JSON.parse(result.stdout) : JSON.parse(result.stderr.trim().split('\n').at(-1)!);
}
async function until<T>(read: () => T | Promise<T>, check: (value: T) => boolean, label: string, duration = 150_000): Promise<T> {
    const deadline = Date.now() + duration;
    do { const value = await read(); if (check(value)) return value; await Bun.sleep(300); } while (Date.now() < deadline);
    throw new Error(`Timed out: ${label}`);
}
function record(check: string) { evidence.checks.push(check); console.log(`PASS ${check}`); }
function show(id: string, round?: string) { return cli(['task', 'show', id, ...(round ? ['--round', round] : [])]); }
async function complete(id: string, options: { file?: string; decision?: 'approved' | 'denied'; expected?: string[] } = {}) {
    const permissions = new Set<string>();
    const result = await until(async () => {
        const current = show(id);
        for (const [requestId, request] of Object.entries(current.permissions ?? {}) as [string, any][]) {
            if (permissions.has(requestId)) continue;
            assert(options.file && JSON.stringify(request.arguments).includes(options.file), 'Unexpected permission request');
            permissions.add(requestId);
            cli(['task', 'permission', id, '--round', current.round_id, '--request', requestId, '--decision', options.decision ?? 'approved']);
        }
        if (current.status === 'unknown') throw new Error(`Unknown execution: ${JSON.stringify(current.attention)}`);
        return current;
    }, value => ['completed', 'failed', 'interrupted'].includes(value.status), 'round completion');
    assert((options.expected ?? ['completed']).includes(result.status), `Unexpected result ${result.status}: ${JSON.stringify(result.attention)}`);
    assert.equal(result.stop, 'stopped'); assert.equal(result.finish, 'complete');
    assert.equal(typeof result.host_pid, 'number'); pids.add(result.host_pid);
    await until(() => alive(result.host_pid), value => !value, 'host process exits', 10_000);
    const native = (await hapi!.request(`/api/sessions/${result.session_id}`)).session;
    assert.equal(native.active, false); assert.equal(native.metadata.lifecycleState, 'archived');
    return { result, permissions: permissions.size, native: { model: native.model, modelReasoningEffort: native.modelReasoningEffort, effort: native.effort } };
}
console.log(`Evidence directory: ${root}`);
try {
    cli(['init']); cli(['config', 'set', 'server.port', String(await freePort())]);
    const service = cli(['start']); started = true;
    token = JSON.parse(readFileSync(join(home, 'server/hapi/settings.json'), 'utf8')).cliApiToken; assert(token);
    hapi = new HapiClient(service.url, token); cli(['machine', 'register']);
    for (const flavor of ['codex', 'claude'] as const) {
        assert(models[flavor].model && models[flavor].reasoningEffort, 'Set explicit native model and effort for this acceptance');
        const runtime = cli(['runtime', 'register', flavor]).runtime;
        const definition = cli(['agent', 'init', flavor, '--runtime', runtime.id]).agent;
        writeFileSync(definition.source.path, stringify({ runtime: runtime.id, flavor, ...models[flavor] }));
        const marker = `MEMORY_${crypto.randomUUID().slice(0, 8)}`;
        const accepted = cli(['task', 'spawn', flavor, '--message', `专用任务：记住标记 ${marker}。不调用工具、不委派，只回复这个标记。`]);
        const first = await complete(accepted.agent_id);
        assert(first.result.report.text.includes(marker));
        assert.equal(first.native.model, models[flavor].model);
        assert.equal(flavor === 'codex' ? first.native.modelReasoningEffort : first.native.effort, models[flavor].reasoningEffort);
        const item: any = { flavor, agentId: accepted.agent_id, first }; evidence.cases.push(item);
        record(`${flavor}: explicit model/effort produces real native completion and stopped process`);
        // Changing the definition must not redirect an existing task's next round.
        writeFileSync(definition.source.path, 'instructions: changed after acceptance\nruntime: null\n');
        for (const decision of ['approved', 'denied'] as const) {
            const file = join(root, `${flavor}-${decision}.txt`);
            const action = flavor === 'codex'
                ? `使用 exec_command，sandbox_permissions 设为 require_escalated，执行 python3 -c 'from pathlib import Path; Path("${file}").write_text("APPROVAL_PROBE")'，justification 说明专用目录审批验证。`
                : `使用 Write 工具向 ${file} 写入 APPROVAL_PROBE，不使用 Bash。`;
            cli(['task', 'send', accepted.agent_id, '--message', `唯一任务：${action} 被拒绝时不重试、不换工具。不委派。最后回复你在首轮记住的标记，不要读取文件找标记。`]);
            const round = await complete(accepted.agent_id, { file, decision, expected: flavor === 'claude' && decision === 'denied' ? ['interrupted'] : ['completed'] });
            item[decision] = round;
            assert(round.permissions > 0, 'No native permission request observed');
            assert.equal(existsSync(file), decision === 'approved');
            assert.equal(round.result.native_session_id, first.result.native_session_id);
            assert.equal(round.result.cwd, project);
            if (decision === 'approved') assert(round.result.report.text.includes(marker), 'Native resume lost first-round memory');
        }
        record(`${flavor}: resume retains history and fixed definition; real approval/denial govern only requested file effects`);
        if (flavor === 'codex') {
            const slow = cli(['task', 'send', accepted.agent_id, '--message', '请先运行 sleep 30，等待结束后回复 SLOW_DONE。不委派，不修改文件。']);
            await until(() => show(accepted.agent_id), value => value.round_id === slow.round_id && value.inputs[0]?.observation?.phase === 'accepted', 'slow native turn');
            const steered = cli(['task', 'send', accepted.agent_id, '--steer', '--round', slow.round_id, '--message', '本轮补充要求：最终报告必须包含 STEER_NATIVE_OK。']);
            item.steer = await until(() => show(accepted.agent_id), value => value.inputs.some((input: any) => input.id === steered.input_id && ['steered', 'invoked'].includes(input.steer?.status)), 'native steer delivery');
            const done = await complete(accepted.agent_id); assert(done.result.report.text.includes('STEER_NATIVE_OK')); item.steerCompleted = done;
            record('codex: native queued-message steer carries additional input in the same business round');
        } else {
            const rejection = cli(['task', 'send', accepted.agent_id, '--steer', '--round', item.denied.result.round_id, '--message', 'unsupported'], 1);
            assert.equal(rejection.error.code, 'steer_unsupported');
        }
        const slow = cli(['task', 'send', accepted.agent_id, '--message', '运行 sleep 60，结束后回复 WAIT_DONE。不委派，不修改文件。']);
        const busy = await until(() => show(accepted.agent_id), value => value.round_id === slow.round_id && value.inputs[0]?.observation?.phase === 'accepted', 'interrupt target');
        assert.equal(cli(['task', 'interrupt', accepted.agent_id, '--round', first.result.round_id]).status, 'already_finished');
        assert.equal(show(accepted.agent_id).round_id, slow.round_id);
        cli(['task', 'interrupt', accepted.agent_id, '--round', slow.round_id]);
        item.interrupted = await complete(accepted.agent_id, { expected: ['interrupted'] });
        assert.equal(item.interrupted.result.inputs[0].observation.executionId, busy.inputs[0].observation.executionId);
        assert.equal(item.interrupted.result.inputs[0].observation.phase, 'interrupted');
        record(`${flavor}: explicit interrupt targets only current native execution and closes it`);
    }
    evidence.success = true;
} catch (error) { evidence.error = error instanceof Error ? error.message : String(error); process.exitCode = 1; }
finally {
    if (hapi) try { for (const session of (await hapi.request('/api/sessions')).sessions) if (session.active) await hapi.request(`/api/sessions/${session.id}/archive`, { method: 'POST', signal: AbortSignal.timeout(45_000) }); }
    catch (error) { evidence.cleanupErrors.push(String(error)); }
    if (started) try { cli(['stop']); } catch (error) { evidence.cleanupErrors.push(String(error)); }
    for (const pid of pids) if (alive(pid)) evidence.cleanupErrors.push(`Host still alive: ${pid}`);
    if (evidence.cleanupErrors.length) { evidence.success = false; process.exitCode = 1; }
    evidence.finishedAt = new Date().toISOString(); writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(`Evidence: ${join(root, 'evidence.json')}`); if (evidence.error) console.error(evidence.error);
}
