import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { freePort } from '../src/services';
import { HapiClient } from '../src/hapi';
import { codexMcpDefinition, replaceCodexMcp } from '../src/mcp/toml';
import { codexCatalog } from './fixtures/codex-catalog';
import pkg from '../package.json';
import { configureSmokeCodexModel } from './fixtures/codex-model';

type Flavor = 'codex' | 'claude';
const executable = resolve(process.argv[2] ?? 'dist/runweft');
const selected = process.env.RUNWEFT_SMOKE_CASE;
const cases = (['local', 'hub'] as const).flatMap(mode => (['codex', 'claude'] as const).flatMap(host => (['codex', 'claude'] as const).map(flavor => ({ mode, host, flavor, id: `${mode}-${host}-${flavor}` }))));
assert(!selected || cases.some(item => item.id === selected), 'RUNWEFT_SMOKE_CASE must name a mode-host-runtime combination');
mkdirSync('.dev-smoke', { recursive: true });
const root = mkdtempSync(resolve('.dev-smoke/artifact-mcp-'));
const local = join(root, 'local'), hub = join(root, 'hub'), codexHome = join(root, 'codex'), claudeHome = join(root, 'claude');
const probeLog = join(root, 'probe.jsonl'), claudeLog = join(root, 'claude-init.jsonl');
const env: NodeJS.ProcessEnv = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_')) delete env[key];
delete env.HAPI_CODEX_APP_SERVER_BIN; delete env.HAPI_SESSION_ID;
const nativeClaude = process.env.RUNWEFT_SMOKE_CLAUDE || Bun.which('iclaude') || Bun.which('claude');
assert(nativeClaude && Bun.which('codex'), 'Both native clients and existing model authentication are required');
function copy(source: string, target: string) { if (existsSync(source)) { mkdirSync(dirname(target), { recursive: true, mode: 0o700 }); copyFileSync(source, target); chmodSync(target, 0o600); } }
for (const file of ['config.toml', 'auth.json']) copy(join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), file), join(codexHome, file));
const codexModel = configureSmokeCodexModel(join(codexHome, 'config.toml'));
const sourceClaude = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
copy(process.env.CLAUDE_CONFIG_DIR ? join(sourceClaude, '.claude.json') : join(homedir(), '.claude.json'), join(claudeHome, '.claude.json'));
for (const file of ['settings.json', '.credentials.json']) copy(join(sourceClaude, file), join(claudeHome, file));
function quote(value: string) { return `'${value.replaceAll("'", "'\\''")}'`; }
const wrapper = join(root, 'claude-observer');
writeFileSync(wrapper, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(resolve('scripts/fixtures/claude-observer.mjs'))} "$@"\n`, { mode: 0o700 });
Object.assign(env, { CODEX_HOME: codexHome, CLAUDE_CONFIG_DIR: claudeHome, GIT_CEILING_DIRECTORIES: root,
    HAPI_CLAUDE_PATH: wrapper, RUNWEFT_SMOKE_CLAUDE: nativeClaude, RUNWEFT_SMOKE_CLAUDE_LOG: claudeLog });
function nativeConfig(args: string[]) { assert.equal(spawnSync('codex', ['mcp', ...args], { env, stdio: 'pipe' }).status, 0); }
const codexPath = join(codexHome, 'config.toml'), claudePath = join(claudeHome, '.claude.json');
for (const name of Object.keys((Bun.TOML.parse(readFileSync(codexPath, 'utf8')) as any).mcp_servers ?? {})) nativeConfig(['remove', name]);
const probe = { command: process.execPath, args: [resolve('scripts/fixtures/mcp-probe.mjs')], env: { RUNWEFT_SMOKE_PROBE_LOG: probeLog } };
nativeConfig(['add', 'keep_probe', '--env', `RUNWEFT_SMOKE_PROBE_LOG=${probeLog}`, '--', probe.command, ...probe.args]);
const prefs = existsSync(claudePath) ? JSON.parse(readFileSync(claudePath, 'utf8')) : {};
prefs.mcpServers = { keep_probe: { type: 'stdio', ...probe } }; writeFileSync(claudePath, JSON.stringify(prefs), { mode: 0o600 });
const evidence: { [key: string]: any; cases: any[]; cleanupErrors: string[] } = {
    root, executable, hapiRevision: pkg.hapi.revision, codexModel, selected, startedAt: new Date().toISOString(), success: false, cases: [], cleanupErrors: [],
};
let token: string | undefined, hapi: HapiClient | undefined;
const homes: string[] = [], pids = new Set<number>();
const lines = (path: string): any[] => existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
function alive(pid: number) { try { process.kill(pid, 0); return true; } catch { return false; } }
function cli(home: string, args: string[], cwd = root, input?: string) {
    const result = spawnSync(executable, ['--home', home, '--json', ...args], { cwd, env, input, encoding: 'utf8', timeout: 65_000 });
    if (token) assert(!`${result.stdout}${result.stderr}`.includes(token), 'Credential leaked into CLI output');
    assert.equal(result.status, 0, `${args[0]}: ${result.stderr || result.error || result.signal}`);
    return JSON.parse(result.stdout);
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
    cli(home, ['mcp', 'install', '--client', 'all']);
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
    instrument(home);
    const requestIds = [crypto.randomUUID(), crypto.randomUUID()];
    const messages = [0, 1].map(round => `专用文件验收第 ${round + 1} 轮。读取本轮输入附件 输入.txt，将完整内容写入当前工作目录的 成果.txt，只写内容本身，不加换行。${round === 0 ? '再把相同内容写入 extra.txt；不要生成 遗漏.txt。' : '覆盖 成果.txt，不改其他文件。'}调用一次 keep_probe 的 probe_report，验证其他 MCP 保留。不要调用 Runweft 或内置子代理，不自行提交。最终报告输入内容、工程指令中的标记和 FILE_ROUND_DONE。`);
    const prompt = `你是专用 MCP 文件验收主会话。只使用 runweft MCP，不用 shell 或内置 subagent。必须实际完成下面步骤，每个 spawn/send 只调用一次，不添加额外轮次。
1. list_agent_definitions。upload_artifact(path="材料 1.txt",request_id="${requestIds[0]}")，然后 read_artifact(request_id="${requestIds[0]}") 确认 available。
2. spawn_agent(agent_type="${flavor}",workspace_mode="${worktree ? 'worktree' : 'shared'}",inputs=[{artifactId:上步 artifact.id,name:"输入.txt"}],outputs=[{name:"成果.txt",relativePath:"成果.txt"},{name:"遗漏.txt",relativePath:"遗漏.txt"}],message=${JSON.stringify(messages[0])})。
3. wait(timeout_ms=30000) 到 completed，再 read_agent。测试控制器会批准已审阅的子任务文件操作，不要自行批准。artifacts.status=incomplete 是故意缺少 遗漏.txt 的预期结果，成功项仍可下载。
4. download_artifact(id=清单 成果.txt 项的 artifactId,path="downloads/first.txt")。read_artifact(id=该 artifactId)。
5. retry_artifacts(id=agent_id,round_id=首轮 round_id)，预期返回 artifact_no_retry_candidate，因为缺失文件没有候选；不会产生新清单。只调用这一次，不重试模型或再次 retry。
6. collect_artifacts(id=agent_id,round_id=首轮 round_id,files=[{name:"遗漏.txt",relativePath:"extra.txt"}])。read_agent/wait 直到 version=2、status=delivered、pending 为空；用 download_artifact 将这项下载到 downloads/extra.txt。
7. upload_artifact(path="材料 2.txt",request_id="${requestIds[1]}")。send_input(id=同一 agent_id,mode="next",inputs=[{artifactId:这次上传 artifact.id,name:"输入.txt"}],outputs=[{name:"成果.txt",relativePath:"成果.txt"}],message=${JSON.stringify(messages[1])})。
8. wait 到 completed，必须 read_agent；download_artifact 将第二轮 成果.txt 下载到 downloads/second.txt。再按第一轮原 artifactId 下载到 downloads/old.txt，验证旧对象仍可取回。
文件操作受理不代表结束；等待补交时用 read_agent 当前 revision 作 wait.after_revision，或继续 read_agent。全部完成回复 ARTIFACT_MCP_DONE。`;
    const item: any = { ...spec, cwd, workspaceMode: worktree ? 'worktree' : 'shared', markers, contextMarker, requestIds, baseline, calls: [], inventories: {}, approvals: [] };
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
        item.first = first; item.second = second;
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
            assert.equal(session.active, false); assert.deepEqual(session.metadata.disabledMcpServers, ['runweft']);
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
        writeFileSync(join(root, `${id}.json`), JSON.stringify(item, null, 2));
    }
}
console.log(`Evidence directory: ${root}`);
try {
    cli(local, ['init']); cli(local, ['config', 'set', 'server.port', String(await freePort())]); homes.push(local);
    const service = cli(local, ['start']);
    token = JSON.parse(readFileSync(join(local, 'server/hapi/settings.json'), 'utf8')).cliApiToken; assert(token);
    hapi = new HapiClient(service.url, token);
    for (const mode of ['local', 'hub'] as const) {
        if (selected && !selected.startsWith(mode + '-')) continue;
        const home = mode === 'local' ? local : hub;
        if (mode === 'hub') { cli(home, ['init', '--url', service.url]); cli(home, ['auth', 'login', '--token-stdin'], root, token); homes.push(home); cli(home, ['start']); }
        cli(home, ['machine', 'register']);
        for (const flavor of ['codex', 'claude']) { const runtime = cli(home, ['runtime', 'register', flavor]).runtime; cli(home, ['agent', 'init', flavor, '--runtime', runtime.id]); }
        for (const spec of cases.filter(spec => spec.mode === mode && (!selected || selected === spec.id))) await runCase(spec, home);
    }
    evidence.success = true;
} catch (error) { evidence.error = error instanceof Error ? error.stack ?? error.message : String(error); process.exitCode = 1; }
finally {
    if (hapi) try { for (const session of (await hapi.request('/api/sessions')).sessions) if (session.active) await hapi.request(`/api/sessions/${session.id}/archive`, { method: 'POST', signal: AbortSignal.timeout(45_000) }); }
    catch (error) { evidence.cleanupErrors.push(String(error)); }
    for (const home of homes.reverse()) try { cli(home, ['stop']); } catch (error) { evidence.cleanupErrors.push(String(error)); }
    await Bun.sleep(500);
    for (const pid of new Set([...pids, ...lines(probeLog).map(value => value.pid), ...lines(claudeLog).map(value => value.pid)])) if (alive(pid)) evidence.cleanupErrors.push(`Process still alive: ${pid}`);
    if (evidence.cleanupErrors.length) { evidence.success = false; process.exitCode = 1; }
    evidence.finishedAt = new Date().toISOString(); writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(`Evidence: ${join(root, 'evidence.json')}`); if (evidence.error) console.error(evidence.error);
}
