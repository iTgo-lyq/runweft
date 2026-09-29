import { expect } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DecryptedMessage, Session } from '../hapi/shared/src/types';
import type { SpawnReceipt } from '../hapi/shared/src/apiTypes';
import { resourceFixture, resourceWrite } from './resources-fixture';
import type { AgentSnapshot, Parent, SpawnIntent } from '../src/tasks/types';
import type { Flavor } from '../src/resources/types';

type Native = { session: Session; messages: DecryptedMessage[]; inputs: string[]; namespace: string; queued: Set<string>; done: Set<string>; indeterminate: Set<string> };
export async function taskFixture(cleanups: (() => Promise<void> | void)[], flavor: Flavor = 'codex', workspaceApi?: (request: Request, namespace: string) => Promise<Response>) {
    const sessions = new Map<string, Native>(), receipts = new Map<string, SpawnReceipt>();
    const calls = { spawn: 0, send: 0, stop: 0, resume: 0, steer: 0, interrupt: 0, permission: 0 };
    const faults = { spawn: 'none', send: 'none', stop: false, mismatch: false, resume: 'same', queueNext: false, steer: 'steered', interrupt: 'requested', historyAfterStop: false };
    let onInput: (() => void) | undefined;
    function message(native: Native, content: unknown, localId: string | null = null) {
        const seq = native.messages.length + 1;
        native.messages.push({ id: `message-${seq}`, seq, content, localId, createdAt: 1000 + seq, invokedAt: seq, scheduledAt: null } as DecryptedMessage);
    }
    function observation(native: Native, localId: string, phase: string, result?: string, source = 'native') {
        message(native, { role: 'agent', content: { type: 'event', data: { type: 'execution', version: 1, runtime: native.session.metadata!.flavor, executionId: `execution-${localId}`,
            inputLocalIds: [localId], phase, source, nativeSessionId: native.session.metadata!.codexSessionId ?? native.session.metadata!.claudeSessionId,
            nativeTurnId: `turn-${localId}`, ...(result ? { nativeResult: { result } } : {}) } } });
    }
    const h = await resourceFixture(cleanups, { capabilities: { spawnReceipts: 1, mcpToolFilter: 1 }, async fetch(request, namespace) {
        const url = new URL(request.url), parts = url.pathname.split('/');
        if (parts[2] === 'machines' && parts[4] === 'workspaces' && workspaceApi) return workspaceApi(request, namespace);
        if (parts[2] === 'machines' && parts[4] === 'spawn' && request.method === 'POST') {
            calls.spawn++;
            const body = await request.json() as { requestId: string; directory: string; agent: string; disabledMcpServers: string[]; permissionMode?: string; yolo?: boolean; preparedWorkspace?: { environmentId: string; preparationId: string } };
            expect(body.disabledMcpServers).toEqual(['runweft']); expect(body.permissionMode).toBeUndefined(); expect(body.yolo).toBeUndefined();
            if (faults.spawn === 'unseen') return new Response('', { status: 502 });
            const id = crypto.randomUUID();
            if (faults.spawn === 'rejected') {
                const receipt: SpawnReceipt = { requestId: body.requestId, machineId: parts[3], sessionId: id, createdAt: Date.now(),
                    response: { type: 'error', code: 'workspace_not_prepared', message: 'Prepared execution rejected before launch', childStarted: false } };
                receipts.set(body.requestId, receipt); return Response.json(receipt);
            }
            const session = { id, active: true, metadata: { machineId: parts[3], path: faults.mismatch ? '/wrong/path' : body.directory, flavor: body.agent,
                ...(body.agent === 'codex' ? { codexSessionId: `native-${id}` } : { claudeSessionId: `native-${id}` }), capabilities: { execution: 1 }, preparedWorkspace: body.preparedWorkspace, lifecycleState: 'running' }, agentState: { requests: {} } } as Session;
            sessions.set(id, { session, namespace, messages: [], inputs: [], queued: new Set(), done: new Set(), indeterminate: new Set() });
            const receipt: SpawnReceipt = { requestId: body.requestId, machineId: parts[3], sessionId: id, createdAt: Date.now(), response: { type: 'success', sessionId: id } };
            receipts.set(body.requestId, receipt);
            return faults.spawn === 'lost' ? new Response('', { status: 502 }) : Response.json(receipt);
        }
        if (parts[2] === 'machines' && parts[4] === 'spawn-requests') {
            const receipt = receipts.get(parts[5]);
            return receipt ? Response.json(receipt) : Response.json({ code: 'spawn_request_not_found' }, { status: 404 });
        }
        if (parts[2] !== 'sessions') return;
        const native = sessions.get(parts[3]);
        if (!native || native.namespace !== namespace) return Response.json({ error: 'not found' }, { status: 404 });
        if (parts.length === 4) return Response.json({ session: native.session });
        if (parts[4] === 'resume') {
            calls.resume++;
            const body = await request.json() as { preparedWorkspace?: { environmentId: string; preparationId: string } };
            if (body.preparedWorkspace) native.session.metadata!.preparedWorkspace = body.preparedWorkspace;
            if (faults.resume === 'missing') return Response.json({ code: 'native_session_missing', error: 'No native history' }, { status: 409 });
            if (faults.resume === 'offline') return Response.json({ code: 'no_machine_online' }, { status: 503 });
            if (faults.resume === 'unseen') return new Response('', { status: 502 });
            const candidate = faults.resume === 'new' ? structuredClone(native) : native;
            if (faults.resume === 'new') candidate.session.id = crypto.randomUUID();
            candidate.session.active = true; candidate.session.metadata!.lifecycleState = 'running';
            if (faults.resume === 'mismatch') candidate.session.metadata!.machineId = 'remote';
            sessions.set(candidate.session.id, candidate);
            return faults.resume === 'lost' ? new Response('', { status: 502 }) : Response.json({ type: 'success', sessionId: candidate.session.id });
        }
        if (parts[4] === 'execution' && parts[5] === 'interrupt') {
            calls.interrupt++;
            const input = await request.json() as { inputLocalId: string; executionId: string };
            if (faults.interrupt === 'requested') { observation(native, input.inputLocalId, 'interrupted', undefined, 'control'); native.done.add(input.inputLocalId); }
            return Response.json({ status: faults.interrupt, executionId: input.executionId, inputLocalIds: [input.inputLocalId] });
        }
        if (parts[4] === 'permissions') {
            calls.permission++;
            const body = await request.json() as { decision: string; mode?: string; permissionMode?: string };
            expect(body.mode).toBeUndefined(); expect(body.permissionMode).toBeUndefined();
            delete native.session.agentState!.requests![parts[5]];
            return Response.json({ success: true });
        }
        if (parts[4] === 'archive') {
            calls.stop++;
            if (faults.stop) return new Response('', { status: 502 });
            native.session.active = false; native.session.metadata!.lifecycleState = 'archived';
            return Response.json({ success: true });
        }
        if (parts[5] === 'queued-state') return Response.json({ queuedLocalIds: [...native.queued], indeterminateLocalIds: [...native.indeterminate],
            invokedLocalMessages: native.inputs.filter(id => !native.queued.has(id) && !native.indeterminate.has(id)).map(localId => ({ localId, invokedAt: 1 })) });
        if (parts[6] === 'steer') {
            calls.steer++;
            const localId = native.messages.find(message => message.id === parts[5])!.localId!;
            if (faults.steer === 'steered') { native.queued.delete(localId); observation(native, localId, 'accepted'); return Response.json({ status: 'steered', localId }); }
            if (faults.steer === 'unknown') { native.queued.delete(localId); native.indeterminate.add(localId); return new Response('', { status: 502 }); }
            return Response.json({ status: 'failed', localId, error: 'No active turn' });
        }
        if (parts[4] === 'messages' && request.method === 'DELETE') {
            const localId = native.messages.find(message => message.id === parts[5])!.localId!;
            native.queued.delete(localId); native.done.add(localId); return Response.json({ status: 'cancelled', localId });
        }
        if (parts[4] === 'messages' && request.method === 'POST') {
            calls.send++; onInput?.();
            const input = await request.json() as { localId: string; text: string };
            if (faults.send !== 'unseen') {
                native.inputs.push(input.localId); message(native, { role: 'user', content: { type: 'text', text: input.text } }, input.localId);
                if (faults.queueNext) { native.queued.add(input.localId); faults.queueNext = false; }
                else observation(native, input.localId, 'accepted');
            }
            return faults.send === 'none' ? Response.json({ success: true }) : new Response('', { status: 502 });
        }
        if (parts[4] === 'messages' && request.method === 'GET') {
            if (faults.historyAfterStop && !native.session.active) return new Response('', { status: 502 });
            const head = native.messages.at(-1), after = Number(url.searchParams.get('afterSeq') ?? 0), afterAt = Number(url.searchParams.get('afterAt') ?? 0);
            const limit = Number(url.searchParams.get('limit'));
            const messages = url.searchParams.has('afterSeq') ? native.messages.filter(m => m.createdAt > afterAt || (m.createdAt === afterAt && m.seq! > after)) : native.messages.slice(-limit);
            return Response.json({ messages, page: { hasMore: false, epoch: 0, reset: false, direction: url.searchParams.has('afterSeq') ? 'after' : 'latest', limit,
                snapshotHeadAt: head?.createdAt ?? null, snapshotHeadSeq: head?.seq ?? null, nextAfterAt: head?.createdAt ?? null, nextAfterSeq: head?.seq ?? null,
                nextBeforeAt: messages[0]?.createdAt ?? null, nextBeforeSeq: messages[0]?.seq ?? null } });
        }
        return new Response('', { status: 500 });
    } });
    const runtime = await h.register('own', flavor);
    const cwd = join(h.home, 'project'); mkdirSync(cwd);
    const parent: Parent = { kind: 'cli', machineId: 'own', cwd };
    const agent: AgentSnapshot = { id: 'review', definition: { schemaVersion: 1, name: 'Review', description: '', instructions: '', runtime: null, flavor: null, model: null, reasoningEffort: null },
        source: { scope: 'global', path: '/definition.yaml', key: 'global/review', linkTarget: null }, definitionVersion: 'initial', resolvedVersion: 'initial',
        runtimeId: runtime.id, machineId: 'own', flavor, namespace: 'alpha' };
    const intent: SpawnIntent = { agentType: 'review', message: 'Review the task', workspaceMode: 'shared' };
    const payload = () => ({ parent, requestId: crypto.randomUUID(), intent, agent });
    const post = (action: string, value: object = {}) => h.alpha.request(`/api/runweft/tasks/${action}`, resourceWrite({ parent, ...value }));
    h.tasks!.start();
    return { ...h, runtime, cwd, parent, agent, intent, payload, post, sessions, receipts, calls, faults,
        onInput(callback: () => void) { onInput = callback; },
        complete(id: string, text = 'Native final report', phase = 'completed') {
            const native = sessions.get(id)!;
            for (const localId of native.inputs) {
                if (native.done.has(localId) || native.queued.has(localId) || native.indeterminate.has(localId)) continue;
                message(native, { role: 'agent', content: { type: 'codex', data: { type: 'message', message: text } } }, `codex:${native.session.metadata!.codexSessionId}:turn-${localId}:result:agent_message`);
                observation(native, localId, phase, text); native.done.add(localId);
            }
        },
    };
}

export async function until<T>(read: () => Promise<T> | T, check: (value: T) => boolean, timeoutMs = 5000): Promise<T> {
    const until = Date.now() + timeoutMs;
    do { const value = await read(); if (check(value)) return value; await Bun.sleep(20); } while (Date.now() < until);
    throw new Error('Test condition timed out');
}
