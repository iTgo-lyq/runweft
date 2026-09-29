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

test('query reads paginated native facts for only the selected input, without treating ready or invoked as success', async () => {
    const observation = (localId: string, phase: string) => ({ type: 'execution', version: 1, runtime: 'codex',
        executionId: 'codex:thread:turn', inputLocalIds: [localId], phase, source: 'native', nativeSessionId: 'thread', nativeTurnId: 'turn' });
    const message = (id: string, seq: number, content: unknown, localId: string | null = null) => ({ id, seq, content, localId, createdAt: seq, invokedAt: seq, scheduledAt: null });
    const event = (data: unknown) => ({ role: 'agent', content: { type: 'event', data } });
    let pages = 0;
    const { server, client } = serverFor(request => {
        const url = new URL(request.url);
        if (url.pathname === '/api/sessions/session') return Response.json({ session: { id: 'session', metadata: { capabilities: { execution: 1 } }, agentState: { requests: { approval: {} } } } });
        if (url.pathname.endsWith('/queued-state')) return Response.json({ queuedLocalIds: [], indeterminateLocalIds: [], invokedLocalMessages: [{ localId: 'input', invokedAt: 1 }] });
        pages++;
        const before = url.searchParams.has('beforeSeq');
        return Response.json({ messages: before ? [
            message('input-row', 1, { role: 'user', content: { type: 'text', text: 'task' } }, 'input'),
            message('accepted', 2, event(observation('input', 'accepted'))),
        ] : [
            message('unrelated', 3, event(observation('another-input', 'completed'))),
            message('output', 4, { role: 'agent', content: { type: 'codex', data: { type: 'message', message: 'Native reply' } } }, 'codex:thread:turn:item:agent_message'),
            message('ready', 5, event({ type: 'ready' })),
        ], page: { hasMore: !before, nextBeforeAt: before ? 1 : 3, nextBeforeSeq: before ? 1 : 3 } });
    });
    try {
        const result = await client.query('session', 'input');
        expect(pages).toBe(2);
        expect(result.facts.map(f => f.observation.phase)).toEqual(['accepted']);
        expect(result.inputMessageId).toBe('input-row');
        expect(result.output).toEqual([{ messageId: 'output', text: 'Native reply' }]);
        expect(result.permissions).toHaveProperty('approval');
    } finally { await server.stop(true); }
});

test('a lost input response is not resent and a targeted interrupt never falls back to abort', async () => {
    const calls: string[] = [];
    const { server, client } = serverFor(async request => {
        const path = new URL(request.url).pathname;
        calls.push(`${request.method} ${path}`);
        if (path === '/api/sessions/session') return Response.json({ session: { id: 'session', metadata: { capabilities: { execution: 1 } } } });
        if (path.endsWith('/messages')) return new Response('', { status: 502 });
        if (path.endsWith('/execution/interrupt')) {
            expect(await request.json()).toEqual({ inputLocalId: 'input', executionId: 'old' });
            return Response.json({ status: 'target_mismatch', executionId: 'new', inputLocalIds: ['new-input'] });
        }
        throw new Error(`Unexpected ${path}`);
    });
    try {
        expect(await client.send('session', { text: 'task', localId: 'input' })).toMatchObject({ outcome: 'unknown', localId: 'input' });
        expect(await client.interrupt('session', 'input', 'old')).toMatchObject({ status: 'target_mismatch' });
        expect(calls.filter(c => c.startsWith('POST'))).toEqual(['POST /api/sessions/session/messages', 'POST /api/sessions/session/execution/interrupt']);
    } finally { await server.stop(true); }
});

test('runtime readiness is distinct from a launch receipt and timeout never starts another session', async () => {
    let reads = 0;
    const { server, client } = serverFor(request => {
        expect(request.method).toBe('GET');
        reads++;
        return Response.json({ session: { id: 'session', active: true, metadata: { capabilities: reads > 1 ? { execution: 1 } : {} } } });
    });
    try {
        await expect(client.waitUntilReady('session', 0)).rejects.toMatchObject({ code: 'execution_not_ready' });
        expect((await client.waitUntilReady('session')).id).toBe('session');
        expect(reads).toBe(2);
    } finally { await server.stop(true); }
});

test('resume returns both native identities and uses the actual returned HAPI session', async () => {
    const calls: string[] = [];
    const { server, client } = serverFor(async request => {
        const path = new URL(request.url).pathname; calls.push(`${request.method} ${path}`);
        if (request.method === 'POST') { expect(await request.json()).toEqual({}); return Response.json({ type: 'success', sessionId: 'new' }); }
        const id = path.endsWith('/old') ? 'old' : 'new';
        return Response.json({ session: { id, active: id === 'new', metadata: { flavor: 'codex', codexSessionId: `native-${id}`, capabilities: { execution: 1 } } } });
    });
    try {
        expect(await client.resume('old')).toMatchObject({ outcome: 'resumed', previousSessionId: 'old', previousNativeSessionId: 'native-old', nativeSessionId: 'native-new', session: { id: 'new' } });
        expect(calls).toEqual(['GET /api/sessions/old', 'POST /api/sessions/old/resume', 'GET /api/sessions/new']);
    } finally { await server.stop(true); }
});

test('only confirmed native absence permits reconstruction; unavailable or lost resume replies never respawn', async () => {
    for (const [status, code] of [[409, 'native_session_missing'], [503, 'no_machine_online'], [401, 'authentication_failed'], [500, 'resume_failed']] as const) {
        let posts = 0;
        const { server, client } = serverFor(request => {
            if (request.method === 'GET') return Response.json({ session: { id: 'session', metadata: { flavor: 'claude', claudeSessionId: 'native' } } });
            posts++; expect(new URL(request.url).pathname).toBe('/api/sessions/session/resume');
            return Response.json({ error: 'native response', code }, { status });
        });
        try {
            if (code === 'native_session_missing') expect(await client.resume('session')).toMatchObject({ outcome: 'missing', previousNativeSessionId: 'native' });
            else if (code === 'resume_failed') expect(await client.resume('session')).toMatchObject({ outcome: 'unknown', sessionId: 'session' });
            else await expect(client.resume('session')).rejects.toMatchObject({ status, code });
            expect(posts).toBe(1);
        } finally { await server.stop(true); }
    }
});

test('stop requires HAPI archived and inactive facts, even after a lost response', async () => {
    for (const stopped of [true, false]) {
        let posts = 0;
        const { server, client } = serverFor(request => {
            if (request.method === 'POST') { posts++; return new Response('', { status: 502 }); }
            return Response.json({ session: { id: 'session', active: !stopped, metadata: { lifecycleState: stopped ? 'archived' : 'running' } } });
        });
        try { expect((await client.stop('session')).outcome).toBe(stopped ? 'stopped' : 'unknown'); expect(posts).toBe(1); }
        finally { await server.stop(true); }
    }
});

test('permission responses preserve native request identity and do not override default permissions', async () => {
    const { server, client } = serverFor(async request => {
        expect(new URL(request.url).pathname).toBe('/api/sessions/session/permissions/native-request/approve');
        expect(await request.json()).toEqual({ decision: 'approved', answers: { question: ['answer'] } });
        return Response.json({ error: 'Request already resolved' }, { status: 409 });
    });
    try { await expect(client.respondPermission('session', 'native-request', 'approved', { question: ['answer'] })).rejects.toMatchObject({ status: 409 }); }
    finally { await server.stop(true); }
});

test('MCP filtering fails before dispatch to a Hub that would drop the new option', async () => {
    let dispatched = false;
    const { server, client } = serverFor(() => { dispatched = true; return new Response('', { status: 500 }); });
    try {
        await expect(client.start('machine', { ...input(), disabledMcpServers: ['runweft'] })).rejects.toMatchObject({ code: 'execution_capability_missing' });
        expect(dispatched).toBe(false);
    } finally { await server.stop(true); }
});
