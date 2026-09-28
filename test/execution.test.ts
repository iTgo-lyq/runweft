import { expect, test } from 'bun:test';
import { ExecutionClient } from '../src/execution';
import { HapiClient } from '../src/hapi';
import type { SpawnReceipt } from '../hapi/shared/src/apiTypes';

const input = () => ({ requestId: crypto.randomUUID(), directory: '/workspace', agent: 'codex' as const });

function serverFor(handler: (request: Request) => Response | Promise<Response>, capable = true) {
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: request => {
        const path = new URL(request.url).pathname;
        if (path === '/api/auth') {
            const payload = Buffer.from(JSON.stringify({ uid: 'test', ns: 'test' })).toString('base64url');
            return Response.json({ token: `e30.${payload}.test` });
        }
        if (!request.headers.has('authorization')) return new Response('', { status: 401 });
        if (path === '/health') return Response.json({ capabilities: capable ? { spawnReceipts: 1 } : {} });
        return handler(request);
    }});
    return { server, client: new ExecutionClient(new HapiClient(`http://127.0.0.1:${server.port}`, 'test')) };
}

test('a lost spawn response resolves to the original receipt without a second POST', async () => {
    let posts = 0, lookups = 0;
    let receipt: SpawnReceipt;
    const { server, client } = serverFor(async request => {
        if (request.method === 'POST') {
            posts++;
            const body = await request.json() as { requestId: string };
            const sessionId = crypto.randomUUID();
            receipt = { requestId: body.requestId, machineId: 'machine', sessionId, createdAt: Date.now(), response: { type: 'success', sessionId } };
            return Response.json({ error: 'Proxy lost upstream reply' }, { status: 502 });
        }
        lookups++;
        return Response.json(receipt!);
    });
    try {
        const result = await client.start('machine', input());
        expect(result).toEqual({ outcome: 'recorded', receipt: receipt! });
        expect(posts).toBe(1);
        expect(lookups).toBe(1);
    } finally { await server.stop(true); }
});

test('an absent or unavailable receipt remains unknown and preserves caller identity', async () => {
    for (const unavailable of [false, true]) {
        let posts = 0;
        const request = input();
        const { server, client } = serverFor(req => {
            if (req.method === 'POST') { posts++; return new Response('', { status: 502 }); }
            return Response.json({ error: 'Unavailable', code: unavailable ? 'hub_unavailable' : 'spawn_request_not_found' }, { status: unavailable ? 503 : 404 });
        });
        try {
            expect(await client.start('machine', request)).toMatchObject({ outcome: 'unknown', requestId: request.requestId, machineId: 'machine' });
            expect(posts).toBe(1);
        } finally { await server.stop(true); }
    }
});

test('conflicts and authorization errors retain server codes and are not retried', async () => {
    for (const [status, code] of [[409, 'spawn_request_conflict'], [403, 'access_denied']] as const) {
        let calls = 0;
        const { server, client } = serverFor(() => { calls++; return Response.json({ error: 'Rejected', code }, { status }); });
        try {
            await expect(client.start('machine', input())).rejects.toMatchObject({ status, code, message: 'Rejected' });
            expect(calls).toBe(1);
        } finally { await server.stop(true); }
    }
});

test('old Hub capability fails before dispatch and missing machine is distinct from missing receipt', async () => {
    let calls = 0;
    const { server, client } = serverFor(() => { calls++; return new Response('', { status: 404 }); }, false);
    try {
        await expect(client.start('machine', input())).rejects.toMatchObject({ code: 'execution_capability_missing' });
        expect(calls).toBe(0);
        await expect(client.lookupStart('missing', crypto.randomUUID())).rejects.toMatchObject({ status: 404, code: 'request_failed' });
    } finally { await server.stop(true); }
});

test('a mismatched receipt is never accepted as this request', async () => {
    let posts = 0;
    const { server, client } = serverFor(req => {
        if (req.method === 'POST') posts++;
        return Response.json({ requestId: crypto.randomUUID(), machineId: 'machine', sessionId: crypto.randomUUID(), createdAt: Date.now(), response: null });
    });
    try {
        expect(await client.start('machine', input())).toMatchObject({ outcome: 'unknown', error: { code: 'invalid_hapi_response' } });
        expect(posts).toBe(1);
    } finally { await server.stop(true); }
});
