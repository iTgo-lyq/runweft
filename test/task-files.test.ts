import { fixtureCleanup } from './fixture-cleanup';
import { afterEach, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from '../hapi/hub/node_modules/hono';
import type { ArtifactTransfer, MaterializeRequest } from '../hapi/shared/src/artifactTransfers';
import { ARTIFACT_DEFAULT_LIMITS } from '../hapi/shared/src/artifacts';
import { Store } from '../hapi/hub/src/store';
import { ArtifactService } from '../hapi/hub/src/artifacts/service';
import { createArtifactRoutes } from '../hapi/hub/src/web/routes/artifacts';
import type { WebAppEnv } from '../hapi/hub/src/web/middleware/auth';
import { ArtifactClient } from '../src/artifacts/client';
import { HubClient } from '../src/hub/client';
import { taskInputs } from '../src/tasks/commands';
import { hubWorkspaceFixture } from './hub-workspace-fixture';
import { until } from './helpers';
import { workspaces } from './workspaces-fixture';
import { fixture } from './helpers';

const cleanupOwner = fixtureCleanup([]), cleanup = cleanupOwner.resources;
afterEach(() => cleanupOwner.close());
async function harness(worktree = false) {
    const owned = fixtureCleanup(cleanup);
    try {
        const root = fixture('task-files'); owned.resources.push(() => rmSync(root, { recursive: true, force: true }));
        const store = new Store(join(root, 'hapi.db')); owned.resources.push(() => store.close());
        const service = new ArtifactService(store.artifacts, join(root, 'artifacts'), ARTIFACT_DEFAULT_LIMITS);
        const operations = new Map<string, ArtifactTransfer>(), requests: string[] = [], git = workspaces();
        const faults = { pinResponse: false, hold: false, transferFailure: false, transferResponse: false, inspectUnknown: false, releaseLost: false };
        const h = await hubWorkspaceFixture(owned.resources, 'codex', worktree ? git.handler : undefined, async (request, namespace) => {
            const path = new URL(request.url).pathname;
            if (path.startsWith('/api/artifacts')) {
                const app = new Hono<WebAppEnv>(); app.use('*', async (c, next) => { c.set('namespace', namespace); await next(); });
                app.route('/api', createArtifactRoutes(service)); const response = await app.fetch(request);
                if (request.method === 'PUT' && path.includes('/references/') && faults.pinResponse) { faults.pinResponse = false; return new Response('', { status: 502 }); }
                return response;
            }
            if (!/\/api\/machines\/[^/]+\/artifacts$/.test(path)) return;
            const body = await request.json() as MaterializeRequest & { action: string };
            requests.push(body.action);
            let operation = operations.get(body.operationId);
            if (!operation && body.action !== 'materialize') return Response.json({ code: 'artifact_operation_missing' }, { status: 409 });
            if (body.action === 'materialize') {
                if (operation) expect(operation.request).toEqual(body);
                else {
                    operation = { version: 1, request: body, status: 'accepted', createdAt: Date.now(), updatedAt: Date.now(), retention: 'retained', files: [], sessions: [] };
                    operations.set(body.operationId, operation);
                }
                if (faults.transferResponse) { faults.transferResponse = false; return new Response('', { status: 502 }); }
            } else if (body.action === 'release') {
                expect([...h.sessions.values()].filter(native => native.session.metadata?.preparedFiles?.operationId === body.operationId).every(native => !native.session.active)).toBe(true);
                operation!.retention = 'released';
                if (faults.releaseLost) { faults.releaseLost = false; return new Response('', { status: 502 }); }
            }
            else if (body.action === 'inspect') {
                if (faults.inspectUnknown) { faults.inspectUnknown = false; operation!.status = 'unknown'; }
                else if (!faults.hold) {
                    operation!.status = faults.transferFailure ? 'failed' : 'succeeded';
                    if (faults.transferFailure) operation!.error = { code: 'artifact_input_mismatch', message: 'Fixture checksum mismatch' };
                    else if (operation!.request.action === 'materialize') operation!.files = operation!.request.files.map(input => ({ ...input, path: `/prepared-files/${body.operationId}/${input.name}` }));
                }
            }
            return Response.json({ operation });
        });
        const http = () => new HubClient({ url: h.url, space: h.space, env: { RUNWEFT_IDENTITY_TOKEN: h.owner.token } }, 'hubAccess', 'hub_access_unavailable').http;
        const artifacts = new ArtifactClient({ request: (path, options) => http().request(path, options), response: (path, options) => http().response(path, options) });
        async function upload(name = '设计 说明.txt') {
            const path = join(root, name); writeFileSync(path, randomUUID()); return artifacts.upload(path, randomUUID());
        }
        return Object.assign(h, { artifacts, upload, service, store, operations, requests, faultsFiles: faults, git });
    } catch (error) { return owned.failed(error); }
}

test('acceptance freezes input names, pins once, gates startup and passes prepared paths into the prompt', async () => {
    const h = await harness(); h.faultsFiles.hold = true; h.faultsFiles.transferResponse = true;
    const file = await h.upload(), request = { ...h.payload(), intent: { ...h.payload().intent, inputs: [{ artifactId: file.id }] } };
    const accepted = await Promise.all([h.post('spawn', request), h.post('spawn', request)]);
    expect(accepted[0]).toEqual(accepted[1]); expect(h.gateway.delegation.coordinator.store.pendingArtifactIntents()).toEqual([]);
    const current = await until(() => h.post('read', { id: accepted[0].agent_id }), value => value.input_files?.status === 'accepted');
    expect(current.input_files.files).toEqual([{ artifactId: file.id, name: file.filename, size: file.size, sha256: file.sha256 }]);
    expect(h.calls.spawn).toBe(0); expect(h.calls.send).toBe(0); expect(h.requests.filter(item => item === 'materialize')).toHaveLength(1);
    expect((await h.artifacts.refs(file.id)).references).toHaveLength(1); await expect(h.artifacts.remove(file.id)).rejects.toMatchObject({ code: 'artifact_referenced' });
    await expect(h.post('spawn', { ...request, intent: { ...request.intent, inputs: [] } })).rejects.toMatchObject({ code: 'task_request_conflict' });
    h.faultsFiles.hold = false;
    const running = await until(() => h.post('read', { id: accepted[0].agent_id }), value => value.inputs[0]?.observation?.phase === 'accepted');
    expect(JSON.stringify(h.sessions.get(running.session_id)!.messages)).toContain('/prepared-files/');
    expect(h.sessions.get(running.session_id)?.session.metadata?.preparedFiles?.operationId).toBe(running.input_files.operation_id);
    h.complete(running.session_id); await until(() => h.post('read', { id: accepted[0].agent_id }), value => value.status === 'completed');
    expect(h.calls.spawn).toBe(1); expect(h.calls.send).toBe(1);
});

test('new-round inputs replace the native binding and an input-free round explicitly clears it', async () => {
    const h = await harness(), one = await h.upload('one.txt'), two = await h.upload('two.txt');
    const accepted = await h.post('spawn', { ...h.payload(), intent: { ...h.payload().intent, inputs: [{ artifactId: one.id }] } });
    let running = await until(() => h.post('read', { id: accepted.agent_id }), value => value.inputs[0]?.observation?.phase === 'accepted');
    const sessionId = running.session_id;
    h.complete(sessionId); await until(() => h.post('read', { id: accepted.agent_id }), value => value.status === 'completed');
    for (const inputs of [[{ artifactId: two.id, name: '第二 轮.txt' }], []]) {
        const next = await h.post('send', { requestId: randomUUID(), intent: { id: accepted.agent_id, mode: 'next', message: 'next', inputs } });
        running = await until(() => h.post('read', { id: accepted.agent_id, roundId: next.round_id }), value => value.inputs[0]?.observation?.phase === 'accepted');
        expect(running.session_id).toBe(sessionId);
        expect(h.sessions.get(sessionId)?.session.metadata?.preparedFiles?.operationId).toBe(inputs.length ? running.input_files.operation_id : undefined);
        h.complete(sessionId); await until(() => h.post('read', { id: accepted.agent_id, roundId: next.round_id }), value => value.status === 'completed');
    }
    expect(h.calls.spawn).toBe(1); expect(h.calls.resume).toBe(2);
    expect((await h.artifacts.refs(one.id)).references).toHaveLength(1); expect((await h.artifacts.refs(two.id)).references).toHaveLength(1);
});

test('worktree copies the verified inputs and releases the intermediate download before native execution', async () => {
    const h = await harness(true), file = await h.upload();
    const accepted = await h.post('spawn', { ...h.payload(), intent: { ...h.payload().intent, workspaceMode: 'worktree', inputs: [{ artifactId: file.id }] } });
    const running = await until(() => h.post('read', { id: accepted.agent_id }), value => value.inputs[0]?.observation?.phase === 'accepted');
    const prepare = h.git.calls.find(call => call.action === 'prepare'); expect(prepare?.action).toBe('prepare');
    if (prepare?.action === 'prepare') expect(prepare.inputs[0]).toMatchObject({ name: file.filename, sha256: file.sha256, size: file.size });
    expect(running.input_files.paths[0].path).toStartWith('/workspace-inputs/');
    expect(h.operations.get(running.input_files.operation_id)?.retention).toBe('released');
    expect(h.sessions.get(running.session_id)?.session.metadata?.preparedFiles).toBeUndefined();
    expect(JSON.stringify(h.sessions.get(running.session_id)?.messages)).toContain('/workspace-inputs/');
});

test('definite file preparation failures end without a model and unknown transfer receipts retry only the same download', async () => {
    const h = await harness(), file = await h.upload(); h.faultsFiles.transferFailure = true;
    const first = await h.post('spawn', { ...h.payload(), intent: { ...h.payload().intent, inputs: [{ artifactId: file.id }] } });
    const failed = await until(() => h.post('read', { id: first.agent_id }), value => value.status === 'failed');
    expect(failed.execution_not_started).toBe(true); expect(failed.attention.scope).toBe('artifacts'); expect(h.calls.spawn).toBe(0);
    h.faultsFiles.transferFailure = false; h.faultsFiles.inspectUnknown = true;
    const second = await h.post('spawn', { ...h.payload(), intent: { ...h.payload().intent, inputs: [{ artifactId: file.id }] } });
    await until(() => h.post('read', { id: second.agent_id }), value => value.inputs[0]?.observation?.phase === 'accepted');
    expect(h.operations.size).toBe(2); expect(h.calls.spawn).toBe(1); expect(h.calls.send).toBe(1);
});

test('uncertain pins retain their intent, identical retry accepts once, startup cleans only known unaccepted references', async () => {
    const h = await harness(), file = await h.upload(), other = await h.upload('other.txt'); h.faultsFiles.pinResponse = true;
    const request = { ...h.payload(), intent: { ...h.payload().intent, inputs: [{ artifactId: file.id }] } };
    await expect(h.post('spawn', request)).rejects.toMatchObject({ status: 502 });
    expect(h.gateway.delegation.coordinator.store.pendingArtifactIntents()).toHaveLength(1); expect((await h.artifacts.refs(file.id)).references).toHaveLength(1);
    await expect(h.post('spawn', { ...request, intent: h.payload().intent })).rejects.toMatchObject({ code: 'task_request_conflict' });
    const accepted = await h.post('spawn', request); expect(await h.post('spawn', request)).toEqual(accepted);
    expect(h.gateway.delegation.coordinator.store.pendingArtifactIntents()).toEqual([]); expect((await h.artifacts.refs(file.id)).references).toHaveLength(1);
    h.faultsFiles.pinResponse = true;
    await expect(h.post('spawn', { ...h.payload(), intent: { ...h.payload().intent, inputs: [{ artifactId: other.id }] } })).rejects.toMatchObject({ status: 502 });
    await h.artifacts.pin(other.id, 'external-recovery', 'recovery'); await h.restart();
    await until(() => h.gateway.delegation.coordinator.store.pendingArtifactIntents(), pending => !pending.length);
    expect((await h.artifacts.refs(other.id)).references.map(ref => ref.reference)).toEqual(['external-recovery']);
    expect((await h.artifacts.refs(file.id)).references).toHaveLength(1);
});

test('duplicate names, unpublished objects, unauthorized parents and steer inputs do not create task references', async () => {
    const h = await harness(), file = await h.upload();
    const request = { ...h.payload(), intent: { ...h.payload().intent, inputs: [{ artifactId: file.id }, { artifactId: file.id }] } };
    await expect(h.post('spawn', request)).rejects.toMatchObject({ code: 'artifact_input_name_duplicate' });
    expect(h.gateway.delegation.coordinator.store.pendingArtifactIntents()).toEqual([]); expect((await h.artifacts.refs(file.id)).references).toEqual([]);
    const reserved = (await h.artifacts.hapi.request('/api/artifacts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: randomUUID(), filename: 'pending.txt', mimeType: 'text/plain', size: 1, sha256: '0'.repeat(64) }) })).artifact;
    await expect(h.post('spawn', { ...h.payload(), intent: { ...h.payload().intent, inputs: [{ artifactId: reserved.id }] } })).rejects.toMatchObject({ code: 'artifact_input_unavailable' });
    expect(h.gateway.delegation.coordinator.store.pendingArtifactIntents()).toEqual([]);
    const parent = { kind: 'mcp', host: 'codex', nativeSessionId: 'parent-one', cwd: h.cwd, machineId: h.machineId };
    const accepted = await h.post('spawn', { ...h.payload(), parent });
    await expect(h.post('send', { parent: { ...parent, nativeSessionId: 'other' }, requestId: randomUUID(), intent: {
        id: accepted.agent_id, mode: 'next', message: 'next', inputs: [{ artifactId: file.id }] } })).rejects.toMatchObject({ status: 403 });
    await expect(h.post('send', { parent, requestId: randomUUID(), intent: {
        id: accepted.agent_id, mode: 'steer', roundId: accepted.round_id, message: 'steer', inputs: [{ artifactId: file.id }] } })).rejects.toMatchObject({ status: 400 });
    expect((await h.artifacts.refs(file.id)).references).toEqual([]);
    expect(taskInputs([`设计 = 说明.txt=${file.id}`, file.id])).toEqual([{ name: '设计 = 说明.txt', artifactId: file.id }, { artifactId: file.id }]);
    expect(() => taskInputs([`../escape=${file.id}`])).toThrow('参数无效');
});


test('stopped shared rounds automatically release only the input copy, then explicit release removes only their own pins', async () => {
    const h = await harness(), file = await h.upload();
    const first = await h.post('spawn', { ...h.payload(), intent: { ...h.payload().intent, inputs: [{ artifactId: file.id }] } });
    const running = await until(() => h.post('read', { id: first.agent_id }), value => value.inputs[0]?.observation?.phase === 'accepted');
    expect(h.operations.get(running.input_files.operation_id)?.retention).toBe('retained');
    h.faultsFiles.releaseLost = true; h.complete(running.session_id);
    const done = await until(() => h.post('read', { id: first.agent_id }), value => value.status === 'completed' && value.input_files.download_retention === 'released');
    expect(h.operations.get(running.input_files.operation_id)?.retention).toBe('released');
    expect(h.requests.filter(action => action === 'release')).toHaveLength(1);
    expect((await h.artifacts.refs(file.id)).references).toHaveLength(1);
    await h.artifacts.pin(file.id, 'external:recovery', 'recovery');
    const second = await h.post('send', { requestId: randomUUID(), intent: { id: first.agent_id, message: 'next', mode: 'next', inputs: [{ artifactId: file.id }] } });
    const next = await until(() => h.post('read', { id: first.agent_id, roundId: second.round_id }), value => value.inputs[0]?.observation?.phase === 'accepted');
    await expect(h.post('artifacts/release', { id: first.agent_id, roundId: first.round_id, apply: true })).rejects.toMatchObject({ code: 'artifact_release_active' });
    h.complete(next.session_id); await until(() => h.post('read', { id: first.agent_id }), value => value.status === 'completed');
    expect((await h.post('artifacts/release', { id: first.agent_id })).rounds).toHaveLength(2);
    await h.post('artifacts/release', { id: first.agent_id, roundId: first.round_id, apply: true });
    await until(() => h.post('read', { id: first.agent_id, roundId: first.round_id }), value => value.artifacts.retention.state === 'released');
    expect((await h.artifacts.refs(file.id)).references).toHaveLength(2); // Later round + external recovery.
    await h.post('artifacts/release', { id: first.agent_id, apply: true });
    await until(() => h.post('read', { id: first.agent_id }), value => value.artifacts.retention.state === 'released');
    expect((await h.artifacts.refs(file.id)).references.map(item => item.purpose)).toEqual(['recovery']);
    expect((await h.post('read', { id: first.agent_id, roundId: first.round_id })).completed_revision).toBe(done.completed_revision);
    expect(h.calls.spawn).toBe(1); expect(h.calls.resume).toBe(1); expect(h.calls.send).toBe(2);
});
