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
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { atomicWrite, dataPaths, loadConfig } from '../src/config';
import { initAgent } from '../src/agents/definitions';
import { createMcpServer } from '../src/mcp/server';
import { recordClaudeCall } from '../src/mcp/claude-hook';

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function harness(worktree = false) {
    const root = fixture('task-outputs'), store = new Store(join(root, 'hapi.db'));
    cleanup.push(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
    const service = new ArtifactService(store.artifacts, join(root, 'artifacts'), ARTIFACT_DEFAULT_LIMITS);
    const sources = new Map<string, string>(), capturedBytes = new Map<string, string>(), operations = new Map<string, ArtifactTransfer>(), git = workspaces();
    const faults = { captureLost: false, deliverLost: false, publishLost: false, holdCapture: false, holdDeliver: false, failName: '', cleanupLost: false, inputCleanupLost: false, holdUnpin: false, unpinLost: false };
    const calls = { capture: 0, deliver: 0, release: 0 };
    const h = await taskFixture(cleanup, 'codex', worktree ? git.handler : undefined, async (request, namespace) => {
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
    return { ...h, service, store, artifacts, operations, sources, callsFiles: calls, faultsFiles: faults, git, spawn, started, finished };
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

test('both MCP hosts retry fixed candidates and collect new versions with native call idempotency and no model replay', async () => {
    for (const host of ['codex', 'claude'] as const) {
        const h = await harness(); h.sources.set('one', 'ORIGINAL'); h.faultsFiles.failName = 'one';
        const config = loadConfig(h.home, { GIT_CEILING_DIRECTORIES: h.home }); config.config.server.port = Number(new URL(h.url).port);
        atomicWrite(join(dataPaths(config).hapiClient, 'settings.json'), JSON.stringify({ machineId: 'own' }));
        atomicWrite(join(dataPaths(config).hapiServer, 'settings.json'), JSON.stringify({ cliApiToken: 'test-alpha' }));
        initAgent(config, h.cwd, 'files', { runtime: h.runtime.id });
        const server = createMcpServer({ client: host, cwd: h.cwd, config: () => config }), client = new Client({ name: 'file-recovery', version: '1' });
        const [left, right] = InMemoryTransport.createLinkedPair(); await server.connect(left); await client.connect(right);
        cleanup.push(async () => { await client.close(); await server.close(); });
        const call = async (name: string, args: Record<string, unknown>, callId = randomUUID(), parent = 'file-parent') => {
            if (host === 'claude') recordClaudeCall(config, { hook_event_name: 'PreToolUse', tool_name: `mcp__runweft__${name}`, tool_use_id: callId, session_id: parent, cwd: h.cwd });
            const result = await client.callTool({ name, arguments: args, _meta: host === 'codex' ? { threadId: parent, sessionId: parent, callId } : { 'claudecode/toolUseId': callId } });
            return result.structuredContent as Record<string, any>;
        };
        const first = await call('spawn_agent', { agent_type: 'files', message: 'Files', outputs: [{ name: 'one', relativePath: 'one' }] });
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
    await h.tasks!.close();
    const restarted = new TaskCoordinator(h.statePath, ns => new HapiClient(h.nativeUrl, `test-${ns}`), 20); cleanup.push(() => restarted.close());
    expect(restarted.store.pending()).toContainEqual({ namespace: 'alpha', id: first.agent_id });
    h.faultsFiles.holdUnpin = false; restarted.start();
    await until(() => restarted.read('alpha', h.parent, first.agent_id), value => value.artifacts.retention.state === 'released');
    expect((await h.artifacts.refs(done.artifacts.manifest.items[0].artifactId)).references).toEqual([]);
    const next = await restarted.send('alpha', { parent: h.parent, requestId: randomUUID(), intent: { id: first.agent_id, message: 'new explicit round', mode: 'next' } });
    const resumed = await until(() => restarted.read('alpha', h.parent, first.agent_id, { roundId: next.round_id }), value => value.inputs[0]?.observation?.phase === 'accepted');
    expect(resumed.session_id).toBe(running.session_id); expect(resumed.artifacts.retention.state).toBe('retained');
    expect(h.calls.spawn).toBe(1); expect(h.calls.resume).toBe(1);
});

test('release rejects active rounds and foreign parents, while a missing uncaptured output needs no discard', async () => {
    const h = await harness(); const first = await h.spawn(['missing']);
    await expect(h.post('artifacts/release', { id: first.agent_id, apply: true })).rejects.toMatchObject({ code: 'artifact_release_active' });
    const running = await h.started(first.agent_id); h.complete(running.session_id); await h.finished(first.agent_id);
    await expect(h.post('artifacts/release', { id: first.agent_id, parent: { kind: 'mcp', host: 'codex', nativeSessionId: 'foreign', cwd: h.cwd, machineId: 'own' }, apply: true })).rejects.toMatchObject({ code: 'task_parent_mismatch' });
    expect((await h.post('artifacts/release', { id: first.agent_id })).can_release).toBe(true);
    await h.post('artifacts/release', { id: first.agent_id, apply: true });
    const done = await until(() => h.post('read', { id: first.agent_id }), value => value.artifacts.retention.state === 'released');
    expect(done.artifacts.status).toBe('incomplete'); expect(h.callsFiles.release).toBe(1);
    expect([...h.operations.values()].find(value => value.request.action === 'capture')?.retention).toBe('released');
});


test('recovering input-copy cleanup preserves a simultaneous incomplete output warning', async () => {
    const h = await harness();
    const input = h.service.reserve('alpha', { requestId: randomUUID(), filename: 'input.txt', mimeType: 'text/plain', size: 1, sha256: createHash('sha256').update('x').digest('hex') });
    await h.service.upload('alpha', input.id, new Response('x').body);
    const first = await h.post('spawn', { ...h.payload(), intent: { ...h.intent, inputs: [{ artifactId: input.id }], outputs: [{ name: 'missing', relativePath: 'missing' }] } });
    const running = await h.started(first.agent_id); h.faultsFiles.inputCleanupLost = true; h.complete(running.session_id);
    const done = await until(() => h.post('read', { id: first.agent_id }), value => value.status === 'completed' && value.input_files.download_retention === 'released');
    expect(done.artifacts.status).toBe('incomplete'); expect(done.attention.code).toBe('artifacts_incomplete');
    expect(done.attention.hint).toContain('collect'); expect(h.calls.send).toBe(1);
    h.faultsFiles.unpinLost = true;
    await h.post('artifacts/release', { id: first.agent_id, apply: true });
    const released = await until(() => h.post('read', { id: first.agent_id }), value => value.artifacts.retention.state === 'released');
    expect(released.attention.code).toBe('artifacts_incomplete'); expect(released.attention.hint).toContain('留存已释放');
});
