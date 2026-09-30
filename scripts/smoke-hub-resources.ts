import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { io, type Socket } from 'socket.io-client';
import { atomicWrite, hubOrigin } from '../src/config';
import { freePort } from '../src/services';
import { createResourceGateway } from '../src/hub/resources/gateway';
import { HubResourceClient } from '../src/hub/resources/client';
import { HubStore } from '../src/hub/store';

// Real native tool discovery only. Dedicated homes; no model calls or user credential copies.
mkdirSync('.dev-smoke', { recursive: true });
const root = mkdtempSync(resolve('.dev-smoke/hub-resources-')), statePath = join(root, 'state.sqlite');
const binary = resolve(process.argv[2] ?? 'dist/hapi'), cliBinary = resolve(process.argv[3] ?? 'dist/runweft');
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('HAPI_') || key.startsWith('RUNWEFT_') || ['CLI_API_TOKEN', 'DB_PATH', 'TELEGRAM_BOT_TOKEN'].includes(key)) delete env[key];
env.CODEX_HOME = join(root, 'codex'); env.CLAUDE_CONFIG_DIR = join(root, 'claude');
for (const dir of [env.CODEX_HOME, env.CLAUDE_CONFIG_DIR]) mkdirSync(dir, { mode: 0o700 });
env.HAPI_CLAUDE_PATH = Bun.which('claude') ?? undefined;
assert(env.HAPI_CLAUDE_PATH && Bun.which('codex'), 'Native Codex and Claude Code commands are required for version-only discovery.');
const port = await freePort(), target = `http://127.0.0.1:${port}`, rootToken = randomBytes(32).toString('base64url'), key = randomBytes(32);
const nativeHome = join(root, 'hapi'), secrets = [rootToken];
const hapi = Bun.spawn([binary, 'hub'], { env: { ...env, HAPI_HOME: nativeHome, DB_PATH: join(nativeHome, 'hapi.db'),
    HAPI_LISTEN_HOST: '127.0.0.1', HAPI_LISTEN_PORT: String(port), HAPI_PUBLIC_URL: target, CLI_API_TOKEN: rootToken, TELEGRAM_BOT_TOKEN: '' },
    stdout: Bun.file(join(root, 'hapi-out.log')), stderr: Bun.file(join(root, 'hapi-err.log')) });
let gateway: Awaited<ReturnType<typeof createResourceGateway>> | undefined, hub: HubStore | undefined;
let runner: ReturnType<typeof Bun.spawn> | undefined, runnerNumber = 0, socket: Socket | undefined;
let base = '', gatewayPort = 0;
const home = join(root, 'client'), checks: string[] = [];
const evidence: any = { root, binary, cliBinary, checks, success: false,
    kind: 'compiled CLI and composed gateway; real unmodified HAPI/Runner and native version probes, no model calls' };
const check = (name: string) => { checks.push(name); console.log('PASS ' + name); };
async function until(fn: () => Promise<boolean>, message: string, ms = 30_000) {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await fn()) return; await Bun.sleep(250); }
    throw new Error(message);
}
function backup(user: ReturnType<HubStore['createIdentity']>, name: string) {
    const file = join(root, name + '.txt');
    atomicWrite(file, `Runweft Hub: ${base}\n身份 ID: ${user.identity.id}\n${user.token}\n`); secrets.push(user.token); return file;
}
async function cli(file: string, args: string[], space?: string, expected = 0) {
    const child = Bun.spawn([cliBinary, '--home', home, '--json', 'hub', '--url', base, '--identity-file', file,
        ...(space ? ['--space', space] : []), ...args], { env, stdout: 'pipe', stderr: 'pipe' });
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    for (const secret of secrets) assert(!(stdout + stderr).includes(secret), 'Credential appeared in CLI output');
    assert.equal(exit, expected, `${args.join(' ')}: ${stderr}`);
    return JSON.parse(stdout || stderr);
}
async function startRunner(recordPath: string) {
    const record = JSON.parse(readFileSync(recordPath, 'utf8'));
    const runnerHome = join(recordPath, '..', 'hapi');
    atomicWrite(join(runnerHome, 'settings.json'), JSON.stringify({ machineId: record.machineId, cliApiToken: record.active.token }));
    runnerNumber++;
    runner = Bun.spawn([binary, 'runner', 'start-sync'], { env: { ...env, HAPI_HOME: runnerHome, HAPI_API_URL: base,
        CLI_API_TOKEN: record.active.token, HAPI_DISABLE_VERSION_HANDOFF: '1' },
        stdout: Bun.file(join(root, `runner-${runnerNumber}-out.log`)), stderr: Bun.file(join(root, `runner-${runnerNumber}-err.log`)) });
}
async function stopRunner() { if (runner) { runner.kill(); await runner.exited; runner = undefined; } }
async function startGateway() {
    gateway = await createResourceGateway({ host: '127.0.0.1', port: gatewayPort, target, rootToken, key, statePath });
    gatewayPort = (gateway.server.address() as { port: number }).port; base = hubOrigin.parse(`http://127.0.0.1:${gatewayPort}`);
}
console.log('Evidence directory: ' + root);
try {
    await until(async () => { try { return (await fetch(target + '/health', { signal: AbortSignal.timeout(500) })).ok; } catch { return false; } }, 'HAPI startup');
    await startGateway(); hub = new HubStore(statePath);
    const a = hub.createIdentity('machine owner'), b = hub.createIdentity('shared user'), c = hub.createIdentity('space admin');
    const sid = a.personalSpace.id, tid = c.personalSpace.id;
    for (const [issuer, user, space, role] of [[a, b, sid, 'member'], [a, c, sid, 'admin'], [c, a, tid, 'member'], [c, b, tid, 'member']] as const) {
        hub.acceptInvitation(user.identity.id, hub.invite(issuer.identity.id, space, role).token);
    }
    const af = backup(a, 'owner'), bf = backup(b, 'member'), cf = backup(c, 'admin');
    const enrolled = await cli(af, ['machine', 'enroll', '--name', 'Resource smoke Runner']);
    const machineId = enrolled.machineId, recordPath = enrolled.credentialFile;
    const original = JSON.parse(readFileSync(recordPath, 'utf8')); secrets.push(original.active.token);
    assert.equal((await cli(af, ['machine', 'show', machineId])).machine.connection, 'pending');
    assert.equal((await cli(af, ['machine', 'enroll'])).machineId, machineId);
    for (const space of [sid, tid]) await cli(af, ['machine', 'associate', machineId, space]);
    const owner = new HubResourceClient({ url: base, identityFile: af, space: sid });
    await startRunner(recordPath);
    await until(async () => {
        assert.equal(runner!.exitCode, null, 'Runner exited unexpectedly');
        try { return (await owner.discover(machineId)).tools.every(t => t.toolFound); } catch { return false; }
    }, 'Unmodified Runner did not expose native tools');
    const discovery = await cli(af, ['machine', 'discover', machineId]);
    evidence.tools = discovery.tools.map((t: any) => ({ flavor: t.flavor, version: t.inspection.details.version, versionStatus: t.inspection.details.versionStatus }));
    assert(discovery.tools.every((t: any) => t.toolFound && t.inspection.details.versionStatus === 'detected'));
    check('compiled CLI persists enrollment before unmodified Runner startup; real Codex/Claude version discovery and heartbeat succeed');

    const codex = (await cli(af, ['runtime', 'register', 'codex', '--machine', machineId, '--name', 'Code worker'], sid)).runtime;
    const claude = (await cli(af, ['runtime', 'register', 'claude', '--machine', machineId], sid)).runtime;
    assert.notEqual(codex.id, claude.id); assert.equal(codex.eligibility.eligible, true);
    assert.equal((await cli(af, ['runtime', 'register', 'codex', '--machine', machineId], sid)).runtime.id, codex.id);
    assert.deepEqual((await cli(bf, ['runtime', 'list'], sid)).runtimes, []);
    const overview = await cli(cf, ['runtime', 'list'], sid);
    assert.equal(overview.runtimes.length, 2); assert(!JSON.stringify(overview).includes('executable'));
    assert.equal((await cli(cf, ['runtime', 'resolve', claude.id], sid, 1)).error.code, 'runtime_private');
    for (const space of [sid, tid]) await cli(af, ['runtime', 'share', codex.id, space]);
    const shared = await cli(bf, ['runtime', 'resolve', codex.id], sid);
    assert.equal(shared.target.machineId, machineId); assert(!JSON.stringify(shared).includes('executable'));
    assert.equal((await cli(bf, ['machine', 'discover', machineId], sid, 1)).error.code, 'resource_action_forbidden');
    check('real native installations keep stable runtime IDs; sharing exposes a usable target without private tool paths or machine controls');

    await cli(cf, ['runtime', 'block', codex.id, sid]);
    assert.equal((await cli(af, ['runtime', 'resolve', codex.id], sid, 1)).error.code, 'resource_space_blocked');
    assert.equal((await cli(bf, ['runtime', 'resolve', codex.id], tid)).target.runtimeId, codex.id);
    await cli(af, ['machine', 'detach', machineId, sid]); await cli(af, ['machine', 'associate', machineId, sid]);
    assert.equal((await cli(bf, ['runtime', 'resolve', codex.id], sid, 1)).error.code, 'hub_object_not_found');
    await cli(af, ['runtime', 'share', codex.id, sid]);
    assert.equal((await cli(bf, ['runtime', 'resolve', codex.id], sid, 1)).error.code, 'resource_space_blocked');
    await cli(cf, ['runtime', 'unblock', codex.id, sid]);
    assert.equal((await cli(bf, ['runtime', 'resolve', codex.id], sid)).target.runtimeId, codex.id);
    check('space-local governance blocks owner and shared users; other spaces stay usable and detach/reattach cannot revive grants or clear blocks');

    socket = io(base + '/cli', { auth: { token: original.active.token, machineId }, transports: ['websocket'], forceNew: true, reconnection: false });
    await new Promise<void>((resolve, reject) => { socket!.once('connect', resolve); socket!.once('connect_error', reject); });
    let disconnected = false; socket.once('disconnect', () => { disconnected = true; });
    await cli(af, ['machine', 'rotate-credential']);
    await until(async () => disconnected, 'Old machine socket was not revoked', 4000);
    const next = JSON.parse(readFileSync(recordPath, 'utf8')); secrets.push(next.active.token);
    const rejected = await fetch(base + '/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accessToken: original.active.token }) });
    assert.equal(rejected.status, 401); await rejected.arrayBuffer();
    await stopRunner(); await startRunner(recordPath);
    await until(async () => { try { return (await owner.discover(machineId)).tools.every(t => t.toolFound); } catch { return false; } }, 'Runner reconnection after credential rotation');
    assert.equal((await cli(af, ['machine', 'enroll'])).machineId, machineId);
    check('credential rotation closes existing machine sockets; unmodified Runner reconnects using the new saved credential and original machine ID');

    await stopRunner(); await gateway!.close(); gateway = undefined; await startGateway(); await startRunner(recordPath);
    await until(async () => { try { return (await owner.discover(machineId)).tools.every(t => t.toolFound); } catch { return false; } }, 'Runner reconnection after gateway restart');
    const restarted = await cli(bf, ['runtime', 'resolve', codex.id], sid);
    assert.equal(restarted.target.machineId, machineId); assert.equal((await cli(af, ['runtime', 'show', codex.id], sid)).runtime.name, 'Code worker');
    check('gateway/Runner restart retains enrollment, runtime names and sharing; no identity is recreated');

    await stopRunner(); console.log('Waiting for native HAPI machine presence to expire (45 seconds).');
    await until(async () => !(await owner.machine(machineId)).machine.online, 'Native machine offline timeout', 60_000);
    const offline = await cli(bf, ['runtime', 'check', codex.id], sid, 1);
    assert.equal(offline.runtime.inspectionCurrent, false); assert.equal(offline.runtime.eligibility.reason.code, 'machine_offline');
    assert(offline.runtime.version); assert.equal((await cli(af, ['machine', 'list'])).machines.length, 1);
    check('real native heartbeat expiry keeps machine/runtime registration and marks retained observations as historical');
    for (let n = 0; n <= runnerNumber; n++) for (const suffix of ['out', 'err']) {
        const file = join(root, n ? `runner-${n}-${suffix}.log` : `hapi-${suffix}.log`), logs = readFileSync(file, 'utf8');
        for (const secret of secrets) assert(!logs.includes(secret), 'Credential appeared in service logs');
    }
    check('CLI output and service/Runner logs contain no root, identity or machine tokens');
    evidence.success = true;
} catch (error) { evidence.error = error instanceof Error ? error.message : String(error); throw error; }
finally {
    socket?.disconnect(); await stopRunner(); await gateway?.close(); hub?.close(); hapi.kill(); await hapi.exited;
    writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2)); console.log('Evidence: ' + root);
}
