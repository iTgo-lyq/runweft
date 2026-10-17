import { fixtureCleanup } from '../fixture-cleanup';
import { HubAgentClient } from '../../src/hub/agents/client';
import { agentSnapshot } from '../../src/hub/delegation/context';
import { taskIntent } from '../../src/hub/delegation/types';
import { afterEach, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { remoteFixture } from './remote-fixture';
import { until } from '../helpers';
import { resultReference } from '../../src/tasks/result-types';

const cleanupOwner = fixtureCleanup([]), cleanups = cleanupOwner.resources;
afterEach(() => cleanupOwner.close());
async function fixture(flavor: 'codex' | 'claude' = 'codex', changed = false) {
    const h = await remoteFixture(cleanups, 2, flavor, changed);
    return Object.assign(h, { git: { faults: h.faults, requests: h.requests, refs: h.refs, repos: h.repos, workspaces: h.workspaces, setCommit: h.setCommit } });
}

for (const flavor of ['codex'] as const) test(`${flavor} remote task prepares automatically, fixes origin before branch movement and publishes before completion across two native rounds`, async () => {
    const h = await fixture(flavor); h.git.faults.exportHold = true;
    const request = h.payload(), accepted = await h.post('spawn', request), id = accepted.agent_id;
    await until(() => h.git.requests.filter(item => item.body.action === 'export').length, n => n === 1);
    expect(h.calls.spawn).toBe(0); h.git.setCommit('d'.repeat(40));
    expect(await h.post('spawn', request)).toEqual(accepted);
    h.git.faults.exportHold = false; h.git.faults.deliverLost = true;
    const running = await until(() => h.post('read', { id }), value => value.inputs[0]?.observation?.phase === 'accepted');
    expect(running.environment.remote.origin.machineId).toBe(h.sourceMachineId); expect(running.environment.source.machineId).toBe(h.targetMachineId);
    expect(running.environment.remote.origin.baseCommit).toBe('a'.repeat(40)); expect(running.cwd).not.toBe(h.cwd);
    expect(h.git.requests.filter(item => item.body.action === 'resolve')).toHaveLength(1);
    expect(h.git.requests.find(item => item.body.action === 'resolve')!.machine).toBe(h.sourceMachineId);
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
    await until(() => h.post('result/show', { id }), value => value.fetches.at(-1)?.released);
    await h.post('workspace/remove', { id });
    const removed = await until(() => h.post('read', { id }), value => value.environment.remote.release?.state === 'released');
    expect(removed.environment.status).toBe('removed'); expect(removed.code.status).toBe('available');
    expect(h.git.requests.find(item => item.body.action === 'remove')?.body.releaseResults).toHaveLength(2);
});

test('remote shared, missing base and missing result capability reject before accepting or starting a task', async () => {
    const h = await fixture(), request = h.payload();
    await expect(h.post('spawn', { ...request, intent: { ...h.payload().intent, baseRef: undefined, workspaceMode: 'shared' } })).rejects.toMatchObject({ code: 'shared_target_required' });
    await expect(h.post('spawn', { ...request, intent: { ...h.payload().intent, baseRef: undefined, workspaceMode: 'worktree' } })).rejects.toMatchObject({ code: 'remote_base_required' });
    delete h.machines.find(item => item.id === h.targetMachineId)!.runnerState!.capabilities!.repositoryResults;
    await expect(h.post('spawn', request)).rejects.toMatchObject({ code: 'runner_upgrade_required' });
    expect((await h.post('list')).agents).toHaveLength(0); expect(h.git.requests.every(item => item.body.action === 'resolve')).toBe(true); expect(h.calls.spawn).toBe(0);
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

test('code release previews without writes, unpins only the selected round, and shared task consumers survive removal', async () => {
    const h = await fixture();
    const finish = async (accepted: { agent_id: string; round_id: string }) => {
        const running = await until(() => h.post('read', { id: accepted.agent_id }), value => value.round_id === accepted.round_id && value.inputs[0]?.observation?.phase === 'accepted');
        h.complete(running.session_id); return until(() => h.post('read', { id: accepted.agent_id }), value => value.round_id === accepted.round_id && value.phase === 'finished');
    };
    const a = await h.post('spawn', h.payload()), b = await h.post('spawn', h.payload());
    await finish(a); await finish(b);
    const next = await h.post('send', { requestId: randomUUID(), intent: { id: a.agent_id, mode: 'next', message: 'Second round' } }); await finish(next);
    const before = structuredClone(h.git.refs), preview = await h.post('result/release', { id: a.agent_id, roundId: a.round_id });
    expect(preview.applied).toBe(false); expect(preview.can_release).toBe(true); expect(h.git.refs).toEqual(before);
    await expect(h.post('result/release', { id: a.agent_id, parent: { ...h.parent, kind: 'mcp', host: 'codex', nativeSessionId: randomUUID() } })).rejects.toMatchObject({ code: 'task_parent_mismatch' });
    const mcp = await fixture(), parent = { ...mcp.parent, kind: 'mcp', host: 'codex', nativeSessionId: randomUUID() };
    const mcpTask = await mcp.post('spawn', { ...mcp.payload(), parent });
    await expect(mcp.post('result/release', { id: mcpTask.agent_id, parent })).rejects.toMatchObject({ code: 'result_release_cli_only' });
    h.git.faults.unpinLost = true;
    await h.post('result/release', { id: a.agent_id, roundId: a.round_id, apply: true });
    const released = await until(() => h.post('result/show', { id: a.agent_id, roundId: a.round_id }), value => value.code.status === 'released');
    expect(released.code.bytes.retained).toBe(0); expect(released.manifests).toHaveLength(1);
    for (const refs of h.git.refs.values()) expect(refs.has(resultReference(a.agent_id, a.round_id))).toBe(false);
    for (const selected of [next, b]) {
        const retained = await h.post('result/show', { id: selected.agent_id, roundId: selected.round_id });
        expect(retained.code.status).toBe('available'); expect(retained.manifests.length).toBeGreaterThan(0);
        for (const manifest of retained.manifests) { expect(manifest.baseline.files.length).toBeGreaterThan(0); expect(manifest.output.files.length).toBeGreaterThan(0); }
        for (const manifest of retained.manifests) for (const file of [...manifest.baseline.files, ...manifest.output.files])
            expect(h.git.refs.get(file.artifactId)!.has(resultReference(selected.agent_id, selected.round_id))).toBe(true);
    }
    await expect(h.post('result/fetch', { id: a.agent_id, roundId: a.round_id, requestId: randomUUID() })).rejects.toMatchObject({ code: 'result_released' });
    expect((await h.post('read', { id: a.agent_id, roundId: next.round_id })).code.status).toBe('available');
    await h.post('workspace/remove', { id: a.agent_id });
    await until(() => h.post('read', { id: a.agent_id }), value => value.environment.remote.release?.state === 'released');
    expect(h.git.requests.filter(item => item.domain === 'repositories' && item.body.action === 'release' && h.git.repos.get(item.body.operationId)?.request.action === 'import')).toHaveLength(0);
    expect((await h.post('read', { id: b.agent_id })).environment.status).toBe('retained');
    h.git.faults.cacheHeld = true; await h.post('workspace/remove', { id: b.agent_id });
    const held = await until(() => h.post('read', { id: b.agent_id }), value => value.environment.remote.release?.error);
    expect(held.environment.status).toBe('removed'); expect(held.environment.remote.release.state).toBe('pending');
    expect([...h.git.refs.values()].some(refs => [...refs].some(ref => ref.startsWith('runweft:baseline:')))).toBe(true);
    h.git.faults.cacheHeld = false;
    await until(() => h.post('read', { id: b.agent_id }), value => value.environment.remote.release?.state === 'released');
    const retained = await h.post('result/show', { id: b.agent_id, roundId: b.round_id });
    expect(retained.code.status).toBe('available'); expect(retained.manifests.length).toBeGreaterThan(0);
    for (const manifest of retained.manifests) { expect(manifest.baseline.files.length).toBeGreaterThan(0); expect(manifest.output.files.length).toBeGreaterThan(0); }
    for (const manifest of retained.manifests) for (const file of [...manifest.baseline.files, ...manifest.output.files])
        expect(h.git.refs.get(file.artifactId)!.has(resultReference(b.agent_id, b.round_id))).toBe(true);
    expect(h.calls.spawn).toBe(2); expect(h.calls.resume).toBe(1);
});

test('incomplete upload requires explicit discard and releases partial pins and candidates without another export or model', async () => {
    const h = await fixture('codex', true), accepted = await h.post('spawn', h.payload()), id = accepted.agent_id;
    const running = await until(() => h.post('read', { id }), value => value.inputs[0]?.observation?.phase === 'accepted');
    h.git.faults.partialDelivery = true; h.complete(running.session_id);
    const failed = await until(() => h.post('read', { id }), value => value.phase === 'finished'); expect(failed.code.status).toBe('needs_attention');
    const preview = await h.post('result/release', { id }); expect(preview.can_release).toBe(false);
    await expect(h.post('result/release', { id, apply: true })).rejects.toMatchObject({ code: 'result_unpublished' });
    await h.post('result/release', { id, apply: true, discardPending: true });
    await until(() => h.post('result/show', { id }), value => value.code.status === 'discarded');
    const exports = [...h.git.repos.values()].filter(item => item.request.action === 'export-result'); expect(exports).toHaveLength(1);
    expect(exports[0]!.retention).toBe('released');
    for (const refs of h.git.refs.values()) expect(refs.has(resultReference(id, accepted.round_id))).toBe(false);
    expect(h.calls.spawn).toBe(1); expect(h.calls.resume).toBe(0);
});

test('discard of a definitely failed capture unblocks queued continuation without changing Git facts or allowing unknown operations', async () => {
    const h = await fixture('codex', true); h.git.faults.resultFail = true;
    const accepted = await h.post('spawn', h.payload()), id = accepted.agent_id;
    const running = await until(() => h.post('read', { id }), value => value.inputs[0]?.observation?.phase === 'accepted'); h.complete(running.session_id);
    const failed = await until(() => h.post('read', { id }), value => value.code.status === 'needs_attention');
    const next = await h.post('send', { requestId: randomUUID(), intent: { id, mode: 'next', message: 'Continue after explicit discard' } });
    await expect(h.post('result/release', { id, roundId: accepted.round_id, apply: true })).rejects.toMatchObject({ code: 'result_release_active' });
    const operation = [...h.git.repos.values()].find(item => item.request.action === 'export-result')!;
    operation.status = 'unknown';
    await expect(h.post('result/release', { id, roundId: accepted.round_id, discardPending: true, apply: true })).rejects.toMatchObject({ code: 'result_operation_pending' });
    operation.status = 'failed';
    const preview = await h.post('result/release', { id, roundId: accepted.round_id, discardPending: true });
    expect(preview.can_release).toBe(true); expect(preview.rounds[0].unpublished).toBe(true); expect(h.calls.resume).toBe(0);
    h.git.faults.resultFail = false;
    await h.post('result/release', { id, roundId: accepted.round_id, discardPending: true, apply: true });
    const resumed = await until(() => h.post('read', { id }), value => value.round_id === next.round_id && value.inputs[0]?.observation?.phase === 'accepted');
    const discarded = await h.post('read', { id, roundId: accepted.round_id });
    expect(discarded.code.status).toBe('discarded'); expect(discarded.phase).toBe('finished'); expect(discarded.git.result_head).toBe(failed.git.result_head);
    expect(h.git.requests.filter(item => item.body.action === 'finalize' && item.body.roundId === accepted.round_id)).toHaveLength(1);
    expect(h.calls.spawn).toBe(1); expect(h.calls.resume).toBe(1);
    h.complete(resumed.session_id); await until(() => h.post('read', { id }), value => value.phase === 'finished');
    expect((await h.post('result/show', { id })).code.status).toBe('available');
});

test('saved partial release resumes after coordinator replacement without native dispatch or repinning', async () => {
    const h = await fixture(), accepted = await h.post('spawn', h.payload()), id = accepted.agent_id;
    const running = await until(() => h.post('read', { id }), value => value.inputs[0]?.observation?.phase === 'accepted'); h.complete(running.session_id);
    await until(() => h.post('read', { id }), value => value.phase === 'finished');
    const preview = await h.post('result/release', { id }); await h.gateway.delegation.coordinator.close();
    const store = h.gateway.delegation.coordinator.store, bundle = store.require(h.namespace, id), round = bundle.rounds[0]!;
    const { round_id: _, ...plan } = preview.rounds[0]; round.codeRetention = { ...plan, state: 'releasing' };
    h.git.refs.get(round.codeRetention!.references[0]!.artifactId)!.delete(resultReference(id, round.id));
    store.save(bundle.task, round, []);
    await h.restart();
    const released = await until(() => h.post('read', { id }), value => value.code.status === 'released');
    expect(released.code.retention).toMatchObject({ state: 'released' }); expect(h.calls.spawn).toBe(1); expect(h.calls.resume).toBe(0);
    for (const refs of h.git.refs.values()) expect(refs.has(resultReference(id, round.id))).toBe(false);
});

test('consumer committed before task association is reused after coordinator replacement', async () => {
    const h = await fixture(), input = h.payload();
    await h.gateway.delegation.coordinator.close();
    const store = h.gateway.delegation.coordinator.store, baselines = h.gateway.delegation.preparations.baselines;
    const hub = (await new HubAgentClient({ url: h.url, space: h.space, env: { RUNWEFT_IDENTITY_TOKEN: h.owner.token } }).resolve({ agentId: h.agent.id })).resolution;
    const agent = agentSnapshot(h.namespace, hub), origin = h.source(h.cwd, 'HEAD');
    const accepted = store.accept(h.namespace, h.parent, input.requestId, taskIntent(input.intent as any), agent, hub.target, origin);
    const consumer = await baselines.forTask(h.namespace, origin, h.targetMachineId, accepted.agent_id);
    expect(baselines.store.consumers(consumer.snapshotId)).toHaveLength(1);
    expect(store.require(h.namespace, accepted.agent_id).task.environment).toMatchObject({ remote: { origin } });
    await h.restart();
    const running = await until(() => h.post('read', { id: accepted.agent_id }), value => value.inputs[0]?.observation?.phase === 'accepted');
    expect(running.environment.mode === 'worktree' && running.environment.remote?.consumerId).toBe(consumer.id);
    expect(h.gateway.delegation.preparations.baselines.store.consumers(consumer.snapshotId)).toHaveLength(1);
    h.complete(running.session_id!); await until(() => h.post('read', { id: accepted.agent_id }), value => value.phase === 'finished');
    expect(h.calls.spawn).toBe(1);
});

test('an accepted remote HEAD request still rejects a retransmission that omits its required base', async () => {
    const h = await fixture(); h.git.faults.exportHold = true;
    const request = h.payload(), accepted = await h.post('spawn', request);
    await expect(h.post('lookup', { requestId: request.requestId, intent: { ...h.payload().intent, baseRef: undefined, workspaceMode: 'worktree' } })).rejects.toMatchObject({ code: 'remote_base_required' });
    expect(await h.post('spawn', request)).toEqual(accepted); expect(h.calls.spawn).toBe(0);
});

test('a lost remote start receipt and unknown stop never duplicate the native run or bypass sealing', async () => {
    const h = await fixture(); h.nativeFaults.spawn = 'lost';
    const accepted = await h.post('spawn', h.payload()), id = accepted.agent_id;
    const running = await until(() => h.post('read', { id }), value => value.inputs[0]?.observation?.phase === 'accepted');
    expect(h.calls.spawn).toBe(1); expect(h.calls.send).toBe(1);
    h.nativeFaults.stop = true; h.complete(running.session_id);
    const held = await until(() => h.post('read', { id }), value => value.phase === 'stopping' && value.attention);
    expect(held.git.status).toBe('pending'); expect(h.git.requests.some(item => item.body.action === 'finalize')).toBe(false);
    h.nativeFaults.stop = false;
    const finished = await until(() => h.post('read', { id }), value => value.phase === 'finished');
    expect(finished.code.status).toBe('available'); expect(h.calls.spawn).toBe(1); expect(h.calls.send).toBe(1);
    expect(h.git.requests.filter(item => item.body.action === 'finalize')).toHaveLength(1);
});
