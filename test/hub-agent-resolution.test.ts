import { afterEach, expect, test } from 'bun:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { HubAgentStore } from '../src/hub/agents/store';
import { AgentSelectionStore } from '../src/hub/agents/selections';
import { HubAgentClient } from '../src/hub/agents/client';
import { RepositoryStore } from '../src/hub/repositories/store';
import type { Principal } from '../src/hub/access/types';
import type { AgentView } from '../src/hub/agents/types';
import { hubResourceFixture } from './hub-resources-fixture';
import { resourceInspection } from './resources-fixture';
import { openState, STATE_SCHEMA_VERSION } from '../src/state';

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanups.splice(0).reverse()) await fn(); });
function def(v: AgentView) { if (v.view !== 'definition') throw new Error('private'); return v.definition; }
async function setup() {
    const h = await hubResourceFixture(cleanups, true), space = h.a.personalSpace.id;
    h.hub.acceptInvitation(h.c.identity.id, h.hub.invite(h.a.identity.id, space, 'member').token);
    const actor = h.access.authenticate(h.a.token, space), member = h.access.authenticate(h.c.token, space), admin = h.access.authenticate(h.b.token, space);
    const repos = new RepositoryStore(h.store), agents = new HubAgentStore(repos), selections = new AgentSelectionStore(agents);
    const client = (token = h.a.token) => new HubAgentClient({ url: h.url, space, env: { RUNWEFT_IDENTITY_TOKEN: token } });
    const runtime = (who: Principal = actor, flavor: 'codex' | 'claude' = 'codex') => {
        const m = h.store.enroll(who, { requestId: randomUUID(), token: `rw_mc_${randomBytes(32).toString('base64url')}` });
        h.store.associate(who, m.machineId, space, true); h.connect(m.machineId);
        return h.store.registerRuntime(who, { machineId: m.machineId, flavor }, resourceInspection(flavor));
    };
    const agent = (definition: object = {}, who: Principal = actor) => agents.create(who, { requestId: randomUUID(), definition: { name: 'Agent', ...definition } });
    return { ...h, space, actor, member, admin, repos, agents, selections, client, runtime, agent };
}

test('Agent selection is explicit then personal repository then space; same-name catalogs do not choose for the caller', async () => {
    const h = await setup(), c = h.client(), r = h.runtime(), repo = h.repos.create(h.actor, { requestId: randomUUID(), name: 'Project' });
    const global = h.agent({ runtimeId: r.id }), project = h.agent({ repositoryId: repo.id, runtimeId: r.id });
    await expect(c.resolve()).rejects.toMatchObject({ code: 'agent_selection_required' });
    await expect(c.select(project.id)).rejects.toMatchObject({ code: 'agent_repository_mismatch' });
    await c.select(global.id); expect((await c.resolve()).resolution).toMatchObject({ agentId: global.id, selection: { agent: 'space', runtime: 'definition' } });
    await c.select(project.id, repo.id);
    expect((await c.resolve({ hubRepositoryId: repo.id })).resolution).toMatchObject({ agentId: project.id, selection: { agent: 'repository' } });
    expect((await c.resolve({ hubRepositoryId: repo.id, agentId: global.id })).resolution.selection.agent).toBe('explicit');
    h.agents.register(h.actor, project.id, false);
    await expect(c.resolve({ hubRepositoryId: repo.id })).rejects.toMatchObject({ code: 'agent_unregistered' });
    expect((await c.resolve({ hubRepositoryId: repo.id, agentId: global.id })).resolution.agentId).toBe(global.id);
    expect((await c.selections()).selections).toHaveLength(2); // stale selection is retained, never erased by preview
    await c.unselect(repo.id); expect((await c.resolve({ hubRepositoryId: repo.id })).resolution.agentId).toBe(global.id);
    await c.unselect(); await expect(c.resolve()).rejects.toMatchObject({ code: 'agent_selection_required' });
    await expect(c.resolve({ agentId: project.id })).rejects.toMatchObject({ code: 'agent_unregistered' });
});

test('runtime overrides use explicit, matching repository, matching space then definition; failed chosen layers never fall through', async () => {
    const h = await setup(), c = h.client(), base = h.runtime(), space = h.runtime(), project = h.runtime(), explicit = h.runtime();
    const a = h.agent({ runtimeId: base.id }), b = h.agent({ runtimeId: base.id }), repo = h.repos.create(h.actor, { requestId: randomUUID(), name: 'Project' });
    await c.select(a.id, null, space.id); await c.select(a.id, repo.id, project.id);
    const request = { hubRepositoryId: repo.id };
    expect((await c.resolve(request)).resolution).toMatchObject({ target: { runtimeId: project.id }, selection: { runtime: 'repository' } });
    expect((await c.resolve({ ...request, runtimeId: explicit.id })).resolution.selection.runtime).toBe('explicit');
    h.store.unregisterRuntime(h.actor, project.id);
    await expect(c.resolve(request)).rejects.toMatchObject({ code: 'runtime_unregistered' });
    expect((await c.resolve({ ...request, runtimeId: explicit.id })).resolution.target.runtimeId).toBe(explicit.id);
    expect((await c.resolve({ ...request, agentId: b.id })).resolution).toMatchObject({ target: { runtimeId: base.id }, selection: { runtime: 'definition' } });
    await c.select(a.id, repo.id); expect((await c.resolve(request)).resolution).toMatchObject({ target: { runtimeId: space.id }, selection: { runtime: 'space' } });
    await c.unselect(); expect((await c.resolve(request)).resolution.target.runtimeId).toBe(base.id);
    const unbound = h.agent(); await expect(c.resolve({ agentId: unbound.id })).rejects.toMatchObject({ code: 'agent_runtime_required' });
    expect((await c.resolve({ agentId: unbound.id, runtimeId: explicit.id })).resolution.target.runtimeId).toBe(explicit.id);
});

test('shared Agent and runtime authorization intersect without lending owner privileges; choices are private and flavor checked', async () => {
    const h = await setup(), owner = h.client(), member = h.client(h.c.token), privateRuntime = h.runtime(), personalRuntime = h.runtime(h.member), claude = h.runtime(h.member, 'claude');
    const a = h.agent({ runtimeId: privateRuntime.id, flavor: 'codex', model: 'model-choice', reasoningEffort: 'high' });
    h.agents.access(h.actor, a.id, { mode: 'space' });
    await member.select(a.id); // Choosing a role is separate from having access to its bound runtime.
    await expect(member.resolve()).rejects.toMatchObject({ code: 'runtime_private' });
    await expect(member.select(a.id, null, privateRuntime.id)).rejects.toMatchObject({ code: 'runtime_private' });
    await expect(member.select(a.id, null, claude.id)).rejects.toMatchObject({ code: 'agent_flavor_mismatch' });
    await member.select(a.id, null, personalRuntime.id);
    const resolved = (await member.resolve()).resolution;
    expect(resolved).toMatchObject({ actorId: h.member.ownerId, agentOwnerId: h.actor.ownerId, target: { runtimeId: personalRuntime.id },
        launchOptions: { agent: 'codex', model: 'model-choice', modelReasoningEffort: 'high', disabledMcpServers: ['runweft'] }, execution: 'not_checked' });
    expect(resolved.launchOptions).not.toHaveProperty('permissionMode'); expect(resolved.target).not.toHaveProperty('inspection');
    expect((await owner.selections()).selections).toEqual([]);
    const jwt = await h.auth(h.c.token, h.space);
    const forged = await h.request('/api/runweft/agent-selections', jwt, 'PUT', { userId: h.a.identity.id, agentId: a.id }); expect(forged.status).toBe(400);
    h.store.share(h.actor, privateRuntime.id, h.space, true); await member.select(a.id);
    expect((await member.resolve()).resolution.target.runtimeId).toBe(privateRuntime.id);
    h.store.block(h.admin, h.space, 'runtime', privateRuntime.id, true);
    await expect(member.resolve()).rejects.toMatchObject({ code: 'resource_space_blocked' });
    h.store.block(h.admin, h.space, 'runtime', privateRuntime.id, false);
    h.agents.block(h.admin, a.id, true); await expect(member.resolve()).rejects.toMatchObject({ code: 'agent_blocked' });
    h.agents.block(h.admin, a.id, false); h.agents.access(h.actor, a.id, { mode: 'private' });
    await expect(member.resolve()).rejects.toMatchObject({ code: 'hub_object_not_found' });
    expect((await member.selections()).selections).toHaveLength(1);
    h.hub.changeMember(h.a.identity.id, h.space, h.c.identity.id, null);
    h.hub.acceptInvitation(h.c.identity.id, h.hub.invite(h.a.identity.id, h.space, 'member').token);
    expect((await h.client(h.c.token).selections()).selections).toEqual([]);
    const claudeAgent = h.agent({ flavor: 'claude', model: 'claude-model', reasoningEffort: 'high' }, h.member);
    // Member removal detached the machine: restore association explicitly before using it again.
    h.store.associate(h.member, claude.machineId, h.space, true);
    const cc = (await member.resolve({ agentId: claudeAgent.id, runtimeId: claude.id })).resolution;
    expect(cc.launchOptions).toEqual({ agent: 'claude', model: 'claude-model', effort: 'high', disabledMcpServers: ['runweft'] });
});

test('resolution snapshots retain content, identity and targets; observation time is excluded from version identity and no native execution starts', async () => {
    const h = await setup(), r = h.runtime(), a = h.agent({ runtimeId: r.id, instructions: 'initial' }), c = h.client();
    const initial = (await c.resolve({ agentId: a.id })).resolution, repeated = (await c.resolve({ agentId: a.id })).resolution;
    expect(initial.resolvedVersion).toBe(repeated.resolvedVersion);
    h.agents.update(h.actor, a.id, { expectedVersion: 1, definition: { ...def(a), instructions: 'edited' } });
    const next = (await c.resolve({ agentId: a.id })).resolution;
    expect(initial.definition.instructions).toBe('initial'); expect(initial.version).toBe(1); expect(next.version).toBe(2);
    expect(next.resolvedVersion).not.toBe(initial.resolvedVersion); expect(initial.target.runtimeId).toBe(r.id);
    expect(h.calls.every(call => call.startsWith('GET ') && !call.includes('/sessions'))).toBe(true);
    expect(h.access.db.query('SELECT COUNT(*) AS n FROM delegation_tasks').get()).toEqual({ n: 0 });
    const jwt = await h.auth(h.a.token, h.space);
    expect((await h.request('/api/runweft/agent-resolution', jwt, 'POST', initial)).status).toBe(400);
});

test('asynchronous probe rechecks content, preferences, sharing, runtime authority, repository and membership before returning a snapshot', async () => {
    for (const scenario of ['content', 'flavor', 'preference', 'sharing', 'runtime', 'repository', 'membership'] as const) {
        const h = await setup(), r = h.runtime(), other = h.runtime(), repo = h.repos.create(h.actor, { requestId: randomUUID(), name: 'Project' });
        const a = h.agent({ runtimeId: r.id }), member = h.client(h.c.token);
        h.agents.access(h.actor, a.id, { mode: 'space' }); h.store.share(h.actor, r.id, h.space, true); h.store.share(h.actor, other.id, h.space, true);
        await member.select(a.id, repo.id);
        let started!: () => void, release!: () => void;
        const waiting = new Promise<void>(r => { started = r; }), gate = new Promise<void>(r => { release = r; });
        h.setProbeHook(async () => { started(); await gate; });
        const outcome = member.resolve({ hubRepositoryId: repo.id }).catch(e => e);
        await waiting;
        if (scenario === 'content') h.agents.update(h.actor, a.id, { expectedVersion: 1, definition: { name: 'edited', runtimeId: r.id } });
        if (scenario === 'flavor') h.agents.update(h.actor, a.id, { expectedVersion: 1, definition: { name: 'changed type', runtimeId: r.id, flavor: 'claude' } });
        if (scenario === 'preference') h.selections.set(h.member, { repositoryId: repo.id, agentId: a.id, runtimeId: other.id });
        if (scenario === 'sharing') h.agents.access(h.actor, a.id, { mode: 'private' });
        if (scenario === 'runtime') h.store.share(h.actor, r.id, h.space, false);
        if (scenario === 'repository') h.repos.register(h.actor, repo.id, false);
        if (scenario === 'membership') h.hub.changeMember(h.a.identity.id, h.space, h.c.identity.id, null);
        release(); const result = await outcome;
        expect(result.code).toBe({ content: 'agent_configuration_changed', flavor: 'agent_configuration_changed', preference: 'agent_configuration_changed', sharing: 'hub_object_not_found', runtime: 'runtime_private', repository: 'repository_unregistered', membership: 'identity_token_invalid' }[scenario]);
    }
}, 20_000);

test('space defaults are unique under parallel PUT and schema 14 upgrade preserves existing Agent versions', async () => {
    const h = await setup(), c = h.client(), r = h.runtime(), a = h.agent({ runtimeId: r.id }), b = h.agent({ runtimeId: r.id });
    await Promise.all(Array.from({ length: 8 }, (_, i) => c.select(i % 2 ? a.id : b.id)));
    expect((await c.selections()).selections).toHaveLength(1);
    expect(h.access.db.query('SELECT COUNT(*) AS n FROM hub_agent_selections WHERE repositoryId IS NULL').get()).toEqual({ n: 1 });
    h.access.db.exec('DROP TABLE hub_agent_selections; PRAGMA user_version=14;');
    const db = openState(h.path);
    try { expect(db.query('PRAGMA user_version').get()).toEqual({ user_version: STATE_SCHEMA_VERSION }); expect(db.query('SELECT COUNT(*) AS n FROM hub_agent_versions').get()).toEqual({ n: 2 }); expect(db.query('SELECT COUNT(*) AS n FROM hub_agent_selections').get()).toEqual({ n: 0 }); }
    finally { db.close(); }
});
