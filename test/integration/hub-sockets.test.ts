import { createTestIdentity } from '../identity-fixture';
import { test, expect } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { io } from 'socket.io-client';
import { fixture } from '../helpers';
import { createAccessGateway } from '../../src/hub/access/http';

test('default/unknown socket namespaces and foreign upgrades fail without contacting a private HAPI', async () => {
    const root = fixture('socket-boundary');
    const gateway = await createAccessGateway({ host: '127.0.0.1', port: 0, target: 'http://127.0.0.1:1',
        rootToken: 'test-root', key: randomBytes(32), statePath: join(root, 'state.sqlite') });
    const port = (gateway.server.address() as { port: number }).port, base = `http://127.0.0.1:${port}`;
    try {
        for (const namespace of ['/', '/not-registered', '/cli', '/terminal']) {
            const socket = io(base + namespace, { auth: { token: 'test-root', machineId: 'some-machine' }, transports: ['websocket'], reconnection: false, timeout: 1000 });
            try {
                const result = await new Promise<string>((resolve, reject) => {
                    socket.once('connect', () => reject(new Error('Unauthorized socket connected')));
                    socket.once('connect_error', error => resolve(error.message));
                });
                expect(result).not.toContain('test-root'); expect(result.length).toBeGreaterThan(0);
            } finally { socket.disconnect(); }
        }
        const response = await fetch(base + '/legacy/socket', { headers: { upgrade: 'websocket', connection: 'Upgrade', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==', 'sec-websocket-version': '13' } });
        expect(response.status).toBe(403);
    } finally { await gateway.close(); rmSync(root, { recursive: true, force: true }); }
});

test('normal Hub shutdown reconnects a live machine without replay; credential rotation still disconnects and rejects it', async () => {
    const { createServer } = await import('node:http');
    const { Server } = await import('socket.io');
    const { createResourceGateway } = await import('../../src/hub/resources/gateway');
    const { HubStore } = await import('../../src/hub/store');
    const { RPC_METHODS } = await import('../../hapi/shared/src/rpcMethods');
    const { closeSmoke } = await import('../lifecycle');
    const root = fixture('socket-restart'), path = join(root, 'state.sqlite'), key = randomBytes(32);
    const cleanups: Array<() => void | Promise<void>> = [() => rmSync(root, { recursive: true, force: true })];
    const server = createServer(), upstream = new Server(server); let nativeSocket: import('socket.io').Socket | undefined;
    upstream.of('/cli').on('connection', socket => { nativeSocket = socket; });
    cleanups.push(() => new Promise<void>(resolve => upstream.close(() => resolve())));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const target = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    let gateway: Awaited<ReturnType<typeof createResourceGateway>> | undefined;
    cleanups.push(() => gateway?.close());
    try {
        gateway = await createResourceGateway({ host: '127.0.0.1', port: 0, target, statePath: path, rootToken: 'private-test-root', key });
        const port = (gateway.server.address() as { port: number }).port;
        const hub = new HubStore(path); cleanups.push(() => hub.close());
        const user = createTestIdentity(hub, 'socket owner'), actor = gateway.store.authenticate(user.token, user.personalSpace.id);
        const token = `rw_mc_${randomBytes(32).toString('base64url')}`;
        const machine = gateway.resources.store.enroll(actor, { requestId: crypto.randomUUID(), token });
        const socket = io(`http://127.0.0.1:${port}/cli`, { auth: { token, machineId: machine.machineId },
            transports: ['websocket'], reconnection: true, reconnectionDelay: 10, reconnectionDelayMax: 50, timeout: 1000, autoConnect: false });
        cleanups.push(() => { socket.disconnect(); });
        const event = (name: string) => new Promise<any>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error(`Socket event timeout: ${name}`)), 5000);
            socket.once(name, (...args) => { clearTimeout(timeout); resolve(args[0]); });
        });
        const requests: string[] = []; let connections = 0;
        socket.on('connect', () => connections++);
        socket.on('rpc-request', (data, reply) => { requests.push(JSON.parse(data.params).requestId); reply(JSON.stringify({ requestId: requests.at(-1), ok: true })); });
        const ready = event('connect'); socket.connect(); await ready;
        const rpc = (requestId: string) => new Promise<any>((resolve, reject) => {
            nativeSocket!.timeout(2000).emit('rpc-request', { method: `${machine.machineId}:${RPC_METHODS.AgentAvailability}`, params: JSON.stringify({ requestId }) },
                (error: Error | null, value: string) => error ? reject(error) : resolve(JSON.parse(value)));
        });
        expect(await rpc('fixed-receipt')).toEqual({ requestId: 'fixed-receipt', ok: true });
        const disconnected = event('disconnect'), reconnected = event('connect');
        await gateway.close(); expect(await disconnected).not.toBe('io server disconnect');
        gateway = await createResourceGateway({ host: '127.0.0.1', port, target, statePath: path, rootToken: 'private-test-root', key });
        await reconnected; expect(connections).toBe(2); expect(requests).toEqual(['fixed-receipt']);
        expect(await rpc('fresh-observation')).toEqual({ requestId: 'fresh-observation', ok: true });
        const revoked = event('disconnect');
        gateway.resources.store.replaceCredential(gateway.store.authenticate(user.token, user.personalSpace.id), machine.machineId,
            { expectedCredentialId: machine.credential.id, token: `rw_mc_${randomBytes(32).toString('base64url')}` });
        expect(await revoked).toBe('io server disconnect'); expect(socket.active).toBe(false);
        const stale = io(`http://127.0.0.1:${port}/cli`, { auth: { token, machineId: machine.machineId }, transports: ['websocket'], reconnection: false });
        cleanups.push(() => { stale.disconnect(); });
        await new Promise<void>((resolve, reject) => { stale.once('connect', () => reject(new Error('Old credential connected'))); stale.once('connect_error', () => resolve()); });
        expect(connections).toBe(2); expect(requests).toEqual(['fixed-receipt', 'fresh-observation']);
    } finally { await closeSmoke(cleanups); }
});
