import { afterEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { decodeJwt, SignJWT } from 'jose';
import { fixture } from './helpers';
import { createIdentityToken, HubStore } from '../src/hub/store';
import { AccessStore } from '../src/hub/access/store';
import { AccessAuthority } from '../src/hub/access/auth';
import { FileAccessStore } from '../src/hub/access/file-store';
import { STATE_SCHEMA_VERSION } from '../src/state';

const cleanup: (() => void)[] = [];
afterEach(() => { for (const fn of cleanup.splice(0).reverse()) fn(); });
function setup() {
    const home = fixture('hub-access'), path = join(home, 'state.sqlite');
    cleanup.push(() => rmSync(home, { recursive: true, force: true }));
    const hub = new HubStore(path), access = new AccessStore(path), other = new AccessStore(path), key = randomBytes(32);
    cleanup.push(() => { other.close(); access.close(); hub.close(); });
    const a = hub.createIdentity('machine owner'), b = hub.createIdentity('task owner'), c = hub.createIdentity('unrelated');
    const sid = a.personalSpace.id;
    const invite = hub.invite(a.identity.id, sid, 'member'); hub.acceptInvitation(b.identity.id, invite.token);
    access.bind({ kind: 'machine', id: 'machine-a', ownerId: a.identity.id });
    access.bind({ kind: 'machine', id: 'machine-c', ownerId: c.identity.id });
    access.bind({ kind: 'task', id: 'task-b', ownerId: b.identity.id, spaceId: sid, machineId: 'machine-a' });
    access.bind({ kind: 'session', id: 'session-b', ownerId: b.identity.id, spaceId: sid, taskId: 'task-b', machineId: 'machine-a' });
    access.bind({ kind: 'session', id: 'session-a', ownerId: a.identity.id, machineId: 'machine-a' });
    access.bind({ kind: 'session', id: 'session-c', ownerId: c.identity.id, machineId: 'machine-c' });
    const machine = access.issueMachine('machine-a'), task = access.issueTask('task-b');
    return { home, path, hub, access, other, key, authority: new AccessAuthority(access, key), a, b, c, sid, machine, task };
}

test('machine execution authority is distinct from user content ownership, including same-space admins', () => {
    const h = setup(), a = h.access.authenticate(h.a.token), b = h.access.authenticate(h.b.token), c = h.access.authenticate(h.c.token);
    const machine = h.access.authenticate(h.machine.token), task = h.access.authenticate(h.task.token);
    expect(h.access.list(a, 'session').map(s => s.id)).toEqual(['session-a']);
    expect(h.access.list(b, 'session').map(s => s.id)).toEqual(['session-b']);
    expect(h.access.can(a, 'session', 'session-b')).toBe(false); // space owner has no task content privilege
    expect(h.access.can(c, 'session', 'session-b')).toBe(false);
    expect(h.access.can(b, 'machine', 'machine-a', 'write')).toBe(false);
    expect(h.access.can(machine, 'session', 'session-b', 'report')).toBe(true);
    expect(h.access.can(machine, 'session', 'session-c', 'report')).toBe(false);
    expect(h.access.can(machine, 'machine', 'machine-c', 'report')).toBe(false);
    expect(h.access.can(machine, 'machine', 'machine-a', 'write')).toBe(false);
    expect(h.access.can(b, 'session', 'session-b', 'report')).toBe(false);
    expect(h.access.can(task, 'task', 'task-b', 'report')).toBe(true);
    expect(h.access.can(task, 'session', 'session-b', 'report')).toBe(false);
    expect(h.access.can(task, 'machine', 'machine-a')).toBe(false);
    expect(h.access.can({ ...b, ownerId: h.a.identity.id, machineId: 'machine-a' }, 'session', 'session-a')).toBe(false);
    expect(() => h.access.bind({ kind: 'session', id: 'session-b', ownerId: h.a.identity.id, machineId: 'machine-a' })).toThrow('归属');
    expect(() => h.access.bind({ kind: 'machine', id: 'machine-a:rpc', ownerId: h.a.identity.id })).toThrow('不完整');
});

test('purpose-bound short JWTs revalidate identity and selected space; native HAPI/root tokens cannot substitute', async () => {
    const h = setup(), response = await h.authority.exchange(h.b.token, h.sid);
    const claims = decodeJwt(response.token);
    expect(claims.exp! - claims.iat!).toBe(900);
    expect(claims.ns).not.toBe('runweft'); expect(JSON.stringify(claims)).not.toContain(h.b.token);
    expect((await h.authority.verify(response.token)).ownerId).toBe(h.b.identity.id);
    const wrongSpace = await h.authority.exchange(h.b.token, h.b.personalSpace.id);
    expect(h.access.can(await h.authority.verify(wrongSpace.token), 'session', 'session-b')).toBe(false);
    await expect(h.authority.exchange(h.c.token, h.sid)).rejects.toMatchObject({ status: 401 });
    const native = await new SignJWT({ uid: 1, ns: 'runweft' }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('4h').sign(h.key);
    await expect(h.authority.verify(native)).rejects.toMatchObject({ status: 401 });
    await expect(new AccessAuthority(h.access, randomBytes(32)).verify(response.token)).rejects.toMatchObject({ status: 401 });
    await expect(h.authority.verify(h.b.token)).rejects.toMatchObject({ status: 401 });
    await expect(h.authority.exchange('root:namespace')).rejects.toMatchObject({ status: 401 });
    await expect(h.authority.exchange(h.machine.token, h.sid)).rejects.toMatchObject({ status: 401 });
    const replacement = createIdentityToken(), inFlightExchange = h.authority.exchange(h.b.token, h.sid);
    h.hub.rotate(h.b.identity, h.b.token, replacement);
    await expect(inFlightExchange).rejects.toMatchObject({ status: 401 });
    await expect(h.authority.verify(response.token)).rejects.toMatchObject({ status: 401 });
    expect((await h.authority.exchange(replacement, h.sid)).user.id).toBe(response.user.id);
    expect(h.access.authenticate(h.machine.token).kind).toBe('machine');
});

test('member removal invalidates existing principals and cannot revive task credentials/intents on rejoin', async () => {
    const h = setup(), jwt = (await h.authority.exchange(h.b.token, h.sid)).token;
    const user = await h.authority.verify(jwt), task = h.other.authenticate(h.task.token), machine = h.other.authenticate(h.machine.token);
    const intent = h.access.beginIntent({ requestKey: 'remove', ownerId: h.b.identity.id, spaceId: h.sid, taskId: 'task-b',
        machineId: 'machine-a', operation: 'spawn', fingerprint: 'a'.repeat(64), expiresAt: Date.now() + 60_000 });
    h.hub.changeMember(h.a.identity.id, h.sid, h.b.identity.id, null);
    await expect(h.authority.verify(jwt)).rejects.toMatchObject({ status: 401 });
    expect(() => h.other.can(user, 'session', 'session-b')).toThrow();
    expect(() => h.other.refresh(task)).toThrow();
    expect(h.other.can(machine, 'session', 'session-b')).toBe(false);
    const invitation = h.hub.invite(h.a.identity.id, h.sid, 'member'); h.hub.acceptInvitation(h.b.identity.id, invitation.token);
    expect(() => h.other.refresh(task)).toThrow();
    expect(() => h.other.bindIntent(intent.id, 'new-session')).toThrow();
    expect(h.access.authenticate(h.b.token).ownerId).toBe(h.b.identity.id);
});

test('artifact access needs an explicit directional grant, revoked across live store connections', () => {
    const h = setup(), machine = h.other.authenticate(h.machine.token), task = h.other.authenticate(h.task.token);
    h.access.bind({ kind: 'artifact', id: 'input-b', ownerId: h.b.identity.id, spaceId: h.sid });
    h.access.bind({ kind: 'artifact', id: 'input-c', ownerId: h.c.identity.id });
    expect(h.other.can(machine, 'artifact', 'input-b')).toBe(false);
    h.access.grant(h.machine.id, 'input-b', 'read');
    expect(h.other.can(machine, 'artifact', 'input-b')).toBe(true);
    expect(h.other.can(machine, 'artifact', 'input-b', 'write')).toBe(false);
    h.access.grant(h.task.id, 'input-b', 'write');
    expect(h.other.can(task, 'artifact', 'input-b', 'write')).toBe(true);
    expect(h.other.can(task, 'artifact', 'input-b')).toBe(false);
    expect(() => h.access.grant(h.task.id, 'input-c', 'read')).toThrow('归属');
    h.access.revokeGrant(h.machine.id, 'input-b');
    expect(h.other.can(machine, 'artifact', 'input-b')).toBe(false);
    h.access.revoke(h.machine.id);
    expect(() => h.other.can(machine, 'session', 'session-b')).toThrow();
    h.access.retire('task', 'task-b');
    expect(() => h.other.refresh(task)).toThrow();
});

test('dispatch intents scope request IDs and persist uncertain dispatch; rebinding and expired dispatch are rejected', () => {
    const h = setup(), now = Date.now();
    const input = { requestKey: 'client-request', ownerId: h.b.identity.id, spaceId: h.sid, taskId: 'task-b',
        machineId: 'machine-a', operation: 'spawn', fingerprint: 'b'.repeat(64), expiresAt: now + 60_000 };
    const original = h.access.beginIntent(input), repeated = h.other.beginIntent({ ...input, expiresAt: now + 120_000 });
    expect(repeated.id).toBe(original.id); expect(repeated.expiresAt).toBe(original.expiresAt);
    const otherOwner = h.access.beginIntent({ ...input, ownerId: h.a.identity.id, taskId: null });
    expect(otherOwner.id).not.toBe(original.id);
    expect(() => h.access.beginIntent({ ...input, machineId: 'machine-c' })).toThrow('归属');
    expect(() => h.access.beginIntent({ ...input, fingerprint: 'c'.repeat(64) })).toThrow('归属');
    expect(() => h.access.beginIntent({ ...input, requestKey: 'bad-source', operation: 'fork', sourceSessionId: 'session-a' })).toThrow('归属');
    expect(() => h.access.beginIntent({ ...input, requestKey: 'no-source', operation: 'clear' })).toThrow('不完整');
    const derived = h.access.beginIntent({ ...input, requestKey: 'derived', operation: 'fork', sourceSessionId: 'session-b' });
    const child = h.other.bindIntent(derived.id, 'fork-child');
    expect(child).toMatchObject({ ownerId: h.b.identity.id, machineId: 'machine-a', taskId: 'task-b' });
    expect(h.access.bindIntent(derived.id, 'fork-child')).toEqual(child);
    expect(() => h.access.bindIntent(derived.id, 'different-child')).toThrow('归属');
    const db = new Database(h.path); db.query('UPDATE hub_execution_intents SET expiresAt=1 WHERE id=?').run(original.id); db.close();
    expect(h.access.beginIntent(input).expiresAt).toBe(1);
    expect(() => h.access.bindIntent(original.id, 'too-late')).toThrow();
    expect(h.access.pending('machine-a').map(i => i.id)).toEqual([otherOwner.id]);
});

test('two processes cannot claim the same native object for different owners; tokens and mappings survive restart', async () => {
    const h = setup();
    const module = resolve('src/hub/access/store.ts');
    const script = `import { AccessStore } from ${JSON.stringify(module)};
        const store=new AccessStore(process.argv[1]); try { store.bind({kind:'session',id:'contended',ownerId:process.argv[2],machineId:'machine-a'}); process.exitCode=0; }
        catch { process.exitCode=2; } finally { store.close(); }`;
    const children = [h.a, h.b].map(user => Bun.spawn([process.execPath, '-e', script, h.path, user.identity.id], { stdout: 'ignore', stderr: 'pipe' }));
    expect((await Promise.all(children.map(child => child.exited))).sort()).toEqual([0, 2]);
    const reopened = new AccessStore(h.path);
    try {
        expect(reopened.object('session', 'contended')?.ownerId).toBe(h.access.object('session', 'contended')?.ownerId);
        expect(reopened.authenticate(h.machine.token).id).toBe(h.machine.id);
        expect(reopened.object('session', 'session-b')?.ownerId).toBe(h.b.identity.id);
    } finally { reopened.close(); }
    for (const suffix of ['', '-wal']) {
        const bytes = readFileSync(h.path + suffix);
        for (const secret of [h.a.token, h.b.token, h.machine.token, h.task.token]) expect(bytes.includes(Buffer.from(secret))).toBe(false);
    }
});

test('v7 migration preserves identities and existing resource rows without inferring execution ownership', () => {
    const h = setup(), db = new Database(h.path);
    db.exec(`DROP TABLE hub_agent_selections; DROP TABLE hub_agent_blocks; DROP TABLE hub_agent_members; DROP TABLE hub_agent_versions; DROP TABLE hub_agents; DROP TABLE hub_checkouts; DROP TABLE hub_repository_aliases; DROP TABLE hub_repositories; DROP TABLE hub_resource_blocks; DROP TABLE hub_runtime_shares; DROP TABLE hub_resource_runtimes; DROP TABLE hub_machine_spaces; DROP TABLE hub_resource_machines; DROP TABLE hub_native_session_claims; DROP TABLE hub_file_reservations; DROP TABLE hub_execution_grants; DROP TABLE hub_execution_intents; DROP TABLE hub_execution_credentials;
        DROP TABLE hub_execution_objects; INSERT INTO machine_registrations VALUES ('default', 'legacy', 1, 1, 1); PRAGMA user_version=7;`);
    const migrated = new AccessStore(h.path);
    try {
        expect(db.query('PRAGMA user_version').get()).toEqual({ user_version: STATE_SCHEMA_VERSION });
        expect(migrated.authenticate(h.b.token).ownerId).toBe(h.b.identity.id);
        expect(migrated.object('machine', 'legacy')).toBeNull();
        expect(db.query('SELECT machineId FROM machine_registrations').get()).toEqual({ machineId: 'legacy' });
    } finally { migrated.close(); db.close(); }
});

test('file request IDs are scoped to the publisher and pin both content and selected space', () => {
    const h = setup(), files = new FileAccessStore(h.access), requestId = randomUUID();
    const a = h.access.authenticate(h.a.token, h.sid), b = h.access.authenticate(h.b.token, h.sid);
    const body = { requestId, filename: 'result.txt', size: 3, sha256: 'a'.repeat(64) };
    const first = files.reserve(a, body), second = files.reserve(b, body);
    expect(first.body.requestId).not.toBe(second.body.requestId);
    expect(first.body.requestId).not.toBe(requestId);
    expect(files.reserve(a, body).body.requestId).toBe(first.body.requestId);
    expect(() => files.reserve(a, { ...body, sha256: 'b'.repeat(64) })).toThrow('内容');
    expect(() => files.reserve(h.access.authenticate(h.a.token), body)).toThrow('归属');
    expect(() => files.lookup(h.access.authenticate(h.b.token, h.b.personalSpace.id), requestId)).toThrow();
    files.bind(a, first.reservation.id, 'file-a');
    expect(() => files.bind(b, first.reservation.id, 'file-b')).toThrow();
    expect(() => files.bind(a, first.reservation.id, 'file-b')).toThrow('内容');
    expect(h.access.can(b, 'artifact', 'file-a')).toBe(false);
});

test('machine output requires a trusted permit; task and user ownership cannot be replaced by machine ownership', () => {
    const h = setup(), files = new FileAccessStore(h.access), machine = h.access.authenticate(h.machine.token);
    const requestId = randomUUID(), body = { requestId, filename: 'result.txt', size: 3, sha256: 'a'.repeat(64) };
    expect(() => files.reserve(machine, body)).toThrow();
    const permit = { requestId, filename: body.filename, ownerId: h.b.identity.id, spaceId: h.sid, taskId: 'task-b', machineId: 'machine-a' };
    const row = files.permit(permit);
    expect(files.permit(permit).id).toBe(row.id);
    expect(() => files.permit({ ...permit, ownerId: h.a.identity.id })).toThrow();
    expect(() => files.reserve(machine, { ...body, filename: 'other.txt' })).toThrow();
    expect(files.reserve(machine, body).reservation.id).toBe(row.id);
    expect(() => files.reserve(h.access.authenticate(h.task.token), body)).toThrow();
    const bound = files.bind(machine, row.id, 'machine-output');
    expect(bound.ownerId).toBe(h.b.identity.id);
    expect(h.access.can(machine, 'artifact', 'machine-output', 'write')).toBe(true);
    expect(h.access.can(h.access.authenticate(h.a.token), 'artifact', 'machine-output')).toBe(false);
    h.access.revokeGrant(h.machine.id, 'machine-output');
    files.bind(machine, files.reserve(machine, body).reservation.id, 'machine-output');
    expect(h.access.can(machine, 'artifact', 'machine-output')).toBe(false);
});

test('removed members cannot revive output permits; rejoining owners can recover their existing native file receipt', () => {
    const h = setup(), files = new FileAccessStore(h.access), machine = h.access.authenticate(h.machine.token);
    const requestId = randomUUID(), body = { requestId, filename: 'orphan.txt', size: 3, sha256: 'a'.repeat(64) };
    const row = files.permit({ requestId, filename: body.filename, ownerId: h.b.identity.id, spaceId: h.sid, machineId: 'machine-a' });
    files.reserve(machine, body);
    h.hub.changeMember(h.a.identity.id, h.sid, h.b.identity.id, null);
    expect(() => files.bind(machine, row.id, 'orphan')).toThrow();
    const invitation = h.hub.invite(h.a.identity.id, h.sid, 'member'); h.hub.acceptInvitation(h.b.identity.id, invitation.token);
    expect(() => files.reserve(machine, body)).toThrow();
    expect(() => files.bind(machine, row.id, 'orphan')).toThrow();
    const owner = h.access.authenticate(h.b.token, h.sid);
    files.bind(owner, row.id, 'orphan');
    expect(h.access.can(owner, 'artifact', 'orphan')).toBe(true);
    expect(h.access.can(machine, 'artifact', 'orphan')).toBe(false);
});

test('native engine IDs cannot cause HAPI history to merge across owner, space or machine, including after restart', () => {
    const h = setup();
    h.access.claimNative('claudeSessionId', 'native-b', 'session-b');
    h.other.claimNative('claudeSessionId', 'native-b', 'session-b');
    expect(() => h.other.claimNative('claudeSessionId', 'native-b', 'session-a')).toThrow('归属');
    h.access.bind({ kind: 'session', id: 'b-second-space', ownerId: h.b.identity.id, spaceId: h.b.personalSpace.id, machineId: 'machine-a' });
    expect(() => h.access.claimNative('claudeSessionId', 'native-b', 'b-second-space')).toThrow('归属');
    h.access.bind({ kind: 'session', id: 'b-second-machine', ownerId: h.b.identity.id, spaceId: h.sid, machineId: 'machine-c' });
    expect(() => h.access.claimNative('claudeSessionId', 'native-b', 'b-second-machine')).toThrow('归属');
    h.access.claimNative('codexSessionId', 'native-b', 'session-a'); // Runtime IDs have separate domains.
    const reopened = new AccessStore(h.path);
    try { expect(reopened.nativeClaim('claudeSessionId', 'native-b')).toMatchObject({ ownerId: h.b.identity.id, spaceId: h.sid }); }
    finally { reopened.close(); }
});
