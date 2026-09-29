import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ExecutionClient } from '../src/execution';
import { HapiClient } from '../src/hapi';
import { freePort } from '../src/services';
import { codexCatalog } from './fixtures/codex-catalog';
import pkg from '../package.json';

// Explicit native acceptance using dedicated copies of configuration and existing model login.
// Not part of credential-free tests; never installs MCP into the user's real native homes.
const executable = resolve(process.argv[2] ?? 'dist/runweft');
mkdirSync('.dev-smoke', { recursive: true });
const root = mkdtempSync(resolve('.dev-smoke/mcp-'));
const local = join(root, 'local'), hub = join(root, 'hub-client');
const codexHome = join(root, 'codex-home'), claudeHome = join(root, 'claude-home');
const probeLog = join(root, 'probe.jsonl'), claudeLog = join(root, 'claude-init.jsonl');
const env: NodeJS.ProcessEnv = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_')) delete env[key];
const nativeClaude = process.env.RUNWEFT_SMOKE_CLAUDE || Bun.which('iclaude') || Bun.which('claude');
assert(nativeClaude, 'Install Claude Code and configure model authentication before this explicit test');
assert(Bun.which('codex'), 'Install Codex and configure model authentication before this explicit test');
const evidence: { root: string; revision: string; platform: string; startedAt: string; success: boolean;
    binaryHashes: Record<string, string>; versions: Record<string, string>; checks: string[]; cases: Array<Record<string, unknown>>;
    error?: string; cleanupErrors: string[]; finishedAt?: string } = {
    root, revision: pkg.hapi.revision, platform: `${process.platform}-${process.arch}`, startedAt: new Date().toISOString(),
    success: false, binaryHashes: {}, versions: {}, checks: [], cases: [], cleanupErrors: [],
};
let token: string | undefined, hapi: HapiClient | undefined, execution: ExecutionClient | undefined;
const homes: string[] = [];
const hashes = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
function readLines(path: string): any[] {
    return existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
}
function alive(pid: number) { try { process.kill(pid, 0); return true; } catch { return false; } }
function cli(home: string, args: string[], input?: string) {
    const result = spawnSync(executable, ['--home', home, '--json', ...args], { env, input, encoding: 'utf8', timeout: 60_000 });
    if (token) assert(!`${result.stdout}${result.stderr}`.includes(token), 'Credential appeared in CLI output');
    assert.equal(result.status, 0, `${args[0]} failed: ${result.stderr || result.error || result.signal}`);
    return JSON.parse(result.stdout);
}
function nativeConfig(args: string[]) {
    const result = spawnSync('codex', ['mcp', ...args], { env, encoding: 'utf8', timeout: 20_000 });
    assert.equal(result.status, 0, 'Codex private configuration preparation failed');
}
async function until<T>(read: () => Promise<T>, accept: (value: T) => boolean, label: string, timeout = 120_000) {
    const deadline = Date.now() + timeout;
    do { const value = await read(); if (accept(value)) return value; await Bun.sleep(200); } while (Date.now() < deadline);
    throw new Error(`Timed out: ${label}`);
}
function record(check: string) { evidence.checks.push(check); console.log(`PASS ${check}`); }
function copy(source: string, destination: string) {
    if (!existsSync(source)) return;
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 }); copyFileSync(source, destination); chmodSync(destination, 0o600);
}
function shellQuote(value: string) { return `'${value.replaceAll("'", "'\\''")}'`; }
function diagnosticValues(value: any): any[] {
    if (!value || typeof value !== 'object') return [];
    if (value.identity && value.workspace) return [value];
    if (Array.isArray(value)) return value.flatMap(diagnosticValues);
    return Object.entries(value).flatMap(([key, value]) => {
        if (['text', 'content'].includes(key) && typeof value === 'string') {
            try { return diagnosticValues(JSON.parse(value)); } catch { return []; }
        }
        return typeof value === 'object' ? diagnosticValues(value) : [];
    });
}
async function hostCall(client: 'codex' | 'claude', directory: string, home: string, mode: string) {
    mkdirSync(directory, { recursive: true });
    const prompt = 'Call the runweft_status MCP tool exactly once. This is a read-only connection probe. Do not use other tools, read files or delegate. Reply DONE after the tool response.';
    const args = client === 'codex' ? ['exec', '--json', '--skip-git-repo-check', prompt]
        : ['-p', '--output-format', 'stream-json', '--verbose', '--tools', '', '--allowedTools', 'mcp__runweft__runweft_status', '--max-turns', '3', prompt];
    const result = await new Promise<{ code: number | null; events: any[] }>((resolve, reject) => {
        const child = spawn(client === 'codex' ? 'codex' : nativeClaude!, args, { cwd: directory, env, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = ''; child.stdout.on('data', chunk => { stdout += chunk; });
        child.stderr.on('data', () => {}); // Native diagnostics are not copied into test evidence.
        const timer = setTimeout(() => child.kill('SIGTERM'), 150_000);
        child.once('error', reject);
        child.once('exit', code => {
            clearTimeout(timer);
            const events = stdout.split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
            resolve({ code, events });
        });
    });
    assert.equal(result.code, 0, `${client} native host failed`);
    const nativeId = client === 'codex' ? result.events.find(event => event.type === 'thread.started')?.thread_id
        : result.events.find(event => event.type === 'system' && event.subtype === 'init')?.session_id;
    const value = result.events.flatMap(diagnosticValues).find(value => value.identity?.nativeSessionId === nativeId);
    assert(value, `${client} returned no actual MCP diagnostic`);
    assert.equal(value.identity.cwd, directory); assert.equal(value.workspace.path, directory);
    assert.equal(value.dataRoot, home); assert.equal(value.connection.mode, mode); assert.equal(value.connection.connected, true);
    evidence.cases.push({ kind: 'host', mode, client, nativeId, cwd: directory, connected: true });
    record(`${mode}/${client}: installed global MCP returns real identity, cwd and authenticated connection`);
}

async function filteredExecution(agent: 'codex' | 'claude', machineId: string, home: string, mode: string) {
    const directory = join(root, mode, `child-${agent}`); mkdirSync(directory, { recursive: true });
    const started = await execution!.start(machineId, { requestId: crypto.randomUUID(), directory, agent,
        startingMode: 'remote', permissionMode: 'default', disabledMcpServers: ['runweft'] });
    assert(started.outcome === 'recorded' && started.receipt.response?.type === 'success', 'Child start was not confirmed');
    const id = started.receipt.sessionId, paths = cli(home, ['paths']);
    let nativeId: string | undefined;
    for (const round of ['start', 'resume']) {
        const ready = await execution!.waitUntilReady(id);
        assert.deepEqual(ready.metadata?.disabledMcpServers, ['runweft']);
        if (agent === 'codex') {
            const catalog = await until(() => codexCatalog(paths.hapiClient, id, ready.metadata!.codexSessionId!, ready.metadata!.hostPid!),
                rows => rows.some(row => row.name === 'keep_probe' && row.tools.includes('probe_report')), 'native Codex tool discovery', 30_000);
            assert(!catalog.some(row => row.name === 'runweft' && row.tools.length), 'Runweft tools visible to child');
        }
        const since = Date.now(), localId = crypto.randomUUID(), approved = new Set<string>();
        await execution!.send(id, { localId, text: '专用只读验证：只调用一次 keep_probe 的 probe_report，然后回复 FILTER_DONE。不委派、不读写文件、不调用其他工具。' });
        const done = await until(async () => {
            const value = await execution!.query(id, localId);
            for (const [requestId, request] of Object.entries(value.permissions)) {
                if (approved.has(requestId)) continue;
                assert(['keep_probe', 'mcp__keep_probe__probe_report'].includes(request.tool), 'Unexpected permission target');
                approved.add(requestId); await execution!.respondPermission(id, requestId, 'approved');
            }
            return value;
        }, value => value.facts.some(fact => fact.observation.phase === 'completed') && !value.session.thinking, `${agent} ${round}`);
        assert(done.output.some(output => output.text.trim()), `${agent} ${round}: completed execution returned no native output`);
        assert(readLines(probeLog).some(event => event.event === 'call' && event.cwd === directory && event.at >= since), 'Other MCP was not actually called');
        const currentNative = agent === 'codex' ? done.session.metadata?.codexSessionId : done.session.metadata?.claudeSessionId;
        if (round === 'start') nativeId = currentNative; else assert.equal(currentNative, nativeId);
        if (agent === 'claude') {
            const snapshots = readLines(claudeLog).filter(event => event.hapiSessionId === id && event.nativeSessionId === nativeId && event.at >= since);
            assert(snapshots.length, 'No native Claude discovery snapshot');
            assert(snapshots.every(event => !event.tools.some((tool: string) => tool.startsWith('mcp__runweft__'))), 'Runweft tools visible to Claude child');
            assert(snapshots.every(event => event.tools.includes('mcp__keep_probe__probe_report')), 'Other MCP missing from Claude discovery');
            assert(snapshots.some(event => event.tools.includes('Agent') || event.tools.includes('Task')), 'Native Claude delegation tool missing');
        }
        assert.equal((await execution!.stop(id)).outcome, 'stopped');
        if (round === 'start') {
            const resumed = await execution!.resume(id); assert(resumed.outcome === 'resumed'); assert.equal(resumed.nativeSessionId, nativeId);
        }
        record(`${mode}/${agent}: ${round} hides Runweft tools and retains other MCP calls`);
    }
    evidence.cases.push({ kind: 'child', mode, agent, sessionId: id, nativeId, filteredStartAndResume: true, stopped: true });
}

async function compiledCancellation() {
    let started!: () => void, cancelled!: () => void;
    const waiting = new Promise<void>(resolve => { started = resolve; }), aborted = new Promise<void>(resolve => { cancelled = resolve; });
    const paths: string[] = [];
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
        const path = new URL(request.url).pathname; paths.push(path);
        if (path === '/api/runweft/health') return Response.json({ service: 'runweft', protocolVersion: 1, ready: true });
        assert.equal(path, '/api/auth'); started();
        return new Promise<Response>(resolve => request.signal.addEventListener('abort', () => { cancelled(); resolve(new Response()); }, { once: true }));
    } });
    const home = join(root, 'cancel-client'); cli(home, ['init', '--url', `http://127.0.0.1:${server.port}`]);
    const transport = new StdioClientTransport({ command: executable, args: ['--home', home, 'mcp', 'serve', '--client', 'codex'],
        env: Object.fromEntries(Object.entries({ ...env, RUNWEFT_HUB_TOKEN: 'dedicated-cancellation-probe' }).filter(([, value]) => typeof value === 'string')) as Record<string, string>, stderr: 'pipe' });
    transport.stderr?.on('data', () => {});
    const client = new Client({ name: 'runweft-cancellation-probe', version: '1' });
    try {
        await client.connect(transport);
        const controller = new AbortController();
        const call = client.callTool({ name: 'runweft_status', _meta: { threadId: 'protocol-test', sessionId: 'protocol-test', callId: 'protocol-cancel' } }, undefined, { signal: controller.signal }).catch(() => null);
        await Promise.race([waiting, Bun.sleep(10_000).then(() => { throw new Error('Authentication never started'); })]);
        controller.abort(); await call;
        await Promise.race([aborted, Bun.sleep(3_000).then(() => { throw new Error('Cancellation did not abort the HTTP request'); })]);
        assert.deepEqual(paths, ['/api/runweft/health', '/api/auth']);
        record('compiled MCP: request cancellation aborts waiting authentication without replay or execution control');
    } finally { await client.close(); await server.stop(true); }
}

try {
    const sourceCodex = process.env.CODEX_HOME || join(process.env.HOME!, '.codex');
    copy(join(sourceCodex, 'config.toml'), join(codexHome, 'config.toml')); copy(join(sourceCodex, 'auth.json'), join(codexHome, 'auth.json'));
    if (!existsSync(join(codexHome, 'config.toml'))) { mkdirSync(codexHome, { recursive: true }); writeFileSync(join(codexHome, 'config.toml'), ''); }
    const sourceClaude = process.env.CLAUDE_CONFIG_DIR;
    copy(sourceClaude ? join(sourceClaude, '.claude.json') : join(process.env.HOME!, '.claude.json'), join(claudeHome, '.claude.json'));
    copy(join(sourceClaude || join(process.env.HOME!, '.claude'), 'settings.json'), join(claudeHome, 'settings.json'));
    copy(join(sourceClaude || join(process.env.HOME!, '.claude'), '.credentials.json'), join(claudeHome, '.credentials.json'));
    env.CODEX_HOME = codexHome; env.CLAUDE_CONFIG_DIR = claudeHome;
    const probe = { command: process.execPath, args: [resolve('scripts/fixtures/mcp-probe.mjs')], env: { RUNWEFT_SMOKE_PROBE_LOG: probeLog } };
    const prefs = existsSync(join(claudeHome, '.claude.json')) ? JSON.parse(readFileSync(join(claudeHome, '.claude.json'), 'utf8')) : {};
    prefs.mcpServers = { keep_probe: { type: 'stdio', ...probe } }; mkdirSync(claudeHome, { recursive: true, mode: 0o700 });
    writeFileSync(join(claudeHome, '.claude.json'), JSON.stringify(prefs), { mode: 0o600 });
    const copied = Bun.TOML.parse(readFileSync(join(codexHome, 'config.toml'), 'utf8')) as any;
    for (const name of Object.keys(copied.mcp_servers ?? {})) nativeConfig(['remove', name]);
    nativeConfig(['add', 'keep_probe', '--env', `RUNWEFT_SMOKE_PROBE_LOG=${probeLog}`, '--', probe.command, ...probe.args]);
    const wrapper = join(root, 'claude-observer');
    writeFileSync(wrapper, `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(resolve('scripts/fixtures/claude-observer.mjs'))} "$@"\n`, { mode: 0o700 });
    env.HAPI_CLAUDE_PATH = wrapper; env.RUNWEFT_SMOKE_CLAUDE = nativeClaude;
    env.RUNWEFT_SMOKE_CLAUDE_LOG = claudeLog;
    const auth = join(codexHome, 'auth.json'), authHash = existsSync(auth) ? hashes(auth) : null;
    evidence.binaryHashes = { runweft: hashes(executable), hapi: hashes(join(dirname(executable), 'hapi')) };
    for (const [name, command] of [['codex', 'codex'], ['claude', nativeClaude]]) {
        const version = spawnSync(command, ['--version'], { env, encoding: 'utf8' }); assert.equal(version.status, 0); evidence.versions[name] = version.stdout.trim();
    }
    console.log(`Evidence directory: ${root}`);
    cli(local, ['init']); homes.push(local); cli(local, ['config', 'set', 'server.port', String(await freePort())]); cli(local, ['start']);
    const localStatus = cli(local, ['status']); assert.equal(localStatus.hapiRevision, pkg.hapi.revision);
    const url = localStatus.url, localPaths = cli(local, ['paths']);
    token = JSON.parse(readFileSync(join(localPaths.hapiServer, 'settings.json'), 'utf8')).cliApiToken; assert(token);
    hapi = new HapiClient(url, token); execution = new ExecutionClient(hapi);
    assert.equal((await hapi.request('/health')).capabilities.mcpToolFilter, 1);
    for (const [mode, home] of [['local', local], ['hub', hub]]) {
        if (mode === 'hub') { cli(home, ['init', '--url', url]); homes.push(home); cli(home, ['auth', 'login', '--token-stdin'], token); cli(home, ['start']); }
        cli(home, ['mcp', 'install', '--client', 'all']); assert(cli(home, ['mcp', 'check', '--client', 'all']).ok);
        const hosts = await Promise.allSettled((['codex', 'claude'] as const).map(client => hostCall(client, join(root, mode, `parent-${client}`), home, mode)));
        for (const result of hosts) if (result.status === 'rejected') throw result.reason;
        const paths = cli(home, ['paths']), machineId = JSON.parse(readFileSync(join(paths.hapiClient, 'settings.json'), 'utf8')).machineId;
        for (const agent of ['codex', 'claude'] as const) await filteredExecution(agent, machineId, home, mode);
    }
    assert.equal(existsSync(auth) ? hashes(auth) : null, authHash, 'Model authentication copy changed during installation');
    await compiledCancellation();
    evidence.success = true;
} catch (error) { evidence.error = error instanceof Error ? error.message : String(error); process.exitCode = 1; }
finally {
    if (hapi && execution) {
        try { for (const session of (await hapi.request('/api/sessions')).sessions) {
            if ((await execution.stop(session.id)).outcome !== 'stopped') evidence.cleanupErrors.push(`Unconfirmed stop: ${session.id}`);
        } } catch (error) { evidence.cleanupErrors.push(String(error)); }
    }
    for (const home of homes.reverse()) { try { cli(home, ['stop']); } catch (error) { evidence.cleanupErrors.push(String(error)); } }
    await Bun.sleep(600);
    for (const pid of new Set([...readLines(probeLog), ...readLines(claudeLog)].map(event => event.pid))) {
        if (alive(pid)) evidence.cleanupErrors.push(`Native probe still alive: ${pid}`);
    }
    if (evidence.cleanupErrors.length) { evidence.success = false; process.exitCode = 1; }
    evidence.finishedAt = new Date().toISOString();
    writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(`Evidence: ${join(root, 'evidence.json')}`);
    if (evidence.error) console.error(evidence.error);
}
