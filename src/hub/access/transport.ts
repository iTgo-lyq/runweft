import { createHash } from 'node:crypto';
import { once } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { HapiClient, fetchResponse } from '../../hapi';
import { HubError } from '../types';
import { HAPI_EXECUTION_NAMESPACE, type Principal } from './types';
import type { AccessStore } from './store';

export const unavailable = (message = '该原生入口尚未开放给当前 Hub 身份。') => new HubError(403, 'native_route_unavailable', message, '通过 Runweft 的资源或任务入口操作。');
export const inputError = () => new HubError(400, 'invalid_native_request', '请求参数或路径无效。');
export function record(value: unknown): Record<string, any> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw inputError();
    return value as Record<string, any>;
}
export function fingerprint(value: unknown): string {
    const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
        ? Object.fromEntries(Object.keys(v).sort().map(key => [key, canonical(v[key])])) : v;
    return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
export const fileNamespace = (ownerId: string, spaceId: string | null) => `rw_files_${fingerprint([ownerId, spaceId])}`;
export async function readJson(request: IncomingMessage, limit = 72 * 1024 * 1024, signal?: AbortSignal): Promise<Record<string, any>> {
    if ((!request.headers['content-length'] || request.headers['content-length'] === '0')
        && !request.headers['content-type'] && !request.headers['transfer-encoding']) return {};
    if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') throw inputError();
    const chunks: Buffer[] = []; let size = 0;
    let timer: ReturnType<typeof setTimeout>;
    const abort = () => request.destroy(new HubError(408, 'native_request_cancelled', '请求已撤销或读取超时。'));
    const tick = () => { clearTimeout(timer); timer = setTimeout(abort, 60_000); };
    signal?.addEventListener('abort', abort, { once: true }); tick();
    try {
        signal?.throwIfAborted();
        for await (const chunk of request) {
            tick(); signal?.throwIfAborted(); size += chunk.length;
            if (size > limit) { request.resume(); throw new HubError(413, 'native_request_too_large', '请求超过原生控制消息大小限制。'); }
            chunks.push(Buffer.from(chunk));
        }
        if (size === 0) return {};
        try { return record(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { throw inputError(); }
    } finally { clearTimeout(timer!); signal?.removeEventListener('abort', abort); }
}
export function pathParts(request: IncomingMessage) {
    const url = new URL(request.url ?? '/', 'http://runweft.invalid');
    let parts: string[];
    try { parts = url.pathname.split('/').slice(1).map(decodeURIComponent); } catch { throw inputError(); }
    if (parts.some(part => /[\\/\x00-\x1f\x7f]/.test(part) || part === '.' || part === '..')) throw inputError();
    return { url, parts };
}

/** Owns no native state: only the existing HAPI credential exchanges and HTTP transport. */
export class NativeTransport {
    private readonly clients = new Map<string, HapiClient>();
    constructor(readonly url: string, private readonly rootToken: string) {}
    cliToken() { return `${this.rootToken}:${HAPI_EXECUTION_NAMESPACE}`; }
    client(namespace = HAPI_EXECUTION_NAMESPACE) {
        let client = this.clients.get(namespace);
        if (!client) { client = new HapiClient(this.url, `${this.rootToken}:${namespace}`); this.clients.set(namespace, client); }
        return client;
    }
    response(path: string, options: RequestInit = {}, namespace = HAPI_EXECUTION_NAMESPACE) {
        if (path.startsWith('/cli/')) return fetchResponse(this.url + path, { ...options,
            headers: { ...Object.fromEntries(new Headers(options.headers)), authorization: `Bearer ${this.rootToken}:${namespace}`, 'accept-encoding': 'identity' } });
        return this.client(namespace).response(path, { ...options,
            headers: { ...Object.fromEntries(new Headers(options.headers)), 'accept-encoding': 'identity' } });
    }
    async json(path: string, options: RequestInit = {}, namespace = HAPI_EXECUTION_NAMESPACE): Promise<any> {
        const response = await this.response(path, options, namespace);
        return response.json();
    }
    write(path: string, body: unknown, signal?: AbortSignal, method = 'POST', namespace = HAPI_EXECUTION_NAMESPACE) {
        return this.json(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal }, namespace);
    }
}

export class RequestLease {
    private readonly abort = new AbortController();
    private readonly timer: ReturnType<typeof setInterval>;
    private checks: (() => void)[] = [];
    private readonly onClose = () => this.abort.abort();
    get signal() { return this.abort.signal; }
    constructor(readonly actor: Principal, readonly store: AccessStore, private readonly response: ServerResponse) {
        this.timer = setInterval(() => { try { this.check(); } catch (error) { this.abort.abort(error); } }, 1000);
        response.once('close', this.onClose);
    }
    add(check: () => void) { this.checks.push(check); check(); return () => { this.checks = this.checks.filter(item => item !== check); }; }
    check() { this.signal.throwIfAborted(); this.store.refresh(this.actor); for (const check of this.checks) check(); }
    close() { clearInterval(this.timer); this.response.off('close', this.onClose); this.abort.abort(); }
    upload(request: IncomingMessage): ReadableStream<Uint8Array> {
        const reader = (Readable.toWeb(request) as unknown as ReadableStream<Uint8Array>).getReader();
        const cancel = () => { void reader.cancel(this.signal.reason).catch(() => {}); };
        this.signal.addEventListener('abort', cancel, { once: true });
        return new ReadableStream({
            pull: async controller => {
                try {
                    this.check(); const next = await reader.read(); this.check();
                    if (next.done) { controller.close(); this.signal.removeEventListener('abort', cancel); reader.releaseLock(); }
                    else controller.enqueue(next.value);
                } catch (error) { controller.error(error); cancel(); this.signal.removeEventListener('abort', cancel); }
            },
            cancel: reason => { this.signal.removeEventListener('abort', cancel); return reader.cancel(reason); },
        });
    }
    async stream(upstream: Response) {
        this.check();
        const reader = upstream.body?.getReader();
        const cancel = () => { void reader?.cancel().catch(() => {}); this.response.destroy(); };
        this.signal.addEventListener('abort', cancel, { once: true });
        try {
            const headers: Record<string, string> = { 'cache-control': 'no-store' };
            for (const key of ['content-type', 'content-length', 'content-disposition', 'x-artifact-sha256', 'x-content-type-options']) {
                const value = upstream.headers.get(key); if (value) headers[key] = value;
            }
            this.response.writeHead(upstream.status, headers);
            if (reader) while (true) {
                const chunk = await reader.read(); this.check(); if (chunk.done) break;
                if (!this.response.write(chunk.value)) await once(this.response, 'drain', { signal: this.signal });
            }
            this.response.end();
        } finally { this.signal.removeEventListener('abort', cancel); await reader?.cancel().catch(() => {}); reader?.releaseLock(); }
    }
}
