import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { freePort } from '../src/services';
import { HubClient } from '../src/hub/client';
import type { HapiHttp } from '../src/hapi';
import { chromium } from 'playwright';
import { configureSmokeCodexModel } from './fixtures/codex-model';
import pkg from '../package.json';

// Real MCP hosts and model calls, using dedicated writable native homes only.
const executable = resolve(process.argv[2] ?? 'dist/runweft');
const selectedHost = process.env.RUNWEFT_SMOKE_HOST ?? 'all';
assert(['all', 'codex', 'claude'].includes(selectedHost), 'RUNWEFT_SMOKE_HOST must be all, codex or claude');
mkdirSync('.dev-smoke', { recursive: true });
const root = mkdtempSync(resolve('.dev-smoke/hub-native-mcp-'));
const home = join(root, 'runweft'), project = join(root, 'project'), codexHome = join(root, 'codex'), claudeHome = join(root, 'claude');
for (const path of [project, codexHome, claudeHome]) mkdirSync(path, { mode: 0o700 });
const env: NodeJS.ProcessEnv = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_') || key.startsWith('HAPI_') || ['CLI_API_TOKEN', 'DB_PATH', 'TELEGRAM_BOT_TOKEN'].includes(key)) delete env[key];
delete env.HAPI_CODEX_APP_SERVER_BIN; delete env.HAPI_SESSION_ID;
const nativeClaude = process.env.RUNWEFT_SMOKE_CLAUDE || Bun.which('iclaude') || Bun.which('claude');
assert(nativeClaude && Bun.which('codex'), 'Both native clients and model authentication are required');
function copy(source: string, target: string) { if (existsSync(source)) { mkdirSync(dirname(target), { recursive: true, mode: 0o700 }); copyFileSync(source, target); chmodSync(target, 0o600); } }
const sourceCodex = process.env.CODEX_HOME ?? join(homedir(), '.codex');
for (const file of ['config.toml', 'auth.json']) copy(join(sourceCodex, file), join(codexHome, file));
const sourceClaude = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
copy(process.env.CLAUDE_CONFIG_DIR ? join(sourceClaude, '.claude.json') : join(homedir(), '.claude.json'), join(claudeHome, '.claude.json'));
for (const file of ['settings.json', '.credentials.json']) copy(join(sourceClaude, file), join(claudeHome, file));
Object.assign(env, { CODEX_HOME: codexHome, CLAUDE_CONFIG_DIR: claudeHome, GIT_CEILING_DIRECTORIES: root, HAPI_CLAUDE_PATH: nativeClaude });
const codexModel = configureSmokeCodexModel(join(codexHome, 'config.toml'));
const original = Bun.TOML.parse(readFileSync(join(codexHome, 'config.toml'), 'utf8')) as any;
for (const name of Object.keys(original.mcp_servers ?? {})) assert.equal(spawnSync('codex', ['mcp', 'remove', name], { env, stdio: 'pipe' }).status, 0);
const prefsPath = join(claudeHome, '.claude.json');
const prefs = existsSync(prefsPath) ? JSON.parse(readFileSync(prefsPath, 'utf8')) : {};
prefs.mcpServers = {}; writeFileSync(prefsPath, JSON.stringify(prefs), { mode: 0o600 });
const evidence: { [key: string]: any; checks: string[]; cases: any[]; cleanupErrors: string[] } = {
    root, executable, selectedHost, codexModel, hapiRevision: pkg.hapi.revision, startedAt: new Date().toISOString(), success: false, checks: [], cases: [], cleanupErrors: [],
};
let started = false, token: string | undefined, hapi: HapiHttp | undefined;
const pids = new Set<number>();
function alive(pid: number) { try { process.kill(pid, 0); return true; } catch { return false; } }
function cli(args: string[]) {
    const result = spawnSync(executable, ['--home', home, '--json', ...args], { cwd: project, env, encoding: 'utf8', timeout: 60_000 });
    if (token) assert(!`${result.stdout}${result.stderr}`.includes(token), 'Credential leaked');
    assert.equal(result.status, 0, `${args[0]}: ${result.stderr || result.error || result.signal}`);
    return JSON.parse(result.stdout);
}
function record(check: string) { evidence.checks.push(check); console.log(`PASS ${check}`); }
function values(value: any): any[] {
    if (typeof value === 'string') { try { return values(JSON.parse(value)); } catch { return []; } }
    if (!value || typeof value !== 'object') return [];
    if (value.accepted === true || value.agent_id || value.agents || value.error) return [value];
    return Object.values(value).flatMap(values);
}
async function hostCall(host: 'codex' | 'claude', runtime: string, agentId: string, helper: string, proof: string) {
    const childMessage = `专用验收：只执行一次命令 ${process.execPath} ${helper}，它验证本子会话不能通过 Runweft CLI 递归委派。不要自行委派，不要修改其他文件。完成后报告 MCP_CHILD_DONE。`;
    const prompt = `你是 Runweft 原生 MCP 验收主会话。只使用 runweft MCP 工具，不使用 shell、内置 subagent 或其他工具。严格顺序：
1. list_agent_definitions，然后只调用一次 spawn_agent，agent_type=${agentId}，message=${JSON.stringify(childMessage)}。
2. 用 wait 等待该 agent_id，timeout_ms=30000，必要时继续等待，直到 completed；不要再次 spawn。若 needs_attention，read_agent 查看即可，测试控制器会处理预期的原生审批。
3. completed 后必须调用 read_agent，核对 report 含 MCP_CHILD_DONE。记住这次 read_agent 返回的 revision。
4. 调用一次 wait，ids=[该 agent_id]，timeout_ms=65000，after_revision={该 agent_id:第3步 revision}。必须实际等待返回 timed_out=true；不要缩短或取消这个等待。
5. 只有以上全部完成才回复 MCP_HOST_DONE。`;
    const args = host === 'codex' ? ['exec', '--json', '--skip-git-repo-check', prompt]
        : ['-p', '--output-format', 'stream-json', '--verbose', '--tools', '', '--allowedTools', 'mcp__runweft__*', '--max-turns', '20', prompt];
    const calls = new Map<string, any>();
    const item: any = { host, runtime, calls: [], approvedRequests: [] }; evidence.cases.push(item);
    const child = spawn(host === 'codex' ? 'codex' : nativeClaude!, args, { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'] });
    assert(child.pid); pids.add(child.pid);
    let buffer = '', done = false, failure: Error | undefined, resultCode: number | null = null;
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
        }
    });
    const exited = new Promise<void>(resolve => {
        child.once('error', error => { failure = error; done = true; resolve(); });
        child.once('exit', code => { resultCode = code; done = true; resolve(); });
    });
    const timer = setTimeout(() => child.kill('SIGTERM'), 480_000);
    const hard = setTimeout(() => child.kill('SIGKILL'), 490_000);
    const approvals = new Set<string>();
    try {
        while (!done) {
            await Promise.race([exited, Bun.sleep(750)]);
            for (const task of cli(['task', 'list']).agents) {
                if (task.status !== 'needs_attention') continue;
                const detail = cli(['task', 'show', task.agent_id]);
                for (const [requestId, request] of Object.entries(detail.permissions ?? {}) as [string, any][]) {
                    if (approvals.has(requestId)) continue;
                    const expected = JSON.stringify(request.arguments).includes(helper)
                        || (request.tool === 'Read' && request.arguments?.file_path === proof);
                    if (!expected) item.unexpectedPermission = request;
                    assert(expected, 'Unexpected child permission request');
                    cli(['task', 'permission', task.agent_id, '--round', detail.round_id, '--request', requestId, '--decision', 'approved']);
                    approvals.add(requestId); item.approvedRequests.push(requestId);
                }
            }
        }
        if (failure) throw failure;
        assert.equal(resultCode, 0, `${host} native host did not complete`);
        item.calls = [...calls.values()];
        const spawned = item.calls.filter((call: any) => call.name === 'spawn_agent');
        assert.equal(spawned.length, 1, 'Host must accept exactly one child');
        const accepted = spawned[0].results.find((value: any) => value.accepted === true); assert(accepted, 'No actual MCP acceptance');
        const reads = item.calls.filter((call: any) => call.name === 'read_agent');
        assert(reads.some((call: any) => call.results?.some((v: any) => v.status === 'completed' && v.report.text.includes('MCP_CHILD_DONE'))), 'Host did not read actual completed report');
        const longWait = item.calls.find((call: any) => call.name === 'wait' && call.args.timeout_ms === 65000);
        assert(longWait?.results?.some((value: any) => value.timed_out === true), 'No actual long wait timeout response');
        assert(longWait.finishedAt - longWait.startedAt >= 64_000, 'Native wait did not last beyond 60 seconds');
        item.longWaitMs = longWait.finishedAt - longWait.startedAt;
        const detail = cli(['task', 'show', accepted.agent_id]); item.detail = detail;
        assert.equal(detail.parent.nativeSessionId, item.nativeId); assert.equal(detail.parent.host, host);
        assert.equal(detail.inputs[0].observation.phase, 'completed'); assert.equal(detail.inputs[0].observation.source, 'native');
        assert.equal(detail.stop, 'stopped'); assert.equal(detail.finish, 'complete');
        assert.equal(typeof detail.host_pid, 'number'); pids.add(detail.host_pid);
        const session = (await hapi!.request(`/api/sessions/${detail.session_id}`)).session;
        assert.equal(session.active, false); assert.equal(session.metadata.lifecycleState, 'archived');
        for (let i = 0; i < 30 && alive(detail.host_pid); i++) await Bun.sleep(100);
        assert(!alive(detail.host_pid), 'Child host process did not exit');
        const denied = JSON.parse(readFileSync(proof, 'utf8')); item.childCli = denied;
        assert.deepEqual(denied.codes, ['subagent_delegation_denied', 'subagent_delegation_denied']);
        assert.equal(denied.hapiSessionId, detail.session_id);
        record(`${host} → ${runtime}: real spawn/wait/read, child CLI spawn+send rejected, native completion and process stopped`);
        record(`${host}: actual MCP wait returns timed_out after ${item.longWaitMs}ms`);
    } finally {
        item.calls = [...calls.values()]; clearTimeout(timer);
        if (!done) { child.kill('SIGTERM'); await exited; }
        clearTimeout(hard);
    }
}

console.log(`Evidence directory: ${root}`);
try {
    cli(['init']); cli(['data', 'reset', '--apply']);
    cli(['init']); cli(['config', 'set', 'server.port', String(await freePort())]);
    const service = cli(['start']); started = true;
    const url = service.service.url;
    const connection = cli(['hub', '--url', url, 'connect', 'begin', '--name', 'Native MCP acceptance']);
    const browser = await chromium.launch({ headless: true, executablePath: process.env.RUNWEFT_SMOKE_CHROMIUM });
    let spaceId: string;
    try {
        const page = await browser.newPage();
        await page.goto(connection.confirmationUrl);
        await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('#logout')?.disabled);
        await page.locator('#new-name').fill('native MCP smoke');
        await page.locator('#create-identity button').click();
        await page.locator('#secret-dialog[open]').waitFor();
        token = await page.locator('#secret-value').innerText();
        await page.locator('#close-secret').click();
        spaceId = await page.locator('#space-id').innerText();
        await page.locator('#confirm-connection').click();
        await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('#logout')?.disabled);
        assert.equal(cli(['hub', '--url', url, 'connect', 'complete']).status, 'connected');
        assert(cli(['hub', 'identity']).identity.id);
        assert(!page.url().includes(token));
        record('fresh browser identity and space connect through encrypted begin/complete before native host use');
    } finally { await browser.close(); }
    hapi = new HubClient({ url, home, env }, 'hubDelegation', 'unavailable').http;
    const machine = cli(['machine', 'enroll']); cli(['machine', 'associate', machine.machineId, spaceId!]);
    cli(['runner', 'start']);
    const git = (...args: string[]) => { const result = spawnSync('git', ['-C', project, ...args], { env, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); };
    git('init', '-q'); git('config', 'user.name', 'smoke'); git('config', 'user.email', 'smoke@example.invalid'); git('config', 'commit.gpgsign', 'false');
    writeFileSync(join(project, 'baseline.txt'), 'isolated smoke'); git('add', '.'); git('commit', '-qm', 'baseline');
    const repository = cli(['repository', 'create', 'MCP smoke', '--request-id', crypto.randomUUID()]).repository;
    cli(['repository', 'bind', repository.id, '--machine', machine.machineId]);
    const agents: Record<string, string> = {};
    for (const flavor of ['codex', 'claude']) {
        const runtime = cli(['runtime', 'register', flavor, '--machine', machine.machineId]).runtime;
        const file = join(root, flavor + '.json'); writeFileSync(file, JSON.stringify({ name: flavor, runtimeId: runtime.id, repositoryId: repository.id }));
        agents[flavor] = cli(['agent', 'create', '--request-id', crypto.randomUUID(), '--file', file]).agent.id;
    }
    record('default compiled Hub starts after prerelease reset; identity, machine, runtime, repository and Agent register independently');
    cli(['mcp', 'install', '--client', 'all']); assert(cli(['mcp', 'check', '--client', 'all']).ok);
    for (const host of ['codex', 'claude'] as const) for (const runtime of ['codex', 'claude'] as const) {
        if (selectedHost !== 'all' && selectedHost !== host) continue;
        const helper = join(root, `child-${host}-${runtime}.mjs`), proof = join(root, `child-${host}-${runtime}.json`);
        writeFileSync(helper, `import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const codes = [];
for (const args of [['spawn', ${JSON.stringify(agents[runtime])}, '--message', 'recursive probe'], ['send', crypto.randomUUID(), '--message', 'recursive probe']]) {
    const r = spawnSync(${JSON.stringify(executable)}, ['--home', ${JSON.stringify(home)}, '--json', 'task', ...args], { encoding: 'utf8', timeout: 20000 });
    assert.equal(r.status, 1); const code = JSON.parse(r.stderr.trim().split('\\n').at(-1)).error.code;
    assert.equal(code, 'subagent_delegation_denied'); codes.push(code);
}
writeFileSync(${JSON.stringify(proof)}, JSON.stringify({ codes, hapiSessionId: process.env.HAPI_SESSION_ID }));
console.log('CHILD_CLI_DENIED');
`, { mode: 0o600 });
        await hostCall(host, runtime, agents[runtime], helper, proof);
    }
    evidence.success = true;
} catch (error) { evidence.error = error instanceof Error ? error.message : String(error); process.exitCode = 1; }
finally {
    if (hapi) try {
        for (const session of (await hapi.request('/api/sessions')).sessions) if (session.active) await hapi.request(`/api/sessions/${session.id}/archive`, { method: 'POST', signal: AbortSignal.timeout(45_000) });
    } catch (error) { evidence.cleanupErrors.push(String(error)); }
    if (started) try { cli(['stop']); } catch (error) { evidence.cleanupErrors.push(String(error)); }
    for (const pid of pids) if (alive(pid)) evidence.cleanupErrors.push(`Process still alive: ${pid}`);
    if (evidence.cleanupErrors.length) { evidence.success = false; process.exitCode = 1; }
    evidence.finishedAt = new Date().toISOString(); writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(`Evidence: ${join(root, 'evidence.json')}`); if (evidence.error) console.error(evidence.error);
}
