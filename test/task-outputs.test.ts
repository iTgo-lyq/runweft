import { afterEach, expect, test } from 'bun:test';
import { createHash, randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from '../hapi/hub/node_modules/hono';
import type { ArtifactTransfer, ArtifactTransferRequest } from '../hapi/shared/src/artifactTransfers';
import { ARTIFACT_DEFAULT_LIMITS } from '../hapi/shared/src/artifacts';
import { Store } from '../hapi/hub/src/store';
import { ArtifactService } from '../hapi/hub/src/artifacts/service';
import { createArtifactRoutes } from '../hapi/hub/src/web/routes/artifacts';
import type { WebAppEnv } from '../hapi/hub/src/web/middleware/auth';
import { ArtifactClient } from '../src/artifacts/client';
import { HapiClient } from '../src/hapi';
import { TaskCoordinator } from '../src/tasks/coordinator';
import { taskOutputs } from '../src/tasks/commands';
import { taskFixture, until } from './tasks-fixture';
import { workspaces } from './workspaces-fixture';
import { fixture } from './helpers';

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function harness(worktree = false) {
    const root = fixture('task-outputs'), store = new Store(join(root, 'hapi.db'));
    cleanup.push(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
    const service = new ArtifactService(store.artifacts, join(root, 'artifacts'), ARTIFACT_DEFAULT_LIMITS);
    const sources = new Map<string, string>(), capturedBytes = new Map<string, string>(), operations = new Map<string, ArtifactTransfer>(), git = workspaces();
    const faults = { captureLost: false, deliverLost: false, publishLost: false, holdCapture: false, holdDeliver: false, failName: '', cleanupLost: false };
    const calls = { capture: 0, deliver: 0, release: 0 };
    const h = await taskFixture(cleanup, 'codex', worktree ? git.handler : undefined, async (request, namespace) => {
        const path = new URL(request.url).pathname;
        if (path.startsWith('/api/artifacts')) {
            const app = new Hono<WebAppEnv>(); app.use('*', async (c, next) => { c.set('namespace', namespace); await next(); });
            app.route('/api', createArtifactRoutes(service)); return app.fetch(request);
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
        if (!operation) return Response.json({ code: 'artifact_operation_missing' }, { status: 409 });
        if (body.action === 'release') {
            calls.release++;
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
                    const object = service.reserve(namespace, { requestId: input.requestId, filename: input.name, mimeType: 'application/octet-stream', size: candidate.size,
                        sha256: candidate.sha256, reference: input.reference });
                    const published = await service.upload(namespace, object.id, new Response(capturedBytes.get(`${original.captureOperationId}:${input.name}`)!).body);
                    if (faults.publishLost) { faults.publishLost = false; operation.deliveries.push({ name: input.name, status: 'failed', error: { code: 'connection_failed', message: 'Lost upload response' } }); }
                    else operation.deliveries.push({ name: input.name, status: 'available', artifact: published });
                }
                operation.status = operation.deliveries.some(file => file.status === 'failed') ? 'failed' : 'succeeded';
            }
        }
        return Response.json({ operation });
    });
    h.machines[0].runnerState!.capabilities!.artifactOutputs = 1;
    const artifacts = new ArtifactClient(h.alpha);
    const spawn = (names: string[]) => h.post('spawn', { ...h.payload(), intent: { ...h.intent, workspaceMode: worktree ? 'worktree' : 'shared', outputs: names.map(name => ({ name, relativePath: name })) } });
    async function started(id: string, roundId?: string) { return until(() => h.post('read', { id, roundId }), value => value.inputs[0]?.observation?.phase === 'accepted'); }
    async function finished(id: string, roundId?: string) { return until(() => h.post('read', { id, roundId }), value => ['completed', 'failed'].includes(value.status) && !value.artifacts.pending.length); }
    return { ...h, store, artifacts, operations, sources, callsFiles: calls, faultsFiles: faults, git, spawn, started, finished };
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

test('collect records a later capture and resumes on a completed round after coordinator restart without a model', async () => {
    const h = await harness(); const first = await h.spawn(['late']), running = await h.started(first.agent_id); h.complete(running.session_id);
    const before = await h.finished(first.agent_id); h.sources.set('late', 'late content'); h.faultsFiles.holdCapture = true;
    const request = { id: first.agent_id, roundId: first.round_id, requestId: randomUUID(), action: 'collect', files: [{ name: 'late', relativePath: 'late' }] };
    const accepted = await h.post('artifacts/action', request); expect(await h.post('artifacts/action', request)).toEqual(accepted);
    await until(() => h.callsFiles.capture, value => value === 2); await h.tasks!.close();
    const restarted = new TaskCoordinator(h.statePath, ns => new HapiClient(h.nativeUrl, `test-${ns}`), 20); cleanup.push(() => restarted.close());
    expect(restarted.store.pending()).toContainEqual({ namespace: 'alpha', id: first.agent_id });
    h.faultsFiles.holdCapture = false; restarted.start();
    const after = await until(() => restarted.read('alpha', h.parent, first.agent_id), value => value.artifacts.manifest?.version === 2 && !value.artifacts.pending.length);
    expect(after.completed_revision).toBe(before.completed_revision); expect(after.artifacts.manifest!.kind).toBe('collect');
    expect(after.artifacts.manifest!.items[0].capturedAt).toBeGreaterThanOrEqual(before.completedAt ?? before.artifacts.manifest.createdAt);
    expect(restarted.artifactManifests('alpha', h.parent, first.agent_id, first.round_id).manifests[0]).toEqual(before.artifacts.manifest);
    expect(h.callsFiles.capture).toBe(2); expect(h.calls.spawn).toBe(1); expect(h.calls.send).toBe(1);
});

test('rejects unsupported runners, active/foreign collection, steer outputs, and unsafe declarations before file side effects', async () => {
    const h = await harness(); delete h.machines[0].runnerState!.capabilities!.artifactOutputs;
    await expect(h.spawn(['one'])).rejects.toMatchObject({ code: 'runner_upgrade_required' }); expect(h.calls.spawn).toBe(0);
    h.machines[0].runnerState!.capabilities!.artifactOutputs = 1;
    const parent = { kind: 'mcp', host: 'codex', nativeSessionId: 'parent-one', cwd: h.cwd, machineId: 'own' };
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
