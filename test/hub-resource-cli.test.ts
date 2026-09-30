import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { HubResourceClient } from '../src/hub/resources/client';
import { hubConnectionPaths, MachineConnection } from '../src/hub/resources/connection';
import { RunweftError } from '../src/errors';
import { fixture } from './helpers';
import { hubResourceFixture } from './hub-resources-fixture';

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanups.splice(0).reverse()) await fn(); });
const buildHome = fixture('hub-cli-build'), executable = join(buildHome, 'runweft');
beforeAll(async () => {
    const child = Bun.spawn([process.execPath, 'build', resolve('src/cli.ts'), '--compile', '--outfile', executable], { stdout: 'pipe', stderr: 'pipe' });
    const [exit, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    if (exit !== 0) throw new Error(stderr);
}, 30_000);
afterAll(() => rmSync(buildHome, { recursive: true, force: true }));

function backup(home: string, url: string, identity: { identity: { id: string }; token: string }, file = 'identity.txt') {
    const path = join(home, file);
    writeFileSync(path, `Runweft Hub: ${url}\n身份 ID: ${identity.identity.id}\n${identity.token}\n`, { mode: 0o600 });
    return path;
}
async function cli(home: string, url: string, file: string, args: string[], space?: string, extraEnv: NodeJS.ProcessEnv = {}) {
    const env = { ...process.env, ...extraEnv };
    delete env.RUNWEFT_IDENTITY_TOKEN; delete env.RUNWEFT_MODE; delete env.RUNWEFT_HUB_URL;
    const child = Bun.spawn([executable, '--home', home, '--json', 'hub', '--url', url, '--identity-file', file,
        ...(space ? ['--space', space] : []), ...args], { env, stdout: 'pipe', stderr: 'pipe' });
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    return { exit, stdout, stderr, result: stdout.trim() ? JSON.parse(stdout) : undefined, error: stderr.trim() ? JSON.parse(stderr).error : undefined };
}

test('compiled CLI concurrently enrolls one durable machine, manages resources and rotates without exposing secrets or changing native configuration', async () => {
    const h = await hubResourceFixture(cleanups), file = backup(h.home, h.url, h.a), home = join(h.home, 'client');
    const [first, concurrent] = await Promise.all([cli(home, h.url, file, ['machine', 'enroll']), cli(home, h.url + '/', file, ['machine', 'enroll'])]);
    expect(first.exit).toBe(0); expect(concurrent.exit).toBe(0);
    const id = first.result.machineId;
    expect(concurrent.result.machineId).toBe(id); expect(h.store.machines(h.actor)).toHaveLength(1);
    const path = hubConnectionPaths(home, h.url).machineConnection;
    const record = JSON.parse(readFileSync(path, 'utf8'));
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(first.result.credentialFile).toBe(path);
    for (const output of [first, concurrent]) {
        expect(output.stdout + output.stderr).not.toContain(record.active.token);
        expect(output.stdout + output.stderr).not.toContain(h.a.token);
    }
    expect(existsSync(join(home, 'config.yaml'))).toBe(false);
    expect(existsSync(join(home, 'connections', 'local'))).toBe(false);
    const otherFile = backup(h.home, h.url, h.b, 'other.txt');
    const wrongOwner = await cli(home, h.url, otherFile, ['machine', 'enroll']);
    expect(wrongOwner.error.code).toBe('machine_connection_owner_mismatch');
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(record);
    h.connect(id);
    expect((await cli(home, h.url, file, ['machine', 'associate', id, h.a.personalSpace.id])).exit).toBe(0);
    const native = await cli(home, h.url, file, ['machine', 'discover', id]);
    expect(native.result.tools).toHaveLength(2);
    const registered = await cli(home, h.url, file, ['runtime', 'register', 'codex', '--machine', id, '--name', 'Builder'], h.a.personalSpace.id);
    expect(registered.exit).toBe(0); const rid = registered.result.runtime.id;
    expect((await cli(home, h.url, file, ['runtime', 'share', rid, h.a.personalSpace.id])).exit).toBe(0);
    const resolved = await cli(join(h.home, 'other-client'), h.url, otherFile, ['runtime', 'resolve', rid], h.a.personalSpace.id);
    expect(resolved.result.target.runtimeId).toBe(rid); expect(resolved.stdout).not.toContain('executable');
    expect((await cli(home, h.url, otherFile, ['runtime', 'block', rid, h.a.personalSpace.id])).exit).toBe(0);
    const check = await cli(home, h.url, file, ['runtime', 'check', rid], h.a.personalSpace.id);
    expect(check.exit).toBe(1); expect(check.error.code).toBe('resource_space_blocked');
    expect((await cli(home, h.url, otherFile, ['runtime', 'unblock', rid, h.a.personalSpace.id])).exit).toBe(0);
    expect((await cli(home, h.url, file, ['runtime', 'check', rid], h.a.personalSpace.id)).exit).toBe(0);
    const rotation = await cli(home, h.url, file, ['machine', 'rotate-credential']);
    expect(rotation.exit).toBe(0); expect(rotation.result.runnerRestartRequired).toBe(true);
    const next = JSON.parse(readFileSync(path, 'utf8'));
    expect(next.active.token).not.toBe(record.active.token); expect(next.pending).toBeUndefined();
    expect(() => h.access.authenticate(record.active.token)).toThrow();
    expect(h.access.authenticate(next.active.token).machineId).toBe(id);
    expect(rotation.stdout + rotation.stderr).not.toContain(next.active.token);
    const reenroll = await cli(home, h.url, file, ['machine', 'enroll']);
    expect(reenroll.exit).toBe(0); expect(reenroll.result.machineId).toBe(id);
    const paths = await cli(home, h.url, file, ['paths']);
    expect(paths.result.machineConnection).toBe(path);
    expect((await cli(home, h.url, file, ['machine', 'revoke-credential', id])).result.credential.status).toBe('revoked');
    expect((await cli(home, h.url, file, ['machine', 'enroll'])).error.code).toBe('machine_connection_changed');
    expect((await cli(home, h.url, file, ['machine', 'rotate-credential'])).exit).toBe(0);
    const human = Bun.spawn([executable, '--home', home, 'hub', '--url', h.url, '--identity-file', file, 'machine', 'enroll'], { stdout: 'pipe', stderr: 'pipe' });
    const [humanExit, humanOut, humanErr] = await Promise.all([human.exited, new Response(human.stdout).text(), new Response(human.stderr).text()]);
    expect(humanExit).toBe(0); expect(humanOut).toContain(id); expect(humanOut).toContain(path);
    expect(humanOut + humanErr).not.toContain(JSON.parse(readFileSync(path, 'utf8')).active.token);
    expect(humanOut + humanErr).not.toContain(h.a.token);
}, 20_000);

test('lost enrollment and rotation responses retain saved requests; stale pending cannot revoke a newer credential without explicit replacement', async () => {
    const h = await hubResourceFixture(cleanups), home = join(h.home, 'client');
    const options = { url: h.url, env: { RUNWEFT_IDENTITY_TOKEN: h.a.token } };
    const paths = hubConnectionPaths(home, h.url);
    class LosingClient extends HubResourceClient {
        override async enroll(value: Parameters<HubResourceClient['enroll']>[0]): Promise<never> {
            expect(JSON.parse(readFileSync(paths.machineConnection, 'utf8')).active.token).toBe(value.token);
            await super.enroll(value); throw new RunweftError('lost_response', 'simulated response loss');
        }
        override async replaceCredential(id: string, expected: string, token: string): Promise<never> {
            expect(JSON.parse(readFileSync(paths.machineConnection, 'utf8')).pending.token).toBe(token);
            await super.replaceCredential(id, expected, token); throw new RunweftError('lost_response', 'simulated response loss');
        }
    }
    await expect(new MachineConnection(home, new LosingClient(options)).enroll()).rejects.toMatchObject({ code: 'lost_response' });
    expect(h.store.machines(h.actor)).toHaveLength(1);
    const initial = JSON.parse(readFileSync(paths.machineConnection, 'utf8'));
    expect(initial.machineId).toBeUndefined();
    const client = new HubResourceClient(options), connection = new MachineConnection(home, client), restored = await connection.enroll();
    expect(restored.machineId).toBe(h.store.machines(h.actor)[0].machineId);
    expect(JSON.parse(readFileSync(paths.machineConnection, 'utf8')).active.token).toBe(initial.active.token);
    await expect(new MachineConnection(home, new LosingClient(options)).rotate()).rejects.toMatchObject({ code: 'lost_response' });
    const pending = JSON.parse(readFileSync(paths.machineConnection, 'utf8'));
    expect(pending.active.token).toBe(initial.active.token);
    expect(h.access.authenticate(pending.pending.token).machineId).toBe(restored.machineId);
    const recovered = await connection.rotate();
    expect(recovered.credentialId).toBe(h.access.authenticate(pending.pending.token).id);
    expect(JSON.parse(readFileSync(paths.machineConnection, 'utf8')).pending).toBeUndefined();
    await expect(new MachineConnection(home, new LosingClient(options)).rotate()).rejects.toMatchObject({ code: 'lost_response' });
    const stale = JSON.parse(readFileSync(paths.machineConnection, 'utf8'));
    const current = await client.credential(restored.machineId);
    const externalToken = `rw_mc_${randomBytes(32).toString('base64url')}`;
    const external = await client.replaceCredential(restored.machineId, current.credential.id, externalToken);
    await expect(connection.rotate()).rejects.toMatchObject({ code: 'machine_credential_replaced' });
    expect(h.access.authenticate(externalToken).id).toBe(external.credential.id);
    expect(JSON.parse(readFileSync(paths.machineConnection, 'utf8'))).toEqual(stale);
    await connection.rotate(true);
    expect(() => h.access.authenticate(externalToken)).toThrow();
});

test('explicit rotation recovers a lost first enrollment receipt even when its original credential was revoked', async () => {
    const h = await hubResourceFixture(cleanups), home = join(h.home, 'client');
    const options = { url: h.url, env: { RUNWEFT_IDENTITY_TOKEN: h.a.token } };
    class LostEnrollment extends HubResourceClient {
        override async enroll(input: Parameters<HubResourceClient['enroll']>[0]): Promise<never> {
            const reply = await super.enroll(input);
            await this.revokeCredential(reply.machineId);
            throw new RunweftError('lost_response', 'simulated response loss');
        }
    }
    await expect(new MachineConnection(home, new LostEnrollment(options)).enroll()).rejects.toMatchObject({ code: 'lost_response' });
    const client = new HubResourceClient(options), connection = new MachineConnection(home, client);
    await expect(connection.enroll()).rejects.toMatchObject({ code: 'machine_credential_replaced' });
    const rotated = await connection.rotate();
    expect(h.store.machines(h.actor)).toHaveLength(1);
    expect(rotated.machineId).toBe(h.store.machines(h.actor)[0].machineId);
    const record = JSON.parse(readFileSync(hubConnectionPaths(home, h.url).machineConnection, 'utf8'));
    expect(h.access.authenticate(record.active.token).id).toBe(rotated.credentialId);
});

test('Hub origins, identity backup IDs and legacy tokens cannot be mixed; unknown servers receive no credentials', async () => {
    const h = await hubResourceFixture(cleanups), second = await hubResourceFixture(cleanups), home = join(h.home, 'client');
    const firstFile = backup(h.home, h.url, h.a), secondFile = backup(second.home, second.url, second.a);
    const first = await cli(home, h.url, firstFile, ['machine', 'enroll']);
    const wrong = await cli(home, second.url, firstFile, ['machine', 'enroll']);
    expect(wrong.error.code).toBe('hub_identity_origin_mismatch');
    expect(second.store.machines(second.actor)).toHaveLength(0);
    const two = await cli(home, second.url, secondFile, ['machine', 'enroll']);
    expect(two.exit).toBe(0); expect(two.result.credentialFile).not.toBe(first.result.credentialFile);
    const firstToken = JSON.parse(readFileSync(first.result.credentialFile, 'utf8')).active.token;
    const secondToken = JSON.parse(readFileSync(two.result.credentialFile, 'utf8')).active.token;
    expect(firstToken).not.toBe(secondToken);
    expect(() => second.access.authenticate(firstToken)).toThrow();
    const forged = backup(h.home, h.url, { identity: h.a.identity, token: h.b.token }, 'wrong-id.txt');
    expect((await cli(home, h.url, forged, ['identity'])).error.code).toBe('hub_identity_response_invalid');
    expect(() => new HubResourceClient({ url: h.url, home, env: { RUNWEFT_HUB_TOKEN: h.a.token } })).toThrow('尚未连接');
    let observed = false;
    const old = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
        observed ||= !!request.headers.get('authorization') || (request.method !== 'GET' && (await request.text()).includes(h.a.token));
        return Response.json({ service: 'runweft', capabilities: {} });
    } });
    try {
        await expect(new HubResourceClient({ url: old.url.origin, env: { RUNWEFT_IDENTITY_TOKEN: h.a.token } }).identity()).rejects.toMatchObject({ code: 'hub_resources_unavailable' });
        expect(observed).toBe(false);
    } finally { old.stop(true); }
});

test('compiled repository CLI serializes replay, matches real Git worktrees, reports drift and preserves private checkout metadata', async () => {
    const h = await hubResourceFixture(cleanups, true), space = h.a.personalSpace.id, file = backup(h.home, h.url, h.a), home = join(h.home, 'repo-client');
    const run = (args: string[]) => cli(home, h.url, file, ['repository', ...args], space);
    const enrolled = await cli(home, h.url, file, ['machine', 'enroll']); expect(enrolled.exit).toBe(0); const machine = enrolled.result.machineId;
    const requestId = randomUUID(), args = ['create', 'Project', '--request-id', requestId, '--alias', 'ssh://git@example.invalid/team/repo.git'];
    const created = await Promise.all([run(args), run(args)]);
    expect(created[0].exit).toBe(0); expect(created[1].exit).toBe(0); const repo = created[0].result.repository;
    expect(created[1].result.repository.id).toBe(repo.id); expect((await run(['list'])).result.repositories).toHaveLength(1);
    expect((await run(['rename', repo.id, 'Renamed'])).result.repository.name).toBe('Renamed');
    expect((await run(args)).result.repository.name).toBe('Renamed');
    expect((await run(['request', requestId])).result.repository.id).toBe(repo.id);
    const root = join(h.home, 'checkout'), worktree = join(h.home, 'worktree');
    const git = (...argv: string[]) => execFileSync('git', argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env,
        GIT_CONFIG_GLOBAL: join(h.home, 'empty-config'), GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
        GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' } });
    git('init', root); writeFileSync(join(root, 'file'), 'source\n'); git('-C', root, 'add', 'file'); git('-C', root, 'commit', '-m', 'init');
    git('-C', root, 'worktree', 'add', '-b', 'other', worktree); git('-C', root, 'remote', 'add', 'origin', 'ssh://git@example.invalid/team/repo.git');
    const inspect = await run(['inspect', '--cwd', root]); expect(inspect.exit).toBe(0); expect(inspect.result.observation.kind).toBe('git');
    const match = await run(['match', '--machine', machine, '--cwd', root]); expect(match.exit).toBe(0); expect(match.result.repository.id).toBe(repo.id);
    expect((await run(['checkouts'])).result.checkouts).toHaveLength(0);
    expect((await run(['bind', repo.id, '--machine', machine, '--cwd', root])).exit).toBe(0);
    expect((await run(['match', '--machine', machine, '--cwd', worktree])).result.source).toBe('checkout');
    expect((await run(['checkouts'])).result.checkouts).toHaveLength(1);
    const otherFile = backup(h.home, h.url, h.b, 'admin.txt');
    expect((await cli(home, h.url, otherFile, ['repository', 'checkouts'], space)).result.checkouts).toHaveLength(0);
    git('-C', root, 'remote', 'set-url', 'origin', 'https://alice:DO_NOT_LEAK@example.invalid/team/repo.git');
    const drift = await run(['match', '--machine', machine, '--cwd', root]); expect(drift.exit).toBe(1); expect(drift.result.status).toBe('binding_changed');
    expect(drift.stdout + drift.stderr).not.toContain('DO_NOT_LEAK'); expect(drift.stdout).not.toContain('alice');
    expect((await run(['unbind', '--machine', machine, '--cwd', root])).result.removed).toBe(true);
    expect((await run(['match', '--machine', machine, '--cwd', root])).result.status).toBe('unmatched');
    // Direct URL registration and local descriptor observation must agree.
    const jwt = await h.auth(h.a.token, space);
    expect((await h.request(`/api/runweft/repositories/${repo.id}/aliases`, jwt, 'PUT', { alias: 'https://example.invalid/team/repo' })).status).toBe(200);
    expect((await run(['match', '--machine', machine, '--cwd', root])).result.repository.id).toBe(repo.id);
    expect((await run(['un-alias', repo.id, 'https://example.invalid/team/repo'])).result.repository.aliases).toHaveLength(1);
    expect((await run(['alias', repo.id, 'https://example.invalid/team/repo'])).result.repository.aliases).toHaveLength(2);
    expect((await run(['unregister', repo.id])).result.repository.registered).toBe(false);
    expect((await run(['match', '--machine', machine, '--cwd', root])).error.code).toBe('repository_unregistered');
    expect((await run(['register', repo.id])).result.repository.registered).toBe(true);
    expect((await run(['show', repo.id])).result.repository.id).toBe(repo.id);
    expect(h.calls).toEqual([]); // metadata does not probe or start the native runtime
}, 20_000);

test('compiled Agent CLI creates private definitions, fences concurrent versions, and separates owner sharing from administrator governance', async () => {
    const h = await hubResourceFixture(cleanups, true), space = h.a.personalSpace.id, file = backup(h.home, h.url, h.a), otherFile = backup(h.home, h.url, h.b, 'admin.txt');
    const home = join(h.home, 'agent-client'), path = join(h.home, 'definition.json'), next = join(h.home, 'next.json'), alternative = join(h.home, 'alternative.json');
    writeFileSync(path, JSON.stringify({ name: 'Reviewer', instructions: 'private initial', flavor: 'codex', model: 'private model' }));
    writeFileSync(next, JSON.stringify({ name: 'Reviewer', instructions: 'update one' }));
    writeFileSync(alternative, JSON.stringify({ name: 'Reviewer', instructions: 'update two' }));
    const run = (args: string[], identity = file) => cli(home, h.url, identity, ['agent', ...args], space);
    const requestId = randomUUID(), args = ['create', '--request-id', requestId, '--file', path];
    const [one, two] = await Promise.all([run(args), run(args)]);
    expect(one.exit).toBe(0); expect(two.exit).toBe(0); const id = one.result.agent.id;
    expect(two.result.agent.id).toBe(id); expect(one.result.agent.accessMode).toBe('private');
    const summary = await run(['show', id], otherFile); expect(summary.result.agent.view).toBe('governance'); expect(summary.stdout).not.toContain('private initial'); expect(summary.stdout).not.toContain('private model');
    expect((await run(['update', id, '--expected-version', '1', '--file', next], otherFile)).error.code).toBe('agent_owner_required');
    const edited = await Promise.all([run(['update', id, '--expected-version', '1', '--file', next]), run(['update', id, '--expected-version', '1', '--file', alternative])]);
    expect(edited.map(x => x.exit).sort()).toEqual([0, 1]); expect(edited.find(x => x.exit === 1)!.error.code).toBe('agent_version_conflict');
    expect((await run(['versions', id])).result.versions.map((v: any) => v.version)).toEqual([1, 2]);
    expect((await run(['versions', id], otherFile)).error.code).toBe('agent_owner_required');
    expect((await run(args)).result.agent.version).toBe(2); expect((await run(['request', requestId])).result.agent.id).toBe(id);
    expect((await run(['access', id, 'members', '--member', h.b.identity.id])).result.agent.memberIds).toEqual([h.b.identity.id]);
    expect((await run(['show', id], otherFile)).result.agent.view).toBe('definition');
    expect((await run(['versions', id], otherFile)).error.code).toBe('agent_owner_required');
    expect((await run(['block', id], otherFile)).result.agent.blocked).toBe(true);
    expect((await run(['unregister', id])).result.agent.registered).toBe(false);
    expect((await run(['register', id])).result.agent.blocked).toBe(true);
    expect((await run(['access', id, 'space'])).result.agent.blocked).toBe(true);
    expect((await run(['unblock', id], otherFile)).result.agent.blocked).toBe(false);
    expect((await run(['list'])).result.agents).toHaveLength(1);
    expect(readFileSync(path, 'utf8')).toContain('private initial'); // input is not replaced or made into a file authority
    expect(h.calls).toEqual([]);
}, 20_000);

test('compiled selection CLI keeps one personal default and resolves fixed central snapshots without creating sessions', async () => {
    const h = await hubResourceFixture(cleanups, true), space = h.a.personalSpace.id, file = backup(h.home, h.url, h.a), home = join(h.home, 'selection-client');
    const run = (args: string[]) => cli(home, h.url, file, ['agent', ...args], space);
    const machine = (await cli(home, h.url, file, ['machine', 'enroll'])).result.machineId; h.connect(machine);
    await cli(home, h.url, file, ['machine', 'associate', machine, space]);
    const runtime = (await cli(home, h.url, file, ['runtime', 'register', 'codex', '--machine', machine], space)).result.runtime.id;
    const path = join(h.home, 'role.json'); writeFileSync(path, JSON.stringify({ name: 'Role', instructions: 'do work', flavor: 'codex', model: 'configured model', reasoningEffort: 'high' }));
    const id = (await run(['create', '--request-id', randomUUID(), '--file', path])).result.agent.id;
    expect((await run(['resolve'])).error.code).toBe('agent_selection_required');
    const results = await Promise.all([run(['select', id, '--runtime', runtime]), run(['select', id, '--runtime', runtime])]);
    expect(results.map(r => r.exit)).toEqual([0, 0]); expect((await run(['selection'])).result.selections).toHaveLength(1);
    const resolution = (await run(['resolve'])).result.resolution;
    expect(resolution).toMatchObject({ agentId: id, version: 1, selection: { agent: 'space', runtime: 'space' },
        target: { runtimeId: runtime }, launchOptions: { agent: 'codex', model: 'configured model', modelReasoningEffort: 'high', disabledMcpServers: ['runweft'] } });
    const explicit = await run(['resolve', '--agent', id, '--runtime', runtime]); expect(explicit.result.resolution.selection).toEqual({ agent: 'explicit', runtime: 'explicit' });
    expect((await run(['unselect'])).result.removed).toBe(true);
    expect((await run(['resolve'])).error.code).toBe('agent_selection_required');
    expect(h.calls.some(call => call.includes('/sessions'))).toBe(false);
}, 20_000);
