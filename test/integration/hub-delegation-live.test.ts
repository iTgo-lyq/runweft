import { createTestIdentity } from '../identity-fixture';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { atomicWrite } from '../../src/config';
import { fetchJson, fetchResponse, type HapiHttp } from '../../src/hapi';
import { freePort } from '../../src/services';
import { HubStore } from '../../src/hub/store';
import { createDelegationGateway } from '../../src/hub/delegation/gateway';
import { observeRepository } from '../../src/hub/repositories/observation';
import { removeFileSmokeData } from './native-files';
import { closeSmoke, removeSmokeSecrets, startSmokeHapi, stopSmokeProcess } from '../lifecycle';
import { ArtifactClient } from '../../src/artifacts/client';
import { ExecutionClient } from '../../src/execution';
import { afterEach, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { rmSync as removeRoot } from 'node:fs';
import { integrationBinaries } from './binaries';

let closeOwned: () => Promise<void> = async () => {};
afterEach(() => closeOwned());

test('hub-delegation-live real integration', async () => {
    integrationBinaries();
    const root = mkdtempSync(join(tmpdir(), 'runweft-hub-delegation-native-')), statePath = join(root, 'state.sqlite');
    const nativeBinary = integrationBinaries().hapi.path, port = await freePort(), targetUrl = `http://127.0.0.1:${port}`;
    const rootToken = randomBytes(32).toString('base64url'), key = randomBytes(32), secrets = [rootToken];
    const env = { ...process.env };
    for (const name of Object.keys(env)) if (name.startsWith('HAPI_') || name.startsWith('RUNWEFT_') || ['CLI_API_TOKEN', 'DB_PATH', 'TELEGRAM_BOT_TOKEN'].includes(name)) delete env[name];
    env.CODEX_HOME = join(root, 'codex'); env.CLAUDE_CONFIG_DIR = join(root, 'claude');
    for (const path of [env.CODEX_HOME, env.CLAUDE_CONFIG_DIR]) mkdirSync(path, { mode: 0o700 });
    env.HAPI_CLAUDE_PATH = Bun.which('claude') ?? undefined;
    const nativeHome = join(root, 'hapi'), runnerHome = join(root, 'runner');
    let child: ReturnType<typeof Bun.spawn> | undefined, sourceRunner: typeof child;
    const processes = new Set<ReturnType<typeof Bun.spawn>>(), secretFiles = new Set<string>([join(nativeHome, 'jwt-secret.json'), join(nativeHome, 'settings.json'), join(runnerHome, 'settings.json')]);
    const cleanup: Array<() => void | Promise<void>> = [() => removeSmokeSecrets(secretFiles, processes)];
    let gateway: Awaited<ReturnType<typeof createDelegationGateway>> | undefined, identities: HubStore | undefined, runner: ReturnType<typeof Bun.spawn> | undefined;
    const checks: string[] = [], evidence: any = { root, nativeBinary, checks, success: false,
        kind: 'real unchanged HAPI and Runner, real Git/worktree and input/output bytes; invalid-preparation spawn rejection, no model execution' };
    function check(name: string) { checks.push(name); console.log('PASS ' + name); }
    async function until<T>(fn: () => Promise<T>, good: (v: T) => boolean, label: string, ms = 30_000): Promise<T> {
        const deadline = Date.now() + ms;
        while (Date.now() < deadline) { const result = await fn(); if (good(result)) return result; await Bun.sleep(100); }
        throw new Error('Timeout: ' + label);
    }
    const json = (body: object) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    console.log('Evidence directory: ' + root);

    let closing: Promise<void> | undefined;
    closeOwned = () => closing ??= (async () => {
        try { await closeSmoke(cleanup); if (evidence.success) await removeFileSmokeData(root); } catch (error) { evidence.success = false; evidence.cleanupErrors = error instanceof AggregateError ? error.errors.map(String) : [String(error)];  }
        writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2)); console.log('Evidence: ' + root);

        if (evidence.cleanupErrors?.length) throw new AggregateError(evidence.cleanupErrors, 'Integration cleanup failed');
        if (evidence.success) removeRoot(root, { recursive: true, force: true });
    })();
    try {
        child = await startSmokeHapi(nativeBinary, root, env, port, rootToken, processes); cleanup.push(() => stopSmokeProcess(child!));
        cleanup.push(() => gateway?.close());
        gateway = await createDelegationGateway({ host: '127.0.0.1', port: 0, target: targetUrl, statePath, rootToken, key });
        await gateway.delegation.coordinator.close();
        const base = `http://127.0.0.1:${(gateway.server.address() as { port: number }).port}`;
        identities = new HubStore(statePath); cleanup.push(() => identities?.close());
        const a = createTestIdentity(identities, 'Runner owner'), b = createTestIdentity(identities, 'task owner'), sid = a.personalSpace.id;
        secrets.push(a.token, b.token); identities.acceptInvitation(b.identity.id, identities.invite(a.identity.id, sid, 'member').token);
        const actorA = gateway.store.authenticate(a.token, sid), actorB = gateway.store.authenticate(b.token, sid), resources = gateway.resources.store;
        const machineToken = `rw_mc_${randomBytes(32).toString('base64url')}`; secrets.push(machineToken);
        const target = resources.enroll(actorA, { requestId: randomUUID(), token: machineToken });
        const sourceToken = `rw_mc_${randomBytes(32).toString('base64url')}`; secrets.push(sourceToken);
        const source = resources.enroll(actorB, { requestId: randomUUID(), token: sourceToken });
        resources.associate(actorA, target.machineId, sid, true); resources.associate(actorB, source.machineId, sid, true);
        atomicWrite(join(runnerHome, 'settings.json'), JSON.stringify({ machineId: target.machineId, cliApiToken: machineToken }));
        runner = Bun.spawn([nativeBinary, 'runner', 'start-sync'], { env: { ...env, HAPI_HOME: runnerHome, HAPI_API_URL: base, CLI_API_TOKEN: machineToken, HAPI_DISABLE_VERSION_HANDOFF: '1' },
            stdout: Bun.file(join(root, 'runner-out.log')), stderr: Bun.file(join(root, 'runner-err.log')) });
        processes.add(runner); cleanup.push(() => stopSmokeProcess(runner!));
        const sourceHome = join(root, 'source-runner'); secretFiles.add(join(sourceHome, 'settings.json'));
        atomicWrite(join(sourceHome, 'settings.json'), JSON.stringify({ machineId: source.machineId, cliApiToken: sourceToken }));
        sourceRunner = Bun.spawn([nativeBinary, 'runner', 'start-sync'], { env: { ...env, HAPI_HOME: sourceHome, HAPI_API_URL: base, CLI_API_TOKEN: sourceToken, HAPI_DISABLE_VERSION_HANDOFF: '1' }, stdout: Bun.file(join(root, 'source-runner-out.log')), stderr: Bun.file(join(root, 'source-runner-err.log')) });
        processes.add(sourceRunner); cleanup.push(() => stopSmokeProcess(sourceRunner!));
        const aj = (await gateway.authority.exchange(a.token, sid)).token, bj = (await gateway.authority.exchange(b.token, sid)).token;
        const http = (token: string): HapiHttp => ({ request: (path, options = {}) => fetchJson(base + path, { ...options, headers: { ...Object.fromEntries(new Headers(options.headers)), authorization: `Bearer ${token}` } }),
            response: (path, options = {}) => fetchResponse(base + path, { ...options, headers: { ...Object.fromEntries(new Headers(options.headers)), authorization: `Bearer ${token}` } }) });
        const owner = http(aj), caller = http(bj);
        await until(async () => {
            assert.equal(runner!.exitCode, null);
            return (await owner.request('/api/runweft/resources/machines')).machines.find((m: any) => m.id === target.machineId)?.online;
        }, Boolean, 'Runner connection');
        const runtime = (await owner.request('/api/runweft/resources/runtimes', json({ machineId: target.machineId, flavor: 'codex' }))).runtime;
        resources.share(actorA, runtime.id, sid, true);
        const repo = join(root, 'repo'); mkdirSync(repo);
        const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', env: { ...env, GIT_CONFIG_NOSYSTEM: '1' } }).trim();
        git('init', '-q'); git('config', 'user.name', 'Bridge Smoke'); git('config', 'user.email', 'smoke@example.invalid'); git('config', 'commit.gpgsign', 'false');
        writeFileSync(join(repo, 'base.txt'), 'base\n'); git('add', '.'); git('commit', '-qm', 'fixture');
        const observation = observeRepository(repo), repository = gateway.repositories.create(actorB, { requestId: randomUUID(), name: 'Native bridge project' });
        gateway.repositories.bind(actorB, { machineId: source.machineId, observation, repositoryId: repository.id });
        const agent = gateway.agents.create(actorB, { requestId: randomUUID(), definition: { name: 'Bridge probe', repositoryId: repository.id, runtimeId: runtime.id } });
        const parent = { kind: 'cli' as const, machineId: source.machineId, cwd: repo };
        const acceptedPreparation = (await caller.request('/api/runweft/workspaces/prepare', json({ parent, requestId: randomUUID(), intent: { agentId: agent.id, observation, baseRef: 'HEAD' } }))).preparation;
        const prepared = await until(async () => {
            const p = (await caller.request('/api/runweft/workspaces/inspect', json({ parent, id: acceptedPreparation.id }))).preparation;
            if (p.phase === 'failed') throw new Error(JSON.stringify(p.error)); return p;
        }, p => p.phase === 'ready', 'current central snapshot and source baseline');
        const namespace = gateway.delegation.scopes.ensure(actorB), store = gateway.delegation.coordinator.store;
        const accepted = store.accept(namespace, parent, randomUUID(), { agentType: agent.id, message: 'Low-level native bridge fixture', workspaceMode: 'worktree', baseRef: 'HEAD' }, prepared.agent, prepared.agent.hub.target, prepared.origin);
        const { task, rounds, inputs } = store.require(namespace, accepted.agent_id), round = rounds[0];
        round.phase = 'finished'; round.finish = 'complete'; round.executionAbsent = true; round.completedAt = Date.now(); store.save(task, round, inputs);
        const taskId = task.id, roundId = round.id, native = gateway.delegation.taskClient(task, round);
        const prefix = `/api/machines/${target.machineId}`;
        await assert.rejects(() => caller.request(prefix + '/workspaces', json({ action: 'resolve', cwd: root })), { status: 404 });
        check('real shared runtime is usable through the trusted adapter; public caller has no machine workspace API');

        const uploadPath = join(root, 'input.txt'); writeFileSync(uploadPath, 'owned by task caller\n');
        const artifacts = new ArtifactClient(caller), input = await artifacts.upload(uploadPath, randomUUID());
        const materialize = { action: 'materialize', operationId: randomUUID(), files: [{ artifactId: input.id, name: input.filename, size: input.size, sha256: input.sha256 }] };
        await native.request(prefix + '/artifacts', json(materialize));
        const transfer = async (operationId: string) => (await native.request(prefix + '/artifacts', json({ action: 'inspect', operationId }))).operation;
        const materialized = await until(() => transfer(materialize.operationId), o => ['succeeded', 'failed'].includes(o.status), 'materialize');
        assert.equal(materialized.status, 'succeeded', JSON.stringify(materialized.error));
        assert.equal(readFileSync(materialized.files[0].path, 'utf8'), readFileSync(uploadPath, 'utf8'));
        assert.equal(gateway.store.can(gateway.store.authenticate(machineToken), 'artifact', input.id), false);
        await assert.rejects(() => owner.request(`/api/artifacts/${input.id}`), { status: 404 });
        check('real Runner downloads only assigned input bytes; completion revokes read authority and machine owner user cannot read');

        const resolved = (await native.request(prefix + '/workspaces', json({ action: 'resolve', cwd: repo, baseRef: 'HEAD' }))).source;
        const prepare = { action: 'prepare', environmentId: taskId, preparationId: randomUUID(), roundId, source: resolved, expectedHead: resolved.baseCommit,
            inputs: materialized.files.map(({ artifactId, ...file }: any) => file) };
        await native.request(prefix + '/workspaces', json(prepare));
        const workspace = await until(async () => (await native.request(prefix + '/workspaces', json({ action: 'inspect', environmentId: taskId }))).workspace,
            w => !!w.preparations[prepare.preparationId], 'prepared worktree');
        assert.notEqual(workspace.cwd, repo); assert.equal(readFileSync(join(workspace.cwd, 'base.txt'), 'utf8'), 'base\n');
        assert.equal(workspace.preparations[prepare.preparationId].inputs.length, 1);
        check('unmodified Runner creates the actual isolated Git worktree and stages input before any child session');

        const outputPath = join(workspace.cwd, 'report.txt'); writeFileSync(outputPath, 'fixed output\n');
        const capture = { action: 'capture', operationId: randomUUID(), cwd: workspace.cwd, files: [{ name: 'report.txt', relativePath: 'report.txt' }] };
        await native.request(prefix + '/artifacts', json(capture));
        assert.equal((await until(() => transfer(capture.operationId), o => ['succeeded', 'failed'].includes(o.status), 'capture')).status, 'succeeded');
        const requestId = randomUUID(), deliver = { action: 'deliver', operationId: randomUUID(), captureOperationId: capture.operationId,
            files: [{ name: 'report.txt', requestId, reference: { reference: `runweft:output:${taskId}:${roundId}`, purpose: 'output' } }] };
        await native.request(prefix + '/artifacts', json(deliver));
        const delivered = await until(() => transfer(deliver.operationId), o => ['succeeded', 'failed'].includes(o.status), 'deliver');
        assert.equal(delivered.status, 'succeeded', JSON.stringify(delivered.error ?? delivered.deliveries));
        const result = (await native.request(`/api/artifacts/requests/${requestId}`)).artifact;
        assert.equal(gateway.store.object('artifact', result.id)?.ownerId, b.identity.id);
        await artifacts.download(result.id, join(root, 'download.txt'));
        assert.equal(readFileSync(join(root, 'download.txt'), 'utf8'), 'fixed output\n');
        await assert.rejects(() => owner.request(`/api/artifacts/${result.id}`), { status: 404 });
        native.releaseOutputs([requestId]);
        assert.equal(gateway.store.can(gateway.store.authenticate(machineToken), 'artifact', result.id), false);
        check('Runner output permit preserves caller ownership; original request lookup and bytes recover, publication releases machine grants');

        const rejected = await new ExecutionClient(native).start(target.machineId, { requestId: randomUUID(), directory: workspace.cwd, agent: 'codex', startingMode: 'remote',
            preparedWorkspace: { environmentId: taskId, preparationId: randomUUID() } });
        assert.equal(rejected.outcome, 'recorded');
        if (rejected.outcome === 'recorded') {
            assert.equal(rejected.receipt.response?.type, 'error');
            assert.equal((rejected.receipt.response as any).childStarted, false);
            assert.equal(gateway.store.object('session', rejected.receipt.sessionId)?.ownerId, b.identity.id);
        }
        check('real spawn RPC binds the task owner before Runner rejects invalid preparation; no model process is launched');
        resources.share(actorA, runtime.id, sid, false);
        await assert.rejects(() => native.request(prefix + '/workspaces', json({ action: 'inspect', environmentId: taskId })), { code: 'runtime_private' });
        assert.equal((await artifacts.show(result.id)).state, 'available');
        for (const name of ['hapi-out.log', 'hapi-err.log', 'runner-out.log', 'runner-err.log', 'source-runner-out.log', 'source-runner-err.log']) {
            const log = readFileSync(join(root, name), 'utf8'); for (const value of secrets) assert(!log.includes(value), 'Credential appeared in service log');
        }
        check('revocation blocks more machine work while task owner retains delivered results; service logs contain no credentials');
        evidence.candidate = { entry: 'source gateway + explicit HAPI binary', nativeBinary, hapiSha256: createHash('sha256').update(readFileSync(nativeBinary)).digest('hex'), revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() };
        evidence.success = true;
    } catch (error) { evidence.error = error instanceof Error ? error.message : String(error); throw error; }
    finally { await closeOwned(); }
}, 120000);
