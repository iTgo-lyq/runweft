import { replaceTestCredential } from '../identity-fixture';
import { afterEach, expect, test } from 'bun:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RepositoryStore } from '../../src/hub/repositories/store';
import { repositoryAlias, observeRemote } from '../../src/hub/repositories/identity';
import { observeRepository, remoteFingerprint, type GitObservation } from '../../src/hub/repositories/observation';
import { HubRepositoryClient } from '../../src/hub/repositories/client';
import { HubResourceClient } from '../../src/hub/resources/client';
import { STATE_SCHEMA_VERSION, openState } from '../../src/state';
import { setupHubResources, hubResourceFixture } from './hub-resources-fixture';

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanups.splice(0).reverse()) await fn(); });
const code = (action: () => unknown, expected: string) => { try { action(); throw new Error('expected failure'); } catch (e) { expect(e).toMatchObject({ code: expected }); } };
const prefix = '/api/runweft/repositories';
function setup() {
    const h = setupHubResources(cleanups), space = h.a.personalSpace.id;
    return { ...h, space, actor: h.access.authenticate(h.a.token, space), admin: h.access.authenticate(h.b.token, space),
        repos: new RepositoryStore(h.store), otherRepos: new RepositoryStore(h.second) };
}
function machine(h: ReturnType<typeof setup>, who = h.actor) { return h.store.enroll(who, { requestId: randomUUID(), token: `rw_mc_${randomBytes(32).toString('base64url')}` }).machineId; }
const create = (h: ReturnType<typeof setup>, name = 'Repo', aliases: unknown[] = ['https://example.invalid/team/repo.git']) => h.repos.create(h.actor, { requestId: randomUUID(), name, aliases });
function git(home: string, ...args: string[]) {
    return execFileSync('git', args, { cwd: home, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env,
        GIT_CONFIG_GLOBAL: join(home, 'empty-config'), GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
        GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' } }).trim();
}
function source(home: string) {
    const root = join(home, 'source'); git(home, 'init', root); writeFileSync(join(root, 'file'), 'initial\n');
    git(home, '-C', root, 'add', 'file'); git(home, '-C', root, 'commit', '-m', 'initial'); return root;
}

test('canonical URL and descriptor paths agree, strip credentials, preserve fork/transport/path/user distinctions', () => {
    const url = 'https://alice:SUPER_SECRET@EXAMPLE.invalid:443/team/repo.git/';
    const canonical = repositoryAlias(url);
    expect(repositoryAlias(observeRemote(url))).toEqual(canonical);
    expect(repositoryAlias('https://example.invalid/team/repo')).toEqual(canonical);
    expect(JSON.stringify(canonical)).not.toContain('SUPER_SECRET');
    for (const other of ['https://example.invalid/fork/repo', 'http://example.invalid/team/repo', 'ssh://git@example.invalid/team/repo'])
        expect(repositoryAlias(other).canonicalKey).not.toBe(canonical.canonicalKey);
    const ssh = repositoryAlias('ssh://git@example.invalid/team/repo');
    expect(repositoryAlias('ssh://other@example.invalid/team/repo').canonicalKey).not.toBe(ssh.canonicalKey);
    for (const invalid of ['https://example.invalid/team/repo?q=SECRET', 'https://example.invalid/a/%2e%2e/repo', 'file:///local/repo']) {
        code(() => repositoryAlias(invalid), 'repository_url_invalid');
        expect(JSON.stringify(observeRemote(invalid))).not.toContain('SECRET');
    }
});

test('real clones and worktrees match stable configuration; multi-remotes, drift, explicit binding and local remotes remain distinct', () => {
    const h = setup(), m = machine(h), repo = create(h), root = source(h.home), clone = join(h.home, 'clone'), worktree = join(h.home, 'branch');
    git(h.home, 'clone', root, clone); git(h.home, '-C', root, 'worktree', 'add', '-b', 'other', worktree);
    for (const path of [root, clone]) {
        if (path === root) git(h.home, '-C', path, 'remote', 'add', 'origin', 'https://example.invalid/team/repo');
        else git(h.home, '-C', path, 'remote', 'set-url', 'origin', 'https://example.invalid/team/repo.git');
    }
    const a = observeRepository(root) as GitObservation, b = observeRepository(clone) as GitObservation, w = observeRepository(worktree) as GitObservation;
    expect(a.gitCommonDir).toBe(w.gitCommonDir); expect(a.gitCommonDir).not.toBe(b.gitCommonDir); expect(w.repositoryRoot).not.toBe(a.repositoryRoot);
    for (const seen of [a, b, w]) expect(h.repos.match(h.actor, { machineId: m, observation: seen })).toMatchObject({ status: 'matched', source: 'aliases', repository: { id: repo.id } });
    expect(h.repos.checkouts(h.actor)).toEqual([]); // observation is read-only
    const bound = h.repos.bind(h.actor, { machineId: m, observation: a, repositoryId: repo.id });
    expect(h.repos.match(h.actor, { machineId: m, observation: w })).toMatchObject({ status: 'matched', source: 'checkout' });
    h.repos.bind(h.actor, { machineId: m, observation: w, repositoryId: repo.id }); expect(h.repos.checkouts(h.actor)).toHaveLength(1);
    git(h.home, '-C', root, 'remote', 'rename', 'origin', 'renamed');
    expect(remoteFingerprint(observeRepository(root) as GitObservation)).toBe(bound.remoteFingerprint);
    git(h.home, '-C', root, 'remote', 'set-url', 'renamed', 'https://example.invalid/fork/repo');
    expect(h.repos.match(h.actor, { machineId: m, observation: observeRepository(root) })).toMatchObject({ status: 'binding_changed' });
    h.repos.bind(h.actor, { machineId: m, observation: observeRepository(root), repositoryId: repo.id });
    expect(h.repos.match(h.actor, { machineId: m, observation: observeRepository(worktree) })).toMatchObject({ status: 'matched', source: 'checkout' });
    const fork = create(h, 'Fork', ['https://example.invalid/fork/repo']);
    git(h.home, '-C', clone, 'remote', 'add', 'fork', 'https://example.invalid/fork/repo');
    const multi = observeRepository(clone);
    expect(h.repos.match(h.actor, { machineId: m, observation: multi })).toMatchObject({ status: 'ambiguous', candidates: expect.arrayContaining([expect.objectContaining({ id: fork.id }), expect.objectContaining({ id: repo.id })]) });
    expect(h.repos.match(h.actor, { machineId: m, observation: multi, remote: 'origin' })).toMatchObject({ status: 'matched', repository: { id: repo.id } });
    git(h.home, '-C', clone, 'remote', 'set-url', 'fork', 'https://example.invalid/unknown/repo');
    expect(h.repos.match(h.actor, { machineId: m, observation: observeRepository(clone) })).toMatchObject({ status: 'ambiguous' });
    const local = join(h.home, 'local'); git(h.home, 'init', local);
    expect(h.repos.match(h.actor, { machineId: m, observation: observeRepository(local) }).status).toBe('unbound');
    git(h.home, '-C', local, 'remote', 'add', 'local', root);
    expect(h.repos.match(h.actor, { machineId: m, observation: observeRepository(local) }).status).toBe('unbound');
    h.repos.bind(h.actor, { machineId: m, observation: observeRepository(local), repositoryId: fork.id });
    expect(h.repos.match(h.actor, { machineId: m, observation: observeRepository(local) })).toMatchObject({ status: 'matched', repository: { id: fork.id } });
    expect(h.repos.unbind(h.actor, { machineId: m, observation: observeRepository(local) })).toEqual({ removed: true });
    expect(h.repos.match(h.actor, { machineId: m, observation: observeRepository('/') }).status).toBe('non_git');
    code(() => h.repos.bind(h.actor, { machineId: m, observation: observeRepository('/'), repositoryId: repo.id }), 'repository_git_required');
});

test('effective Git remotes expand insteadOf locally and never send raw credentials or push-only destinations', () => {
    const h = setup(), root = source(h.home);
    git(h.home, '-C', root, 'config', 'url.https://alice:LOCAL_SECRET@example.invalid/.insteadOf', 'shortcut:');
    git(h.home, '-C', root, 'remote', 'add', 'origin', 'shortcut:team/repo.git');
    git(h.home, '-C', root, 'remote', 'set-url', '--push', 'origin', 'https://example.invalid/unrelated/repo');
    const seen = observeRepository(root) as GitObservation;
    expect(seen.remotes[0].urls[0]).toEqual(repositoryAlias('https://example.invalid/team/repo').descriptor);
    const shown = JSON.stringify(seen); expect(shown).not.toContain('LOCAL_SECRET'); expect(shown).not.toContain('alice'); expect(shown).not.toContain('unrelated');
});

test('repository roles, replay, alias conflicts, private checkout paths, member removal and registration survive reopen', () => {
    const h = setup(), requestId = randomUUID(), body = { requestId, name: 'Original', aliases: ['https://user:API_SECRET@example.invalid/repo.git'] };
    const repo = h.repos.create(h.actor, body), m = machine(h), root = source(h.home), seen = observeRepository(root);
    h.repos.rename(h.admin, repo.id, { name: 'Changed' }); h.repos.register(h.admin, repo.id, false);
    const replay = h.otherRepos.create(h.actor, body); expect(replay).toMatchObject({ id: repo.id, name: 'Changed', registered: false });
    expect(h.repos.receipt(h.actor, requestId)).toEqual(replay);
    code(() => h.repos.create(h.actor, { ...body, name: 'Other' }), 'repository_request_conflict');
    code(() => h.repos.create(h.actor, { ...body, requestId: randomUUID() }), 'repository_alias_conflict'); expect(h.repos.list(h.actor)).toHaveLength(1);
    code(() => h.repos.bind(h.actor, { machineId: m, observation: seen, repositoryId: repo.id }), 'repository_unregistered');
    h.repos.register(h.admin, repo.id, true); h.repos.bind(h.actor, { machineId: m, observation: seen, repositoryId: repo.id });
    expect(h.repos.checkouts(h.admin)).toEqual([]);
    code(() => h.repos.match(h.admin, { machineId: m, observation: seen }), 'hub_object_not_found');
    code(() => h.repos.repository(h.unrelated, repo.id), 'repository_space_required');
    const otherSpace = h.access.authenticate(h.c.token, h.c.personalSpace.id);
    code(() => h.repos.repository(otherSpace, repo.id), 'hub_object_not_found');
    h.hub.acceptInvitation(h.c.identity.id, h.hub.invite(h.a.identity.id, h.space, 'member').token);
    const member = h.access.authenticate(h.c.token, h.space);
    expect(h.repos.repository(member, repo.id).permissions.manage).toBe(false);
    code(() => h.repos.rename(member, repo.id, { name: 'Hijack' }), 'space_action_forbidden');
    code(() => h.repos.alias(member, repo.id, { alias: 'https://example.invalid/new' }, true), 'space_action_forbidden');
    const personal = h.repos.create(member, { requestId: randomUUID(), name: 'Repo', aliases: [] });
    const cm = machine(h, member); h.repos.bind(member, { machineId: cm, observation: seen, repositoryId: personal.id });
    expect(h.repos.checkouts(member)).toHaveLength(1);
    h.hub.changeMember(h.a.identity.id, h.space, h.c.identity.id, null);
    code(() => h.repos.checkouts(member), 'user_session_invalid');
    h.hub.acceptInvitation(h.c.identity.id, h.hub.invite(h.a.identity.id, h.space, 'member').token);
    expect(h.repos.checkouts(h.access.authenticate(h.c.token, h.space))).toEqual([]);
    const persisted = openState(h.path); expect(persisted.query('PRAGMA user_version').get()).toEqual({ user_version: STATE_SCHEMA_VERSION });
    expect(JSON.stringify(persisted.query('SELECT * FROM hub_repository_aliases').all())).not.toContain('API_SECRET'); persisted.close();
    expect(JSON.stringify(h.repos.list(h.admin))).not.toContain(realpathSync(root));
});

test('configuration gateway and shared Hub client enforce capabilities, selected space, strict bodies and current identity without native calls', async () => {
    const h = await hubResourceFixture(cleanups, true), space = h.a.personalSpace.id;
    const c = new HubRepositoryClient({ url: h.url, space, credential: { token: h.a.token }, env: {} });
    const repo = (await c.create({ requestId: randomUUID(), name: 'API', aliases: ['git@example.invalid:team/repo.git'] })).repository;
    expect((await c.repository(repo.id)).repository).toEqual(repo);
    expect((await c.alias(repo.id, 'https://example.invalid/team/repo', true)).repository.aliases).toHaveLength(2);
    expect((await c.alias(repo.id, 'https://example.invalid/team/repo', false)).repository.aliases).toHaveLength(1);
    expect((await c.alias(repo.id, repo.aliases[0].canonicalKey, false)).repository.aliases).toHaveLength(0);
    const jwt = await h.auth(h.a.token, space);
    expect((await h.request(prefix, jwt, 'POST', { requestId: randomUUID(), name: 'Bad', ownerId: h.b.identity.id })).status).toBe(400);
    expect((await h.request(prefix + '?ownerId=' + h.a.identity.id, jwt)).status).toBe(400);
    expect((await h.request(prefix + '/' + repo.id + '/register', jwt, 'POST', { unexpected: true })).status).toBe(400);
    const noSpace = new HubRepositoryClient({ url: h.url, credential: { token: h.a.token }, env: {} });
    await expect(noSpace.list()).rejects.toMatchObject({ code: 'repository_space_required' });
    expect(h.calls).toEqual([]);
    const health = await (await fetch(h.url + '/api/runweft/health')).json() as any;
    expect(health.capabilities).toMatchObject({ hubAccess: 1, hubResources: 1, hubRepositories: 1 }); expect(health.capabilities.hubAgents).toBe(1);
    const resource = new HubResourceClient({ url: h.url, credential: { token: h.a.token }, env: {} }); expect((await resource.identity()).id).toBe(h.a.identity.id);
    const legacy = await hubResourceFixture(cleanups); const repositoryClient = new HubRepositoryClient({ url: legacy.url, space, credential: { token: h.a.token }, env: {} });
    await expect(repositoryClient.list()).rejects.toMatchObject({ code: 'hub_repositories_unavailable' });
    const rotated = `rw_web_${randomBytes(32).toString('base64url')}`; replaceTestCredential(h.hub, h.a.identity, h.a.token, rotated);
    await expect(c.list()).rejects.toMatchObject({ code: 'user_session_invalid' });
});
