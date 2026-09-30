import { test, expect } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { io } from 'socket.io-client';
import { fixture } from './helpers';
import { createAccessGateway } from '../src/hub/access/http';

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
