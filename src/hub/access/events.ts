import { createHmac, timingSafeEqual } from 'node:crypto';
import { once } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { SyncEventSchema } from '../../../hapi/shared/src/schemas';
import { hubNotFound } from '../types';
import type { AccessStore } from './store';
import type { Principal } from './types';
import { fingerprint, inputError, type NativeTransport, type RequestLease } from './transport';

/** Filters the existing HAPI stream; cursors remain native, sealed to this user/space and visible object set. */
export class NativeEvents {
    private readonly subscriptions = new Map<string, string>();
    constructor(private readonly store: AccessStore, private readonly native: NativeTransport, private readonly key: Uint8Array) {}
    private owner(actor: Principal) { return fingerprint([actor.kind, actor.digest, actor.spaceId]); }
    private revision(actor: Principal) { return fingerprint(['session', 'machine'].map(kind => this.store.list(actor, kind as 'session' | 'machine').map(object => object.id))); }
    private cursor(actor: Principal, nativeId: string, revision: string) {
        const payload = Buffer.from(JSON.stringify([nativeId, revision])).toString('base64url');
        return payload + '.' + createHmac('sha256', this.key).update('runweft-sse:' + this.owner(actor) + ':' + payload).digest('base64url');
    }
    private unseal(actor: Principal, cursor: string, revision: string) {
        try {
            if (cursor.length > 2048) return null;
            const [payload, signature, extra] = cursor.split('.');
            if (extra) return null;
            const [id, savedRevision] = JSON.parse(Buffer.from(payload, 'base64url').toString());
            if (typeof id !== 'string' || savedRevision !== revision) return null;
            const expected = this.cursor(actor, id, revision);
            return expected.length === cursor.length && timingSafeEqual(Buffer.from(expected), Buffer.from(cursor)) ? id : null;
        } catch { return null; }
    }
    async visibility(actor: Principal, body: any, signal: AbortSignal) {
        if (!body || !['visible', 'hidden'].includes(body.visibility) || typeof body.subscriptionId !== 'string') throw inputError();
        this.store.refresh(actor);
        if (this.subscriptions.get(body.subscriptionId) !== this.owner(actor)) throw hubNotFound();
        return this.native.write('/api/visibility', { subscriptionId: body.subscriptionId, visibility: body.visibility }, signal);
    }
    async stream(request: IncomingMessage, response: ServerResponse, url: URL, lease: RequestLease) {
        const actor = lease.actor;
        if (actor.kind !== 'user') throw hubNotFound();
        const query = new URLSearchParams();
        for (const [name, kind] of [['sessionId', 'session'], ['machineId', 'machine']] as const) {
            const id = url.searchParams.get(name); if (!id) continue;
            // Session aliases must not switch subscription ownership at the native boundary.
            lease.add(() => { this.store.require(actor, kind, id); });
            if (kind === 'session') {
                const result = await this.native.json(`/api/sessions/${encodeURIComponent(id)}`, { signal: lease.signal });
                lease.add(() => { this.store.require(actor, 'session', result.session.id); });
                query.set(name, result.session.id);
            } else query.set(name, id);
        }
        query.set('all', ['true', '1'].includes(url.searchParams.get('all') ?? '') ? 'true' : 'false');
        query.set('visibility', url.searchParams.get('visibility') === 'visible' ? 'visible' : 'hidden');
        let revision = this.revision(actor), subscriptionId: string | undefined;
        const cursor = typeof request.headers['last-event-id'] === 'string' ? request.headers['last-event-id'] : url.searchParams.get('lastEventId');
        const resume = cursor ? this.unseal(actor, cursor, revision) : null;
        if (resume) query.set('lastEventId', resume);
        const upstream = await this.native.response('/api/events?' + query, { signal: lease.signal });
        lease.check();
        if (!upstream.body || !upstream.headers.get('content-type')?.includes('text/event-stream')) throw inputError();
        const reader = upstream.body.getReader(), decoder = new TextDecoder();
        let buffer = '', pending: ReturnType<typeof reader.read> | undefined;
        const cancel = () => { void reader.cancel().catch(() => {}); response.destroy(); };
        lease.signal.addEventListener('abort', cancel, { once: true });
        const write = async (event: unknown, id?: string) => {
            lease.check();
            const text = (id ? `id: ${this.cursor(actor, id, revision)}\n` : '') + `data: ${JSON.stringify(event)}\n\n`;
            if (!response.write(text)) await once(response, 'drain', { signal: lease.signal });
        };
        try {
            response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' });
            response.flushHeaders();
            while (true) {
                lease.check();
                const nextRevision = this.revision(actor);
                if (nextRevision !== revision) {
                    revision = nextRevision;
                    await write({ type: 'connection-changed', data: { status: 'connected', subscriptionId, resume: 'gap' } });
                }
                // A single outstanding native read; the tick detects bindings created after a filtered native event.
                const reading = pending ??= reader.read();
                let timer: ReturnType<typeof setTimeout> | undefined;
                const next = await Promise.race([reading, new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 1000); })]);
                clearTimeout(timer); lease.check();
                if (next === null) continue;
                pending = undefined;
                if (next.done) break;
                buffer += decoder.decode(next.value, { stream: true });
                if (buffer.length > 72 * 1024 * 1024) throw inputError();
                let boundary: RegExpExecArray | null;
                while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
                    const frame = buffer.slice(0, boundary.index); buffer = buffer.slice(boundary.index + boundary[0].length);
                    const lines = frame.split(/\r?\n/), data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
                    if (!data) continue;
                    let value: unknown; try { value = JSON.parse(data); } catch { throw inputError(); }
                    const parsed = SyncEventSchema.safeParse(value); if (!parsed.success) continue;
                    const event = parsed.data, id = lines.find(line => line.startsWith('id:'))?.slice(3).trim();
                    lease.check();
                    if (event.type === 'connection-changed') {
                        subscriptionId = event.data?.subscriptionId;
                        if (subscriptionId) this.subscriptions.set(subscriptionId, this.owner(actor));
                        await write({ type: event.type, data: { status: event.data?.status, subscriptionId, resume: resume ? event.data?.resume : 'gap' } });
                    } else if (event.type === 'heartbeat') await write({ type: event.type, data: event.data });
                    else {
                        const sid = 'sessionId' in event ? event.sessionId : event.type === 'toast' ? event.data.sessionId : null;
                        if (sid ? !this.store.can(actor, 'session', sid) : !('machineId' in event) || !this.store.can(actor, 'machine', event.machineId)) continue;
                        const { namespace: _namespace, ...publicEvent } = event;
                        await write(publicEvent, id);
                    }
                }
            }
            response.end();
        } finally {
            lease.signal.removeEventListener('abort', cancel);
            if (subscriptionId) this.subscriptions.delete(subscriptionId);
            await reader.cancel().catch(() => {}); reader.releaseLock();
        }
    }
}
