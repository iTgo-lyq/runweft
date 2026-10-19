import { createTestIdentity } from '../identity-fixture';
import { afterEach, expect, test } from 'bun:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { HubAgentStore } from '../../src/hub/agents/store';
import { HubAgentClient } from '../../src/hub/agents/client';
import type { AgentView } from '../../src/hub/agents/types';
import { RepositoryStore } from '../../src/hub/repositories/store';
import { setupHubResources, hubResourceFixture } from './hub-resources-fixture';
import { resourceInspection } from './native-fixture';

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanups.splice(0).reverse()) await fn(); });
const code = (fn: () => unknown, wanted: string) => { try { fn(); throw new Error('expected failure'); } catch (e) { expect(e).toMatchObject({ code: wanted }); } };
const definition = (v: AgentView) => { if (v.view !== 'definition') throw new Error('definition unavailable'); return v.definition; };
function setup() {
    const h = setupHubResources(cleanups), space = h.a.personalSpace.id;
    h.hub.acceptInvitation(h.c.identity.id, h.hub.invite(h.a.identity.id, space, 'member').token);
    const actor = h.access.authenticate(h.a.token, space), admin = h.access.authenticate(h.b.token, space), member = h.access.authenticate(h.c.token, space);
    const repos = new RepositoryStore(h.store), agents = new HubAgentStore(repos), other = new HubAgentStore(new RepositoryStore(h.second));
    return { ...h, space, actor, admin, member, repos, agents, other };
}
const create = (h: ReturnType<typeof setup>, owner = h.actor, values: object = {}) => h.agents.create(owner, { requestId: randomUUID(), definition: { name: 'Builder', instructions: 'PRIVATE INSTRUCTIONS', ...values } });
function runtime(h: ReturnType<typeof setup>, who = h.actor, flavor: 'codex' | 'claude' = 'codex') {
    const machine = h.store.enroll(who, { requestId: randomUUID(), token: `rw_mc_${randomBytes(32).toString('base64url')}` });
    h.store.associate(who, machine.machineId, h.space, true);
    return h.store.registerRuntime(who, { machineId: machine.machineId, flavor }, resourceInspection(flavor));
}

test('private Agent owner, shared consumers and governance admins get distinct DTOs and never gain editing/history rights by sharing', () => {
    const h = setup(), r = runtime(h), agent = create(h, h.actor, { runtimeId: r.id, flavor: 'codex', model: 'PRIVATE MODEL', reasoningEffort: 'PRIVATE EFFORT' });
    expect(h.agents.list(h.member)).toEqual([]);
    code(() => h.agents.agent(h.member, agent.id), 'hub_object_not_found');
    const summary = h.agents.agent(h.admin, agent.id);
    expect(summary).toMatchObject({ id: agent.id, view: 'governance', permissions: { edit: false, share: false, invoke: false, history: false, readDefinition: false, govern: true } });
    for (const secret of ['PRIVATE INSTRUCTIONS', 'PRIVATE MODEL', 'PRIVATE EFFORT', r.id, 'contentHash', 'definition', 'memberIds']) expect(JSON.stringify(summary)).not.toContain(secret);
    for (const actor of [h.admin, h.member]) {
        const wanted = actor === h.admin ? 'agent_owner_required' : 'hub_object_not_found';
        code(() => h.agents.update(actor, agent.id, { expectedVersion: 1, definition: { name: 'Hijack' } }), wanted);
        code(() => h.agents.access(actor, agent.id, { mode: 'space' }), wanted);
        code(() => h.agents.register(actor, agent.id, false), wanted);
        code(() => h.agents.versions(actor, agent.id), wanted);
    }
    h.agents.access(h.actor, agent.id, { mode: 'members', memberIds: [h.member.ownerId, h.member.ownerId] });
    const shared = h.agents.agent(h.member, agent.id);
    expect(shared).toMatchObject({ view: 'definition', definition: { instructions: 'PRIVATE INSTRUCTIONS' }, permissions: { readDefinition: true, invoke: true, edit: false, history: false } });
    expect(shared).not.toHaveProperty('memberIds'); expect(h.agents.agent(h.actor, agent.id)).toMatchObject({ memberIds: [h.member.ownerId] });
    expect(h.agents.agent(h.admin, agent.id).view).toBe('governance');
    code(() => h.agents.versions(h.member, agent.id), 'agent_owner_required');
    code(() => h.agents.block(h.member, agent.id, true), 'space_action_forbidden');
    h.agents.access(h.actor, agent.id, { mode: 'space' }); expect(h.agents.agent(h.admin, agent.id).view).toBe('definition');
    code(() => h.agents.update(h.admin, agent.id, { expectedVersion: 1, definition: { name: 'Hijack' } }), 'agent_owner_required');
    const same = create(h, h.member); expect(same.name).toBe(agent.name); expect(same.id).not.toBe(agent.id);
    expect(h.agents.list(h.actor)).toHaveLength(2);
    const another = h.access.authenticate(h.a.token, h.hub.createSpace(h.a.identity.id, 'Other').id);
    code(() => h.agents.agent(another, agent.id), 'hub_object_not_found');
});

test('content versions are immutable; request replay and CAS cannot overwrite later edits, scope, governance or registration', () => {
    const h = setup(), requestId = randomUUID(), body = { requestId, definition: { name: 'Builder', instructions: 'v1' } };
    const agent = h.agents.create(h.actor, body), version1 = h.agents.versions(h.actor, agent.id)[0];
    const repo = h.repos.create(h.actor, { requestId: randomUUID(), name: 'Project' });
    const edited = h.other.update(h.actor, agent.id, { expectedVersion: 1, definition: { name: 'Builder', instructions: 'v2', repositoryId: repo.id } });
    expect(edited.version).toBe(2); expect(edited.repositoryId).toBe(repo.id); expect(h.agents.versions(h.actor, agent.id)[0]).toEqual(version1);
    code(() => h.agents.update(h.actor, agent.id, { expectedVersion: 1, definition: { name: 'lost write' } }), 'agent_version_conflict');
    h.agents.access(h.actor, agent.id, { mode: 'space' }); h.agents.block(h.admin, agent.id, true); h.agents.register(h.actor, agent.id, false);
    expect(h.agents.create(h.actor, body)).toMatchObject({ id: agent.id, version: 2, blocked: true, registered: false, accessMode: 'space' });
    expect(h.agents.receipt(h.actor, requestId)).toEqual(h.agents.agent(h.actor, agent.id));
    code(() => h.agents.create(h.actor, { ...body, definition: { name: 'different' } }), 'agent_request_conflict');
    code(() => h.agents.receipt(h.admin, requestId), 'hub_object_not_found');
    expect(h.agents.versions(h.actor, agent.id)).toHaveLength(2);
    h.agents.register(h.actor, agent.id, true);
    expect(h.agents.invocable(h.actor.ownerId, h.space, agent.id, repo.id).reason?.code).toBe('agent_blocked');
    const v3 = h.agents.update(h.actor, agent.id, { expectedVersion: 2, definition: { ...definition(edited), instructions: 'v3' } });
    expect(v3.blocked).toBe(true); h.agents.access(h.actor, agent.id, { mode: 'private' }); expect(h.agents.agent(h.actor, agent.id).blocked).toBe(true);
    h.agents.block(h.admin, agent.id, false);
    expect(h.agents.invocable(h.actor.ownerId, h.space, agent.id, null).reason?.code).toBe('agent_repository_mismatch');
    expect(h.agents.invocable(h.actor.ownerId, h.space, agent.id, repo.id).eligible).toBe(true);
    h.repos.register(h.admin, repo.id, false); expect(h.agents.invocable(h.actor.ownerId, h.space, agent.id, repo.id).reason?.code).toBe('repository_unregistered');
    const v4 = h.agents.update(h.actor, agent.id, { expectedVersion: 3, definition: { name: 'Cross repositories', instructions: 'v4' } });
    expect(v4.repositoryId).toBeNull(); expect(h.agents.invocable(h.actor.ownerId, h.space, agent.id, null).eligible).toBe(true);
});

test('membership removal clears explicit recipient grants and revokes departed owner sharing without rewriting versions or undoing governance', () => {
    const h = setup(), one = create(h), two = create(h, h.member);
    h.agents.access(h.actor, one.id, { mode: 'members', memberIds: [h.member.ownerId] });
    h.agents.access(h.member, two.id, { mode: 'space' }); h.agents.block(h.admin, two.id, true);
    const history = h.agents.versions(h.member, two.id);
    h.hub.changeMember(h.a.identity.id, h.space, h.c.identity.id, null);
    code(() => h.agents.update(h.member, two.id, { expectedVersion: 1, definition: { name: 'Departed' } }), 'user_session_invalid');
    expect(h.agents.agent(h.actor, two.id)).toMatchObject({ accessMode: 'private', view: 'governance', ownerPresent: false, blocked: true });
    expect(h.agents.agent(h.actor, one.id)).toMatchObject({ memberIds: [] });
    h.hub.acceptInvitation(h.c.identity.id, h.hub.invite(h.a.identity.id, h.space, 'member').token);
    const rejoined = h.access.authenticate(h.c.token, h.space);
    code(() => h.agents.agent(rejoined, one.id), 'hub_object_not_found');
    expect(h.agents.agent(rejoined, two.id)).toMatchObject({ accessMode: 'private', blocked: true, registered: true });
    expect(h.agents.versions(rejoined, two.id)).toEqual(history);
    h.agents.access(h.actor, one.id, { mode: 'space' });
    h.hub.changeMember(h.a.identity.id, h.space, h.c.identity.id, null);
    h.hub.acceptInvitation(h.c.identity.id, h.hub.invite(h.a.identity.id, h.space, 'member').token);
    expect(h.agents.agent(h.access.authenticate(h.c.token, h.space), one.id).view).toBe('definition');
});

test('new runtime bindings require current rights and flavor; existing failed targets remain editable without silent rebinding or model execution', () => {
    const h = setup(), r = runtime(h, h.member), repo = h.repos.create(h.actor, { requestId: randomUUID(), name: 'Project' });
    code(() => create(h, h.actor, { runtimeId: r.id }), 'runtime_private');
    h.store.share(h.member, r.id, h.space, true);
    code(() => create(h, h.actor, { runtimeId: r.id, flavor: 'claude' }), 'agent_flavor_mismatch');
    const bound = create(h, h.actor, { runtimeId: r.id, flavor: 'codex' });
    h.store.share(h.member, r.id, h.space, false); h.store.unregisterRuntime(h.member, r.id);
    const edited = h.agents.update(h.actor, bound.id, { expectedVersion: 1, definition: { ...definition(bound), instructions: 'adjusted' } });
    expect(definition(edited).runtimeId).toBe(r.id); expect(definition(edited).instructions).toBe('adjusted');
    code(() => create(h, h.actor, { model: 'configured-without-flavor' }), 'agent_input_invalid');
    code(() => create(h, h.actor, { command: 'unexpected launcher' }), 'agent_input_invalid');
    code(() => create(h, h.actor, { instructions: 'a'.repeat(32769) }), 'agent_input_invalid');
    const unrelated = createTestIdentity(h.hub, 'outside');
    code(() => h.agents.access(h.actor, bound.id, { mode: 'members', memberIds: [unrelated.identity.id] }), 'agent_member_unknown');
    h.repos.register(h.actor, repo.id, false); code(() => create(h, h.actor, { repositoryId: repo.id }), 'repository_unregistered');
    const cleared = h.agents.update(h.actor, bound.id, { expectedVersion: 2, definition: { name: 'Unbound' } }); expect(definition(cleared).runtimeId).toBeNull();
});

test('HTTP/client permission checks whitelist governance responses, enforce body limits and invalidate cached access after removal', async () => {
    const h = await hubResourceFixture(cleanups, true), space = h.a.personalSpace.id;
    const owner = new HubAgentClient({ url: h.url, space, credential: { token: h.a.token }, env: {} });
    const admin = new HubAgentClient({ url: h.url, space, credential: { token: h.b.token }, env: {} });
    const created = await owner.create(randomUUID(), { name: 'Agent', instructions: 'private text', flavor: 'claude', model: 'private model' });
    const id = created.agent.id; expect((await admin.agent(id)).agent.view).toBe('governance');
    expect(JSON.stringify(await admin.list())).not.toContain('private text');
    await expect(admin.update(id, 1, { name: 'Overwrite' })).rejects.toMatchObject({ code: 'agent_owner_required' });
    await expect(admin.versions(id)).rejects.toMatchObject({ code: 'agent_owner_required' });
    expect((await owner.access(id, 'members', [h.b.identity.id])).agent.accessMode).toBe('members');
    expect((await admin.agent(id)).agent.view).toBe('definition');
    expect((await admin.block(id, true)).agent.blocked).toBe(true);
    expect((await owner.register(id, false)).agent.version).toBe(1);
    expect((await owner.register(id, true)).agent.blocked).toBe(true);
    expect((await admin.block(id, false)).agent.blocked).toBe(false);
    const token = await h.auth(h.a.token, space);
    for (const body of [{ requestId: randomUUID(), definition: { name: 'Agent' }, ownerId: h.b.identity.id },
        { requestId: randomUUID(), definition: { name: 'Agent', runtime: randomUUID() } }]) expect((await h.request('/api/runweft/agents', token, 'POST', body)).status).toBe(400);
    const tooLarge = await h.request('/api/runweft/agents', token, 'POST', { requestId: randomUUID(), definition: { name: 'Agent', instructions: 'HIDDEN'.repeat(15_000) } });
    expect(tooLarge.status).toBe(413); expect(JSON.stringify(tooLarge.body)).not.toContain('HIDDEN');
    h.hub.changeMember(h.a.identity.id, space, h.b.identity.id, 'member');
    await expect(admin.block(id, true)).rejects.toMatchObject({ code: 'space_action_forbidden' });
    await owner.access(id, 'private');
    expect((await admin.list()).agents).toEqual([]);
    await expect(admin.agent(id)).rejects.toMatchObject({ code: 'hub_object_not_found' });
    h.hub.changeMember(h.a.identity.id, space, h.b.identity.id, null);
    await expect(admin.agent(id)).rejects.toMatchObject({ code: 'user_session_invalid' });
    expect(h.calls).toEqual([]);
});
