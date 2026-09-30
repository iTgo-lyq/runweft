import type { IncomingMessage } from 'node:http';
import { ArtifactPruneSchema } from '../../../hapi/shared/src/artifacts';
import { hubNotFound } from '../types';
import { AccessStore } from './store';
import { FileAccessStore } from './file-store';
import { NativeTransport, RequestLease, fileNamespace, inputError, readJson, unavailable } from './transport';
import type { Principal } from './types';

/** Byte storage, quotas, expiry checks, and deletion remain entirely in HAPI. */
export class NativeFiles {
    readonly reservations: FileAccessStore;
    constructor(readonly store: AccessStore, readonly native: NativeTransport) { this.reservations = new FileAccessStore(store); }
    private mapped(actor: Principal, artifact: any) {
        this.store.require(actor, 'artifact', artifact.id);
        const reservation = this.reservations.byArtifact(artifact.id);
        if (artifact.namespace !== fileNamespace(reservation.ownerId, reservation.spaceId) || artifact.requestId !== reservation.id) throw hubNotFound();
        return { ...artifact, requestId: reservation.requestId };
    }
    async handle(parts: string[], url: URL, request: IncomingMessage, lease: RequestLease): Promise<unknown> {
        const { actor, signal } = lease, method = request.method ?? 'GET';
        const [, , id, section, reference] = parts;
        const prefix = parts[0] === 'cli' ? '/cli' : '/api';
        if (parts.length === 2 && method === 'POST') {
            const input = await readJson(request, 64 * 1024, signal);
            const { reservation, body } = this.reservations.reserve(actor, input);
            lease.add(() => { this.reservations.lookup(actor, reservation.requestId); });
            const result = await this.native.write(`${prefix}/artifacts`, body, signal, 'POST', fileNamespace(reservation.ownerId, reservation.spaceId));
            lease.check(); this.reservations.bind(actor, reservation.id, result.artifact.id);
            return { artifact: this.mapped(actor, result.artifact) };
        }
        if (parts.length === 4 && id === 'requests' && method === 'GET') {
            const reservation = this.reservations.lookup(actor, section);
            const result = await this.native.json(`${prefix}/artifacts/requests/${reservation.id}`, { signal }, fileNamespace(reservation.ownerId, reservation.spaceId));
            lease.check(); this.reservations.bind(actor, reservation.id, result.artifact.id);
            return { artifact: this.mapped(actor, result.artifact) };
        }
        if (parts.length === 2 || (parts.length === 3 && ['limits', 'prune'].includes(id))) {
            if (actor.kind !== 'user') {
                if (id !== 'limits' || method !== 'GET') throw unavailable('执行凭据不允许列出或清理用户文件库。');
                const { limits } = await this.native.json(`${prefix}/artifacts/limits`, { signal }, fileNamespace(actor.ownerId, actor.spaceId));
                // Runner needs policy limits; it is not entitled to another user's collection usage.
                return { limits, usageScope: 'policy-only' };
            }
            const namespace = fileNamespace(actor.ownerId, actor.spaceId);
            if (id === 'limits' && method === 'GET') return this.native.json(`${prefix}/artifacts/limits`, { signal }, namespace);
            if (parts.length === 2 && method === 'GET') {
                const query = new URLSearchParams();
                for (const name of ['offset', 'limit']) if (url.searchParams.has(name)) query.set(name, url.searchParams.get(name)!);
                const result = await this.native.json(`${prefix}/artifacts?${query}`, { signal }, namespace);
                const artifacts = [];
                for (const artifact of result.artifacts) {
                    // A lost reserve response can leave an owned native row without its final binding.
                    const reservation = this.reservations.byId(artifact.requestId);
                    this.reservations.bind(actor, reservation.id, artifact.id);
                    artifacts.push(this.mapped(actor, artifact));
                }
                return { ...result, artifacts };
            }
            if (id === 'prune' && method === 'POST') {
                const parsed = ArtifactPruneSchema.safeParse(await readJson(request, 64 * 1024, signal));
                if (!parsed.success) throw inputError();
                if (parsed.data.after) this.store.require(actor, 'artifact', parsed.data.after);
                const result = await this.native.write(`${prefix}/artifacts/prune`, parsed.data, signal, 'POST', namespace);
                return { ...result, candidates: result.candidates.map((a: any) => this.mapped(actor, a)), deleted: result.deleted.map((a: any) => this.mapped(actor, a)) };
            }
            throw unavailable();
        }
        if (!id) throw unavailable();
        const write = method !== 'GET';
        const object = this.store.require(actor, 'artifact', id, write ? 'write' : 'read');
        const namespace = fileNamespace(object.ownerId, object.spaceId);
        lease.add(() => { this.store.require(actor, 'artifact', id, write ? 'write' : 'read'); });
        const path = `${prefix}/artifacts/${encodeURIComponent(id)}`;
        if (parts.length === 4 && section === 'content') {
            if (method === 'GET') { await lease.stream(await this.native.response(path + '/content', { signal }, namespace)); return STREAMED; }
            if (method === 'PUT') {
                const headers = new Headers({ 'content-type': 'application/octet-stream' });
                if (request.headers['content-length']) headers.set('content-length', request.headers['content-length']);
                const result = await this.native.json(path + '/content', { method, headers, body: lease.upload(request), signal }, namespace);
                lease.check(); return { artifact: this.mapped(actor, result.artifact) };
            }
        }
        if (parts.length === 3 && method === 'GET') {
            const result = await this.native.json(path, { signal }, namespace); return { artifact: this.mapped(actor, result.artifact) };
        }
        if (actor.kind !== 'user') throw unavailable('执行凭据只能按授权读写附件字节，不能修改留存引用或删除对象。');
        if (parts.length === 3 && method === 'DELETE') {
            const result = await this.native.json(path, { method, signal }, namespace); return { artifact: this.mapped(actor, result.artifact) };
        }
        if (parts.length === 4 && section === 'references' && method === 'GET') return this.native.json(path + '/references', { signal }, namespace);
        if (parts.length === 5 && section === 'references' && ['PUT', 'DELETE'].includes(method)) {
            const target = `${path}/references/${encodeURIComponent(reference)}`;
            const result = method === 'PUT' ? await this.native.write(target, await readJson(request, 64 * 1024, signal), signal, method, namespace)
                : await this.native.json(target, { method, signal }, namespace);
            return result.artifact ? { ...result, artifact: this.mapped(actor, result.artifact) } : result;
        }
        throw unavailable();
    }
}
export const STREAMED = Symbol('streamed');
