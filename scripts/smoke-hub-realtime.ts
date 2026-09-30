import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { get as httpGet, type IncomingMessage } from 'node:http';
import { io, type Socket } from 'socket.io-client';
import { createAccessGateway } from '../src/hub/access/http';
import { HubStore, createIdentityToken } from '../src/hub/store';
import { freePort } from '../src/services';

mkdirSync('.dev-smoke', { recursive: true });
const root = mkdtempSync(resolve('.dev-smoke/hub-realtime-')), statePath = join(root, 'state.sqlite');
const nativeToken = randomBytes(32).toString('base64url'), port = await freePort(), target = `http://127.0.0.1:${port}`;
const hapiHome = join(root, 'hapi'), binary = resolve(process.argv[2] ?? 'dist/hapi');
const hapi = Bun.spawn([binary, 'hub'], { env: { ...process.env, HAPI_HOME: hapiHome, DB_PATH: join(hapiHome, 'hapi.db'),
    CLI_API_TOKEN: nativeToken, HAPI_LISTEN_HOST: '127.0.0.1', HAPI_LISTEN_PORT: String(port), HAPI_PUBLIC_URL: target, TELEGRAM_BOT_TOKEN: '' },
    stdout: Bun.file(join(root, 'hapi-out.log')), stderr: Bun.file(join(root, 'hapi-err.log')) });
let gateway: Awaited<ReturnType<typeof createAccessGateway>> | undefined, hub: HubStore | undefined;
let runner: ReturnType<typeof Bun.spawn> | undefined, base = '', heartbeat: ReturnType<typeof setInterval> | undefined;
const sockets: Socket[] = [], controllers: AbortController[] = [], checks: string[] = [];
const evidence: any = { root, checks, success: false, kind: 'real HAPI + unmodified Runner; session and terminal protocol fixtures, no model/PTY' };
const check = (name: string) => { checks.push(name); console.log('PASS ' + name); };
async function timeout<T>(promise: Promise<T>, ms = 4000): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Timed out')), ms); })]); }
    finally { clearTimeout(timer); }
}
async function until(fn: () => Promise<boolean>, message: string, ms = 15_000) {
    const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await Bun.sleep(60); } throw new Error(message);
}
async function api(path: string, token = '', body?: unknown, expected = 200) {
    const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
    const data = await r.json() as any; assert.equal(r.status, expected, `${path}: ${data.error?.code ?? r.status} ${data.error?.message ?? data.message ?? ""}`); return data;
}
async function connect(namespace: string, auth: object, transports = ['websocket']) {
    const socket = io(base + namespace, { auth, transports, reconnection: false, forceNew: true, timeout: 3000 }); sockets.push(socket);
    await timeout(new Promise<void>((yes, no) => { socket.once('connect', () => yes()); socket.once('connect_error', no); })); return socket;
}
const event = (socket: Socket, name: string) => timeout(new Promise<any>(resolve => socket.once(name, resolve)));
const ping = (socket: Socket) => timeout(new Promise<void>(resolve => socket.emit('ping', resolve)));
async function denied(namespace: string, auth: object) {
    await assert.rejects(connect(namespace, auth));
}
async function stream(token: string, query = '', lastId?: string) {
    const controller = new AbortController(); controllers.push(controller);
    const response = await fetch(`${base}/api/events?all=true&token=${encodeURIComponent(token)}${query}`, {
        signal: controller.signal, headers: lastId ? { 'last-event-id': lastId } : {} });
    assert.equal(response.status, 200); assert.equal(response.headers.get('content-encoding'), null);
    const reader = response.body!.getReader(), decoder = new TextDecoder(), frames: { id?: string; data: any }[] = [];
    let closed = false, buffer = '';
    void (async () => {
        try { while (true) {
            const item = await reader.read(); if (item.done) break;
            buffer += decoder.decode(item.value, { stream: true }); let at: number;
            while ((at = buffer.indexOf('\n\n')) >= 0) {
                const frame = buffer.slice(0, at); buffer = buffer.slice(at + 2);
                const lines = frame.split('\n'), data = lines.find(line => line.startsWith('data: '))?.slice(6);
                if (data) frames.push({ data: JSON.parse(data), id: lines.find(line => line.startsWith('id: '))?.slice(4) });
            }
        } } catch {} finally { closed = true; reader.releaseLock(); }
    })();
    await until(async () => frames.some(frame => frame.data.type === 'connection-changed'), 'SSE connection');
    return { frames, controller, isClosed: () => closed, subscription: frames[0].data.data.subscriptionId };
}
try {
    await until(async () => { try { return (await fetch(target + '/health', { signal: AbortSignal.timeout(300) })).ok; } catch { return false; } }, 'HAPI startup', 30_000);
    gateway = await createAccessGateway({ host: '127.0.0.1', port: 0, target, rootToken: nativeToken, key: randomBytes(32), statePath });
    base = `http://127.0.0.1:${(gateway.server.address() as any).port}`; hub = new HubStore(statePath);
    const a = hub.createIdentity('machine owner'), b = hub.createIdentity('task owner'), c = hub.createIdentity('unrelated'), sid = a.personalSpace.id;
    hub.acceptInvitation(b.identity.id, hub.invite(a.identity.id, sid, 'member').token);
    const aj = (await api('/api/auth', '', { accessToken: a.token, spaceId: sid })).token;
    const bj = (await api('/api/auth', '', { accessToken: b.token, spaceId: sid })).token;
    const cj = (await api('/api/auth', '', { accessToken: c.token })).token;
    for (const [id, ownerId] of [['machine-a', a.identity.id], ['machine-c', c.identity.id], ['machine-runner', a.identity.id]]) gateway.store.bind({ kind: 'machine', id, ownerId });
    const ma = gateway.store.issueMachine('machine-a'), mc = gateway.store.issueMachine('machine-c'), mr = gateway.store.issueMachine('machine-runner');
    const metadata = { host: 'shared-host', platform: 'linux', happyCliVersion: '0.30.7' };
    await api('/cli/machines', ma.token, { id: 'machine-a', metadata }); await api('/cli/machines', mc.token, { id: 'machine-c', metadata });
    const sessionMetadata = { path: root, host: 'shared-host', flavor: 'claude', machineId: 'machine-a', claudeSessionId: randomUUID(), capabilities: { conversationHistory: { forkCurrent: true } } };
    const sa = (await api('/cli/sessions', ma.token, { tag: 'owner-a', metadata: sessionMetadata })).session.id;
    const sb = randomUUID(); gateway.store.bind({ kind: 'session', id: sb, ownerId: b.identity.id, spaceId: sid, machineId: 'machine-a' });
    await api('/cli/sessions', ma.token, { id: sb, tag: 'owner-b', metadata: { ...sessionMetadata, claudeSessionId: randomUUID() } });
    const sc = (await api('/cli/sessions', mc.token, { tag: 'owner-c', metadata: { ...sessionMetadata, machineId: 'machine-c', claudeSessionId: randomUUID() } })).session.id;
    for (const transports of [['websocket'], ['polling']]) {
        const s = await connect('/cli', { token: ma.token, machineId: 'machine-a' }, transports); await ping(s); s.disconnect();
    }
    await denied('/cli', { token: ma.token, machineId: 'machine-c' });
    await denied('/cli', { token: ma.token, sessionId: sc });
    await denied('/cli', { token: a.token, machineId: 'machine-a' });
    await denied('/cli', { token: gateway.native.cliToken(), machineId: 'machine-a' });
    await denied('/terminal', { token: (await api('/api/auth', '', { accessToken: ma.token })).token });
    await denied('/foreign', { token: bj });
    check('websocket/polling ping acknowledgements work; wrong object, root, identity-as-machine, machine terminal and unknown namespace fail');

    const machineA = await connect('/cli', { token: ma.token, machineId: 'machine-a' });
    const machineC = await connect('/cli', { token: mc.token, machineId: 'machine-c' });
    let misdirected = 0;
    let fixtureError: unknown;
    machineA.on('rpc-request', async (data, ack) => {
        try {
            if (data.method === 'machine-a:spawn-happy-session') {
                const params = JSON.parse(data.params), id = params.reservedSessionId ?? params.existingSessionId;
                const source = (await api('/cli/sessions/' + id, ma.token)).session;
                const connection = await connect('/cli', { token: ma.token, sessionId: id });
                const update = await timeout(new Promise<any>(resolve => connection.emit('update-metadata', {
                    sid: id, expectedVersion: source.metadataVersion, metadata: { ...source.metadata, claudeSessionId: randomUUID() } }, resolve)));
                assert.equal(update.result, 'success');
                connection.emit('session-alive', { sid: id, time: Date.now(), thinking: false });
                connection.emit('session-ready', { sid: id, time: Date.now() }); await ping(connection);
                ack(JSON.stringify({ type: 'success', sessionId: id }));
            } else ack(JSON.stringify({ success: true, entries: [] }));
        } catch (error) { fixtureError = error; ack(JSON.stringify({ type: 'error', errorMessage: 'fixture failed', childStarted: false })); }
    });
    machineC.on('rpc-request', (data, ack) => { if (data.method.endsWith(':spawn-happy-session')) misdirected++; ack(JSON.stringify({ success: true, entries: [] })); });
    machineA.emit('machine-alive', { machineId: 'machine-a', time: Date.now() });
    machineC.emit('machine-alive', { machineId: 'machine-c', time: Date.now() });
    machineA.emit('rpc-register', { method: 'machine-a:list-directory' });
    machineA.emit('rpc-register', { method: 'machine-a:spawn-happy-session' });
    machineC.emit('rpc-register', { method: 'machine-c:spawn-happy-session' });
    await ping(machineA); await ping(machineC);
    assert.equal((await api('/api/machines/machine-a/list-directory', aj, { path: root })).success, true);
    for (const [socket, name, data] of [
        [machineA, 'rpc-register', { method: 'machine-c:list-directory' }],
        [machineA, 'rpc-unregister', { method: 'machine-c:spawn-happy-session' }],
        [machineA, 'machine-alive', { machineId: 'machine-c', time: Date.now() }],
        [machineA, 'unrecognized-event', {}],
    ] as const) { const error = event(socket, 'error'); socket.emit(name, data); assert.equal((await error).code, 'access-denied'); }
    const childA = await connect('/cli', { token: ma.token, sessionId: sa });
    const childB = await connect('/cli', { token: ma.token, sessionId: sb });
    const childC = await connect('/cli', { token: mc.token, sessionId: sc });
    for (const [socket, id] of [[childA, sa], [childB, sb], [childC, sc]] as const) { socket.emit('session-alive', { sid: id, time: Date.now(), thinking: false }); await ping(socket); }
    const stolen = event(childB, 'error'); childB.emit('rpc-register', { method: sa + ':abort' }); await stolen;
    const version = (await api(`/api/sessions/${sb}`, bj)).session.metadataVersion;
    const ack = await timeout(new Promise<any>(resolve => childB.emit('update-metadata', { sid: sb, expectedVersion: version, metadata: { ...sessionMetadata, machineId: 'machine-c', claudeSessionId: randomUUID() } }, resolve)));
    assert.equal(ack.result, 'error');
    const nativeCollision = await timeout(new Promise<any>(resolve => childB.emit('update-metadata', {
        sid: sb, expectedVersion: version, metadata: sessionMetadata }, resolve)));
    assert.equal(nativeCollision.result, 'error');
    await api('/cli/sessions', mc.token, { tag: 'colliding-native-id', metadata: { ...sessionMetadata, machineId: 'machine-c' } }, 409);
    assert.equal((await api(`/api/sessions/${sb}`, bj)).session.id, sb);
    assert.equal((await api(`/api/sessions/${sa}`, aj)).session.id, sa);
    check('native machine RPC/ack succeeds; foreign RPC registration, unregistration, heartbeat and metadata machine changes are rejected');

    childB.on('terminal:open', data => { childB.emit('terminal:ready', data); childB.emit('terminal:output', { ...data, data: 'owned terminal output' }); });
    childB.on('agent-terminal:refresh', data => childB.emit('agent-terminal:output', { ...data, terminalId: 'agent', data: 'owned agent output' }));
    const viewer = await connect('/terminal', { token: bj }), wrongViewer = await connect('/terminal', { token: aj });
    const output = event(viewer, 'terminal:output'); viewer.emit('terminal:create', { sessionId: sb, terminalId: 'term-b', cols: 80, rows: 24 });
    assert.equal((await output).data, 'owned terminal output');
    const input = event(childB, 'terminal:write'); viewer.emit('terminal:write', { terminalId: 'term-b', data: 'input-b' }); assert.equal((await input).data, 'input-b');
    const agentOutput = event(viewer, 'agent-terminal:output'); viewer.emit('agent-terminal:subscribe', { sessionId: sb }); assert.equal((await agentOutput).data, 'owned agent output');
    const agentInput = event(childB, 'agent-terminal:input'); viewer.emit('agent-terminal:input', { sessionId: sb, data: 'x' }); assert.equal((await agentInput).data, 'x');
    for (const data of [{ sessionId: sb, terminalId: 'term-b', cols: 80, rows: 24 }, { sessionId: sc, terminalId: 'term-c', cols: 80, rows: 24 }]) {
        const error = event(wrongViewer, 'error'); wrongViewer.emit('terminal:create', data); await error;
    }
    const wrongWrite = event(wrongViewer, 'error'); wrongViewer.emit('terminal:write', { terminalId: 'term-b', data: 'bad' }); await wrongWrite;
    check('native terminal and agent terminal deliver bidirectional data only for the session owner, not the execution machine owner');

    const ae = await stream(aj), be = await stream(bj), ce = await stream(cj);
    for (const [socket, id] of [[childA, sa], [childB, sb], [childC, sc]] as const) { socket.emit('message', { sid: id, message: { role: 'agent', content: { type: 'text', text: 'private-' + id } } }); await ping(socket); }
    await until(async () => be.frames.some(f => f.data.type === 'message-received'), 'B SSE message');
    for (const [stream, own] of [[ae, sa], [be, sb], [ce, sc]] as const) {
        await until(async () => stream.frames.some(f => f.data.sessionId === own), 'own SSE event');
        assert(stream.frames.every(f => !f.data.sessionId || f.data.sessionId === own));
        assert(stream.frames.every(f => !f.data.namespace));
    }
    await api('/api/visibility', bj, { subscriptionId: be.subscription, visibility: 'visible' });
    await api('/api/visibility', aj, { subscriptionId: be.subscription, visibility: 'hidden' }, 404);
    const cursor = be.frames.find(f => f.data.type === 'message-received')!.id!;
    be.controller.abort();
    childB.emit('message', { sid: sb, message: { role: 'agent', content: { type: 'text', text: 'replayed-b' } } }); await ping(childB);
    const replay = await stream(bj, '', cursor), switched = await stream(aj, '', cursor);
    assert.equal(replay.frames[0].data.data.resume, 'ok'); assert.equal(switched.frames[0].data.data.resume, 'gap');
    await until(async () => replay.frames.some(f => JSON.stringify(f.data).includes('replayed-b')), 'own replay');
    assert(switched.frames.every(f => f.data.sessionId !== sb));
    const hiddenNativeId = randomUUID();
    const hidden = (await gateway.native.write('/cli/sessions', { tag: 'unbound', metadata: { ...sessionMetadata, claudeSessionId: hiddenNativeId } })).session.id;
    await api('/cli/sessions', mc.token, { tag: 'steal-unmigrated', metadata: { ...sessionMetadata, machineId: 'machine-c', claudeSessionId: hiddenNativeId } }, 404);

    await Bun.sleep(150); assert(!replay.frames.some(f => f.data.sessionId === hidden));
    const gapsBefore = replay.frames.filter(f => f.data.data?.resume === 'gap').length;
    gateway.store.bind({ kind: 'session', id: hidden, ownerId: b.identity.id, spaceId: sid, machineId: 'machine-a' });
    await until(async () => replay.frames.filter(f => f.data.data?.resume === 'gap').length > gapsBefore, 'binding requires REST refresh');
    assert(!ae.frames.some(f => f.data.sessionId === hidden));
    check('SSE live/replay/visibility are owner-bound; foreign cursors resync and newly bound sessions force a gap without exposing unbound events');

    childB.emit('rpc-register', { method: sb + ':fork-conversation' });
    childB.on('rpc-request', (_data, ack) => ack(JSON.stringify({ nativeSessionId: randomUUID(), forkSession: true })));
    await ping(childB);
    const forked = await api(`/api/sessions/${sb}/fork`, bj, {}).catch(error => { throw fixtureError ?? error; });
    if (fixtureError) throw fixtureError;
    assert.equal(gateway.store.object('session', forked.sessionId)?.ownerId, b.identity.id);
    await api(`/api/sessions/${forked.sessionId}`, aj, undefined, 404);
    const sharedId = randomUUID(), sharedMetadata = { path: root, host: 'shared-host', machineId: 'machine-a', hostPid: 12345,
        flavor: 'codex', codexSessionId: randomUUID(), capabilities: { concurrentClients: true, conversationHistory: { forkCurrent: true } } };
    gateway.store.bind({ kind: 'session', id: sharedId, ownerId: b.identity.id, spaceId: sid, machineId: 'machine-a' });
    await api('/cli/sessions', ma.token, { id: sharedId, tag: 'shared-parent', metadata: sharedMetadata });
    const shared = await connect('/cli', { token: ma.token, sessionId: sharedId });
    shared.emit('session-alive', { sid: sharedId, time: Date.now(), thinking: false });
    shared.emit('rpc-register', { method: sharedId + ':fork-conversation' });
    shared.emit('rpc-register', { method: sharedId + ':clear-conversation' });
    shared.on('rpc-request', async (_data, ack) => {
        try {
            const nativeSessionId = randomUUID();
            const result = await api('/cli/sessions', ma.token, { tag: randomUUID(), metadata: { ...sharedMetadata, codexSessionId: nativeSessionId, forkedFrom: sharedId } });
            assert.equal(gateway!.store.object('session', result.session.id)?.ownerId, b.identity.id);
            ack(JSON.stringify({ nativeSessionId, sessionId: result.session.id }));
        } catch (error) { fixtureError = error; ack(JSON.stringify({ type: 'error', errorMessage: 'fixture failed' })); }
    });
    await ping(shared);
    for (const action of ['fork', 'clear']) {
        const result = await api(`/api/sessions/${sharedId}/${action}`, bj, {}); if (fixtureError) throw fixtureError;
        assert.equal(gateway.store.object('session', result.sessionId)?.ownerId, b.identity.id);
        await api(`/api/sessions/${result.sessionId}`, aj, undefined, 404);
    }
    await api('/cli/sessions', ma.token, { tag: 'forged-fork', metadata: { ...sharedMetadata, codexSessionId: randomUUID(), forkedFrom: sharedId } }, 404);
    check('Claude Hub-created fork/bootstrap and Codex non-adopt shared fork/clear inherit the task owner before native acknowledgements');

    const slow = await timeout(new Promise<IncomingMessage>((resolve, reject) => {
        const request = httpGet(`${base}/api/events?all=true`, { headers: { authorization: `Bearer ${cj}` } }, resolve);
        request.once('error', reject);
    }));
    let slowBytes = 0; slow.on('data', chunk => { slowBytes += chunk.length; }); slow.on('error', () => {}); slow.pause();
    const closedSlow = new Promise<void>(resolve => slow.once('close', resolve));
    const bulk = 'x'.repeat(128 * 1024), count = 100;
    for (let i = 0; i < count; i++) childC.emit('message', { sid: sc, message: { role: 'agent', content: { type: 'text', text: bulk } } });
    await ping(childC);
    hub.rotate(c.identity, c.token, createIdentityToken());
    await Bun.sleep(1200); slow.resume(); await timeout(closedSlow);
    assert(slowBytes < bulk.length * count, 'backpressured SSE must not deliver remaining private payload after revocation');
    check('revoking identity terminates backpressured SSE while native messages remain stored for the owner');

    const runnerHome = join(root, 'runner'); mkdirSync(runnerHome);
    writeFileSync(join(runnerHome, 'settings.json'), JSON.stringify({ machineId: 'machine-runner', cliApiToken: mr.token }));
    runner = Bun.spawn([binary, 'runner', 'start-sync'], { env: { ...process.env, HAPI_HOME: runnerHome, CLI_API_TOKEN: mr.token,
        HAPI_API_URL: base, HAPI_DISABLE_VERSION_HANDOFF: '1' }, stdout: Bun.file(join(root, 'runner-out.log')), stderr: Bun.file(join(root, 'runner-err.log')) });
    await until(async () => (await api('/api/machines', aj)).machines.some((m: any) => m.id === 'machine-runner' && m.active), 'unmodified Runner heartbeat', 30_000);
    assert.equal((await api('/api/machines/machine-runner/list-directory', aj, { path: root })).success, true);
    runner.kill(); await runner.exited; runner = undefined;
    check('unmodified compiled Runner registers with an opaque machine token, heartbeats and handles native directory RPC');

    const replacementB = createIdentityToken();
    const disconnect = event(viewer, 'disconnect'); hub.rotate(b.identity, b.token, replacementB);
    await disconnect; await until(async () => replay.isClosed(), 'rotated JWT stops idle SSE');
    const machineDisconnect = event(childC, 'disconnect'); gateway.store.revoke(mc.id); await machineDisconnect;
    check('identity rotation closes idle terminal/SSE and machine revocation closes already-connected sessions');
    const bNext = (await api('/api/auth', '', { accessToken: replacementB, spaceId: sid })).token;
    const memberStream = await stream(bNext), memberViewer = await connect('/terminal', { token: bNext });
    memberViewer.emit('agent-terminal:subscribe', { sessionId: sb });
    const memberGone = event(memberViewer, 'disconnect'), machineChildGone = event(childB, 'disconnect');
    hub.changeMember(a.identity.id, sid, b.identity.id, null);
    await Promise.all([memberGone, machineChildGone]); await until(async () => memberStream.isClosed(), 'removed member SSE closes');
    check('space removal closes both user subscriptions and the machine socket assigned to that member session');

    // Reissue C for a controlled native fallback: preflight sees A online, then A really expires while C keeps heartbeating.
    const mc2 = gateway.store.issueMachine('machine-c'), fallback = await connect('/cli', { token: mc2.token, machineId: 'machine-c' });
    fallback.on('rpc-request', (_data, ack) => { misdirected++; ack(JSON.stringify({ type: 'success', sessionId: sa })); });
    fallback.emit('rpc-register', { method: 'machine-c:spawn-happy-session' }); await ping(fallback);
    heartbeat = setInterval(() => fallback.emit('machine-alive', { machineId: 'machine-c', time: Date.now() }), 1000);
    machineA.emit('machine-alive', { machineId: 'machine-a', time: Date.now() }); childA.emit('session-end', { sid: sa, time: Date.now() }); await ping(machineA); await ping(childA);
    const originalJson = gateway.native.json.bind(gateway.native); let race = true;
    gateway.native.json = async (path, options, namespace) => {
        const data = await originalJson(path, options, namespace);
        if (path === '/api/machines' && race) {
            race = false; assert(data.machines.some((m: any) => m.id === 'machine-a' && m.active));
            console.log('Checking real same-host fallback after preflight; waiting for native 45-second heartbeat expiry.');
            await until(async () => !(await originalJson('/api/machines')).machines.some((m: any) => m.id === 'machine-a' && m.active), 'native A expiry', 52_000);
        }
        return data;
    };
    const failed = await fetch(`${base}/api/sessions/${sa}/resume`, { method: 'POST', headers: { authorization: `Bearer ${aj}`, 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(60_000) });
    const failedBody = await failed.text();
    assert(!failed.ok); assert(failedBody.includes('Runweft denied the assigned execution target.'), 'must fail at actual outgoing RPC guard');
    assert.equal(misdirected, 0, 'no request bytes may reach the fallback machine');
    check('after successful online preflight, real HAPI same-host fallback is denied before RPC reaches the other Runner');
    evidence.success = true;
} catch (error) { evidence.error = error instanceof Error ? error.message : String(error); throw error; }
finally {
    clearInterval(heartbeat); for (const c of controllers) c.abort(); for (const s of sockets) s.disconnect();
    if (runner) { runner.kill(); await runner.exited; }
    await gateway?.close(); hub?.close(); hapi.kill(); await hapi.exited;
    writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2)); console.log('Evidence: ' + root);
}
