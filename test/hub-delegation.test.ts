import { afterEach, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { hubDelegationFixture } from './hub-delegation-fixture';
import { until } from './tasks-fixture';
import { resourceInspection } from './resources-fixture';
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

test('all startup scans quarantine unowned legacy tasks, input intents and baseline records', async () => {
    const h = await hubDelegationFixture(cleanups), legacy = new TaskStore(h.statePath), baselines = new BaselineStore(h.statePath);
    try {
        const agent = { id: 'old', namespace: 'alpha', runtimeId: h.runtime.id, machineId: h.machineId, flavor: 'codex' as const,
            definitionVersion: 'old', resolvedVersion: 'old', source: { scope: 'global' as const, path: '/old.yaml', key: 'old', linkTarget: null },
            definition: { schemaVersion: 1 as const, description: '', instructions: '', runtime: null, flavor: null, model: null, reasoningEffort: null } };
        const target = { runtimeId: h.runtime.id, machineId: h.machineId, flavor: 'codex' as const, namespace: 'alpha', inspection: resourceInspection('codex') };
        const accepted = legacy.accept('alpha', h.parent, randomUUID(), { agentType: 'old', message: 'Do not execute', workspaceMode: 'shared' }, agent, target);
        legacy.beginArtifactIntent('alpha', h.parent, randomUUID(), { agentType: 'old', message: 'Do not unpin', workspaceMode: 'shared', inputs: [{ artifactId: randomUUID() }] });
        baselines.createSnapshot('alpha', { machineId: h.machineId, repositoryId: 'old', sourcePath: h.cwd, repositoryRoot: h.cwd, commonDir: `${h.cwd}/.git`, relativePath: '', baseRef: 'HEAD', baseCommit: 'a'.repeat(40), objectFormat: 'sha1', dirty: false });
        await h.gateway.delegation.coordinator.reconcileFileIntents(); await Bun.sleep(40);
        expect(h.calls.spawn).toBe(0); expect(legacy.require('alpha', accepted.agent_id).rounds[0].phase).toBe('queued');
        expect(legacy.pendingArtifactIntents()).toHaveLength(1);
        expect(h.gateway.delegation.coordinator.store.pendingArtifactIntents()).toEqual([]);
        expect(h.gateway.delegation.preparations.store.snapshots()).toEqual([]);
    } finally { legacy.close(); baselines.close(); }
});
