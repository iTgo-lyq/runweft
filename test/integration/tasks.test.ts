import { saveTestConnection } from '../identity-fixture';
import { afterEach, expect, test } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { resourceInspection } from './native-fixture';
import { HubTaskClient } from '../../src/hub/delegation/client';
import { HubClient } from '../../src/hub/client';
import { hubConnectionPaths } from '../../src/hub/resources/connection';
import { atomicWrite } from '../../src/config';
import { hubDelegationFixture } from './hub-delegation-fixture';
import { until } from '../helpers';
import type { Acceptance, Parent } from '../../src/tasks/types';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

test('concurrent accepted requests run once, persist child role before input and finish only after stop', async () => {
    const h = await hubDelegationFixture(cleanups), request = h.payload();
    h.faults.stop = true;
    h.onInput(() => {
        const session = [...h.sessions.keys()][0];
        expect(() => h.gateway.delegation.coordinator.store.assertCanDelegate(h.namespace, { ...h.parent, hapiSessionId: session })).toThrow('再次');
        expect(() => h.gateway.delegation.coordinator.store.assertCanDelegate(h.namespace, { kind: 'mcp', machineId: h.machineId, cwd: h.cwd, host: 'codex', nativeSessionId: `native-${session}` })).toThrow('再次');
    });
    const accepted = await Promise.all(Array.from({ length: 6 }, () => h.post('spawn', request))) as Acceptance[];
    expect(new Set(accepted.map(item => item.agent_id)).size).toBe(1);
    const id = accepted[0].agent_id;
    const running = await until(() => h.post('read', { id }), value => value.inputs[0]?.observation?.phase === 'accepted');
    expect(running.status).toBe('running'); expect(h.calls.spawn).toBe(1); expect(h.calls.send).toBe(1);
    h.complete(running.session_id, 'x'.repeat(5000));
    const stopping = await until(() => h.post('read', { id }), value => value.attention?.code === 'task_stop_unknown');
    expect(stopping.status).toBe('unknown'); expect(stopping.report.total).toBe(5000); expect(stopping.finish).toBe('pending');
    h.faults.stop = false;
    const done = await until(() => h.post('read', { id }), value => value.status === 'completed');
    expect(done.stop).toBe('stopped'); expect(done.finish).toBe('complete'); expect(done.inputs[0].observation.source).toBe('native');
    expect(h.sessions.get(running.session_id)?.session.active).toBe(false);
    const waited = await h.post('wait', { ids: [id], timeoutMs: 0 });
    expect(waited.timed_out).toBe(false); expect(waited.agents[0].report.text).toHaveLength(4000); expect(waited.agents[0].report.next_offset).toBe(4000);
    expect((await h.post('read', { id, offset: 4000 })).report.text).toHaveLength(1000);
    expect(readdirSync(h.cwd)).toEqual([]); expect(existsSync(join(h.cwd, '.git'))).toBe(false);
    h.gateway.agents.update(h.actor, h.agent.id, { expectedVersion: 1, definition: { ...h.definition, instructions: 'edited after acceptance' } });
    expect(await h.post('spawn', request)).toMatchObject(accepted[0]);
    await expect(h.post('spawn', { ...request, intent: { ...request.intent, message: 'different' } })).rejects.toMatchObject({ code: 'task_request_conflict' });
    expect(h.calls.spawn).toBe(1);
});

test('MCP parents, namespaces and shared targets are constrained without treating unrelated native children as ours', async () => {
    const h = await hubDelegationFixture(cleanups);
    const parent: Parent = { kind: 'mcp', machineId: h.machineId, cwd: h.cwd, host: 'codex', nativeSessionId: 'parent-one' };
    const accepted = await h.post('spawn', { ...h.payload(), parent });
    await expect(h.post('read', { id: accepted.agent_id, parent: { ...parent, nativeSessionId: 'other' } })).rejects.toMatchObject({ status: 403 });
    expect((await h.request('read', { parent: h.parent, id: accepted.agent_id }, await h.token(h.other.token))).status).toBe(404);
    expect((await h.request('read', { parent: h.parent, id: accepted.agent_id }, await h.token(h.other.token, h.other.personalSpace.id))).status).toBe(404);
    expect((await h.post('list', { parent: { ...parent, nativeSessionId: 'other' } })).agents).toEqual([]);
    expect((await h.post('list', { all: true })).agents[0].accepted_requests[0].request_id).toBe(accepted.request_id);
    expect((await h.post('list')).agents[0].agent_id).toBe(accepted.agent_id);
    const remoteMachine = h.machine();
    const remote = h.gateway.resources.store.registerRuntime(h.actor, { machineId: remoteMachine, flavor: 'codex' }, resourceInspection('codex'));
    const payload = h.payload(), remoteRequest = { ...payload, intent: { ...payload.intent, runtimeId: remote.id } };
    await expect(h.post('spawn', remoteRequest)).rejects.toMatchObject({ code: 'shared_target_required' });
    await expect(h.post('spawn', { ...h.payload(), intent: { ...h.payload().intent, workspaceMode: 'remote' } })).rejects.toMatchObject({ code: 'invalid_task_request' });
    const foreign = await h.post('spawn', { ...h.payload(), parent: { ...h.parent, hapiSessionId: 'unrelated-other-hub-session' } });
    expect(foreign.accepted).toBe(true);
});

test('lost spawn and input responses recover by receipt and local ID; absent receipts are never resent', async () => {
    const h = await hubDelegationFixture(cleanups); h.faults.spawn = 'lost'; h.faults.send = 'lost';
    const accepted = await h.post('spawn', h.payload());
    const running = await until(() => h.post('read', { id: accepted.agent_id }), value => value.inputs[0]?.observation?.phase === 'accepted');
    expect(running.inputs[0].delivery).toBe('stored'); expect(h.calls.spawn).toBe(1); expect(h.calls.send).toBe(1);
    h.complete(running.session_id);
    await until(() => h.post('read', { id: accepted.agent_id }), value => value.status === 'completed');
    h.faults.spawn = 'unseen'; const unknown = await h.post('spawn', h.payload());
    await until(() => h.post('read', { id: unknown.agent_id }), value => value.attention?.code === 'task_spawn_unknown');
    await Bun.sleep(80);
    expect(h.calls.spawn).toBe(2); expect(h.calls.send).toBe(1);
});

test('unconfirmed input and cancelled waits do not replay or stop execution', async () => {
    const h = await hubDelegationFixture(cleanups); h.faults.send = 'unseen';
    const accepted = await h.post('spawn', h.payload());
    const unknown = await until(() => h.post('read', { id: accepted.agent_id }), value => value.status === 'unknown');
    const abort = new AbortController();
    const client = new HubClient({ url: h.url, space: h.space, credential: { token: h.owner.token }, env: {} }, 'hubDelegation', 'hub_delegation_unavailable');
    const wait = client.http.request('/api/runweft/tasks/wait', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ parent: h.parent, ids: [accepted.agent_id], timeoutMs: 2000, afterRevision: { [accepted.agent_id]: unknown.revision } }), signal: abort.signal });
    await Bun.sleep(30); abort.abort(); await expect(wait).rejects.toBeDefined();
    await Bun.sleep(100); expect(h.calls.send).toBe(1); expect(h.calls.stop).toBe(0);
    const later = await h.post('read', { id: accepted.agent_id }); expect(later.revision).toBe(unknown.revision);
});

test('new coordinator reconciles persisted attempted steps; mismatch closes exact returned execution without task input', async () => {
    const h = await hubDelegationFixture(cleanups); h.faults.mismatch = true;
    const accepted = await h.post('spawn', h.payload());
    const failed = await until(() => h.post('read', { id: accepted.agent_id }), value => value.status === 'failed');
    expect(failed.attention.code).toBe('execution_target_mismatch'); expect(failed.stop).toBe('stopped'); expect(h.calls.send).toBe(0);
    await h.gateway.delegation.close();
    // Seed a crash in an already accepted center task after its durable spawn intent.
    const payload = h.payload();
    const store = h.gateway.delegation.coordinator.store;
    const previous = store.require(h.namespace, accepted.agent_id).task;
    const queued = store.accept(h.namespace, h.parent, payload.requestId, { agentType: h.agent.id, message: payload.intent.message, workspaceMode: 'shared' }, previous.agent, previous.target), id = queued.agent_id;
    const bundle = store.require(h.namespace, id), round = bundle.rounds[0];
    round.phase = 'starting'; round.spawnAttempted = true;
    store.save(bundle.task, round, bundle.inputs);
    await h.restart();
    await until(() => h.post('read', { id }), value => value.attention?.code === 'task_spawn_unknown');
    expect(h.calls.spawn).toBe(1); expect(h.calls.send).toBe(0);
});

test('lost client acceptance resolves before withdrawn central Agent configuration, without another execution', async () => {
    const h = await hubDelegationFixture(cleanups), home = join(h.home, 'client');
    let drop = true;
    const proxy = Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(request) {
        const url = new URL(request.url);
        const response = await fetch(h.url + url.pathname, { method: request.method, headers: request.headers,
            ...(request.method === 'POST' ? { body: await request.arrayBuffer() } : {}) });
        const body = await response.arrayBuffer();
        if (drop && url.pathname.endsWith('/tasks/spawn')) { drop = false; return new Response('', { status: 502 }); }
        return new Response(body, { status: response.status, headers: { 'content-type': 'application/json' } });
    }});
    cleanups.push(() => proxy.stop(true));
    const paths = hubConnectionPaths(home, proxy.url.origin), credential = h.machineConnections.get(h.machineId)!;
    await saveTestConnection(home, proxy.url.origin, h.owner.token, h.space);
    atomicWrite(paths.machineConnection, JSON.stringify({ schemaVersion: 1, hub: proxy.url.origin, ownerId: h.owner.identity.id, requestId: credential.requestId,
        machineId: h.machineId, active: { token: credential.token, credentialId: credential.credentialId }, createdAt: Date.now() }));
    const options = { url: proxy.url.origin, home, env: { ...process.env, GIT_CEILING_DIRECTORIES: h.home } };
    const client = new HubTaskClient(options, '/'), requestId = crypto.randomUUID();
    await expect(client.spawn(h.agent.id, 'Actual task', requestId)).rejects.toMatchObject({ status: 502 });
    const listed = (await client.list()).agents[0];
    const accepted = { agent_id: listed.agent_id, round_id: listed.round_id, request_id: requestId, revision: 1, accepted: true };
    const child = await until(() => client.read(accepted.agent_id), value => !!value.session_id);
    h.gateway.agents.register(h.actor, h.agent.id, false);
    expect(await client.spawn(h.agent.id, 'Actual task', requestId)).toMatchObject(accepted);
    expect((await client.list()).agents[0].request_id).toBe(requestId);
    expect(h.calls.spawn).toBe(1);
    await expect(new HubTaskClient({ ...options, env: { ...options.env, HAPI_SESSION_ID: child.session_id } }, '/')
        .spawn(h.agent.id, 'Recursive', crypto.randomUUID())).rejects.toMatchObject({ code: 'subagent_delegation_denied' });
});

test('restart finishes a known native result and leaves an uncertain send unreplayed', async () => {
    const h = await hubDelegationFixture(cleanups); h.faults.stop = true;
    const complete = await h.post('spawn', h.payload());
    const current = await until(() => h.post('read', { id: complete.agent_id }), value => value.inputs[0]?.observation?.phase === 'accepted');
    h.complete(current.session_id);
    await until(() => h.post('read', { id: complete.agent_id }), value => value.attention?.code === 'task_stop_unknown');
    h.faults.send = 'unseen';
    const unknown = await h.post('spawn', h.payload());
    await until(() => h.post('read', { id: unknown.agent_id }), value => value.status === 'unknown');
    h.faults.stop = false; await h.restart();
    const done = await until(() => h.post('read', { id: complete.agent_id }), value => value.status === 'completed');
    expect(done.report.text).toBe('Native final report'); expect(done.stop).toBe('stopped');
    await Bun.sleep(100);
    expect((await h.post('read', { id: unknown.agent_id })).status).toBe('unknown');
    expect(h.calls.spawn).toBe(2); expect(h.calls.send).toBe(2);
});
