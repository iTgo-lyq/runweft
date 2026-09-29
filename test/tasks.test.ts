import { afterEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from './helpers';
import { ResourceStore } from '../src/resources/store';
import { resourceInspection, resourceWrite } from './resources-fixture';
import { TaskCoordinator } from '../src/tasks/coordinator';
import { TaskClient } from '../src/tasks/client';
import { TaskStore } from '../src/tasks/store';
import { HapiClient } from '../src/hapi';
import { atomicWrite, dataPaths, loadConfig } from '../src/config';
import { initAgent } from '../src/agents/definitions';
import { taskFixture, until } from './tasks-fixture';
import type { Acceptance, Parent } from '../src/tasks/types';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

test('v1 resources migrate additively, preserving IDs and flags for both stores', () => {
    const home = fixture('state-upgrade'); cleanups.push(() => rmSync(home, { recursive: true, force: true }));
    const path = join(home, 'state.sqlite'), db = new Database(path);
    db.exec(`CREATE TABLE machine_registrations(namespace TEXT, machineId TEXT, registered INTEGER, createdAt INTEGER, updatedAt INTEGER, PRIMARY KEY(namespace,machineId));
        CREATE TABLE runtime_registrations(id TEXT PRIMARY KEY, namespace TEXT, machineId TEXT, flavor TEXT, name TEXT, registered INTEGER, createdAt INTEGER, updatedAt INTEGER, inspection TEXT, inspectedAt INTEGER, UNIQUE(namespace,machineId,flavor));
        PRAGMA user_version=1;`);
    db.query('INSERT INTO machine_registrations VALUES (?, ?, 1, 1, 1)').run('alpha', 'machine');
    const id = crypto.randomUUID();
    db.query('INSERT INTO runtime_registrations VALUES (?, ?, ?, ?, ?, 0, 1, 1, ?, 1)').run(id, 'alpha', 'machine', 'codex', 'Existing', JSON.stringify(resourceInspection('codex'))); db.close();
    const tasks = new TaskStore(path); tasks.close();
    const resources = new ResourceStore(path);
    try { expect(resources.runtime('alpha', id)).toMatchObject({ id, registered: false, name: 'Existing' }); expect(resources.machine('alpha', 'machine')?.registered).toBe(true); }
    finally { resources.close(); }
});

test('concurrent accepted requests run once, persist child role before input and finish only after stop', async () => {
    const h = await taskFixture(cleanups), request = h.payload();
    h.faults.stop = true;
    h.onInput(() => {
        const session = [...h.sessions.keys()][0];
        expect(() => h.tasks!.store.assertCanDelegate('alpha', { ...h.parent, hapiSessionId: session })).toThrow('再次');
        expect(() => h.tasks!.store.assertCanDelegate('alpha', { kind: 'mcp', machineId: 'own', cwd: h.cwd, host: 'codex', nativeSessionId: `native-${session}` })).toThrow('再次');
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
    expect(await h.post('spawn', { ...request, agent: { ...request.agent, definitionVersion: 'edited' } })).toMatchObject(accepted[0]);
    await expect(h.post('spawn', { ...request, intent: { ...request.intent, message: 'different' } })).rejects.toMatchObject({ code: 'task_request_conflict' });
    expect(h.calls.spawn).toBe(1);
});

test('MCP parents, namespaces and shared targets are constrained without treating unrelated native children as ours', async () => {
    const h = await taskFixture(cleanups);
    const parent: Parent = { kind: 'mcp', machineId: 'own', cwd: h.cwd, host: 'codex', nativeSessionId: 'parent-one' };
    const accepted = await h.post('spawn', { ...h.payload(), parent });
    await expect(h.post('read', { id: accepted.agent_id, parent: { ...parent, nativeSessionId: 'other' } })).rejects.toMatchObject({ status: 403 });
    await expect(h.beta.request('/api/runweft/tasks/read', resourceWrite({ parent: h.parent, id: accepted.agent_id }))).rejects.toMatchObject({ status: 404 });
    expect((await h.post('list', { parent: { ...parent, nativeSessionId: 'other' } })).agents).toEqual([]);
    expect((await h.post('list', { all: true })).agents[0].accepted_requests[0].request_id).toBe(accepted.request_id);
    expect((await h.post('list')).agents[0].agent_id).toBe(accepted.agent_id);
    const remote = await h.register('remote');
    await expect(h.post('spawn', { ...h.payload(), agent: { ...h.agent, runtimeId: remote.id, machineId: 'remote' } })).rejects.toMatchObject({ code: 'shared_target_required' });
    await expect(h.post('spawn', { ...h.payload(), intent: { ...h.intent, workspaceMode: 'remote' } })).rejects.toMatchObject({ code: 'capability_unavailable' });
    const foreign = await h.post('spawn', { ...h.payload(), parent: { ...h.parent, hapiSessionId: 'unrelated-other-hub-session' } });
    expect(foreign.accepted).toBe(true);
});

test('lost spawn and input responses recover by receipt and local ID; absent receipts are never resent', async () => {
    const h = await taskFixture(cleanups); h.faults.spawn = 'lost'; h.faults.send = 'lost';
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
    const h = await taskFixture(cleanups); h.faults.send = 'unseen';
    const accepted = await h.post('spawn', h.payload());
    const unknown = await until(() => h.post('read', { id: accepted.agent_id }), value => value.status === 'unknown');
    const abort = new AbortController();
    const wait = h.alpha.request('/api/runweft/tasks/wait', { ...resourceWrite({ parent: h.parent, ids: [accepted.agent_id], timeoutMs: 2000, afterRevision: { [accepted.agent_id]: unknown.revision } }), signal: abort.signal });
    await Bun.sleep(30); abort.abort(); await expect(wait).rejects.toBeDefined();
    await Bun.sleep(100); expect(h.calls.send).toBe(1); expect(h.calls.stop).toBe(0);
    const later = await h.post('read', { id: accepted.agent_id }); expect(later.revision).toBe(unknown.revision);
});

test('new coordinator reconciles persisted attempted steps; mismatch closes exact returned execution without task input', async () => {
    const h = await taskFixture(cleanups); h.faults.mismatch = true;
    const accepted = await h.post('spawn', h.payload());
    const failed = await until(() => h.post('read', { id: accepted.agent_id }), value => value.status === 'failed');
    expect(failed.attention.code).toBe('execution_target_mismatch'); expect(failed.stop).toBe('stopped'); expect(h.calls.send).toBe(0);
    await h.tasks!.close();
    const target = { runtimeId: h.runtime.id, machineId: 'own', flavor: 'codex' as const, inspection: h.runtime.inspection! };
    // Seed a crash after durable spawn intent but before any response; the restarted worker must query only.
    const seed = new TaskStore(h.statePath);
    const id = seed.accept('alpha', h.parent, crypto.randomUUID(), h.intent, h.agent, target).agent_id;
    const bundle = seed.require('alpha', id), round = bundle.rounds[0];
    round.phase = 'starting'; round.spawnAttempted = true;
    seed.save(bundle.task, round, bundle.inputs); seed.close();
    const restarted = new TaskCoordinator(h.statePath, ns => new HapiClient(h.nativeUrl, `test-${ns}`), 20);
    try {
        restarted.start();
        await until(() => restarted.read('alpha', h.parent, id), value => value.attention?.code === 'task_spawn_unknown');
        expect(h.calls.spawn).toBe(1); expect(h.calls.send).toBe(0);
    } finally { await restarted.close(); }
});

test('lost client acceptance resolves before reading removed agent files, without another execution', async () => {
    const h = await taskFixture(cleanups);
    const config = loadConfig(h.home, { ...process.env, GIT_CEILING_DIRECTORIES: h.home });
    atomicWrite(join(dataPaths(config).hapiClient, 'settings.json'), JSON.stringify({ machineId: 'own' }));
    const document = initAgent(config, h.cwd, 'review', { runtime: h.runtime.id });
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
    const client = new TaskClient(config, h.cwd, undefined, new HapiClient(proxy.url.origin, 'test-alpha'));
    const requestId = crypto.randomUUID();
    await expect(client.spawn('review', 'Actual task', requestId)).rejects.toMatchObject({ status: 502 });
    const listed = (await client.list()).agents[0];
    const accepted = { agent_id: listed.agent_id, round_id: listed.round_id, request_id: requestId, revision: 1, accepted: true };
    rmSync(document.source.path);
    expect(await client.spawn('review', 'Actual task', requestId)).toMatchObject(accepted);
    expect((await client.list()).agents[0].request_id).toBe(requestId);
    const child = await until(() => client.read(accepted.agent_id), value => !!value.session_id);
    expect(h.calls.spawn).toBe(1);
    const childConfig = { ...config, env: { ...config.env, HAPI_SESSION_ID: child.session_id } };
    await expect(new TaskClient(childConfig, h.cwd, undefined, h.alpha).spawn('review', 'Recursive', crypto.randomUUID())).rejects.toMatchObject({ code: 'subagent_delegation_denied' });
});

test('restart finishes a known native result and leaves an uncertain send unreplayed', async () => {
    const h = await taskFixture(cleanups); h.faults.stop = true;
    const complete = await h.post('spawn', h.payload());
    const current = await until(() => h.post('read', { id: complete.agent_id }), value => value.inputs[0]?.observation?.phase === 'accepted');
    h.complete(current.session_id);
    await until(() => h.post('read', { id: complete.agent_id }), value => value.attention?.code === 'task_stop_unknown');
    h.faults.send = 'unseen';
    const unknown = await h.post('spawn', h.payload());
    await until(() => h.post('read', { id: unknown.agent_id }), value => value.status === 'unknown');
    await h.tasks!.close(); h.faults.stop = false;
    const resumed = new TaskCoordinator(h.statePath, ns => new HapiClient(h.nativeUrl, `test-${ns}`), 20);
    try {
        resumed.start();
        const done = await until(() => resumed.read('alpha', h.parent, complete.agent_id), value => value.status === 'completed');
        expect(done.report.text).toBe('Native final report'); expect(done.stop).toBe('stopped');
        await Bun.sleep(100);
        expect(resumed.read('alpha', h.parent, unknown.agent_id).status).toBe('unknown');
        expect(h.calls.spawn).toBe(2); expect(h.calls.send).toBe(2);
    } finally { await resumed.close(); }
});
