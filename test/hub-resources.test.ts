import { afterEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SignJWT } from 'jose';
import type { Machine } from '../hapi/shared/src/schemas';
import { AccessStore } from '../src/hub/access/store';
import { createResourceGateway } from '../src/hub/resources/gateway';
import { HubResourceStore } from '../src/hub/resources/store';
import { HubStore, createIdentityToken } from '../src/hub/store';
import { STATE_SCHEMA_VERSION } from '../src/state';
import { fixture } from './helpers';

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanups.splice(0).reverse()) await fn(); });
const machineToken = () => `rw_mc_${randomBytes(32).toString('base64url')}`;
const enrollmentInput = () => ({ requestId: randomUUID(), token: machineToken() });
function setup() {
    const home = fixture('hub-resources'), path = join(home, 'state.sqlite');
    cleanups.push(() => rmSync(home, { recursive: true, force: true }));
    const hub = new HubStore(path), access = new AccessStore(path), other = new AccessStore(path);
    cleanups.push(() => { other.close(); access.close(); hub.close(); });
    const a = hub.createIdentity('owner'), b = hub.createIdentity('member'), c = hub.createIdentity('unrelated');
    const invite = hub.invite(a.identity.id, a.personalSpace.id, 'admin'); hub.acceptInvitation(b.identity.id, invite.token);
    return { home, path, hub, access, other, a, b, c, store: new HubResourceStore(access), second: new HubResourceStore(other),
        actor: access.authenticate(a.token), member: access.authenticate(b.token), unrelated: access.authenticate(c.token) };
}

test('enrollment is owner scoped, replay safe, durable, and never accepts an existing machine ID', () => {
    const h = setup(), input = enrollmentInput(), first = h.store.enroll(h.actor, input);
    expect(h.second.enroll(h.actor, input)).toEqual(first);
    expect(first.machineId).not.toBe(input.requestId);
    expect(h.access.authenticate(input.token)).toMatchObject({ kind: 'machine', ownerId: h.a.identity.id, machineId: first.machineId });
    expect(() => h.store.enroll(h.actor, { ...input, machineId: first.machineId })).toThrow();
    expect(() => h.store.enroll(h.member, { ...input, ownerId: h.a.identity.id })).toThrow();
    expect(() => h.store.enroll(h.actor, { ...input, name: 'changed' })).toThrow('不同参数');
    expect(() => h.second.enroll(h.member, input)).toThrow('凭据无法使用');
    expect(h.store.machines(h.member)).toHaveLength(0); // collision rolls back the new binding as well
    expect(h.access.list(h.member, 'machine')).toHaveLength(0);
    const another = h.store.enroll(h.member, { ...input, token: machineToken() });
    expect(another.machineId).not.toBe(first.machineId);
    expect(() => h.store.machine(h.unrelated, first.machineId)).toThrow();
    const reopen = new AccessStore(h.path);
    try { expect(new HubResourceStore(reopen).enrollment(h.actor, input.requestId)).toEqual(first); }
    finally { reopen.close(); }
    for (const suffix of ['', '-wal']) {
        const bytes = readFileSync(h.path + suffix);
        for (const secret of [input.token, h.a.token]) expect(bytes.includes(Buffer.from(secret))).toBe(false);
    }
    h.access.retire('machine', first.machineId);
    expect(() => h.second.enroll(h.actor, input)).toThrow('已被替换');
    expect(h.store.machines(h.actor)).toEqual([]);
});

test('credential replacement revokes all older machine credentials, preserves tasks, and never revives a revoked token', () => {
    const h = setup(), input = enrollmentInput(), original = h.store.enroll(h.actor, input), id = original.machineId;
    const extra = h.access.issueMachine(id);
    h.access.bind({ kind: 'task', id: 'existing-task', ownerId: h.b.identity.id, spaceId: h.a.personalSpace.id, machineId: id });
    const task = h.access.issueTask('existing-task');
    const value = { expectedCredentialId: original.credential.id, token: machineToken() };
    const next = h.store.replaceCredential(h.actor, id, value);
    expect(h.second.replaceCredential(h.actor, id, value)).toEqual(next); // lost response
    expect(() => h.other.authenticate(input.token)).toThrow();
    expect(() => h.other.authenticate(extra.token)).toThrow();
    expect(h.other.authenticate(task.token).kind).toBe('task');
    expect(h.other.authenticate(value.token).id).toBe(next.id);
    expect(() => h.second.enroll(h.actor, input)).toThrow('已被替换');
    expect(h.second.enrollment(h.actor, input.requestId)).toMatchObject({ machineId: id, originalCredentialCurrent: false, credential: next });
    expect(() => h.store.replaceCredential(h.actor, id, { expectedCredentialId: original.credential.id, token: machineToken() })).toThrow('已被替换');
    expect(() => h.store.replaceCredential(h.member, id, { expectedCredentialId: next.id, token: machineToken() })).toThrow();
    h.store.revokeCredential(h.actor, id);
    expect(() => h.other.authenticate(value.token)).toThrow();
    expect(() => h.store.replaceCredential(h.actor, id, value)).toThrow('已被替换');
    const replacement = { expectedCredentialId: next.id, token: machineToken() };
    const newest = h.store.replaceCredential(h.actor, id, replacement);
    expect(newest.status).toBe('active');
    expect(() => h.store.replaceCredential(h.actor, id, value)).toThrow();
    expect(() => h.store.replaceCredential(h.actor, id, { expectedCredentialId: newest.id, token: input.token })).toThrow('凭据无法使用');
    expect(h.other.authenticate(replacement.token).id).toBe(newest.id);
});

test('registration is separate from connection authority; association never grants control and removal does not revive on rejoin', () => {
    const h = setup(), input = enrollmentInput(), { machineId: id } = h.store.enroll(h.member, input), sid = h.a.personalSpace.id;
    h.store.associate(h.member, id, sid, true);
    expect(h.second.spaces(h.member, id)).toEqual([sid]);
    expect(h.access.can(h.actor, 'machine', id)).toBe(false); // even the space owner has no native control
    expect(() => h.store.register(h.actor, id, false)).toThrow();
    expect(() => h.store.associate(h.member, id, h.c.personalSpace.id, true)).toThrow();
    h.store.register(h.member, id, false);
    expect(h.access.object('machine', id)?.retiredAt).toBeNull();
    expect(h.other.authenticate(input.token).machineId).toBe(id);
    expect(h.second.register(h.member, id, true).machineId).toBe(id);
    h.hub.changeMember(h.a.identity.id, sid, h.b.identity.id, null);
    expect(h.second.spaces(h.member, id)).toEqual([]);
    const invitation = h.hub.invite(h.a.identity.id, sid, 'member'); h.hub.acceptInvitation(h.b.identity.id, invitation.token);
    expect(h.second.spaces(h.member, id)).toEqual([]);
    h.store.associate(h.member, id, sid, true);
    expect(h.second.spaces(h.member, id)).toEqual([sid]);
    h.hub.rotate(h.b.identity, h.b.token, createIdentityToken());
    expect(() => h.store.register(h.member, id, false)).toThrow();
});

test('separate processes serialize enrollment and credential CAS without duplicate machines or valid stale credentials', async () => {
    const h = setup(), input = enrollmentInput();
    const code = `import { AccessStore } from ${JSON.stringify(resolve('src/hub/access/store.ts'))};
        import { HubResourceStore } from ${JSON.stringify(resolve('src/hub/resources/store.ts'))};
        const s=new AccessStore(process.argv[1]), r=new HubResourceStore(s); const data=await Bun.stdin.json();
        try { const a=s.authenticate(data.identity); console.log(JSON.stringify(data.machineId
            ? r.replaceCredential(a,data.machineId,data.input) : r.enroll(a,data.input))); }
        catch(e) { console.log(JSON.stringify({code:e.code})); process.exitCode=2; } finally { s.close(); }`;
    async function run(payload: object) {
        const child = Bun.spawn([process.execPath, '-e', code, h.path], { stdin: new Blob([JSON.stringify(payload)]), stdout: 'pipe', stderr: 'pipe' });
        const [exit, output, errors] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        expect(errors).toBe(''); return { exit, value: JSON.parse(output) };
    }
    const enrollments = await Promise.all([run({ identity: h.a.token, input }), run({ identity: h.a.token, input })]);
    expect(enrollments[0]).toEqual(enrollments[1]); expect(enrollments[0].exit).toBe(0);
    expect(h.store.machines(h.actor)).toHaveLength(1);
    const { machineId, credential } = enrollments[0].value;
    const replacements = [machineToken(), machineToken()];
    const results = await Promise.all(replacements.map(token => run({ identity: h.a.token, machineId, input: { expectedCredentialId: credential.id, token } })));
    expect(results.map(r => r.exit).sort()).toEqual([0, 2]);
    for (let i = 0; i < results.length; i++) {
        if (results[i].exit === 0) expect(h.other.authenticate(replacements[i]).id).toBe(results[i].value.id);
        else { expect(results[i].value.code).toBe('machine_credential_replaced'); expect(() => h.other.authenticate(replacements[i])).toThrow(); }
    }
    expect(() => h.other.authenticate(input.token)).toThrow();
});

test('v10 migration preserves existing native bindings without automatically enrolling any legacy machine', () => {
    const h = setup(); h.access.bind({ kind: 'machine', id: 'legacy', ownerId: h.a.identity.id });
    const db = new Database(h.path);
    try {
        db.exec('DROP TABLE hub_machine_spaces; DROP TABLE hub_resource_machines; PRAGMA user_version=10;');
        const access = new AccessStore(h.path);
        try {
            expect(db.query('PRAGMA user_version').get()).toEqual({ user_version: STATE_SCHEMA_VERSION });
            expect(new HubResourceStore(access).machines(h.actor)).toEqual([]);
            expect(access.object('machine', 'legacy')?.ownerId).toBe(h.a.identity.id);
        } finally { access.close(); }
    } finally { db.close(); }
});

async function httpSetup() {
    const h = setup(), key = randomBytes(32), machines: Machine[] = [], calls: string[] = [];
    const nativeToken = await new SignJWT({ uid: 1, ns: 'runweft' }).setProtectedHeader({ alg: 'HS256' }).sign(key);
    let inventoryHook: (() => void | Promise<void>) | undefined;
    const native = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === '/api/auth') return Response.json({ token: nativeToken });
        expect(request.headers.get('authorization')).toBe(`Bearer ${nativeToken}`); calls.push(`${request.method} ${url.pathname}`);
        if (url.pathname === '/health') return Response.json({ capabilities: { machineInventory: 1 } });
        if (url.pathname === '/api/machines') { await inventoryHook?.(); return Response.json({ machines }); }
        const machine = machines.find(m => url.pathname === `/api/machines/${m.id}`);
        if (machine && request.method === 'PATCH') {
            const { displayName } = await request.json() as { displayName: string }; machine.metadata!.displayName = displayName;
            return Response.json({ ok: true });
        }
        return Response.json({ error: 'unknown' }, { status: 404 });
    } });
    cleanups.push(() => native.stop(true));
    const gateway = await createResourceGateway({ host: '127.0.0.1', port: 0, target: native.url.origin, key, statePath: h.path, rootToken: 'fixture-root' });
    cleanups.push(() => gateway.close());
    const url = `http://127.0.0.1:${(gateway.server.address() as { port: number }).port}`;
    const auth = async (identity: string, spaceId?: string) => (await gateway.authority.exchange(identity, spaceId)).token;
    async function request(path: string, token: string, method = 'GET', body?: unknown) {
        const response = await fetch(url + path, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
            ...(body ? { body: JSON.stringify(body) } : {}) });
        return { status: response.status, body: await response.json() as any };
    }
    return { ...h, gateway, url, auth, request, machines, calls, setInventoryHook(fn: typeof inventoryHook) { inventoryHook = fn; },
        connect(id: string) { machines.push({ id, namespace: 'runweft', seq: 1, createdAt: 1, updatedAt: 1, active: true, activeAt: 1,
            metadata: { host: '/private/host', platform: 'test', happyCliVersion: 'test' }, metadataVersion: 1, runnerState: { status: 'running' }, runnerStateVersion: 1 }); } };
}
const prefix = '/api/runweft/resources';

test('resource HTTP handles owner lifecycle, pending machines and native rename; strict bodies and credential kinds stay separate', async () => {
    const h = await httpSetup(), jwt = await h.auth(h.a.token), input = enrollmentInput();
    expect((await h.request('/api/runweft/health', '')).body.capabilities.hubResources).toBe(1);
    const first = await h.request(prefix + '/machines/enroll', jwt, 'POST', input);
    expect(first.status).toBe(200); const id = first.body.machineId, base = `${prefix}/machines/${id}`;
    expect(JSON.stringify(first.body)).not.toContain(input.token);
    expect((await h.request(`${prefix}/machines/enrollments/${input.requestId}`, jwt)).body).toEqual(first.body);
    expect((await h.request(prefix + '/machines', jwt)).body.machines).toEqual([expect.objectContaining({ id, connection: 'pending', registered: true })]);
    expect((await h.request(base, jwt, 'PATCH', { name: 'name' })).body.error.code).toBe('machine_not_connected');
    h.connect(id);
    expect((await h.request(base, jwt, 'PATCH', { name: 'renamed' })).body.machine.name).toBe('renamed');
    expect(h.machines[0].metadata!.displayName).toBe('renamed');
    expect((await h.request(base + `/spaces/${h.a.personalSpace.id}`, jwt, 'PUT', {})).status).toBe(200);
    expect((await h.request(base, jwt)).body.machine.spaceIds).toEqual([h.a.personalSpace.id]);
    expect((await h.request(base, jwt, 'DELETE', {})).body.machine.registered).toBe(false);
    expect((await h.request(base + '/register', jwt, 'POST', {})).body.machine.registered).toBe(true);
    const unknown = await h.auth(h.c.token), admin = await h.auth(h.b.token, h.a.personalSpace.id);
    for (const token of [unknown, admin]) {
        for (const [path, method, body] of [[base, 'GET'], [base, 'PATCH', { name: 'stolen' }], [base + '/credential', 'GET'], [base + '/credential', 'DELETE'],
            [base + `/spaces/${h.a.personalSpace.id}`, 'PUT', {}], [base + '/register', 'POST', {}]] as const) {
            expect((await h.request(path, token, method, body)).status).toBe(404);
        }
        expect((await h.request(prefix + '/machines', token)).body.machines).toEqual([]);
    }
    for (const token of [h.a.token, 'fixture-root', input.token]) expect((await h.request(base, token)).status).toBe(401);
    expect((await h.request(base, await h.auth(input.token))).status).toBe(403);
    expect((await h.request(base + '/register', jwt, 'POST', { ownerId: h.c.identity.id })).status).toBe(400);
    expect((await h.request(base + '?ownerId=x', jwt)).status).toBe(400);
    expect((await h.request(base, jwt, 'PATCH', { name: 'x'.repeat(17_000) })).status).toBe(413);
    const nextToken = machineToken();
    const rotated = await h.request(base + '/credential', jwt, 'PUT', { expectedCredentialId: first.body.credential.id, token: nextToken });
    expect(rotated.status).toBe(200);
    expect((await h.request(prefix + '/machines/enroll', jwt, 'POST', input)).body.error.code).toBe('machine_credential_replaced');
    expect((await h.request(base + '/credential', jwt)).body.credential).toEqual(rotated.body.credential);
    expect(JSON.stringify(rotated.body)).not.toContain(nextToken);
});

test('HTTP async native inventory rechecks identity before returning or starting a rename', async () => {
    const h = await httpSetup(), jwt = await h.auth(h.a.token), { machineId } = h.store.enroll(h.actor, enrollmentInput());
    h.connect(machineId);
    h.setInventoryHook(() => { h.hub.rotate(h.a.identity, h.a.token, createIdentityToken()); });
    const result = await h.request(`${prefix}/machines/${machineId}`, jwt, 'PATCH', { name: 'must not apply' });
    expect(result.status).toBe(401);
    expect(h.calls.some(call => call.startsWith('PATCH'))).toBe(false);
    expect(h.machines[0].metadata!.displayName).toBeUndefined();
});
