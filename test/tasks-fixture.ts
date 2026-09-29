import { expect } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DecryptedMessage, Session } from '../hapi/shared/src/types';
import type { SpawnReceipt } from '../hapi/shared/src/apiTypes';
import { resourceFixture, resourceWrite } from './resources-fixture';
import type { AgentSnapshot, Parent, SpawnIntent } from '../src/tasks/types';

type Native = { session: Session; messages: DecryptedMessage[]; inputs: string[]; namespace: string };
export async function taskFixture(cleanups: (() => Promise<void> | void)[]) {
    const sessions = new Map<string, Native>(), receipts = new Map<string, SpawnReceipt>();
    const calls = { spawn: 0, send: 0, stop: 0 };
    const faults = { spawn: 'none', send: 'none', stop: false, mismatch: false };
    let onInput: (() => void) | undefined;
    function message(native: Native, content: unknown, localId: string | null = null) {
        const seq = native.messages.length + 1;
        native.messages.push({ id: `message-${seq}`, seq, content, localId, createdAt: 1000 + seq, invokedAt: seq, scheduledAt: null } as DecryptedMessage);
    }
    function observation(native: Native, localId: string, phase: string) {
        message(native, { role: 'agent', content: { type: 'event', data: { type: 'execution', version: 1, runtime: 'codex', executionId: `execution-${localId}`,
            inputLocalIds: [localId], phase, source: 'native', nativeSessionId: `native-${native.session.id}`, nativeTurnId: `turn-${localId}` } } });
    }
    const h = await resourceFixture(cleanups, { capabilities: { spawnReceipts: 1, mcpToolFilter: 1 }, async fetch(request, namespace) {
        const url = new URL(request.url), parts = url.pathname.split('/');
        if (parts[2] === 'machines' && parts[4] === 'spawn' && request.method === 'POST') {
            calls.spawn++;
            const body = await request.json() as { requestId: string; directory: string; agent: string; disabledMcpServers: string[]; permissionMode?: string; yolo?: boolean };
            expect(body.disabledMcpServers).toEqual(['runweft']); expect(body.permissionMode).toBeUndefined(); expect(body.yolo).toBeUndefined();
            if (faults.spawn === 'unseen') return new Response('', { status: 502 });
            const id = crypto.randomUUID();
            const session = { id, active: true, metadata: { machineId: parts[3], path: faults.mismatch ? '/wrong/path' : body.directory, flavor: body.agent,
                codexSessionId: `native-${id}`, capabilities: { execution: 1 }, lifecycleState: 'running' }, agentState: { requests: {} } } as Session;
            sessions.set(id, { session, namespace, messages: [], inputs: [] });
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
        if (parts[4] === 'archive') {
            calls.stop++;
            if (faults.stop) return new Response('', { status: 502 });
            native.session.active = false; native.session.metadata!.lifecycleState = 'archived';
            return Response.json({ success: true });
        }
        if (parts[5] === 'queued-state') return Response.json({ queuedLocalIds: [], invokedLocalMessages: native.inputs.map(localId => ({ localId, invokedAt: 1 })) });
        if (parts[4] === 'messages' && request.method === 'POST') {
            calls.send++; onInput?.();
            const input = await request.json() as { localId: string; text: string };
            if (faults.send !== 'unseen') {
                native.inputs.push(input.localId); message(native, { role: 'user', content: { type: 'text', text: input.text } }, input.localId);
                observation(native, input.localId, 'accepted');
            }
            return faults.send === 'none' ? Response.json({ success: true }) : new Response('', { status: 502 });
        }
        if (parts[4] === 'messages' && request.method === 'GET') {
            const head = native.messages.at(-1), after = Number(url.searchParams.get('afterSeq') ?? 0), afterAt = Number(url.searchParams.get('afterAt') ?? 0);
            const limit = Number(url.searchParams.get('limit'));
            const messages = url.searchParams.has('afterSeq') ? native.messages.filter(m => m.createdAt > afterAt || (m.createdAt === afterAt && m.seq! > after)) : native.messages.slice(-limit);
            return Response.json({ messages, page: { hasMore: false, epoch: 0, reset: false, direction: url.searchParams.has('afterSeq') ? 'after' : 'latest', limit,
                snapshotHeadAt: head?.createdAt ?? null, snapshotHeadSeq: head?.seq ?? null, nextAfterAt: head?.createdAt ?? null, nextAfterSeq: head?.seq ?? null,
                nextBeforeAt: messages[0]?.createdAt ?? null, nextBeforeSeq: messages[0]?.seq ?? null } });
        }
        return new Response('', { status: 500 });
    } });
    const runtime = await h.register();
    const cwd = join(h.home, 'project'); mkdirSync(cwd);
    const parent: Parent = { kind: 'cli', machineId: 'own', cwd };
    const agent: AgentSnapshot = { id: 'review', definition: { schemaVersion: 1, name: 'Review', description: '', instructions: '', runtime: null, flavor: null, model: null, reasoningEffort: null },
        source: { scope: 'global', path: '/definition.yaml', key: 'global/review', linkTarget: null }, definitionVersion: 'initial', resolvedVersion: 'initial',
        runtimeId: runtime.id, machineId: 'own', flavor: 'codex', namespace: 'alpha' };
    const intent: SpawnIntent = { agentType: 'review', message: 'Review the task', workspaceMode: 'shared' };
    const payload = () => ({ parent, requestId: crypto.randomUUID(), intent, agent });
    const post = (action: string, value: object = {}) => h.alpha.request(`/api/runweft/tasks/${action}`, resourceWrite({ parent, ...value }));
    h.tasks!.start();
    return { ...h, runtime, cwd, parent, agent, intent, payload, post, sessions, receipts, calls, faults,
        onInput(callback: () => void) { onInput = callback; },
        complete(id: string, text = 'Native final report', phase = 'completed') {
            const native = sessions.get(id)!;
            for (const localId of native.inputs) {
                message(native, { role: 'agent', content: { type: 'codex', data: { type: 'message', message: text } } }, `codex:native-${id}:turn-${localId}:result:agent_message`);
                observation(native, localId, phase);
            }
        },
    };
}

export async function until<T>(read: () => Promise<T> | T, check: (value: T) => boolean, timeoutMs = 5000): Promise<T> {
    const until = Date.now() + timeoutMs;
    do { const value = await read(); if (check(value)) return value; await Bun.sleep(20); } while (Date.now() < until);
    throw new Error('Test condition timed out');
}
