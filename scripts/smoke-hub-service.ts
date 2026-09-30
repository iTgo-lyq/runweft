import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { atomicWrite } from '../src/config';
import { freePort } from '../src/services';
import { hubConnectionPaths } from '../src/hub/resources/connection';
import { installedBinaries } from './fixtures/installed-binaries.mjs';

mkdirSync('.dev-smoke', { recursive: true });
const root = mkdtempSync(resolve('.dev-smoke/hub-service-')), home = join(root, 'host'), remote = join(root, 'client');
const binary = resolve(process.argv[2] ?? 'dist/runweft');
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('HAPI_') || key.startsWith('RUNWEFT_') || ['CLI_API_TOKEN','DB_PATH','TELEGRAM_BOT_TOKEN'].includes(key)) delete env[key];
const secrets: string[] = [], evidence: any = { root, binaries: installedBinaries(binary), checks: [], success: false, cleanupErrors: [] };
const port = await freePort(), url = `http://127.0.0.1:${port}`;
async function cli(directory: string, args: string[], failure?: string) {
    const child = Bun.spawn([binary, '--home', directory, '--json', ...args], { env, stdout: 'pipe', stderr: 'pipe' });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    for (const secret of secrets) assert(!(stdout + stderr).includes(secret), 'Secret appeared in CLI output');
    if (failure) { assert.notEqual(code, 0); const error = JSON.parse(stderr).error; assert.equal(error.code, failure); return error; }
    assert.equal(code, 0, args.join(' ') + ': ' + stderr); return JSON.parse(stdout);
}
async function json(path: string, body: object) {
    const response = await fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert(response.ok, `${path}: ${response.status}`); return response.json() as any;
}
function check(name: string) { evidence.checks.push(name); console.log('PASS ' + name); }
console.log('Evidence directory: ' + root);
try {
    await cli(home, ['init']); await cli(home, ['config', 'set', 'server.port', String(port)]);
    const initial = await cli(home, ['start']); assert(initial.service.running); assert(!initial.runner.running); assert(!initial.connection.connected);
    await cli(home, ['task', 'list'], 'hub_connection_required');
    await cli(home, ['data', 'reset', '--apply'], 'reset_service_running');
    const paths = await cli(home, ['paths']), state = JSON.parse(readFileSync(paths.process, 'utf8'));
    assert.equal((await cli(home, ['start'])).service.running, true); assert.equal(JSON.parse(readFileSync(paths.process, 'utf8')).pid, state.pid);
    const rootToken = JSON.parse(readFileSync(join(paths.hapiServer, 'settings.json'), 'utf8')).cliApiToken; secrets.push(rootToken);
    assert.equal((await fetch(url + '/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accessToken: rootToken }) })).status, 401);
    assert.notEqual((await fetch(url + '/api/runweft/identity', { headers: { authorization: `Bearer ${rootToken}` } })).status, 200);
    assert.notEqual((await fetch(url + '/runweft/')).status, 200);
    assert.equal((await cli(home, ['open', '--print'])).url, url + '/hub');
    check('default Hub starts without user or machine privileges; root credential and old routes rejected');
    const user = await json('/api/runweft/hub/identities', { name: 'service smoke' }); secrets.push(user.token);
    const space = user.personalSpace.id;
    for (const directory of [home, remote]) {
        if (directory === remote) await cli(directory, ['init', '--url', url]); else await cli(directory, ['config', 'set', 'hub.url', url]);
        atomicWrite(hubConnectionPaths(directory, url).identityConnection, JSON.stringify({ schemaVersion: 1, hub: url, ownerId: user.identity.id,
            spaceId: space, token: user.token, requestId: randomUUID(), createdAt: Date.now() }));
        await cli(directory, ['runner', 'start'], 'machine_enrollment_required');
        const record = await cli(directory, ['machine', 'enroll', '--name', directory === home ? 'host' : 'client']);
        secrets.push(JSON.parse(readFileSync(record.credentialFile, 'utf8')).active.token);
        assert.equal((await cli(directory, ['runtime', 'list'])).runtimes.length, 0);
        assert.equal((await cli(directory, ['agent', 'list'])).agents.length, 0);
        await cli(directory, ['machine', 'associate', record.machineId, space]);
        const online = await cli(directory, directory === home ? ['runner', 'start'] : ['start']);
        assert(directory === home ? online.online : online.runner.online);
        assert((await cli(directory, ['doctor'])).ok);
    }
    const localPaths = await cli(home, ['paths']), remotePaths = await cli(remote, ['paths']);
    assert.equal(localPaths.hapiClient.slice(home.length), remotePaths.hapiClient.slice(remote.length));
    assert.equal((await cli(home, ['status'])).connection.ownerId, user.identity.id);
    check('same Hub connection contract in local and hub modes; explicit machine enrollment does not create runtime or Agent');
    const enrolled = JSON.parse(readFileSync(localPaths.machineConnection, 'utf8'));
    await cli(home, ['machine', 'revoke-credential', enrolled.machineId]);
    await cli(home, ['runner', 'stop']);
    await cli(home, ['runner', 'start'], 'identity_token_invalid');
    await cli(home, ['machine', 'rotate-credential']);
    secrets.push(JSON.parse(readFileSync(localPaths.machineConnection, 'utf8')).active.token);
    assert((await cli(home, ['runner', 'start'])).online);
    check('revoked machine credential cannot restart; explicit rotation resumes same machine');
    await cli(home, ['stop']); assert(!(await cli(home, ['status'])).service.running);
    await cli(home, ['config', 'set', 'server.runner', 'true']);
    const restart = await cli(home, ['start']); assert(restart.runner.online); assert(restart.connection.connected);
    assert.equal(JSON.parse(readFileSync(join(localPaths.hapiClient, 'runner.state.json'), 'utf8')).startedWithVersionHandoffDisabled, true);
    check('explicit enrolled Runner supervision survives Hub restart; identity and machine remain stable');
    await cli(remote, ['stop']); await cli(home, ['stop']);
    const retained = join(localPaths.taskWorkspaces, 'retained-fixture', 'checkout', 'keep.txt'); atomicWrite(retained, 'KEEP');
    assert((await cli(home, ['data', 'reset', '--apply'])).applied); assert.equal(readFileSync(retained, 'utf8'), 'KEEP');
    await cli(home, ['init']); await cli(home, ['config', 'set', 'server.port', String(port)]);
    assert((await cli(home, ['start'])).service.running);
    assert.equal((await fetch(url + '/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accessToken: user.token }) })).status, 401);
    const fresh = await json('/api/runweft/hub/identities', { name: 'after reset' }); secrets.push(fresh.token);
    assert.notEqual(fresh.identity.id, user.identity.id);
    await cli(home, ['config', 'set', 'hub.url', url]);
    atomicWrite(hubConnectionPaths(home, url).identityConnection, JSON.stringify({ schemaVersion: 1, hub: url, ownerId: fresh.identity.id,
        spaceId: fresh.personalSpace.id, token: fresh.token, requestId: randomUUID(), createdAt: Date.now() }));
    const freshMachine = await cli(home, ['machine', 'enroll']); assert.notEqual(freshMachine.machineId, enrolled.machineId);
    secrets.push(JSON.parse(readFileSync(freshMachine.credentialFile, 'utf8')).active.token);
    assert((await cli(home, ['runner', 'start'])).online);
    check('stopped prerelease reset preserves worktree bytes; fresh Hub rejects old identity and registers a new machine');
    evidence.success = true;
} catch (error) { evidence.error = error instanceof Error ? error.message : String(error); throw error; }
finally {
    for (const directory of [remote, home]) {
        if (!existsSync(join(directory, 'config.yaml'))) continue;
        try { await cli(directory, ['stop']); } catch (error) { evidence.cleanupErrors.push(String(error)); }
    }
    if (evidence.cleanupErrors.length) { evidence.success = false; process.exitCode = 1; }
    writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
}
