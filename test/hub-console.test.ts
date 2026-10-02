import { afterEach, expect, test } from 'bun:test';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { SignJWT, decodeJwt } from 'jose';
import { hubDelegationFixture } from './hub-delegation-fixture';
import { hubResourceFixture } from './hub-resources-fixture';
import { until } from './helpers';
import { authorizeTerminal } from '../src/hub/access/sockets';
import { createIdentityToken } from '../src/hub/store';
import { stopText, codeText, filesText } from '../src/hub/tasks-page';

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

test('space permissions describe allowed roles, last owner protection and invitations without exposing secrets', async () => {
    const fixture = await hubResourceFixture(cleanups), space = fixture.a.personalSpace.id;
    const owner = fixture.hub.permissions(fixture.a.identity.id, space);
    expect(owner).toMatchObject({ rename: true, inviteRoles: ['member', 'admin'], leave: false });
    expect(owner.members[fixture.a.identity.id]).toEqual({ roles: ['owner'], remove: false });
    expect(owner.members[fixture.b.identity.id]).toEqual({ roles: ['member', 'admin', 'owner'], remove: true });
    const admin = fixture.hub.permissions(fixture.b.identity.id, space);
    expect(admin).toMatchObject({ rename: true, inviteRoles: ['member'], leave: true });
    expect(admin.members[fixture.a.identity.id]).toEqual({ roles: [], remove: false });
    const invitation = fixture.hub.invite(fixture.a.identity.id, space, 'admin');
    expect(fixture.hub.permissions(fixture.b.identity.id, space).invitations[invitation.invitation.id]).toEqual({ revoke: false });
    const response = await fetch(`${fixture.url}/api/runweft/hub/spaces/${space}/permissions`, { headers: { authorization: `Bearer ${fixture.a.token}` } });
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).not.toContain(invitation.token);
    expect(() => fixture.hub.permissions(fixture.c.identity.id, space)).toThrow();
});

test('native browser reauthentication preserves exact JWT scope and lifetime, refusing credential substitution', async () => {
    const fixture = await hubResourceFixture(cleanups), space = fixture.a.personalSpace.id;
    const token = await fixture.auth(fixture.a.token, space);
    const exchange = async (accessToken: string, spaceId?: string) => {
        const response = await fetch(fixture.url + '/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ accessToken, ...(spaceId ? { spaceId } : {}) }) });
        return { status: response.status, body: await response.json() as any };
    };
    const refreshed = await exchange(token);
    expect(refreshed.status).toBe(200); expect(refreshed.body.token).toBe(token);
    expect(decodeJwt(refreshed.body.token).exp).toBe(decodeJwt(token).exp);
    expect((await exchange(token, space)).status).toBe(401);
    expect((await exchange(await fixture.auth(fixture.a.token))).status).toBe(401);
    const machine = fixture.store.enroll(fixture.actor, { requestId: randomUUID(), token: `rw_mc_${randomBytes(32).toString('base64url')}` });
    const machineToken = fixture.access.issueMachine(machine.machineId).token;
    expect((await exchange((await fixture.gateway.authority.exchange(machineToken)).token)).status).toBe(401);
    fixture.access.bind({ kind: 'task', id: 'browser-task', ownerId: fixture.a.identity.id, spaceId: space, machineId: machine.machineId });
    const taskToken = fixture.access.issueTask('browser-task').token;
    expect((await exchange((await fixture.gateway.authority.exchange(taskToken)).token)).status).toBe(401);
    const expired = await new SignJWT({ ref: 'none', kind: 'user', space }).setProtectedHeader({ alg: 'HS256' })
        .setIssuer('runweft-hub').setAudience('runweft-access').setSubject(fixture.a.identity.id).setIssuedAt(1).setExpirationTime(2)
        .sign(createHmac('sha256', randomBytes(32)).update('runweft/access-jwt/v1').digest());
    expect((await exchange(expired)).status).toBe(401);
    const member = await fixture.auth(fixture.b.token, space);
    fixture.hub.changeMember(fixture.a.identity.id, space, fixture.b.identity.id, null);
    expect((await exchange(member)).status).toBe(401);
    fixture.hub.rotate(fixture.a.identity, fixture.a.token, createIdentityToken());
    expect((await exchange(token)).status).toBe(401);
    for (const query of ['hub=https://other.invalid', 'server=https://other.invalid', 'token=secret', 'initData=x']) {
        expect((await fetch(fixture.url + '/sessions/example/files?' + query)).status).toBe(400);
    }
    expect((await fetch(fixture.url + '/sessions/example/terminal')).status).toBe(403);
    const script = await fetch(fixture.url + '/hub/native.js');
    expect(script.status).toBe(200);
    const javascript = await script.text();
    expect(javascript).toContain('runweft.native.access'); expect(javascript).not.toContain('export default');
    expect(javascript).toContain('url.searchParams.delete("token")');
    expect(javascript).toContain('authorization: `Bearer ${credential}`');
});

test('console task detail and pagination are owner scoped without requiring a live parent', async () => {
    const fixture = await hubDelegationFixture(cleanups), accepted = await fixture.post('spawn', fixture.payload());
    const active = await until(() => fixture.post('read', { id: accepted.agent_id }), view => view.inputs[0]?.observation?.phase === 'accepted');
    fixture.complete(active.session_id, 'Private report '.repeat(50));
    await until(() => fixture.post('read', { id: accepted.agent_id }), view => view.status === 'completed');
    const response = await fixture.request(`details/${accepted.agent_id}?offset=5&limit=20`);
    expect(response.status).toBe(200);
    expect(response.body.ownerId).toBe(fixture.owner.identity.id);
    expect(response.body.agent.hub.version).toBe(1);
    expect(response.body.report.text).toHaveLength(20); expect(response.body.report.next_offset).toBe(25);
    expect(response.body.actions).toEqual({ read: true, native: true, manageViaAgent: true });
    expect((await fixture.request(`details/${accepted.agent_id}?ownerId=other`)).status).toBe(400);
    expect((await fixture.request(`details/${accepted.agent_id}?limit=1&limit=2`)).status).toBe(400);
    expect((await fixture.request(`details/${accepted.agent_id}?roundId=${randomUUID()}`)).status).toBe(404);
    expect((await fixture.request(`details/${accepted.agent_id}`, {}, undefined)).status).toBe(405);
    const other = await fixture.token(fixture.other.token);
    expect((await fixture.request(`details/${accepted.agent_id}`, undefined, other)).status).toBe(404);
    expect((await fixture.request('overview', undefined, other)).body.total).toBe(0);
});

test('owned sessions on shared machines never grant terminal input, and own terminal follows current execution policy', async () => {
    const fixture = await hubDelegationFixture(cleanups);
    const remote = fixture.machine(fixture.outsider);
    fixture.gateway.store.bind({ kind: 'session', id: 'shared-terminal', ownerId: fixture.owner.identity.id, spaceId: fixture.space, machineId: remote });
    expect(() => authorizeTerminal(fixture.gateway.store, fixture.actor, 'shared-terminal')).toThrow();
    fixture.gateway.store.bind({ kind: 'session', id: 'own-terminal', ownerId: fixture.owner.identity.id, spaceId: fixture.space, machineId: fixture.machineId });
    expect(authorizeTerminal(fixture.gateway.store, fixture.actor, 'own-terminal').id).toBe('own-terminal');
    const seen: string[] = [];
    authorizeTerminal(fixture.gateway.store, fixture.actor, 'own-terminal', (_binding, method, suffix) => { seen.push(`${method}:${suffix}`); });
    authorizeTerminal(fixture.gateway.store, fixture.actor, 'own-terminal', (_binding, method, suffix) => { seen.push(`${method}:${suffix}`); }, true);
    expect(seen).toEqual(['POST:terminal', 'POST:messages']);
    expect(() => authorizeTerminal(fixture.gateway.store, fixture.actor, 'own-terminal', () => { throw new Error('withdrawn'); })).toThrow('withdrawn');
});


test('current console publishes public assets with strict headers, MIME and method boundaries', async () => {
    const fixture = await hubResourceFixture(cleanups);
    for (const [path, mime] of [['/hub', 'text/html'], ['/hub/', 'text/html'], ['/hub/style.css', 'text/css'], ['/hub/app.js', 'text/javascript']]) {
        const response = await fetch(fixture.url + path);
        expect(response.status).toBe(200); expect(response.headers.get('content-type')).toContain(mime!);
        expect(response.headers.get('referrer-policy')).toBe('no-referrer'); expect(response.headers.get('cache-control')).toBe('no-store');
        expect(response.headers.get('x-content-type-options')).toBe('nosniff');
        expect(response.headers.get('content-security-policy')).toContain("script-src 'self'");
        expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'self'");
        expect((await response.text()).length).toBeGreaterThan(0);
        const head = await fetch(fixture.url + path, { method: 'HEAD' });
        expect(head.status).toBe(200); expect(head.headers.get('content-type')).toContain(mime!); expect(await head.text()).toBe('');
        const post = await fetch(fixture.url + path, { method: 'POST' });
        expect(post.status).toBe(405); expect(post.headers.get('allow')).toBe('GET, HEAD');
    }
    expect((await fetch(fixture.url + '/hub/not-a-file')).status).toBe(404);
    expect((await fetch(fixture.url + '/api/runweft/tasks/overview')).status).toBe(401);
});


test('current console labels distinguish uncertain starts, stopped processes and delivery retention', () => {
    expect(stopText({ stop: 'not_started', execution_not_started: false })).toBe('尚未确认进程结束');
    expect(stopText({ stop: 'not_started', execution_not_started: true })).toBe('已确认未启动');
    expect(stopText({ stop: 'stopped', execution_not_started: false })).toBe('进程已结束');
    expect(codeText({ status: 'not_applicable' })).toBe('不适用');
    expect(filesText({ status: 'none', retention: 'retained', count: 0, available: 0 })).toBe('未声明');
    expect(filesText({ status: 'delivered', retention: 'released', count: 1, available: 1 })).toBe('已释放');
});
