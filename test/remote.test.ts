import { afterEach, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { remoteFixture } from './remote-fixture';
import { until } from './helpers';
import { fixtureCleanup } from './fixture-cleanup';
import { mkdirSync } from 'node:fs';
import { observeRepository } from '../src/hub/repositories/observation';
import type { PreparationView } from '../src/remote/client';

const cleanupOwner = fixtureCleanup([]), cleanups = cleanupOwner.resources;
afterEach(() => cleanupOwner.close());
const ready = (h: Awaited<ReturnType<typeof remoteFixture>>, id: string) => until(() => h.inspect(id), item => item.phase === 'ready', 10_000);

test('remote baseline preparation batches 100+ assets, keeps namespace/owner scope and reuses snapshots/LFS', async () => {
    const h = await remoteFixture(cleanups, 102), request = h.preparationPayload();
    const answers = await Promise.all(Array.from({ length: 3 }, () => h.prepare('prepare', request)));
    expect(new Set(answers.map(item => item.preparation.id)).size).toBe(1);
    const first = await ready(h, answers[0].preparation.id);
    expect(first.origin.dirty).toBe(true); expect(first.nativeExecution).toBe('not_started'); expect(first.transfer.files).toBe(103);
    expect(first.transfer.uploadBytes).toBe(1040); expect(first.transfer.snapshotReused).toBe(false);
    expect(h.requests.filter(item => item.body.action === 'export')).toHaveLength(1);
    for (const action of ['capture', 'deliver', 'materialize']) {
        const batches = h.requests.filter(item => item.body.action === action);
        expect(batches).toHaveLength(2); expect(batches.map(item => item.body.files.length)).toEqual([100, 3]);
    }
    const secondRequest = h.preparationPayload(); secondRequest.parent.cwd += '/sub'; mkdirSync(secondRequest.parent.cwd); secondRequest.intent.observation = observeRepository(secondRequest.parent.cwd);
    const second = await ready(h, (await h.prepare('prepare', secondRequest)).preparation.id);
    expect(second.snapshot.id).toBe(first.snapshot.id); expect(second.target.importId).toBe(first.target.importId);
    expect(second.transfer).toMatchObject({ uploadBytes: 0, reusedBytes: 1040, snapshotReused: true }); expect(second.workspace!.cwd.endsWith('/sub')).toBe(true);
    expect(h.requests.filter(item => item.body.action === 'import')).toHaveLength(1); expect(h.workspaces.size).toBe(2);
    h.setCommit('b'.repeat(40));
    const third = await ready(h, (await h.prepare('prepare', h.preparationPayload())).preparation.id);
    expect(third.snapshot.id).not.toBe(first.snapshot.id); expect(third.transfer).toMatchObject({ uploadBytes: 20, reusedBytes: 1020 });
    expect(h.objects.size).toBe(104); expect([...h.refs.values()].filter(refs => refs.size === 2)).toHaveLength(102);
    expect((await h.prepare('list', { parent: h.parent })).preparations).toHaveLength(2);
    expect((await h.prepare('list', { parent: h.parent, all: true })).preparations).toHaveLength(3);
    expect((await h.request('inspect', { parent: h.parent, id: first.id }, await h.token(h.other.token), 'workspaces')).status).toBe(404);
    await expect(h.prepare('prepare', { ...request, intent: { ...request.intent, baseRef: 'different' } })).rejects.toMatchObject({ code: 'preparation_request_conflict' });
    await until(() => h.inspect(third.id), item => item.cleanup.sourceReleased && item.cleanup.downloadsReleased);
    expect([...h.transfers.values()].filter(item => ['capture', 'materialize'].includes(item.request.action)).every(item => item.retention === 'released')).toBe(true);
});

test('lost publication response and server restart use original operation IDs; offline target leaves center available', async () => {
    const h = await remoteFixture(cleanups); h.faults.exportHold = true; h.faults.deliverLost = true;
    const request = h.preparationPayload(), accepted = (await h.prepare('prepare', request)).preparation as PreparationView;
    await until(() => h.requests.filter(item => item.body.action === 'export').length, count => count === 1);
    const joined = (await h.prepare('prepare', h.preparationPayload())).preparation as PreparationView;
    expect(joined.id).not.toBe(accepted.id); expect(joined.snapshot.id).toBe(accepted.snapshot.id);
    await h.restart(); h.faults.exportHold = false; h.faults.targetOffline = true;
    const waiting = await until(() => h.inspect(accepted.id), item => item.snapshot.phase === 'available' && item.target.phase === 'unknown');
    expect(waiting.phase).toBe('unknown'); expect(waiting.snapshot.phase).toBe('available');
    expect((await h.prepare('lookup', { parent: h.parent, requestId: request.requestId, intent: request.intent })).preparation.id).toBe(accepted.id);
    h.faults.targetOffline = false; const finished = await ready(h, accepted.id);
    expect(finished.origin.baseCommit).toBe('a'.repeat(40)); expect(h.requests.filter(item => item.body.action === 'export')).toHaveLength(1);
    expect(h.requests.filter(item => item.body.action === 'deliver')).toHaveLength(1);
    await ready(h, joined.id); expect(h.requests.filter(item => item.body.action === 'prepare')).toHaveLength(2);
});

test('limits and preparation errors are visible, never start models, and explicit new requests preserve old receipts', async () => {
    const h = await remoteFixture(cleanups); h.faults.maxFileBytes = 15;
    const first = (await h.prepare('prepare', h.preparationPayload())).preparation as PreparationView;
    const failed = await until(() => h.inspect(first.id), item => item.phase === 'failed'); expect(failed.error?.code).toBe('baseline_file_too_large');
    expect(h.requests.filter(item => item.body.action === 'capture')).toHaveLength(0); expect(h.workspaces.size).toBe(0);
    h.faults.maxFileBytes = 1_000_000; h.faults.prepare = true;
    const second = (await h.prepare('prepare', h.preparationPayload())).preparation as PreparationView;
    const drift = await until(() => h.inspect(second.id), item => item.phase === 'failed'); expect(drift.error?.code).toBe('workspace_drift');
    expect(second.snapshot.generation).toBe(2); expect((await h.inspect(first.id)).error?.code).toBe('baseline_file_too_large');
    expect(h.nativeCalls.some(call => call.path.includes('spawn') || call.path.includes('sessions'))).toBe(false);
});

test('deleted center objects get a new generation, while local targets and child delegation are rejected before exporting', async () => {
    const h = await remoteFixture(cleanups), request = h.preparationPayload();
    const first = await ready(h, (await h.prepare('prepare', request)).preparation.id);
    const id = h.gateway.delegation.preparations.store.snapshot(first.snapshot.id).files!.find(file => file.kind === 'bundle')!.artifactId!;
    h.objects.get(id)!.state = 'deleted';
    const next = await ready(h, (await h.prepare('prepare', h.preparationPayload())).preparation.id);
    expect(next.snapshot.generation).toBe(2); expect(h.objects.get(id)!.state).toBe('deleted');
    const local = h.gateway.resources.store.registerRuntime(h.actor, { machineId: h.sourceMachineId, flavor: 'codex' }, { agent: 'codex', available: true, details: { checkedAt: Date.now(), executable: '/test/bin/codex', version: '1.2.3', versionStatus: 'detected' } });
    await expect(h.prepare('prepare', { ...h.preparationPayload(), intent: { ...h.preparationPayload().intent, runtimeId: local.id } })).rejects.toMatchObject({ code: 'local_workspace_task_required' });
    const changed = { ...h.preparationPayload(), requestId: randomUUID(), parent: { kind: 'mcp', host: 'codex', nativeSessionId: 'parent', machineId: h.sourceMachineId, cwd: h.cwd } };
    const owned = await ready(h, (await h.prepare('prepare', changed)).preparation.id);
    await expect(h.prepare('inspect', { parent: { ...changed.parent, nativeSessionId: 'other' }, id: owned.id })).rejects.toMatchObject({ status: 403 });
    const child = await h.post('spawn', h.payload());
    const running = await until(() => h.post('read', { id: child.agent_id }), value => value.inputs[0]?.observation?.phase === 'accepted');
    h.complete(running.session_id);
    await until(() => h.post('read', { id: child.agent_id }), value => value.phase === 'finished');
    const before = h.requests.length;
    await expect(h.prepare('prepare', { ...h.preparationPayload(), parent: { ...h.parent, hapiSessionId: running.session_id } })).rejects.toMatchObject({ code: 'subagent_delegation_denied' });
    expect(h.requests.length).toBe(before);
});

test('cleanup errors remain visible without invalidating published baselines or rerunning delivery', async () => {
    const h = await remoteFixture(cleanups); h.faults.cleanup = true;
    const first = await ready(h, (await h.prepare('prepare', h.preparationPayload())).preparation.id);
    expect(first.snapshot.phase).toBe('available'); expect(first.cleanup.errors.length).toBeGreaterThan(0);
    h.faults.cleanup = false;
    const cleaned = await until(() => h.inspect(first.id), item => item.cleanup.sourceReleased && item.cleanup.downloadsReleased);
    expect(cleaned.cleanup.errors).toEqual([]); expect(h.requests.filter(item => item.body.action === 'deliver')).toHaveLength(1);
});

test('quota fails before capture, and a repaired target imports a new generation without republishing the center snapshot', async () => {
    const h = await remoteFixture(cleanups); h.faults.quota = 30;
    const first = (await h.prepare('prepare', h.preparationPayload())).preparation as PreparationView;
    expect((await until(() => h.inspect(first.id), item => item.phase === 'failed')).error?.code).toBe('baseline_quota_exceeded');
    expect(h.requests.filter(item => item.body.action === 'capture')).toHaveLength(0);
    h.faults.quota = 100_000_000; h.faults.import = true;
    const second = (await h.prepare('prepare', h.preparationPayload())).preparation as PreparationView;
    const failure = await until(() => h.inspect(second.id), item => item.phase === 'failed'); expect(failure.snapshot.phase).toBe('available'); expect(failure.error?.code).toBe('repository_bundle_invalid');
    const exports = h.requests.filter(item => item.body.action === 'export').length;
    h.faults.import = false;
    const third = await ready(h, (await h.prepare('prepare', h.preparationPayload())).preparation.id);
    expect(third.snapshot.id).toBe(second.snapshot.id); expect(third.target.generation).toBe(2);
    expect(third.target.importId).not.toBe(second.target.importId); expect((await h.inspect(second.id)).phase).toBe('failed');
    expect(h.requests.filter(item => item.body.action === 'export').length).toBe(exports);
});

test('partial publication releases only delivered candidates and keeps unpublished bytes for explicit retention handling', async () => {
    const h = await remoteFixture(cleanups); h.faults.partialDelivery = true;
    const accepted = (await h.prepare('prepare', h.preparationPayload())).preparation as PreparationView;
    const failed = await until(() => h.inspect(accepted.id), item => item.phase === 'failed');
    expect(failed.error?.code).toBe('artifact_delivery_incomplete'); expect(failed.snapshot.phase).toBe('failed');
    const snapshot = h.gateway.delegation.preparations.store.snapshot(failed.snapshot.id), batch = snapshot.batches![0];
    expect(batch.releasedNames).toHaveLength(2); expect(batch.released).toBe(false); expect(snapshot.sourceReleased).toBe(false);
    const captured = h.transfers.get(batch.captureId)!;
    expect(captured.retention).toBe('retained'); expect(captured.candidates!.filter(item => item.status === 'captured' && item.retention === 'retained')).toHaveLength(1);
    expect(h.repos.get(snapshot.exportId)!.releasedFiles.sort()).toEqual([...batch.releasedNames].sort());
    expect(h.workspaces.size).toBe(0); expect(h.objects.size).toBe(2);
});

test('release keeps other consumers and cross-snapshot LFS pins, and a later preparation uses a new generation', async () => {
    const h = await remoteFixture(cleanups), request = h.preparationPayload();
    const first = await ready(h, (await h.prepare('prepare', request)).preparation.id);
    const second = await ready(h, (await h.prepare('prepare', h.preparationPayload())).preparation.id);
    h.setCommit('b'.repeat(40)); const third = await ready(h, (await h.prepare('prepare', h.preparationPayload())).preparation.id);
    const release = async (id: string) => { await h.prepare('release', { parent: h.parent, id }); return until(() => h.inspect(id), item => item.phase === 'released'); };
    const one = await release(first.id); expect(one.snapshot.retention).toBe('retained'); expect(one.target.retention).toBe('retained'); expect(one.consumerActive).toBe(false);
    expect([...h.refs.values()].filter(refs => refs.size === 2)).toHaveLength(2);
    const two = await release(second.id); expect(two.snapshot.retention).toBe('released'); expect(two.target.retention).toBe('released');
    expect(h.gateway.delegation.preparations.store.consumers(first.snapshot.id)).toHaveLength(0);
    expect([...h.refs.values()].filter(refs => refs.size === 1)).toHaveLength(3); expect((await h.inspect(third.id)).phase).toBe('ready');
    const repeated = await h.prepare('release', { parent: h.parent, id: second.id }); expect(repeated.preparation.phase).toBe('released');
    h.setCommit('a'.repeat(40)); const next = await ready(h, (await h.prepare('prepare', h.preparationPayload())).preparation.id);
    expect(next.snapshot.generation).toBe(2); expect(next.target.importId).not.toBe(first.target.importId);
    expect((await h.inspect(second.id)).target).toMatchObject({ phase: 'available', retention: 'released' });
    expect((await h.prepare('lookup', { parent: h.parent, requestId: request.requestId, intent: request.intent })).preparation.phase).toBe('released');
});

test('release exposes dirty, ignored and cache retention errors; explicit retry preserves the original recovery objects', async () => {
    const h = await remoteFixture(cleanups), first = await ready(h, (await h.prepare('prepare', h.preparationPayload())).preparation.id);
    const attempt = async (discardIgnored = false) => { await h.prepare('release', { parent: h.parent, id: first.id, discardIgnored }); return until(() => h.inspect(first.id), item => item.release?.status === 'failed' || item.phase === 'released'); };
    h.faults.dirty = true; expect((await attempt()).error?.code).toBe('workspace_unrecovered_changes');
    expect(h.requests.filter(item => item.body.action === 'remove')).toHaveLength(0);
    h.faults.dirty = false; h.faults.ignored = true; expect((await attempt()).error?.code).toBe('workspace_ignored_files');
    h.faults.cacheHeld = true; const held = await attempt(true); expect(held.error?.code).toBe('repository_unknown_ref'); expect(held.release?.environmentRemoved).toBe(true);
    expect(held.consumerActive).toBe(true); expect([...h.refs.values()].every(refs => refs.size === 1)).toBe(true);
    h.faults.cacheHeld = false; const done = await attempt(true); expect(done.phase).toBe('released'); expect([...h.refs.values()].every(refs => refs.size === 0)).toBe(true);
});

test('offline target and lost release/unpin replies resume after restart without duplicate removal or native execution', async () => {
    const h = await remoteFixture(cleanups), first = await ready(h, (await h.prepare('prepare', h.preparationPayload())).preparation.id);
    h.faults.targetOffline = true;
    await h.prepare('release', { parent: h.parent, id: first.id });
    const offline = await until(() => h.inspect(first.id), item => item.release?.status === 'unknown');
    expect(offline.snapshot.retention).toBe('retained'); expect(offline.consumerActive).toBe(true);
    await h.restart(); h.faults.targetOffline = false; h.faults.releaseLost = true; h.faults.unpinLost = true;
    const released = await until(() => h.inspect(first.id), item => item.phase === 'released'); expect(released.release?.environmentRemoved).toBe(true);
    expect(h.requests.filter(item => item.body.action === 'remove')).toHaveLength(1);
    expect(h.nativeCalls.some(item => item.path.includes('spawn') || item.path.includes('sessions'))).toBe(false);
    expect([...h.refs.values()].every(refs => refs.size === 0)).toBe(true);
});

test('failed partial publication can release its owned candidates and pins while pending or foreign preparations remain protected', async () => {
    const h = await remoteFixture(cleanups); h.faults.partialDelivery = true;
    const first = (await h.prepare('prepare', h.preparationPayload())).preparation as PreparationView;
    await until(() => h.inspect(first.id), item => item.phase === 'failed');
    await h.prepare('release', { parent: h.parent, id: first.id });
    const released = await until(() => h.inspect(first.id), item => item.phase === 'released');
    expect(released.cleanup.sourceReleased).toBe(true); expect([...h.transfers.values()].filter(item => item.request.action === 'capture').every(item => item.retention === 'released')).toBe(true);
    expect([...h.refs.values()].every(refs => refs.size === 0)).toBe(true);
    h.faults.partialDelivery = false; h.faults.exportHold = true; h.setCommit('b'.repeat(40));
    const pending = (await h.prepare('prepare', h.preparationPayload())).preparation as PreparationView;
    await expect(h.prepare('release', { parent: h.parent, id: pending.id })).rejects.toMatchObject({ code: 'preparation_pending' });
    expect((await h.request('release', { parent: h.parent, id: pending.id }, await h.token(h.other.token), 'workspaces')).status).toBe(404);
});
