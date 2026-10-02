import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { atomicWrite } from '../src/config';
import { fetchJson } from '../src/hapi';
import { freePort } from '../src/services';
import { HubStore } from '../src/hub/store';
import { createDelegationGateway } from '../src/hub/delegation/gateway';
import { removeFileSmokeData } from './fixtures/native-file-smoke';
import { closeSmoke, removeSmokeSecrets, startSmokeHapi, stopSmokeProcess } from './fixtures/smoke-lifecycle';
import { observeRepository } from '../src/hub/repositories/observation';

mkdirSync('.dev-smoke', { recursive: true });
const root = mkdtempSync(resolve('.dev-smoke/hub-delegation-preparation-')), statePath = join(root, 'state.sqlite');
const nativeBinary = resolve(process.argv[2] ?? 'dist/hapi'), port = await freePort(), targetUrl = `http://127.0.0.1:${port}`;
const rootToken = randomBytes(32).toString('base64url'), key = randomBytes(32), secrets = [rootToken];
const env = { ...process.env };
for (const name of Object.keys(env)) if (name.startsWith('HAPI_') || name.startsWith('RUNWEFT_') || ['CLI_API_TOKEN', 'DB_PATH', 'TELEGRAM_BOT_TOKEN'].includes(name)) delete env[name];
env.CODEX_HOME = join(root, 'codex'); env.CLAUDE_CONFIG_DIR = join(root, 'claude');
for (const path of [env.CODEX_HOME, env.CLAUDE_CONFIG_DIR]) mkdirSync(path, { mode: 0o700 });
const nativeHome = join(root, 'hapi');
let child: ReturnType<typeof Bun.spawn> | undefined;
const processes = new Set<ReturnType<typeof Bun.spawn>>(), secretFiles = new Set<string>([join(nativeHome, 'jwt-secret.json'), join(nativeHome, 'settings.json')]);
const cleanup: Array<() => void | Promise<void>> = [() => removeSmokeSecrets(secretFiles, processes)];
let gateway: Awaited<ReturnType<typeof createDelegationGateway>> | undefined, identities: HubStore | undefined;
const runners: ReturnType<typeof Bun.spawn>[] = [], checks: string[] = [], evidence: any = { root, checks, success: false,
    kind: 'real unchanged HAPI, two isolated Runners, central server selection, owned baseline bytes and remote diagnostic worktrees; no model execution' };
function check(name: string) { checks.push(name); console.log('PASS ' + name); }
async function until<T>(fn: () => Promise<T>, good: (v: T) => boolean, label: string, ms = 40_000): Promise<T> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) { const result = await fn(); if (good(result)) return result; await Bun.sleep(100); }
    throw new Error('Timeout: ' + label);
}
console.log('Evidence directory: ' + root);
try {
    child = await startSmokeHapi(nativeBinary, root, env, port, rootToken, processes); cleanup.push(() => stopSmokeProcess(child!));
    cleanup.push(() => gateway?.close());
    gateway = await createDelegationGateway({ host: '127.0.0.1', port: 0, target: targetUrl, statePath, rootToken, key, pollMs: 30 });
    const base = `http://127.0.0.1:${(gateway.server.address() as { port: number }).port}`;
    identities = new HubStore(statePath); cleanup.push(() => identities?.close());
    const a = identities.createIdentity('Runner owner'), b = identities.createIdentity('task owner'), sid = a.personalSpace.id;
    secrets.push(a.token, b.token); identities.acceptInvitation(b.identity.id, identities.invite(a.identity.id, sid, 'member').token);
    const actorA = gateway.store.authenticate(a.token, sid), actorB = gateway.store.authenticate(b.token, sid), resources = gateway.resources.store;
    const machineTokens = [0, 1].map(() => `rw_mc_${randomBytes(32).toString('base64url')}`); secrets.push(...machineTokens);
    const machines = [actorA, actorB].map((actor, i) => {
        const registered = resources.enroll(actor, { requestId: randomUUID(), token: machineTokens[i] });
        resources.associate(actor, registered.machineId, sid, true);
        const runnerHome = join(root, `runner-${i}`);
        secretFiles.add(join(runnerHome, 'settings.json'));
        atomicWrite(join(runnerHome, 'settings.json'), JSON.stringify({ machineId: registered.machineId, cliApiToken: machineTokens[i] }));
        runners.push(Bun.spawn([nativeBinary, 'runner', 'start-sync'], { env: { ...env, HAPI_HOME: runnerHome, HAPI_API_URL: base, CLI_API_TOKEN: machineTokens[i], HAPI_DISABLE_VERSION_HANDOFF: '1' },
            stdout: Bun.file(join(root, `runner-${i}-out.log`)), stderr: Bun.file(join(root, `runner-${i}-err.log`)) }));
        const runner = runners.at(-1)!; processes.add(runner); cleanup.push(() => stopSmokeProcess(runner));
        return registered.machineId;
    });
    const aj = (await gateway.authority.exchange(a.token, sid)).token, bj = (await gateway.authority.exchange(b.token, sid)).token;
    const http = (token: string, path: string, body?: unknown) => fetchJson(base + path, { headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
    await until(async () => {
        runners.forEach(runner => assert.equal(runner.exitCode, null));
        const one = await http(aj, '/api/runweft/resources/machines'), two = await http(bj, '/api/runweft/resources/machines');
        return one.machines.some((m: any) => m.id === machines[0] && m.online) && two.machines.some((m: any) => m.id === machines[1] && m.online);
    }, Boolean, 'two Runners');
    const runtime = (await http(aj, '/api/runweft/resources/runtimes', { machineId: machines[0], flavor: 'codex' })).runtime;
    resources.share(actorA, runtime.id, sid, true);
    const repo = join(root, 'project'); mkdirSync(repo);
    const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
    git('init', '-q'); git('config', 'user.name', 'Preparation smoke'); git('config', 'user.email', 'smoke@example.invalid'); git('config', 'commit.gpgsign', 'false');
    writeFileSync(join(repo, 'baseline.txt'), 'central baseline bytes\n'); git('add', '.'); git('commit', '-qm', 'fixture');
    const observed = observeRepository(repo), repository = gateway.repositories.create(actorB, { requestId: randomUUID(), name: 'Smoke project' });
    gateway.repositories.bind(actorB, { machineId: machines[1], observation: observed, repositoryId: repository.id });
    const agent = gateway.agents.create(actorB, { requestId: randomUUID(), definition: { name: 'Remote reviewer', repositoryId: repository.id, runtimeId: runtime.id } });
    const parent = { kind: 'cli', machineId: machines[1], cwd: repo }, intent = { agentId: agent.id, observation: observed, baseRef: 'HEAD' };
    const request = { parent, requestId: randomUUID(), intent };
    const accepted = (await http(bj, '/api/runweft/workspaces/prepare', request)).preparation;
    assert.equal(accepted.agent.hub.agentId, agent.id); assert.equal(accepted.agent.hub.actorId, b.identity.id);
    assert.equal((await http(bj, '/api/runweft/workspaces/prepare', request)).preparation.id, accepted.id);
    check('server resolves owned repository Agent and shared runtime; replay returns the same independent preparation');
    const ready = await until(async () => {
        const current = (await http(bj, '/api/runweft/workspaces/inspect', { parent, id: accepted.id })).preparation;
        if (current.phase === 'failed') throw new Error(JSON.stringify(current.error)); return current;
    }, p => p.phase === 'ready', 'baseline export, transfer, import and worktree');
    assert.notEqual(ready.workspace.cwd, repo); assert.equal(readFileSync(join(ready.workspace.cwd, 'baseline.txt'), 'utf8'), 'central baseline bytes\n');
    assert.equal(ready.nativeExecution, 'not_started'); assert.equal(gateway.delegation.coordinator.store.listNamespace(gateway.delegation.scopes.ensure(actorB)).length, 0);
    check('two real Runners export/import the committed baseline and prepare the isolated worktree before any agent session');
    const snapshot = gateway.delegation.preparations.store.snapshot(ready.snapshot.id);
    assert(snapshot.files?.length); assert(snapshot.files.every(file => file.artifactId && file.pinned));
    for (const file of snapshot.files) {
        assert.equal(gateway.store.object('artifact', file.artifactId!)?.ownerId, b.identity.id);
        for (const token of machineTokens) assert.equal(gateway.store.can(gateway.store.authenticate(token), 'artifact', file.artifactId!), false);
        await assert.rejects(() => http(aj, `/api/artifacts/${file.artifactId}`), { status: 404 });
    }
    await assert.rejects(() => http(aj, '/api/runweft/workspaces/inspect', { parent, id: accepted.id }), { status: 404 });
    check('published baseline files and preparation are private to caller; per-transfer grants are released for both machines');
    const second = (await http(bj, '/api/runweft/workspaces/prepare', { ...request, requestId: randomUUID() })).preparation;
    const again = await until(async () => (await http(bj, '/api/runweft/workspaces/inspect', { parent, id: second.id })).preparation, p => p.phase === 'ready', 'reuse');
    assert.equal(again.snapshot.id, ready.snapshot.id); assert.notEqual(again.workspace.cwd, ready.workspace.cwd);
    assert.equal(again.transfer.snapshotReused, true);
    check('same owned scope reuses the fixed baseline while every diagnostic retains its own worktree');
    resources.share(actorA, runtime.id, sid, false);
    await assert.rejects(() => http(bj, '/api/runweft/workspaces/prepare', { ...request, requestId: randomUUID() }), { code: 'runtime_private' });
    assert.equal((await http(bj, '/api/runweft/workspaces/inspect', { parent, id: accepted.id })).preparation.phase, 'ready');
    for (const name of ['hapi-out.log', 'hapi-err.log', 'runner-0-out.log', 'runner-0-err.log', 'runner-1-out.log', 'runner-1-err.log']) {
        const log = readFileSync(join(root, name), 'utf8'); for (const value of secrets) assert(!log.includes(value), 'Credential appeared in service log');
    }
    check('share revocation prevents new preparation, retained records remain readable, and service logs contain no credentials');
    evidence.candidate = { entry: 'source gateway + explicit HAPI binary', nativeBinary, hapiSha256: createHash('sha256').update(readFileSync(nativeBinary)).digest('hex'), revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() };
    evidence.success = true;
} catch (error) { evidence.error = error instanceof Error ? error.message : String(error); throw error; }
finally {
    try { await closeSmoke(cleanup); if (evidence.success) await removeFileSmokeData(root); } catch (error) { evidence.success = false; evidence.cleanupErrors = error instanceof AggregateError ? error.errors.map(String) : [String(error)]; process.exitCode = 1; }
    writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2)); console.log('Evidence: ' + root);
}
