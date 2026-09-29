import { afterEach, expect, test } from 'bun:test';
import { taskFixture, until } from './tasks-fixture';
import { parseReport } from '../src/tasks/reports';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const send = (id: string, message = 'Next task', mode = 'next', roundId?: string) => ({ requestId: crypto.randomUUID(), intent: { id, message, mode, ...(roundId ? { roundId } : {}) } });

test('both runtimes queue rounds, wait for confirmed stop, reuse fixed environment and expose each completion cursor', async () => {
    for (const flavor of ['codex', 'claude'] as const) {
        const h = await taskFixture(cleanups, flavor);
        const first = await h.post('spawn', h.payload());
        const active = await until(() => h.post('read', { id: first.agent_id }), value => value.inputs[0]?.observation?.phase === 'accepted');
        const followup = send(first.agent_id);
        const second = await h.post('send', { ...followup, parent: { ...h.parent, cwd: '/another/operator/directory' } });
        expect(await h.post('send', { ...followup, parent: { ...h.parent, cwd: '/another/operator/directory' } })).toMatchObject(second);
        expect((await h.post('wait', { ids: [first.agent_id], timeoutMs: 0 })).timed_out).toBe(true);
        h.faults.stop = true; h.complete(active.session_id, 'First report');
        const blocked = await until(() => h.post('read', { id: first.agent_id }), value => value.blocking_round_id === first.round_id);
        expect(blocked.phase).toBe('queued'); expect(blocked.status).toBe('unknown'); expect(h.calls.resume).toBe(0);
        h.faults.stop = false;
        const resumed = await until(() => h.post('read', { id: first.agent_id }), value => value.inputs[0]?.observation?.phase === 'accepted');
        expect(resumed.round_id).toBe(second.round_id); expect(resumed.session_id).toBe(active.session_id);
        expect(resumed.native_session_id).toBe(active.native_session_id); expect(resumed.cwd).toBe(h.cwd); expect(h.calls.spawn).toBe(1); expect(h.calls.resume).toBe(1);
        const notification = await h.post('wait', { ids: [first.agent_id], timeoutMs: 0, afterRevision: { [first.agent_id]: first.revision } });
        expect(notification.agents[0].round_id).toBe(first.round_id); expect(notification.agents[0].revision).toBe(notification.agents[0].completed_revision);
        expect((await h.post('wait', { ids: [first.agent_id], timeoutMs: 0, afterRevision: { [first.agent_id]: notification.agents[0].revision } })).timed_out).toBe(true);
        const controls = h.calls.interrupt;
        expect((await h.post('interrupt', { id: first.agent_id, roundId: first.round_id })).status).toBe('already_finished');
        expect(h.calls.interrupt).toBe(controls);
        h.complete(resumed.session_id, '```runweft-report\n{"summary":"Second","changes":["one"],"tests":"passed","remaining":[]}\n```');
        const done = await until(() => h.post('read', { id: first.agent_id }), value => value.status === 'completed');
        expect(done.report.structuredMissing).toBe(false); expect(done.report.structured.summary).toBe('Second');
        expect(done.report.text).not.toContain('First report');
        const nextEvent = await h.post('wait', { ids: [first.agent_id], timeoutMs: 0, afterRevision: { [first.agent_id]: notification.agents[0].revision } });
        expect(nextEvent.agents[0].round_id).toBe(second.round_id); expect(nextEvent.timed_out).toBe(false);
    }
});

test('resume follows actual returned HAPI identity and lost success is reconciled without replay', async () => {
    for (const mode of ['new', 'lost']) {
        const h = await taskFixture(cleanups), first = await h.post('spawn', h.payload());
        const active = await until(() => h.post('read', { id: first.agent_id }), value => value.inputs[0]?.observation?.phase === 'accepted');
        h.complete(active.session_id);
        await until(() => h.post('read', { id: first.agent_id }), value => value.status === 'completed');
        if (mode === 'lost') {
            const saved = h.tasks!.store.require('alpha', first.agent_id);
            saved.rounds[0].nativeSessionId = undefined; // Missing cached identity is not proof that native history is gone.
            h.tasks!.store.save(saved.task, saved.rounds[0], saved.inputs);
        }
        h.faults.resume = mode; await h.post('send', send(first.agent_id));
        const resumed = await until(() => h.post('read', { id: first.agent_id }), value => value.inputs[0]?.observation?.phase === 'accepted');
        expect(resumed.resume.previousSessionId).toBe(active.session_id);
        expect(resumed.native_session_id).toBe(active.native_session_id);
        if (mode === 'new') expect(resumed.session_id).not.toBe(active.session_id);
        else expect(resumed.session_id).toBe(active.session_id);
        expect(h.calls.resume).toBe(1); expect(h.calls.spawn).toBe(1);
        expect(() => h.tasks!.store.assertCanDelegate('alpha', { ...h.parent, hapiSessionId: resumed.session_id })).toThrow('再次');
    }
});

test('only native_session_missing reconstructs bounded business context; unknown and wrong target never send a new task', async () => {
    for (const mode of ['missing', 'unseen', 'mismatch']) {
        const h = await taskFixture(cleanups), first = await h.post('spawn', h.payload());
        const active = await until(() => h.post('read', { id: first.agent_id }), value => value.inputs[0]?.observation?.phase === 'accepted');
        h.complete(active.session_id, 'HISTORICAL_REPORT');
        await until(() => h.post('read', { id: first.agent_id }), value => value.status === 'completed');
        h.faults.resume = mode; const next = await h.post('send', send(first.agent_id, 'New task only'));
        if (mode === 'missing') {
            const current = await until(() => h.post('read', { id: first.agent_id }), value => value.inputs[0]?.observation?.phase === 'accepted');
            expect(current.reconstruction).toEqual({ reason: 'native_session_missing', source_round_ids: [first.round_id] });
            expect(current.session_id).not.toBe(active.session_id); expect(h.calls.spawn).toBe(2);
            const prompt = h.sessions.get(current.session_id)!.messages.find(message => message.localId === current.inputs[0].id)!.content as any;
            expect(prompt.content.text).toContain('HISTORICAL_REPORT'); expect(prompt.content.text).toContain('不要重新执行旧工具'); expect(prompt.content.text).toContain('New task only');
        } else if (mode === 'unseen') {
            const unknown = await until(() => h.post('read', { id: first.agent_id }), value => value.attention?.code === 'task_resume_unknown');
            expect(unknown.reconstruction).toBeUndefined();
            await h.post('interrupt', { id: first.agent_id, roundId: next.round_id });
            await Bun.sleep(80);
            expect((await h.post('read', { id: first.agent_id })).status).toBe('unknown');
            expect(h.calls.spawn).toBe(1); expect(h.calls.send).toBe(1); expect(h.calls.resume).toBe(1);
        } else {
            const failed = await until(() => h.post('read', { id: first.agent_id }), value => value.status === 'failed');
            expect(failed.attention.code).toBe('execution_target_mismatch'); expect(failed.stop).toBe('stopped'); expect(h.calls.send).toBe(1);
        }
    }
});

test('cancel queued round without touching active execution, and cancel an unknown input only after confirmed archive', async () => {
    const h = await taskFixture(cleanups), first = await h.post('spawn', h.payload());
    await until(() => h.post('read', { id: first.agent_id }), value => value.inputs[0]?.observation?.phase === 'accepted');
    const second = await h.post('send', send(first.agent_id));
    await h.post('interrupt', { id: first.agent_id, roundId: second.round_id });
    expect((await h.post('read', { id: first.agent_id, roundId: second.round_id })).status).toBe('interrupted');
    const listed = (await h.post('list')).agents.find((agent: any) => agent.agent_id === first.agent_id);
    expect(listed.status).toBe('running'); expect(listed.active_round_id).toBe(first.round_id);
    expect(h.calls.interrupt).toBe(0); expect(h.calls.stop).toBe(0); expect(h.calls.resume).toBe(0);
    h.faults.send = 'unseen'; const unknown = await h.post('spawn', h.payload());
    await until(() => h.post('read', { id: unknown.agent_id }), value => value.status === 'unknown');
    h.faults.stop = true;
    await h.post('interrupt', { id: unknown.agent_id, roundId: unknown.round_id });
    const pending = await until(() => h.post('read', { id: unknown.agent_id }), value => value.attention?.code === 'task_stop_unknown');
    expect(pending.cancellation.confirmed).not.toBe(true);
    h.faults.stop = false;
    const cancelled = await until(() => h.post('read', { id: unknown.agent_id }), value => value.status === 'interrupted');
    expect(cancelled.native_status[0].phase).toBe('unknown'); expect(cancelled.inputs[0].observation).toBeUndefined();
    expect(cancelled.report.incomplete).toBe(true); expect(cancelled.stop).toBe('stopped'); expect(h.calls.send).toBe(2);
});

test('Codex steer preserves same business round and reports actual queue/steer uncertainty without retries', async () => {
    for (const steering of ['steered', 'queued', 'unknown']) {
        const h = await taskFixture(cleanups), first = await h.post('spawn', h.payload());
        await until(() => h.post('read', { id: first.agent_id }), value => value.inputs[0]?.observation?.phase === 'accepted');
        h.faults.queueNext = true; h.faults.steer = steering;
        const request = send(first.agent_id, 'Additional instruction', 'steer', first.round_id);
        const accepted = await h.post('send', request);
        expect(accepted.round_id).toBe(first.round_id);
        const current = await until(() => h.post('read', { id: first.agent_id }), value => value.inputs.find((input: any) => input.id === accepted.input_id)?.steer.status === steering);
        expect(current.rounds).toHaveLength(1);
        expect(current.inputs.find((input: any) => input.id === accepted.input_id).steer.attempted).toBe(true);
        expect(await h.post('send', request)).toMatchObject(accepted);
        await Bun.sleep(60); expect(h.calls.steer).toBe(1); expect(h.calls.send).toBe(2);
        expect((await h.post('list')).agents[0].accepted_requests.some((item: any) => item.request_id === accepted.request_id)).toBe(true);
        if (steering === 'steered') {
            h.complete(current.session_id);
            const done = await until(() => h.post('read', { id: first.agent_id }), value => value.status === 'completed');
            expect(done.inputs.every((input: any) => input.observation.phase === 'completed')).toBe(true);
        }
    }
});

test('Claude rejects steer; permissions and targeted interruption affect only the active round', async () => {
    const h = await taskFixture(cleanups, 'claude'), first = await h.post('spawn', h.payload());
    const active = await until(() => h.post('read', { id: first.agent_id }), value => value.inputs[0]?.observation?.phase === 'accepted');
    await expect(h.post('send', send(first.agent_id, 'No steer', 'steer', first.round_id))).rejects.toMatchObject({ code: 'steer_unsupported' });
    const native = h.sessions.get(active.session_id)!;
    native.session.agentState!.requests = { approval: { tool: 'Bash', arguments: { command: 'test' }, createdAt: Date.now() } };
    await until(() => h.post('read', { id: first.agent_id }), value => value.attention?.permissionIds?.includes('approval'));
    await expect(h.post('permission', { id: first.agent_id, roundId: crypto.randomUUID(), requestId: 'approval', decision: 'approved' })).rejects.toMatchObject({ code: 'round_not_running' });
    await expect(h.post('permission', { id: first.agent_id, roundId: first.round_id, requestId: 'missing', decision: 'approved' })).rejects.toMatchObject({ code: 'permission_not_pending' });
    await h.post('permission', { id: first.agent_id, roundId: first.round_id, requestId: 'approval', decision: 'denied' });
    expect(h.calls.permission).toBe(1);
    await h.post('interrupt', { id: first.agent_id, roundId: first.round_id });
    const cancelled = await until(() => h.post('read', { id: first.agent_id }), value => value.status === 'interrupted');
    expect(cancelled.inputs[0].observation).toMatchObject({ phase: 'interrupted', source: 'control' }); expect(h.calls.interrupt).toBe(1);
    expect(cancelled.stop).toBe('stopped');
});

test('report format is optional and malformed output never becomes a false execution failure', () => {
    expect(parseReport('normal text')).toBeUndefined(); expect(parseReport('```runweft-report\n{broken}\n```')).toBeUndefined();
    expect(parseReport('```runweft-report\n{"summary":"ok","changes":[],"tests":["one"],"remaining":"none"}\n```')).toEqual({ summary: 'ok', changes: '', tests: 'one', remaining: 'none' });
});

test('Claude report pagination does not return a second unbounded copy through native facts', async () => {
    const h = await taskFixture(cleanups, 'claude'), first = await h.post('spawn', h.payload());
    const active = await until(() => h.post('read', { id: first.agent_id }), value => value.inputs[0]?.observation?.phase === 'accepted');
    h.complete(active.session_id, 'report-'.repeat(10000));
    const done = await until(() => h.post('read', { id: first.agent_id, limit: 100 }), value => value.status === 'completed');
    expect(done.report.text).toHaveLength(100); expect(done.report.total).toBe(70000);
    expect(done.inputs[0].observation.nativeResult).toBeUndefined();
    expect(JSON.stringify(done).length).toBeLessThan(10000);
});

test('cancellation preserves confirmed terminal facts when later transport is unknown and post-stop reads fail', async () => {
    const h = await taskFixture(cleanups), first = await h.post('spawn', h.payload());
    const active = await until(() => h.post('read', { id: first.agent_id }), value => value.inputs[0]?.observation?.phase === 'accepted');
    h.faults.queueNext = true; h.faults.steer = 'queued';
    await h.post('send', send(first.agent_id, 'Queued instruction', 'steer', first.round_id));
    await until(() => h.post('read', { id: first.agent_id }), value => value.inputs[1]?.steer.status === 'queued');
    h.complete(active.session_id, 'Known result');
    const observed = await until(() => h.post('read', { id: first.agent_id }), value => value.inputs[0].observation?.phase === 'completed');
    const native = h.sessions.get(active.session_id)!, seq = native.messages.length + 1;
    native.messages.push({ id: `unknown-${seq}`, seq, localId: null, createdAt: 1000 + seq, invokedAt: seq, scheduledAt: null,
        content: { role: 'agent', content: { type: 'event', data: { ...observed.inputs[0].observation, phase: 'unknown', source: 'transport' } } } });
    h.faults.historyAfterStop = true;
    await h.post('interrupt', { id: first.agent_id, roundId: first.round_id });
    const cancelled = await until(() => h.post('read', { id: first.agent_id }), value => value.status === 'interrupted');
    expect(cancelled.inputs[0].observation.phase).toBe('completed'); expect(cancelled.report.text).toBe('Known result');
    expect(cancelled.cancellation.confirmed).toBe(true); expect(cancelled.cancellation.error).toBeDefined();
    expect(h.calls.interrupt).toBe(0); expect(cancelled.stop).toBe('stopped');
});
