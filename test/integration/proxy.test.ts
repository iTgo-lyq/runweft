import { expect, test } from 'bun:test';
import type { AddressInfo } from 'node:net';
import { createGateway, jsonResponse } from '../../src/proxy';

test('gateway preserves HTTP, streaming SSE, WebSocket and local routes', async () => {
    const upstream = Bun.serve({
        hostname: '127.0.0.1', port: 0,
        fetch(request, server) {
            if (new URL(request.url).pathname === '/socket') {
                if (server.upgrade(request)) return;
                return new Response('upgrade required', { status: 400 });
            }
            if (new URL(request.url).pathname === '/events') {
                const stream = new ReadableStream({
                    start(controller) {
                        controller.enqueue(new TextEncoder().encode('data: first\n\n'));
                        setTimeout(() => { controller.enqueue(new TextEncoder().encode('data: second\n\n')); controller.close(); }, 30);
                    },
                });
                return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
            }
            return Response.json({ authorization: request.headers.get('authorization') });
        },
        websocket: { message(socket, message) { socket.send(message); } },
    });
    const gateway = await createGateway({
        host: '127.0.0.1', port: 0, target: `http://127.0.0.1:${upstream.port}`,
        async handle(request, response) {
            if (request.url !== '/own') return false;
            jsonResponse(response, 200, { own: true }); return true;
        },
    });
    const port = (gateway.server.address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}`;
    try {
        expect(await (await fetch(`${base}/own`)).json()).toEqual({ own: true });
        expect(await (await fetch(`${base}/upstream`, { headers: { authorization: 'Bearer fixture' } })).json()).toEqual({ authorization: 'Bearer fixture' });
        const events = await fetch(`${base}/events`);
        expect(events.headers.get('content-type')).toBe('text/event-stream');
        expect(await events.text()).toBe('data: first\n\ndata: second\n\n');
        const echoed = await new Promise<string>((resolve, reject) => {
            const socket = new WebSocket(`ws://127.0.0.1:${port}/socket`);
            const timeout = setTimeout(() => { socket.close(); reject(new Error('WebSocket echo timed out')); }, 2000);
            socket.onopen = () => socket.send('through-proxy');
            socket.onerror = () => { clearTimeout(timeout); reject(new Error('WebSocket failed')); };
            socket.onmessage = event => { clearTimeout(timeout); socket.close(); resolve(String(event.data)); };
        });
        expect(echoed).toBe('through-proxy');
    } finally {
        await gateway.close();
        await upstream.stop(true);
    }
});
