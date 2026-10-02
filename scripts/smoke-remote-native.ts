import { remoteTaskProbe } from './remote-task-probe';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from 'bun:sqlite';
import type { HapiHttp } from '../src/hapi';
import { nativeFileSmoke } from './fixtures/native-file-smoke';
import { nativeUserSmoke } from './fixtures/native-user-smoke';
import { modelHomes } from './fixtures/model-homes';
import { closeSmoke } from './fixtures/smoke-lifecycle';
import { hubConnectionPaths } from '../src/hub/resources/connection';
import { HubPreparationClient } from '../src/hub/delegation/client';
import { ExecutionClient } from '../src/execution';
import { ArtifactClient } from '../src/artifacts/client';
import { codexCatalog } from './fixtures/codex-catalog';
import type { ManagedWorkspace, WorkspaceMutation } from '../hapi/shared/src/workspaces';
import pkg from '../package.json';

// Explicit native acceptance in private homes. No business remote task or model configuration changes.
const tasksMode = process.argv.includes('--tasks'), args = process.argv.slice(2).filter(arg => arg !== '--tasks');
const binary = resolve(args[0] ?? 'dist/runweft'), hapiBinary = resolve(args[1] ?? 'dist/hapi');
const selected = args[2]; assert(!selected || ['codex', 'claude'].includes(selected));
const retentionHandoff = tasksMode && !selected;
mkdirSync('.dev-smoke', { recursive: true });
const evidenceDir = mkdtempSync(resolve(tasksMode ? '.dev-smoke/remote-tasks-native-' : '.dev-smoke/remote-native-'));
// Fixed HAPI expects untruncated Claude project names. Keep this invocation's native cwd below that limit.
const ownedTempRoot = mkdtempSync(join(tmpdir(), 'runweft-remote-')), root = join(ownedTempRoot, '.dev-smoke'); mkdirSync(root);

const center = join(root, 'center'), sourceHome = join(root, 'source-runner'), targetHome = join(root, 'target-runner');
const source = join(root, 'source'), project = join(source, 'project'), codexHome = join(root, 'codex-home'), claudeHome = join(root, 'claude-home');
const env = { ...process.env }; for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_') || key.startsWith('HAPI_') || ['CLI_API_TOKEN', 'DB_PATH', 'TELEGRAM_BOT_TOKEN'].includes(key)) delete env[key];
Object.assign(env, { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' });
const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
let models: ReturnType<typeof modelHomes> | undefined;
const probeLog = join(root, 'mcp.jsonl'), claudeLog = join(root, 'claude-init.jsonl');
const probe = { command: process.execPath, args: [resolve('scripts/fixtures/mcp-probe.mjs')], env: { RUNWEFT_SMOKE_PROBE_LOG: probeLog } };
const evidence: any = { ownedRoot: root, ownedTempRoot, evidenceDir, center, sourceHome, targetHome, binary, hapiBinary, revision: pkg.hapi.revision, startedAt: new Date().toISOString(), success: false, checks: [], cases: [], cleanupErrors: [] };
const modelConfigurationBackups = new Set<string>(), pids = new Set<number>(); let hapi!: HapiHttp, execution!: ExecutionClient, target = '';
let fileFixture: Awaited<ReturnType<typeof nativeFileSmoke>> | undefined, userFixture: Awaited<ReturnType<typeof nativeUserSmoke>> | undefined;
let sourceRunner: any, targetRunner: any, currentDomain: any, factoryAttempted = false;
function cli(home: string, args: string[], cwd = root) {
    assert(userFixture, 'Compiled CLI helper only used by Task mode'); return userFixture.cli(home, args, { cwd });
}
function git(cwd: string, ...args: string[]) { const result = spawnSync('git', ['-C', cwd, ...args], { env, encoding: 'utf8', timeout: 30_000 }); assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); }
function init(cwd: string) { mkdirSync(cwd, { recursive: true }); git(cwd, 'init', '-q'); git(cwd, 'config', 'user.name', 'Remote Native'); git(cwd, 'config', 'user.email', 'smoke@example.invalid'); git(cwd, 'config', 'commit.gpgsign', 'false'); }
function commit(cwd: string) { git(cwd, 'add', '.'); git(cwd, 'commit', '-qm', 'fixture'); }
const lines = (path: string): any[] => existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
const note = (message: string) => { evidence.checks.push(message); console.log(message); };
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, label: string, ms = 180_000): Promise<T> {
    const end = Date.now() + ms; while (Date.now() < end) { const value = await read(); if (done(value)) return value; await Bun.sleep(200); } throw new Error(`Observation deadline: ${label}`);
}
const post = (domain: string, body: unknown) => fileFixture!.gateway.delegation.taskClient(currentDomain.task, currentDomain.round).request(`/api/machines/${target}/${domain}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
async function workspace(request: WorkspaceMutation) {
    await post('workspaces', request); const key = request.action === 'prepare' ? `prepare:${request.preparationId}` : request.action === 'finalize' ? `finalize:${request.roundId}:${request.attemptId}` : `remove:${request.attemptId}`;
    const value = await until(async () => (await post('workspaces', { action: 'inspect', environmentId: request.environmentId })).workspace as ManagedWorkspace,
        item => !['accepted', 'running'].includes(item.operations[key]!.status), key);
    assert.equal(value.operations[key]!.status, 'succeeded', JSON.stringify(value.operations[key]!.error)); return value;
}
console.log(`Evidence directory: ${evidenceDir}; runtime root: ${root}`);
try {
    models = modelHomes(root, env);
const codexConfig = join(codexHome, 'config.toml');
for (const name of Object.keys((Bun.TOML.parse(readFileSync(codexConfig, 'utf8')) as any).mcp_servers ?? {})) assert.equal(spawnSync('codex', ['mcp', 'remove', name], { env, stdio: 'pipe' }).status, 0);
assert.equal(spawnSync('codex', ['mcp', 'add', 'keep_probe', '--env', `RUNWEFT_SMOKE_PROBE_LOG=${probeLog}`, '--', probe.command, ...probe.args], { env, stdio: 'pipe' }).status, 0);
const prefsPath = join(claudeHome, '.claude.json'), prefs = JSON.parse(readFileSync(prefsPath, 'utf8')); prefs.mcpServers = { keep_probe: { type: 'stdio', ...probe } }; writeFileSync(prefsPath, JSON.stringify(prefs), { mode: 0o600 });
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`, wrapper = join(root, 'claude-observer');
writeFileSync(wrapper, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(resolve('scripts/fixtures/claude-observer.mjs'))} "$@"\n`, { mode: 0o700 });
Object.assign(env, { HAPI_CLAUDE_PATH: wrapper, RUNWEFT_SMOKE_CLAUDE: models!.nativeClaude, RUNWEFT_SMOKE_CLAUDE_LOG: claudeLog });
    factoryAttempted = true;
    if (tasksMode) {
        userFixture = await nativeUserSmoke(root, binary, env, hapiBinary);
        sourceRunner = await userFixture.runner(sourceHome); targetRunner = await userFixture.runner(targetHome);
        hapi = sourceRunner.http; target = targetRunner.machineId;
    } else {
        fileFixture = await nativeFileSmoke(root, [binary], hapiBinary, env);
        sourceRunner = await fileFixture.addRunner(); targetRunner = await fileFixture.addRunner();
        hapi = fileFixture.http; target = targetRunner.machineId;
    }
    Object.assign(evidence, { candidate: tasksMode ? userFixture!.candidate : fileFixture!.candidate, kind: tasksMode ? 'current-remote-tasks-1' : 'current prepared domain + real native models; no Task coordinator E2E' });
    const artifacts = new ArtifactClient(hapi);
    Object.assign(evidence, { url: tasksMode ? userFixture!.url : fileFixture!.url, ownerId: tasksMode ? userFixture!.user.identity.id : fileFixture!.user.identity.id,
        spaceId: tasksMode ? userFixture!.space : fileFixture!.space, serverHome: tasksMode ? userFixture!.server : null,
        statePath: tasksMode ? cli(center, ['paths']).state : fileFixture!.statePath,
        identityFile: tasksMode ? userFixture!.identityFile : fileFixture!.identityFile,
        source: { machineId: sourceRunner.machineId, home: tasksMode ? sourceHome : sourceRunner.home, nativeHome: tasksMode ? sourceRunner.hapiHome : join(sourceRunner.credentialFile, '..', 'hapi') },
        target: { machineId: target, home: tasksMode ? targetHome : targetRunner.home, nativeHome: tasksMode ? targetRunner.hapiHome : join(targetRunner.credentialFile, '..', 'hapi') },
        project, cwd: join(project, 'app'), selected: selected ?? 'all', cleanupOwner: retentionHandoff ? 'result-retention' : 'this invocation', retainedForConsumer: retentionHandoff,
        candidate: { ...(tasksMode ? userFixture!.candidate : fileFixture!.candidate), binary, hapiBinary, hashes: { cli: digest(binary), hapi: digest(hapiBinary) }, hapiRevision: pkg.hapi.revision },
    });
    async function compiledSetup(home: string, args: string[]) {
        const child = Bun.spawn([binary, '--home', home, '--json', ...args], { env, stdout: 'pipe', stderr: 'pipe' });
        const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        const secret = tasksMode ? userFixture!.user.token : fileFixture!.user.token;
        assert(!(stdout + stderr).includes(secret), 'Credential leaked in MCP setup'); assert.equal(code, 0, stderr); return JSON.parse(stdout);
    }
    if (!tasksMode) await compiledSetup(sourceRunner.home, ['init', '--url', fileFixture!.url]);
    const installed = tasksMode ? cli(sourceHome, ['mcp', 'install', '--client', 'all']) : await compiledSetup(sourceRunner.home, ['mcp', 'install', '--client', 'all']);
    if (installed.backupPath) { assert(installed.backupPath.startsWith(root + '/')); modelConfigurationBackups.add(installed.backupPath); }
    assert((Bun.TOML.parse(readFileSync(codexConfig, 'utf8')) as any).mcp_servers.runweft, 'Runweft must really be configured before filtering');
    assert(JSON.parse(readFileSync(prefsPath, 'utf8')).mcpServers.runweft, 'Claude Runweft must really be configured before filtering');
    evidence.runweftMcpConfiguredBeforeExecution = true;
    const context = `PROJECT_${randomUUID()}`, skill = `SKILL_${randomUUID()}`, memory = `MEMORY_${randomUUID()}`;
    init(project); mkdirSync(join(project, 'app')); writeFileSync(join(project, 'app/note'), 'committed baseline');
    for (const name of ['AGENTS.md', 'CLAUDE.md']) writeFileSync(join(project, name), `这是专用${tasksMode ? '远端任务' : '只读准备'}验收工程。报告附带 ${context}，只执行明确请求，${tasksMode ? '允许按任务要求生成指定文件，不运行 Git 写命令' : '不修改工程文件'}，不委派，不创建工作流文档。\n`);
    for (const directory of ['.agents/skills/remote-probe', '.claude/skills/remote-probe']) { mkdirSync(join(project, directory), { recursive: true }); writeFileSync(join(project, directory, 'SKILL.md'), `---\nname: remote-probe\ndescription: 用户要求 remote-probe 时读取验证指令。\n---\n最终报告附带 ${skill}；${tasksMode ? '按明确任务编辑指定文件' : '不编辑'}、不委派。\n`); }
    commit(project); git(project, 'lfs', 'install', '--local'); writeFileSync(join(project, '.gitattributes'), '*.bin filter=lfs diff=lfs merge=lfs -text\n');
    const bytes = Buffer.from('REMOTE_BINARY\0'.repeat(1024)); writeFileSync(join(project, 'asset.bin'), bytes); commit(project);
    const child = join(source, 'module'); init(child); writeFileSync(join(child, 'note'), 'module baseline'); commit(child); writeFileSync(join(child, 'second'), 'module second'); commit(child);
    git(project, '-c', 'protocol.file.allow=always', 'submodule', 'add', child, 'vendor/module'); commit(project);
    const base = git(project, 'rev-parse', 'HEAD'), expectedHash = digest(join(project, 'asset.bin'));
    if (tasksMode) {
        await remoteTaskProbe({ root, center, sourceHome, targetHome, project, target, hapi, env, base, selected, context, skill, memory,
            claudeLog, probeLog, pids, cases: evidence.cases, note, cli, git, fixture: userFixture!, targetRunner });
    } else {
    const flavors = (['codex', 'claude'] as const).filter(flavor => !selected || selected === flavor), prepared: any[] = [];
    for (const flavor of flavors) {
        const runtime = (await fileFixture!.cli(['runtime', 'register', flavor, '--machine', target])).runtime;
        const repository = (await fileFixture!.cli(['repository', 'create', `Remote ${flavor}`, '--request-id', randomUUID()])).repository;
        await fileFixture!.cli(['repository', 'bind', repository.id, '--machine', sourceRunner.machineId, '--cwd', join(project, 'app')]);
        const definition = join(root, `agent-${flavor}.json`); writeFileSync(definition, JSON.stringify({ name: `Remote ${flavor}`, repositoryId: repository.id, runtimeId: runtime.id }));
        const agent = (await fileFixture!.cli(['agent', 'create', '--request-id', randomUUID(), '--file', definition])).agent;
        const options = { url: fileFixture!.url, identityFile: fileFixture!.identityFile, space: fileFixture!.space, home: sourceRunner.home, env };
        const client = new HubPreparationClient(options, join(project, 'app'));
        const accepted = await client.prepare(agent.id, base, randomUUID());
        const ready = await until(() => client.inspect(accepted.id), item => { if (item.phase === 'failed') throw new Error(JSON.stringify(item.error)); return item.phase === 'ready' && item.cleanup.sourceReleased && item.cleanup.downloadsReleased; }, `${flavor} diagnostic`);
        prepared.push({ flavor, diagnostic: ready, parent: client.parent });
    }
    writeFileSync(join(project, 'app/note'), 'new parent branch'); commit(project); assert.notEqual(git(project, 'rev-parse', 'HEAD'), base);
    renameSync(source, `${source}-offline`); await fileFixture!.stopRunner(sourceRunner); assert(!existsSync(project));
    note('two runtime diagnostics inherit one fixed snapshot; the parent branch moved and all source paths/Runner are unavailable before native execution');
    for (const { flavor, diagnostic, parent } of prepared) {
        const actor = fileFixture!.gateway.store.authenticate(fileFixture!.user.token, fileFixture!.space);
        const namespace = fileFixture!.gateway.delegation.scopes.ensure(actor), store = fileFixture!.gateway.delegation.coordinator.store;
        const snapshot = diagnostic.agent;
        const accepted = store.accept(namespace, parent, randomUUID(), { agentType: snapshot.id, workspaceMode: 'worktree', baseRef: base, message: 'Explicit prepared native probe' }, snapshot, snapshot.hub.target, diagnostic.origin);
        currentDomain = store.require(namespace, accepted.agent_id);
        currentDomain.round = currentDomain.rounds[0];
        function terminalRound() { const r = currentDomain.round; r.phase = 'finished'; r.stop = 'not_started'; r.finish = 'complete'; r.executionAbsent = true; r.completedAt = Date.now(); store.save(currentDomain.task, r, []); execution = new ExecutionClient(fileFixture!.gateway.delegation.taskClient(currentDomain.task, r)); }
        function nextDomainRound() { store.append(namespace, currentDomain.task.parent, randomUUID(), { id: currentDomain.task.id, mode: 'next', message: 'Explicit independent resume probe' }, snapshot); const bundle = store.require(namespace, currentDomain.task.id); currentDomain.task = bundle.task; currentDomain.round = bundle.rounds.at(-1)!; terminalRound(); }
        terminalRound();
        const environmentId = diagnostic.environmentId; let state = (await post('workspaces', { action: 'inspect', environmentId })).workspace as ManagedWorkspace;
        await workspace({ action: 'finalize', environmentId, preparationId: diagnostic.preparationId, roundId: diagnostic.id, attemptId: randomUUID(), partial: false, unchangedHead: base });
        const item: any = { flavor, agentId: snapshot.id, domainTaskId: currentDomain.task.id, preparationId: diagnostic.id, environmentId, cwd: state.cwd, checkout: state.checkout, cwdLength: state.cwd.length, rounds: [], rejections: [] }; evidence.cases.push(item);
        let sessionId = '', nativeId = '';
        for (let round = 0; round < 2; round++) {
            const inputMarker = `INPUT_${randomUUID()}`, inputFile = join(root, `附件 ${flavor}-${round}.txt`); writeFileSync(inputFile, inputMarker);
            const object = await artifacts.upload(inputFile, randomUUID()), operationId = randomUUID(); await artifacts.pin(object.id, `probe:${environmentId}:${round}`, 'input');
            await post('artifacts', { action: 'materialize', operationId, files: [{ artifactId: object.id, name: object.filename, size: object.size, sha256: object.sha256 }] });
            const materialized = await until(async () => (await post('artifacts', { action: 'inspect', operationId })).operation, value => !['accepted', 'running'].includes(value.status), 'input materialization'); assert.equal(materialized.status, 'succeeded', JSON.stringify(materialized.error));
            if (round) nextDomainRound();
            const preparationId = randomUUID(), roundId = currentDomain.round.id, reference = { environmentId, preparationId };
            state = await workspace({ action: 'prepare', environmentId, preparationId, roundId, source: state.source, expectedHead: base,
                inputs: materialized.files.map(({ name, path, sha256, size }: any) => ({ name, path, sha256, size })) });
            await post('artifacts', { action: 'release', operationId });
            const input = state.preparations[preparationId]!.inputs[0]!, request = { directory: state.cwd, agent: flavor, startingMode: 'remote' as const, permissionMode: 'default' as const, preparedWorkspace: reference, disabledMcpServers: ['runweft'] };
            assert.equal(readFileSync(input.path, 'utf8'), inputMarker); assert.equal(git(state.cwd, 'rev-parse', 'HEAD'), base);
            if (round === 0) {
                const count = (await hapi.request('/api/sessions')).sessions.length;
                const reject = async (label: string, directory = state.cwd) => {
                    const result = await execution!.start(target, { ...request, directory, requestId: randomUUID() });
                    assert(result.outcome === 'recorded'); assert(result.receipt.response?.type === 'error' && result.receipt.response.childStarted === false, JSON.stringify(result));
                    assert.equal((await hapi!.request('/api/sessions')).sessions.length, count); item.rejections.push(label);
                };
                await reject('wrong cwd', state.checkout);
                const moved = state.cwd + '-moved'; renameSync(state.cwd, moved); await reject('missing cwd'); assert(!existsSync(state.cwd)); renameSync(moved, state.cwd);
                git(state.checkout, 'update-ref', `refs/heads/${state.branch}`, git(state.checkout, 'rev-parse', `${base}~1`)); await reject('HEAD'); git(state.checkout, 'update-ref', `refs/heads/${state.branch}`, base);
                writeFileSync(input.path, 'tampered'); await reject('input'); writeFileSync(input.path, inputMarker);
                const module = join(state.checkout, 'vendor/module'), moduleHead = git(module, 'rev-parse', 'HEAD'); git(module, 'update-ref', 'HEAD', git(module, 'rev-parse', 'HEAD~1')); await reject('gitlink'); git(module, 'update-ref', 'HEAD', moduleHead);
                writeFileSync(join(state.checkout, 'asset.bin'), git(state.checkout, 'show', 'HEAD:asset.bin') + '\n'); await reject('LFS pointer'); writeFileSync(join(state.checkout, 'asset.bin'), bytes);
                note(`${flavor}: six invalid prepared states rejected with childStarted=false and no new session`);
                const start: Awaited<ReturnType<ExecutionClient['start']>> = await execution.start(target, { ...request, requestId: randomUUID() }); assert(start.outcome === 'recorded' && start.receipt.response?.type === 'success', JSON.stringify(start)); sessionId = start.receipt.sessionId;
            } else { const resumed = await execution.resume(sessionId, reference); assert(resumed.outcome === 'resumed', JSON.stringify(resumed)); assert.equal(resumed.nativeSessionId, nativeId); sessionId = resumed.session.id; }
            const ready = await execution.waitUntilReady(sessionId); assert.deepEqual(ready.metadata?.preparedWorkspace, reference); assert.deepEqual(ready.metadata?.disabledMcpServers, ['runweft']);
            const pid = ready.metadata?.hostPid; assert(pid); pids.add(pid);
            await assert.rejects(() => post('workspaces', { action: 'remove', environmentId, attemptId: randomUUID(), expectedHead: base }), { code: 'workspace_execution_active' });
            if (flavor === 'codex') { const catalog = await until(() => codexCatalog(join(targetRunner.credentialFile, '..', 'hapi'), sessionId, ready.metadata!.codexSessionId!, pid), rows => rows.some(row => row.name === 'keep_probe' && row.tools.includes('probe_report')), 'Codex tool discovery'); assert(!catalog.some(row => row.name === 'runweft' && row.tools.length)); }
            const localId = randomUUID(), since = Date.now();
            await execution.send(sessionId, { localId, text: `只读 remote-probe 验收。${round === 0 ? `记住并报告 ${memory}，不要写入文件。` : '复述上一轮 MEMORY_ 开头的完整标记，不从文件读取它。'}使用工程 remote-probe skill，读取 ${JSON.stringify(input.path)} 并报告全文；用只读 shell 命令报告 pwd、当前 HEAD、../asset.bin 的 SHA-256，并读取 ../vendor/module/note。调用一次 keep_probe 的 probe_report。最终报告包含以上结果和工程/skill 标记；不修改任何文件、不提交、不委派。只读取工程和本轮附件；不要检查任何 memory 目录或工程外的模型配置目录，不运行 ls，不使用输出重定向。记忆标记仅从当前原生会话回忆。` });
            const approved = new Set<string>();
            const done = await until(async () => {
                const value = await execution!.query(sessionId, localId);
                for (const [id, permission] of Object.entries(value.permissions)) if (!approved.has(id)) {
                    const args = JSON.stringify(permission.arguments), command = typeof (permission.arguments as any)?.command === 'string' ? (permission.arguments as any).command : '';
                    const read = ['Read', 'Glob', 'Grep', 'Skill', 'mcp__keep_probe__probe_report', 'keep_probe'].includes(permission.tool)
                        || /^(?:pwd|git\s|cat\s|sha256sum\s|shasum\s)/.test(command) && !/\b(?:rm|mv|cp|touch|tee|install|commit|reset|checkout|push|curl|wget)\b|[>|]/.test(command);
                    assert(read, `Unexpected fixture permission: ${permission.tool} ${args}`); approved.add(id); await execution!.respondPermission(sessionId, id, 'approved');
                }
                return value;
            }, value => value.facts.some(fact => ['completed', 'failed', 'interrupted'].includes(fact.observation.phase)) && !value.session.thinking, `${flavor} round ${round + 1}`, 300_000);
            assert(done.facts.some(fact => fact.observation.phase === 'completed'), JSON.stringify(done.facts));
            const report = done.output.map(value => value.text).join('\n');
            for (const marker of [inputMarker, context, skill, memory, expectedHash, base, state.cwd, 'module baseline']) assert(report.includes(marker), `${flavor} round ${round + 1} missing ${marker}`);
            assert(lines(probeLog).some(event => event.event === 'call' && event.cwd === state.cwd && event.at >= since));
            const actualNative = flavor === 'codex' ? done.session.metadata?.codexSessionId : done.session.metadata?.claudeSessionId; assert(actualNative); if (round === 0) nativeId = actualNative; else assert.equal(actualNative, nativeId);
            if (flavor === 'claude') { const snapshots = lines(claudeLog).filter(event => event.nativeSessionId === nativeId && event.at >= since); assert(snapshots.length); assert(snapshots.every(event => !event.tools.some((tool: string) => tool.startsWith('mcp__runweft__')))); assert(snapshots.some(event => event.tools.includes('Agent') || event.tools.includes('Task'))); }
            assert.equal((await execution.stop(sessionId)).outcome, 'stopped'); await until(async () => alive(pid), value => !value, 'native wrapper stop', 15_000);
            state = await workspace({ action: 'finalize', environmentId, preparationId, roundId, attemptId: randomUUID(), sessionId, partial: false, unchangedHead: base });
            assert.equal(state.results[roundId]!.resultHead, base); assert.equal(git(state.cwd, 'status', '--porcelain'), '');
            nextDomainRound();
            await assert.rejects(() => execution!.resume(sessionId), { code: 'workspace_not_prepared' });
            item.rounds.push({ roundId, sessionId, nativeId, hostPid: pid, cwd: state.cwd, cwdLength: state.cwd.length, inputArtifact: object.id, inputSha256: object.sha256, approved: approved.size, resultHead: state.results[roundId]!.resultHead });
            note(`${flavor} round ${round + 1}: actual cwd/instructions/skill/input/gitlink/LFS read; Runweft filtered, other MCP called; native process stopped and unchanged result sealed`);
        }
    }
    await fileFixture!.stopRunner(targetRunner);
    const db = new Database(fileFixture!.statePath, { readonly: true });
    try { for (const { data } of db.query('SELECT data FROM repository_snapshots').all() as { data: string }[]) { const snapshot = JSON.parse(data); for (const file of snapshot.files) { const downloaded = await artifacts.download(file.artifactId, join(root, 'recovered', file.name)); assert.equal(digest(downloaded.path), file.sha256); } } } finally { db.close(); }
    note('source and target Runners are both stopped; center Git/LFS recovery objects remain downloadable and match their hashes');
    }
    models.verify();
    evidence.success = true;
} catch (error) { evidence.error = error instanceof Error ? error.stack ?? error.message : String(error); process.exitCode = 1; }
finally {
    let stopped = !factoryAttempted || !!fileFixture || !!userFixture;
    const cleanup: Array<() => Promise<void>> = [];
    if (factoryAttempted && !fileFixture && !userFixture) cleanup.push(async () => { throw new Error('Factory did not return; infrastructure shutdown unconfirmed, model copies retained'); });
    if (hapi) cleanup.push(async () => {
        const errors: unknown[] = [];
        try {
            const control = new ExecutionClient(hapi);
            for (const session of (await hapi.request('/api/sessions')).sessions) {
                if (session.metadata?.hostPid) pids.add(session.metadata.hostPid);
                if (session.active) try { if ((await control.stop(session.id)).outcome !== 'stopped') throw new Error(`Unconfirmed stop: ${session.id}`); }
                catch (error) { stopped = false; errors.push(error); }
            }
        } catch (error) { stopped = false; errors.push(error); }
        if (errors.length) throw new AggregateError(errors, 'Native sessions did not all stop');
    });
    cleanup.push(async () => { try { if (fileFixture) await fileFixture.close(false); if (userFixture) await userFixture.close(false, retentionHandoff && evidence.success); } catch (error) { stopped = false; throw error; } });
    cleanup.push(async () => { try { await models?.waitHosts(pids); evidence.hostPidsExited = [...pids]; } catch (error) { stopped = false; throw error; } });
    cleanup.push(async () => { models?.verify(); evidence.sourceConfigurationsVerified = true; });
    cleanup.push(async () => { if (stopped) { await closeSmoke([...(models ? [() => models!.remove()] : []), ...[...modelConfigurationBackups].map(path => () => rmSync(path, { recursive: true, force: true }))]); evidence.modelAuthCopiesRemoved = true; } });
    try { await closeSmoke(cleanup.reverse()); } catch (error) { evidence.cleanupErrors.push(...(error instanceof AggregateError ? error.errors.map(String) : [String(error)])); }
    if (evidence.success && !retentionHandoff && !evidence.cleanupErrors.length) try { rmSync(ownedTempRoot, { recursive: true, force: true }); } catch (error) { evidence.cleanupErrors.push(String(error)); }
    if ((!evidence.success || evidence.cleanupErrors.length) && userFixture && stopped) {
        const connectionSecrets = new Set([userFixture.identityFile, join(userFixture.server, 'server/hapi/settings.json'), join(userFixture.server, 'server/hapi/jwt-secret.json')]);
        for (const home of [sourceHome, targetHome]) { const paths = hubConnectionPaths(home, userFixture.url); connectionSecrets.add(paths.identityConnection); connectionSecrets.add(paths.machineConnection); connectionSecrets.add(join(paths.connection, 'hapi/settings.json')); }
        try { await closeSmoke([...connectionSecrets].map(path => () => rmSync(path, { force: true }))); evidence.failedHandoffSecretsRemoved = true; }
        catch (error) { evidence.cleanupErrors.push(String(error)); }
    }
    if (evidence.cleanupErrors.length) { evidence.success = false; process.exitCode = 1; }
    evidence.finishedAt = new Date().toISOString(); writeFileSync(join(evidenceDir, 'evidence.json'), JSON.stringify(evidence, null, 2)); console.log(`Evidence: ${join(evidenceDir, 'evidence.json')}`); if (evidence.error) console.error(evidence.error);
}
