import { afterEach, expect, test } from 'bun:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { decodeJwt, SignJWT } from 'jose';
import { DelegationNativeClient } from '../../src/hub/delegation/native';
import { NativeTransport, fileNamespace } from '../../src/hub/access/transport';
import { createIdentityToken } from '../../src/hub/store';
import { setupHubResources } from './hub-resources-fixture';
import { resourceInspection } from './native-fixture';

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanups.splice(0).reverse()) await fn(); });
const write = (value: object) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
const secret = () => `rw_mc_${randomBytes(32).toString('base64url')}`;
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };

async function fixture() {
    const h = setupHubResources(cleanups), sid = h.a.personalSpace.id;
    const a = h.access.authenticate(h.a.token, sid), b = h.access.authenticate(h.b.token, sid);
    const tokenA = secret(), tokenB = secret();
    const target = h.store.enroll(a, { requestId: randomUUID(), token: tokenA });
    const source = h.store.enroll(b, { requestId: randomUUID(), token: tokenB });
    h.store.associate(a, target.machineId, sid, true); h.store.associate(b, source.machineId, sid, true);
    const runtime = h.store.registerRuntime(a, { machineId: target.machineId, flavor: 'codex' }, resourceInspection('codex'));
    h.store.share(a, runtime.id, sid, true);
    const taskId = randomUUID(), roundId = randomUUID();
    h.access.bind({ kind: 'task', id: taskId, ownerId: b.ownerId, spaceId: sid, machineId: target.machineId });
    const calls: { method: string; path: string; ns: string; body?: any }[] = [], receipts = new Map<string, any>(), artifacts = new Map<string, any>();
    const key = randomBytes(32); let gate: ((operationId: string) => Promise<void>) | undefined, check = (_mode: string) => {};
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === '/api/auth') {
            const body = await request.json() as any, ns = body.accessToken.slice('private-root:'.length);
            return Response.json({ token: await new SignJWT({ uid: 1, ns }).setProtectedHeader({ alg: 'HS256' }).sign(key) });
        }
        const ns = decodeJwt(request.headers.get('authorization')!.slice(7)).ns as string;
        const body = request.headers.get('content-type')?.includes('application/json') ? await request.json() : undefined;
        calls.push({ method: request.method, path: url.pathname, ns, body });
        if (url.pathname.endsWith('/spawn')) {
            const value = body as any;
            const receipt = { machineId: target.machineId, requestId: value.requestId, sessionId: randomUUID(), response: { type: 'success' } };
            receipts.set(value.requestId, receipt); return Response.json(receipt);
        }
        if (url.pathname.includes('/spawn-requests/')) return Response.json(receipts.get(url.pathname.split('/').at(-1)!) ?? {}, { status: receipts.has(url.pathname.split('/').at(-1)!) ? 200 : 404 });
        if (url.pathname === '/api/machines') return Response.json({ machines: [source, target, { machineId: 'unrelated' }].map(m => ({ id: m.machineId })) });
        if (url.pathname.startsWith('/api/artifacts/')) {
            const id = url.pathname.split('/').at(-1)!;
            const artifact = url.pathname.includes('/requests/') ? [...artifacts.values()].find(a => a.requestId === id && a.namespace === ns) : artifacts.get(id);
            return Response.json(artifact?.namespace === ns ? { artifact } : { error: 'missing' }, { status: artifact?.namespace === ns ? 200 : 404 });
        }
        if (url.pathname.endsWith('/artifacts')) {
            const value = body as any; await gate?.(value.operationId);
            return Response.json({ operation: { request: value, status: 'succeeded', files: [], retention: 'retained' } });
        }
        if (url.pathname.startsWith('/api/sessions/')) {
            const id = url.pathname.split('/')[3];
            if (url.pathname.endsWith('/resume')) return Response.json({ type: 'success', sessionId: id });
            return Response.json({ session: { id, metadata: { machineId: target.machineId } } });
        }
        return Response.json({ operation: { request: body }, source: { machineId: url.pathname.split('/')[3] } });
    } });
    cleanups.push(() => server.stop(true));
    const client = new DelegationNativeClient(h.store, new NativeTransport(server.url.origin, 'private-root'), {
        ownerId: b.ownerId, spaceId: sid, sourceMachineId: source.machineId,
        target: { runtimeId: runtime.id, machineId: target.machineId, flavor: 'codex' }, taskId, roundId, check: mode => check(mode),
    });
    const machine = h.access.authenticate(tokenA);
    function file(filename = 'input.txt', requestId = randomUUID(), sender = b, reference?: { reference: string; purpose: string }) {
        const request = { requestId, filename, size: 5, sha256: 'a'.repeat(64), ...(reference ? { reference } : {}) };
        const reserved = client.files.reserve(sender, request), id = randomUUID();
        const artifact = { id, namespace: fileNamespace(b.ownerId, sid), requestId: reserved.reservation.id, filename, size: 5, sha256: request.sha256, state: 'available' };
        artifacts.set(id, artifact); client.files.bind(sender, reserved.reservation.id, id);
        return { id, requestId, artifact, reservation: reserved.reservation, name: filename, size: 5, sha256: request.sha256 };
    }
    return { ...h, identityA: h.a, identityB: h.b, a, b, sid, target, source, runtime, taskId, roundId, client, calls, file, machine, tokenA,
        gate(fn?: (operationId: string) => Promise<void>) { gate = fn; }, policy(fn: typeof check) { check = fn; } };
}

test('private bridge scopes machines, fixes target/runtime and allocates one owned session for one request', async () => {
    const h = await fixture(), prefix = `/api/machines/${h.target.machineId}`, requestId = randomUUID();
    const command = { directory: h.home, agent: 'codex', requestId };
    const receipt = await h.client.request(prefix + '/spawn', write(command));
    expect(receipt.requestId).toBe(requestId);
    expect(h.access.object('session', receipt.sessionId)).toMatchObject({ ownerId: h.b.ownerId, spaceId: h.sid, taskId: h.taskId, machineId: h.target.machineId });
    expect(h.access.can(h.a, 'session', receipt.sessionId)).toBe(false);
    expect(h.calls.find(c => c.path.endsWith('/spawn'))!.body.disabledMcpServers).toEqual(['runweft']);
    expect(await h.client.request(prefix + '/spawn', write(command))).toEqual(receipt);
    expect(h.calls.filter(c => c.path.endsWith('/spawn'))).toHaveLength(1);
    await expect(h.client.request(prefix + '/spawn', write({ ...command, directory: '/different' }))).rejects.toMatchObject({ code: 'execution_binding_conflict' });
    expect((await h.client.request('/api/machines')).machines).toHaveLength(2);
    await h.client.request(`/api/machines/${h.source.machineId}/workspaces`, write({ action: 'resolve', cwd: h.home }));
    await expect(h.client.request('/api/machines/foreign/workspaces', write({ action: 'resolve', cwd: h.home }))).rejects.toThrow();
    await expect(h.client.request(prefix + '/restart-runner', write({}))).rejects.toMatchObject({ code: 'native_route_unavailable' });
    h.store.share(h.a, h.runtime.id, h.sid, false);
    await expect(h.client.request(prefix + '/workspaces', write({ action: 'resolve', cwd: h.home }))).rejects.toMatchObject({ code: 'runtime_private' });
});

test('background identity follows stable owner across rotation; only exact task observation/stop survives lost membership', async () => {
    const h = await fixture(), receipt = await h.client.request(`/api/machines/${h.target.machineId}/spawn`, write({ directory: h.home, agent: 'codex', requestId: randomUUID() }));
    h.hub.rotate(h.identityB.identity, h.identityB.token, createIdentityToken());
    await h.client.request(`/api/machines/${h.source.machineId}/workspaces`, write({ action: 'resolve', cwd: h.home }));
    h.hub.changeMember(h.a.ownerId, h.sid, h.b.ownerId, null);
    await expect(h.client.request(`/api/sessions/${receipt.sessionId}/messages`, write({ text: 'new work' }))).rejects.toThrow();
    expect((await h.client.request(`/api/sessions/${receipt.sessionId}`)).session.id).toBe(receipt.sessionId);
    await h.client.request(`/api/sessions/${receipt.sessionId}/archive`, { method: 'POST' });
    await expect(h.client.request('/api/sessions/foreign')).rejects.toThrow();
    await expect(h.client.request(`/api/machines/${h.source.machineId}/workspaces`, write({ action: 'resolve', cwd: h.home }))).rejects.toThrow();
});

test('membership removal permanently clears transfer grants, including after the owner rejoins', async () => {
    const h = await fixture(), file = h.file();
    h.access.grant(h.machine.id, file.id, 'read', 'input:pending-transfer');
    h.hub.changeMember(h.a.ownerId, h.sid, h.b.ownerId, null);
    expect(h.access.db.query('SELECT * FROM hub_execution_grants WHERE objectId=?').all(file.id)).toHaveLength(0);
    h.hub.acceptInvitation(h.b.ownerId, h.hub.invite(h.a.ownerId, h.sid, 'member').token);
    expect(h.access.can(h.machine, 'artifact', file.id)).toBe(false);
});

test('parallel materializations share read authority until their own native completion, without write permission', async () => {
    const h = await fixture(), file = h.file(), first = deferred(), second = deferred();
    const oneId = randomUUID(), twoId = randomUUID(), oneEntered = deferred(), twoEntered = deferred();
    h.gate(operationId => {
        if (operationId === oneId) { oneEntered.resolve(); return first.promise; }
        if (operationId === twoId) { twoEntered.resolve(); return second.promise; }
        throw new Error('Unexpected materialization operation');
    });
    const materialize = (operationId: string) => h.client.request(`/api/machines/${h.target.machineId}/artifacts`, write({ action: 'materialize', operationId,
        files: [{ artifactId: file.id, name: file.name, size: file.size, sha256: file.sha256 }] }));
    // The second operation arrives first; completion must stay bound to its own ID.
    const two = materialize(twoId); await twoEntered.promise;
    const one = materialize(oneId);
    try {
        await oneEntered.promise;
        expect(h.access.can(h.machine, 'artifact', file.id)).toBe(true);
        expect(h.access.can(h.machine, 'artifact', file.id, 'write')).toBe(false);
        first.resolve(); await one; expect(h.access.can(h.machine, 'artifact', file.id)).toBe(true);
        second.resolve(); await two; expect(h.access.can(h.machine, 'artifact', file.id)).toBe(false);
    } finally {
        first.resolve(); second.resolve();
        await Promise.allSettled([one, two]);
    }
});

test('Runner publication maps to caller namespace, can be recovered by request and releases only its output grants', async () => {
    const h = await fixture(), requestId = randomUUID(), reference = { reference: `runweft:output:${h.taskId}`, purpose: 'output' };
    const delivery = { action: 'deliver', operationId: randomUUID(), captureOperationId: randomUUID(), files: [{ name: 'result.txt', requestId, reference }] };
    await h.client.request(`/api/machines/${h.target.machineId}/artifacts`, write(delivery));
    const input = { requestId, filename: 'result.txt', size: 5, sha256: 'a'.repeat(64), reference };
    const reservation = h.client.files.reserve(h.machine, input);
    expect(reservation.reservation.ownerId).toBe(h.b.ownerId);
    expect(reservation.reservation.taskId).toBe(h.taskId);
    const output = h.file('result.txt', requestId, h.machine, reference);
    expect(h.access.can(h.machine, 'artifact', output.id, 'write')).toBe(true);
    expect(h.access.can(h.a, 'artifact', output.id)).toBe(false);
    const recovered = await h.client.request(`/api/artifacts/requests/${requestId}`);
    expect(recovered.artifact).toMatchObject({ id: output.id, requestId });
    expect(h.calls.at(-1)!.ns).toBe(fileNamespace(h.b.ownerId, h.sid));
    const next = secret();
    h.store.replaceCredential(h.a, h.target.machineId, { expectedCredentialId: h.machine.id, token: next });
    const replacement = h.access.authenticate(next);
    expect(h.access.can(replacement, 'artifact', output.id)).toBe(false);
    await h.client.request(`/api/machines/${h.target.machineId}/artifacts`, write(delivery));
    expect(h.access.can(replacement, 'artifact', output.id, 'write')).toBe(true);
    h.client.releaseOutputs([requestId]);
    expect(h.access.can(replacement, 'artifact', output.id, 'read')).toBe(false);
    expect(h.access.can(replacement, 'artifact', output.id, 'write')).toBe(false);
    h.client.files.reserve(h.b, input);
    await expect(h.client.request(`/api/artifacts/requests/${requestId}`)).rejects.toMatchObject({ code: 'file_reservation_conflict' });
});
