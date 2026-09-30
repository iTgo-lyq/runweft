import { STATE_SCHEMA_VERSION } from '../src/state';
import { afterEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { randomBytes } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SignJWT } from 'jose';
import { createRunweftHandler } from '../src/api';
import { createGateway } from '../src/proxy';
import { createIdentityToken, HubStore } from '../src/hub/store';
import { openState } from '../src/state';
import { fixture } from './helpers';

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
const prefix = '/api/runweft/hub';
async function setup() {
    const home = fixture('hub'), path = join(home, 'state.sqlite'), hub = new HubStore(path), key = randomBytes(32);
    cleanup.push(() => rmSync(home, { recursive: true, force: true }));
    cleanup.push(() => hub.close());
    const server = await createGateway({ host: '127.0.0.1', port: 0, target: 'http://127.0.0.1:1',
        handle: createRunweftHandler({ key, hapiUrl: 'http://127.0.0.1:1', statePath: path, health: () => ({}), hub }) });
    cleanup.push(() => server.close());
    const url = `http://127.0.0.1:${(server.server.address() as { port: number }).port}`;
    const api = async (route: string, token = '', value?: unknown, method = value === undefined ? 'GET' : 'POST') => {
        const response = await fetch(url + prefix + route, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...(value !== undefined ? { 'content-type': 'application/json' } : {}) }, body: value !== undefined ? JSON.stringify(value) : undefined });
        return { status: response.status, data: await response.json() as any };
    };
    const create = async (name: string) => { const result = await api('/identities', '', { name }); expect(result.status).toBe(201); return result.data; };
    const joinSpace = async (owner: any, user: any, role = 'member', spaceId = owner.personalSpace.id) => {
        const invite = await api(`/spaces/${spaceId}/invitations`, owner.token, { role }); expect(invite.status).toBe(200);
        const joined = await api('/invitations/accept', user.token, { token: invite.data.token }); expect(joined.status).toBe(200);
        return invite.data;
    };
    return { home, path, hub, key, url, api, create, joinSpace };
}

test('identities persist, secrets are hashed, rotation retains ownership and old credentials fail', async () => {
    const h = await setup(), a = await h.create('甲'), b = await h.create('甲');
    expect(a.identity.id).not.toBe(b.identity.id); expect(a.token).not.toBe(b.token); expect(a.personalSpace.id).not.toBe(b.personalSpace.id);
    const connection = new HubStore(h.path);
    try { expect(connection.authenticate(a.token)).toEqual(a.identity); expect(connection.spaces(a.identity.id)).toEqual([a.personalSpace]); }
    finally { connection.close(); }
    expect((await h.api('/identity', a.token)).data).toEqual({ identity: a.identity });
    expect((await h.api('/identity', a.token, { name: '新名称', id: b.identity.id }, 'PATCH')).status).toBe(400);
    expect((await h.api('/identity', a.token, { name: '新名称' }, 'PATCH')).data.identity.id).toBe(a.identity.id);
    const next = createIdentityToken(), another = createIdentityToken();
    const rotations = await Promise.all([h.api('/identity/rotate', a.token, { token: next }), h.api('/identity/rotate', a.token, { token: another })]);
    expect(rotations.map(r => r.status).sort()).toEqual([200, 401]);
    const saved = rotations[0].status === 200 ? next : another;
    expect((await h.api('/identity', a.token)).status).toBe(401);
    expect((await h.api('/identity', saved)).data.identity).toMatchObject({ id: a.identity.id, name: '新名称' });
    expect((await h.api('/spaces', saved)).data.spaces).toEqual([a.personalSpace]);
    expect((await h.api('/identity', b.token)).status).toBe(200);
    expect(JSON.stringify(rotations)).not.toContain(saved);
    const db = new Database(h.path, { readonly: true });
    try {
        expect(db.query('SELECT tokenDigest FROM hub_users').all()).toHaveLength(2);
        const serialized = Buffer.from(db.serialize());
        for (const secret of [a.token, b.token, saved]) expect(serialized.includes(Buffer.from(secret))).toBe(false);
    } finally { db.close(); }
});

test('three roles and nested object IDs obey space boundaries; personal spaces use the same model', async () => {
    const h = await setup(), owner = await h.create('owner'), admin = await h.create('admin'), member = await h.create('member'), outsider = await h.create('outsider');
    const sid = owner.personalSpace.id, route = `/spaces/${sid}`;
    await h.joinSpace(owner, admin, 'admin'); await h.joinSpace(owner, member);
    expect((await h.api(route, outsider.token)).status).toBe(404);
    expect((await h.api(route + '/members', outsider.token)).status).toBe(404);
    expect((await h.api(route + '/members', member.token)).data.members).toHaveLength(3);
    expect((await h.api(route, member.token, { name: 'forbidden' }, 'PATCH')).status).toBe(403);
    expect((await h.api(route, admin.token, { name: '协作空间' }, 'PATCH')).data.space.name).toBe('协作空间');
    expect((await h.api(route + '/invitations', member.token)).status).toBe(403);
    expect((await h.api(route + '/invitations', admin.token, { role: 'admin' })).status).toBe(403);
    expect((await h.api(route + '/invitations', owner.token, { role: 'owner' })).status).toBe(400);
    expect((await h.api(route + `/members/${member.identity.id}`, admin.token, { role: 'admin' }, 'PATCH')).status).toBe(403);
    expect((await h.api(route + `/members/${owner.identity.id}`, admin.token, undefined, 'DELETE')).status).toBe(403);
    expect((await h.api(route + `/members/${owner.identity.id}`, owner.token, undefined, 'DELETE')).data.error.code).toBe('last_space_owner');
    expect((await h.api(route + `/members/${owner.identity.id}`, owner.token, { role: 'admin' }, 'PATCH')).status).toBe(409);
    const foreign = await h.api(`/spaces/${outsider.personalSpace.id}/invitations`, outsider.token, { role: 'member' });
    expect((await h.api(route + `/invitations/${foreign.data.invitation.id}`, admin.token, undefined, 'DELETE')).status).toBe(404);
    expect((await h.api(route + `/members/${outsider.identity.id}`, owner.token, { role: 'admin' }, 'PATCH')).status).toBe(404);
    expect((await h.api(route + `/members/${member.identity.id}`, member.token, undefined, 'DELETE')).status).toBe(200);
    expect((await h.api(route, member.token)).status).toBe(404);
    expect((await h.api('/spaces', outsider.token)).data.spaces.map((s: any) => s.id)).toEqual([outsider.personalSpace.id]);
});

test('invitations are single consumer, replayable by that member, revocable and invalid after issuer removal', async () => {
    const h = await setup(), a = await h.create('a'), b = await h.create('b'), c = await h.create('c');
    const route = `/spaces/${a.personalSpace.id}`;
    const issued = (await h.api(route + '/invitations', a.token, { role: 'member' })).data;
    const attempts = await Promise.all([h.api('/invitations/accept', b.token, { token: issued.token }), h.api('/invitations/accept', c.token, { token: issued.token })]);
    expect(attempts.map(r => r.status).sort()).toEqual([200, 410]);
    const consumer = attempts[0].status === 200 ? b : c, other = consumer === b ? c : b;
    expect((await h.api('/invitations/accept', consumer.token, { token: issued.token })).status).toBe(200);
    await h.api(route + `/members/${consumer.identity.id}`, a.token, undefined, 'DELETE');
    expect((await h.api('/invitations/accept', consumer.token, { token: issued.token })).status).toBe(410);
    await h.joinSpace(a, consumer, 'admin');
    const pending = (await h.api(route + '/invitations', consumer.token, { role: 'member' })).data;
    await h.api(route + `/members/${consumer.identity.id}`, a.token, { role: 'member' }, 'PATCH');
    await h.api(route + `/members/${consumer.identity.id}`, a.token, { role: 'admin' }, 'PATCH');
    expect((await h.api('/invitations/accept', other.token, { token: pending.token })).status).toBe(410);
    const extra = (await h.api(route + '/invitations', a.token, { role: 'admin' })).data;
    expect((await h.api('/invitations/accept', consumer.token, { token: extra.token })).status).toBe(409);
    expect((await h.api('/invitations/accept', other.token, { token: extra.token })).status).toBe(200);
    const expired = (await h.api(route + '/invitations', a.token, { role: 'member' })).data;
    const db = new Database(h.path); db.query('UPDATE hub_invitations SET expiresAt=0 WHERE id=?').run(expired.invitation.id); db.close();
    expect((await h.api('/invitations/accept', b.token, { token: expired.token })).status).toBe(410);
    const revoked = (await h.api(route + '/invitations', a.token, { role: 'member' })).data;
    expect((await h.api(route + `/invitations/${revoked.invitation.id}`, a.token, undefined, 'DELETE')).status).toBe(200);
    expect((await h.api('/invitations/accept', c.token, { token: revoked.token })).status).toBe(410);
    const list = await h.api(route + '/invitations', a.token);
    expect(list.data.invitations).toEqual([]); expect(JSON.stringify(list)).not.toContain('tokenDigest');
});

test('independent processes cannot remove both remaining owners', async () => {
    const h = await setup(), a = await h.create('a'), b = await h.create('b');
    const sid = a.personalSpace.id;
    await h.joinSpace(a, b);
    expect((await h.api(`/spaces/${sid}/members/${b.identity.id}`, a.token, { role: 'owner' }, 'PATCH')).status).toBe(200);
    const code = `import { HubStore } from ${JSON.stringify(resolve('src/hub/store.ts'))};
        const input=JSON.parse(await Bun.stdin.text()); const store=new HubStore(input.path);
        try { store.authorized(input.token, true, id => store.changeMember(id.id, input.space, id.id, null)); console.log('left'); }
        catch(e) { console.log(e.code); } finally { store.close(); }`;
    const outcomes = await Promise.all([a, b].map(async user => {
        const process = Bun.spawn([processExecutable(), '-e', code], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
        process.stdin.write(JSON.stringify({ path: h.path, space: sid, token: user.token })); process.stdin.end();
        const result = (await new Response(process.stdout).text()).trim();
        expect(await process.exited).toBe(0); return result;
    }));
    expect(outcomes.sort()).toEqual(['last_space_owner', 'left']);
});
function processExecutable() { return process.execPath; }

test('new APIs reject HAPI and query/cookie credentials, reject malformed input without echoing secrets', async () => {
    const h = await setup(), a = await h.create('a');
    const jwt = await new SignJWT({ uid: 1, ns: 'default' }).setProtectedHeader({ alg: 'HS256' }).sign(h.key);
    for (const token of ['', jwt, 'root-token', a.token + ':other']) expect((await h.api('/identity', token)).status).toBe(401);
    const query = await fetch(`${h.url}${prefix}/identity?token=${a.token}`, { headers: { cookie: `token=${a.token}` } });
    expect(query.status).toBe(401);
    const old = await fetch(`${h.url}/api/runweft/identity`, { headers: { authorization: `Bearer ${a.token}` } });
    expect(old.status).toBe(401);
    expect((await h.api('/identity', a.token, { token: a.token, name: 'a' }, 'PATCH')).status).toBe(400);
    const invalid = await h.api('/identities', '', { name: 'a'.repeat(20_000), token: a.token });
    expect(invalid.status).toBe(413); expect(JSON.stringify(invalid)).not.toContain(a.token);
    const plain = await fetch(h.url + prefix + '/identities', { method: 'POST', body: JSON.stringify({ name: 'cross-origin' }) });
    expect(plain.status).toBe(415); expect(plain.headers.get('access-control-allow-origin')).toBeNull();
    const malformed = await fetch(h.url + prefix + '/identities', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
    expect(malformed.status).toBe(400);
});

test('v6 upgrade preserves existing registrations and does not assign them to new identities', () => {
    const root = fixture('hub-upgrade'), path = join(root, 'state.sqlite');
    cleanup.push(() => rmSync(root, { recursive: true, force: true }));
    const old = openState(path);
    old.exec(`DROP TABLE hub_agent_selections; DROP TABLE hub_agent_blocks; DROP TABLE hub_agent_members; DROP TABLE hub_agent_versions; DROP TABLE hub_agents; DROP TABLE hub_checkouts; DROP TABLE hub_repository_aliases; DROP TABLE hub_repositories; DROP TABLE hub_resource_blocks; DROP TABLE hub_runtime_shares; DROP TABLE hub_resource_runtimes; DROP TABLE hub_machine_spaces; DROP TABLE hub_resource_machines; DROP TABLE hub_native_session_claims; DROP TABLE hub_file_reservations; DROP TABLE hub_execution_grants; DROP TABLE hub_execution_intents; DROP TABLE hub_execution_credentials; DROP TABLE hub_execution_objects; DROP TABLE hub_invitations; DROP TABLE hub_memberships; DROP TABLE hub_spaces; DROP TABLE hub_users;
        INSERT INTO machine_registrations VALUES ('legacy', 'machine', 1, 1, 2); PRAGMA user_version=6;`);
    old.close();
    const hub = new HubStore(path); const identity = hub.createIdentity('new'); hub.close();
    const db = new Database(path);
    expect(db.query('PRAGMA user_version').get()).toEqual({ user_version: STATE_SCHEMA_VERSION });
    expect(db.query('SELECT * FROM machine_registrations').get()).toEqual({ namespace: 'legacy', machineId: 'machine', registered: 1, createdAt: 1, updatedAt: 2 });
    expect(db.query('SELECT COUNT(*) AS count FROM hub_memberships').get()).toEqual({ count: 1 });
    db.close();
    expect(readFileSync(path).includes(Buffer.from(identity.token))).toBe(false);
});
