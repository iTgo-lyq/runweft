import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { get as httpGet } from 'node:http';
import { join, resolve } from 'node:path';
import { Database } from 'bun:sqlite';
import { io, type Socket } from 'socket.io-client';
import { createAccessGateway } from '../src/hub/access/http';
import { fingerprint, fileNamespace } from '../src/hub/access/transport';
import { HubStore, createIdentityToken } from '../src/hub/store';
import { freePort } from '../src/services';

import { closeSmoke, removeSmokeSecrets, startSmokeHapi, stopSmokeProcess } from './fixtures/smoke-lifecycle';

mkdirSync('.dev-smoke', { recursive: true });
const root = mkdtempSync(resolve('.dev-smoke/hub-access-')), statePath = join(root, 'state.sqlite'), hapiHome = join(root, 'hapi');
const rootToken = randomBytes(32).toString('base64url'), key = randomBytes(32), hapiPort = await freePort();
const target = `http://127.0.0.1:${hapiPort}`;
const processes = new Set<ReturnType<typeof Bun.spawn>>();
let child: Awaited<ReturnType<typeof startSmokeHapi>> | undefined;
let gateway: Awaited<ReturnType<typeof createAccessGateway>> | undefined, hub: HubStore | undefined;
const sockets: Socket[] = [], checks: string[] = []; let base = '';
const evidence: any = { root, success: false, checks, kind: 'real HAPI, source gateway, protocol execution fixture; no model/PTY' };
const check = (name: string) => { checks.push(name); console.log('PASS ' + name); };
async function eventually(fn: () => Promise<boolean>, message: string, ms = 15_000) {
    const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await Bun.sleep(50); } throw new Error(message);
}
async function api(path: string, token = '', body?: unknown, method = body === undefined ? 'GET' : 'POST', expected = 200) {
    const result = await fetch(base + path, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await result.json() as any;
    assert.equal(result.status, expected, `${method} ${path}: ${data.error?.code ?? data.code ?? result.status}`);
    return data;
}
async function connect(auth: object) {
    const socket = io(base + '/cli', { auth, transports: ['websocket'], reconnection: false, timeout: 3000 }); sockets.push(socket);
    await new Promise<void>((yes, no) => { socket.once('connect', () => yes()); socket.once('connect_error', no); }); return socket;
}
async function startGateway() {
    gateway = await createAccessGateway({ host: '127.0.0.1', port: 0, target, rootToken, key, statePath });
    base = `http://127.0.0.1:${(gateway.server.address() as any).port}`;
}
try {
    child = await startSmokeHapi(resolve(process.argv[2] ?? 'dist/hapi'), root, process.env, hapiPort, rootToken, processes);
    await startGateway(); hub = new HubStore(statePath);
    const a = hub.createIdentity('machine owner'), b = hub.createIdentity('task owner'), c = hub.createIdentity('other owner');
    const sid = a.personalSpace.id, invitation = hub.invite(a.identity.id, sid, 'member'); hub.acceptInvitation(b.identity.id, invitation.token);
    const auth = async (token: string, spaceId?: string) => (await api('/api/auth', '', { accessToken: token, ...(spaceId ? { spaceId } : {}) })).token as string;
    const aj = await auth(a.token, sid), bj = await auth(b.token, sid), cj = await auth(c.token, c.personalSpace.id);
    for (const [machineId, owner] of [['machine-a', a], ['machine-c', c]] as const) gateway!.store.bind({ kind: 'machine', id: machineId, ownerId: owner.identity.id });
    const ma = gateway!.store.issueMachine('machine-a'), mc = gateway!.store.issueMachine('machine-c');
    const metadata = { host: 'same-host', platform: 'linux', happyCliVersion: '0.30.7', capabilities: ['agent-availability'] };
    await api('/cli/machines', ma.token, { id: 'machine-a', metadata }); await api('/cli/machines', mc.token, { id: 'machine-c', metadata });
    await api('/cli/machines', ma.token, { id: 'machine-c', metadata }, 'POST', 404);
    assert.deepEqual((await api('/api/machines?includeOffline=true', aj)).machines.map((m: any) => m.id), ['machine-a']);
    assert.equal((await api('/api/machines?includeOffline=true', bj)).machines.length, 0);
    check('native machine registration is bound to machine credential; owner sees only own inventory');

    const runner = await connect({ token: ma.token, machineId: 'machine-a' });
    runner.emit('machine-alive', { machineId: 'machine-a', time: Date.now() });
    let fixtureFailure: unknown;
    runner.on('rpc-request', async (data, ack) => {
        try {
            const params = JSON.parse(data.params);
            if (data.method === 'machine-a:spawn-happy-session') {
                const session = (await api('/cli/sessions', ma.token, { id: params.reservedSessionId, adopt: true,
                    tag: 'spawn-' + params.reservedSessionId, metadata: { path: root, host: 'same-host', flavor: 'codex', machineId: 'machine-a' } })).session;
                ack(JSON.stringify({ type: 'success', sessionId: session.id }));
            } else ack(JSON.stringify({ success: true }));
        } catch (error) { fixtureFailure = error; ack(JSON.stringify({ type: 'error', errorMessage: 'protocol fixture failed' })); }
    });
    runner.emit('rpc-register', { method: 'machine-a:spawn-happy-session' }); await new Promise<void>(yes => runner.emit('ping', yes));
    gateway!.store.bind({ kind: 'task', id: 'task-b', ownerId: b.identity.id, spaceId: sid, machineId: 'machine-a' });
    const taskRequest = randomUUID(), intent = gateway!.store.beginIntent({ requestKey: taskRequest, ownerId: b.identity.id, spaceId: sid,
        taskId: 'task-b', machineId: 'machine-a', operation: 'spawn', fingerprint: fingerprint({}), expiresAt: Date.now() + 60_000 });
    const receipt = await gateway!.native.write('/api/machines/machine-a/spawn', { requestId: intent.id, directory: root, agent: 'codex' });
    if (fixtureFailure) throw fixtureFailure;
    const sb = receipt.sessionId;
    assert.equal(gateway!.store.object('session', sb)?.ownerId, b.identity.id);
    const sa = (await api('/cli/sessions', ma.token, { tag: 'native-a', metadata: { path: root, host: 'same-host', flavor: 'claude', machineId: 'machine-a' } })).session.id;
    const sc = (await api('/cli/sessions', mc.token, { tag: 'native-c', metadata: { path: root, host: 'same-host', flavor: 'codex', machineId: 'machine-c' } })).session.id;
    assert.equal((await api(`/api/sessions/${sb}`, bj)).session.id, sb);
    await api(`/api/sessions/${sb}`, aj, undefined, 'GET', 404); await api(`/api/sessions/${sb}`, cj, undefined, 'GET', 404);
    assert.deepEqual((await api('/api/sessions?limit=1', bj)).sessions.map((s: any) => s.id), [sb]);
    assert.deepEqual((await api('/api/sessions', aj)).sessions.map((s: any) => s.id), [sa]);
    await api('/cli/sessions', ma.token, { id: sc, tag: 'steal', metadata: { path: root, host: 'same-host', flavor: 'codex' } }, 'POST', 404);
    await api(`/api/machines/machine-a/spawn-requests/${taskRequest}`, aj, undefined, 'GET', 404);
    assert.equal((await api(`/api/machines/machine-a/spawn-requests/${taskRequest}`, bj)).sessionId, sb);
    const mj = await auth(ma.token);
    assert.deepEqual(new Set((await api('/api/sessions', mj)).sessions.map((s: any) => s.id)), new Set([sa, sb]));
    await api('/api/machines', mj, undefined, 'GET', 403);
    check('A machine executes B intent; receipt/adopt bind before spawn ack; user APIs and pagination isolate owners');

    const spawnBody = { directory: root, agent: 'codex' };
    const generated = await api('/api/machines/machine-a/spawn', aj, spawnBody);
    assert.equal(typeof generated.requestId, 'string');
    const explicit = { ...spawnBody, requestId: randomUUID() };
    const created = await api('/api/machines/machine-a/spawn', aj, explicit);
    const repeated = await api('/api/machines/machine-a/spawn', aj, explicit);
    assert.equal(created.sessionId, repeated.sessionId); assert.equal(repeated.requestId, explicit.requestId);
    await api('/cli/sessions', ma.token, { tag: 'wrong-machine', metadata: { path: root, machineId: 'machine-c' } }, 'POST', 404);
    await api('/api/sessions?namespace=runweft', bj, undefined, 'GET', 400);
    check('public spawn generates scoped request IDs and identical retry keeps one native session; forged machine/namespace is rejected');

    const sameTag = (await api('/cli/sessions', mc.token, { tag: 'native-a', metadata: { path: root, host: 'same-host', flavor: 'codex', machineId: 'machine-c' } })).session.id;
    assert.notEqual(sameTag, sa);
    const attachment = (await api(`/api/sessions/${sa}/scratchlist/upload`, aj, { filename: 'owned.txt', content: Buffer.from('owned scratch file').toString('base64'), mimeType: 'text/plain' })).attachment;
    await api(`/api/sessions/${sa}/scratchlist`, aj, { text: 'owned', attachments: [attachment] });
    await api(`/api/sessions/${sb}/scratchlist`, bj, { text: 'forged reference', attachments: [attachment] }, 'POST', 400);
    await api(`/api/sessions/${sb}/scratchlist/attachments/${attachment.id}`, bj, undefined, 'GET', 404);
    check('matching tags stay machine-scoped; nested scratchlist attachment IDs cannot cross session ownership');

    const childSocket = await connect({ token: ma.token, sessionId: sb });
    childSocket.emit('message', { sid: sb, message: { role: 'agent', content: { type: 'text', text: 'owned-report' } }, localId: randomUUID() });
    await new Promise<void>(yes => childSocket.emit('ping', yes));
    assert.equal((await api(`/api/sessions/${sb}/messages`, bj)).messages.length, 1);
    await api(`/api/sessions/${sb}/messages`, aj, undefined, 'GET', 404);
    await api('/api/auth', '', { accessToken: rootToken }, 'POST', 401);
    const privateJWT = (await gateway!.native.write('/api/auth', { accessToken: gateway!.native.cliToken() })).token;
    await api('/api/sessions', privateJWT, undefined, 'GET', 401);
    await api('/api/storage/sqlite', bj, undefined, 'GET', 403);
    await api('/api/bind', bj, {}, 'POST', 403);
    await api('/cli/machines', b.token, {}, 'POST', 401);
    check('native messages stay private; root/HAPI JWT, bind/storage, and identity-as-machine bypasses fail');

    const content = Buffer.from('hello'), requestId = randomUUID(), reserve = { requestId, filename: 'input.txt', size: content.length, sha256: createHash('sha256').update(content).digest('hex') };
    const file = (await api('/api/artifacts', bj, reserve)).artifact;
    assert.equal(file.requestId, requestId);
    const upload = await fetch(base + `/api/artifacts/${file.id}/content`, { method: 'PUT', headers: { authorization: `Bearer ${bj}` }, body: content });
    assert.equal(upload.status, 200);
    const download = await fetch(base + `/api/artifacts/${file.id}/content`, { headers: { authorization: `Bearer ${bj}` } }); assert.deepEqual(Buffer.from(await download.arrayBuffer()), content);
    await api(`/api/artifacts/${file.id}`, aj, undefined, 'GET', 404);
    const differentScope = await auth(b.token, b.personalSpace.id); await api(`/api/artifacts/${file.id}`, differentScope, undefined, 'GET', 404);
    const afile = (await api('/api/artifacts', aj, reserve)).artifact; assert.notEqual(afile.id, file.id);
    assert.equal((await api('/api/artifacts/limits', bj)).usedBytes, content.length);
    await api(`/cli/artifacts/${file.id}`, ma.token, undefined, 'GET', 404);
    gateway!.store.grant(ma.id, file.id, 'read');
    const delivered = await fetch(base + `/cli/artifacts/${file.id}/content`, { headers: { authorization: `Bearer ${ma.token}` } }); assert.deepEqual(Buffer.from(await delivered.arrayBuffer()), content);
    await api('/cli/artifacts', ma.token, reserve, 'POST', 404);
    const outReq = randomUUID(); gateway!.files.reservations.permit({ machineId: 'machine-a', ownerId: b.identity.id, spaceId: sid, taskId: 'task-b', requestId: outReq, filename: 'report.txt' });
    const output = (await api('/cli/artifacts', ma.token, { ...reserve, requestId: outReq, filename: 'report.txt' })).artifact;
    assert.equal(gateway!.store.object('artifact', output.id)?.ownerId, b.identity.id);
    await api(`/api/artifacts/${output.id}`, aj, undefined, 'GET', 404);
    assert.equal((await api(`/api/artifacts/${output.id}`, bj)).artifact.id, output.id);
    check('file bytes, quotas and request IDs use native owner/space namespaces; explicit grants deliver cross-machine input/output');

    const lostRequest = randomUUID(), actor = await gateway!.authority.verify(bj);
    const pending = gateway!.files.reservations.reserve(actor, { ...reserve, requestId: lostRequest, filename: 'lost-response.txt' });
    const lost = await gateway!.native.write('/api/artifacts', pending.body, undefined, 'POST', fileNamespace(b.identity.id, sid));
    await gateway!.close(); gateway = undefined; await startGateway();
    assert.equal((await api(`/api/artifacts/requests/${lostRequest}`, bj)).artifact.id, lost.artifact.id);
    assert.equal((await api('/api/artifacts', bj, { ...reserve, requestId: lostRequest, filename: 'lost-response.txt' })).artifact.id, lost.artifact.id);
    assert.equal((await api(`/api/machines/machine-a/spawn-requests/${taskRequest}`, bj)).sessionId, sb);
    check('gateway restart recovers original file reservation and native spawn receipt without repeating execution');

    const nativeDb = new Database(join(hapiHome, 'hapi.db'));
    nativeDb.query('UPDATE artifacts SET created_at=1, published_at=1 WHERE id IN (?, ?)').run(afile.id, lost.artifact.id); nativeDb.close();
    const pruned = await api('/api/artifacts/prune', bj, { apply: true });
    assert(pruned.deleted.some((item: any) => item.id === lost.artifact.id)); assert(!pruned.candidates.some((item: any) => item.id === afile.id));
    assert.equal((await api(`/api/artifacts/${afile.id}`, aj)).artifact.state, 'reserved');
    await api('/api/artifacts/prune', mj, { apply: true }, 'POST', 403);
    check('native expiry cleanup deletes B files only, retains equally old A files, and denies machine pruning');

    const largeSize = 16 * 1024 * 1024, largeBytes = Buffer.alloc(largeSize), slowId = randomUUID();
    gateway!.files.reservations.permit({ machineId: 'machine-a', ownerId: b.identity.id, spaceId: sid, taskId: 'task-b', requestId: slowId, filename: 'stream.bin' });
    const large = (await api('/cli/artifacts', ma.token, { requestId: slowId, filename: 'stream.bin', size: largeSize,
        sha256: createHash('sha256').update(largeBytes).digest('hex') })).artifact;
    let sent = 0, cancelled = false;
    const source = new ReadableStream<Uint8Array>({ async pull(controller) {
        await Bun.sleep(100); if (cancelled) return;
        if (sent === largeSize) { controller.close(); return; }
        controller.enqueue(largeBytes.subarray(sent, sent + 256 * 1024)); sent += 256 * 1024;
    }, cancel() { cancelled = true; } });
    const uploadStarted = Date.now();
    const streamingUpload = fetch(base + `/cli/artifacts/${large.id}/content`, { method: 'PUT', headers: { authorization: `Bearer ${ma.token}` },
        body: source, signal: AbortSignal.timeout(10_000) }).then(async response => ({ status: response.status, body: await response.text() })).catch(() => ({ status: 0 }));
    const part = join(hapiHome, 'artifacts', createHash('sha256').update(fileNamespace(b.identity.id, sid)).digest('hex'), large.id + '.part');
    await eventually(async () => existsSync(part), 'native file upload did not start');
    gateway!.store.revokeGrant(ma.id, large.id);
    const rejected = await streamingUpload; assert.notEqual(rejected.status, 200); assert(Date.now() - uploadStarted < 5000);
    await eventually(async () => !existsSync(part), 'cancelled upload must release its native partial file');
    assert.equal((await api(`/api/artifacts/${large.id}`, bj)).artifact.state, 'reserved');
    gateway!.store.grant(ma.id, large.id, 'write'); gateway!.store.grant(ma.id, large.id, 'read');
    const retried = await fetch(base + `/cli/artifacts/${large.id}/content`, { method: 'PUT', headers: { authorization: `Bearer ${ma.token}` }, body: largeBytes });
    assert.equal(retried.status, 200);
    check('revoking a grant interrupts a progressing upload, native partial bytes are cleaned, and explicit same-object retry succeeds');

    const paused = await new Promise<import('node:http').IncomingMessage>((yes, no) => {
        const request = httpGet(base + `/cli/artifacts/${large.id}/content`, { headers: { authorization: `Bearer ${ma.token}` } }, response => { response.pause(); yes(response); });
        request.once('error', no);
    });
    assert.equal(paused.statusCode, 200); paused.on('error', () => {});
    gateway!.store.revokeGrant(ma.id, large.id);
    await Bun.sleep(1100);
    let received = 0, terminated = false;
    await new Promise<void>((yes, no) => {
        const timer = setTimeout(() => { paused.destroy(); no(new Error('revoked download did not close')); }, 3000);
        const done = () => { terminated = true; clearTimeout(timer); yes(); };
        paused.on('data', chunk => { received += chunk.length; }); paused.once('end', done); paused.once('close', done); paused.once('error', done); paused.resume();
        if (paused.destroyed) done();
    });
    assert(terminated); assert(received < largeSize, 'backpressured download must stop before delivering all bytes after revocation');
    check('revoking a grant terminates a backpressured download without delivering the remaining file');

    const replacement = createIdentityToken(); hub.rotate(b.identity, b.token, replacement);
    await api(`/api/sessions/${sb}`, bj, undefined, 'GET', 401);
    check('rotation rejects previously issued API JWTs');
    for (const path of ['hapi-out.log', 'hapi-err.log']) {
        const log = readFileSync(join(root, path), 'utf8');
        for (const secret of [rootToken, a.token, b.token, c.token, ma.token, mc.token]) assert(!log.includes(secret), 'credentials must not enter service logs');
    }
    check('service logs contain no root, identity or machine credentials');

    evidence.success = true;
} catch (error) { evidence.error = error instanceof Error ? error.message : String(error); throw error; }
finally {
    const resources: Array<() => void | Promise<void>> = [
        () => removeSmokeSecrets([join(root, 'hapi', 'settings.json')], processes),
        async () => { if (child) await stopSmokeProcess(child); }, () => hub?.close(), () => gateway?.close(),
        ...sockets.map(socket => () => { socket.disconnect(); }),
    ];
    try { await closeSmoke(resources); } catch (error) { evidence.success = false; evidence.cleanupErrors = error instanceof AggregateError ? error.errors.map(String) : [String(error)]; process.exitCode = 1; }
    writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2)); console.log('Evidence: ' + root);
}
