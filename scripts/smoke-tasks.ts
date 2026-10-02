import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { HapiHttp } from '../src/hapi';
import { nonGitSmokeProject } from './fixtures/non-git-smoke-project';
import { taskSmoke } from './fixtures/task-smoke';
import pkg from '../package.json';

// Explicit native acceptance, isolated writable homes; existing model login is copied, never printed.
const executable = resolve(process.argv[2] ?? 'dist/runweft');
mkdirSync('.dev-smoke', { recursive: true });
const root = mkdtempSync(resolve('.dev-smoke/tasks-'));
const nonGit = nonGitSmokeProject(), project = nonGit.project;
const env: NodeJS.ProcessEnv = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_') || key.startsWith('HAPI_') || ['CLI_API_TOKEN', 'DB_PATH'].includes(key)) delete env[key];
env.GIT_CEILING_DIRECTORIES = root;
const evidence: { [key: string]: any; checks: string[]; cleanupErrors: string[] } = {
    root, executable, nonGitProject: { root: nonGit.root, project }, hapiRevision: pkg.hapi.revision, startedAt: new Date().toISOString(), success: false, checks: [], cleanupErrors: [],
};
let fixture: Awaited<ReturnType<typeof taskSmoke>> | undefined, hapi: HapiHttp | undefined;
function alive(pid: number) { try { process.kill(pid, 0); return true; } catch { return false; } }
function cli(args: string[], timeout = 60_000) {
    const result = fixture!.run(fixture!.home, args, { cwd: project, timeout });
    assert.equal(result.status, 0, `${args[0]}: ${result.stderr || result.error || result.signal}`);
    return { value: JSON.parse(result.stdout), stderr: result.stderr };
}
function record(value: string) { evidence.checks.push(value); console.log(`PASS ${value}`); }
console.log(`Evidence directory: ${root}`);
try {
    fixture = await taskSmoke(root, executable, env, ['codex']); hapi = fixture.runner.http;
    evidence.candidate = fixture.candidate;
    const runtime = fixture.runner.runtimes.codex;
    evidence.runtime = { id: runtime.id, flavor: runtime.flavor, version: runtime.inspection?.details?.version };
    const agent = fixture.agent('codex');
    const requestId = crypto.randomUUID();
    const message = '这是专用验收任务。不要调用工具、委派或修改文件。最终回复 TASK_SINGLE_ROUND_OK，并提供简短报告。';
    const start = cli(['task', 'spawn', agent.id, '--message', message, '--request-id', requestId]);
    const accepted = start.value; evidence.accepted = accepted;
    assert.equal(JSON.parse(start.stderr.trim()).request_id, requestId);
    assert.equal(accepted.accepted, true);
    assert.deepEqual(cli(['task', 'spawn', agent.id, '--message', message, '--request-id', requestId]).value, accepted);
    record('compiled CLI returns accepted IDs, prints request ID to stderr, and retries without another task');
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
    await fixture.restart();
    assert.equal(cli(['task', 'show', accepted.agent_id]).value.status, 'completed');
    assert.deepEqual(cli(['task', 'spawn', agent.id, '--message', message, '--request-id', requestId]).value, accepted);
    record('service restart preserves accepted request and complete report without executing again');
    evidence.success = true;
} catch (error) {
    evidence.error = error instanceof Error ? error.message : String(error); process.exitCode = 1;
} finally {
    try { await fixture?.close(evidence.success); } catch (error) { evidence.cleanupErrors.push(...(error instanceof AggregateError ? error.errors.map(String) : [String(error)])); }
    try { nonGit.close(); } catch (error) { evidence.cleanupErrors.push(String(error)); }
    if (evidence.cleanupErrors.length) { evidence.success = false; process.exitCode = 1; }
    evidence.finishedAt = new Date().toISOString();
    writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(`Evidence: ${join(root, 'evidence.json')}`);
    if (evidence.error) console.error(evidence.error);
}
