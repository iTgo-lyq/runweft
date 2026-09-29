import { afterEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import type { ManagedWorkspace, WorkspaceMutation, WorkspaceRequest } from '../hapi/shared/src/workspaces';
import { taskFixture, until } from './tasks-fixture';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

// Protocol fixture for the real coordinator/HTTP/SQLite tests; actual Git is verified in HAPI and compiled smoke.
function workspaces() {
    const records = new Map<string, ManagedWorkspace>(), calls: WorkspaceRequest[] = [];
    const control = { holdPrepare: false, holdFinish: false, failPrepare: false, failFinish: false, dropPrepare: false, rejectResolve: false,
        base: 'a'.repeat(40), onFinalize: () => {} };
    function update(workspace: ManagedWorkspace) {
        for (const operation of Object.values(workspace.operations)) {
            if (operation.status !== 'accepted') continue;
            const request = operation.request;
            if (request.action === 'prepare') {
                if (control.holdPrepare) continue;
                operation.status = control.failPrepare ? 'failed' : 'succeeded';
                if (control.failPrepare) operation.error = { code: 'git_failed', message: 'Checkout initialization failed' };
                else workspace.preparations[request.preparationId] = { environmentId: request.environmentId, preparationId: request.preparationId,
                    roundId: request.roundId, cwd: workspace.cwd, startHead: request.expectedHead, inputs: [], readyAt: Date.now() };
            } else if (request.action === 'finalize') {
                if (control.holdFinish) continue;
                operation.status = control.failFinish ? 'failed' : 'succeeded';
                if (control.failFinish) operation.error = { code: 'git_failed', message: 'Commit hook failed' };
                else workspace.results[request.roundId] = { environmentId: request.environmentId, roundId: request.roundId,
                    baseCommit: workspace.source.baseCommit, startHead: workspace.preparations[request.preparationId]!.startHead,
                    resultHead: (Object.keys(workspace.results).length ? 'c' : 'b').repeat(40), resultRef: `refs/hapi/workspaces/${request.environmentId}/rounds/${request.roundId}`,
                    partial: request.partial, fileCount: 1, paths: ['file.txt'], sealedAt: Date.now() };
            }
        }
    }
    return { records, calls, control, handler: async (http: Request) => {
        const request = await http.json() as WorkspaceRequest; calls.push(request);
        if (request.action === 'resolve' && control.rejectResolve) return Response.json({ code: 'git_failed', error: 'Git baseline does not exist', hint: 'Choose an existing commit' }, { status: 409 });
        if (request.action === 'resolve') return Response.json({ source: { machineId: 'own', repositoryId: 'repository', sourcePath: request.cwd,
            repositoryRoot: request.cwd, commonDir: request.cwd + '/.git', relativePath: '', baseRef: request.baseRef,
            baseCommit: control.base, objectFormat: 'sha1', dirty: true } });
        let workspace = records.get(request.environmentId);
        if (!workspace && request.action === 'prepare') {
            workspace = { version: 1, environmentId: request.environmentId, source: request.source, checkout: `/prepared/${request.environmentId}`,
                cwd: `/prepared/${request.environmentId}`, branch: `hapi-task/${request.environmentId}`, status: 'retained', createdAt: Date.now(),
                preparations: {}, results: {}, operations: {}, sessions: {} }; records.set(request.environmentId, workspace);
        }
        if (!workspace) return Response.json({ code: 'workspace_not_found' }, { status: 404 });
        if (request.action === 'inspect') { update(workspace); return Response.json({ workspace }); }
        const key = request.action === 'prepare' ? `prepare:${request.preparationId}` : request.action === 'finalize' ? `finalize:${request.roundId}:${request.attemptId}` : `remove:${request.attemptId}`;
        if (!workspace.operations[key]) {
            if (request.action === 'finalize') control.onFinalize();
            workspace.operations[key] = { id: key, request: request as WorkspaceMutation, status: 'accepted', createdAt: Date.now(), updatedAt: Date.now() };
        } else expect(workspace.operations[key]!.request).toEqual(request);
        if (request.action === 'prepare' && control.dropPrepare) { control.dropPrepare = false; return new Response('', { status: 502 }); }
        return Response.json({ workspace, operation: workspace.operations[key] });
    } };
}

test('unversioned shared task data remains readable and can continue without Git preparation', async () => {
    const h = await taskFixture(cleanups);
    const request = h.payload(), accepted = await h.post('spawn', request), id = accepted.agent_id;
    const running = await until(() => h.post('read', { id }), value => value.inputs[0]?.observation?.phase === 'accepted');
    h.complete(running.session_id);
    await until(() => h.post('read', { id }), value => value.status === 'completed');
    const db = new Database(h.statePath);
    db.query("UPDATE delegation_tasks SET data=json_remove(data, '$.version') WHERE id=?").run(id); db.close();
    expect(h.tasks!.store.require('alpha', id).task.version).toBe(2);
    expect(await h.post('spawn', request)).toEqual(accepted);
    const next = await h.post('send', { requestId: crypto.randomUUID(), intent: { id, message: 'Continue legacy task', mode: 'next' } });
    const resumed = await until(() => h.post('read', { id }), value => value.round_id === next.round_id && value.inputs[0]?.observation?.phase === 'accepted');
    expect(resumed.cwd).toBe(h.cwd); expect(resumed.git).toBe('not_applicable'); expect(h.calls.resume).toBe(1);
});

test('invalid Git baseline preserves HAPI diagnosis and accepts no task or native execution', async () => {
    const git = workspaces(); git.control.rejectResolve = true;
    const h = await taskFixture(cleanups, 'codex', git.handler);
    await expect(h.post('spawn', { ...h.payload(), intent: { ...h.intent, workspaceMode: 'worktree', baseRef: 'missing' } }))
        .rejects.toMatchObject({ code: 'git_failed', message: 'Git baseline does not exist', hint: 'Choose an existing commit' });
    expect((await h.post('list')).agents).toHaveLength(0); expect(h.calls.spawn).toBe(0);
});

test('worktree preparation gates execution, pins the first accepted base and persists the actual directory', async () => {
    const git = workspaces(); git.control.holdPrepare = true; git.control.dropPrepare = true;
    const h = await taskFixture(cleanups, 'codex', git.handler);
    const request = { ...h.payload(), intent: { ...h.intent, workspaceMode: 'worktree' } };
    const accepted = await h.post('spawn', request), id = accepted.agent_id;
    await until(() => h.post('read', { id }), value => value.phase === 'preparing');
    await Bun.sleep(100); expect(h.calls.spawn).toBe(0); expect(h.calls.send).toBe(0);
    git.control.base = 'd'.repeat(40);
    expect(await h.post('spawn', request)).toMatchObject(accepted);
    expect(git.calls.filter(call => call.action === 'resolve')).toHaveLength(1);
    git.control.holdPrepare = false;
    const running = await until(() => h.post('read', { id }), value => value.inputs[0]?.observation?.phase === 'accepted');
    expect(running.cwd).toBe(`/prepared/${id}`); expect(running.environment.source.baseCommit).toBe('a'.repeat(40));
    expect(running.preparation.startHead).toBe('a'.repeat(40)); expect(h.calls.spawn).toBe(1);
    expect(git.calls.filter(call => call.action === 'prepare')).toHaveLength(1);
    expect(h.tasks!.store.require('alpha', id).task.environment.cwd).toBe(running.cwd);
    const prompt = JSON.stringify(h.sessions.get(running.session_id)!.messages);
    expect(prompt).toContain('独立 Git worktree'); expect(prompt).toContain('未提交改动');
});

test('preparation failure does not launch a native process', async () => {
    const git = workspaces(); git.control.failPrepare = true;
    const h = await taskFixture(cleanups, 'codex', git.handler);
    const accepted = await h.post('spawn', { ...h.payload(), intent: { ...h.intent, workspaceMode: 'worktree' } });
    const failed = await until(() => h.post('read', { id: accepted.agent_id }), value => value.status === 'failed');
    expect(failed.attention.scope).toBe('workspace'); expect(failed.preparation.status).toBe('failed');
    expect(failed.native_status[0].phase).toBe('not_observed'); expect(h.calls.spawn).toBe(0); expect(h.calls.send).toBe(0);
});

test('wait and later rounds stay blocked until Git seals; finishing cannot be cancelled', async () => {
    const git = workspaces(); git.control.holdFinish = true;
    const h = await taskFixture(cleanups, 'codex', git.handler);
    const accepted = await h.post('spawn', { ...h.payload(), intent: { ...h.intent, workspaceMode: 'worktree', baseRef: 'HEAD' } }), id = accepted.agent_id;
    const running = await until(() => h.post('read', { id }), value => value.inputs[0]?.observation?.phase === 'accepted');
    git.control.onFinalize = () => expect(h.sessions.get(running.session_id)!.session.active).toBe(false);
    h.complete(running.session_id);
    const finishing = await until(() => h.post('read', { id }), value => value.phase === 'finishing' && value.git.status === 'sealing');
    expect(finishing.stop).toBe('stopped'); expect(finishing.finish).toBe('pending'); expect(finishing.native_status[0].phase).toBe('completed');
    expect((await h.post('wait', { ids: [id], timeoutMs: 0 })).timed_out).toBe(true);
    expect((await h.post('interrupt', { id, roundId: accepted.round_id })).status).toBe('execution_already_stopped');
    expect((await h.post('read', { id })).cancellation).toBeUndefined();
    const next = await h.post('send', { requestId: crypto.randomUUID(), intent: { id, message: 'Next', mode: 'next' } });
    await Bun.sleep(60); expect(h.calls.resume).toBe(0); expect(h.calls.spawn).toBe(1);
    git.control.holdFinish = false;
    const resumed = await until(() => h.post('read', { id }), value => value.round_id === next.round_id && value.inputs[0]?.observation?.phase === 'accepted');
    const first = await h.post('read', { id, roundId: accepted.round_id });
    expect(first.status).toBe('completed'); expect(first.git.result_head).toBe('b'.repeat(40));
    expect(resumed.preparation.startHead).toBe(first.git.result_head); expect(resumed.cwd).toBe(running.cwd);
    expect(h.calls.resume).toBe(1); expect(h.calls.spawn).toBe(1);
    expect(h.sessions.get(resumed.session_id)!.session.metadata!.preparedWorkspace?.preparationId).toBe(resumed.preparation.preparationId);
});

test('explicit retry-finish retains native success and report without resending input', async () => {
    const git = workspaces(); git.control.failFinish = true;
    const h = await taskFixture(cleanups, 'claude', git.handler);
    const accepted = await h.post('spawn', { ...h.payload(), intent: { ...h.intent, workspaceMode: 'worktree' } }), id = accepted.agent_id;
    const running = await until(() => h.post('read', { id }), value => value.inputs[0]?.observation?.phase === 'accepted');
    h.complete(running.session_id, 'RETAINED_REPORT');
    const failed = await until(() => h.post('read', { id }), value => value.git.status === 'needs_attention');
    expect(failed.status).toBe('needs_attention'); expect(failed.attention.scope).toBe('workspace');
    expect(failed.native_status[0].phase).toBe('completed'); expect(failed.report.text).toBe('RETAINED_REPORT');
    await Bun.sleep(80); expect(git.calls.filter(call => call.action === 'finalize')).toHaveLength(1);
    git.control.failFinish = false;
    expect((await h.post('retry-finish', { id, roundId: accepted.round_id })).status).toBe('retry_requested');
    const result = await until(() => h.post('read', { id }), value => value.status === 'completed');
    expect(result.git.status).toBe('sealed'); expect(result.delivery.git.result_ref).toBe(result.git.result_ref);
    expect(h.calls.spawn).toBe(1); expect(h.calls.send).toBe(1); expect(h.calls.resume).toBe(0);
    const attempts = git.calls.filter(call => call.action === 'finalize').map(call => call.action === 'finalize' && call.attemptId);
    expect(new Set(attempts).size).toBe(2);
});
