import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { installedBinaries } from './fixtures/installed-binaries.mjs';

const executable = resolve(process.argv[2] ?? 'dist/runweft');
const parent = resolve(process.env.RUNWEFT_SMOKE_ROOT ?? '.dev-smoke');
mkdirSync(parent, { recursive: true });
const root = mkdtempSync(join(parent, 'service-'));
const home = join(root, 'host'), remote = join(root, 'client'), sentinel = join(root, 'must-not-be-used');
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_') || key.startsWith('HAPI_') || ['CLI_API_TOKEN', 'DB_PATH', 'TELEGRAM_BOT_TOKEN'].includes(key)) delete env[key];
Object.assign(env, { HAPI_HOME: sentinel, DB_PATH: join(sentinel, 'hapi.db'), CLI_API_TOKEN: 'unused-smoke-value',
    HAPI_API_URL: 'http://127.0.0.1:1', HAPI_LISTEN_PORT: '1', CODEX_HOME: join(root, 'codex'), CLAUDE_CONFIG_DIR: join(root, 'claude') });
const evidence = { root, executable, binaries: installedBinaries(executable), platform: process.platform, architecture: process.arch,
    scope: 'installed CLI with adjacent HAPI; public identity API and explicit connection-file fixture; no models or browser', checks: [], success: false, cleanupErrors: [] };
const secrets = [];
let foreground;
function run(directory, args, options = {}) {
    const result = spawnSync(executable, ['--home', directory, ...(options.raw ? [] : ['--json']), ...args], {
        env, encoding: 'utf8', timeout: 65_000, cwd: root,
    });
    const stdout = result.stdout ?? '', stderr = result.stderr ?? '';
    for (const secret of secrets) assert(!(stdout + stderr).includes(secret), 'Credential leaked by CLI');
    if (options.failure) {
        assert.notEqual(result.status, 0);
        const error = JSON.parse(stderr).error; assert.equal(error.code, options.failure); return error;
    }
    assert.equal(result.status, options.exitCode ?? 0, `${args.join(' ')}: ${stderr || result.error || result.signal}`);
    return options.raw ? stdout : JSON.parse(stdout);
}
function record(name) { evidence.checks.push(name); console.log(`PASS ${name}`); }
async function freePort() {
    const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
async function request(url, body, token) {
    const response = await fetch(url, { method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(5000),
        headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() };
}
async function until(check) {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 150)); }
    throw new Error('Service condition did not become true');
}
async function down(url) { try { await fetch(url, { signal: AbortSignal.timeout(500) }); return false; } catch { return true; } }
function connect(directory, url, user) {
    run(directory, ['config', 'set', 'hub.url', url]);
    const paths = run(directory, ['paths']);
    mkdirSync(dirname(paths.identityConnection), { recursive: true, mode: 0o700 });
    writeFileSync(paths.identityConnection, JSON.stringify({ schemaVersion: 1, hub: url, ownerId: user.identity.id,
        spaceId: user.personalSpace.id, token: user.token, requestId: randomUUID(), createdAt: Date.now() }), { mode: 0o600 });
    return paths;
}
try {
    assert(run(home, ['init']).created);
    const port = await freePort(), url = `http://127.0.0.1:${port}`;
    run(home, ['config', 'set', 'server.port', String(port)]);
    const started = run(home, ['start']), paths = run(home, ['paths']);
    assert(started.service.running); assert(!started.runner.running); assert(!started.connection.connected);
    const state = JSON.parse(readFileSync(paths.process, 'utf8'));
    assert(run(home, ['start']).service.running); assert.equal(JSON.parse(readFileSync(paths.process, 'utf8')).pid, state.pid);
    run(home, ['task', 'list'], { failure: 'hub_connection_required' });
    assert.equal(run(home, ['data', 'reset']).applied, false);
    run(home, ['data', 'reset', '--apply'], { failure: 'reset_service_running' });
    const rootToken = JSON.parse(readFileSync(join(paths.hapiServer, 'settings.json'), 'utf8')).cliApiToken; secrets.push(rootToken);
    assert.equal((await request(url + '/api/auth', { accessToken: rootToken })).status, 401);
    assert.notEqual((await fetch(url + '/runweft/')).status, 200);
    assert.equal(run(home, ['open', '--print']).url, url + '/hub');
    assert((await (await fetch(url + '/hub')).text()).includes('console-navigation'));
    assert.equal((await fetch(url + '/api/runweft/tasks/overview')).status, 401);
    assert(!existsSync(sentinel));
    record('default Hub has no implicit user or Runner; root and old routes rejected; running reset refuses before deletion');

    const created = await request(url + '/api/runweft/hub/identities', { name: 'installed service' });
    assert.equal(created.status, 201); const user = created.body; secrets.push(user.token);
    const localPaths = connect(home, url, user);
    run(home, ['runner', 'start'], { failure: 'machine_enrollment_required' });
    const machine = run(home, ['machine', 'enroll']);
    assert.equal(run(home, ['machine', 'enroll']).machineId, machine.machineId);
    run(home, ['machine', 'associate', machine.machineId, user.personalSpace.id]);
    assert(run(home, ['runner', 'start']).online);
    assert.equal(run(home, ['runtime', 'list']).runtimes.length, 0);
    assert.equal(run(home, ['agent', 'list']).agents.length, 0);
    const diagnosis = run(home, ['doctor']); assert(diagnosis.ok); assert.equal(diagnosis.modelAuthentication, 'not_checked');
    assert(diagnosis.ignoredEnvironment.includes('HAPI_HOME')); assert(!existsSync(localPaths.taskWorkspaces));
    assert.match(run(home, ['hapi', '--version'], { raw: true }), /0\.30\.7/);
    const jwt = (await request(url + '/api/auth', { accessToken: user.token, spaceId: user.personalSpace.id })).body.token;
    assert.deepEqual((await request(url + '/api/runweft/tasks/overview', undefined, jwt)).body.items, []);
    record('public identity and explicit machine enrollment are independent; adjacent HAPI Runner and scoped task read work without model tools');

    run(remote, ['init', '--url', url]); const remotePaths = connect(remote, url, user);
    const second = run(remote, ['machine', 'enroll']); assert.notEqual(second.machineId, machine.machineId);
    run(remote, ['machine', 'associate', second.machineId, user.personalSpace.id]);
    assert(run(remote, ['start']).runner.online); assert(run(remote, ['doctor']).ok);
    assert.notEqual(remotePaths.hapiClient, localPaths.hapiClient);
    run(remote, ['stop']); assert(run(home, ['status']).service.running);
    const identityBytes = readFileSync(localPaths.identityConnection), machineBytes = readFileSync(localPaths.machineConnection);
    for (const directory of [localPaths.taskWorkspaces, localPaths.artifactTransfers, paths.backups]) mkdirSync(directory, { recursive: true });
    writeFileSync(join(localPaths.taskWorkspaces, 'retained.txt'), 'KEEP_WORKTREE');
    writeFileSync(join(localPaths.artifactTransfers, 'pending.txt'), 'KEEP_PENDING');
    writeFileSync(join(paths.backups, 'keep.txt'), 'KEEP_BACKUP');
    run(home, ['stop']); run(home, ['config', 'set', 'server.runner', 'true']);
    assert(run(home, ['start']).runner.online);
    assert.deepEqual(readFileSync(localPaths.identityConnection), identityBytes);
    assert.deepEqual(readFileSync(localPaths.machineConnection), machineBytes);
    assert.equal(JSON.parse(readFileSync(join(localPaths.hapiClient, 'runner.state.json'), 'utf8')).startedWithVersionHandoffDisabled, true);
    record('independent Hub client and supervised Runner restart preserve identity, machine credentials and retained data');

    const finalState = JSON.parse(readFileSync(paths.process, 'utf8'));
    process.kill(finalState.pid, 'SIGTERM');
    await until(async () => !existsSync(paths.process) && await down(url + '/health') && await down(`http://127.0.0.1:${finalState.hapiPort}/health`));
    run(home, ['stop']); assert(!run(home, ['status']).service.running);
    for (const name of readdirSync(paths.logs)) for (const secret of secrets) assert(!readFileSync(join(paths.logs, name), 'utf8').includes(secret));
    run(home, ['serve', '--public'], { failure: 'public_url_missing' });
    run(home, ['config', 'set', 'server.runner', 'false']); run(home, ['config', 'set', 'server.publicUrl', url]);
    foreground = spawn(executable, ['--home', home, 'serve', '--public'], { env, cwd: root, stdio: 'ignore' });
    await until(async () => {
        assert.equal(foreground.exitCode, null, 'foreground Hub exited');
        try { return (await request(url + '/api/runweft/health')).body.role === 'hub-server'; } catch { return false; }
    });
    assert(run(home, ['doctor']).ok);
    foreground.kill('SIGTERM');
    await until(async () => !existsSync(paths.process) && await down(url + '/health'));
    record('SIGTERM closes owned private/public services and launcher forwards foreground signals without credential logs');

    assert(run(home, ['data', 'reset', '--apply']).applied);
    assert.equal(readFileSync(join(localPaths.taskWorkspaces, 'retained.txt'), 'utf8'), 'KEEP_WORKTREE');
    assert.equal(readFileSync(join(localPaths.artifactTransfers, 'pending.txt'), 'utf8'), 'KEEP_PENDING');
    assert.equal(readFileSync(join(paths.backups, 'keep.txt'), 'utf8'), 'KEEP_BACKUP');
    assert(!existsSync(localPaths.identityConnection)); assert(!existsSync(localPaths.machineConnection));
    run(home, ['init']); run(home, ['config', 'set', 'server.port', String(port)]); run(home, ['start']);
    assert.equal((await request(url + '/api/auth', { accessToken: user.token })).status, 401);
    const fresh = (await request(url + '/api/runweft/hub/identities', { name: 'fresh after reset' })).body; secrets.push(fresh.token);
    assert.notEqual(fresh.identity.id, user.identity.id); connect(home, url, fresh);
    assert.notEqual(run(home, ['machine', 'enroll']).machineId, machine.machineId);
    record('explicit stopped reset preserves worktrees, pending transfers and backups; old identity is rejected and fresh enrollment works');
    evidence.success = true;
} catch (error) { evidence.error = error.message; throw error; }
finally {
    if (foreground && foreground.exitCode === null && foreground.signalCode === null) foreground.kill('SIGTERM');
    for (const directory of [remote, home]) if (existsSync(join(directory, 'config.yaml'))) {
        try { run(directory, ['stop']); } catch (error) { evidence.cleanupErrors.push(error.message); }
    }
    if (evidence.cleanupErrors.length) { evidence.success = false; process.exitCode = 1; }
    writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(`Evidence: ${join(root, 'evidence.json')}`);
}
