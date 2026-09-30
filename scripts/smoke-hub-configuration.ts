import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { atomicWrite, hubOrigin } from '../src/config';
import { freePort } from '../src/services';
import { createConfigurationGateway } from '../src/hub/configuration/gateway';
import { HubResourceClient } from '../src/hub/resources/client';
import { HubStore } from '../src/hub/store';

// Real native tool discovery only. Dedicated homes; no model calls or user credential copies.
mkdirSync('.dev-smoke', { recursive: true });
const root = mkdtempSync(resolve('.dev-smoke/hub-configuration-')), statePath = join(root, 'state.sqlite');
const binary = resolve(process.argv[2] ?? 'dist/hapi'), cliBinary = resolve(process.argv[3] ?? 'dist/runweft');
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('HAPI_') || key.startsWith('RUNWEFT_') || ['CLI_API_TOKEN', 'DB_PATH', 'TELEGRAM_BOT_TOKEN'].includes(key)) delete env[key];
env.CODEX_HOME = join(root, 'codex'); env.CLAUDE_CONFIG_DIR = join(root, 'claude');
for (const dir of [env.CODEX_HOME, env.CLAUDE_CONFIG_DIR]) mkdirSync(dir, { mode: 0o700 });
env.HAPI_CLAUDE_PATH = Bun.which('claude') ?? undefined;
assert(env.HAPI_CLAUDE_PATH && Bun.which('codex'), 'Native Codex and Claude Code commands are required for version-only discovery.');
const port = await freePort(), target = `http://127.0.0.1:${port}`, rootToken = randomBytes(32).toString('base64url'), key = randomBytes(32);
const nativeHome = join(root, 'hapi'), secrets = [rootToken];
const hapi = Bun.spawn([binary, 'hub'], { env: { ...env, HAPI_HOME: nativeHome, DB_PATH: join(nativeHome, 'hapi.db'),
    HAPI_LISTEN_HOST: '127.0.0.1', HAPI_LISTEN_PORT: String(port), HAPI_PUBLIC_URL: target, CLI_API_TOKEN: rootToken, TELEGRAM_BOT_TOKEN: '' },
    stdout: Bun.file(join(root, 'hapi-out.log')), stderr: Bun.file(join(root, 'hapi-err.log')) });
let gateway: Awaited<ReturnType<typeof createConfigurationGateway>> | undefined, hub: HubStore | undefined;
let runner: ReturnType<typeof Bun.spawn> | undefined, runnerNumber = 0;
let base = '', gatewayPort = 0;
const home = join(root, 'client'), checks: string[] = [];
const evidence: any = { root, binary, cliBinary, checks, success: false,
    kind: 'central repositories, Agent configuration and personal choices through compiled CLI; real unmodified HAPI Runner tool probes; no model or task execution' };
const check = (name: string) => { checks.push(name); console.log('PASS ' + name); };
async function until(fn: () => Promise<boolean>, message: string, ms = 30_000) {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await fn()) return; await Bun.sleep(250); }
    throw new Error(message);
}
function backup(user: ReturnType<HubStore['createIdentity']>, name: string) {
    const file = join(root, name + '.txt');
    atomicWrite(file, `Runweft Hub: ${base}\n身份 ID: ${user.identity.id}\n${user.token}\n`); secrets.push(user.token); return file;
}
async function cli(file: string, args: string[], space?: string, expected = 0, clientHome = home) {
    const child = Bun.spawn([cliBinary, '--home', clientHome, '--json', 'hub', '--url', base, '--identity-file', file,
        ...(space ? ['--space', space] : []), ...args], { env, stdout: 'pipe', stderr: 'pipe' });
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    for (const secret of secrets) assert(!(stdout + stderr).includes(secret), 'Credential appeared in CLI output');
    assert.equal(exit, expected, `${args.join(' ')}: ${stderr}`);
    return JSON.parse(stdout || stderr);
}
async function startRunner(recordPath: string) {
    const record = JSON.parse(readFileSync(recordPath, 'utf8'));
    const runnerHome = join(recordPath, '..', 'hapi');
    atomicWrite(join(runnerHome, 'settings.json'), JSON.stringify({ machineId: record.machineId, cliApiToken: record.active.token }));
    runnerNumber++;
    runner = Bun.spawn([binary, 'runner', 'start-sync'], { env: { ...env, HAPI_HOME: runnerHome, HAPI_API_URL: base,
        CLI_API_TOKEN: record.active.token, HAPI_DISABLE_VERSION_HANDOFF: '1' },
        stdout: Bun.file(join(root, `runner-${runnerNumber}-out.log`)), stderr: Bun.file(join(root, `runner-${runnerNumber}-err.log`)) });
}
async function stopRunner() { if (runner) { runner.kill(); await runner.exited; runner = undefined; } }
async function startGateway() {
    gateway = await createConfigurationGateway({ host: '127.0.0.1', port: gatewayPort, target, rootToken, key, statePath });
    gatewayPort = (gateway.server.address() as { port: number }).port; base = hubOrigin.parse(`http://127.0.0.1:${gatewayPort}`);
}
function git(...args: string[]) {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...env,
        GIT_CONFIG_GLOBAL: join(root, 'empty-git-config'), GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Smoke', GIT_AUTHOR_EMAIL: 'smoke@example.invalid',
        GIT_COMMITTER_NAME: 'Smoke', GIT_COMMITTER_EMAIL: 'smoke@example.invalid' } }).trim();
}
function definition(name: string, value: object) { const file = join(root, name + '.json'); writeFileSync(file, JSON.stringify(value)); return file; }
console.log('Evidence directory: ' + root);
try {
    await until(async () => { try { return (await fetch(target + '/health', { signal: AbortSignal.timeout(500) })).ok; } catch { return false; } }, 'HAPI startup');
    await startGateway(); hub = new HubStore(statePath);
    const a = hub.createIdentity('owner'), b = hub.createIdentity('member'), c = hub.createIdentity('admin'), sid = a.personalSpace.id;
    hub.acceptInvitation(b.identity.id, hub.invite(a.identity.id, sid, 'member').token);
    hub.acceptInvitation(c.identity.id, hub.invite(a.identity.id, sid, 'admin').token);
    const af = backup(a, 'owner'), bf = backup(b, 'member'), cf = backup(c, 'admin');
    const enrolled = await cli(af, ['machine', 'enroll', '--name', 'Configuration Runner']);
    const machineId = enrolled.machineId, recordPath = enrolled.credentialFile, record = JSON.parse(readFileSync(recordPath, 'utf8'));
    secrets.push(record.active.token); await cli(af, ['machine', 'associate', machineId, sid]); await startRunner(recordPath);
    const owner = new HubResourceClient({ url: base, identityFile: af, space: sid });
    await until(async () => { assert.equal(runner!.exitCode, null, 'Runner exited'); try { return (await owner.discover(machineId)).tools.every(t => t.toolFound); } catch { return false; } }, 'Native tool discovery');
    const codex = (await cli(af, ['runtime', 'register', 'codex', '--machine', machineId], sid)).runtime;
    const claude = (await cli(af, ['runtime', 'register', 'claude', '--machine', machineId], sid)).runtime;
    evidence.tools = [codex, claude].map(r => ({ flavor: r.flavor, version: r.version, versionStatus: r.versionStatus }));
    assert(evidence.tools.every((t: any) => t.versionStatus === 'detected'));
    check('compiled CLI and configuration gateway reuse unchanged HAPI Runner for real Codex/Claude discovery');

    const bm = await cli(bf, ['machine', 'enroll', '--name', 'Member checkout host'], undefined, 0, join(root, 'member-client'));
    secrets.push(JSON.parse(readFileSync(bm.credentialFile, 'utf8')).active.token);
    const source = join(root, 'source'), clone = join(root, 'clone'), worktree = join(root, 'worktree');
    git('init', source); writeFileSync(join(source, 'README.md'), '# Git fixture\n'); git('-C', source, 'add', 'README.md'); git('-C', source, 'commit', '-m', 'initial');
    git('clone', source, clone); git('-C', source, 'worktree', 'add', '-b', 'feature', worktree);
    git('-C', source, 'remote', 'add', 'origin', 'https://example.invalid/team/repository.git');
    git('-C', clone, 'remote', 'set-url', 'origin', 'https://example.invalid/team/repository');
    const repo = (await cli(af, ['repository', 'create', 'Project', '--request-id', randomUUID(), '--alias', 'https://example.invalid/team/repository.git'], sid)).repository;
    for (const [file, machine, cwd] of [[af, machineId, source], [af, machineId, worktree], [bf, bm.machineId, clone]]) {
        assert.equal((await cli(file, ['repository', 'match', '--machine', machine, '--cwd', cwd], sid)).repository.id, repo.id);
        await cli(file, ['repository', 'bind', repo.id, '--machine', machine, '--cwd', cwd], sid);
    }
    assert.equal((await cli(af, ['repository', 'checkouts'], sid)).checkouts.length, 1);
    assert.equal((await cli(bf, ['repository', 'checkouts'], sid)).checkouts.length, 1);
    assert.equal((await cli(cf, ['repository', 'checkouts'], sid)).checkouts.length, 0);
    check('real clone/worktree metadata converges on one Hub repository while checkout paths remain private per owner');

    const fa = definition('owner-agent', { name: 'Builder', instructions: 'Owner-specific instructions', repositoryId: repo.id, runtimeId: codex.id, flavor: 'codex' });
    const fb = definition('member-agent', { name: 'Builder', instructions: 'Member-specific instructions', repositoryId: repo.id, flavor: 'claude' });
    const aa = (await cli(af, ['agent', 'create', '--request-id', randomUUID(), '--file', fa], sid)).agent;
    const ba = (await cli(bf, ['agent', 'create', '--request-id', randomUUID(), '--file', fb], sid)).agent;
    assert.notEqual(aa.id, ba.id); assert.equal((await cli(bf, ['agent', 'list'], sid)).agents.length, 1);
    const governance = await cli(cf, ['agent', 'show', aa.id], sid);
    assert.equal(governance.agent.view, 'governance'); assert(!JSON.stringify(governance).includes('Owner-specific instructions'));
    assert.equal((await cli(cf, ['agent', 'versions', aa.id], sid, 1)).error.code, 'agent_owner_required');
    await cli(af, ['agent', 'select', aa.id, '--repository', repo.id], sid);
    const ownerResolution = (await cli(af, ['agent', 'resolve', '--repository', repo.id], sid)).resolution;
    assert.equal(ownerResolution.agentId, aa.id); assert.equal(ownerResolution.target.machineId, machineId);
    await cli(bf, ['agent', 'select', ba.id, '--repository', repo.id], sid);
    assert.equal((await cli(bf, ['agent', 'resolve', '--repository', repo.id, '--runtime', claude.id], sid, 1)).error.code, 'runtime_private');
    await cli(af, ['runtime', 'share', claude.id, sid]);
    await cli(bf, ['agent', 'select', ba.id, '--repository', repo.id, '--runtime', claude.id], sid);
    const memberResolution = (await cli(bf, ['agent', 'resolve', '--repository', repo.id], sid)).resolution;
    assert.equal(memberResolution.agentId, ba.id); assert.equal(memberResolution.launchOptions.agent, 'claude');
    assert.deepEqual(memberResolution.launchOptions.disabledMcpServers, ['runweft']);
    assert(!JSON.stringify(memberResolution).includes('executable')); assert(!JSON.stringify(memberResolution).includes(nativeHome));
    check('two users maintain same-name private Agents and personal repository choices; runtime sharing remains a separate required grant');

    await cli(af, ['agent', 'access', aa.id, 'space'], sid);
    assert.equal((await cli(bf, ['agent', 'resolve', '--repository', repo.id, '--agent', aa.id], sid, 1)).error.code, 'runtime_private');
    await cli(af, ['runtime', 'share', codex.id, sid]);
    const shared = (await cli(bf, ['agent', 'resolve', '--repository', repo.id, '--agent', aa.id], sid)).resolution;
    assert.equal(shared.target.runtimeId, codex.id); assert.equal(shared.selection.runtime, 'definition');
    await cli(cf, ['agent', 'block', aa.id], sid);
    assert.equal((await cli(af, ['agent', 'resolve', '--repository', repo.id], sid, 1)).error.code, 'agent_blocked');
    assert.equal((await cli(bf, ['agent', 'resolve', '--repository', repo.id], sid)).resolution.agentId, ba.id);
    await cli(cf, ['agent', 'unblock', aa.id], sid);
    const changed = definition('owner-updated', { ...aa.definition, instructions: 'Updated owner instructions' });
    await cli(af, ['agent', 'update', aa.id, '--expected-version', '1', '--file', changed], sid);
    assert.equal(ownerResolution.definition.instructions, 'Owner-specific instructions');
    const updated = (await cli(af, ['agent', 'resolve', '--repository', repo.id], sid)).resolution;
    assert.equal(updated.version, 2); assert.notEqual(updated.resolvedVersion, ownerResolution.resolvedVersion);
    assert.equal((await cli(af, ['agent', 'versions', aa.id], sid)).versions[0].definition.instructions, 'Owner-specific instructions');
    check('shared Agent and runtime rights intersect; independent governance and immutable versions never redirect another user choice');

    await stopRunner(); await gateway!.close(); gateway = undefined; await startGateway(); await startRunner(recordPath);
    await until(async () => { try { return (await owner.discover(machineId)).tools.every(t => t.toolFound); } catch { return false; } }, 'Runner reconnect after gateway restart');
    assert.equal((await cli(af, ['agent', 'resolve', '--repository', repo.id], sid)).resolution.resolvedVersion, updated.resolvedVersion);
    assert.equal((await cli(bf, ['agent', 'resolve', '--repository', repo.id], sid)).resolution.resolvedVersion, memberResolution.resolvedVersion);
    git('-C', clone, 'remote', 'set-url', 'origin', 'https://example.invalid/fork/repository');
    assert.equal((await cli(bf, ['repository', 'match', '--machine', bm.machineId, '--cwd', clone], sid, 1)).status, 'binding_changed');
    await cli(bf, ['repository', 'bind', repo.id, '--machine', bm.machineId, '--cwd', clone], sid);
    hub.changeMember(a.identity.id, sid, b.identity.id, null);
    hub.acceptInvitation(b.identity.id, hub.invite(a.identity.id, sid, 'member').token);
    assert.equal((await cli(bf, ['agent', 'selection'], sid)).selections.length, 0);
    assert.equal((await cli(bf, ['repository', 'checkouts'], sid)).checkouts.length, 0);
    assert.equal((await cli(bf, ['agent', 'show', ba.id], sid)).agent.accessMode, 'private');
    check('Hub/Runner restart preserves stable resolution; remote drift and membership rejoin require explicit renewed configuration');

    const db = gateway!.store.db;
    assert.equal((db.query('SELECT COUNT(*) AS n FROM delegation_tasks').get() as { n: number }).n, 0);
    assert.equal((db.query("SELECT COUNT(*) AS n FROM hub_execution_objects WHERE kind IN ('task', 'session')").get() as { n: number }).n, 0);
    for (let n = 0; n <= runnerNumber; n++) for (const suffix of ['out', 'err']) {
        const logs = readFileSync(join(root, n ? `runner-${n}-${suffix}.log` : `hapi-${suffix}.log`), 'utf8');
        for (const secret of secrets) assert(!logs.includes(secret), 'Credential leaked in logs');
    }
    check('configuration preview performs no task/model execution and no credential appears in CLI or native service logs');
    evidence.success = true;
} catch (error) { evidence.error = error instanceof Error ? error.message : String(error); throw error; }
finally {
    await stopRunner(); await gateway?.close(); hub?.close(); hapi.kill(); await hapi.exited;
    writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
}
