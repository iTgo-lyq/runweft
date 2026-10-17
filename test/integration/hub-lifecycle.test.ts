import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { freePort } from '../../src/services';
import { getProjectPath } from '../../hapi/cli/src/claude/utils/path';
import { installedBinaries } from '../../scripts/installed-binaries.mjs';
import { closeSmoke, removeSmokeSecrets, startSmokeHapi, stopSmokeProcess } from '../lifecycle';
import { withSmokeDeadline } from '../deadline';
import pkg from '../../package.json';

import { afterEach, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';
import { integrationBinaries } from './binaries';
let close = async () => {};
afterEach(() => close());
test('HAPI Runner shutdown releases state, lock and control port across lost Hub and rejected startup', async () => {
    const binaries = integrationBinaries();
    const root = mkdtempSync(join(tmpdir(), 'runweft-hapi-lifecycle-'));
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
    let closing: Promise<void> | undefined;
    close = () => closing ??= closeSmoke(cleanup);
    console.log('Evidence directory: ' + root);
    try {
        const direct = join(root, 'direct'), home = join(direct, 'runner'), processes = new Set<ReturnType<typeof Bun.spawn>>();
        mkdirSync(home, { recursive: true, mode: 0o700 });
        const nativeEnv = { ...env, CODEX_HOME: join(direct, 'codex'), CLAUDE_CONFIG_DIR: join(direct, 'claude'),
            HAPI_CLAUDE_PATH: Bun.which('claude') ?? undefined };
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
            const result = await withSmokeDeadline(child.exited, 10_000, () => { throw new Error('Runner exceeded 10s acceptance deadline'); });
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

        evidence.success = true;
    } finally { await close(); if (evidence.success) rmSync(root, { recursive: true, force: true }); }
}, 120000);
