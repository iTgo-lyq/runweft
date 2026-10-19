import { saveTestConnection } from '../identity-fixture';
import { fixtureCleanup } from '../fixture-cleanup';
import { afterEach, expect, test } from 'bun:test';
import { createHash, randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from '../../hapi/hub/node_modules/hono';
import type { ArtifactTransfer, ArtifactTransferRequest } from '../../hapi/shared/src/artifactTransfers';
import { ARTIFACT_DEFAULT_LIMITS } from '../../hapi/shared/src/artifacts';
import { Store } from '../../hapi/hub/src/store';
import { ArtifactService } from '../../hapi/hub/src/artifacts/service';
import { createArtifactRoutes } from '../../hapi/hub/src/web/routes/artifacts';
import type { WebAppEnv } from '../../hapi/hub/src/web/middleware/auth';
import { ArtifactClient } from '../../src/artifacts/client';
import { HapiClient } from '../../src/hapi';
import { HubClient } from '../../src/hub/client';
import { hubConnectionPaths } from '../../src/hub/resources/connection';
import { TaskOutputs } from '../../src/tasks/outputs';
import { taskOutputs } from '../../src/tasks/commands';
import { hubWorkspaceFixture } from './hub-workspace-fixture';
import { until } from '../helpers';
import { workspaces } from './workspaces-fixture';
import { fixture } from '../helpers';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { atomicWrite, loadConfig } from '../../src/config';
import { createMcpServer } from '../../src/mcp/server';

const cleanupOwner = fixtureCleanup([]), cleanup = cleanupOwner.resources;
afterEach(() => cleanupOwner.close());
async function harness(worktree = false) {
    const owned = fixtureCleanup(cleanup);
    try {
        const root = fixture('task-outputs'); owned.resources.push(() => rmSync(root, { recursive: true, force: true }));
        const store = new Store(join(root, 'hapi.db')); owned.resources.push(() => store.close());
        const service = new ArtifactService(store.artifacts, join(root, 'artifacts'), ARTIFACT_DEFAULT_LIMITS);
        const sources = new Map<string, string>(), capturedBytes = new Map<string, string>(), operations = new Map<string, ArtifactTransfer>(), git = workspaces();
        const faults = { captureLost: false, deliverLost: false, publishLost: false, holdCapture: false, holdDeliver: false, failName: '', cleanupLost: false, inputCleanupLost: false, holdUnpin: false, unpinLost: false };
        const calls = { capture: 0, deliver: 0, release: 0 };
        const h = await hubWorkspaceFixture(owned.resources, 'codex', worktree ? git.handler : undefined, async (request, namespace) => {
            const path = new URL(request.url).pathname;
            if (path.startsWith('/api/artifacts')) {
                const app = new Hono<WebAppEnv>(); app.use('*', async (c, next) => { c.set('namespace', namespace); await next(); });
                app.route('/api', createArtifactRoutes(service));
                if (request.method === 'DELETE' && path.includes('/references/') && faults.holdUnpin) return new Response('', { status: 503 });
                const response = await app.fetch(request);
                if (request.method === 'DELETE' && path.includes('/references/') && faults.unpinLost) { faults.unpinLost = false; return new Response('', { status: 502 }); }
                return response;
            }
            if (!/\/api\/machines\/[^/]+\/artifacts$/.test(path)) return;
            const body = await request.json() as ArtifactTransferRequest;
            let operation = operations.get(body.operationId);
            if (body.action === 'capture' || body.action === 'deliver') {
                calls[body.action]++;
                if (operation) expect(operation.request).toEqual(body);
                else {
                    if (body.action === 'capture') {
                        expect([...h.sessions.values()].every(native => !native.session.active)).toBe(true);
                        if (worktree) expect(git.calls.some(call => call.action === 'finalize')).toBe(true);
                    }
                    operation = { version: 1, request: body, status: 'accepted', createdAt: Date.now(), updatedAt: Date.now(), files: [], retention: 'retained', sessions: [] };
                    operations.set(body.operationId, operation);
                }
                if (body.action === 'capture' && faults.captureLost) { faults.captureLost = false; return new Response('', { status: 502 }); }
                if (body.action === 'deliver' && faults.deliverLost) { faults.deliverLost = false; return new Response('', { status: 502 }); }
            }
            if (body.action === 'materialize' && !operation) {
                operation = { version: 1, request: body, status: 'succeeded', retention: 'retained', files: body.files.map(file => ({ ...file, path: `/inputs/${body.operationId}/${file.name}` })), sessions: [], createdAt: Date.now(), updatedAt: Date.now() };
                operations.set(body.operationId, operation);
            }
            if (!operation) return Response.json({ code: 'artifact_operation_missing' }, { status: 409 });
            if (body.action === 'release') {
                calls.release++;
                if (operation.request.action === 'materialize') {
                    operation.retention = 'released';
                    if (faults.inputCleanupLost) { faults.inputCleanupLost = false; return new Response('', { status: 502 }); }
                }
                for (const file of operation.candidates ?? []) if (file.status === 'captured' && (!body.names || body.names.includes(file.name))) file.retention = 'released';
                if (operation.candidates?.every(file => file.status === 'failed' || file.retention === 'released')) operation.retention = 'released';
                if (faults.cleanupLost) { faults.cleanupLost = false; return new Response('', { status: 502 }); }
            }
            if (body.action === 'inspect' && operation.status === 'accepted') {
                const original = operation.request;
                if (original.action === 'capture' && !faults.holdCapture) {
                    operation.candidates = original.files.map(file => {
                        const bytes = sources.get(file.relativePath);
                        if (bytes === undefined) return { ...file, status: 'failed' as const, error: { code: 'artifact_output_missing', message: 'Missing fixture output' } };
                        capturedBytes.set(`${body.operationId}:${file.name}`, bytes);
                        return { ...file, status: 'captured' as const, path: `/spool/${body.operationId}/${file.name}`, size: Buffer.byteLength(bytes),
                            sha256: createHash('sha256').update(bytes).digest('hex'), capturedAt: Date.now(), retention: 'retained' as const };
                    });
                    operation.status = operation.candidates.some(file => file.status === 'failed') ? 'failed' : 'succeeded';
                } else if (original.action === 'deliver' && !faults.holdDeliver) {
                    operation.deliveries = [];
                    for (const input of original.files) {
                        const candidate = operations.get(original.captureOperationId)!.candidates!.find(file => file.name === input.name)!;
                        expect(candidate.status).toBe('captured'); if (candidate.status !== 'captured') throw new Error('No candidate');
                        if (input.name === faults.failName) {
                            operation.deliveries.push({ name: input.name, status: 'failed', error: { code: 'artifact_quota_exceeded', message: 'Fixture quota exhausted' } }); continue;
                        }
                        const machineId = new URL(request.url).pathname.split('/')[3], runner = new HapiClient(h.url, h.machineConnections.get(machineId)!.token);
                        const object = (await runner.request('/api/artifacts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: input.requestId, filename: input.name, mimeType: 'application/octet-stream', size: candidate.size, sha256: candidate.sha256, reference: input.reference }) })).artifact;
                        const published = (await runner.request(`/api/artifacts/${object.id}/content`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: capturedBytes.get(`${original.captureOperationId}:${input.name}`)! })).artifact;
                        if (faults.publishLost) { faults.publishLost = false; operation.deliveries.push({ name: input.name, status: 'failed', error: { code: 'connection_failed', message: 'Lost upload response' } }); }
                        else operation.deliveries.push({ name: input.name, status: 'available', artifact: published });
                    }
                    operation.status = operation.deliveries.some(file => file.status === 'failed') ? 'failed' : 'succeeded';
                }
            }
            return Response.json({ operation });
        });
        h.machines.find(machine => machine.id === h.machineId)!.runnerState!.capabilities!.artifactOutputs = 1;
        const http = () => new HubClient({ url: h.url, space: h.space, credential: { token: h.owner.token }, env: {} }, 'hubAccess', 'hub_access_unavailable').http;
        const artifacts = new ArtifactClient({ request: (path, options) => http().request(path, options), response: (path, options) => http().response(path, options) });
        const spawn = (names: string[]) => h.post('spawn', { ...h.payload(), intent: { ...h.payload().intent, workspaceMode: worktree ? 'worktree' : 'shared', outputs: names.map(name => ({ name, relativePath: name })) } });
        async function started(id: string, roundId?: string) { return until(() => h.post('read', { id, roundId }), value => value.inputs[0]?.observation?.phase === 'accepted'); }
        async function finished(id: string, roundId?: string) { return until(() => h.post('read', { id, roundId }), value => ['completed', 'failed'].includes(value.status) && !value.artifacts.pending.length); }
        return Object.assign(h, { service, store, artifacts, operations, sources, callsFiles: calls, faultsFiles: faults, git, spawn, started, finished });
    } catch (error) { return owned.failed(error); }
}

test('declared outputs capture only after native stop and Git seal, publish partial immutable manifests and protect successful objects', async () => {
    const h = await harness(true); h.sources.set('报告.txt', 'original');
    const accepted = await h.spawn(['报告.txt', 'missing.txt']), running = await h.started(accepted.agent_id);
    expect(h.callsFiles.capture).toBe(0); expect(JSON.stringify(h.sessions.get(running.session_id)?.messages)).toContain('报告.txt');
    h.complete(running.session_id); const done = await h.finished(accepted.agent_id);
    expect(done.status).toBe('completed'); expect(done.attention.scope).toBe('artifacts'); expect(done.git.status).toBe('sealed');
    expect(done.artifacts.status).toBe('incomplete'); expect(done.delivery.attachments.manifest).toEqual(done.artifacts.manifest);
    const [available, missing] = done.artifacts.manifest.items;
    expect(available.status).toBe('available'); expect(missing.error.code).toBe('artifact_output_missing');
    expect((await h.artifacts.show(available.artifactId)).sha256).toBe(available.sha256);
    await expect(h.artifacts.remove(available.artifactId)).rejects.toMatchObject({ code: 'artifact_referenced' });
    expect(h.operations.get(available.captureOperationId)?.retention).toBe('released');
    expect((await h.post('artifacts/show', { id: accepted.agent_id, roundId: accepted.round_id })).manifests).toEqual([done.artifacts.manifest]);
    expect(h.calls.spawn).toBe(1); expect(h.calls.send).toBe(1);
});

test('recovering published output cleanup releases grants only for verified available objects in the durable manifest', async () => {
    const h = await harness(); h.sources.set('one', 'owned output');
    const accepted = await h.spawn(['one', 'missing']), running = await h.started(accepted.agent_id);
    h.complete(running.session_id); await h.finished(accepted.agent_id);
    const { task, rounds } = h.gateway.delegation.coordinator.store.require(h.namespace, accepted.agent_id), round = rounds[0], job = round.outputFiles!.jobs[0];
    job.phase = 'cleanup'; // Durable publication succeeded before a simulated process loss at grant release.
    const native = h.gateway.delegation.taskClient(task, round);
    // Restore the real persisted delivery grant using its original request, not a fabricated grant.
    await native.request(`/api/machines/${task.target.machineId}/artifacts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(job.deliveries![0].request) });
    const manifest = h.gateway.delegation.coordinator.store.manifests(task.id, round.id)[0];
    const available = manifest.items.filter(item => item.status === 'available');
    expect(available).toHaveLength(1); expect(manifest.items.some(item => item.status === 'failed')).toBe(true);
    const credential = h.gateway.store.authenticate(h.machineConnections.get(h.machineId)!.token);
    expect(h.gateway.store.can(credential, 'artifact', available[0].artifactId!, 'write')).toBe(true);
    const outputs = new TaskOutputs(native, h.gateway.delegation.coordinator.store);
    await outputs.advance(task, round, () => h.gateway.delegation.coordinator.store.save(task, round, []));
    expect(job).toMatchObject({ phase: 'complete' });
    expect(h.gateway.store.can(credential, 'artifact', available[0].artifactId!, 'read')).toBe(false);
    expect(h.gateway.store.can(credential, 'artifact', available[0].artifactId!, 'write')).toBe(false);

});

test('lost capture/delivery responses reconcile the same operations and keep the next native round queued until delivery is known', async () => {
    const h = await harness(); h.sources.set('one', 'ONE'); h.faultsFiles.captureLost = true; h.faultsFiles.deliverLost = true;
    h.faultsFiles.publishLost = true; h.faultsFiles.holdDeliver = true; h.faultsFiles.cleanupLost = true;
    const first = await h.spawn(['one']), running = await h.started(first.agent_id); h.complete(running.session_id);
    const second = await h.post('send', { requestId: randomUUID(), intent: { id: first.agent_id, mode: 'next', message: 'next' } });
    await until(() => h.callsFiles.deliver, value => value === 1); expect(h.calls.resume).toBe(0);
    expect((await h.post('read', { id: first.agent_id, roundId: first.round_id })).phase).toBe('finishing');
    h.faultsFiles.holdDeliver = false; await h.finished(first.agent_id, first.round_id);
    expect(h.callsFiles.capture).toBe(1); expect(h.callsFiles.deliver).toBe(1);
    const next = await h.started(first.agent_id, second.round_id); h.complete(next.session_id); await h.finished(first.agent_id, second.round_id);
    expect(h.calls.spawn).toBe(1); expect(h.calls.resume).toBe(1); expect(h.calls.send).toBe(2);
});

test('retry uploads only the frozen failed candidate and wait consumes completed rounds before later file revisions', async () => {
    const h = await harness(); h.sources.set('one', 'OLD'); h.faultsFiles.failName = 'one';
    const first = await h.spawn(['one']), running = await h.started(first.agent_id); h.complete(running.session_id);
    const incomplete = await h.finished(first.agent_id), versionOne = structuredClone(incomplete.artifacts.manifest);
    const second = await h.post('send', { requestId: randomUUID(), intent: { id: first.agent_id, mode: 'next', message: 'another native round' } });
    const next = await h.started(first.agent_id, second.round_id); h.sources.set('one', 'NEW'); h.complete(next.session_id); const secondDone = await h.finished(first.agent_id, second.round_id);
    h.faultsFiles.failName = '';
    const request = { id: first.agent_id, roundId: first.round_id, requestId: randomUUID(), action: 'retry' };
    const accepted = await h.post('artifacts/action', request); expect(await h.post('artifacts/action', request)).toEqual(accepted);
    const revised = await until(() => h.post('read', { id: first.agent_id, roundId: first.round_id }), value => value.artifacts.manifest.version === 2 && !value.artifacts.pending.length);
    expect(revised.completed_revision).toBe(incomplete.completed_revision); expect(revised.artifacts_revision).toBeGreaterThan(secondDone.completed_revision);
    const item = revised.artifacts.manifest.items[0]; expect(item.sha256).toBe(createHash('sha256').update('OLD').digest('hex'));
    expect((await h.post('artifacts/show', { id: first.agent_id, roundId: first.round_id })).manifests[0]).toEqual(versionOne);
    const wait = await h.post('wait', { ids: [first.agent_id], timeoutMs: 0, afterRevision: { [first.agent_id]: incomplete.completed_revision } });
    expect(wait.agents[0].round_id).toBe(second.round_id);
    const updated = await h.post('wait', { ids: [first.agent_id], timeoutMs: 0, afterRevision: { [first.agent_id]: wait.agents[0].revision } });
    expect(updated.agents[0].round_id).toBe(first.round_id); expect(updated.agents[0].revision).toBe(revised.artifacts_revision);
    expect(h.callsFiles.capture).toBe(1); expect(h.calls.spawn).toBe(1); expect(h.calls.send).toBe(2);
});

test('MCP retry fixed candidates and collect new versions with native call idempotency and no model replay', async () => {
    for (const host of ['codex'] as const) {
        const h = await harness(); h.sources.set('one', 'ORIGINAL'); h.faultsFiles.failName = 'one';
        const cwd = '/', config = loadConfig(h.home, {}), paths = hubConnectionPaths(h.home, h.url), credential = h.machineConnections.get(h.machineId)!;
        await saveTestConnection(h.home, h.url, h.owner.token, h.space);
        atomicWrite(paths.machineConnection, JSON.stringify({ schemaVersion: 1, hub: h.url, ownerId: h.owner.identity.id, requestId: credential.requestId, machineId: h.machineId, active: { token: credential.token, credentialId: credential.credentialId }, createdAt: Date.now() }));
        const server = createMcpServer({ client: host, cwd, config: () => config, hub: () => ({ url: h.url, home: h.home, env: config.env }) }), client = new Client({ name: 'file-recovery', version: '1' });
        cleanup.push(() => server.close(), () => client.close());
        const [left, right] = InMemoryTransport.createLinkedPair(); await server.connect(left); await client.connect(right);
        const call = async (name: string, args: Record<string, unknown>, callId = randomUUID(), parent = 'file-parent') => {
            const result = await client.callTool({ name, arguments: args, _meta: { threadId: parent, sessionId: parent, callId } });
            return result.structuredContent as Record<string, any>;
        };
        const first = await call('spawn_agent', { agent_type: h.agent.id, message: 'Files', outputs: [{ name: 'one', relativePath: 'one' }] });
        const running = await until(() => call('read_agent', { id: first.agent_id }), value => value.inputs?.[0]?.observation?.phase === 'accepted');
        h.complete(running.session_id);
        const failed = await until(() => call('read_agent', { id: first.agent_id }), value => value.status === 'completed' && !value.artifacts.pending.length);
        expect(failed.artifacts.status).toBe('incomplete'); h.sources.set('one', 'CHANGED'); h.faultsFiles.failName = '';
        const args = { id: first.agent_id, round_id: first.round_id }, callId = randomUUID();
        expect((await call('retry_artifacts', args, randomUUID(), 'other-parent')).error.code).toBe('task_parent_mismatch');
        const accepted = await call('retry_artifacts', args, callId);
        expect(await call('retry_artifacts', args, callId)).toEqual(accepted);
        expect((await call('list_agents', {})).agents[0].accepted_requests.some((value: any) => value.request_id === accepted.request_id && value.artifact_operation_id === accepted.artifact_operation_id)).toBe(true);
        const retried = await until(() => call('read_agent', { id: first.agent_id }), value => value.artifacts.manifest.version === 2 && !value.artifacts.pending.length);
        expect(retried.artifacts.status).toBe('delivered'); expect(retried.completed_revision).toBe(failed.completed_revision);
        expect(retried.artifacts.manifest.items[0].sha256).toBe(createHash('sha256').update('ORIGINAL').digest('hex'));
        const files = [{ name: 'one', relativePath: 'one' }], collectId = randomUUID();
        const collected = await call('collect_artifacts', { ...args, files }, collectId);
        expect(await call('collect_artifacts', { ...args, files }, collectId)).toEqual(collected);
        const updated = await until(() => call('read_agent', { id: first.agent_id }), value => value.artifacts.manifest.version === 3 && !value.artifacts.pending.length);
        expect(updated.artifacts.manifest.items[0].sha256).toBe(createHash('sha256').update('CHANGED').digest('hex'));
        expect(updated.completed_revision).toBe(failed.completed_revision); expect(updated.native_session_id).toBe(failed.native_session_id);
        expect(h.calls.spawn).toBe(1); expect(h.calls.send).toBe(1); expect(h.calls.resume).toBe(0);
        expect((await call('wait', { ids: [first.agent_id], timeout_ms: 0, after_revision: { [first.agent_id]: retried.revision } })).agents[0].revision).toBe(updated.artifacts_revision);
    }
});

test('collect records a later capture and resumes on a completed round after coordinator restart without a model', async () => {
    const h = await harness(); const first = await h.spawn(['late']), running = await h.started(first.agent_id); h.complete(running.session_id);
    const before = await h.finished(first.agent_id); h.sources.set('late', 'late content'); h.faultsFiles.holdCapture = true;
    const request = { id: first.agent_id, roundId: first.round_id, requestId: randomUUID(), action: 'collect', files: [{ name: 'late', relativePath: 'late' }] };
    const accepted = await h.post('artifacts/action', request); expect(await h.post('artifacts/action', request)).toEqual(accepted);
    await until(() => h.callsFiles.capture, value => value === 2);
    expect(h.gateway.delegation.coordinator.store.pending()).toContainEqual({ namespace: h.namespace, id: first.agent_id });
    await h.restart(); h.faultsFiles.holdCapture = false;
    const after = await until(() => h.post('read', { id: first.agent_id }), value => value.artifacts.manifest?.version === 2 && !value.artifacts.pending.length);
    expect(after.completed_revision).toBe(before.completed_revision); expect(after.artifacts.manifest!.kind).toBe('collect');
    expect(after.artifacts.manifest!.items[0].capturedAt).toBeGreaterThanOrEqual(before.completedAt ?? before.artifacts.manifest.createdAt);
    expect((await h.post('artifacts/show', { id: first.agent_id, roundId: first.round_id })).manifests[0]).toEqual(before.artifacts.manifest);
    expect(h.callsFiles.capture).toBe(2); expect(h.calls.spawn).toBe(1); expect(h.calls.send).toBe(1);
});

test('rejects unsupported runners, active/foreign collection, steer outputs, and unsafe declarations before file side effects', async () => {
    const h = await harness(); delete h.machines.find(machine => machine.id === h.machineId)!.runnerState!.capabilities!.artifactOutputs;
    await expect(h.spawn(['one'])).rejects.toMatchObject({ code: 'runner_upgrade_required' }); expect(h.calls.spawn).toBe(0);
    h.machines.find(machine => machine.id === h.machineId)!.runnerState!.capabilities!.artifactOutputs = 1;
    const parent = { kind: 'mcp', host: 'codex', nativeSessionId: 'parent-one', cwd: h.cwd, machineId: h.machineId };
    const first = await h.post('spawn', { ...h.payload(), parent });
    const collect = { parent, id: first.agent_id, roundId: first.round_id, requestId: randomUUID(), action: 'collect', files: [{ name: 'one', relativePath: 'one' }] };
    await expect(h.post('artifacts/action', collect)).rejects.toMatchObject({ code: 'artifact_round_pending' });
    await expect(h.post('artifacts/action', { ...collect, parent: { ...parent, nativeSessionId: 'other' } })).rejects.toMatchObject({ code: 'task_parent_mismatch' });
    await expect(h.post('send', { parent, requestId: randomUUID(), intent: { id: first.agent_id, mode: 'steer', roundId: first.round_id, message: 'steer', outputs: collect.files } })).rejects.toMatchObject({ status: 400 });
    expect(taskOutputs(['摘要.txt=out/报告.txt'])).toEqual([{ name: '摘要.txt', relativePath: 'out/报告.txt' }]);
    expect(() => taskOutputs(['../escape'])).toThrow('参数无效'); expect(h.callsFiles.capture).toBe(0);
});

test('startup rejection does not collect preexisting files and a native failure keeps its conclusion when outputs are delivered', async () => {
    const h = await harness(); h.sources.set('one', 'preexisting'); h.faults.spawn = 'rejected';
    const rejected = await h.spawn(['one']); const failed = await h.finished(rejected.agent_id);
    expect(failed.execution_not_started).toBe(true); expect(failed.artifacts.manifest.items[0].error.code).toBe('execution_not_started'); expect(h.callsFiles.capture).toBe(0);
    h.faults.spawn = 'none'; const accepted = await h.spawn(['one']); const running = await h.started(accepted.agent_id);
    h.complete(running.session_id, 'Failed after writing output', 'failed'); const delivered = await h.finished(accepted.agent_id);
    expect(delivered.status).toBe('failed'); expect(delivered.native_status[0].phase).toBe('failed'); expect(delivered.artifacts.status).toBe('delivered');
});

test('collection finishes its capture before a queued next round starts and rejects collection while that next round executes', async () => {
    const h = await harness(); h.sources.set('one', 'ONE'); const first = await h.spawn(['one']);
    const running = await h.started(first.agent_id); h.complete(running.session_id); await h.finished(first.agent_id);
    h.sources.set('two', 'TWO'); h.faultsFiles.holdCapture = true;
    const collect = { id: first.agent_id, roundId: first.round_id, requestId: randomUUID(), action: 'collect', files: [{ name: 'two', relativePath: 'two' }] };
    await h.post('artifacts/action', collect); await until(() => h.callsFiles.capture, count => count === 2);
    const next = await h.post('send', { requestId: randomUUID(), intent: { id: first.agent_id, mode: 'next', message: 'next' } });
    expect((await h.post('read', { id: first.agent_id, roundId: next.round_id })).phase).toBe('queued'); expect(h.calls.resume).toBe(0);
    h.faultsFiles.holdCapture = false; const second = await h.started(first.agent_id, next.round_id);
    await expect(h.post('artifacts/action', { ...collect, requestId: randomUUID() })).rejects.toMatchObject({ code: 'artifact_collect_active' });
    h.complete(second.session_id); await h.finished(first.agent_id, next.round_id);
    expect(h.calls.spawn).toBe(1); expect(h.calls.resume).toBe(1);
});

test('an unprepared worktree cannot collect files from its original parent directory', async () => {
    const h = await harness(true); h.git.control.failPrepare = true; h.sources.set('one', 'parent-only content');
    const first = await h.spawn(['one']); await h.finished(first.agent_id);
    await expect(h.post('artifacts/action', { id: first.agent_id, roundId: first.round_id, requestId: randomUUID(), action: 'collect',
        files: [{ name: 'one', relativePath: 'one' }] })).rejects.toMatchObject({ code: 'workspace_not_prepared' });
    expect(h.callsFiles.capture).toBe(0); expect(h.calls.spawn).toBe(0);
});


test('round release previews all historical output references, preserves external recovery pins and keeps immutable manifests', async () => {
    const h = await harness(true); h.sources.set('one', 'old bytes'); const first = await h.spawn(['one']);
    const running = await h.started(first.agent_id); h.complete(running.session_id); const before = await h.finished(first.agent_id);
    const old = before.artifacts.manifest.items[0].artifactId;
    h.sources.set('one', 'new bytes');
    await h.post('artifacts/action', { id: first.agent_id, roundId: first.round_id, requestId: randomUUID(), action: 'collect', files: [{ name: 'one', relativePath: 'one' }] });
    const revised = await until(() => h.post('read', { id: first.agent_id }), value => value.artifacts.manifest.version === 2 && !value.artifacts.pending.length);
    const latest = revised.artifacts.manifest.items[0].artifactId;
    await h.artifacts.pin(old, 'external:restore', 'recovery');
    const manifests = (await h.post('artifacts/show', { id: first.agent_id, roundId: first.round_id })).manifests;
    const preview = await h.post('artifacts/release', { id: first.agent_id });
    expect(preview.applied).toBe(false); expect(preview.can_release).toBe(true); expect(preview.rounds[0].state).toBe('retained');
    expect(preview.rounds[0].references.map((item: any) => item.artifactId).sort()).toEqual([old, latest].sort());
    expect((await h.artifacts.refs(old)).references).toHaveLength(2);
    expect((await h.post('read', { id: first.agent_id })).artifacts.retention.state).toBe('retained');
    h.faultsFiles.unpinLost = true;
    const accepted = await h.post('artifacts/release', { id: first.agent_id, apply: true });
    const released = await until(() => h.post('read', { id: first.agent_id }), value => value.artifacts.retention.state === 'released');
    expect(released.completed_revision).toBe(before.completed_revision); expect(released.status).toBe('completed'); expect(released.git).toEqual(revised.git);
    expect(released.artifacts_revision).toBeGreaterThan(accepted.revision); expect(released.report).toEqual(before.report);
    expect((await h.post('wait', { ids: [first.agent_id], timeoutMs: 0, afterRevision: { [first.agent_id]: accepted.revision } })).timed_out).toBe(false);
    expect((await h.post('artifacts/show', { id: first.agent_id, roundId: first.round_id })).manifests).toEqual(manifests);
    expect((await h.artifacts.refs(old)).references.map(item => item.purpose)).toEqual(['recovery']);
    expect((await h.artifacts.refs(latest)).references).toEqual([]); expect((await h.artifacts.remove(latest)).state).toBe('deleted');
    await expect(h.artifacts.remove(old)).rejects.toMatchObject({ code: 'artifact_referenced' });
    expect((await h.post('artifacts/release', { id: first.agent_id, apply: true })).rounds[0].state).toBe('released');
    await expect(h.post('artifacts/action', { id: first.agent_id, roundId: first.round_id, requestId: randomUUID(), action: 'retry' })).rejects.toMatchObject({ code: 'artifact_retention_released' });
    expect(h.calls.spawn).toBe(1); expect(h.calls.send).toBe(1);
});

test('unpublished captured bytes require explicit discard and unknown machine operations are never released', async () => {
    const h = await harness(); h.sources.set('one', 'only candidate'); h.faultsFiles.failName = 'one';
    const first = await h.spawn(['one']); const running = await h.started(first.agent_id); h.complete(running.session_id); const before = await h.finished(first.agent_id);
    const candidate = before.artifacts.manifest.items[0], operation = h.operations.get(candidate.captureOperationId)!;
    const value = { id: first.agent_id, roundId: first.round_id };
    const preview = await h.post('artifacts/release', value);
    expect(preview.can_release).toBe(false); expect(preview.rounds[0].pendingCandidates).toEqual([{ name: 'one', operationId: candidate.captureOperationId }]);
    await expect(h.post('artifacts/release', { ...value, apply: true })).rejects.toMatchObject({ code: 'artifact_undelivered_candidates' });
    expect(operation.retention).toBe('retained'); expect(h.callsFiles.release).toBe(0);
    operation.status = 'unknown';
    await expect(h.post('artifacts/release', { ...value, apply: true, discardPending: true })).rejects.toMatchObject({ code: 'artifact_operation_pending' });
    expect(h.callsFiles.release).toBe(0); operation.status = 'succeeded';
    h.faultsFiles.cleanupLost = true;
    await h.post('artifacts/release', { ...value, apply: true, discardPending: true });
    const after = await until(() => h.post('read', { id: first.agent_id }), value => value.artifacts.retention.state === 'discarded');
    expect(operation.retention).toBe('released'); expect(after.artifacts.manifest).toEqual(before.artifacts.manifest);
    expect(after.artifacts.status).toBe('incomplete'); expect(after.completed_revision).toBe(before.completed_revision);
    expect(h.callsFiles.release).toBe(1); expect(h.calls.spawn).toBe(1); expect(h.calls.send).toBe(1);
});

test('release resumes its persisted intent after coordinator restart and blocks new work until references are reconciled', async () => {
    const h = await harness(); h.sources.set('one', 'bytes'); const first = await h.spawn(['one']);
    const running = await h.started(first.agent_id); h.complete(running.session_id); const done = await h.finished(first.agent_id);
    h.faultsFiles.holdUnpin = true;
    const releasing = await h.post('artifacts/release', { id: first.agent_id, apply: true });
    const failedRelease = await until(() => h.post('read', { id: first.agent_id }), value => value.attention?.stage === 'artifact_release');
    const notice = await h.post('wait', { ids: [first.agent_id], timeoutMs: 0, afterRevision: { [first.agent_id]: releasing.revision } });
    expect(notice.timed_out).toBe(false); expect(notice.agents[0].artifacts.retention.state).toBe('releasing');
    expect(failedRelease.completed_revision).toBe(done.completed_revision);
    await expect(h.post('send', { requestId: randomUUID(), intent: { id: first.agent_id, message: 'next', mode: 'next' } })).rejects.toMatchObject({ code: 'artifact_release_pending' });
    expect(h.gateway.delegation.coordinator.store.pending()).toContainEqual({ namespace: h.namespace, id: first.agent_id });
    await h.restart(); h.faultsFiles.holdUnpin = false;
    await until(() => h.post('read', { id: first.agent_id }), value => value.artifacts.retention.state === 'released');
    expect((await h.artifacts.refs(done.artifacts.manifest.items[0].artifactId)).references).toEqual([]);
    const next = await h.post('send', { requestId: randomUUID(), intent: { id: first.agent_id, message: 'new explicit round', mode: 'next' } });
    const resumed = await until(() => h.post('read', { id: first.agent_id, roundId: next.round_id }), value => value.inputs[0]?.observation?.phase === 'accepted');
    expect(resumed.session_id).toBe(running.session_id); expect(resumed.artifacts.retention.state).toBe('retained');
    expect(h.calls.spawn).toBe(1); expect(h.calls.resume).toBe(1);
});

test('release rejects active rounds and foreign parents, while a missing uncaptured output needs no discard', async () => {
    const h = await harness(); const first = await h.spawn(['missing']);
    await expect(h.post('artifacts/release', { id: first.agent_id, apply: true })).rejects.toMatchObject({ code: 'artifact_release_active' });
    const running = await h.started(first.agent_id); h.complete(running.session_id); await h.finished(first.agent_id);
    await expect(h.post('artifacts/release', { id: first.agent_id, parent: { kind: 'mcp', host: 'codex', nativeSessionId: 'foreign', cwd: h.cwd, machineId: h.machineId }, apply: true })).rejects.toMatchObject({ code: 'task_parent_mismatch' });
    expect((await h.post('artifacts/release', { id: first.agent_id })).can_release).toBe(true);
    await h.post('artifacts/release', { id: first.agent_id, apply: true });
    const done = await until(() => h.post('read', { id: first.agent_id }), value => value.artifacts.retention.state === 'released');
    expect(done.artifacts.status).toBe('incomplete'); expect(h.callsFiles.release).toBe(1);
    expect([...h.operations.values()].find(value => value.request.action === 'capture')?.retention).toBe('released');
});


test('recovering input-copy cleanup preserves a simultaneous incomplete output warning', async () => {
    const h = await harness();
    const input = (await h.artifacts.hapi.request('/api/artifacts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: randomUUID(), filename: 'input.txt', mimeType: 'text/plain', size: 1, sha256: createHash('sha256').update('x').digest('hex') }) })).artifact;
    await h.artifacts.hapi.request(`/api/artifacts/${input.id}/content`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: 'x' });
    const first = await h.post('spawn', { ...h.payload(), intent: { ...h.payload().intent, inputs: [{ artifactId: input.id }], outputs: [{ name: 'missing', relativePath: 'missing' }] } });
    const running = await h.started(first.agent_id); h.faultsFiles.inputCleanupLost = true; h.complete(running.session_id);
    const done = await until(() => h.post('read', { id: first.agent_id }), value => value.status === 'completed' && value.input_files.download_retention === 'released');
    expect(done.artifacts.status).toBe('incomplete'); expect(done.attention.code).toBe('artifacts_incomplete');
    expect(done.attention.hint).toContain('collect'); expect(h.calls.send).toBe(1);
    h.faultsFiles.unpinLost = true;
    await h.post('artifacts/release', { id: first.agent_id, apply: true });
    const released = await until(() => h.post('read', { id: first.agent_id }), value => value.artifacts.retention.state === 'released');
    expect(released.attention.code).toBe('artifacts_incomplete'); expect(released.attention.hint).toContain('留存已释放');
});
