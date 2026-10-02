import { Database } from 'bun:sqlite';
import { parentKey } from '../src/tasks/types';
import { afterEach, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { hubDelegationFixture } from './hub-delegation-fixture';
import { until } from './helpers';
import { resourceInspection } from './native-fixture';
import { createIdentityToken } from '../src/hub/store';
import { TaskStore } from '../src/tasks/store';
import { BaselineStore } from '../src/remote/store';

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanups.splice(0).reverse()) await fn(); });
const next = (id: string) => ({ requestId: randomUUID(), intent: { id, mode: 'next', message: 'Continue' } });

test('central acceptance owns task/session, fixes each round and resumes only compatible native launch configuration for both runtimes', async () => {
    for (const flavor of ['codex', 'claude'] as const) {
        const h = await hubDelegationFixture(cleanups, flavor), request = h.payload();
        const accepted = await h.post('spawn', request);
        expect(h.gateway.store.object('task', accepted.agent_id)).toMatchObject({ ownerId: h.owner.identity.id, spaceId: h.space, machineId: h.machineId });
        h.gateway.agents.update(h.actor, h.agent.id, { expectedVersion: 1, definition: { ...h.definition, instructions: 'version two' } });
        expect(await h.post('spawn', request)).toEqual(accepted);
        const active = await until(() => h.post('read', { id: accepted.agent_id }), v => v.inputs[0]?.observation?.phase === 'accepted');
        expect(active.agent.hub.version).toBe(1); expect(active.agent.definition.instructions).toBe('version one');
        expect(active.agent.source).not.toHaveProperty('path'); expect(active.agent.hub.target).not.toHaveProperty('inspection');
        expect(h.gateway.store.object('session', active.session_id)).toMatchObject({ ownerId: h.owner.identity.id, taskId: accepted.agent_id });
        const queued = await h.post('send', next(accepted.agent_id));
        h.gateway.agents.update(h.actor, h.agent.id, { expectedVersion: 2, definition: { ...h.definition, instructions: 'version three', model: 'changed-model' } });
        h.complete(active.session_id, 'First saved report');
        const resumed = await until(() => h.post('read', { id: accepted.agent_id }), v => v.inputs[0]?.observation?.phase === 'accepted');
        expect(resumed.round_id).toBe(queued.round_id); expect(resumed.session_id).toBe(active.session_id); expect(resumed.agent.hub.version).toBe(2);
        h.complete(resumed.session_id, 'Second saved report');
        await until(() => h.post('read', { id: accepted.agent_id }), v => v.status === 'completed');
        await h.post('send', next(accepted.agent_id));
        const changed = await until(() => h.post('read', { id: accepted.agent_id }), v => v.inputs[0]?.observation?.phase === 'accepted');
        expect(changed.session_id).not.toBe(active.session_id); expect(changed.agent.hub.version).toBe(3);
        expect(changed.reconstruction.reason).toBe('launch_configuration_changed'); expect(h.calls.resume).toBe(1); expect(h.calls.spawn).toBe(2);
        expect(JSON.stringify(h.sessions.get(changed.session_id)!.messages)).toContain('First saved report');
        const forged = await h.request('spawn', { ...h.payload(), agent: active.agent }); expect(forged.status).toBe(400);
        const other = await h.token(h.other.token);
        expect((await h.request('read', { parent: h.parent, id: accepted.agent_id }, other)).status).toBe(404);
        expect((await h.request('list', { parent: h.parent, all: true }, other)).body.agents).toEqual([]);
        expect((await h.request('spawn', { ...h.payload(), parent: { ...h.parent, hapiSessionId: changed.session_id } }, other)).body.error.code).toBe('subagent_delegation_denied');
    }
});

test('configuration races reject atomically; explicit runtime survives definition edits and changed default targets require a new task', async () => {
    const h = await hubDelegationFixture(cleanups);
    h.hooks.set(h.machineId, async () => {
        h.hooks.delete(h.machineId);
        h.gateway.agents.update(h.actor, h.agent.id, { expectedVersion: 1, definition: { ...h.definition, instructions: 'edited during probe' } });
    });
    await expect(h.post('spawn', h.payload())).rejects.toMatchObject({ code: 'agent_configuration_changed' });
    expect((await h.post('list', { all: true })).agents).toEqual([]); expect(h.calls.spawn).toBe(0);
    const request = h.payload(); Object.assign(request.intent, { runtimeId: h.runtime.id });
    const fixed = await h.post('spawn', request), defaultTask = await h.post('spawn', h.payload());
    const replacement = h.gateway.resources.store.registerRuntime(h.actor, { machineId: h.machine(), flavor: 'codex' }, resourceInspection('codex'));
    h.gateway.agents.update(h.actor, h.agent.id, { expectedVersion: 2, definition: { ...h.definition, runtimeId: replacement.id } });
    expect((await h.post('send', next(fixed.agent_id))).accepted).toBe(true);
    await expect(h.post('send', next(defaultTask.agent_id))).rejects.toMatchObject({ code: 'task_target_changed' });
    h.gateway.store.db.exec(`CREATE TEMP TRIGGER reject_task_binding BEFORE INSERT ON hub_execution_objects WHEN NEW.kind='task' BEGIN SELECT RAISE(ABORT, 'fixture binding failure'); END;`);
    const failed = h.payload(); Object.assign(failed.intent, { runtimeId: h.runtime.id });
    await expect(h.post('spawn', failed)).rejects.toMatchObject({ status: 500 });
    expect((await h.post('lookup', failed)).accepted).toBeNull(); expect((await h.post('list', { all: true })).agents).toHaveLength(2);
});

test('lost spawn receipts reconcile once and global recursion checks survive changing spaces', async () => {
    const h = await hubDelegationFixture(cleanups); h.faults.spawn = 'lost';
    const accepted = await h.post('spawn', h.payload());
    const active = await until(() => h.post('read', { id: accepted.agent_id }), v => v.inputs[0]?.observation?.phase === 'accepted');
    expect(h.calls.spawn).toBe(1);
    const otherSpace = h.hub.createSpace(h.owner.identity.id, 'Second space'), jwt = await h.token(h.owner.token, otherSpace.id);
    const result = await h.request('spawn', { ...h.payload(), parent: { ...h.parent, kind: 'mcp', host: 'codex', nativeSessionId: active.native_session_id } }, jwt);
    expect(result.status).toBe(403); expect(result.body.error.code).toBe('subagent_delegation_denied');
});

test('identity rotation aborts an outstanding wait but accepted work keeps its stable owner and never replays input', async () => {
    const h = await hubDelegationFixture(cleanups), accepted = await h.post('spawn', h.payload());
    const active = await until(() => h.post('read', { id: accepted.agent_id }), v => v.inputs[0]?.observation?.phase === 'accepted');
    const waiting = h.request('wait', { parent: h.parent, ids: [accepted.agent_id], timeoutMs: 10_000 });
    await Bun.sleep(30);
    const replacement = createIdentityToken(); h.hub.rotate(h.owner.identity, h.owner.token, replacement);
    const aborted = await waiting; expect(aborted.status).toBe(401);
    await h.use(replacement);
    expect((await h.post('read', { id: accepted.agent_id })).phase).toBe('running'); expect(h.calls.send).toBe(1); expect(h.calls.stop).toBe(0);
    h.complete(active.session_id, 'Report after token rotation');
    const done = await until(() => h.post('read', { id: accepted.agent_id }), v => v.status === 'completed');
    expect(done.report.text).toContain('Report after token rotation'); expect(h.calls.spawn).toBe(1);
});

test('Agent unsharing stops the exact execution without claiming uncertain stop success, and history remains privately readable', async () => {
    const h = await hubDelegationFixture(cleanups);
    const shared = h.gateway.agents.create(h.outsider, { requestId: randomUUID(), definition: { name: 'Borrowed reviewer' } });
    h.gateway.agents.access(h.outsider, shared.id, { mode: 'space' });
    const request = h.payload(); Object.assign(request.intent, { agentId: shared.id, runtimeId: h.runtime.id });
    const accepted = await h.post('spawn', request);
    const active = await until(() => h.post('read', { id: accepted.agent_id }), v => v.inputs[0]?.observation?.phase === 'accepted');
    h.faults.stop = true; h.gateway.agents.access(h.outsider, shared.id, { mode: 'private' });
    const uncertain = await until(() => h.post('read', { id: accepted.agent_id }), v => v.attention?.code === 'task_stop_unknown');
    expect(uncertain.stop).toBe('stopping'); expect(uncertain.phase).toBe('running'); expect(h.sessions.get(active.session_id)!.session.active).toBe(true);
    await expect(h.post('send', next(accepted.agent_id))).rejects.toMatchObject({ status: 403 });
    h.faults.stop = false;
    const stopped = await until(() => h.post('read', { id: accepted.agent_id }), v => v.status === 'failed');
    expect(stopped.stop).toBe('stopped'); expect(stopped.execution_not_started).not.toBe(true);
    expect(stopped.agent.hub.agentId).toBe(shared.id); expect(h.calls.send).toBe(1);
    expect((await h.request('read', { parent: h.parent, id: accepted.agent_id }, await h.token(h.other.token))).status).toBe(404);
    const jwt = await h.token();
    const resume = await fetch(`http://127.0.0.1:${(h.gateway.server.address() as { port: number }).port}/api/sessions/${active.session_id}/resume`, {
        method: 'POST', headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: '{}' });
    expect(resume.status).toBe(409); expect((await resume.json() as any).error.code).toBe('managed_task_control_required'); expect(h.calls.resume).toBe(0);
});

test('removed space membership blocks history immediately while the trusted coordinator can still stop a bound child', async () => {
    const h = await hubDelegationFixture(cleanups), accepted = await h.post('spawn', h.payload());
    const active = await until(() => h.post('read', { id: accepted.agent_id }), v => v.inputs[0]?.observation?.phase === 'accepted');
    h.hub.changeMember(h.owner.identity.id, h.space, h.other.identity.id, 'owner');
    h.hub.changeMember(h.other.identity.id, h.space, h.owner.identity.id, null);
    expect((await h.request('read', { parent: h.parent, id: accepted.agent_id })).status).toBe(401);
    await until(() => h.sessions.get(active.session_id)!.session.active, active => !active);
    const ns = h.gateway.delegation.coordinator.store.pending().find(t => t.id === accepted.agent_id)?.namespace
        ?? (h.gateway.store.db.query('SELECT namespace FROM delegation_tasks WHERE id=?').get(accepted.agent_id) as { namespace: string }).namespace;
    const stored = await until(() => h.gateway.delegation.coordinator.store.require(ns, accepted.agent_id), b => b.rounds[0].phase === 'failed');
    expect(stored.rounds[0].stop).toBe('stopped'); expect(h.calls.spawn).toBe(1);
});

test('startup scans leave unowned tasks, input intents and baseline records untouched', async () => {
    const h = await hubDelegationFixture(cleanups), unowned = new TaskStore(h.statePath), baselines = new BaselineStore(h.statePath);
    try {
        const id = randomUUID(), roundId = randomUUID();
        const db = new Database(h.statePath);
        try {
            db.query('INSERT INTO delegation_tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, 'unowned', parentKey(h.parent), h.machineId, h.cwd, '{invalid', 1, 1);
            db.query('INSERT INTO delegation_rounds VALUES (?, ?, ?, ?, ?, NULL)').run(roundId, id, 1, 'queued', 'null');
        } finally { db.close(); }
        unowned.beginArtifactIntent('unowned', h.parent, randomUUID(), { agentType: 'unowned', message: 'Do not unpin', workspaceMode: 'shared', inputs: [{ artifactId: randomUUID() }] });
        baselines.createSnapshot('unowned', { machineId: h.machineId, repositoryId: 'unowned', sourcePath: h.cwd, repositoryRoot: h.cwd, commonDir: `${h.cwd}/.git`, relativePath: '', baseRef: 'HEAD', baseCommit: 'a'.repeat(40), objectFormat: 'sha1', dirty: false });
        await h.gateway.delegation.coordinator.reconcileFileIntents(); await Bun.sleep(40);
        expect(h.calls.spawn).toBe(0); expect(h.gateway.store.db.query('SELECT data FROM delegation_tasks WHERE id=?').get(id)).toEqual({ data: '{invalid' });
        expect(unowned.pendingArtifactIntents()).toHaveLength(1);
        expect(h.gateway.delegation.coordinator.store.pendingArtifactIntents()).toEqual([]);
        expect(h.gateway.delegation.preparations.store.snapshots()).toEqual([]);
    } finally { unowned.close(); baselines.close(); }
});

test('complete central gateway restart preserves native receipts and sessions without replaying accepted or uncertain input', async () => {
    for (const flavor of ['codex', 'claude'] as const) {
        const h = await hubDelegationFixture(cleanups, flavor);
        h.faults.spawn = 'lost'; h.faults.send = 'lost';
        const request = h.payload(), accepted = await h.post('spawn', request);
        const active = await until(() => h.post('read', { id: accepted.agent_id }), view => view.inputs[0]?.observation?.phase === 'accepted');
        const session = h.sessions.get(active.session_id)!;
        h.faults.stop = true; h.complete(active.session_id);
        await until(() => h.post('read', { id: accepted.agent_id }), view => view.attention?.code === 'task_stop_unknown');
        h.faults.spawn = 'none'; h.faults.send = 'unseen';
        const uncertain = await h.post('spawn', h.payload());
        await until(() => h.post('read', { id: uncertain.agent_id }), view => view.status === 'unknown');
        const before = { spawn: h.calls.spawn, send: h.calls.send }, gateway = h.gateway;
        const receipts = [...h.receipts.entries()], connections = [...h.machineConnections.entries()];
        h.faults.stop = false;
        await h.restart();
        expect(h.gateway).not.toBe(gateway); expect(gateway.server.listening).toBe(false);
        expect((await fetch(h.url + '/api/runweft/health')).status).toBe(200);
        expect((await h.request('spawn', request, await h.token())).body).toEqual(accepted);
        const finished = await until(() => h.post('read', { id: accepted.agent_id }), view => view.finish === 'complete');
        expect(finished.report.text).toBe('Native final report');
        expect((await h.post('read', { id: uncertain.agent_id })).status).toBe('unknown');
        expect(h.calls.spawn).toBe(before.spawn); expect(h.calls.send).toBe(before.send);
        expect(h.sessions.get(active.session_id)).toBe(session);
        expect([...h.receipts.entries()]).toEqual(receipts);
        expect([...h.machineConnections.entries()]).toEqual(connections);
        expect(h.nativeCalls.some(call => call.namespace === 'runweft' && call.path.includes('/spawn-requests/'))).toBe(true);
    }
});

test('current resource preflight checks launcher facts, permits unknown versions and never dispatches failed targets', async () => {
    const h = await hubDelegationFixture(cleanups), native = h.inspections.get(h.machineId)![0];
    const resolve = () => h.request(`runtimes/${h.runtime.id}/resolve`, undefined, undefined, 'resources');
    native.details.executable = null;
    expect((await resolve()).body.error.code).toBe('runtime_command_missing');
    native.details = resourceInspection('codex').details; native.available = false; native.reason = 'invalid_configuration';
    expect((await resolve()).body.error.code).toBe('runtime_invalid_configuration');
    native.available = true; delete native.reason; native.details.version = null; native.details.versionStatus = 'failed';
    expect((await resolve()).body.target).toMatchObject({ toolFound: true, version: null, versionStatus: 'failed' });
    native.details.versionStatus = 'timeout'; expect((await resolve()).status).toBe(200);
    h.inspections.set(h.machineId, []);
    expect((await resolve()).body.error.code).toBe('runtime_probe_failed');
    expect(h.calls.spawn).toBe(0); expect(h.calls.resume).toBe(0); expect(h.calls.send).toBe(0);
});


test('malformed HTTP send requests fail before accepting inputs, pinning files or dispatching native work', async () => {
    const h = await hubDelegationFixture(cleanups), id = randomUUID(), roundId = randomUUID();
    const base = { parent: h.parent, requestId: randomUUID(), intent: { id, message: 'Continue', mode: 'next' } };
    const counts = () => ['delegation_rounds', 'delegation_inputs', 'delegation_requests', 'delegation_artifact_intents'].map(table => h.gateway.store.db.query(`SELECT COUNT(*) AS n FROM ${table}`).get());
    const before = counts(), calls = structuredClone(h.calls);
    const bodies = [
        { ...base, unexpected: true }, { ...base, requestId: 'invalid' },
        ...[{ ...base.intent, unexpected: true }, { ...base.intent, id: 'invalid' }, { ...base.intent, message: '  ' },
            { ...base.intent, roundId }, { ...base.intent, mode: 'steer' },
            { ...base.intent, mode: 'steer', roundId, inputs: [{ artifactId: randomUUID() }] },
            { ...base.intent, mode: 'steer', roundId, outputs: [{ name: 'result', relativePath: 'result.txt' }] }].map(intent => ({ ...base, intent })),
    ];
    for (const body of bodies) {
        const response = await h.request('send', body);
        expect(response.status).toBe(400); expect(response.body.error.code).toBe('invalid_task_request');
    }
    expect(counts()).toEqual(before); expect(h.calls).toEqual(calls);
});

test('next rechecks Agent configuration after an asynchronous probe without accepting another round', async () => {
    const h = await hubDelegationFixture(cleanups), accepted = await h.post('spawn', h.payload());
    const running = await until(() => h.post('read', { id: accepted.agent_id }), view => view.inputs[0]?.observation?.phase === 'accepted');
    h.complete(running.session_id);
    await until(() => h.post('read', { id: accepted.agent_id }), view => view.status === 'completed');
    const before = h.gateway.delegation.coordinator.store.require(h.namespace, accepted.agent_id), calls = structuredClone(h.calls);
    const request = next(accepted.agent_id);
    h.hooks.set(h.machineId, async () => {
        h.hooks.delete(h.machineId);
        h.gateway.agents.update(h.actor, h.agent.id, { expectedVersion: 1, definition: { ...h.definition, instructions: 'Changed during next probe' } });
    });
    await expect(h.post('send', request)).rejects.toMatchObject({ code: 'agent_configuration_changed' });
    expect(h.gateway.delegation.coordinator.store.require(h.namespace, accepted.agent_id)).toEqual(before);
    expect(h.gateway.store.db.query('SELECT 1 FROM delegation_requests WHERE requestId=?').get(request.requestId)).toBeNull();
    expect(h.calls).toEqual(calls);
});
