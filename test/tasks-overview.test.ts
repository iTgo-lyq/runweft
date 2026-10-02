import { afterEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { hubDelegationFixture } from './hub-delegation-fixture';
import { resourceInspection, type NativeFixtureOptions } from './native-fixture';
import { HubAgentClient } from '../src/hub/agents/client';
import { agentSnapshot } from '../src/hub/delegation/context';
import type { AgentSnapshot, Parent, TaskBundle } from '../src/tasks/types';
import type { TaskOverview } from '../src/tasks/query';
import type { RuntimeRecord } from '../src/hub/resources/types';
import { pendingCode } from '../src/tasks/results';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const endpoint = '/api/runweft/tasks/overview';
async function overviewFixture(options: NativeFixtureOptions = {}) {
    const h = await hubDelegationFixture(cleanups, 'codex', undefined, options, 60_000);
    const snapshots = new Map<string, AgentSnapshot>();
    async function register(flavor: 'codex' | 'claude' = 'codex', other = false) {
        const actor = other ? h.outsider : h.actor, machineId = other || snapshots.size ? h.machine(actor) : h.machineId;
        const runtime = h.gateway.resources.store.registerRuntime(actor, { machineId, flavor }, resourceInspection(flavor));
        const agent = h.gateway.agents.create(actor, { requestId: crypto.randomUUID(), definition: { name: 'Review', instructions: 'PRIVATE DEFINITION', runtimeId: runtime.id, flavor } });
        const resolution = (await new HubAgentClient({ url: h.url, space: h.space, env: { RUNWEFT_IDENTITY_TOKEN: other ? h.other.token : h.owner.token } }).resolve({ agentId: agent.id })).resolution;
        snapshots.set(runtime.id, agentSnapshot(h.gateway.delegation.scopes.ensure(actor), resolution));
        return runtime;
    }
    return { ...h, snapshots, register };
}
type Fixture = Awaited<ReturnType<typeof overviewFixture>>;
const parent = (cwd: string, id: string, machineId = ''): Parent => ({ kind: 'mcp', machineId, cwd, host: 'codex', nativeSessionId: id });
function seed(h: Fixture, runtime: RuntimeRecord, owner: Parent, options: {
    worktree?: boolean; edit?: (bundle: TaskBundle) => void;
} = {}) {
    const agent = h.snapshots.get(runtime.id)!, ns = agent.namespace;
    owner = { ...owner, machineId: owner.machineId || runtime.machineId };
    const target = agent.hub!.target;
    const source = options.worktree ? { machineId: owner.machineId, repositoryId: 'source', sourcePath: owner.cwd,
        repositoryRoot: owner.cwd, commonDir: `${owner.cwd}/.git`, relativePath: '', baseRef: 'HEAD', baseCommit: 'a'.repeat(40), objectFormat: 'sha1' as const, dirty: false } : undefined;
    const accepted = h.gateway.delegation.coordinator.store.accept(ns, owner, crypto.randomUUID(), { agentType: agent.id, message: 'PRIVATE INPUT',
        workspaceMode: options.worktree ? 'worktree' : 'shared', ...(options.worktree ? { baseRef: 'HEAD' } : {}) }, agent, target, source);
    const bundle = h.gateway.delegation.coordinator.store.require(ns, accepted.agent_id);
    if (options.edit) { options.edit(bundle); h.gateway.delegation.coordinator.store.save(bundle.task, bundle.rounds[0], bundle.inputs); }
    return accepted;
}
const completed = ({ rounds }: TaskBundle) => Object.assign(rounds[0], { phase: 'finished', stop: 'stopped', finish: 'complete', sessionId: 'child-session', observedAt: 123 });
async function get(h: Fixture, query = '', identity = h.owner.token): Promise<TaskOverview & { namespace: string }> {
    const result = await h.request('overview' + query, undefined, await h.token(identity));
    if (result.status !== 200) throw Object.assign(new Error(result.body.error.message), result.body.error, { status: result.status });
    return result.body;
}

test('overview is authenticated and namespace wide, filters source workspace/parent/status with pagination', async () => {
    const h = await overviewFixture({ fetch: () => undefined });
    const own = await h.register(), remote = await h.register('claude'), beta = await h.register('codex', true);
    h.machines.find(m => m.id === remote.machineId)!.metadata!.displayName = 'Build machine';
    const first = seed(h, own, parent('/projects/Alpha', 'parent-one'), { edit: completed });
    const second = seed(h, remote, { ...parent('/projects/Beta', 'parent-two'), hapiSessionId: 'real-parent' }, { worktree: true, edit: b => {
        b.task.environment.cwd = '/managed/worktrees/child'; b.rounds[0].phase = 'preparing';
    } });
    seed(h, beta, parent('/projects/Secret', 'other-parent', beta.machineId));
    expect((await fetch(h.url + endpoint)).status).toBe(401);
    expect((await fetch(h.url + endpoint, { headers: { authorization: 'Bearer invalid' } })).status).toBe(401);
    const all = await get(h);
    expect(all.namespace).toBe(h.namespace); expect(all.total).toBe(2); expect(all.items.map(row => row.id)).toEqual([second.agent_id, first.agent_id]);
    const running = all.items[0];
    expect(running).toMatchObject({ phase: 'preparing', status: 'running', workspace_mode: 'worktree', cwd: '/managed/worktrees/child', session_id: null,
        parent: { cwd: '/projects/Beta', native_session_id: 'parent-two', session_id: 'real-parent' },
        runtime: { id: remote.id, name: 'claude', flavor: 'claude' }, machine: { name: 'Build machine', online: true }, agent: { scope: 'global', name: 'Review' } });
    expect(all.items[1]).toMatchObject({ status: 'completed', stop: 'stopped', session_id: 'child-session', observed_at: 123,
        parent: { native_session_id: 'parent-one', session_id: null }, code: { status: 'not_applicable' }, files: { status: 'none' } });
    expect((await get(h, '?workspace=alpha')).items.map(row => row.id)).toEqual([first.agent_id]);
    expect((await get(h, '?workspace=worktrees')).total).toBe(0);
    expect((await get(h, '?parent=PARENT-two&status=running')).items.map(row => row.id)).toEqual([second.agent_id]);
    expect((await get(h, '?parent=real-parent')).total).toBe(1);
    expect((await get(h, '?status=completed')).items[0].id).toBe(first.agent_id);
    const page = await get(h, '?limit=1&page=2');
    expect(page).toMatchObject({ page: 2, limit: 1, pages: 2, total: 2 }); expect(page.items[0].id).toBe(first.agent_id);
    expect((await get(h, '?page=3&limit=1')).items).toEqual([]);
    expect((await get(h, '', h.other.token)).items).toHaveLength(1);
    expect((await get(h, '?workspace=Secret')).items).toEqual([]);
});

test('overview distinguishes unknown, absent execution, stopped sessions and delivery problems; bounds content', async () => {
    const h = await overviewFixture({ fetch: () => undefined });
    const runtime = await h.register();
    const unknown = seed(h, runtime, parent('/p', 'unknown'), { edit: b => {
        b.rounds[0].phase = 'starting'; b.rounds[0].attention = { stage: 'spawn', code: 'spawn_unknown', message: 'Uncertain'.repeat(1000) };
        b.rounds[0].report = '<script>window.invalid=1</script>' + 'x'.repeat(2000);
    } });
    const absent = seed(h, runtime, parent('/p', 'absent'), { edit: b => {
        Object.assign(b.rounds[0], { phase: 'failed', executionAbsent: true });
    } });
    const delivered = seed(h, runtime, parent('/p', 'delivery'), { worktree: true, edit: b => {
        completed(b);
        b.rounds[0].attention = { stage: 'outputs', scope: 'artifacts', code: 'output_missing', message: 'Missing declared output' };
        b.rounds[0].outputFiles = { declarations: [], jobs: [], latest: { version: 1, jobId: 'output', kind: 'initial', createdAt: 1,
            status: 'incomplete', items: [{ name: 'report.txt', relativePath: 'report.txt', status: 'failed', error: { code: 'missing', message: 'not found' } }] } };
    } });
    const all = await get(h);
    const u = all.items.find(item => item.id === unknown.agent_id)!;
    expect(u).toMatchObject({ status: 'unknown', phase: 'starting', stop: 'not_started', execution_not_started: false, session_id: null });
    expect(u.summary.length).toBe(1000); expect(u.summary_truncated).toBe(true); expect(u.summary).toStartWith('<script>');
    expect(u.attention!.message!.length).toBe(1000);
    expect(all.items.find(item => item.id === absent.agent_id)).toMatchObject({ status: 'failed', execution_not_started: true });
    expect(all.items.find(item => item.id === delivered.agent_id)).toMatchObject({ status: 'completed', stop: 'stopped', files: { status: 'incomplete', count: 1, available: 0, error: { code: 'missing' } } });
    const serialized = JSON.stringify(all);
    for (const privateText of ['PRIVATE INPUT', 'PRIVATE DEFINITION', 'definition.yaml', 'manifest', 'permissions', 'nativeResult']) expect(serialized).not.toContain(privateText);
    expect(all.items.slice(0, 2).map(item => item.id)).toContain(unknown.agent_id);
    expect(all.items.slice(0, 2).map(item => item.id)).toContain(delivered.agent_id);
});

test('remote code publication, recovery refs and released results stay separate from execution', async () => {
    const h = await overviewFixture({ fetch: () => undefined });
    await h.register(); const remote = await h.register();
    const task = seed(h, remote, parent('/source', 'parent', h.machineId), { worktree: true, edit: b => {
        completed(b);
        const round = b.rounds[0];
        round.code = { ...pendingCode(), status: 'needs_attention', error: { code: 'upload_failed', message: 'Upload failed' } };
        round.git = { status: 'sealed', attempted: true, result: { environmentId: b.task.id, roundId: round.id, baseCommit: 'a'.repeat(40), startHead: 'a'.repeat(40),
            resultHead: 'b'.repeat(40), resultRef: `refs/hapi/workspaces/${b.task.id}/rounds/${round.id}`, partial: false, fileCount: 1, paths: ['PRIVATE FILE'], sealedAt: 1 } };
    } });
    expect((await get(h)).items[0]).toMatchObject({ status: 'completed', code: { status: 'needs_attention', storage: 'center', next: { action: 'retry_result' }, error: { code: 'upload_failed' } } });
    const bundle = h.gateway.delegation.coordinator.store.require(h.namespace, task.agent_id), round = bundle.rounds[0];
    round.code!.status = 'available'; delete round.code!.error;
    h.gateway.delegation.coordinator.store.save(bundle.task, round, []);
    expect((await get(h)).items[0].code).toMatchObject({ status: 'available', ref: null, next: { action: 'fetch_result' } });
    round.resultFetch = { id: crypto.randomUUID(), requestId: crypto.randomUUID(), status: 'available', ref: `refs/hapi/results/${bundle.task.id}/${round.id}` };
    h.gateway.delegation.coordinator.store.save(bundle.task, round, []);
    expect((await get(h)).items[0].code).toMatchObject({ ref: round.resultFetch.ref, next: { action: 'review' } });
    round.codeRetention = { state: 'released', createdAt: 1, completedAt: 2, discardPending: false, unpublished: false, references: [], copies: [] };
    h.gateway.delegation.coordinator.store.save(bundle.task, round, []);
    const released = (await get(h)).items[0];
    expect(released).toMatchObject({ status: 'completed', code: { status: 'released', ref: null, next: null } });
    expect(JSON.stringify(released)).not.toContain('PRIVATE FILE');
});

test('overview selects the earliest unfinished round instead of a queued continuation', async () => {
    const h = await overviewFixture({ fetch: () => undefined });
    const runtime = await h.register(), owner = parent('/p', 'parent', runtime.machineId);
    const accepted = seed(h, runtime, owner, { edit: b => { b.rounds[0].phase = 'running'; } });
    h.gateway.delegation.coordinator.store.append(h.namespace, owner, crypto.randomUUID(), { id: accepted.agent_id, message: 'PRIVATE QUEUED', mode: 'next' }, h.gateway.delegation.coordinator.store.require(h.namespace, accepted.agent_id).task.agent);
    expect((await get(h)).items[0]).toMatchObject({ round: 1, phase: 'running', round_id: accepted.round_id });
    const bundle = h.gateway.delegation.coordinator.store.require(h.namespace, accepted.agent_id); completed(bundle);
    h.gateway.delegation.coordinator.store.save(bundle.task, bundle.rounds[0], bundle.inputs.filter(input => input.roundId === bundle.rounds[0].id));
    expect((await get(h)).items[0]).toMatchObject({ round: 2, phase: 'queued' });
});

test('offline/unknown inventory preserves execution facts and query never probes or writes state', async () => {
    let failInventory = false;
    const h = await overviewFixture({ fetch: req => failInventory && new URL(req.url).pathname === '/api/machines' ? new Response('', { status: 503 }) : undefined });
    const runtime = await h.register();
    seed(h, runtime, parent('/p', 'active'));
    const done = seed(h, runtime, parent('/p', 'done'), { edit: completed });
    h.machines.find(m => m.id === runtime.machineId)!.active = false;
    const db = new Database(h.statePath, { readonly: true }); cleanups.push(() => db.close());
    const version = db.query('PRAGMA data_version').get(), before = h.gateway.delegation.coordinator.store.listNamespace(h.namespace);
    h.nativeCalls.length = 0;
    const offline = await get(h);
    expect(offline.inventory.available).toBe(true);
    expect(offline.items.every(item => item.machine.online === false)).toBe(true);
    expect(offline.items.find(item => item.id === done.agent_id)).toMatchObject({ possibly_stale: false, status: 'completed', stop: 'stopped' });
    expect(offline.items.find(item => item.id !== done.agent_id)!.possibly_stale).toBe(true);
    failInventory = true;
    const unknown = await get(h);
    expect(unknown.inventory).toMatchObject({ available: false, error: { code: 'inventory_unavailable' } });
    expect(unknown.items.every(item => item.machine.online === null)).toBe(true);
    expect(unknown.items.find(item => item.id === done.agent_id)).toMatchObject({ status: 'completed', stop: 'stopped', possibly_stale: false });
    expect(h.nativeCalls.every(call => call.method === 'GET' && ['/health', '/api/machines'].includes(call.path))).toBe(true);
    expect(db.query('PRAGMA data_version').get()).toEqual(version);
    expect(h.gateway.delegation.coordinator.store.listNamespace(h.namespace)).toEqual(before);
});

test('overview rejects writes, namespace overrides, duplicate/invalid filters and unbounded pages', async () => {
    const h = await overviewFixture({ fetch: () => undefined });
    const empty = await get(h); expect(empty).toMatchObject({ total: 0, page: 1, pages: 1, limit: 50, items: [] });
    for (const query of ['?namespace=beta', '?page=0', '?page=-1', '?page=1.5', '?page=1e3', '?page=999999999999999999', '?limit=101', '?status=bogus', '?page=1&page=2', '?parent=' + 'a'.repeat(513)]) {
        const result = await h.request('overview' + query); expect(result.status).toBe(400); expect(result.body.error.code).toBe(query === '?namespace=beta' ? 'invalid_native_request' : 'invalid_task_request');
    }
    expect((await h.request('overview', {})).status).toBe(405);
});

test('inventory timeout is bounded and retains persisted task data', async () => {
    let release: (() => void) | undefined, hang = false;
    const h = await overviewFixture({ fetch: async req => {
        if (hang && new URL(req.url).pathname === '/api/machines') { await new Promise<void>(resolve => { release = resolve; }); return Response.json({ machines: [] }); }
    } });
    const runtime = await h.register(); seed(h, runtime, parent('/p', 'parent')); hang = true;
    try {
        const started = performance.now(), result = await get(h);
        expect(performance.now() - started).toBeLessThan(4500);
        expect(result.inventory.available).toBe(false); expect(result.total).toBe(1); expect(result.items[0].machine.online).toBeNull();
    } finally { release?.(); }
}, 6000);

test('thousand-task query returns a bounded page without execution or state writes', async () => {
    const h = await overviewFixture({ fetch: () => undefined });
    const runtime = await h.register();
    for (let i = 0; i < 1000; i++) seed(h, runtime, parent(`/p/${i % 10}`, `parent-${i}`));
    h.nativeCalls.length = 0;
    const started = performance.now(), all = await get(h, '?limit=100');
    const elapsed = performance.now() - started;
    expect(all.total).toBe(1000); expect(all.pages).toBe(10); expect(all.items.length).toBe(100);
    expect(elapsed).toBeLessThan(5000);
    expect(h.nativeCalls.every(call => call.method === 'GET' && ['/health', '/api/machines'].includes(call.path))).toBe(true);
    console.info(`Task overview: 1000 tasks, page of 100, ${elapsed.toFixed(1)}ms`);
}, 15_000);

test('inventory failure after membership withdrawal never becomes a successful read degradation', async () => {
    let entered!: () => void, release!: () => void, hang = false;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    const h = await overviewFixture({ fetch: async req => {
        if (hang && new URL(req.url).pathname === '/api/machines') {
            entered(); await new Promise<void>(resolve => { release = resolve; });
            return new Response('', { status: 503 });
        }
    } });
    const runtime = await h.register('codex', true); seed(h, runtime, parent('/p', 'private'));
    const jwt = await h.token(h.other.token); hang = true;
    const reading = h.request('overview', undefined, jwt);
    await waiting;
    h.hub.changeMember(h.owner.identity.id, h.space, h.other.identity.id, null);
    release(); const result = await reading;
    expect(result.status).toBe(401); expect(result.body).not.toHaveProperty('items');
});
