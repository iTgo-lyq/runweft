import { setupHubResources, hubResourceFixture } from './hub-resources-fixture';
import { afterEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AccessStore } from '../src/hub/access/store';
import { HubResourceStore } from '../src/hub/resources/store';
import { createIdentityToken } from '../src/hub/store';
import { STATE_SCHEMA_VERSION } from '../src/state';
import { resourceInspection } from './resources-fixture';

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanups.splice(0).reverse()) await fn(); });
const machineToken = () => `rw_mc_${randomBytes(32).toString('base64url')}`;
const enrollmentInput = () => ({ requestId: randomUUID(), token: machineToken() });
const setup = () => setupHubResources(cleanups);
const httpSetup = () => hubResourceFixture(cleanups);

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
        db.exec('DROP TABLE hub_agent_selections; DROP TABLE hub_agent_blocks; DROP TABLE hub_agent_members; DROP TABLE hub_agent_versions; DROP TABLE hub_agents; DROP TABLE hub_checkouts; DROP TABLE hub_repository_aliases; DROP TABLE hub_repositories; DROP TABLE hub_resource_blocks; DROP TABLE hub_runtime_shares; DROP TABLE hub_resource_runtimes; DROP TABLE hub_machine_spaces; DROP TABLE hub_resource_machines; PRAGMA user_version=10;');
        const access = new AccessStore(h.path);
        try {
            expect(db.query('PRAGMA user_version').get()).toEqual({ user_version: STATE_SCHEMA_VERSION });
            expect(new HubResourceStore(access).machines(h.actor)).toEqual([]);
            expect(access.object('machine', 'legacy')?.ownerId).toBe(h.a.identity.id);
        } finally { access.close(); }
    } finally { db.close(); }
});


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
        for (const [path, method, body] of [[base, 'PATCH', { name: 'stolen' }], [base + '/credential', 'GET'], [base + '/credential', 'DELETE'],
            [base + `/spaces/${h.a.personalSpace.id}`, 'PUT', {}], [base + '/register', 'POST', {}]] as const) {
            expect((await h.request(path, token, method, body)).status).toBe(token === admin ? 403 : 404);
        }
        expect((await h.request(prefix + '/machines', token)).body.machines).toHaveLength(token === admin ? 1 : 0);
        expect((await h.request(base, token)).status).toBe(token === admin ? 200 : 404);
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

test('runtime sharing grants use only; governance is space local, persistent through toggles, and association removal cascades', () => {
    const h = setup(), sid = h.a.personalSpace.id, tid = h.c.personalSpace.id;
    const d = h.hub.createIdentity('ordinary member');
    for (const [issuer, target, space] of [[h.a, d, sid], [h.c, h.a, tid], [h.c, d, tid]] as const) {
        h.hub.acceptInvitation(target.identity.id, h.hub.invite(issuer.identity.id, space, 'member').token);
    }
    const aS = h.access.authenticate(h.a.token, sid), bS = h.access.authenticate(h.b.token, sid), dS = h.access.authenticate(d.token, sid);
    const aT = h.access.authenticate(h.a.token, tid), dT = h.access.authenticate(d.token, tid);
    const { machineId } = h.store.enroll(aS, enrollmentInput());
    for (const space of [sid, tid]) h.store.associate(aS, machineId, space, true);
    const r = h.store.registerRuntime(aS, { machineId, flavor: 'codex' }, resourceInspection('codex'));
    const privateClaude = h.store.registerRuntime(aS, { machineId, flavor: 'claude' }, resourceInspection('claude'));
    expect(h.store.registerRuntime(aS, { machineId, flavor: 'codex' }, resourceInspection('codex')).id).toBe(r.id);
    expect(privateClaude.id).not.toBe(r.id);
    expect(h.store.runtimes(dS)).toEqual([]);
    expect(h.store.runtimes(bS)).toHaveLength(2);
    expect(h.store.usable(h.b.identity.id, sid, r.id).reason?.code).toBe('runtime_private');
    expect(h.store.usable(h.a.identity.id, sid, r.id).eligible).toBe(true);
    expect(h.store.usable(h.a.identity.id, null, r.id).reason?.code).toBe('resource_space_required');
    h.store.share(aS, r.id, sid, true);
    expect(h.store.runtimes(dS).map(r => r.id)).toEqual([r.id]);
    expect(h.store.runtimes(dT)).toEqual([]);
    expect(h.store.usable(d.identity.id, sid, r.id).eligible).toBe(true);
    for (const actor of [bS, dS]) {
        expect(() => h.store.renameRuntime(actor, r.id, { name: 'stolen' })).toThrow('所有者');
        expect(() => h.store.share(actor, r.id, tid, true)).toThrow('所有者');
        expect(() => h.store.registerRuntime(actor, { machineId, flavor: 'codex' }, resourceInspection('codex'))).toThrow('所有者');
        expect(() => h.store.unregisterRuntime(actor, r.id)).toThrow('所有者');
    }
    expect(() => h.store.block(dS, sid, 'runtime', r.id, true)).toThrow();
    expect(() => h.store.block(bS, tid, 'runtime', r.id, true)).toThrow();
    h.store.share(aT, r.id, tid, true);
    h.store.block(bS, sid, 'runtime', r.id, true);
    expect(h.store.usable(d.identity.id, tid, r.id).eligible).toBe(true);
    expect(h.store.usable(h.a.identity.id, sid, privateClaude.id).eligible).toBe(true);
    expect(() => h.store.nativeExecution(h.a.identity.id, sid, machineId, 'codex')).toThrow('禁用');
    h.store.unregisterRuntime(aS, r.id); h.store.registerRuntime(aS, { machineId, flavor: 'codex' }, resourceInspection('codex'));
    h.store.register(aS, machineId, false); h.store.register(aS, machineId, true);
    h.store.share(aS, r.id, sid, false); h.store.share(aS, r.id, sid, true);
    expect(h.store.usable(h.a.identity.id, sid, r.id).reason?.code).toBe('resource_space_blocked');
    h.store.associate(aS, machineId, sid, false);
    expect(h.store.shares(aT, r.id)).toEqual([tid]);
    h.store.associate(aS, machineId, sid, true);
    expect(h.store.usable(d.identity.id, sid, r.id).reason?.code).toBe('runtime_private');
    h.store.share(aS, r.id, sid, true);
    expect(h.store.usable(d.identity.id, sid, r.id).reason?.code).toBe('resource_space_blocked');
    h.store.block(bS, sid, 'runtime', r.id, false);
    h.store.block(bS, sid, 'machine', machineId, true);
    expect(h.store.usable(h.a.identity.id, sid, privateClaude.id).reason?.code).toBe('resource_space_blocked');
    expect(h.store.usable(d.identity.id, tid, r.id).eligible).toBe(true);
    h.store.block(bS, sid, 'machine', machineId, false);
    h.hub.changeMember(h.a.identity.id, sid, h.b.identity.id, 'owner');
    h.hub.changeMember(h.b.identity.id, sid, h.a.identity.id, null);
    expect(h.second.spaces(h.actor, machineId)).toEqual([tid]);
    expect(h.second.shares(h.actor, r.id)).toEqual([tid]);
    h.hub.acceptInvitation(h.a.identity.id, h.hub.invite(h.b.identity.id, sid, 'member').token);
    expect(h.second.spaces(h.actor, machineId)).toEqual([tid]);
    expect(h.second.shares(h.actor, r.id)).toEqual([tid]);
});

test('shared and governance DTOs exclude native paths, other shares and private tools; offline observations are historical', async () => {
    const h = await httpSetup(), sid = h.a.personalSpace.id;
    const d = h.hub.createIdentity('member'); h.hub.acceptInvitation(d.identity.id, h.hub.invite(h.a.identity.id, sid, 'member').token);
    const jwt = await h.auth(h.a.token, sid), admin = await h.auth(h.b.token, sid), member = await h.auth(d.token, sid);
    const { machineId } = h.store.enroll(h.actor, enrollmentInput()); h.connect(machineId); h.store.associate(h.actor, machineId, sid, true);
    const [reg, concurrent] = await Promise.all([h.request(prefix + '/runtimes', jwt, 'POST', { machineId, flavor: 'codex' }),
        h.request(prefix + '/runtimes', jwt, 'POST', { machineId, flavor: 'codex' })]);
    expect(reg.status).toBe(200); const id = reg.body.runtime.id;
    expect(concurrent.body.runtime.id).toBe(id);
    const other = await h.request(prefix + '/runtimes', jwt, 'POST', { machineId, flavor: 'claude' });
    expect(other.status).toBe(200);
    h.calls.length = 0;
    const governance = await h.request(prefix + '/runtimes', admin);
    expect(governance.body.runtimes).toHaveLength(2);
    expect(h.calls.filter(s => s.includes('agent-availability'))).toHaveLength(0);
    expect((await h.request(prefix + '/runtimes', member)).body.runtimes).toHaveLength(0);
    expect((await h.request(`${prefix}/runtimes/${id}/check`, admin)).body.error.code).toBe('runtime_private');
    expect((await h.request(`${prefix}/spaces/${sid}/blocks/runtime/${id}`, admin, 'PUT', {})).body.blocked).toBe(true);
    expect((await h.request(`${prefix}/runtimes/${id}`, admin)).body.runtime.blockedInSpace).toBe(true);
    expect((await h.request(`${prefix}/spaces/${sid}/blocks/runtime/${id}`, admin, 'DELETE', {})).body.blocked).toBe(false);
    expect((await h.request(`${prefix}/runtimes/${id}/spaces/${sid}`, jwt, 'PUT', {})).status).toBe(200);
    h.calls.length = 0;
    const shared = await h.request(prefix + '/runtimes', member);
    expect(shared.body.runtimes).toHaveLength(1);
    expect(shared.body.runtimes[0]).toMatchObject({ id, inspectionCurrent: true, eligibility: { eligible: true }, permissions: { use: true, manage: false } });
    expect(h.calls.filter(s => s.includes('agent-availability'))).toHaveLength(1);
    const resolved = await h.request(`${prefix}/runtimes/${id}/resolve`, member);
    expect(resolved.body.target).toMatchObject({ runtimeId: id, machineId, flavor: 'codex', spaceId: sid, toolFound: true });
    expect(Object.keys(resolved.body.target).sort()).toEqual(['checkedAt', 'flavor', 'machineId', 'ownerId', 'runtimeId', 'shared', 'spaceId', 'toolFound', 'version', 'versionStatus']);
    const machine = await h.request(`${prefix}/machines/${machineId}`, member);
    for (const result of [governance.body, shared.body, resolved.body, machine.body]) {
        const text = JSON.stringify(result);
        for (const secret of ['/private/host', '/test/bin', 'executable', 'runnerState', 'shareSpaceIds', 'spaceIds']) expect(text).not.toContain(secret);
    }
    expect((await h.request(`${prefix}/machines/${machineId}/discover`, member)).status).toBe(403);
    expect((await h.request(`/api/machines/${machineId}/agent-availability`, member)).status).toBe(404);
    expect((await h.request(`${prefix}/runtimes/${id}`, member, 'PATCH', { name: 'no' })).status).toBe(403);
    h.machines[0].active = false;
    const offline = await h.request(`${prefix}/runtimes/${id}`, member);
    expect(offline.body.runtime).toMatchObject({ version: '1.2.3', inspectionCurrent: false, eligibility: { reason: { code: 'machine_offline' } } });
    expect((await h.request(`${prefix}/runtimes/${id}/resolve`, member)).body.error.code).toBe('machine_offline');
    h.machines[0].active = true;
    h.setProbeFailure({ status: 500, body: { error: '/private/host/raw-native-error' } });
    const failed = await h.request(`${prefix}/runtimes/${id}`, member);
    expect(failed.body.runtime.eligibility.reason.code).toBe('runtime_probe_failed');
    expect(JSON.stringify(failed.body)).not.toContain('/private/host');
});

test('revocation during tool probing rejects resolution and stale registration; no current facts survive unauthorized completion', async () => {
    const h = await httpSetup(), sid = h.a.personalSpace.id, aS = h.access.authenticate(h.a.token, sid);
    const { machineId } = h.store.enroll(h.actor, enrollmentInput()); h.connect(machineId); h.store.associate(h.actor, machineId, sid, true);
    const row = h.store.registerRuntime(h.actor, { machineId, flavor: 'codex' }, resourceInspection('codex'));
    const owner = await h.auth(h.a.token, sid), member = await h.auth(h.b.token, sid);
    const other = new HubResourceStore(h.other);
    h.store.share(h.actor, row.id, sid, true);
    h.setProbeHook(() => { other.share(h.actor, row.id, sid, false); });
    expect((await h.request(`${prefix}/runtimes/${row.id}/resolve`, member)).body.error.code).toBe('runtime_private');
    h.setProbeHook(() => { other.block(h.member, sid, 'runtime', row.id, true); });
    expect((await h.request(`${prefix}/runtimes/${row.id}/resolve`, owner)).body.error.code).toBe('resource_space_blocked');
    other.block(h.member, sid, 'runtime', row.id, false);
    h.setProbeHook(() => { other.register(h.actor, machineId, false); });
    expect((await h.request(prefix + '/runtimes', owner, 'POST', { machineId, flavor: 'claude' })).body.error.code).toBe('machine_unregistered');
    expect(h.store.runtimes(aS).map(r => r.flavor)).toEqual(['codex']);
    other.register(h.actor, machineId, true);
    h.setProbeHook(() => { other.unregisterRuntime(h.actor, row.id); });
    expect((await h.request(prefix + '/runtimes', owner, 'POST', { machineId, flavor: 'codex' })).body.error.code).toBe('runtime_unregistered');
    expect(h.store.runtime(h.actor, row.id).registered).toBe(false);
    other.registerRuntime(h.actor, { machineId, flavor: 'codex' }, resourceInspection('codex'));
    other.share(h.actor, row.id, sid, true);
    h.setProbeHook(() => { h.hub.changeMember(h.a.identity.id, sid, h.b.identity.id, null); });
    expect((await h.request(`${prefix}/runtimes/${row.id}/resolve`, member)).status).toBe(401);
});

test('native scoped spawn/derive checks resource policy, including machine peer resume using the task owner', async () => {
    const h = await httpSetup(), sid = h.a.personalSpace.id;
    const input = enrollmentInput(), { machineId } = h.store.enroll(h.actor, input); h.connect(machineId); h.store.associate(h.actor, machineId, sid, true);
    const runtime = h.store.registerRuntime(h.actor, { machineId, flavor: 'codex' }, resourceInspection('codex'));
    const owner = await h.auth(h.a.token, sid), machine = await h.auth(input.token);
    const sessionId = randomUUID();
    h.access.bind({ kind: 'session', id: sessionId, ownerId: h.b.identity.id, spaceId: sid, machineId });
    h.sessions.set(sessionId, { id: sessionId, metadata: { machineId, flavor: 'codex' } });
    const request = { directory: '/workspace', agent: 'codex' };
    h.store.block(h.member, sid, 'runtime', runtime.id, true);
    expect((await h.request(`/api/machines/${machineId}/spawn`, owner, 'POST', request)).body.error.code).toBe('resource_space_blocked');
    h.store.block(h.member, sid, 'runtime', runtime.id, false);
    expect((await h.request(`/api/sessions/${sessionId}/resume`, machine, 'POST', {})).body.error.code).toBe('runtime_private');
    h.store.share(h.actor, runtime.id, sid, true);
    h.store.block(h.member, sid, 'machine', machineId, true);
    expect((await h.request(`/api/sessions/${sessionId}/resume`, machine, 'POST', {})).body.error.code).toBe('resource_space_blocked');
    expect(h.calls.filter(c => c.startsWith('POST'))).toHaveLength(0); // Nothing reaches the native execution boundary.
});

test('one probe per machine preserves independent failures and does not treat owner global inspection as an execution target', async () => {
    const h = await httpSetup(), sid = h.a.personalSpace.id;
    const jwt = await h.auth(h.a.token, sid), global = await h.auth(h.a.token);
    const ids: string[] = [];
    for (let n = 0; n < 2; n++) {
        const { machineId } = h.store.enroll(h.actor, enrollmentInput()); ids.push(machineId);
        h.store.associate(h.actor, machineId, sid, true); h.connect(machineId);
        for (const flavor of ['codex', 'claude'] as const) h.store.registerRuntime(h.actor, { machineId, flavor }, resourceInspection(flavor));
    }
    h.setProbeHook(id => { h.setProbeFailure(id === ids[0] ? { status: 401, body: { error: '/private/native-auth-path' } } : undefined); });
    const result = await h.request(prefix + '/runtimes', jwt);
    expect(result.body.runtimes).toHaveLength(4);
    expect(result.body.runtimes.filter((r: any) => r.eligibility.eligible)).toHaveLength(2);
    expect(h.calls.filter(c => c.includes('agent-availability'))).toHaveLength(2);
    expect(JSON.stringify(result.body)).not.toContain('/private/native-auth-path');
    const healthy = result.body.runtimes.find((r: any) => r.eligibility.eligible);
    expect((await h.request(`${prefix}/runtimes/${healthy.id}/check`, global)).body.runtime.inspectionCurrent).toBe(true);
    expect((await h.request(`${prefix}/runtimes/${healthy.id}/resolve`, global)).body.error.code).toBe('resource_space_required');
});

test('v11 upgrade retains machine enrollment, credential and space association without inventing runtimes', () => {
    const h = setup(), input = enrollmentInput(), enrolled = h.store.enroll(h.actor, input);
    h.store.associate(h.actor, enrolled.machineId, h.a.personalSpace.id, true);
    const db = new Database(h.path);
    try {
        db.exec('DROP TABLE hub_agent_selections; DROP TABLE hub_agent_blocks; DROP TABLE hub_agent_members; DROP TABLE hub_agent_versions; DROP TABLE hub_agents; DROP TABLE hub_checkouts; DROP TABLE hub_repository_aliases; DROP TABLE hub_repositories; DROP TABLE hub_resource_blocks; DROP TABLE hub_runtime_shares; DROP TABLE hub_resource_runtimes; PRAGMA user_version=11;');
        const access = new AccessStore(h.path), store = new HubResourceStore(access);
        try {
            expect(store.enroll(h.actor, input)).toEqual(enrolled);
            expect(store.spaces(h.actor, enrolled.machineId)).toEqual([h.a.personalSpace.id]);
            expect(store.runtimes(h.actor)).toEqual([]);
            expect(access.authenticate(input.token).machineId).toBe(enrolled.machineId);
        } finally { access.close(); }
    } finally { db.close(); }
});
