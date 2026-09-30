import { expect, test } from 'bun:test';
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { Server } from 'socket.io';
import { io, type Socket } from 'socket.io-client';
import { SignJWT } from 'jose';
import { createResourceGateway } from '../src/hub/resources/gateway';
import { HubStore } from '../src/hub/store';
import { readJson } from '../src/hub/access/transport';
import { jsonResponse } from '../src/proxy';
import { fixture } from './helpers';
import { resourceInspection } from './resources-fixture';

test('actual outgoing native RPC rechecks resource governance after HTTP preflight and receipt allocation', async () => {
    const home = fixture('resource-dispatch'), statePath = join(home, 'state.sqlite'), key = randomBytes(32);
    const identities = new HubStore(statePath), a = identities.createIdentity('machine owner'), sid = a.personalSpace.id;
    const nativeToken = await new SignJWT({ uid: 1, ns: 'runweft' }).setProtectedHeader({ alg: 'HS256' }).sign(key);
    const receipts = new Map<string, object>();
    let beforeRpc = () => {}, nativeSocket: any, down: Socket | undefined, nativeCount = 0, machineId = '';
    const server = createServer((req, res) => {
        void (async () => {
            const path = req.url!;
            if (path === '/api/auth') { await readJson(req); return jsonResponse(res, 200, { token: nativeToken }); }
            const receipt = receipts.get(path); if (receipt) return jsonResponse(res, 200, receipt);
            if (path === `/api/machines/${machineId}/spawn`) {
                const body = await readJson(req), sessionId = randomUUID();
                const receipt = { machineId, sessionId, requestId: body.requestId };
                receipts.set(`/api/machines/${machineId}/spawn-requests/${body.requestId}`, receipt);
                beforeRpc();
                const reply = await nativeSocket.timeout(3000).emitWithAck('rpc-request', {
                    method: `${machineId}:spawn-happy-session`, params: JSON.stringify({ reservedSessionId: sessionId, agent: body.agent }),
                });
                const parsed = JSON.parse(reply);
                return jsonResponse(res, parsed.type === 'success' ? 200 : 409, parsed.type === 'success' ? receipt : { error: 'native dispatch denied' });
            }
            return jsonResponse(res, 404, { error: 'unknown' });
        })().catch(() => jsonResponse(res, 500, { error: 'fixture failed' }));
    });
    const socketServer = new Server(server, { serveClient: false });
    socketServer.of('/cli').on('connection', socket => { nativeSocket = socket; socket.on('ping', ack => ack({ ok: true })); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const nativeUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    let gateway: Awaited<ReturnType<typeof createResourceGateway>> | undefined;
    try {
        gateway = await createResourceGateway({ host: '127.0.0.1', port: 0, target: nativeUrl, rootToken: 'root-fixture', statePath, key });
        const resources = gateway.resources.store, actor = gateway.store.authenticate(a.token, sid);
        const token = `rw_mc_${randomBytes(32).toString('base64url')}`;
        machineId = resources.enroll(actor, { requestId: randomUUID(), token }).machineId;
        resources.associate(actor, machineId, sid, true);
        const runtime = resources.registerRuntime(actor, { machineId, flavor: 'codex' }, resourceInspection('codex'));
        const url = `http://127.0.0.1:${(gateway.server.address() as { port: number }).port}`;
        down = io(url + '/cli', { auth: { token, machineId }, transports: ['websocket'], forceNew: true, reconnection: false });
        down.on('rpc-request', (_data, ack) => { nativeCount++; ack(JSON.stringify({ type: 'success' })); });
        await new Promise<void>((resolve, reject) => { down!.once('connect', resolve); down!.once('connect_error', reject); });
        await down.timeout(2000).emitWithAck('ping');
        const jwt = (await gateway.authority.exchange(a.token, sid)).token;
        const spawn = () => fetch(url + `/api/machines/${machineId}/spawn`, { method: 'POST', headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
            body: JSON.stringify({ directory: home, agent: 'codex' }) });
        expect((await spawn()).status).toBe(200); expect(nativeCount).toBe(1);
        beforeRpc = () => { resources.block(actor, sid, 'runtime', runtime.id, true); };
        const denied = await spawn(); expect(denied.status).toBe(409);
        expect(nativeCount).toBe(1); // The second payload never reached the external Runner socket.
        expect(gateway.store.list(actor, 'session')).toHaveLength(2); // Even the denied preallocated row has trusted ownership.
    } finally {
        down?.disconnect(); await gateway?.close();
        await new Promise<void>(resolve => socketServer.close(() => resolve()));
        identities.close(); rmSync(home, { recursive: true, force: true });
    }
}, 10_000);
