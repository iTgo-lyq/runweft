import { STATE_SCHEMA_VERSION } from '../src/state';
import { afterEach, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { Database } from 'bun:sqlite';
import { remoteFixture } from './remote-fixture';
import { until } from './tasks-fixture';
import { TaskResults, pendingCode } from '../src/tasks/results';
import { TaskStore } from '../src/tasks/store';
import { BaselineStore } from '../src/remote/store';
import { openState } from '../src/state';
import type { AgentSnapshot } from '../src/tasks/types';
import { resourceWrite } from './resources-fixture';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture(count = 2) {
    const h = await remoteFixture(cleanups, count), accepted = (await h.post('prepare', h.payload())).preparation;
    const ready = await until(() => h.inspect(accepted.id), value => value.phase === 'ready');
    const baselines = new BaselineStore(h.statePath); cleanups.push(() => baselines.close());
    const consumer = baselines.consumer(accepted.consumerId ?? baselines.preparation('alpha', accepted.id).consumerId);
    const input = baselines.snapshot(consumer.snapshotId), source = baselines.imported(consumer.importId).source!;
    const store = h.tasks!.store, runtime = await h.register('remote');
    const agent: AgentSnapshot = { id: 'review', definition: { schemaVersion: 1, name: 'Review', description: '', instructions: '', runtime: null, flavor: null, model: null, reasoningEffort: null },
        source: { scope: 'global', path: '/definition.yaml', key: 'global/review', linkTarget: null }, definitionVersion: 'initial', resolvedVersion: 'initial',
        runtimeId: runtime.id, machineId: 'remote', flavor: 'codex', namespace: 'alpha' };
    const task = store.accept('alpha', h.parent, randomUUID(), { workspaceMode: 'worktree', baseRef: input.origin.baseCommit, message: 'result test', agentType: 'review' }, agent,
        { runtimeId: runtime.id, machineId: 'remote', flavor: 'codex', inspection: runtime.inspection! }, source);
    const bundle = store.require('alpha', task.agent_id), round = bundle.rounds[0]!, environment = bundle.task.environment;
    if (environment.mode !== 'worktree') throw new Error('expected worktree');
    const workspace = h.workspaces.get(ready.environmentId)!;
    environment.environmentId = workspace.environmentId; environment.checkout = workspace.checkout; environment.cwd = workspace.cwd; environment.machineId = 'remote';
    environment.remote = { origin: input.origin, snapshotId: input.id, consumerId: consumer.id };
    round.phase = 'finished'; round.finish = 'complete'; round.stop = 'stopped'; round.executionAbsent = true;
    round.git = { status: 'sealed', attempted: true, result: { environmentId: environment.environmentId, roundId: round.id,
        baseCommit: source.baseCommit, startHead: source.baseCommit, resultHead: 'b'.repeat(40), resultRef: `refs/hapi/workspaces/${environment.environmentId}/${round.id}`,
        partial: false, fileCount: 1, paths: ['main.ts'], sealedAt: Date.now() } };
    workspace.results[round.id] = structuredClone(round.git.result!); round.code = pendingCode();
    store.save(bundle.task, round, []);
    const engine = () => new TaskResults(h.alpha, store, baselines);
    const advance = async () => { const b = store.require('alpha', task.agent_id), r = b.rounds[0]!; await engine().advance(b.task, r, () => store.save(b.task, r, [])); return store.require('alpha', task.agent_id); };
    const action = (action: 'fetch' | 'retry', roundId: string | undefined = action === 'retry' ? round.id : undefined, requestId = randomUUID()) => store.resultAction('alpha', { parent: h.parent, id: task.agent_id, roundId, requestId, action });
    return { ...h, store, baselines, input, workspace, bundle, round, engine, advance, action, id: task.agent_id };
}

test('result publication batches files, pins both trees, reuses LFS and recovers a lost delivery receipt without a new export', async () => {
    const h = await fixture(103); h.faults.deliverLost = true;
    const first = await h.advance(); expect(first.rounds[0]!.code!.status).toBe('unknown');
    const exportId = first.rounds[0]!.code!.exportId;
    const done = await h.advance(), code = done.rounds[0]!.code!;
    expect(code.status).toBe('available'); expect(code.latest!.verified.kind).toBe('export'); expect(code.files!.filter(file => file.reused)).toHaveLength(103);
    expect(h.requests.filter(item => item.body.action === 'export-result')).toHaveLength(1);
    expect(h.requests.filter(item => item.body.action === 'deliver' && item.machine === 'remote')).toHaveLength(1);
    expect(code.exportId).toBe(exportId); expect(code.sourceReleased).toBe(true);
    for (const file of [...code.latest!.baseline.files, ...code.latest!.output.files]) expect(h.refs.get(file.artifactId)!.has(code.latest!.reference)).toBe(true);
    expect(h.store.codeManifests(h.id)).toHaveLength(1);
    const waited = await h.tasks!.wait('alpha', h.parent, [h.id], 0, { [h.id]: first.task.revision });
    expect(waited.timed_out).toBe(false); expect(waited.agents[0]!.code.status).toBe('available'); expect(waited.agents[0]!.code_revision).toBeGreaterThan(first.task.revision);
});

test('semantic mismatch never publishes; quota retry resumes fixed bytes and does not change sealed Git facts', async () => {
    const h = await fixture(); h.faults.resultMismatch = true;
    let b = await h.advance(); expect(b.rounds[0]!.code!.status).toBe('unknown'); expect(h.store.codeManifests(h.id)).toHaveLength(0);
    expect(b.rounds[0]!.git!.status).toBe('sealed');
    h.repos.get(b.rounds[0]!.code!.exportId)!.sealed!.result = structuredClone(h.round.git!.result!); h.faults.resultMismatch = false;
    h.faults.maxFileBytes = 1; b = await h.advance(); expect(b.rounds[0]!.code!.status).toBe('needs_attention');
    const fixed = structuredClone(b.rounds[0]!.code!.manifest); expect(h.requests.filter(item => item.body.action === 'capture' && item.machine === 'remote')).toHaveLength(0);
    const retry = h.action('retry'); expect(h.store.resultAction('alpha', { parent: h.parent, id: h.id, roundId: h.round.id, requestId: retry.request_id, action: 'retry' })).toEqual(retry);
    h.faults.maxFileBytes = 1_000_000; h.faults.partialDelivery = true;
    b = await h.advance(); expect(b.rounds[0]!.code!.status).toBe('needs_attention');
    h.faults.partialDelivery = false; h.action('retry'); b = await h.advance();
    expect(b.rounds[0]!.code!.status).toBe('available'); expect(b.rounds[0]!.code!.manifest).toEqual(fixed);
    expect(h.requests.filter(item => item.body.action === 'export-result')).toHaveLength(1); expect(b.rounds[0]!.git).toEqual(h.round.git);
});

test('fetch freezes the accepted round, keeps pending as state and reconciles an offline source and a lost fetch response', async () => {
    const h = await fixture(); const accepted = h.action('fetch', undefined);
    const run = async () => { const b = h.store.require('alpha', h.id), f = h.store.codeFetches(h.id).find(item => item.id === accepted.result_operation_id)!;
        await h.engine().advanceFetch(b.task, b.rounds.find(item => item.id === f.roundId)!, f); return h.store.codeFetches(h.id)[0]!; };
    expect((await run()).status).toBe('waiting');
    const next = h.store.append('alpha', h.parent, randomUUID(), { id: h.id, message: 'next', mode: 'next' });
    expect(h.store.resultAction('alpha', { parent: h.parent, id: h.id, requestId: accepted.request_id, action: 'fetch' }).round_id).toBe(h.round.id);
    await h.advance(); h.faults.sourceOffline = true; expect((await run()).status).toBe('unknown');
    h.faults.sourceOffline = false; h.faults.fetchLost = true; expect((await run()).status).toBe('unknown');
    expect(h.tasks!.read('alpha', h.parent, h.id, { roundId: h.round.id }).code.next?.action).toBe('read_agent');
    const fetched = await run(); expect(fetched.status).toBe('available'); expect(fetched.released).toBe(true);
    expect(h.tasks!.read('alpha', h.parent, h.id, { roundId: h.round.id }).code.next?.action).toBe('review');
    expect(fetched.roundId).not.toBe(next.round_id); expect(fetched.fetched!.head).toBe(h.round.git!.result!.resultHead);
    expect(h.requests.filter(item => item.body.action === 'fetch-result')).toHaveLength(1);
    const latest = h.action('fetch', undefined); expect(latest.round_id).toBe(next.round_id);
    expect(() => h.store.resultAction('alpha', { parent: { ...h.parent, machineId: 'wrong' }, id: h.id, requestId: randomUUID(), action: 'fetch' })).toThrow('发起仓库');
    const pending = await h.alpha.request('/api/runweft/tasks/result/show', resourceWrite({ parent: h.parent, id: h.id }));
    expect(pending.round_id).toBe(next.round_id); expect(pending.code.status).toBe('pending');
});

test('v5 migration preserves all fourteen legacy tables including task, session, file and baseline data', async () => {
    const h = await fixture(), old = h.store.require('alpha', h.id), round = old.rounds[0]!;
    // A legacy local task and its delivered file remain usable after the additive migration.
    delete round.code; delete round.codeRevision; delete round.git;
    old.task.environment = { mode: 'shared', machineId: h.parent.machineId, cwd: h.parent.cwd };
    round.preparation = { mode: 'shared', status: 'ready' }; round.sessionId = 'legacy-session'; round.nativeSessionId = 'legacy-native';
    round.report = 'legacy report'; round.outputFiles = { declarations: [], jobs: [{ id: randomUUID(), requestId: randomUUID(), kind: 'initial', createdAt: 1, phase: 'publishing', declarations: [], base: [] }] };
    h.store.save(old.task, round, []);
    const file = h.input.files![0]!;
    h.store.publishArtifacts(old.task, round, round.outputFiles.jobs[0]!, [{ name: 'legacy.bundle', relativePath: 'legacy.bundle', status: 'available', artifactId: file.artifactId, sha256: file.sha256, size: file.size }]);
    round.outputFiles.jobs[0]!.phase = 'complete'; h.store.save(old.task, round, []);
    h.store.beginArtifactIntent('alpha', h.parent, randomUUID(), { workspaceMode: 'shared', agentType: 'review', message: 'pending legacy input', inputs: [{ artifactId: file.artifactId! }] });
    await h.tasks!.close(); await h.preparations!.close();
    const db = new Database(h.statePath);
    db.exec('DROP TABLE hub_connection_requests; DROP TABLE hub_delegation_scopes; DROP TABLE hub_agent_selections; DROP TABLE hub_agent_blocks; DROP TABLE hub_agent_members; DROP TABLE hub_agent_versions; DROP TABLE hub_agents; DROP TABLE hub_checkouts; DROP TABLE hub_repository_aliases; DROP TABLE hub_repositories; DROP TABLE hub_resource_blocks; DROP TABLE hub_runtime_shares; DROP TABLE hub_resource_runtimes; DROP TABLE hub_machine_spaces; DROP TABLE hub_resource_machines; DROP TABLE hub_native_session_claims; DROP TABLE hub_file_reservations; DROP TABLE hub_execution_grants; DROP TABLE hub_execution_intents; DROP TABLE hub_execution_credentials; DROP TABLE hub_execution_objects; DROP TABLE hub_invitations; DROP TABLE hub_memberships; DROP TABLE hub_spaces; DROP TABLE hub_users; DROP TABLE delegation_code_fetches; DROP TABLE delegation_code_manifests; PRAGMA user_version=5;');
    const tables = (db.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map(row => row.name);
    expect(tables).toHaveLength(14);
    const snapshot = (database: Database) => Object.fromEntries(tables.map(name => [name, database.query(`SELECT * FROM ${name} ORDER BY rowid`).all()]));
    const before = snapshot(db); for (const rows of Object.values(before)) expect(rows.length).toBeGreaterThan(0); db.close();
    const migrated = openState(h.statePath);
    expect(migrated.query('PRAGMA user_version').get()).toEqual({ user_version: STATE_SCHEMA_VERSION }); expect(snapshot(migrated)).toEqual(before);
    const consumerColumn = (migrated.query('PRAGMA table_info(repository_consumers)').all() as { name: string; notnull: number }[]).find(column => column.name === 'importId');
    expect(consumerColumn!.notnull).toBe(1); migrated.close();
    const reopened = new TaskStore(h.statePath);
    try { expect(reopened.require('alpha', h.id).rounds[0]!.report).toBe('legacy report'); expect(reopened.manifests(h.id, round.id)[0]!.items[0]!.artifactId).toBe(file.artifactId); expect(reopened.codeManifests(h.id)).toHaveLength(0); }
    finally { reopened.close(); }
});

test('an unchanged initial HEAD publishes independent pins from the baseline while target is offline', async () => {
    const h = await fixture(), b = h.store.require('alpha', h.id), round = b.rounds[0]!;
    round.git!.result!.resultHead = round.git!.result!.baseCommit; round.git!.result!.fileCount = 0; round.git!.result!.paths = [];
    h.workspace.results[round.id] = structuredClone(round.git!.result!); h.store.save(b.task, round, []); h.faults.targetOffline = true;
    const complete = await h.advance(); expect(complete.rounds[0]!.code!.status).toBe('available');
    expect(complete.rounds[0]!.code!.latest!.verified.kind).toBe('baseline');
    expect(h.requests.some(item => item.body.action === 'export-result')).toBe(false);
    expect(complete.rounds[0]!.code!.files!.every(file => file.reused && file.pinned)).toBe(true);
});

test('a definitely failed capture blocks finishing and explicit retry does not require a finished round or alter the seal', async () => {
    const h = await fixture(), b = h.store.require('alpha', h.id), round = b.rounds[0]!;
    round.phase = 'finishing'; delete round.completedRevision; h.store.save(b.task, round, []);
    h.faults.resultFail = true;
    const engine = h.engine(), save = () => h.store.save(b.task, round, []);
    expect(await engine.advance(b.task, round, save)).toBe(false); expect(round.code!.status).toBe('needs_attention');
    const originalExport = round.code!.exportId, sealed = structuredClone(round.git);
    h.action('retry'); h.faults.resultFail = false;
    const retried = await h.advance(); expect(retried.rounds[0]!.code!.status).toBe('available'); expect(retried.rounds[0]!.phase).toBe('finishing');
    expect(retried.rounds[0]!.git).toEqual(sealed); expect(retried.rounds[0]!.code!.exportId).not.toBe(originalExport);
    expect(h.repos.get(originalExport)!.retention).toBe('released');
});
