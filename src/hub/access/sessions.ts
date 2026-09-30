import { randomUUID } from 'node:crypto';
import { CreateOrLoadSessionRequestSchema, SpawnSessionRequestSchema } from '../../../hapi/shared/src/apiTypes';
import { HapiRequestError } from '../../hapi';
import { HubError, hubNotFound } from '../types';
import { AccessStore } from './store';
import type { ExecutionIntent, ExecutionObject, Principal } from './types';
import { NativeTransport, RequestLease, fingerprint, inputError, record, unavailable } from './transport';

const dispatchWindow = 5 * 60_000;
export type ExecutionPolicy = (ownerId: string, spaceId: string | null, machineId: string, flavor: string) => void;
function tagId(machineId: string, tag: string) {
    const hex = fingerprint(['session-tag', machineId, tag]).slice(0, 32).split('');
    hex[12] = '5'; hex[16] = '8'; const value = hex.join('');
    return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
export class NativeSessions {
    constructor(readonly store: AccessStore, readonly native: NativeTransport, private readonly executionPolicy?: ExecutionPolicy) {}
    checkExecution(binding: ExecutionObject, flavor: string) {
        this.executionPolicy?.(binding.ownerId, binding.spaceId, binding.machineId!, flavor);
    }
    async guardMetadata(actor: Principal, id: string, metadata: Record<string, any>, signal?: AbortSignal) {
        const binding = this.store.require(actor, 'session', id, 'report');
        if (metadata.machineId !== binding.machineId) throw hubNotFound();
        if (metadata.flavor && !['codex', 'claude'].includes(metadata.flavor)) throw unavailable();
        if (['gemini', 'opencode', 'grok', 'cursor', 'pi', 'agy', 'copilot'].some(flavor => metadata[flavor + 'SessionId'])) throw unavailable();
        if (metadata.codexSessionId && metadata.claudeSessionId) throw inputError();
        for (const field of ['codexSessionId', 'claudeSessionId'] as const) {
            const value = metadata[field]; if (!value) continue;
            if (typeof value !== 'string' || value.length > 1024 || metadata.flavor !== field.replace('SessionId', '')) throw inputError();
            if (!this.store.nativeClaim(field, value)) {
                // Do not claim an existing unmigrated HAPI identity. First claims alone require this inventory read.
                const result = await this.native.json('/api/sessions', { signal });
                for (const existing of result.sessions) {
                    if (existing.id === id || existing.metadata?.agentSessionId !== value || existing.metadata?.flavor !== metadata.flavor) continue;
                    const prior = this.store.object('session', existing.id);
                    if (!prior || prior.ownerId !== binding.ownerId || prior.spaceId !== binding.spaceId || prior.machineId !== binding.machineId) throw hubNotFound();
                }
            }
            this.store.require(actor, 'session', id, 'report');
            this.store.claimNative(field, value, id);
        }
    }
    private async maybe(path: string, signal?: AbortSignal) {
        try { return await this.native.json(path, { signal }); }
        catch (error) { if (error instanceof HapiRequestError && [403, 404].includes(error.status)) return null; throw error; }
    }
    /** Invoked before a machine can adopt/connect; never trusts a client-supplied owner. */
    async allocated(machine: Principal, id: string, signal?: AbortSignal) {
        if (machine.kind !== 'machine') throw hubNotFound();
        const existing = this.store.object('session', id);
        if (existing) return this.store.require(machine, 'session', id, 'report');
        const pending = this.store.pending(machine.machineId!);
        for (const intent of pending.filter(i => i.operation === 'spawn')) {
            const receipt = await this.maybe(`/api/machines/${encodeURIComponent(machine.machineId!)}/spawn-requests/${intent.id}`, signal);
            this.store.refresh(machine);
            if (receipt?.sessionId === id && receipt.machineId === machine.machineId) return this.store.bindIntent(intent.id, id);
        }
        const result = await this.maybe(`/api/sessions/${encodeURIComponent(id)}`, signal);
        const session = result?.session;
        if (!session || session.id !== id || session.metadata?.machineId !== machine.machineId) throw hubNotFound();
        const matches = pending.filter(i => ['fork', 'clear'].includes(i.operation) && i.sourceSessionId === session.metadata?.forkedFrom);
        if (matches.length !== 1) throw hubNotFound();
        this.store.refresh(machine);
        return this.store.bindIntent(matches[0].id, id);
    }
    async bootstrap(actor: Principal, input: unknown, signal?: AbortSignal) {
        if (actor.kind !== 'machine') throw unavailable();
        const parsed = CreateOrLoadSessionRequestSchema.safeParse(input); if (!parsed.success) throw inputError();
        const body = parsed.data, metadata = record(body.metadata);
        if (metadata.machineId && metadata.machineId !== actor.machineId) throw hubNotFound();
        if (metadata.flavor && !['codex', 'claude'].includes(metadata.flavor)) throw unavailable('当前 Hub 只接入 Codex 和 Claude Code。');
        if (body.machine) this.store.require(actor, 'machine', body.machine.id, 'report');
        this.store.require(actor, 'machine', actor.machineId!, 'report');
        let id = body.id ?? tagId(actor.machineId!, body.tag), intent: ExecutionIntent | undefined;
        if (body.id && !this.store.object('session', id)) {
            const native = await this.maybe(`/api/sessions/${encodeURIComponent(id)}`, signal);
            if (native || body.adopt) await this.allocated(actor, id, signal);
            else if (id !== tagId(actor.machineId!, body.tag)) throw hubNotFound();
        }
        if (metadata.forkedFrom) {
            if (typeof metadata.forkedFrom !== 'string') throw inputError();
            const existing = this.store.object('session', id);
            if (existing) {
                const parent = this.store.object('session', metadata.forkedFrom);
                if (!parent || parent.ownerId !== existing.ownerId || parent.spaceId !== existing.spaceId || parent.machineId !== existing.machineId) throw hubNotFound();
            } else this.store.require(actor, 'session', metadata.forkedFrom, 'report');
            const pending = this.store.pending(actor.machineId!).filter(i => ['fork', 'clear'].includes(i.operation) && i.sourceSessionId === metadata.forkedFrom);
            // An already bound child can reconnect after the dispatch window.
            if (!(id && this.store.object('session', id))) {
                if (pending.length !== 1) throw hubNotFound();
                intent = pending[0];
            }
        }
        id ??= tagId(actor.machineId!, body.tag);
        if (!this.store.object('session', id)) {
            if (intent) this.store.bindIntent(intent.id, id);
            else this.store.bind({ kind: 'session', id, ownerId: actor.ownerId, machineId: actor.machineId });
        }
        this.store.require(actor, 'session', id, 'report');
        await this.guardMetadata(actor, id, { ...metadata, machineId: actor.machineId }, signal);
        const result = await this.native.write('/cli/sessions', { ...body, id,
            tag: `rw:${actor.machineId}:${body.tag}`, metadata: { ...metadata, machineId: actor.machineId } }, signal);
        this.store.require(actor, 'session', result.session.id, 'report');
        if (result.session.id !== id) throw hubNotFound();
        return result;
    }
    async checked(actor: Principal, id: string, operation: 'read' | 'write' | 'report', signal?: AbortSignal) {
        const binding = this.store.require(actor, 'session', id, operation);
        const result = await this.native.json(`/api/sessions/${encodeURIComponent(id)}`, { signal });
        // HAPI aliases may resolve to another native id. Check it before any mutation or disclosure.
        const canonical = this.store.require(actor, 'session', result.session.id, operation);
        if (canonical.machineId !== result.session.metadata?.machineId || binding.ownerId !== canonical.ownerId || binding.spaceId !== canonical.spaceId) throw hubNotFound();
        return { binding: canonical, session: result.session };
    }
    async list(actor: Principal, path: string, url: URL, signal?: AbortSignal) {
        const query = new URLSearchParams();
        if (url.searchParams.get('order') === 'updatedAt') query.set('order', 'updatedAt');
        if (path.startsWith('/cli/')) query.set('machineId', actor.machineId ?? '');
        const result = await this.native.json(`${path}?${query}`, { signal });
        this.store.refresh(actor);
        let sessions = result.sessions.filter((session: any) => this.store.can(actor, 'session', path.startsWith('/cli/') ? session.sessionId : session.id));
        if (url.searchParams.has('limit')) {
            const limit = Number(url.searchParams.get('limit'));
            if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw inputError();
            sessions = sessions.slice(0, limit);
        }
        return { sessions };
    }
    async spawn(actor: Principal, machineId: string, input: unknown, lease: RequestLease) {
        if (actor.kind !== 'user') throw unavailable();
        this.store.require(actor, 'machine', machineId, 'write');
        const parsed = SpawnSessionRequestSchema.safeParse(input); if (!parsed.success) throw inputError();
        const body = parsed.data;
        if (!['codex', 'claude'].includes(body.agent ?? 'claude')) throw unavailable();
        if (body.preparedFiles || body.preparedWorkspace) throw unavailable('工作区准备引用只能由 Runweft 委派协调器提交。');
        lease.add(() => { this.executionPolicy?.(actor.ownerId, actor.spaceId, machineId, body.agent ?? 'claude'); });
        const requestKey = body.requestId ?? randomUUID();
        const intent = this.store.beginIntent({ requestKey, ownerId: actor.ownerId, spaceId: actor.spaceId, machineId,
            operation: 'spawn', fingerprint: fingerprint({ ...body, requestId: undefined }), expiresAt: Date.now() + dispatchWindow });
        const receipt = await this.native.write(`/api/machines/${encodeURIComponent(machineId)}/spawn`, { ...body, requestId: intent.id }, lease.signal);
        lease.check();
        if (receipt.machineId !== machineId || receipt.requestId !== intent.id) throw hubNotFound();
        this.store.bindIntent(intent.id, receipt.sessionId);
        return { ...receipt, requestId: requestKey };
    }
    async receipt(actor: Principal, machineId: string, requestId: string, signal?: AbortSignal) {
        const intent = this.store.intentByRequest(actor.ownerId, requestId);
        if (!intent || intent.machineId !== machineId || intent.spaceId !== actor.spaceId) throw hubNotFound();
        const result = await this.native.json(`/api/machines/${encodeURIComponent(machineId)}/spawn-requests/${intent.id}`, { signal });
        this.store.refresh(actor);
        if (result.requestId !== intent.id || result.machineId !== machineId) throw hubNotFound();
        this.store.bindIntent(intent.id, result.sessionId, true);
        return { ...result, requestId };
    }
    async derive(actor: Principal, id: string, action: 'resume' | 'reopen' | 'fork' | 'clear', body: Record<string, any>, lease: RequestLease) {
        if (body.preparedFiles || body.preparedWorkspace) throw unavailable('准备引用通过 Runweft 委派入口校验。');
        const { binding, session } = await this.checked(actor, id, 'write', lease.signal);
        lease.add(() => this.checkExecution(binding, session.metadata?.flavor ?? 'claude'));
        const machines = await this.native.json('/api/machines', { signal: lease.signal });
        if (!machines.machines.some((m: any) => m.id === binding.machineId && m.active)) {
            throw new HubError(409, 'execution_machine_offline', '会话绑定的机器未在线，不能转移到同名机器。');
        }
        if (this.store.pending(binding.machineId!).some(i => i.sourceSessionId === binding.id)) {
            throw new HubError(409, 'session_derivation_pending', '该会话的派生尚未确认，请先查询原任务或会话。');
        }
        const intent = this.store.beginIntent({ requestKey: randomUUID(), ownerId: binding.ownerId, spaceId: binding.spaceId,
            machineId: binding.machineId, taskId: binding.taskId, sourceSessionId: binding.id,
            operation: action, fingerprint: fingerprint(body), expiresAt: Date.now() + dispatchWindow });
        const result = await this.native.write(`/api/sessions/${encodeURIComponent(id)}/${action}`, body, lease.signal);
        lease.check();
        if (typeof result.sessionId === 'string') {
            const existing = this.store.object('session', result.sessionId);
            if (!existing) this.store.bindIntent(intent.id, result.sessionId);
            this.store.require(actor, 'session', result.sessionId);
        }
        // A successful mutation may keep the same native wrapper, or bind one before HTTP returns.
        this.store.cancelIntent(intent.id);
        return result;
    }
}
