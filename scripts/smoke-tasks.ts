import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { freePort } from '../src/services';
import { HapiClient } from '../src/hapi';
import pkg from '../package.json';

// Explicit native acceptance, isolated writable homes; existing model login is copied, never printed.
const executable = resolve(process.argv[2] ?? 'dist/runweft');
mkdirSync('.dev-smoke', { recursive: true });
const root = mkdtempSync(resolve('.dev-smoke/tasks-'));
const home = join(root, 'runweft'), project = join(root, 'project'), codexHome = join(root, 'codex');
for (const path of [project, codexHome]) mkdirSync(path, { mode: 0o700 });
const env: NodeJS.ProcessEnv = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_')) delete env[key];
delete env.HAPI_CODEX_APP_SERVER_BIN;
const sourceCodex = process.env.CODEX_HOME ?? join(homedir(), '.codex');
for (const file of ['config.toml', 'auth.json']) if (existsSync(join(sourceCodex, file))) {
    copyFileSync(join(sourceCodex, file), join(codexHome, file)); chmodSync(join(codexHome, file), 0o600);
}
Object.assign(env, { CODEX_HOME: codexHome, GIT_CEILING_DIRECTORIES: root });
// Avoid unrelated installed MCP startup in this dedicated single-round acceptance.
if (existsSync(join(codexHome, 'config.toml'))) {
    const config = Bun.TOML.parse(readFileSync(join(codexHome, 'config.toml'), 'utf8')) as { mcp_servers?: Record<string, unknown> };
    for (const name of Object.keys(config.mcp_servers ?? {})) assert.equal(spawnSync('codex', ['mcp', 'remove', name], { env, stdio: 'pipe' }).status, 0);
}
const evidence: { [key: string]: any; checks: string[]; cleanupErrors: string[] } = {
    root, executable, hapiRevision: pkg.hapi.revision, startedAt: new Date().toISOString(), success: false, checks: [], cleanupErrors: [],
};
let started = false, token: string | undefined, hapi: HapiClient | undefined;
function alive(pid: number) { try { process.kill(pid, 0); return true; } catch { return false; } }
function cli(args: string[], timeout = 60_000) {
    const result = spawnSync(executable, ['--home', home, '--json', ...args], { cwd: project, env, encoding: 'utf8', timeout });
    if (token) assert(!`${result.stdout}${result.stderr}`.includes(token), 'Credential leaked into CLI output');
    assert.equal(result.status, 0, `${args[0]}: ${result.stderr || result.error || result.signal}`);
    return { value: JSON.parse(result.stdout), stderr: result.stderr };
}
function record(value: string) { evidence.checks.push(value); console.log(`PASS ${value}`); }
console.log(`Evidence directory: ${root}`);
try {
    cli(['init']); cli(['config', 'set', 'server.port', String(await freePort())]);
    const service = cli(['start']).value; started = true;
    token = JSON.parse(readFileSync(join(home, 'server/hapi/settings.json'), 'utf8')).cliApiToken; assert(token);
    hapi = new HapiClient(service.url, token);
    cli(['machine', 'register']);
    const runtime = cli(['runtime', 'register', 'codex']).value.runtime;
    evidence.runtime = { id: runtime.id, flavor: runtime.flavor, version: runtime.inspection.details.version };
    cli(['agent', 'init', 'review', '--runtime', runtime.id]);
    const requestId = crypto.randomUUID();
    const message = '这是专用验收任务。不要调用工具、委派或修改文件。最终回复 TASK_SINGLE_ROUND_OK，并提供简短报告。';
    const start = cli(['task', 'spawn', 'review', '--message', message, '--request-id', requestId]);
    const accepted = start.value; evidence.accepted = accepted;
    assert.equal(JSON.parse(start.stderr.trim()).request_id, requestId);
    assert.equal(accepted.accepted, true);
    assert.deepEqual(cli(['task', 'spawn', 'review', '--message', message, '--request-id', requestId]).value, accepted);
    record('compiled CLI returns accepted IDs, prints request ID before network, and retries without another task');
    // The spawn command has exited; only serve owns native observation and cleanup.
    const deadline = Date.now() + 150_000;
    let current: any;
    do {
        const waited = cli(['task', 'wait', accepted.agent_id, '--timeout', '30000'], 45_000).value;
        current = waited.agents[0];
        if (current.status === 'completed' || current.status === 'failed' || current.status === 'interrupted') break;
        if (current.status !== 'running') throw new Error(`Task needs attention: ${JSON.stringify(current.attention)}`);
    } while (Date.now() < deadline);
    assert.equal(current.status, 'completed', `Task incomplete: ${current.status}`);
    const detail = cli(['task', 'show', accepted.agent_id]).value;
    assert(detail.report.text.includes('TASK_SINGLE_ROUND_OK'));
    assert.equal(detail.inputs[0].observation.phase, 'completed'); assert.equal(detail.inputs[0].observation.source, 'native');
    assert.equal(detail.stop, 'stopped'); assert.equal(detail.finish, 'complete');
    evidence.result = detail;
    const native = (await hapi.request(`/api/sessions/${detail.session_id}`)).session;
    assert.equal(native.active, false); assert.equal(native.metadata.lifecycleState, 'archived');
    const pid = detail.host_pid; assert.equal(typeof pid, 'number');
    const processDeadline = Date.now() + 10_000;
    while (alive(pid) && Date.now() < processDeadline) await Bun.sleep(100);
    assert(!alive(pid), 'Native shared host is still running after its sole root closed');
    assert.deepEqual(readdirSync(project), []);
    assert.equal(cli(['task', 'list']).value.agents.length, 1);
    assert.equal(cli(['task', 'wait', accepted.agent_id, '--timeout', '0', '--after-revision', JSON.stringify({ [accepted.agent_id]: detail.revision })]).value.timed_out, true);
    record('real native completion is returned through CLI and HAPI confirms archived/inactive with host process exit');
    record('spawn command exit does not cancel work; non-Git shared directory remains untouched and cursor suppresses old result');
    cli(['restart']);
    assert.equal(cli(['task', 'show', accepted.agent_id]).value.status, 'completed');
    assert.deepEqual(cli(['task', 'spawn', 'review', '--message', message, '--request-id', requestId]).value, accepted);
    record('service restart preserves accepted request and complete report without executing again');
    evidence.success = true;
} catch (error) {
    evidence.error = error instanceof Error ? error.message : String(error); process.exitCode = 1;
} finally {
    if (hapi) try {
        const sessions = (await hapi.request('/api/sessions')).sessions;
        for (const session of sessions) if (session.active) await hapi.request(`/api/sessions/${session.id}/archive`, { method: 'POST', signal: AbortSignal.timeout(45_000) });
    } catch (error) { evidence.cleanupErrors.push(String(error)); }
    if (started) try { cli(['stop']); } catch (error) { evidence.cleanupErrors.push(String(error)); }
    if (evidence.cleanupErrors.length) { evidence.success = false; process.exitCode = 1; }
    evidence.finishedAt = new Date().toISOString();
    writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(`Evidence: ${join(root, 'evidence.json')}`);
    if (evidence.error) console.error(evidence.error);
}
