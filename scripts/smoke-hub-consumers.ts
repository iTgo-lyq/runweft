import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { atomicWrite } from '../src/config';
import { freePort } from '../src/services';
import { HubStore } from '../src/hub/store';
import { HubClient } from '../src/hub/client';
import { createDelegationGateway } from '../src/hub/delegation/gateway';
import { hubConnectionPaths } from '../src/hub/resources/connection';
import { configureSmokeCodexModel } from './fixtures/codex-model';

mkdirSync('.dev-smoke', { recursive: true });
const root = mkdtempSync(resolve('.dev-smoke/hub-consumers-')), statePath = join(root, 'state.sqlite');
const binary = resolve(process.argv[2] ?? 'dist/runweft'), nativeBinary = resolve(process.argv[3] ?? 'dist/hapi');
const selected = process.env.RUNWEFT_SMOKE_CONSUMER_CASE;
assert(!selected || ['codex', 'remote', 'prepare'].includes(selected), 'Unknown consumer smoke case');
const env: NodeJS.ProcessEnv = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('HAPI_') || key.startsWith('RUNWEFT_') || ['CLI_API_TOKEN', 'DB_PATH', 'TELEGRAM_BOT_TOKEN'].includes(key)) delete env[key];
const codexHome = join(root, 'codex'), claudeHome = join(root, 'claude');
for (const dir of [codexHome, claudeHome]) mkdirSync(dir, { mode: 0o700 });
function copy(from: string, to: string) { if (existsSync(from)) { mkdirSync(dirname(to), { recursive: true, mode: 0o700 }); copyFileSync(from, to); chmodSync(to, 0o600); } }
for (const file of ['config.toml', 'auth.json']) copy(join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), file), join(codexHome, file));
const codexModel = configureSmokeCodexModel(join(codexHome, 'config.toml'));
const sourceClaude = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
copy(process.env.CLAUDE_CONFIG_DIR ? join(sourceClaude, '.claude.json') : join(homedir(), '.claude.json'), join(claudeHome, '.claude.json'));
for (const file of ['settings.json', '.credentials.json']) copy(join(sourceClaude, file), join(claudeHome, file));
const nativeClaude = Bun.which('iclaude') ?? Bun.which('claude'); assert(nativeClaude && Bun.which('codex'));
const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`, wrapper = join(root, 'claude-observer');
writeFileSync(wrapper, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(resolve('scripts/fixtures/claude-observer.mjs'))} "$@"\n`, { mode: 0o700 });
Object.assign(env, { CODEX_HOME: codexHome, CLAUDE_CONFIG_DIR: claudeHome, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Runweft smoke', GIT_AUTHOR_EMAIL: 'smoke@example.invalid', GIT_COMMITTER_NAME: 'Runweft smoke', GIT_COMMITTER_EMAIL: 'smoke@example.invalid',
    HAPI_CLAUDE_PATH: wrapper, RUNWEFT_SMOKE_CLAUDE: nativeClaude, RUNWEFT_SMOKE_CLAUDE_LOG: join(root, 'claude-init.jsonl') });
for (const name of Object.keys((Bun.TOML.parse(readFileSync(join(codexHome, 'config.toml'), 'utf8')) as any).mcp_servers ?? {})) {
    execFileSync('codex', ['mcp', 'remove', name], { env, stdio: 'pipe' });
}
const prefsPath = join(claudeHome, '.claude.json'), prefs = existsSync(prefsPath) ? JSON.parse(readFileSync(prefsPath, 'utf8')) : {};
prefs.mcpServers = {}; writeFileSync(prefsPath, JSON.stringify(prefs), { mode: 0o600 });
const port = await freePort(), target = `http://127.0.0.1:${port}`, rootToken = randomBytes(32).toString('base64url'), key = randomBytes(32);
const secrets: string[] = [rootToken], nativeHome = join(root, 'hapi');
const hapi = Bun.spawn([nativeBinary, 'hub'], { env: { ...env, HAPI_HOME: nativeHome, DB_PATH: join(nativeHome, 'hapi.db'), CLI_API_TOKEN: rootToken,
    HAPI_LISTEN_HOST: '127.0.0.1', HAPI_LISTEN_PORT: String(port), HAPI_PUBLIC_URL: target, TELEGRAM_BOT_TOKEN: '' },
    stdout: Bun.file(join(root, 'hapi-out.log')), stderr: Bun.file(join(root, 'hapi-err.log')) });
let gateway: Awaited<ReturnType<typeof createDelegationGateway>> | undefined, hub: HubStore | undefined, base = '';
const runners: ReturnType<typeof Bun.spawn>[] = [], evidence: any = { root, binary, nativeBinary, codexModel, selected, success: false, checks: [], tasks: [], cleanupErrors: [],
    scope: 'compiled Hub consumers, unchanged HAPI, real Codex/Claude runtimes and two Runners on one physical Linux machine; host MCP metadata covered by separate tests' };
const project = join(root, 'project'); mkdirSync(project);
function git(...args: string[]) { return execFileSync('git', ['-C', project, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
async function cli(home: string, args: string[]) {
    const child = Bun.spawn([binary, '--home', home, '--json', 'hub', '--url', base, ...args], { cwd: project, env, stdout: 'pipe', stderr: 'pipe' });
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    for (const secret of secrets) assert(!(stdout + stderr).includes(secret), 'Credential in CLI output');
    assert.equal(exit, 0, `${args[0]}: ${stderr}`); return JSON.parse(stdout);
}
function check(name: string) { evidence.checks.push(name); console.log('PASS ' + name); }
async function until<T>(fn: () => Promise<T>, good: (value: T) => boolean, label: string, timeoutMs = 40_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) { const value = await fn(); if (good(value)) return value; await Bun.sleep(300); }
    throw new Error('Timeout: ' + label);
}
async function finish(home: string, id: string, timeoutMs = 240_000): Promise<any> {
    return until(async () => {
        const state = await cli(home, ['task', 'show', id]);
        if (state.status === 'failed' || (state.attention && state.attention.code !== 'permission_required')) throw new Error(`Task ${id}: ${JSON.stringify({ status: state.status, attention: state.attention, report: state.report.text })}`);
        for (const request of Object.keys(state.permissions ?? {})) await cli(home, ['task', 'permission', id, '--round', state.round_id, '--request', request, '--decision', 'approved']);
        return state;
    }, value => value.status === 'completed', 'native round ' + id, timeoutMs);
}
console.log('Evidence directory: ' + root);
try {
    await until(async () => { try { return (await fetch(target + '/health', { signal: AbortSignal.timeout(500) })).ok; } catch { return false; } }, Boolean, 'HAPI');
    gateway = await createDelegationGateway({ host: '127.0.0.1', port: 0, target, rootToken, key, statePath, pollMs: 50 });
    base = `http://127.0.0.1:${(gateway.server.address() as { port: number }).port}`;
    hub = new HubStore(statePath); const owner = hub.createIdentity('Task owner'), remote = hub.createIdentity('Runner owner'), space = owner.personalSpace.id;
    hub.acceptInvitation(remote.identity.id, hub.invite(owner.identity.id, space, 'member').token); secrets.push(owner.token, remote.token);
    const homes = [join(root, 'source-client'), join(root, 'target-client')], machineIds: string[] = [];
    for (const [index, user] of [owner, remote].entries()) {
        const home = homes[index], paths = hubConnectionPaths(home, base);
        atomicWrite(paths.identityConnection, JSON.stringify({ schemaVersion: 1, hub: base, ownerId: user.identity.id, spaceId: space, token: user.token, requestId: randomUUID(), createdAt: Date.now() }));
        const enrollment = await cli(home, ['machine', 'enroll', '--name', `consumer-runner-${index}`]); machineIds.push(enrollment.machineId);
        await cli(home, ['machine', 'associate', enrollment.machineId, space]);
        const record = JSON.parse(readFileSync(paths.machineConnection, 'utf8')), runnerHome = join(paths.connection, 'hapi'); secrets.push(record.active.token);
        atomicWrite(join(runnerHome, 'settings.json'), JSON.stringify({ machineId: record.machineId, cliApiToken: record.active.token }));
        runners.push(Bun.spawn([nativeBinary, 'runner', 'start-sync'], { env: { ...env, HAPI_HOME: runnerHome, HAPI_API_URL: base, CLI_API_TOKEN: record.active.token, HAPI_DISABLE_VERSION_HANDOFF: '1' },
            stdout: Bun.file(join(root, `runner-${index}-out.log`)), stderr: Bun.file(join(root, `runner-${index}-err.log`)) }));
    }
    for (const [index, home] of homes.entries()) await until(async () => { assert.equal(runners[index].exitCode, null); const result = await cli(home, ['machine', 'list']); return result.machines.some((m: any) => m.id === machineIds[index] && m.online); }, Boolean, 'Runner online');
    const localCodex = (await cli(homes[0], ['runtime', 'register', 'codex', '--machine', machineIds[0]])).runtime;
    const remoteClaude = (await cli(homes[1], ['runtime', 'register', 'claude', '--machine', machineIds[1]])).runtime;
    await cli(homes[1], ['runtime', 'share', remoteClaude.id, space]);
    git('init', '-q'); git('config', 'commit.gpgsign', 'false'); writeFileSync(join(project, 'baseline.txt'), 'CENTRAL_BASELINE\n'); git('add', '.'); git('commit', '-qm', 'initial');
    const initial = git('rev-parse', 'HEAD');
    const repository = (await cli(homes[0], ['repository', 'create', 'Consumer fixture', '--request-id', randomUUID()])).repository;
    await cli(homes[0], ['repository', 'bind', repository.id, '--machine', machineIds[0]]);
    const agents: any[] = [];
    for (const [name, runtime] of [['codex', localCodex], ['claude', remoteClaude]] as const) {
        const path = join(root, `${name}-agent.json`); writeFileSync(path, JSON.stringify({ name: `Consumer ${name}`, repositoryId: repository.id, runtimeId: runtime.id,
            instructions: '这是专用验收工作区。只完成给出的短任务，不委派，不访问目录外内容，不 push。' }));
        agents.push((await cli(homes[0], ['agent', 'create', '--request-id', randomUUID(), '--file', path])).agent);
    }
    await cli(homes[0], ['agent', 'select', agents[0].id, '--repository', repository.id]);
    check('compiled CLI enrolls distinct machine/runtime identities and associates the actual Git checkout with central Agent defaults');

    if (!selected || selected === 'prepare') {
        const requestId = randomUUID(), args = ['workspace', 'prepare', '--agent', agents[1].id, '--base', initial, '--request-id', requestId];
        const prepared = (await cli(homes[0], args)).preparation;
        assert.equal((await cli(homes[0], args)).preparation.id, prepared.id);
        const ready = await until(() => cli(homes[0], ['workspace', 'inspect', prepared.id]), value => value.preparation.phase === 'ready', 'consumer diagnostic preparation');
        assert.equal(readFileSync(join(ready.preparation.workspace.cwd, 'baseline.txt'), 'utf8'), 'CENTRAL_BASELINE\n');
        assert.equal(ready.preparation.nativeExecution, 'not_started');
        assert((await cli(homes[0], ['workspace', 'preparations'])).preparations.some((p: any) => p.id === prepared.id));
        await cli(homes[0], ['workspace', 'release', prepared.id]);
        await until(() => cli(homes[0], ['workspace', 'inspect', prepared.id]), value => value.preparation.phase === 'released', 'consumer diagnostic release');
        check('compiled diagnostic commands prepare, replay, inspect and release a real remote Git worktree without starting a model');
    }
    if (!selected || selected === 'codex') {
    const accepted = await cli(homes[0], ['task', 'spawn', '--message', '不要调用工具或更改文件。只回复 CENTRAL_CODEX_FIRST。']);
    const first = await finish(homes[0], accepted.agent_id); assert(first.report.text.includes('CENTRAL_CODEX_FIRST')); assert.equal(first.stop, 'stopped');
    const next = await cli(homes[0], ['task', 'send', accepted.agent_id, '--message', '继续上一轮。不要调用工具或修改文件。只回复 CENTRAL_CODEX_RESUMED。']);
    const second = await finish(homes[0], accepted.agent_id); assert.equal(second.round_id, next.round_id); assert(second.report.text.includes('CENTRAL_CODEX_RESUMED'));
    assert.equal(second.native_session_id, first.native_session_id); assert.equal(second.stop, 'stopped');
    evidence.tasks.push({ mode: 'shared', runtime: 'codex', id: accepted.agent_id, firstRound: first.round_id, secondRound: second.round_id, nativeSessionId: second.native_session_id });
    check('real Codex shared execution stops each round and resumes the same native session through the saved Hub identity');

    const local = await cli(homes[0], ['task', 'spawn', agents[0].id, '--workspace-mode', 'worktree', '--base', initial,
        '--message', '在当前工作目录创建 local.txt，内容为 CENTRAL_LOCAL_WORKTREE。只修改这个文件，不进行 git 操作。完成后回复 CENTRAL_LOCAL_DONE。']);
    const localDone = await finish(homes[0], local.agent_id); assert(localDone.report.text.includes('CENTRAL_LOCAL_DONE'));
    assert.equal(localDone.environment.mode, 'worktree'); assert.notEqual(localDone.git.checkout, project); assert.equal(git('status', '--porcelain'), '');
    assert(git('show', `${localDone.git.result_ref}:local.txt`).includes('CENTRAL_LOCAL_WORKTREE'));
    evidence.tasks.push({ mode: 'worktree', runtime: 'codex', id: local.agent_id, ref: localDone.git.result_ref });
    check('real local worktree starts from the committed baseline and retains code in a reviewable ref without changing the parent checkout');

    }
    if (!selected || selected === 'remote') {
    const inputPath = join(root, 'input.txt'); writeFileSync(inputPath, 'CENTRAL_INPUT_BYTES\n');
    const input = await cli(homes[0], ['artifact', 'upload', inputPath, '--name', 'input.txt']);
    const remoteTask = await cli(homes[0], ['task', 'spawn', agents[1].id, '--workspace-mode', 'worktree', '--base', initial, '--input', input.id, '--output', 'result.txt',
        '--message', '读取提供的 input.txt 输入附件。在当前工作目录创建 result.txt，内容必须与输入附件完全一致。只修改 result.txt，不进行 git 操作，不委派。完成后回复 CENTRAL_CLAUDE_DONE。']);
    const remoteDone = await finish(homes[0], remoteTask.agent_id); assert(remoteDone.report.text.includes('CENTRAL_CLAUDE_DONE')); assert.equal(remoteDone.stop, 'stopped');
    const manifests = await cli(homes[0], ['task', 'artifacts', 'show', remoteTask.agent_id, '--round', remoteDone.round_id]);
    const file = manifests.manifests.at(-1).items.find((item: any) => item.name === 'result.txt'); assert.equal(file.status, 'available');
    const downloaded = join(root, 'downloaded.txt'); await cli(homes[0], ['artifact', 'download', file.artifactId, '--output', downloaded]);
    assert.equal(readFileSync(downloaded, 'utf8'), 'CENTRAL_INPUT_BYTES\n');
    const remoteUser = new HubClient({ url: base, home: homes[1], env }, 'hubAccess', 'unavailable');
    await assert.rejects(() => remoteUser.http.request(`/api/artifacts/${file.artifactId}`), { status: 404 });
    await cli(homes[0], ['task', 'result', 'fetch', remoteTask.agent_id]);
    const fetched = await until(() => cli(homes[0], ['task', 'result', 'show', remoteTask.agent_id]), value => value.fetches.at(-1)?.status === 'available', 'result fetch');
    const ref = fetched.fetches.at(-1).fetched.ref; assert.equal(git('show', `${ref}:result.txt`), 'CENTRAL_INPUT_BYTES');
    assert.equal(git('rev-parse', 'HEAD'), initial); assert.equal(git('status', '--porcelain'), '');
    evidence.tasks.push({ mode: 'remote-worktree', runtime: 'claude', id: remoteTask.agent_id, ref, artifactId: file.artifactId });
    check('real remote Claude receives input before launch, returns private artifact bytes and a fetchable code ref without pushing or merging');
    }
    const logs = ['hapi-out.log', 'hapi-err.log', 'runner-0-out.log', 'runner-0-err.log', 'runner-1-out.log', 'runner-1-err.log'];
    for (const file of logs) for (const secret of secrets) assert(!readFileSync(join(root, file), 'utf8').includes(secret), 'Credential in native service log');
    evidence.success = true;
} catch (error) { evidence.error = error instanceof Error ? error.message : String(error); process.exitCode = 1; }
finally {
    if (gateway) try { const { sessions } = await gateway.native.json('/api/sessions'); for (const session of sessions) if (session.active) await gateway.native.write(`/api/sessions/${session.id}/archive`, {}); }
    catch (error) { evidence.cleanupErrors.push(String(error)); }
    for (const runner of runners) { runner.kill(); await runner.exited; }
    await gateway?.close(); hub?.close(); hapi.kill(); await hapi.exited;
    if (evidence.cleanupErrors.length) { evidence.success = false; process.exitCode = 1; }
    writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2), { mode: 0o600 });
    console.log('Evidence: ' + join(root, 'evidence.json')); if (evidence.error) console.error(evidence.error);
}
