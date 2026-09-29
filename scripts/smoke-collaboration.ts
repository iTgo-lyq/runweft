import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { freePort } from '../src/services';
import { HapiClient } from '../src/hapi';
import { codexMcpDefinition, replaceCodexMcp } from '../src/mcp/toml';
import { codexCatalog } from './fixtures/codex-catalog';
import pkg from '../package.json';

type Flavor = 'codex' | 'claude';
const executable = resolve(process.argv[2] ?? 'dist/runweft');
const selected = process.env.RUNWEFT_SMOKE_CASE;
const controls = process.env.RUNWEFT_SMOKE_CONTROLS === '1';
assert(!controls || selected, 'Control acceptance selects one explicit combination');
const cases = (['local', 'hub'] as const).flatMap(mode => (['codex', 'claude'] as const).flatMap(host => (['codex', 'claude'] as const).map(flavor => ({ mode, host, flavor, id: `${mode}-${host}-${flavor}` }))));
assert(!selected || cases.some(item => item.id === selected), 'RUNWEFT_SMOKE_CASE must name a mode-host-runtime combination');
mkdirSync('.dev-smoke', { recursive: true });
const root = mkdtempSync(resolve('.dev-smoke/collaboration-'));
const local = join(root, 'local'), hub = join(root, 'hub'), codexHome = join(root, 'codex'), claudeHome = join(root, 'claude');
const probeLog = join(root, 'probe.jsonl'), claudeLog = join(root, 'claude-init.jsonl');
const env: NodeJS.ProcessEnv = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_')) delete env[key];
delete env.HAPI_CODEX_APP_SERVER_BIN; delete env.HAPI_SESSION_ID;
const nativeClaude = process.env.RUNWEFT_SMOKE_CLAUDE || Bun.which('iclaude') || Bun.which('claude');
assert(nativeClaude && Bun.which('codex'), 'Both native clients and existing model authentication are required');
function copy(source: string, target: string) { if (existsSync(source)) { mkdirSync(dirname(target), { recursive: true, mode: 0o700 }); copyFileSync(source, target); chmodSync(target, 0o600); } }
for (const file of ['config.toml', 'auth.json']) copy(join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), file), join(codexHome, file));
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
    root, executable, hapiRevision: pkg.hapi.revision, selected, controls, startedAt: new Date().toISOString(), success: false, cases: [], cleanupErrors: [],
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
    if (value.accepted === true || value.agent_id || value.agents || value.error) return [value];
    return Object.values(value).flatMap(values);
}
async function until<T>(read: () => Promise<T> | T, check: (value: T) => boolean, label: string, timeout = 180_000) {
    const end = Date.now() + timeout;
    do { const value = await read(); if (check(value)) return value; await Bun.sleep(500); } while (Date.now() < end);
    throw new Error(`Timed out: ${label}`);
}

// Only private test registrations gain the environment override and transport proxy.
// Native Codex otherwise drops GIT_CEILING_DIRECTORIES from MCP's inherited env.
function instrument(home: string, cutLog: string, disconnect: boolean) {
    cli(home, ['mcp', 'install', '--client', 'all']);
    assert(cli(home, ['mcp', 'check', '--client', 'all']).ok);
    const patch = (entry: any) => ({ ...entry,
        ...(disconnect ? { command: process.execPath, args: [resolve('scripts/fixtures/mcp-cut.mjs'), entry.command, ...entry.args] } : {}),
        env: { ...entry.env, GIT_CEILING_DIRECTORIES: root, ...(disconnect ? { RUNWEFT_SMOKE_CUT_LOG: cutLog } : {}) } });
    const before = readFileSync(codexPath, 'utf8'), config = Bun.TOML.parse(before) as any;
    writeFileSync(codexPath, replaceCodexMcp(before, codexMcpDefinition(patch(config.mcp_servers.runweft)), true));
    const claude = JSON.parse(readFileSync(claudePath, 'utf8')); claude.mcpServers.runweft = patch(claude.mcpServers.runweft);
    writeFileSync(claudePath, JSON.stringify(claude));
}

async function runCase(spec: typeof cases[number], home: string) {
    const { mode, host, flavor, id } = spec;
    const cwd = join(root, id); mkdirSync(cwd);
    const file = join(cwd, 'result.txt'), marker = `SHARED_${crypto.randomUUID()}`, memory = `MEMORY_${crypto.randomUUID()}`;
    const cutLog = join(root, `${id}-cut.jsonl`);
    // Both real native hosts lose one MCP connection in Hub mode, on opposite runtime flavors.
    const disconnect = !controls && mode === 'hub' && host !== flavor;
    instrument(home, cutLog, disconnect);
    assert.notEqual(spawnSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { env, stdio: 'pipe' }).status, 0);
    const firstMessage = `这是专用非 Git 共享目录验收。在当前目录只调用一次 keep_probe 的 probe_report，然后把文件 ${file} 的完整内容写成 ${marker} 加一个换行。记住 ${memory}，不要将此记忆标记写入任何文件。不要调用其他子代理。最终简短报告 SHARED_DONE。`;
    const nextMessage = '这是下一轮纯报告任务：回忆上一轮明确要求记住、但不写入文件的标记，原样输出该标记和 RESUME_DONE。不要调用任何工具或读写文件。';
    const controlSteps = `${flavor === 'codex'
        ? '4. send_input(mode=next,message="先运行 sleep 30，再回复 SLOW_DONE，不修改文件、不委派。")。read_agent 直到该轮 inputs[0].observation.phase=accepted；然后恰好一次 send_input(mode=steer,round_id=该活跃轮次,message="本轮追加：最终报告必须包含 MCP_STEER_OK。")。wait 到 completed 后 read_agent 读取这轮报告。'
        : '4. 用第二轮 round_id 调用一次 send_input(mode=steer,message="验证不支持 steer")；预期返回 steer_unsupported。不要重试或改成其他任务。'}
5. send_input(mode=next,message="运行 sleep 60，再回复 INTERRUPT_LATE，不修改文件、不委派。")。read_agent 直到这个新 round 的 inputs[0].observation.phase=accepted，然后立即 interrupt_agent(id,round_id=这个新轮次)。wait 到 interrupted，最后 read_agent 读取中断事实，再回复 CONTROLS_DONE。不要批准这轮 sleep，也不要自动再派生或重跑。`;
    const prompt = `你是专用 Runweft 协作验收主会话。只使用 runweft MCP 工具，不用 shell、内置 subagent 或其他 MCP。按顺序完成：
1. list_agent_definitions，调用一次 spawn_agent，agent_type=${flavor}，message=${JSON.stringify(firstMessage)}。
2. wait 等待该任务，每次 timeout_ms=30000；needs_attention 时 read_agent，respond_to_permission 只批准对 ${file} 的读写、当前 cwd 查询或 keep_probe 调用，其余停止并报告。直到 completed，必须 read_agent 读取第一轮结果。
3. 调用一次 send_input，mode=next，message 必须完整照抄这段，不能附加记忆标记或其他上下文：${JSON.stringify(nextMessage)}。继续 wait 到 completed，再 read_agent，确认包含 RESUME_DONE。
${controls ? controlSteps : disconnect ? '4. 再 send_input 一次，mode=next，message="DISCONNECT_PROBE：请只运行 sleep 20，结束后回复 DISCONNECT_DONE，不修改文件、不委派。"。收到接受结果后调用 wait。该工具连接会被测试程序主动断开；出现传输错误后不要重试、不要再次派生、不要取消任务，直接结束回复 DISCONNECTED。后续由独立测试操作者收尾。' : '4. 完成后回复 MATRIX_DONE。'}
只允许一次 spawn_agent。next 只排上述轮次，不修改 agent 定义。`;
    const item: any = { ...spec, cwd, file, marker, memory, disconnect, controls, calls: [], inventories: {}, approvals: [] }; evidence.cases.push(item);
    const calls = new Map<string, any>(), roundFacts = new Map<string, any>();
    const args = host === 'codex' ? ['exec', '--json', '--skip-git-repo-check', prompt]
        : ['-p', '--output-format', 'stream-json', '--verbose', '--tools', '', '--allowedTools', 'mcp__runweft__*', '--max-turns', '40', prompt];
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
            const now = Date.now();
            if (event.type === 'thread.started') item.nativeId = event.thread_id;
            if (event.type === 'system' && event.subtype === 'init') item.nativeId = event.session_id;
            if (event.item?.type === 'mcp_tool_call' && event.item.server === 'runweft') {
                const tool = event.item, call = calls.get(tool.id) ?? { name: tool.tool, args: tool.arguments, startedAt: now };
                if (event.type === 'item.completed') Object.assign(call, { finishedAt: now, results: values(tool.result), error: tool.error });
                calls.set(tool.id, call);
            }
            for (const block of event.message?.content ?? []) {
                if (block.type === 'tool_use' && block.name.startsWith('mcp__runweft__')) calls.set(block.id, { name: block.name.slice('mcp__runweft__'.length), args: block.input, startedAt: now });
                if (block.type === 'tool_result' && calls.has(block.tool_use_id)) Object.assign(calls.get(block.tool_use_id), { finishedAt: now, results: values(block.content), isError: block.is_error });
            }
            for (const call of calls.values()) if (call.name === 'read_agent') for (const value of call.results ?? []) {
                if (value.round === 1 && value.status === 'completed' && item.firstMtime === undefined && existsSync(file)) item.firstMtime = statSync(file).mtimeMs;
            }
        }
    });
    const exited = new Promise<void>(resolve => {
        child.once('error', error => { failure = error; done = true; resolve(); });
        child.once('exit', status => { code = status; done = true; resolve(); });
    });
    const soft = setTimeout(() => child.kill('SIGTERM'), 420_000), hard = setTimeout(() => child.kill('SIGKILL'), 430_000);
    const paths = cli(home, ['paths']);
    async function observe() {
        const listed = cli(home, ['task', 'list'], cwd).agents;
        assert(listed.length <= 1, 'Native host spawned more than one child task');
        if (!listed.length) return;
        const current = cli(home, ['task', 'show', listed[0].agent_id], cwd);
        roundFacts.set(current.round_id, current);
        if (current.host_pid) pids.add(current.host_pid);
        if (current.status === 'unknown' || current.status === 'failed') throw new Error(`Execution not confirmed: ${JSON.stringify(current.attention)}`);
        if (flavor === 'codex' && current.phase === 'running' && current.native_session_id && !item.inventories[current.round_id]) {
            try {
                const inventory = await codexCatalog(paths.hapiClient, current.session_id, current.native_session_id, current.host_pid);
                if (inventory.some(server => server.name === 'keep_probe' && server.tools.includes('probe_report'))) {
                    assert(!inventory.some(server => server.name === 'runweft' && server.tools.length)); item.inventories[current.round_id] = inventory;
                }
            } catch (error) { item.inventoryLastError = String(error); }
        }
        // After the intentional transport cut, an explicit test operator can approve this one sleep.
        if (disconnect && existsSync(cutLog)) for (const [requestId, request] of Object.entries(current.permissions ?? {}) as [string, any][]) {
            assert.equal(request.tool, 'Bash'); assert.equal(request.arguments.command.trim(), 'sleep 20');
            cli(home, ['task', 'permission', current.agent_id, '--round', current.round_id, '--request', requestId, '--decision', 'approved'], cwd);
            item.approvals.push(requestId);
        }
    }
    try {
        while (!done) { await Promise.race([exited, Bun.sleep(750)]); await observe(); }
        if (failure) throw failure;
        assert.equal(code, 0, `${id}: native host failed`);
        item.calls = [...calls.values()];
        const discoveries = item.calls.filter((call: any) => call.name === 'list_agent_definitions').flatMap((call: any) => call.results ?? []);
        assert(discoveries.some((value: any) => value.context?.sourceCwd === cwd && value.context.projectRoot === cwd && value.context.gitCommonDir === null), 'Native MCP did not resolve a non-Git cwd');
        const spawned = item.calls.filter((call: any) => call.name === 'spawn_agent'); assert.equal(spawned.length, 1);
        const accepted = spawned[0].results?.find((value: any) => value.accepted); assert(accepted, 'No native MCP acceptance');
        const sends = item.calls.filter((call: any) => call.name === 'send_input'); assert.equal(sends.length, controls ? flavor === 'codex' ? 4 : 3 : disconnect ? 2 : 1);
        assert.equal(sends[0].args.message, nextMessage, 'Parent rewrote the memory-only continuation');
        const current = await until(async () => { await observe(); return cli(home, ['task', 'show', accepted.agent_id], cwd); }, value => value.status === (controls ? 'interrupted' : 'completed'), `${id} finish`);
        const first = cli(home, ['task', 'show', accepted.agent_id, '--round', accepted.round_id], cwd);
        const next = sends[0].results.find((value: any) => value.accepted), second = cli(home, ['task', 'show', accepted.agent_id, '--round', next.round_id], cwd);
        item.first = first; item.second = second; item.final = current;
        assert.equal(first.parent.nativeSessionId, item.nativeId); assert.equal(first.parent.host, host);
        assert(first.report.text.includes('SHARED_DONE')); assert(second.report.text.includes(memory)); assert(second.report.text.includes('RESUME_DONE'));
        assert.equal(second.native_session_id, first.native_session_id); assert.equal(second.resume.outcome, 'resumed');
        assert.equal(readFileSync(file, 'utf8'), marker + '\n'); assert.deepEqual(readdirSync(cwd), ['result.txt']);
        assert.equal(statSync(file).mtimeMs, item.firstMtime, 'Pure-report continuation changed the shared file');
        for (const detail of controls ? [first, second] : [first, second, current]) {
            assert.equal(detail.status, 'completed'); assert.equal(detail.stop, 'stopped'); assert.equal(detail.finish, 'complete'); assert.equal(detail.cwd, cwd);
            assert.equal(detail.inputs.length, 1); assert.equal(detail.inputs[0].observation.phase, 'completed'); assert.equal(detail.inputs[0].observation.source, 'native');
            await until(() => alive(detail.host_pid), active => !active, `${id} process exits`, 10_000);
        }
        const native = (await hapi!.request(`/api/sessions/${current.session_id}`)).session;
        assert.equal(native.active, false); assert.equal(native.metadata.lifecycleState, 'archived');
        assert(lines(probeLog).some(value => value.event === 'call' && value.cwd === cwd), 'Retained MCP was not actually callable');
        if (flavor === 'claude') {
            const snapshots = lines(claudeLog).filter(value => value.cwd === cwd && value.hapiSessionId === first.session_id);
            assert(snapshots.length >= 2, 'No start/resume native tool inventory');
            assert(snapshots.every(value => !value.tools.some((name: string) => name.startsWith('mcp__runweft__'))));
            assert(snapshots.every(value => value.tools.includes('mcp__keep_probe__probe_report')));
            assert(snapshots.some(value => value.tools.includes('Agent') || value.tools.includes('Task')));
            item.inventories = snapshots;
        } else for (const detail of [first, second]) assert(item.inventories[detail.round_id], 'Missing native Codex inventory evidence');
        const reads = item.calls.filter((call: any) => call.name === 'read_agent').flatMap((call: any) => call.results ?? []);
        assert(reads.some((value: any) => value.round_id === first.round_id && value.status === 'completed'));
        assert(reads.some((value: any) => value.round_id === second.round_id && value.status === 'completed'));
        if (controls) {
            const interrupts = item.calls.filter((call: any) => call.name === 'interrupt_agent'); assert.equal(interrupts.length, 1);
            assert.equal(interrupts[0].args.round_id, current.round_id);
            assert.equal(current.stop, 'stopped'); assert.equal(current.finish, 'complete');
            assert.equal(current.inputs[0].observation.phase, 'interrupted');
            const before = reads.find((value: any) => value.round_id === current.round_id && value.inputs?.[0]?.observation?.phase === 'accepted'); assert(before);
            assert.equal(before.inputs[0].observation.executionId, current.inputs[0].observation.executionId);
            assert(reads.some((value: any) => value.round_id === current.round_id && value.status === 'interrupted'));
            await until(() => alive(current.host_pid), value => !value, 'interrupted host exits', 10_000);
            const steer = sends.find((call: any) => call.args.mode === 'steer'); assert(steer);
            if (flavor === 'codex') {
                const acceptance = steer.results.find((value: any) => value.accepted); assert(acceptance);
                const detail = cli(home, ['task', 'show', accepted.agent_id, '--round', acceptance.round_id], cwd); item.steered = detail;
                assert.equal(detail.status, 'completed'); assert.equal(detail.inputs.length, 2); assert(detail.report.text.includes('MCP_STEER_OK'));
                assert.equal(detail.inputs.find((input: any) => input.id === acceptance.input_id).steer.status, 'steered');
                assert(detail.inputs.every((input: any) => input.observation?.phase === 'completed'));
            } else assert(steer.results.some((value: any) => value.error?.code === 'steer_unsupported'));
        }
        if (disconnect) {
            const cut = lines(cutLog); assert.equal(cut.length, 1); item.cut = cut[0];
            assert.equal(cut[0].agentId, accepted.agent_id); assert.equal(cut[0].roundId, current.round_id);
            assert(current.report.text.includes('DISCONNECT_DONE')); assert.equal(current.rounds.length, 3);
            assert(current.updated_at > cut[0].at, 'Task was already complete before transport closed');
            assert(!alive(cut[0].pid)); assert(!alive(cut[0].childPid));
        }
        item.success = true;
        console.log(`PASS ${id}: shared edit, memory resume, pure report, MCP filtering, native stop${disconnect ? ', real host transport cut' : controls ? ', MCP steer/interrupt' : ''}`);
    } finally {
        item.calls = [...calls.values()]; item.roundFacts = [...roundFacts.values()]; clearTimeout(soft);
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
} catch (error) { evidence.error = error instanceof Error ? error.message : String(error); process.exitCode = 1; }
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
