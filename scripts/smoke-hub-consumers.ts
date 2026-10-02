import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { atomicWrite } from '../src/config';
import { freePort } from '../src/services';
import { HubClient } from '../src/hub/client';
import { hubConnectionPaths } from '../src/hub/resources/connection';
import { modelHomes } from './fixtures/model-homes';
import { closeSmoke } from './fixtures/smoke-lifecycle';
import { removeFileSmokeData } from './fixtures/native-file-smoke';
import { installedBinaries } from './fixtures/installed-binaries.mjs';

mkdirSync('.dev-smoke', { recursive: true });
const root = mkdtempSync(resolve('.dev-smoke/hub-consumers-')), serverHome = join(root, 'server');
const binary = resolve(process.argv[2] ?? 'dist/runweft'), binaries = installedBinaries(binary);
const selected = process.env.RUNWEFT_SMOKE_CONSUMER_CASE;
assert(!selected || ['codex', 'remote', 'prepare', 'controls'].includes(selected), 'Unknown consumer smoke case');
const env: NodeJS.ProcessEnv = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('HAPI_') || key.startsWith('RUNWEFT_') || ['CLI_API_TOKEN', 'DB_PATH', 'TELEGRAM_BOT_TOKEN'].includes(key)) delete env[key];
const project = join(root, 'project'); mkdirSync(project);
const models = modelHomes(root, env), codexHome = env.CODEX_HOME!, claudeHome = env.CLAUDE_CONFIG_DIR!;
const { codexModel, nativeClaude } = models;

function copy(from: string, to: string) { if (existsSync(from)) { mkdirSync(dirname(to), { recursive: true, mode: 0o700 }); copyFileSync(from, to); chmodSync(to, 0o600); } }
const pids = new Set<number>(), privateCopies: string[] = [];
const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`, wrapper = join(root, 'claude-observer');
let port: number, base: string;
const secrets: string[] = [];
const homes = [join(root, 'source-client'), join(root, 'target-client')];
const homeEnvironments = new Map<string, NodeJS.ProcessEnv>();
let ownerClient: HubClient | undefined;
const evidence: any = { root, binary, binaries, codexModel, selected, kind: 'hub-consumers', handoffRequested: process.env.RUNWEFT_SMOKE_HANDOFF === '1', success: false, checks: [], tasks: [], rounds: [], cleanupErrors: [],
    scope: 'installed default Hub and adjacent unchanged HAPI, real Codex/Claude runtimes and two CLI-managed Runners on one physical Linux machine' };

function git(...args: string[]) { return execFileSync('git', ['-C', project, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
async function cli(home: string, args: string[]) {
    const child = Bun.spawn([binary, '--home', home, '--json', ...args], { cwd: project, env: homeEnvironments.get(home) ?? env, stdout: 'pipe', stderr: 'pipe' });
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    for (const secret of secrets) assert(!(stdout + stderr).includes(secret), 'Credential in CLI output');
    assert.equal(exit, 0, `${args[0]}: ${stderr}`);
    const value = JSON.parse(stdout);
    if (args[0] === 'task' && ['spawn', 'send'].includes(args[1]) && value.accepted) evidence.rounds.push({ taskId: value.agent_id, roundId: value.round_id });
    if (args[0] === 'task' && args[1] === 'show' && typeof value.host_pid === 'number') pids.add(value.host_pid);
    return value;
}
function check(name: string) { evidence.checks.push(name); console.log('PASS ' + name); }
async function hubApi(path: string, body: object, token?: string) {
    const response = await fetch(base + '/api/runweft/hub' + path, { method: 'POST', headers: {
        'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    assert(response.ok, `Hub setup ${path}: ${response.status}`); return response.json() as any;
}
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
    assert(nativeClaude && Bun.which('codex'));
writeFileSync(wrapper, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(resolve('scripts/fixtures/claude-observer.mjs'))} "$@"\n`, { mode: 0o700 });
Object.assign(env, { CODEX_HOME: codexHome, CLAUDE_CONFIG_DIR: claudeHome, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Runweft smoke', GIT_AUTHOR_EMAIL: 'smoke@example.invalid', GIT_COMMITTER_NAME: 'Runweft smoke', GIT_COMMITTER_EMAIL: 'smoke@example.invalid',
    HAPI_CLAUDE_PATH: wrapper, RUNWEFT_SMOKE_CLAUDE: nativeClaude, RUNWEFT_SMOKE_CLAUDE_LOG: join(root, 'claude-init.jsonl') });
for (const name of Object.keys((Bun.TOML.parse(readFileSync(join(codexHome, 'config.toml'), 'utf8')) as any).mcp_servers ?? {})) {
    execFileSync('codex', ['mcp', 'remove', name], { env, stdio: 'pipe' });
}
const prefsPath = join(claudeHome, '.claude.json'), prefs = existsSync(prefsPath) ? JSON.parse(readFileSync(prefsPath, 'utf8')) : {};
prefs.mcpServers = {}; writeFileSync(prefsPath, JSON.stringify(prefs), { mode: 0o600 });
    port = await freePort(); base = `http://127.0.0.1:${port}`;
    await cli(serverHome, ['init']); await cli(serverHome, ['config', 'set', 'server.port', String(port)]); await cli(serverHome, ['start']);
    const owner = await hubApi('/identities', { name: 'Task owner' }), remote = await hubApi('/identities', { name: 'Runner owner' }), space = owner.personalSpace.id;
    Object.assign(evidence, { serverHome, clientHomes: homes, ownerId: owner.identity.id, spaceId: space });
    const invitation = await hubApi(`/spaces/${space}/invitations`, { role: 'member' }, owner.token);
    await hubApi('/invitations/accept', { token: invitation.token }, remote.token); secrets.push(owner.token, remote.token, invitation.token);
    const machineIds: string[] = [];
    for (const [index, user] of [owner, remote].entries()) {
        const home = homes[index], paths = hubConnectionPaths(home, base);
        await cli(home, ['init', '--url', base]);
        atomicWrite(paths.identityConnection, JSON.stringify({ schemaVersion: 1, hub: base, ownerId: user.identity.id, spaceId: space, token: user.token, requestId: randomUUID(), createdAt: Date.now() }));
        const enrollment = await cli(home, ['machine', 'enroll', '--name', `consumer-runner-${index}`]); machineIds.push(enrollment.machineId);
        await cli(home, ['machine', 'associate', enrollment.machineId, space]);
        const record = JSON.parse(readFileSync(paths.machineConnection, 'utf8')); secrets.push(record.active.token);
        await cli(home, ['runner', 'start']);
    }
    ownerClient = new HubClient({ url: base, home: homes[0], env }, 'hubDelegation', 'unavailable');
    for (const [index, home] of homes.entries()) await until(async () => { const result = await cli(home, ['machine', 'list']); return result.machines.some((machine: any) => machine.id === machineIds[index] && machine.online); }, Boolean, 'Runner online');
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
    const emptyCodex = join(root, 'codex-without-history'); mkdirSync(emptyCodex, { mode: 0o700 });
    for (const file of ['config.toml', 'auth.json']) { const path = join(emptyCodex, file); privateCopies.push(path); copy(join(codexHome, file), path); }
    await cli(homes[0], ['runner', 'stop']);
    homeEnvironments.set(homes[0], { ...env, CODEX_HOME: emptyCodex });
    await cli(homes[0], ['runner', 'start']);
    await until(async () => {
        return (await cli(homes[0], ['machine', 'list'])).machines.some((machine: any) => machine.id === machineIds[0] && machine.online);
    }, Boolean, 'Runner with missing native history');
    const rebuilt = await cli(homes[0], ['task', 'send', accepted.agent_id, '--message', '原生历史可能已缺失。只根据系统提供的业务历史，回复前两轮的最终回复原文，再加 CENTRAL_HISTORY_DONE。不要调用工具。']);
    const third = await finish(homes[0], accepted.agent_id); assert.equal(third.round_id, rebuilt.round_id);
    assert.notEqual(third.native_session_id, second.native_session_id); assert.equal(third.reconstruction?.reason, 'native_session_missing');
    assert(third.report.text.includes('CENTRAL_CODEX_FIRST') && third.report.text.includes('CENTRAL_CODEX_RESUMED') && third.report.text.includes('CENTRAL_HISTORY_DONE'));
    evidence.tasks.push({ mode: 'history-reconstruction', runtime: 'codex', id: accepted.agent_id, round: third.round_id, nativeSessionId: third.native_session_id });
    check('missing native history starts one replacement session with bounded business history, preserving previous round reports');


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
    assert.equal((await cli(homes[0], ['task', 'show', remoteTask.agent_id])).environment.status, 'retained');
    await cli(homes[0], ['task', 'result', 'release', remoteTask.agent_id, '--apply']);
    await cli(homes[0], ['task', 'artifacts', 'release', remoteTask.agent_id, '--apply']);
    await until(async () => {
        const detail = await cli(homes[0], ['task', 'show', remoteTask.agent_id]);
        const result = await cli(homes[0], ['task', 'result', 'show', remoteTask.agent_id]);
        return { detail, result };
    }, ({ detail, result }) => result.fetches.every((fetch: any) => fetch.released === true)
        && detail.code.retention.state === 'released' && detail.artifacts.retention.state === 'released'
        && detail.artifacts.pending.length === 0 && detail.input_files.download_retention === 'released'
        && detail.stop === 'stopped' && detail.finish === 'complete', 'remote result and artifact release before workspace removal');
    await cli(homes[0], ['task', 'workspace', 'remove', remoteTask.agent_id, '--discard-ignored']);
    await until(() => cli(homes[0], ['task', 'show', remoteTask.agent_id]), value => value.environment.status === 'removed', 'explicit remote workspace release');
    assert.equal(git('show', `${ref}:result.txt`), 'CENTRAL_INPUT_BYTES');
    check('explicit release removes remote environment and central references while preserving the fetched parent result ref');

    }
    if (!selected || selected === 'controls') {
        for (const flavor of ['codex', 'claude']) {
            const runtime = (await cli(homes[0], ['runtime', 'register', flavor, '--machine', machineIds[0]])).runtime;
            const definition = join(root, `control-${flavor}.json`);
            writeFileSync(definition, JSON.stringify({ name: `Control ${flavor}`, runtimeId: runtime.id }));
            const agent = (await cli(homes[0], ['agent', 'create', '--file', definition, '--request-id', randomUUID()])).agent;
            const marker = `CONTROL_${randomUUID().slice(0, 8)}`;
            const task = await cli(homes[0], ['task', 'spawn', agent.id, '--message', `不要调用工具。记住 ${marker}，只回复该标记。`]);
            const first = await finish(homes[0], task.agent_id); assert(first.report.text.includes(marker));
            const slow = await cli(homes[0], ['task', 'send', task.agent_id, '--message', '只运行 sleep 60，之后回复 SLOW_DONE。不修改文件，不委派。']);
            const active = await until(() => cli(homes[0], ['task', 'show', task.agent_id]),
                value => value.round_id === slow.round_id && value.inputs[0]?.observation?.phase === 'accepted', 'running interrupt target', 120_000);
            assert.equal((await cli(homes[0], ['task', 'interrupt', task.agent_id, '--round', first.round_id])).status, 'already_finished');
            await cli(homes[0], ['task', 'interrupt', task.agent_id, '--round', slow.round_id]);
            const stopped = await until(() => cli(homes[0], ['task', 'show', task.agent_id]),
                value => value.status === 'interrupted' && value.stop === 'stopped' && value.finish === 'complete', 'interrupted native process', 120_000);
            assert.equal(stopped.inputs[0].observation.executionId, active.inputs[0].observation.executionId);
            assert.equal(stopped.inputs[0].observation.phase, 'interrupted');
            const session: any = (await ownerClient.http.request(`/api/sessions/${stopped.session_id}`)).session; assert.equal(session.active, false);
            await cli(homes[0], ['task', 'send', task.agent_id, '--message', '不要调用工具。只回复第一轮要求你记住的标记。']);
            const resumed = await finish(homes[0], task.agent_id);
            assert(resumed.report.text.includes(marker)); assert.equal(resumed.native_session_id, first.native_session_id);
            evidence.tasks.push({ mode: 'interrupt-resume', runtime: flavor, id: task.agent_id, nativeSessionId: resumed.native_session_id });
            check(`${flavor}: exact-round interrupt stops native execution, ignores stale round and resumes original memory`);
        }
    }
    const reports = await Promise.all(evidence.tasks.map(async (task: any) => ({ id: task.id, detail: await cli(homes[0], ['task', 'show', task.id]) })));
    await cli(serverHome, ['restart']);
    for (const previous of reports) {
        const current = await cli(homes[0], ['task', 'show', previous.id]);
        assert.equal(current.round_id, previous.detail.round_id); assert.equal(current.native_session_id, previous.detail.native_session_id);
        assert.deepEqual(current.report, previous.detail.report); assert.equal(current.stop, 'stopped');
    }
    check('installed Hub restart reads unchanged round IDs, native sessions and reports without replaying completed models');
    for (const file of ['service.log', 'hapi-hub.log']) for (const secret of secrets) {
        assert(!readFileSync(join(serverHome, 'logs', file), 'utf8').includes(secret), 'Credential in service log');
    }
    evidence.success = true;
} catch (error) { evidence.error = error instanceof Error ? error.message : String(error); process.exitCode = 1; }
finally {
    const attempt = async (action: () => void | Promise<void>) => { try { await action(); } catch (error) { evidence.cleanupErrors.push(String(error)); } };
    const client = ownerClient?.http;
    let sessionsConfirmed = !client;
    if (client) await attempt(async () => {
        const { sessions } = await client.request('/api/sessions');
        let archived = true;
        for (const session of sessions) {
            if (typeof session.metadata?.hostPid === 'number') pids.add(session.metadata.hostPid);
            if (session.active) { let confirmed = false; await attempt(async () => { await client.request(`/api/sessions/${session.id}/archive`, { method: 'POST', signal: AbortSignal.timeout(45_000) }); confirmed = true; }); archived &&= confirmed; }
        }
        sessionsConfirmed = archived;
    });
    const fixtureHomes = [...homes, serverHome];
    const paths: any[] = []; let stopsConfirmed = true;
    for (const directory of fixtureHomes) if (existsSync(join(directory, 'config.yaml'))) {
        await attempt(async () => { paths.push(await cli(directory, ['paths'])); });
        await attempt(async () => { await cli(directory, ['stop']); });
        let confirmed = false;
        await attempt(async () => { const status = await cli(directory, ['status']);
            assert.equal(status.service.running, false); assert.equal(status.runner.running, false); confirmed = true; });
        stopsConfirmed &&= confirmed;
    }
    let hostsStopped = false;
    await attempt(async () => { await models.waitHosts(pids); hostsStopped = true; });
    const safe = sessionsConfirmed && stopsConfirmed && hostsStopped;
    if (!safe) evidence.cleanupErrors.push('Process shutdown uncertain; configuration and connection secrets retained');
    await attempt(() => models.verify());
    if (safe) {
        await attempt(() => models.remove());
        await attempt(() => closeSmoke(privateCopies.map(path => () => rmSync(path, { force: true }))));
        const handoff = evidence.success && !evidence.cleanupErrors.length && evidence.handoffRequested;
        evidence.handoff = handoff;
        if (handoff) { evidence.cleanupOwner = 'T7 final consumer'; evidence.paths = paths; evidence.nativeHomes = { codex: codexHome, claude: claudeHome }; }
        else await attempt(() => closeSmoke(paths.flatMap(path => [path.identityConnection, path.machineConnection, path.pendingConnection, join(path.hapiClient, 'settings.json'), join(path.hapiServer, 'settings.json'), join(path.hapiServer, 'jwt-secret.json')]).filter(Boolean).map(path => () => rmSync(path, { force: true }))));
    }
    if (evidence.cleanupErrors.length) { evidence.success = false; process.exitCode = 1; }
    evidence.hostPids = [...pids]; evidence.finishedAt = new Date().toISOString();
    writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2), { mode: 0o600 });
    if (evidence.success && !evidence.handoff) await attempt(() => removeFileSmokeData(root));
    if (evidence.cleanupErrors.length) { evidence.success = false; process.exitCode = 1; writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2), { mode: 0o600 }); }
    console.log('Evidence: ' + join(root, 'evidence.json')); if (evidence.error) console.error(evidence.error);
}
