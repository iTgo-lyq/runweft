import { z } from 'zod';
import { SpawnSessionRequestSchema } from '../../../hapi/shared/src/apiTypes';
import { ArtifactTransferRequestSchema, type ArtifactTransfer } from '../../../hapi/shared/src/artifactTransfers';
import { WorkspaceRequestSchema } from '../../../hapi/shared/src/workspaces';
import { RepositoryRequestSchema } from '../../../hapi/shared/src/repositories';
import { HapiRequestError, type HapiHttp } from '../../hapi';
import { HubError, hubNotFound } from '../types';
import { NativeTransport, fileNamespace, fingerprint, inputError, unavailable } from '../access/transport';
import { FileAccessStore, type Reservation } from '../access/file-store';
import type { ExecutionObject } from '../access/types';
import { HubResourceStore } from '../resources/store';

export type DelegationScope = {
    ownerId: string; spaceId: string; sourceMachineId: string;
    target?: { runtimeId: string; machineId: string; flavor: 'codex' | 'claude' };
    taskId?: string; roundId?: string;
    /** Current Agent/repository/accepted-operation policy, supplied by the trusted coordinator. */
    check: (operation: 'work' | 'observe' | 'stop') => void;
};
const post = (body: unknown, signal?: AbortSignal) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
const conflict = () => new HubError(409, 'delegation_native_mismatch', '原生对象与任务固定归属或目标不一致。', '保留原任务与回执，不要重复启动。');
function body(options: RequestInit): Record<string, any> {
    if (options.body === undefined || options.body === null) return {};
    try {
        const value = typeof options.body === 'string' ? JSON.parse(options.body) : null;
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw inputError();
        return value;
    } catch { throw inputError(); }
}

/** Private coordinator adapter. Its machine operations are deliberately absent from the public gateway. */
export class DelegationNativeClient implements HapiHttp {
    readonly scope: Readonly<DelegationScope>;
    readonly files: FileAccessStore;
    private readonly access;
    constructor(readonly resources: HubResourceStore, readonly native: NativeTransport, scope: DelegationScope) {
        this.scope = Object.freeze({ ...scope, target: scope.target && Object.freeze({ ...scope.target }) });
        this.access = resources.access; this.files = new FileAccessStore(this.access);
    }
    private actor() { return this.access.serviceUser(this.scope.ownerId, this.scope.spaceId); }
    private check(operation: 'work' | 'observe' | 'stop' = 'work') { this.scope.check(operation); }
    private task(): ExecutionObject {
        const item = this.scope.taskId ? this.access.object('task', this.scope.taskId) : null;
        if (!item || item.ownerId !== this.scope.ownerId || item.spaceId !== this.scope.spaceId
            || !this.scope.target || item.machineId !== this.scope.target.machineId) throw hubNotFound();
        return item;
    }
    private target(machineId: string) {
        const fixed = this.scope.target; if (!fixed || fixed.machineId !== machineId) throw hubNotFound();
        this.resources.requireUsable(this.scope.ownerId, this.scope.spaceId, fixed.runtimeId);
        const current = this.resources.runtime(this.actor(), fixed.runtimeId);
        if (current.machineId !== machineId || current.flavor !== fixed.flavor) throw conflict();
        return current;
    }
    private machine(machineId: string) {
        this.check(); this.actor();
        if (machineId === this.scope.target?.machineId) this.target(machineId);
        if (machineId === this.scope.sourceMachineId) {
            if (!this.resources.ownMachine(this.actor(), machineId).registered) throw hubNotFound();
        } else this.target(machineId);
    }
    private session(id: string, cleanup = false) {
        const task = this.task(), session = this.access.object('session', id);
        if (!session || session.ownerId !== task.ownerId || session.spaceId !== task.spaceId
            || session.taskId !== task.id || session.machineId !== task.machineId || session.retiredAt !== null) throw hubNotFound();
        if (!cleanup) { this.actor(); this.target(session.machineId!); }
        return session;
    }
    private artifact(id: string) {
        const item = this.access.require(this.actor(), 'artifact', id);
        if (item.ownerId !== this.scope.ownerId || item.spaceId !== this.scope.spaceId) throw hubNotFound();
        return item;
    }
    private mapped(artifact: any) {
        this.artifact(artifact.id);
        const reservation = this.files.byArtifact(artifact.id);
        if (artifact.namespace !== fileNamespace(reservation.ownerId, reservation.spaceId) || artifact.requestId !== reservation.id) throw conflict();
        return { ...artifact, requestId: reservation.requestId };
    }
    private async reservation(row: Reservation, signal?: AbortSignal) {
        const result = await this.native.json(`/api/artifacts/requests/${row.id}`, { signal }, fileNamespace(row.ownerId, row.spaceId));
        this.check(); this.files.bind(this.actor(), row.id, result.artifact.id);
        return { artifact: this.mapped(result.artifact) };
    }
    private async fileRequest(parts: string[], options: RequestInit) {
        this.check(); const actor = this.actor(), method = options.method ?? 'GET', [, , id, section, reference] = parts;
        const ns = fileNamespace(this.scope.ownerId, this.scope.spaceId), signal = options.signal ?? undefined;
        if (parts.length === 2 && method === 'POST') {
            const { reservation, body: request } = this.files.reserve(actor, body(options));
            const result = await this.native.write('/api/artifacts', request, signal, 'POST', ns);
            this.check(); this.files.bind(this.actor(), reservation.id, result.artifact.id);
            return { artifact: this.mapped(result.artifact) };
        }
        if (parts.length === 4 && id === 'requests' && method === 'GET') {
            return this.reservation(this.files.ownedRequest(this.scope.ownerId, this.scope.spaceId, section), signal);
        }
        if (parts.length === 3 && id === 'limits' && method === 'GET') return this.native.json('/api/artifacts/limits', { signal }, ns);
        if (!id) throw unavailable();
        this.artifact(id); const path = `/api/artifacts/${encodeURIComponent(id)}`;
        let result: any;
        if (parts.length === 3 && method === 'GET') result = await this.native.json(path, { signal }, ns);
        else if (section === 'references' && parts.length === 4 && method === 'GET') result = await this.native.json(path + '/references', { signal }, ns);
        else if (section === 'references' && parts.length === 5 && ['PUT', 'DELETE'].includes(method)) {
            result = await this.native.json(`${path}/references/${encodeURIComponent(reference)}`, options, ns);
        } else throw unavailable();
        this.check(); this.artifact(id);
        return result.artifact ? { ...result, artifact: this.mapped(result.artifact) } : result;
    }
    private async transfer(machineId: string, input: unknown, options: RequestInit) {
        const parsed = ArtifactTransferRequestSchema.safeParse(input); if (!parsed.success) throw inputError();
        const request = parsed.data, credential = this.resources.executionCredential(machineId);
        if (request.action === 'materialize') {
            for (const file of request.files) {
                this.artifact(file.artifactId);
                this.access.grant(credential.id, file.artifactId, 'read', `input:${machineId}:${request.operationId}`);
            }
        }
        if (request.action === 'deliver') for (const file of request.files) {
            const row = this.files.permit({ ...file, filename: file.name, machineId, ownerId: this.scope.ownerId,
                spaceId: this.scope.spaceId, taskId: machineId === this.scope.target?.machineId ? this.scope.taskId : undefined });
            if (row.artifactId) {
                // Revalidated persisted delivery after rotation may grant only its current credential.
                this.access.grant(credential.id, row.artifactId, 'read', `output:${row.id}`);
                this.access.grant(credential.id, row.artifactId, 'write', `output:${row.id}`);
            }
        }
        const result = await this.native.json(`/api/machines/${encodeURIComponent(machineId)}/artifacts`, { ...options, ...post(request, options.signal ?? undefined) });
        this.machine(machineId);
        const operation = result.operation as ArtifactTransfer | undefined;
        if (!operation || operation.request.operationId !== request.operationId) throw conflict();
        if (operation.request.action === 'materialize' && ['succeeded', 'failed'].includes(operation.status)) {
            this.access.releaseFileLease(`input:${machineId}:${request.operationId}`);
        }
        return result;
    }
    /** Call after the immutable output manifest/recovery reference is durably published. */
    releaseOutputs(requestIds: string[]) {
        this.check(); this.actor();
        for (const id of requestIds) {
            const row = this.files.ownedRequest(this.scope.ownerId, this.scope.spaceId, id);
            this.access.releaseFileLease(`output:${row.id}`);
        }
    }
    private async receipt(machineId: string, requestId: string, signal?: AbortSignal) {
        this.check('observe'); this.task();
        const intent = this.access.intentByRequest(this.scope.ownerId, requestId);
        if (!intent) throw new HapiRequestError(404, 'spawn_request_not_found', '尚未记录此启动请求。');
        if (intent.machineId !== machineId || intent.taskId !== this.scope.taskId || intent.spaceId !== this.scope.spaceId) throw hubNotFound();
        const result = await this.native.json(`/api/machines/${encodeURIComponent(machineId)}/spawn-requests/${intent.id}`, { signal });
        if (result.machineId !== machineId || result.requestId !== intent.id || typeof result.sessionId !== 'string') throw conflict();
        const bound = this.access.object('session', result.sessionId);
        if (!bound) this.access.bindIntent(intent.id, result.sessionId, true);
        this.session(result.sessionId, true); this.check('observe');
        return { ...result, requestId };
    }
    private async spawn(machineId: string, input: unknown, options: RequestInit) {
        const parsed = SpawnSessionRequestSchema.safeParse(input); if (!parsed.success || !parsed.data.requestId) throw inputError();
        const request = parsed.data, requestId = parsed.data.requestId; this.task(); this.check(); this.target(machineId);
        if (request.agent !== this.scope.target!.flavor) throw conflict();
        request.disabledMcpServers = [...new Set([...(request.disabledMcpServers ?? []), 'runweft'])];
        const prior = this.access.intentByRequest(this.scope.ownerId, requestId);
        const intent = this.access.beginIntent({ requestKey: requestId, ownerId: this.scope.ownerId, spaceId: this.scope.spaceId,
            taskId: this.scope.taskId, machineId, operation: 'spawn', fingerprint: fingerprint({ ...request, requestId: undefined }), expiresAt: Date.now() + 300_000 });
        // Persist-before-send means even a restart in the small preflight gap cannot accidentally start twice.
        if (prior) return this.receipt(machineId, requestId, options.signal ?? undefined);
        this.check(); this.target(machineId);
        const result = await this.native.json(`/api/machines/${encodeURIComponent(machineId)}/spawn`, post({ ...request, requestId: intent.id }, options.signal ?? undefined));
        if (result.type === 'error') return result;
        if (result.machineId !== machineId || result.requestId !== intent.id || typeof result.sessionId !== 'string') throw conflict();
        this.access.bindIntent(intent.id, result.sessionId, true); this.session(result.sessionId, true);
        // Dispatch authority is checked again by the socket bridge before the actual RPC and its ack.
        this.check('observe'); return { ...result, requestId: request.requestId };
    }
    private async sessionRequest(parts: string[], options: RequestInit, query: string) {
        const id = parts[2], suffix = parts.slice(3).join('/'), method = options.method ?? 'GET';
        const observing = method === 'GET', stopping = method === 'POST' && suffix === 'archive';
        this.check(stopping ? 'stop' : observing ? 'observe' : 'work'); this.session(id, observing || stopping);
        const path = `/api/sessions/${encodeURIComponent(id)}${suffix ? '/' + parts.slice(3).map(encodeURIComponent).join('/') : ''}${query}`;
        if (suffix === 'resume' && method === 'POST') {
            if (!this.scope.roundId || !z.uuid().safeParse(this.scope.roundId).success) throw inputError();
            const request = body(options), key = `resume:${this.scope.roundId}`;
            const prior = this.access.intentByRequest(this.scope.ownerId, key);
            const intent = this.access.beginIntent({ requestKey: key, ownerId: this.scope.ownerId, spaceId: this.scope.spaceId,
                taskId: this.scope.taskId, machineId: this.scope.target!.machineId, sourceSessionId: id, operation: 'resume',
                fingerprint: fingerprint(request), expiresAt: Date.now() + 300_000 });
            if (prior) throw new HubError(503, 'task_resume_unknown', '此轮已尝试续接；只查询原 session，不重复 resume。');
            const result = await this.native.json(path, options);
            if (typeof result.sessionId === 'string') {
                const existing = this.access.object('session', result.sessionId);
                if (!existing) this.access.bindIntent(intent.id, result.sessionId, true);
                this.session(result.sessionId, true);
            }
            this.access.cancelIntent(intent.id); this.check('observe'); return result;
        }
        const allowed = observing && ['', 'messages', 'messages/queued-state'].includes(suffix)
            || method === 'POST' && ['archive', 'messages', 'messages/queued-state', 'execution/interrupt'].includes(suffix)
            || method === 'POST' && /^messages\/[^/]+\/steer$/.test(suffix)
            || method === 'DELETE' && /^messages\/[^/]+$/.test(suffix)
            || method === 'POST' && /^permissions\/[^/]+\/(approve|deny)$/.test(suffix);
        if (!allowed) throw unavailable();
        const result = await this.native.json(path, options);
        if (result.session?.id) {
            this.session(result.session.id, observing || stopping);
            if (result.session.metadata?.machineId !== this.scope.target!.machineId) throw conflict();
        }
        this.check(stopping ? 'stop' : observing ? 'observe' : 'work'); return result;
    }
    async request(path: string, options: RequestInit = {}): Promise<any> {
        if (path === '/health' && (options.method ?? 'GET') === 'GET') {
            this.check(); this.actor(); return this.native.json(path, options);
        }
        const url = new URL(path, 'http://native.invalid');
        if (!path.startsWith('/api/') || url.origin !== 'http://native.invalid') throw unavailable();
        const parts = url.pathname.split('/').slice(1).map(decodeURIComponent);
        if (parts.some(part => /[\\/\x00-\x1f\x7f]/.test(part) || part === '.' || part === '..')) throw inputError();
        const method = options.method ?? 'GET';
        if (parts[1] === 'artifacts') return this.fileRequest(parts, options);
        if (parts[1] === 'sessions' && parts[2]) return this.sessionRequest(parts, options, url.search);
        if (parts[1] !== 'machines') throw unavailable();
        if (parts.length === 2 && method === 'GET') {
            this.check(); this.actor();
            const result = await this.native.json('/api/machines?includeOffline=true', options); this.check();
            return { machines: result.machines.filter((m: any) => m.id === this.scope.sourceMachineId || m.id === this.scope.target?.machineId) };
        }
        const [, , machineId, section, requestId] = parts;
        if (section === 'spawn-requests' && parts.length === 5 && method === 'GET') return this.receipt(machineId, requestId, options.signal ?? undefined);
        this.machine(machineId);
        if (section === 'spawn' && parts.length === 4 && method === 'POST') return this.spawn(machineId, body(options), options);
        if (section === 'agent-availability' && parts.length === 4 && method === 'GET') {
            const result = await this.native.json(url.pathname + '?details=true', options); this.machine(machineId); return result;
        }
        if (parts.length !== 4 || method !== 'POST') throw unavailable();
        if (section === 'artifacts') return this.transfer(machineId, body(options), options);
        const schema = section === 'workspaces' ? WorkspaceRequestSchema : section === 'repositories' ? RepositoryRequestSchema : null;
        if (!schema) throw unavailable();
        const parsed = schema.safeParse(body(options)); if (!parsed.success) throw inputError();
        const result = await this.native.json(url.pathname, { ...options, ...post(parsed.data, options.signal ?? undefined) });
        this.machine(machineId); return result;
    }
    async response(path: string, options: RequestInit = {}): Promise<Response> {
        const content = /^\/api\/artifacts\/([^/]+)\/content$/.exec(path);
        if (content) {
            this.check(); const id = decodeURIComponent(content[1]); this.artifact(id);
            if (!['GET', 'PUT'].includes(options.method ?? 'GET')) throw unavailable();
            const response = await this.native.response(`/api/artifacts/${encodeURIComponent(id)}/content`, options,
                fileNamespace(this.scope.ownerId, this.scope.spaceId));
            this.check(); this.artifact(id); return response;
        }
        return Response.json(await this.request(path, options));
    }
}
