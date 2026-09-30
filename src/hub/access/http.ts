import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { z } from 'zod';
import { jsonResponse } from '../../proxy';
import { HapiRequestError } from '../../hapi';
import { ResourceError } from '../../resources/types';
import { TaskError } from '../../tasks/types';
import { PreparationError } from '../../remote/types';
import { handleHubRequest } from '../api';
import { handleConnectionRequest } from '../connect/api';
import { ConnectionRequestStore } from '../connect/store';
import { hubPage } from '../page';
import { HubStore } from '../store';
import { HubError, hubNotFound, hubUnauthorized } from '../types';
import { AccessStore } from './store';
import { AccessAuthority } from './auth';
import { NativeFiles, STREAMED } from './files';
import { NativeSessions, type ExecutionPolicy } from './sessions';
import { NativeTransport, RequestLease, inputError, pathParts, readJson, unavailable } from './transport';
import type { Principal, ExecutionObject } from './types';
import { attachAccessSockets } from './sockets';
import { NativeEvents } from './events';

// Enumerated native surface. New HAPI routes must be reviewed instead of inheriting the root credential.
export const SESSION_ROUTES: Record<string, RegExp[]> = {
    GET: [/^$/, /^export$/, /^messages$/, /^git-status$/, /^git-diff-numstat$/, /^git-diff-file$/, /^file$/, /^files$/, /^directory$/,
        /^generated-images\/[^/]+$/, /^scratchlist(?:\/limits|\/attachments\/[^/]+)?$/, /^slash-commands$/, /^skills$/, /^codex-models$/],
    POST: [/^messages$/, /^messages\/queued-state$/, /^messages\/[^/]+\/(steer|retry)$/, /^permissions\/[^/]+\/(approve|deny)$/,
        /^execution\/interrupt$/, /^(abort|archive|rewind|switch|permission-mode|collaboration-mode|model|model-reasoning-effort|effort|service-tier|title-suggestion)$/,
        /^codex\/plan\/implement$/, /^upload(?:\/delete)?$/, /^scratchlist(?:\/upload)?$/],
    PATCH: [/^$/, /^summary$/], PUT: [/^pin$/, /^scratchlist\/[^/]+$/], DELETE: [/^$/, /^messages\/[^/]+$/, /^scratchlist\/(?:attachments\/)?[^/]+$/],
};
export type AccessGatewayOptions = {
    host: string; port: number; target: string; rootToken: string; key: Uint8Array; statePath: string;
    health?: () => object;
    executionPolicy?: ExecutionPolicy;
    sessionPolicy?: (binding: ExecutionObject, method: string, suffix: string) => void;
    business?: (request: IncomingMessage, response: ServerResponse, actor: Principal, lease: RequestLease) => Promise<boolean>;
};

/** Independent secure entry. The legacy serve switches to it only with the later identity migration. */
export async function createAccessGateway(options: AccessGatewayOptions) {
    const store = new AccessStore(options.statePath), identities = new HubStore(options.statePath);
    const connections = new ConnectionRequestStore(store);
    const authority = new AccessAuthority(store, options.key), native = new NativeTransport(options.target, options.rootToken);
    const files = new NativeFiles(store, native), sessions = new NativeSessions(store, native, options.executionPolicy);
    const events = new NativeEvents(store, native, options.key);
    const sockets = new Set<Socket>();
    const leases = new Set<RequestLease>();
    const server = createServer((request, response) => {
        response.setHeader('connection', 'close');
        void handle(request, response).catch(error => {
            if (response.destroyed) return;
            if (response.headersSent) { response.destroy(); return; }
            const known = error instanceof HubError || error instanceof HapiRequestError || error instanceof ResourceError || error instanceof TaskError || error instanceof PreparationError;
            jsonResponse(response, known ? error.status : 500, { error: known ? { code: error.code, message: error.message, hint: error.hint }
                : { code: 'native_gateway_failed', message: '原生请求未能完成。', hint: '查询原任务或对象确认状态，不要盲目重发。' } });
        });
    });
    server.requestTimeout = 0;
    const realtime = attachAccessSockets(server, store, authority, native, sessions);
    server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });

    async function handle(request: IncomingMessage, response: ServerResponse) {
        const { url, parts } = pathParts(request), method = request.method ?? 'GET', path = url.pathname;
        if (['accessToken', 'namespace', 'ownerId', 'spaceId'].some(key => url.searchParams.has(key))
            || (url.searchParams.has('token') && path !== '/api/events')) throw inputError();
        if (hubPage(request, response) || await handleConnectionRequest(request, response, connections) || await handleHubRequest(request, response, identities)) return;
        if (path === '/api/runweft/health' && method === 'GET') {
            jsonResponse(response, 200, options.health?.() ?? { service: 'runweft', protocolVersion: 1, ready: true, capabilities: { hubIdentity: 1, hubAccess: 1, hubConnect: 1 } }); return;
        }
        if (path === '/health' && method === 'GET') { jsonResponse(response, 200, await native.json('/health')); return; }
        if (path === '/api/auth' && method === 'POST') {
            const parsed = z.object({ accessToken: z.string().min(1), spaceId: z.uuid().optional() }).strict().safeParse(await readJson(request, 16_384));
            if (!parsed.success) throw inputError();
            jsonResponse(response, 200, await authority.exchange(parsed.data.accessToken, parsed.data.spaceId)); return;
        }
        if (method === 'GET' && (path === '/' || /^\/sessions(?:\/[^/]+)?$/.test(path) || path.startsWith('/assets/')
            || ['/manifest.webmanifest', '/favicon.ico', '/icon-192.png', '/icon-512.png'].includes(path))) {
            const upstream = await native.response(path);
            response.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream', 'cache-control': 'no-store' });
            response.end(Buffer.from(await upstream.arrayBuffer())); return;
        }
        if (!['api', 'cli'].includes(parts[0])) throw unavailable();
        const token = request.headers.authorization?.startsWith('Bearer ') ? request.headers.authorization.slice(7)
            : path === '/api/events' ? url.searchParams.get('token') ?? '' : '';
        let actor: Principal;
        if (parts[0] === 'cli') {
            actor = store.authenticate(token);
            if (actor.kind !== 'machine') throw hubUnauthorized();
        } else actor = await authority.verify(token);
        const lease = new RequestLease(actor, store, response); leases.add(lease);
        try {
            if (path.startsWith('/api/runweft/')) {
                if (actor.kind === 'user' && options.business && await options.business(request, response, actor, lease)) return;
                throw unavailable();
            }
            let result: any;
            if (path === '/api/events' && method === 'GET') { await events.stream(request, response, url, lease); result = STREAMED; }
            else if (path === '/api/visibility' && method === 'POST' && actor.kind === 'user') result = await events.visibility(actor, await readJson(request, 16_384, lease.signal), lease.signal);
            else if (parts[1] === 'artifacts') result = await files.handle(parts, url, request, lease);
            else if (parts[0] === 'cli') result = await cli(parts, url, request, lease);
            else if (parts[1] === 'machines') result = await machines(parts, url, request, lease);
            else if (parts[1] === 'sessions') result = await sessionApi(parts, url, request, lease);
            else throw unavailable();
            lease.check();
            if (result !== STREAMED) jsonResponse(response, 200, result);
        } finally { leases.delete(lease); lease.close(); }
    }
    async function cli(parts: string[], url: URL, request: IncomingMessage, lease: RequestLease) {
        const { actor, signal } = lease, method = request.method, [, kind, id, section] = parts;
        if (kind === 'machines') {
            if (parts.length === 2 && method === 'POST') {
                const body = await readJson(request, undefined, signal); store.require(actor, 'machine', body.id, 'report');
                return native.write('/cli/machines', body, signal);
            }
            if (parts.length === 3 && method === 'GET') {
                store.require(actor, 'machine', id); return native.json(`/cli/machines/${encodeURIComponent(id)}`, { signal });
            }
        }
        if (kind === 'sessions') {
            if (parts.length === 2 && method === 'POST') return sessions.bootstrap(actor, await readJson(request, undefined, signal), signal);
            if (parts.length === 3 && id === 'resumable' && method === 'GET') return sessions.list(actor, '/cli/sessions/resumable', url, signal);
            if (id && method === 'GET' && (parts.length === 3 || (parts.length === 4 && ['messages', 'resume-target'].includes(section)))) {
                if (!store.object('session', id)) await sessions.allocated(actor, id, signal);
                const checked = await sessions.checked(actor, id, 'read', signal);
                lease.add(() => { store.require(actor, 'session', checked.binding.id); });
                const target = `/cli/sessions/${encodeURIComponent(checked.binding.id)}${section ? '/' + section : ''}${url.search}`;
                const result = await native.json(target, { signal });
                if (result.target?.sessionId) store.require(actor, 'session', result.target.sessionId);
                if (result.session?.id) store.require(actor, 'session', result.session.id);
                return result;
            }
        }
        throw unavailable();
    }
    async function machines(parts: string[], url: URL, request: IncomingMessage, lease: RequestLease) {
        const { actor, signal } = lease, method = request.method, [, , id, section, requestId] = parts;
        if (actor.kind !== 'user') throw unavailable();
        if (parts.length === 2 && method === 'GET') {
            const result = await native.json('/api/machines' + (url.searchParams.get('includeOffline') === 'true' ? '?includeOffline=true' : ''), { signal });
            return { machines: result.machines.filter((machine: any) => store.can(actor, 'machine', machine.id)) };
        }
        if (section === 'spawn-requests' && parts.length === 5 && method === 'GET') return sessions.receipt(actor, id, requestId, signal);
        lease.add(() => { store.require(actor, 'machine', id, method === 'GET' ? 'read' : 'write'); });
        const path = `/api/machines/${encodeURIComponent(id)}`;
        if (section === 'spawn' && parts.length === 4 && method === 'POST') return sessions.spawn(actor, id, await readJson(request, undefined, signal), lease);
        if (parts.length === 3 && method === 'PATCH') return native.write(path, await readJson(request, undefined, signal), signal, method);
        if (parts.length === 4 && method === 'GET' && ['agent-availability', 'codex-models'].includes(section)) return native.json(`${path}/${section}`, { signal });
        if (parts.length === 4 && method === 'POST' && ['list-directory', 'restart-runner'].includes(section)) {
            const body = await readJson(request, undefined, signal); lease.check(); return native.write(`${path}/${section}`, body, signal);
        }
        if (parts.length === 5 && section === 'paths' && requestId === 'exists' && method === 'POST') {
            const body = await readJson(request, undefined, signal); lease.check(); return native.write(path + '/paths/exists', body, signal);
        }
        throw unavailable();
    }
    async function sessionApi(parts: string[], url: URL, request: IncomingMessage, lease: RequestLease) {
        const { actor, signal } = lease, method = request.method ?? 'GET', id = parts[2], suffix = parts.slice(3).join('/');
        if (actor.kind === 'task') throw unavailable();
        if (parts.length === 2 && method === 'GET') return sessions.list(actor, '/api/sessions', url, signal);
        if (!id) throw unavailable();
        // Native peer helpers use the machine JWT; no terminal, machine administration or arbitrary native mutation.
        if (actor.kind === 'machine' && !((method === 'GET' && ['', 'messages'].includes(suffix))
            || (method === 'POST' && ['messages', 'resume'].includes(suffix)))) throw unavailable();
        const checked = await sessions.checked(actor, id, method === 'GET' ? 'read' : 'write', signal);
        if (options.sessionPolicy) lease.add(() => options.sessionPolicy!(checked.binding, method, suffix));
        const dropObjectGuard = lease.add(() => { store.require(actor, 'session', checked.binding.id, method === 'GET' ? 'read' : 'write'); });
        const needsBody = ['POST', 'PUT', 'PATCH'].includes(method);
        const body = needsBody ? await readJson(request, undefined, signal) : undefined;
        lease.check();
        if (method === 'POST' && ['resume', 'reopen', 'fork', 'clear'].includes(suffix)) {
            return sessions.derive(actor, checked.binding.id, suffix as 'resume' | 'reopen' | 'fork' | 'clear', body!, lease);
        }
        if (!SESSION_ROUTES[method]?.some(pattern => pattern.test(suffix))) throw unavailable();
        const path = `/api/sessions/${encodeURIComponent(checked.binding.id)}${suffix ? '/' + suffix : ''}${url.search}`;
        const upstream = await native.response(path, { method, signal, ...(needsBody ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
        if (method === 'DELETE' && !suffix) { lease.check(); dropObjectGuard(); store.retire('session', checked.binding.id); }
        if (upstream.headers.get('content-type')?.includes('application/json')) return upstream.json();
        await lease.stream(upstream); return STREAMED;
    }
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port, options.host, resolve); });
    return { server, store, authority, native, files, sessions,
        async close() {
            realtime.close();
            for (const lease of leases) lease.close();
            for (const socket of sockets) socket.destroy();
            await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
            identities.close(); store.close();
        },
    };
}
