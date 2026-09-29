import { afterEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { TaskCoordinator } from '../src/tasks/coordinator';
import { HapiClient } from '../src/hapi';
import { workspaces } from './workspaces-fixture';
import { taskFixture, until } from './tasks-fixture';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });


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
    expect(failed.native_status[0].phase).toBe('not_started'); expect(h.calls.spawn).toBe(0); expect(h.calls.send).toBe(0);
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

test('cancelling during preparation seals without launching and leaves the environment reusable', async () => {
    const git = workspaces(); git.control.holdPrepare = true;
    const h = await taskFixture(cleanups, 'codex', git.handler);
    const accepted = await h.post('spawn', { ...h.payload(), intent: { ...h.intent, workspaceMode: 'worktree' } }), id = accepted.agent_id;
    await until(() => h.post('read', { id }), value => value.preparation.status === 'accepted');
    await h.post('interrupt', { id, roundId: accepted.round_id });
    git.control.holdPrepare = false;
    const cancelled = await until(() => h.post('read', { id }), value => value.status === 'interrupted');
    expect(cancelled.execution_not_started).toBe(true); expect(cancelled.session_id).toBeUndefined();
    expect(cancelled.native_status[0].phase).toBe('not_started'); expect(cancelled.report.incomplete).toBe(false);
    expect(cancelled.git.status).toBe('sealed'); expect(cancelled.git.partial).toBe(true);
    expect(h.calls.spawn).toBe(0); expect(h.calls.resume).toBe(0); expect(h.calls.send).toBe(0);
    expect(git.calls.find(call => call.action === 'finalize')).not.toHaveProperty('sessionId');
    const next = await h.post('send', { requestId: crypto.randomUUID(), intent: { id, message: 'Actually run', mode: 'next' } });
    const running = await until(() => h.post('read', { id }), value => value.round_id === next.round_id && value.inputs[0]?.observation?.phase === 'accepted');
    expect(running.cwd).toBe(cancelled.cwd); expect(running.preparation.startHead).toBe(cancelled.git.result_head);
    expect(h.calls.spawn).toBe(1); expect(h.calls.resume).toBe(0);
});

test('definite launch rejection seals its prepared round before another round can start', async () => {
    const git = workspaces(), h = await taskFixture(cleanups, 'codex', git.handler); h.faults.spawn = 'rejected';
    const accepted = await h.post('spawn', { ...h.payload(), intent: { ...h.intent, workspaceMode: 'worktree' } }), id = accepted.agent_id;
    const failed = await until(() => h.post('read', { id }), value => value.status === 'failed');
    expect(failed.execution_not_started).toBe(true); expect(failed.git.status).toBe('sealed'); expect(failed.git.partial).toBe(true);
    expect(failed.native_status[0].phase).toBe('not_started'); expect(h.calls.send).toBe(0);
    expect(git.calls.find(call => call.action === 'finalize')).not.toHaveProperty('sessionId');
    h.faults.spawn = 'none';
    await h.post('send', { requestId: crypto.randomUUID(), intent: { id, message: 'Continue after repair', mode: 'next' } });
    const next = await until(() => h.post('read', { id }), value => value.inputs[0]?.observation?.phase === 'accepted');
    expect(next.cwd).toBe(failed.cwd); expect(h.calls.spawn).toBe(2); expect(h.calls.resume).toBe(0);
});

test('interrupted execution seals partial output only after confirmed stop', async () => {
    const git = workspaces(), h = await taskFixture(cleanups, 'claude', git.handler); h.faults.stop = true;
    const accepted = await h.post('spawn', { ...h.payload(), intent: { ...h.intent, workspaceMode: 'worktree' } }), id = accepted.agent_id;
    await until(() => h.post('read', { id }), value => value.inputs[0]?.observation?.phase === 'accepted');
    await h.post('interrupt', { id, roundId: accepted.round_id });
    await until(() => h.post('read', { id }), value => value.attention?.code === 'task_stop_unknown');
    expect(git.calls.some(call => call.action === 'finalize')).toBe(false);
    h.faults.stop = false;
    const done = await until(() => h.post('read', { id }), value => value.status === 'interrupted');
    expect(done.git.status).toBe('sealed'); expect(done.git.partial).toBe(true); expect(done.stop).toBe('stopped');
    expect(h.calls.send).toBe(1);
});

test('deletion excludes send, deduplicates pending removal, and preserves reports and result refs', async () => {
    const git = workspaces(), h = await taskFixture(cleanups, 'codex', git.handler); git.control.holdRemove = true; git.control.dropRemove = true;
    const accepted = await h.post('spawn', { ...h.payload(), intent: { ...h.intent, workspaceMode: 'worktree' } }), id = accepted.agent_id;
    const running = await until(() => h.post('read', { id }), value => value.inputs[0]?.observation?.phase === 'accepted');
    await expect(h.post('workspace/remove', { id })).rejects.toMatchObject({ code: 'workspace_round_pending' });
    h.complete(running.session_id, 'KEEP_REPORT');
    const done = await until(() => h.post('read', { id }), value => value.status === 'completed');
    const acceptedRemove = await h.post('workspace/remove', { id });
    await until(() => h.post('read', { id }), value => value.git.removal?.status === 'running');
    const repeated = await h.post('workspace/remove', { id });
    expect(repeated.environment.removal.attemptId).toBe(acceptedRemove.environment.removal.attemptId);
    await expect(h.post('send', { requestId: crypto.randomUUID(), intent: { id, mode: 'next', message: 'Race' } })).rejects.toMatchObject({ code: 'workspace_not_retained' });
    await expect(h.post('workspace/remove', { id, discardIgnored: true })).rejects.toMatchObject({ code: 'workspace_remove_pending' });
    git.control.holdRemove = false;
    const removed = await until(() => h.post('read', { id }), value => value.git.retained === 'removed');
    expect(removed.status).toBe('completed'); expect(removed.report.text).toBe('KEEP_REPORT'); expect(removed.git.result_ref).toBe(done.git.result_ref);
    expect((await h.post('list', { all: true })).agents[0].git.retained).toBe('removed');
    expect(git.calls.filter(call => call.action === 'remove')).toHaveLength(1);
    await expect(h.post('send', { requestId: crypto.randomUUID(), intent: { id, mode: 'next', message: 'After removal' } })).rejects.toMatchObject({ code: 'workspace_not_retained' });
    expect((await h.post('workspace/remove', { id })).environment.status).toBe('removed');
});

test('accepted next-round and deletion are mutually exclusive in the task transaction', async () => {
    const git = workspaces(), h = await taskFixture(cleanups, 'codex', git.handler);
    const accepted = await h.post('spawn', { ...h.payload(), intent: { ...h.intent, workspaceMode: 'worktree' } }), id = accepted.agent_id;
    const running = await until(() => h.post('read', { id }), value => value.inputs[0]?.observation?.phase === 'accepted');
    h.complete(running.session_id); await until(() => h.post('read', { id }), value => value.status === 'completed');
    git.control.holdPrepare = true;
    const results = await Promise.allSettled([
        h.post('send', { requestId: crypto.randomUUID(), intent: { id, message: 'Next', mode: 'next' } }), h.post('workspace/remove', { id }),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
    expect(['workspace_not_retained', 'workspace_round_pending']).toContain(failure.reason.code);
});

test('ignored removal failure retains the workspace and needs explicit discard before a new attempt', async () => {
    const git = workspaces(), h = await taskFixture(cleanups, 'claude', git.handler); git.control.failRemove = true; git.control.failPrepare = true;
    const accepted = await h.post('spawn', { ...h.payload(), intent: { ...h.intent, workspaceMode: 'worktree' } }), id = accepted.agent_id;
    await until(() => h.post('read', { id }), value => value.status === 'failed');
    const first = await h.post('workspace/remove', { id });
    const failed = await until(() => h.post('read', { id }), value => value.git.removal?.status === 'failed');
    expect(failed.git.retained).toBe('retained'); expect(failed.git.removal.error.code).toBe('workspace_ignored_files');
    expect(failed.git.removal.error.hint).toContain(`task workspace remove ${id} --discard-ignored`);
    const next = await h.post('workspace/remove', { id, discardIgnored: true });
    expect(next.environment.removal.attemptId).not.toBe(first.environment.removal.attemptId);
    await until(() => h.post('read', { id }), value => value.git.retained === 'removed');
    expect(git.calls.filter(call => call.action === 'remove').every(call => call.action === 'remove' && call.expectedHead === 'a'.repeat(40))).toBe(true);
    expect(h.calls.spawn).toBe(0);
});

test('restart reconciles lost seal and delete responses without new operations or model replay', async () => {
    const git = workspaces(), h = await taskFixture(cleanups, 'codex', git.handler); git.control.holdFinish = true; git.control.dropFinish = true;
    const accepted = await h.post('spawn', { ...h.payload(), intent: { ...h.intent, workspaceMode: 'worktree' } }), id = accepted.agent_id;
    const running = await until(() => h.post('read', { id }), value => value.inputs[0]?.observation?.phase === 'accepted');
    h.complete(running.session_id);
    await until(() => h.post('read', { id }), value => value.phase === 'finishing' && ['sealing', 'unknown'].includes(value.git.status));
    await h.tasks!.close();
    const replacement = new TaskCoordinator(h.statePath, namespace => new HapiClient(h.nativeUrl, `test-${namespace}`), 20);
    cleanups.push(() => replacement.close()); replacement.start(); git.control.holdFinish = false;
    await until(() => replacement.read('alpha', h.parent, id), value => value.status === 'completed');
    expect(git.calls.filter(call => call.action === 'finalize')).toHaveLength(1);
    git.control.holdRemove = true; git.control.dropRemove = true;
    await replacement.removeWorkspace('alpha', { parent: h.parent, id });
    await until(() => git.calls.filter(call => call.action === 'remove').length, count => count === 1);
    await replacement.close();
    const last = new TaskCoordinator(h.statePath, namespace => new HapiClient(h.nativeUrl, `test-${namespace}`), 20);
    cleanups.push(() => last.close()); last.start(); git.control.holdRemove = false;
    await until(() => last.read('alpha', h.parent, id), value => value.git !== 'not_applicable' && value.git.retained === 'removed');
    expect(git.calls.filter(call => call.action === 'remove')).toHaveLength(1);
    expect(h.calls.spawn).toBe(1); expect(h.calls.send).toBe(1);
});

test('shared paths and MCP cleanup are rejected without issuing Git operations', async () => {
    const git = workspaces(), h = await taskFixture(cleanups, 'codex', git.handler);
    const accepted = await h.post('spawn', h.payload());
    await expect(h.post('workspace/remove', { id: accepted.agent_id })).rejects.toMatchObject({ code: 'workspace_shared' });
    await expect(h.post('workspace/remove', { id: accepted.agent_id, parent: { kind: 'mcp', machineId: 'own', cwd: h.cwd, host: 'codex', nativeSessionId: 'parent' } }))
        .rejects.toMatchObject({ code: 'workspace_remove_cli_only' });
    expect(git.calls).toHaveLength(0);
});
