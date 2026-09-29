import { afterEach, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { remoteFixture } from './remote-fixture';
import { taskFixture, until } from './tasks-fixture';
import { HapiClient, HapiRequestError } from '../src/hapi';
import { TaskCoordinator } from '../src/tasks/coordinator';
import { TaskStore } from '../src/tasks/store';
import { BaselineStore } from '../src/remote/store';
import { RemoteBaselines } from '../src/remote/baselines';
import { TaskWorkspaces } from '../src/tasks/workspaces';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture(flavor: 'codex' | 'claude' = 'codex', changed = false) {
    const git = await remoteFixture(cleanups);
    const h = await taskFixture(cleanups, flavor, undefined, async request => {
        const path = new URL(request.url).pathname;
        if (!path.startsWith('/api/artifacts') && !/^\/api\/machines\/[^/]+\/(repositories|artifacts|workspaces)$/.test(path)) return;
        const body = request.method === 'GET' ? undefined : await request.text();
        try {
            const value = await git.alpha.request(path, { method: request.method, headers: { 'content-type': 'application/json' }, ...(body ? { body } : {}) });
            const input = body && JSON.parse(body);
            if (changed && input?.action === 'finalize' && value.workspace?.results[input.roundId]) {
                const result = git.workspaces.get(input.environmentId)!.results[input.roundId]!;
                result.resultHead = 'b'.repeat(40); result.startHead = git.workspaces.get(input.environmentId)!.preparations[input.preparationId]!.startHead;
                result.fileCount = 1; result.paths = ['main.ts']; value.workspace.results[input.roundId] = result;
            }
            return Response.json(value);
        } catch (error) {
            if (!(error instanceof HapiRequestError)) throw error;
            return Response.json({ error: { code: error.code, message: error.message, hint: error.hint } }, { status: error.status });
        }
    });
    for (const machine of h.machines) machine.runnerState!.capabilities = { ...git.machines.find(item => item.id === machine.id)?.runnerState?.capabilities };
    const runtime = await h.register('remote', flavor);
    const payload = () => ({ ...h.payload(), intent: { ...h.intent, workspaceMode: 'worktree' as const, baseRef: 'HEAD' }, agent: { ...h.agent, runtimeId: runtime.id, machineId: 'remote' } });
    return { ...h, git, runtime, payload };
}

for (const flavor of ['codex', 'claude'] as const) test(`${flavor} remote task prepares automatically, fixes origin before branch movement and publishes before completion across two native rounds`, async () => {
    const h = await fixture(flavor); h.git.faults.exportHold = true;
    const request = h.payload(), accepted = await h.post('spawn', request), id = accepted.agent_id;
    await until(() => h.git.requests.filter(item => item.body.action === 'export').length, n => n === 1);
    expect(h.calls.spawn).toBe(0); h.git.setCommit('d'.repeat(40));
    expect(await h.post('spawn', request)).toEqual(accepted);
    h.git.faults.exportHold = false; h.git.faults.deliverLost = true;
    const running = await until(() => h.post('read', { id }), value => value.inputs[0]?.observation?.phase === 'accepted');
    expect(running.environment.remote.origin.machineId).toBe('own'); expect(running.environment.source.machineId).toBe('remote');
    expect(running.environment.remote.origin.baseCommit).toBe('a'.repeat(40)); expect(running.cwd).not.toBe(h.cwd);
    expect(h.git.requests.filter(item => item.body.action === 'resolve')).toHaveLength(1);
    expect(h.git.requests.find(item => item.body.action === 'resolve')!.machine).toBe('own');
    h.complete(running.session_id);
    const first = await until(() => h.post('read', { id }), value => value.phase === 'finished');
    expect(first.code.status).toBe('available'); expect(first.completed_revision).toBeGreaterThan(first.code_revision);
    const next = await h.post('send', { requestId: randomUUID(), intent: { id, mode: 'next', message: 'Continue same remote environment' } });
    const resumed = await until(() => h.post('read', { id }), value => value.round_id === next.round_id && value.inputs[0]?.observation?.phase === 'accepted');
    expect(resumed.session_id).toBe(running.session_id); expect(resumed.cwd).toBe(running.cwd); h.complete(resumed.session_id);
    const second = await until(() => h.post('read', { id }), value => value.phase === 'finished' && value.round_id === next.round_id);
    expect(second.code.status).toBe('available'); expect(second.code.bytes.uploaded).toBe(0);
    expect(h.calls.spawn).toBe(1); expect(h.calls.resume).toBe(1); expect(h.calls.stop).toBe(2);
    expect(h.git.requests.filter(item => item.body.action === 'export')).toHaveLength(1);
    const acceptedFetch = await h.post('result/fetch', { id, requestId: randomUUID() });
    expect(acceptedFetch.round_id).toBe(next.round_id);
    const fetched = await until(() => h.post('read', { id }), value => value.code.fetch?.status === 'available');
    expect(fetched.code.ref).toContain(next.round_id);
    await expect(h.post('workspace/remove', { id })).rejects.toMatchObject({ code: 'remote_workspace_retention_unavailable' });
});

test('remote shared, missing base and missing result capability reject before accepting or starting a task', async () => {
    const h = await fixture(), request = h.payload();
    await expect(h.post('spawn', { ...request, intent: { ...h.intent, workspaceMode: 'shared' } })).rejects.toMatchObject({ code: 'shared_target_required' });
    await expect(h.post('spawn', { ...request, intent: { ...h.intent, workspaceMode: 'worktree' } })).rejects.toMatchObject({ code: 'remote_base_required' });
    delete h.machines.find(item => item.id === 'remote')!.runnerState!.capabilities!.repositoryResults;
    await expect(h.post('spawn', request)).rejects.toMatchObject({ code: 'runner_upgrade_required' });
    expect((await h.post('list')).agents).toHaveLength(0); expect(h.git.requests).toHaveLength(0); expect(h.calls.spawn).toBe(0);
});

test('failed initial import starts no model and retained sealed facts survive a failed result capture with a queued next round', async () => {
    const h = await fixture('codex', true); h.git.faults.import = true;
    const failed = await h.post('spawn', h.payload());
    const report = await until(() => h.post('read', { id: failed.agent_id }), value => value.status === 'failed');
    expect(report.attention.hint).toContain('--base ' + 'a'.repeat(40)); expect(h.calls.spawn).toBe(0);
    h.git.faults.import = false; h.git.faults.resultFail = true;
    const accepted = await h.post('spawn', h.payload()), id = accepted.agent_id;
    const running = await until(() => h.post('read', { id }), value => value.inputs[0]?.observation?.phase === 'accepted'); h.complete(running.session_id);
    const held = await until(() => h.post('read', { id }), value => value.code.status === 'needs_attention');
    expect(held.phase).toBe('finishing'); expect(held.git.status).toBe('sealed'); expect(held.stop).toBe('stopped');
    const next = await h.post('send', { requestId: randomUUID(), intent: { id, mode: 'next', message: 'After recovered capture' } });
    await Bun.sleep(70); expect(h.calls.resume).toBe(0);
    h.git.faults.resultFail = false;
    await h.post('result/retry', { id, roundId: accepted.round_id, requestId: randomUUID() });
    const resumed = await until(() => h.post('read', { id }), value => value.round_id === next.round_id && value.inputs[0]?.observation?.phase === 'accepted');
    const sealed = await h.post('read', { id, roundId: accepted.round_id }); expect(sealed.git.result_head).toBe(held.git.result_head); expect(sealed.code.status).toBe('available');
    expect(h.git.requests.filter(item => item.body.action === 'finalize' && item.body.roundId === accepted.round_id)).toHaveLength(1);
    h.complete(resumed.session_id); await until(() => h.post('read', { id }), value => value.phase === 'finished');
});

test('consumer committed before task association is reused after coordinator replacement', async () => {
    const h = await fixture(), input = h.payload(), origin = await new TaskWorkspaces(h.alpha, 'own').resolve(h.cwd, 'HEAD');
    await h.tasks!.close();
    const store = new TaskStore(h.statePath), baselineStore = new BaselineStore(h.statePath);
    const client = (namespace: string) => new HapiClient(h.nativeUrl, `test-${namespace}`);
    const baselines = new RemoteBaselines(baselineStore, client);
    const accepted = store.accept('alpha', h.parent, input.requestId, input.intent, input.agent,
        { runtimeId: h.runtime.id, machineId: 'remote', flavor: 'codex', inspection: h.runtime.inspection! }, origin);
    const consumer = await baselines.forTask('alpha', origin, 'remote', accepted.agent_id);
    expect(baselineStore.consumers(consumer.snapshotId)).toHaveLength(1);
    expect(store.require('alpha', accepted.agent_id).task.environment).toMatchObject({ remote: { origin } });
    store.close(); baselineStore.close();
    const replacement = new TaskCoordinator(h.statePath, client, 20); cleanups.push(() => replacement.close()); replacement.start();
    const running = await until(() => replacement.read('alpha', h.parent, accepted.agent_id), value => value.inputs[0]?.observation?.phase === 'accepted');
    expect(running.environment.mode === 'worktree' && running.environment.remote?.consumerId).toBe(consumer.id);
    const check = new BaselineStore(h.statePath); try { expect(check.consumers(consumer.snapshotId)).toHaveLength(1); } finally { check.close(); }
    h.complete(running.session_id!); await until(() => replacement.read('alpha', h.parent, accepted.agent_id), value => value.phase === 'finished');
    expect(h.calls.spawn).toBe(1);
});

test('an accepted remote HEAD request still rejects a retransmission that omits its required base', async () => {
    const h = await fixture(); h.git.faults.exportHold = true;
    const request = h.payload(), accepted = await h.post('spawn', request);
    await expect(h.post('lookup', { requestId: request.requestId, intent: { ...h.intent, workspaceMode: 'worktree' } })).rejects.toMatchObject({ code: 'remote_base_required' });
    expect(await h.post('spawn', request)).toEqual(accepted); expect(h.calls.spawn).toBe(0);
});

test('a lost remote start receipt and unknown stop never duplicate the native run or bypass sealing', async () => {
    const h = await fixture(); h.faults.spawn = 'lost';
    const accepted = await h.post('spawn', h.payload()), id = accepted.agent_id;
    const running = await until(() => h.post('read', { id }), value => value.inputs[0]?.observation?.phase === 'accepted');
    expect(h.calls.spawn).toBe(1); expect(h.calls.send).toBe(1);
    h.faults.stop = true; h.complete(running.session_id);
    const held = await until(() => h.post('read', { id }), value => value.phase === 'stopping' && value.attention);
    expect(held.git.status).toBe('pending'); expect(h.git.requests.some(item => item.body.action === 'finalize')).toBe(false);
    h.faults.stop = false;
    const finished = await until(() => h.post('read', { id }), value => value.phase === 'finished');
    expect(finished.code.status).toBe('available'); expect(h.calls.spawn).toBe(1); expect(h.calls.send).toBe(1);
    expect(h.git.requests.filter(item => item.body.action === 'finalize')).toHaveLength(1);
});
