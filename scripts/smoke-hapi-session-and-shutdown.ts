import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { freePort } from '../src/services';
import { getProjectPath } from '../hapi/cli/src/claude/utils/path';
import { installedBinaries } from './fixtures/installed-binaries.mjs';
import { closeSmoke, removeSmokeSecrets, startSmokeHapi, stopSmokeProcess } from './fixtures/smoke-lifecycle';
import { nonGitSmokeProject } from './fixtures/non-git-smoke-project';
import { taskSmoke } from './fixtures/task-smoke';
import pkg from '../package.json';

// Real compiled processes, dedicated homes, and two real Claude Task rounds.
const binary = resolve(process.argv[2] ?? 'dist/runweft'), binaries = installedBinaries(binary);
mkdirSync('.dev-smoke', { recursive: true });
const root = mkdtempSync(resolve('.dev-smoke/hapi-lifecycle-'));
const env: NodeJS.ProcessEnv = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_') || key.startsWith('HAPI_') || ['CLI_API_TOKEN', 'DB_PATH', 'TELEGRAM_BOT_TOKEN'].includes(key)) delete env[key];
const evidence: any = { root, candidate: { binaries, hapiRevision: pkg.hapi.revision }, success: false, checks: [], runnerCases: [], cleanupErrors: [] };
const cleanup: Array<() => void | Promise<void>> = [];
const check = (name: string) => { evidence.checks.push(name); console.log('PASS ' + name); };
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(check: () => boolean | Promise<boolean>, message: string, timeout = 30_000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) { if (await check()) return; await Bun.sleep(100); }
    throw new Error(message);
}
const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
console.log('Evidence directory: ' + root);
try {
    const direct = join(root, 'direct'), home = join(direct, 'runner'), processes = new Set<ReturnType<typeof Bun.spawn>>();
    mkdirSync(home, { recursive: true, mode: 0o700 });
    const nativeEnv = { ...env, CODEX_HOME: join(direct, 'codex'), CLAUDE_CONFIG_DIR: join(direct, 'claude'),
        HAPI_CLAUDE_PATH: process.env.RUNWEFT_SMOKE_CLAUDE ?? Bun.which('iclaude') ?? Bun.which('claude') ?? undefined };
    mkdirSync(nativeEnv.CODEX_HOME, { recursive: true }); mkdirSync(nativeEnv.CLAUDE_CONFIG_DIR, { recursive: true });
    const port = await freePort(), url = `http://127.0.0.1:${port}`, token = randomBytes(32).toString('base64url'), machineId = randomUUID();
    const secrets = [join(home, 'settings.json'), join(direct, 'hapi', 'settings.json'), join(direct, 'hapi', 'jwt-secret.json')];
    cleanup.push(() => removeSmokeSecrets(secrets, processes));
    const hub = await startSmokeHapi(binaries.hapi.path, direct, nativeEnv, port, token, processes);
    cleanup.push(() => stopSmokeProcess(hub));
    let number = 0;
    async function launch(credential = token, ready = true) {
        writeFileSync(join(home, 'settings.json'), JSON.stringify({ machineId, cliApiToken: credential }), { mode: 0o600 });
        const child = Bun.spawn([binaries.hapi.path, 'runner', 'start-sync'], {
            env: { ...nativeEnv, HAPI_HOME: home, HAPI_API_URL: url, CLI_API_TOKEN: credential, HAPI_DISABLE_VERSION_HANDOFF: '1' },
            stdout: Bun.file(join(direct, `runner-${++number}.out`)), stderr: Bun.file(join(direct, `runner-${number}.err`)),
        });
        processes.add(child);
        cleanup.push(async () => { if (child.exitCode === null && child.signalCode === null) await stopSmokeProcess(child); });
        if (ready) await until(async () => {
            assert.equal(child.exitCode, null, 'Runner exited during startup');
            if (!existsSync(join(home, 'runner.state.json'))) return false;
            const response = await fetch(`${url}/cli/machines/${machineId}`, { headers: { authorization: `Bearer ${token}` } });
            const body = await response.json() as any;
            return body.machine?.active === true && body.machine?.runnerState?.status === 'running';
        }, 'Runner did not connect and advertise running');
        return child;
    }
    async function stopped(child: ReturnType<typeof Bun.spawn>, name: string, expected = 0) {
        const before = existsSync(join(home, 'runner.state.json')) ? JSON.parse(readFileSync(join(home, 'runner.state.json'), 'utf8')) : undefined;
        const started = Date.now();
        if (child.exitCode === null && child.signalCode === null && expected === 0) child.kill('SIGTERM');
        const result = await Promise.race([child.exited, Bun.sleep(10_000).then(() => { throw new Error('Runner exceeded 10s acceptance deadline'); })]);
        assert.equal(result, expected); assert.equal(child.signalCode, null); assert(!alive(child.pid));
        assert(!existsSync(join(home, 'runner.state.json')) && !existsSync(join(home, 'runner.state.json.lock')));
        const logFile = readdirSync(join(home, 'logs')).find(file => file.endsWith(`-pid-${child.pid}-runner.log`)); assert(logFile);
        const log = readFileSync(join(home, 'logs', logFile), 'utf8');
        // Startup can fail before the parent observes state; the owned log still records an acquired port.
        const controlPort = before?.httpPort ?? Number(log.match(/\[CONTROL SERVER\] Started on port (\d+)/)?.[1]);
        if (controlPort) {
            assert(log.includes('[CONTROL SERVER] Server stopped'));
            await assert.rejects(fetch(`http://127.0.0.1:${controlPort}/list`, { method: 'POST', signal: AbortSignal.timeout(1000) }));
        }
        assert(log.includes(`exiting process (code ${expected})`)); assert(!log.includes('forcing exit'));
        if (expected === 0) { assert(!log.includes('[FATAL]') && !log.includes('Cleanup failed')); assert(log.includes('Cleanup completed')); }
        evidence.runnerCases.push({ name, pid: child.pid, exitCode: result, signal: null, elapsedMs: Date.now() - started,
            stateRemoved: true, lockRemoved: true, controlPortClosed: controlPort ? true : null, noticeUnavailable: log.includes('Shutdown notice unavailable') });
        check('Runner ' + name);
    }
    await stopped(await launch(), 'normal');
    const halfOpen = await launch(); hub.kill('SIGSTOP');
    try { await stopped(halfOpen, 'connected Hub without ACK'); assert(evidence.runnerCases.at(-1).noticeUnavailable); }
    finally { hub.kill('SIGCONT'); }
    await stopped(await launch('invalid-smoke-credential', false), 'startup credential rejection', 1);
    const restarted = await launch();
    assert.equal(JSON.parse(readFileSync(join(home, 'runner.state.json'), 'utf8')).startedWithMachineId, machineId);
    await stopped(restarted, 'restart with original machine ID');
    const disconnected = await launch(); await stopSmokeProcess(hub);
    await stopped(disconnected, 'Hub disconnected');

    const project = nonGitSmokeProject(); cleanup.push(() => project.close());
    const cwd = join(project.project, 'a'.repeat(110), 'b'.repeat(110)); mkdirSync(cwd, { recursive: true });
    assert.equal(realpathSync(cwd), cwd); assert(cwd.length > 200);
    const fixture = await taskSmoke(join(root, 'native'), binary, env, ['claude']); cleanup.push(() => fixture.close(false));
    const credentialCopies = fixture.models.copies.filter(file => ['auth.json', '.credentials.json'].includes(file.split('/').at(-1)!)).map(path => ({ path, hash: sha(path) }));
    const cli = (args: string[]) => fixture.cli(fixture.home, args, { cwd });
    const agent = fixture.agent('claude', { flavor: 'claude', model: 'claude-opus-5-5', reasoningEffort: 'low', repositoryId: null });
    const marker = `LONG_CWD_MEMORY_${randomUUID()}`;
    const accepted = cli(['task', 'spawn', agent.id, '--message', `记住 ${marker}。不要调用工具、读写文件或委派。只回复 FIRST_ROUND_OK。`]);
    async function complete() {
        let current: any;
        await until(() => { current = cli(['task', 'show', accepted.agent_id]); return ['completed', 'failed', 'interrupted', 'needs_attention', 'unknown'].includes(current.status); }, 'Claude Task completion timed out', 240_000);
        assert.equal(current.status, 'completed'); assert.equal(current.finish, 'complete'); assert.equal(current.stop, 'stopped');
        assert.equal(current.inputs[0]?.observation?.source, 'native');
        fixture.ownedPids.add(current.host_pid); await until(() => !alive(current.host_pid), 'Native host did not exit', 10_000);
        return current;
    }
    const first = await complete();
    assert(first.report.text.includes('FIRST_ROUND_OK'));
    const history = join(env.CLAUDE_CONFIG_DIR!, 'projects', basename(getProjectPath(cwd)), first.native_session_id + '.jsonl'); assert(existsSync(history));
    cli(['task', 'send', accepted.agent_id, '--message', '回复你在上一轮记住的 LONG_CWD_MEMORY 标记。不要调用工具、读写文件或委派。']);
    const second = await complete(); assert(second.report.text.includes(marker));
    assert.equal(second.native_session_id, first.native_session_id); assert.equal(second.session_id, first.session_id);
    assert(!second.reconstruction); assert(existsSync(history));
    for (const copy of credentialCopies) assert.equal(sha(copy.path), copy.hash, 'Credential copy changed');
    evidence.claude = { cwdLength: cwd.length, nativeSessionId: first.native_session_id, sameNativeId: true, sameHapiSession: true,
        reconstruction: false, memoryRetained: true, historyDirectory: history.slice(0, history.lastIndexOf('/')), credentialCopiesUnchanged: true };
    check('Claude long cwd two rounds preserve native session and memory without reconstruction');
    evidence.success = true;
} catch (error) { evidence.error = String(error); process.exitCode = 1; }
finally {
    try { await closeSmoke(cleanup); }
    catch (error) { evidence.success = false; evidence.cleanupErrors = error instanceof AggregateError ? error.errors.map(String) : [String(error)]; process.exitCode = 1; }
    evidence.finishedAt = new Date().toISOString(); writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2), { mode: 0o600 });
    console.log('Evidence: ' + join(root, 'evidence.json')); if (evidence.error) console.error(evidence.error);
}
