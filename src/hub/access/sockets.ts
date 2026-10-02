import type { Server as HttpServer } from 'node:http';
import { Server, type Socket as Downstream } from 'socket.io';
import { io, type Socket as Upstream } from 'socket.io-client';
import { RPC_METHODS } from '../../../hapi/shared/src/rpcMethods';
import { SOCKET_MAX_HTTP_BUFFER_SIZE } from '../../../hapi/hub/src/socket/socketLimits';
import { hubNotFound, hubUnauthorized } from '../types';
import type { AccessAuthority } from './auth';
import type { AccessStore } from './store';
import type { NativeSessions } from './sessions';
import { record, unavailable, type NativeTransport } from './transport';
import type { Principal, ExecutionObject } from './types';

const sessionEvents = new Set(['message', 'session-alive', 'session-ready', 'session-end', 'messages-consumed',
    'messages-indeterminate', 'native-queue-message', 'messages-steer-state', 'update-metadata', 'update-state']);
const machineEvents = new Set(['machine-alive', 'machine-update-metadata', 'machine-update-state', 'machine-agy-models-changed']);
const cliTerminalIn = new Set(['terminal:ready', 'terminal:output', 'terminal:exit', 'terminal:error', 'agent-terminal:output', 'agent-terminal:reset']);
const cliTerminalOut = new Set(['terminal:open', 'terminal:write', 'terminal:resize', 'terminal:close',
    'agent-terminal:resize', 'agent-terminal:refresh', 'agent-terminal:input', 'agent-terminal:idle']);
const viewerAgentIn = new Set(['agent-terminal:subscribe', 'agent-terminal:unsubscribe', 'agent-terminal:resize', 'agent-terminal:input']);
const viewerOut = new Set(['terminal:ready', 'terminal:output', 'terminal:exit', 'terminal:error']);
const updateTypes = new Set(['new-message', 'update-session', 'retry-queued-message', 'cancel-queued-message']);
const rpcMethods = new Set<string>(Object.values(RPC_METHODS));
const deniedRpc = JSON.stringify({ type: 'error', errorMessage: 'Runweft denied the assigned execution target.', childStarted: false });
const deniedAck = { result: 'error', reason: 'access-denied', ok: false };
type Scope = { kind: 'session' | 'machine'; id: string };
type SessionPolicy = (binding: ExecutionObject, method: string, suffix: string) => void;

export function authorizeTerminal(store: AccessStore, actor: Principal, sessionId: string, policy?: SessionPolicy, agentInput = false) {
    const binding = store.require(actor, 'session', sessionId, 'write');
    if (actor.kind !== 'user' || !binding.machineId) throw hubNotFound();
    store.require(actor, 'machine', binding.machineId, 'write');
    policy?.(binding, 'POST', agentInput ? 'messages' : 'terminal');
    return binding;
}

/** One native socket per external connection. No native execution, PTY, or reconnection state is reimplemented. */
export function attachAccessSockets(server: HttpServer, store: AccessStore, authority: AccessAuthority,
    native: NativeTransport, sessions: NativeSessions, sessionPolicy?: SessionPolicy) {
    const bridge = new Server(server, { maxHttpBufferSize: SOCKET_MAX_HTTP_BUFFER_SIZE, serveClient: false });
    bridge.of('/').use((_socket, next) => next(new Error('Runweft socket namespace unavailable.')));
    const closeConnections = new Set<() => void>();
    let shuttingDown = false;
    // Engine.IO handles its exact path. Other upgrades have no forwarding path.
    server.on('upgrade', (request, socket) => {
        if (new URL(request.url ?? '/', 'http://runweft.invalid').pathname !== '/socket.io/') socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    });
    for (const namespace of ['/cli', '/terminal']) {
        bridge.of(namespace).use((socket, next) => {
            void connect(socket, namespace).then(() => next(), () => next(new Error('Runweft authentication or object access denied.')));
        });
        bridge.of(namespace).on('connection', socket => socket.data.start());
    }
    async function connect(down: Downstream, namespace: string) {
        const auth = record(down.handshake.auth), token = typeof auth.token === 'string' ? auth.token : '';
        const query = down.handshake.query;
        if (['token', 'accessToken', 'namespace', 'ownerId', 'spaceId'].some(key => key in query)) throw hubUnauthorized();
        let actor: Principal, scope: Scope | undefined, upstreamAuth: Record<string, string>;
        if (namespace === '/cli') {
            actor = store.authenticate(token);
            if (actor.kind !== 'machine' || Boolean(auth.sessionId) === Boolean(auth.machineId)) throw hubUnauthorized();
            scope = auth.sessionId ? { kind: 'session', id: auth.sessionId } : { kind: 'machine', id: auth.machineId };
            if (typeof scope.id !== 'string') throw hubNotFound();
            if (scope.kind === 'session' && !store.object('session', scope.id)) await sessions.allocated(actor, scope.id);
            store.require(actor, scope.kind, scope.id, 'report');
            upstreamAuth = { token: native.cliToken(), [scope.kind + 'Id']: scope.id };
        } else {
            actor = await authority.verify(token);
            if (actor.kind !== 'user') throw hubUnauthorized();
            upstreamAuth = { token: (await native.write('/api/auth', { accessToken: native.cliToken() })).token };
        }
        const up = io(native.url + namespace, { auth: upstreamAuth, transports: ['websocket'], reconnection: false,
            autoConnect: false, forceNew: true, timeout: 5000 });
        const terminals = new Map<string, string>(), subscriptions = new Set<string>();
        const controller = new AbortController();
        let timer: ReturnType<typeof setInterval> | undefined, closed = false;
        const close = () => {
            if (closed) return; closed = true; clearInterval(timer); controller.abort();
            up.disconnect();
            if (shuttingDown) down.conn.close(); else down.disconnect(true);
            closeConnections.delete(close);
        };
        closeConnections.add(close);
        const check = () => {
            if (closed) throw hubUnauthorized();
            store.refresh(actor);
            if (scope) store.require(actor, scope.kind, scope.id, 'report');
            for (const sid of terminals.values()) authorizeTerminal(store, actor, sid, sessionPolicy);
            for (const sid of subscriptions) store.require(actor, 'session', sid);
        };
        const session = (id: unknown) => {
            if (typeof id !== 'string') throw hubNotFound();
            if (scope?.kind === 'session' && scope.id !== id) throw hubNotFound();
            return store.require(actor, 'session', id, actor.kind === 'machine' ? 'report' : 'write');
        };
        const machine = (id: unknown) => {
            if (typeof id !== 'string' || scope?.kind !== 'machine' || scope.id !== id) throw hubNotFound();
            return store.require(actor, 'machine', id, 'report');
        };
        const rpc = (data: any) => {
            if (!scope || typeof data.method !== 'string') throw hubNotFound();
            const [id, method, extra] = data.method.split(':');
            if (id !== scope.id || extra !== undefined || !rpcMethods.has(method)) throw hubNotFound();
            store.require(actor, scope.kind, scope.id, 'report'); return method;
        };
        async function incoming(event: string, data: any) {
            check();
            if (namespace === '/cli') {
                if (event === 'ping') return;
                data = record(data);
                if (sessionEvents.has(event)) {
                    const binding = session(data.sid);
                    if (event === 'update-metadata') {
                        const metadata = record(data.metadata);
                        if (metadata.machineId !== binding.machineId) throw hubNotFound();
                        // forkedFrom may describe history, but cannot change trusted ownership.
                        if (metadata.forkedFrom) {
                            const parent = store.object('session', metadata.forkedFrom);
                            if (!parent || parent.ownerId !== binding.ownerId || parent.spaceId !== binding.spaceId || parent.machineId !== binding.machineId) throw hubNotFound();
                        }
                        await sessions.guardMetadata(actor, binding.id, metadata, controller.signal);
                    }
                } else if (machineEvents.has(event)) machine(data.machineId);
                else if (event === 'rpc-register' || event === 'rpc-unregister') rpc(data);
                else if (cliTerminalIn.has(event)) session(data.sessionId);
                else throw unavailable();
            } else {
                data = record(data);
                if (event === 'terminal:create') {
                    session(data.sessionId);
                    authorizeTerminal(store, actor, data.sessionId, sessionPolicy);
                    if (typeof data.terminalId !== 'string' || !data.terminalId || data.terminalId.length > 256) throw unavailable();
                    if (terminals.has(data.terminalId) && terminals.get(data.terminalId) !== data.sessionId) throw hubNotFound();
                    terminals.set(data.terminalId, data.sessionId);
                } else if (['terminal:write', 'terminal:resize', 'terminal:close'].includes(event)) {
                    const binding = session(terminals.get(data.terminalId));
                    authorizeTerminal(store, actor, binding.id, sessionPolicy);
                }
                else if (viewerAgentIn.has(event)) {
                    session(data.sessionId);
                    if (event === 'agent-terminal:input' || event === 'agent-terminal:resize') authorizeTerminal(store, actor, data.sessionId, sessionPolicy, true);
                    if (event === 'agent-terminal:subscribe') subscriptions.add(data.sessionId);
                    else if (event === 'agent-terminal:unsubscribe') subscriptions.delete(data.sessionId);
                } else throw unavailable();
            }
        }
        function outgoing(event: string, data: any) {
            check(); data = record(data);
            if (namespace === '/cli') {
                if (event === 'rpc-request') rpc(data);
                else if (event === 'update') {
                    const body = record(data.body);
                    if (body.t === 'update-machine') machine(body.machineId);
                    else if (updateTypes.has(body.t)) session(body.sid);
                    else throw unavailable();
                } else if (cliTerminalOut.has(event)) session(data.sessionId);
                else if (event === 'error') {
                    if (data.scope === 'session') session(data.id);
                    else if (data.scope === 'machine') machine(data.id);
                    else throw unavailable();
                } else throw unavailable();
            } else if (viewerOut.has(event)) {
                const sid = terminals.get(data.terminalId); session(sid);
                if (data.sessionId && data.sessionId !== sid) throw hubNotFound();
            } else if (event === 'agent-terminal:output') {
                session(data.sessionId); if (!subscriptions.has(data.sessionId)) throw hubNotFound();
            } else throw unavailable();
        }
        async function dispatchGuard(event: string, data: any) {
            outgoing(event, data);
            if (event !== 'rpc-request' || rpc(data) !== RPC_METHODS.SpawnHappySession) return;
            const params = record(JSON.parse(data.params));
            const id = params.reservedSessionId ?? params.existingSessionId ?? params.sessionId;
            if (typeof id !== 'string') throw hubNotFound();
            if (!store.object('session', id)) await sessions.allocated(actor, id, controller.signal);
            // Recheck the actual RPC destination, including HAPI's same-host fallback after HTTP preflight.
            sessions.checkExecution(session(id), params.agent ?? 'claude'); check();
        }
        function send(destination: Upstream | Downstream, event: string, args: any[], validate: () => void | Promise<void>) {
            const original = typeof args.at(-1) === 'function' ? args.pop() : undefined;
            let done = false;
            destination.emit(event, ...args, ...(original ? [(...reply: any[]) => {
                if (done) return; done = true;
                void Promise.resolve().then(validate).then(() => original(...reply), () => { original(event === 'rpc-request' ? deniedRpc : deniedAck); close(); });
            }] : []));
        }
        const reject = (event: string, args: any[]) => {
            const ack = args.at(-1); if (typeof ack === 'function') ack(event === 'rpc-request' ? deniedRpc : deniedAck);
            down.emit('error', { code: 'access-denied', message: 'Runweft object access denied.' });
        };
        down.data.start = () => {
            timer = setInterval(() => { try { check(); } catch { close(); } }, 1000);
            let incomingQueue = Promise.resolve();
            down.onAny((event, ...args) => {
                incomingQueue = incomingQueue.then(async () => {
                    try { await incoming(event, args[0]); send(up, event, args, () => incoming(event, args[0])); }
                    catch { reject(event, args); }
                });
            });
            down.once('disconnect', close);
        };
        // Outgoing packets may need a receipt lookup, so serialize dispatch without waiting for business acknowledgements.
        let dispatch = Promise.resolve();
        up.onAny((event, ...args) => {
            dispatch = dispatch.then(async () => {
                try {
                    await dispatchGuard(event, args[0]);
                    send(down, event, args, () => {
                        outgoing(event, args[0]);
                        if (event === 'rpc-request' && rpc(args[0]) === RPC_METHODS.SpawnHappySession) {
                            const params = record(JSON.parse(args[0].params));
                            sessions.checkExecution(session(params.reservedSessionId ?? params.existingSessionId ?? params.sessionId), params.agent ?? 'claude');
                        }
                    });
                    if (namespace === '/terminal' && ['terminal:exit', 'terminal:error'].includes(event)) terminals.delete(args[0]?.terminalId);
                }
                catch { reject(event, args); }
            });
        });
        up.once('disconnect', close);
        down.conn.once('close', close);
        try {
            await new Promise<void>((resolve, reject) => {
                up.once('connect', resolve); up.once('connect_error', reject);
                controller.signal.addEventListener('abort', () => reject(hubUnauthorized()), { once: true }); up.connect();
            });
            check();
        } catch (error) { close(); throw error; }
    }
    return { bridge, close() { shuttingDown = true; for (const close of closeConnections) close(); bridge.engine.close(); } };
}
