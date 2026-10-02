import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { HapiHttp } from '../src/hapi';
import { nativeUserSmoke } from './fixtures/native-user-smoke';
import { modelHomes } from './fixtures/model-homes';
import { codexMcpDefinition, replaceCodexMcp } from '../src/mcp/toml';
import { codexCatalog } from './fixtures/codex-catalog';
import pkg from '../package.json';
import { installedBinaries } from './fixtures/installed-binaries.mjs';

type Flavor = 'codex' | 'claude';
const executable = resolve(process.argv[2] ?? 'dist/runweft'), binaries = installedBinaries(executable);
const selected = process.env.RUNWEFT_SMOKE_CASE;
const cases = (['local', 'hub'] as const).flatMap(mode => (['codex', 'claude'] as const).flatMap(host => (['codex', 'claude'] as const).map(flavor => ({ mode, host, flavor, id: `${mode}-${host}-${flavor}` }))));
assert(!selected || cases.some(item => item.id === selected), 'RUNWEFT_SMOKE_CASE must name a mode-host-runtime combination');
mkdirSync('.dev-smoke', { recursive: true });
const root = mkdtempSync(resolve('.dev-smoke/artifact-mcp-'));
const local = join(root, 'client'), hub = join(root, 'hub');
const probeLog = join(root, 'probe.jsonl'), claudeLog = join(root, 'claude-init.jsonl');
const env: NodeJS.ProcessEnv = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_') || key.startsWith('HAPI_') || ['CLI_API_TOKEN', 'DB_PATH', 'TELEGRAM_BOT_TOKEN'].includes(key)) delete env[key];
let fixture: Awaited<ReturnType<typeof nativeUserSmoke>> | undefined;
let models: ReturnType<typeof modelHomes> | undefined;
let nativeClaude: string | undefined, codexPath: string, claudePath: string;
function quote(value: string) { return `'${value.replaceAll("'", "'\\''")}'`; }
const wrapper = join(root, 'claude-observer');
function nativeConfig(args: string[]) { assert.equal(spawnSync('codex', ['mcp', ...args], { env, stdio: 'pipe' }).status, 0); }
const evidence: { [key: string]: any; cases: any[]; cleanupErrors: string[] } = {
    kind: 'artifact-mcp-current', root, executable, candidate: { binaries, hapiRevision: pkg.hapi.revision, entry: 'compiled CLI + compiled serve + actual HAPI/Runner' }, selected, startedAt: new Date().toISOString(), success: false, cases: [], cleanupErrors: [],
};
let hapi: HapiHttp | undefined, constructorCleanupUncertain = false;
const runners = new Map<string, Awaited<ReturnType<Awaited<ReturnType<typeof nativeUserSmoke>>['runner']>>>();
const homes: string[] = [], pids = new Set<number>();
const lines = (path: string): any[] => existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
function alive(pid: number) { try { process.kill(pid, 0); return true; } catch { return false; } }
function cli(home: string, args: string[], cwd = root, input?: string) {
    assert(fixture); return fixture.cli(home, args, { cwd, timeout: 65_000 });
}
function values(value: any): any[] {
    if (typeof value === 'string') { try { return values(JSON.parse(value)); } catch { return []; } }
    if (!value || typeof value !== 'object') return [];
    if (value.accepted === true || value.agent_id || value.agents || value.artifact || value.error) return [value];
    return Object.values(value).flatMap(values);
}
// Only private test registrations gain this environment override.
// Native Codex otherwise drops GIT_CEILING_DIRECTORIES from MCP's inherited env.
function instrument(home: string) {
    const installed = cli(home, ['mcp', 'install', '--client', 'all']);
    if (installed.backupPath) { assert(installed.backupPath.startsWith(join(home, 'backups', 'mcp') + '/')); models!.copies.push(installed.backupPath); }
    assert(cli(home, ['mcp', 'check', '--client', 'all']).ok);
    const before = readFileSync(codexPath, 'utf8'), config = Bun.TOML.parse(before) as any;
    const entry = config.mcp_servers.runweft;
    writeFileSync(codexPath, replaceCodexMcp(before, codexMcpDefinition({ ...entry, env: { ...entry.env, GIT_CEILING_DIRECTORIES: root } }), true));
}

async function runCase(spec: typeof cases[number], home: string) {
    const { id, mode, host, flavor } = spec, worktree = mode === 'hub' && host !== flavor;
    const cwd = join(root, id); mkdirSync(cwd);
    const contextMarker = `PROJECT_${crypto.randomUUID()}`, markers = [crypto.randomUUID(), crypto.randomUUID()];
    for (const name of ['AGENTS.md', 'CLAUDE.md']) writeFileSync(join(cwd, name), `专用文件验收工程。最终报告附工程标记 ${contextMarker}。只处理明确要求的文件，不安装依赖、不委派。\n`);
    for (let round = 0; round < 2; round++) writeFileSync(join(cwd, `材料 ${round + 1}.txt`), markers[round]);
    writeFileSync(join(cwd, '.gitignore'), '材料*.txt\ndownloads/\n');
    const git = (...args: string[]) => {
        const result = spawnSync('git', ['-C', cwd, ...args], { env, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
    };
    git('init', '-q'); git('config', 'user.name', 'MCP File Test'); git('config', 'user.email', 'file-test@example.invalid'); git('config', 'commit.gpgsign', 'false');
    git('add', '.'); git('commit', '-qm', 'fixture'); const baseline = git('rev-parse', 'HEAD');
    const runner = runners.get(home)!;
    const repository = cli(home, ['repository', 'create', 'Artifact MCP fixture', '--request-id', crypto.randomUUID()], cwd).repository;
    cli(home, ['repository', 'bind', repository.id, '--machine', runner.machineId], cwd);
    const definition = join(root, `${id}-agent.json`); writeFileSync(definition, JSON.stringify({ name: id, repositoryId: repository.id, runtimeId: runner.runtimes[flavor].id }));
    const agent = cli(home, ['agent', 'create', '--request-id', crypto.randomUUID(), '--file', definition], cwd).agent;
    instrument(home);
    const requestIds = [crypto.randomUUID(), crypto.randomUUID()];
    const messages = [0, 1].map(round => `专用文件验收第 ${round + 1} 轮。读取本轮输入附件 输入.txt，将完整内容写入当前工作目录的 成果.txt，只写内容本身，不加换行。${round === 0 ? '再把相同内容写入 extra.txt；不要生成 遗漏.txt。' : '覆盖 成果.txt，不改其他文件。'}调用一次 keep_probe 的 probe_report，验证其他 MCP 保留。不要调用 Runweft 或内置子代理，不自行提交。最终报告输入内容、工程指令中的标记和 FILE_ROUND_DONE。`);
    const prompt = `你是专用 MCP 文件验收主会话。只使用 runweft MCP，不用 shell 或内置 subagent。必须实际完成下面步骤，每个 spawn/send 只调用一次，不添加额外轮次。
1. list_agent_definitions。upload_artifact(path="材料 1.txt",request_id="${requestIds[0]}")，然后 read_artifact(request_id="${requestIds[0]}") 确认 available。
2. spawn_agent(agent_type="${agent.id}",workspace_mode="${worktree ? 'worktree' : 'shared'}",inputs=[{artifactId:上步 artifact.id,name:"输入.txt"}],outputs=[{name:"成果.txt",relativePath:"成果.txt"},{name:"遗漏.txt",relativePath:"遗漏.txt"}],message=${JSON.stringify(messages[0])})。
3. wait(timeout_ms=30000) 到 completed，再 read_agent。测试控制器会批准已审阅的子任务文件操作，不要自行批准。artifacts.status=incomplete 是故意缺少 遗漏.txt 的预期结果，成功项仍可下载。
4. download_artifact(id=清单 成果.txt 项的 artifactId,path="downloads/first.txt")。read_artifact(id=该 artifactId)。
5. retry_artifacts(id=agent_id,round_id=首轮 round_id)，预期返回 artifact_no_retry_candidate，因为缺失文件没有候选；不会产生新清单。只调用这一次，不重试模型或再次 retry。
6. collect_artifacts(id=agent_id,round_id=首轮 round_id,files=[{name:"遗漏.txt",relativePath:"extra.txt"}])。read_agent/wait 直到 version=2、status=delivered、pending 为空；用 download_artifact 将这项下载到 downloads/extra.txt。
7. upload_artifact(path="材料 2.txt",request_id="${requestIds[1]}")。send_input(id=同一 agent_id,mode="next",inputs=[{artifactId:这次上传 artifact.id,name:"输入.txt"}],outputs=[{name:"成果.txt",relativePath:"成果.txt"}],message=${JSON.stringify(messages[1])})。
8. wait 到 completed，必须 read_agent；download_artifact 将第二轮 成果.txt 下载到 downloads/second.txt。再按第一轮原 artifactId 下载到 downloads/old.txt，验证旧对象仍可取回。
文件操作受理不代表结束；等待补交时用 read_agent 当前 revision 作 wait.after_revision，或继续 read_agent。全部完成回复 ARTIFACT_MCP_DONE。`;
    const item: any = { ...spec, cwd, workspaceMode: worktree ? 'worktree' : 'shared', markers, contextMarker, requestIds, baseline, clientHome: home, machineId: runner.machineId, repositoryId: repository.id, agentId: agent.id, calls: [], inventories: {}, approvals: [] };
    evidence.cases.push(item);
    const calls = new Map<string, any>();
    const args = host === 'codex' ? ['exec', '--json', '--skip-git-repo-check', prompt]
        : ['-p', '--output-format', 'stream-json', '--verbose', '--tools', '', '--allowedTools', 'mcp__runweft__*', '--max-turns', '60', prompt];
    const child = spawn(host === 'codex' ? 'codex' : nativeClaude!, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    assert(child.pid); pids.add(child.pid);
    let buffer = '', done = false, code: number | null = null, failure: Error | undefined;
    child.stderr.on('data', () => {});
    child.stdout.on('data', chunk => {
        buffer += chunk;
        let end;
        while ((end = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
            let event: any; try { event = JSON.parse(line); } catch { continue; }
            if (event.type === 'thread.started') item.nativeId = event.thread_id;
            if (event.type === 'system' && event.subtype === 'init') item.nativeId = event.session_id;
            if (event.type === 'result') item.hostResult = { subtype: event.subtype, isError: event.is_error, result: event.result };
            if (event.item?.type === 'agent_message') item.hostResult = event.item.text;
            if (event.item?.type === 'mcp_tool_call' && event.item.server === 'runweft') {
                const tool = event.item, call = calls.get(tool.id) ?? { name: tool.tool, args: tool.arguments, startedAt: Date.now() };
                if (event.type === 'item.completed') Object.assign(call, { finishedAt: Date.now(), results: values(tool.result), error: tool.error });
                calls.set(tool.id, call);
            }
            for (const block of event.message?.content ?? []) {
                if (block.type === 'tool_use' && block.name.startsWith('mcp__runweft__')) calls.set(block.id, { name: block.name.slice('mcp__runweft__'.length), args: block.input, startedAt: Date.now() });
                if (block.type === 'tool_result' && calls.has(block.tool_use_id)) Object.assign(calls.get(block.tool_use_id), { finishedAt: Date.now(), results: values(block.content), isError: block.is_error });
            }
        }
    });
    const exited = new Promise<void>(resolve => {
        child.once('error', error => { failure = error; done = true; resolve(); });
        child.once('exit', status => { code = status; done = true; resolve(); });
    });
    const soft = setTimeout(() => child.kill('SIGTERM'), 600_000), hard = setTimeout(() => child.kill('SIGKILL'), 610_000);
    const paths = cli(home, ['paths']), approvals = new Set<string>();
    async function observe() {
        const listed = cli(home, ['task', 'list'], cwd).agents;
        assert(listed.length <= 1, 'Host spawned an unexpected extra child');
        if (!listed.length) return;
        const current = cli(home, ['task', 'show', listed[0].agent_id], cwd);
        if (current.host_pid) pids.add(current.host_pid);
        assert(!['failed', 'unknown'].includes(current.status), JSON.stringify(current.attention));
        if (flavor === 'codex' && current.phase === 'running' && current.native_session_id && !item.inventories[current.round_id]) {
            try {
                const inventory = await codexCatalog(paths.hapiClient, current.session_id, current.native_session_id, current.host_pid);
                if (inventory.some(server => server.name === 'keep_probe' && server.tools.includes('probe_report'))) {
                    assert(!inventory.some(server => server.name === 'runweft' && server.tools.length)); item.inventories[current.round_id] = inventory;
                }
            } catch (error) { item.inventoryLastError = String(error); }
        }
        for (const [requestId, request] of Object.entries(current.permissions ?? {}) as [string, any][]) {
            if (approvals.has(requestId)) continue;
            const text = JSON.stringify(request.arguments);
            assert(/成果.txt|extra.txt|输入.txt|AGENTS.md|CLAUDE.md/.test(text) || request.tool.includes('keep_probe'), `Unreviewed fixture approval: ${request.tool}`);
            cli(home, ['task', 'permission', current.agent_id, '--round', current.round_id, '--request', requestId, '--decision', 'approved'], cwd);
            approvals.add(requestId); item.approvals.push({ requestId, tool: request.tool });
        }
    }
    try {
        while (!done) { await Promise.race([exited, Bun.sleep(500)]); await observe(); }
        if (failure) throw failure; assert.equal(code, 0, `${id}: host failed`);
        item.calls = [...calls.values()];
        const named = (name: string) => item.calls.filter((call: any) => call.name === name);
        assert.equal(named('spawn_agent').length, 1); assert.equal(named('send_input').length, 1);
        const firstAccepted = named('spawn_agent')[0].results.find((value: any) => value.accepted);
        const secondAccepted = named('send_input')[0].results.find((value: any) => value.accepted); assert(firstAccepted && secondAccepted);
        const first = cli(home, ['task', 'show', firstAccepted.agent_id, '--round', firstAccepted.round_id], cwd);
        const second = cli(home, ['task', 'show', firstAccepted.agent_id, '--round', secondAccepted.round_id], cwd);
        assert(named('read_agent').flatMap((call: any) => call.results ?? []).some((value: any) => value.round_id === first.round_id && value.status === 'completed' && value.artifacts?.status === 'incomplete' && value.artifacts?.manifest?.version === 1), 'Missing actual completed incomplete first manifest before collection');
        item.rounds = [{ roundId: first.round_id, view: first }, { roundId: second.round_id, view: second }];
        assert.equal(first.parent.nativeSessionId, item.nativeId); assert.equal(first.parent.host, host);
        assert.equal(second.native_session_id, first.native_session_id); assert.equal(second.resume.outcome, 'resumed');
        assert.equal(first.artifacts.manifest.version, 2); assert.equal(first.artifacts.status, 'delivered');
        assert.equal(second.artifacts.manifest.version, 1); assert.equal(second.artifacts.status, 'delivered');
        assert.equal(named('retry_artifacts').length, 1); assert(named('retry_artifacts')[0].results.some((value: any) => value.error?.code === 'artifact_no_retry_candidate')); assert.equal(named('collect_artifacts').length, 1);
        assert.equal(named('upload_artifact').length, 2); assert(named('read_artifact').length >= 2);
        assert.equal(named('download_artifact').length, 4);
        for (const [file, marker] of [['first', markers[0]], ['extra', markers[0]], ['second', markers[1]], ['old', markers[0]]]) assert.equal(readFileSync(join(cwd, `downloads/${file}.txt`), 'utf8'), marker);
        for (const [round, detail] of [first, second].entries()) {
            assert.equal(detail.status, 'completed'); assert.equal(detail.stop, 'stopped'); assert.equal(detail.finish, 'complete');
            assert.equal(detail.inputs.length, 1); assert.equal(detail.inputs[0].observation.phase, 'completed');
            assert(detail.report.text.includes(markers[round])); assert(detail.report.text.includes(contextMarker));
            assert.equal(detail.input_files.download_retention, 'released');
            assert(!alive(detail.host_pid));
            const session = (await hapi!.request(`/api/sessions/${detail.session_id}`)).session;
            assert.equal(session.active, false); assert.equal(session.metadata.lifecycleState, 'archived'); assert.deepEqual(session.metadata.disabledMcpServers, ['runweft']);
            const reads = named('read_agent').flatMap((call: any) => call.results ?? []);
            assert(reads.some((value: any) => value.round_id === detail.round_id && value.status === 'completed'));
            if (worktree) assert.equal(detail.git.status, 'sealed');
            if (flavor === 'codex') assert(item.inventories[detail.round_id], 'Missing actual Codex tool inventory');
        }
        if (flavor === 'claude') {
            const snapshots = lines(claudeLog).filter(value => value.cwd === first.cwd && value.hapiSessionId === first.session_id);
            assert(snapshots.length >= 2); assert(snapshots.every(value => !value.tools.some((name: string) => name.startsWith('mcp__runweft__'))));
            assert(snapshots.every(value => value.tools.includes('mcp__keep_probe__probe_report')));
            assert(snapshots.some(value => value.tools.includes('Agent') || value.tools.includes('Task'))); item.inventories = snapshots;
        }
        assert(lines(probeLog).filter(value => value.event === 'call' && value.cwd === first.cwd).length >= 2);
        if (worktree) { assert.equal(git('rev-parse', 'HEAD'), baseline); assert.equal(git('status', '--porcelain'), ''); assert.equal(second.cwd, first.cwd); }
        item.success = true;
        console.log(`PASS ${id}/${item.workspaceMode}: real MCP upload/input/output/retry/collect/download, two native rounds, original bytes and child tool boundary`);
    } finally {
        item.calls = [...calls.values()]; clearTimeout(soft);
        if (!done) { child.kill('SIGTERM'); await exited; } clearTimeout(hard);

    }
}
console.log(`Evidence directory: ${root}`);
try {
    models = modelHomes(root, env);
    fixture = await nativeUserSmoke(root, executable, env);
    nativeClaude = models.nativeClaude ?? undefined; assert(nativeClaude && Bun.which('codex'));
    Object.assign(evidence, { serverHome: fixture.server, url: fixture.url, ownerId: fixture.user.identity.id, spaceId: fixture.space, codexModel: models.codexModel, nativeHomes: { codex: env.CODEX_HOME, claude: env.CLAUDE_CONFIG_DIR }, cleanupOwner: 'artifact-package' });
writeFileSync(wrapper, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(resolve('scripts/fixtures/claude-observer.mjs'))} "$@"\n`, { mode: 0o700 });
Object.assign(env, { GIT_CEILING_DIRECTORIES: root,
    HAPI_CLAUDE_PATH: wrapper, RUNWEFT_SMOKE_CLAUDE: nativeClaude, RUNWEFT_SMOKE_CLAUDE_LOG: claudeLog });
codexPath = join(env.CODEX_HOME!, 'config.toml'); claudePath = join(env.CLAUDE_CONFIG_DIR!, '.claude.json');
for (const name of Object.keys((Bun.TOML.parse(readFileSync(codexPath, 'utf8')) as any).mcp_servers ?? {})) nativeConfig(['remove', name]);
const probe = { command: process.execPath, args: [resolve('scripts/fixtures/mcp-probe.mjs')], env: { RUNWEFT_SMOKE_PROBE_LOG: probeLog } };
nativeConfig(['add', 'keep_probe', '--env', `RUNWEFT_SMOKE_PROBE_LOG=${probeLog}`, '--', probe.command, ...probe.args]);
const prefs = existsSync(claudePath) ? JSON.parse(readFileSync(claudePath, 'utf8')) : {};
prefs.mcpServers = { keep_probe: { type: 'stdio', ...probe } }; writeFileSync(claudePath, JSON.stringify(prefs), { mode: 0o600 });
    const primary = await fixture.runner(local); runners.set(local, primary); homes.push(local); hapi = primary.http;
    for (const mode of ['local', 'hub'] as const) {
        if (selected && !selected.startsWith(mode + '-')) continue;
        const home = mode === 'local' ? local : hub;
        if (mode === 'hub') { runners.set(home, await fixture.runner(home)); homes.push(home); }
        for (const spec of cases.filter(spec => spec.mode === mode && (!selected || selected === spec.id))) await runCase(spec, home);
    }
    evidence.success = true;
} catch (error) { constructorCleanupUncertain = !fixture && error instanceof AggregateError; evidence.error = error instanceof Error ? error.message : String(error); process.exitCode = 1; }
finally {
    const attempt = async (action: () => void | Promise<void>) => { try { await action(); } catch (error) { evidence.cleanupErrors.push(String(error)); } };
    let safe = !constructorCleanupUncertain;
    for (const log of [probeLog, claudeLog]) try { for (const value of lines(log)) if (value.pid) pids.add(value.pid); } catch (error) { safe = false; evidence.cleanupErrors.push(String(error)); }
    evidence.runners = [];
    if (fixture) {
        for (const [clientHome, runner] of runners) await attempt(() => { evidence.runners.push({ clientHome, machineId: runner.machineId, paths: cli(clientHome, ['paths']), nativeHome: runner.hapiHome }); });
        if (hapi) try {
            const sessions = (await hapi.request('/api/sessions')).sessions; evidence.sessionIds = sessions.map((session: any) => session.id).sort();
            for (const session of sessions) {
                if (session.metadata?.hostPid) pids.add(session.metadata.hostPid);
                if (session.active) try { await hapi.request(`/api/sessions/${session.id}/archive`, { method: 'POST', signal: AbortSignal.timeout(45_000) }); }
                catch (error) { safe = false; evidence.cleanupErrors.push(String(error)); }
            }
        } catch (error) { safe = false; evidence.cleanupErrors.push(String(error)); }
        try { await fixture.close(false, true); } catch (error) { safe = false; evidence.cleanupErrors.push(String(error)); }
    }
    if (models) {
        try { await models.waitHosts(pids); } catch (error) { safe = false; evidence.cleanupErrors.push(String(error)); }
        await attempt(() => models!.verify());
        if (safe) await attempt(() => models!.remove());
    }
    if (safe && (!evidence.success || evidence.cleanupErrors.length)) {
        for (const runner of evidence.runners) for (const file of [runner.paths.identityConnection, runner.paths.machineConnection, runner.paths.pendingConnection, join(runner.paths.hapiClient, 'settings.json')]) await attempt(() => rmSync(file, { force: true }));
        if (fixture) for (const file of [fixture.identityFile, join(fixture.server, 'server/hapi/settings.json'), join(fixture.server, 'server/hapi/jwt-secret.json')]) await attempt(() => rmSync(file, { force: true }));
    }
    if (evidence.cleanupErrors.length) { evidence.success = false; process.exitCode = 1; }
    evidence.hostPids = [...pids]; evidence.finishedAt = new Date().toISOString();
    writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, (key, value) => key === 'message' && typeof value === 'string' ? { omitted: true, length: value.length } : value, 2), { mode: 0o600 });
    console.log(`Evidence: ${join(root, 'evidence.json')}`); if (evidence.error) console.error(evidence.error);
}
