import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { ExecutionClient, type StartResult } from '../src/execution';
import { HapiClient } from '../src/hapi';
import pkg from '../package.json';

// Explicitly invoked native acceptance: uses existing model login/configuration.
// Never register this with credential-free unit tests or run it against a user home.
const executable = resolve(process.argv[2] ?? 'dist/runweft');
const parent = resolve('.dev-smoke');
mkdirSync(parent, { recursive: true });
const root = mkdtempSync(join(parent, 'execution-'));
const home = join(root, 'home');
const env: NodeJS.ProcessEnv = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_')) delete env[key];
const evidence: { root: string; revision: string; platform: string; startedAt: string; finishedAt?: string; success?: boolean;
    checks: string[]; cases: Array<Record<string, unknown>>; error?: string; cleanupErrors: string[] } = {
    root, revision: pkg.hapi.revision, platform: `${process.platform}-${process.arch}`, startedAt: new Date().toISOString(),
    checks: [], cases: [], cleanupErrors: [],
};
let token: string | undefined;
function run(args: string[]) {
    const result = spawnSync(executable, ['--home', home, '--json', ...args], { env, encoding: 'utf8', timeout: 45_000 });
    if (token) assert(!`${result.stdout}${result.stderr}`.includes(token), 'Credential in CLI output');
    assert.equal(result.status, 0, `${args[0]} failed: ${result.stderr || result.error || result.signal}`);
    return JSON.parse(result.stdout);
}
function record(check: string) { evidence.checks.push(check); console.log(`PASS ${check}`); }
function alive(pid: number) { try { process.kill(pid, 0); return true; } catch { return false; } }
async function until<T>(read: () => Promise<T>, accept: (value: T) => boolean, label: string, timeout = 90_000): Promise<T> {
    const end = Date.now() + timeout;
    do { const value = await read(); if (accept(value)) return value; await Bun.sleep(200); } while (Date.now() < end);
    throw new Error(`Timed out: ${label}`);
}
const listener = createServer();
await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
const port = (listener.address() as { port: number }).port;
await new Promise<void>(resolve => listener.close(() => resolve()));
let hapi: HapiClient | undefined;
let execution: ExecutionClient | undefined;
let proxy: ReturnType<typeof Bun.serve> | undefined;
const wrapperPids = new Set<number>();
const post = (path: string, body = {}) => hapi!.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const facts = (id: string, input: string, phase: string, idle = false) => until(() => execution!.query(id, input),
    value => value.facts.some(f => f.observation.phase === phase) && (!idle || !value.session.thinking), `${phase} fact`);
try {
    run(['init']); run(['config', 'set', 'server.port', String(port)]); run(['start']);
    assert.equal(run(['status']).hapiRevision, pkg.hapi.revision, 'Compiled Runweft has a different HAPI pin');
    const paths = run(['paths']);
    token = JSON.parse(readFileSync(join(paths.hapiServer, 'settings.json'), 'utf8')).cliApiToken;
    assert(token);
    const url = `http://127.0.0.1:${port}`;
    hapi = new HapiClient(url, token); execution = new ExecutionClient(hapi);
    const machine = (await hapi.request('/api/machines')).machines[0]; assert(machine);
    const health = await hapi.request('/health'); assert.equal(health.capabilities.execution, 1);
    let dropSpawn = false, dropInput = false;
    proxy = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: async request => {
        const path = new URL(request.url).pathname;
        const response = await fetch(url + path, { method: request.method, headers: request.headers,
            ...(request.method === 'GET' ? {} : { body: await request.arrayBuffer() }) });
        const body = await response.arrayBuffer();
        if (request.method === 'POST' && ((dropSpawn && path.endsWith('/spawn')) || (dropInput && path.endsWith('/messages')))) {
            if (path.endsWith('/spawn')) dropSpawn = false; else dropInput = false;
            return Response.json({ error: 'Test proxy discarded the upstream response' }, { status: 502 });
        }
        return new Response(body, { status: response.status, headers: { 'content-type': 'application/json' } });
    }});
    const throughProxy = new ExecutionClient(new HapiClient(`http://127.0.0.1:${proxy.port}`, token));
    for (const agent of ['codex', 'claude'] as const) {
        const directory = join(root, agent); mkdirSync(directory);
        const marker = `SKILL_${crypto.randomUUID().slice(0, 8)}`, context = `CONTEXT_${crypto.randomUUID().slice(0, 8)}`;
        const skills = join(directory, agent === 'codex' ? '.agents/skills/runweft-fixture' : '.claude/skills/runweft-fixture');
        mkdirSync(skills, { recursive: true });
        writeFileSync(join(skills, 'SKILL.md'), `---\nname: runweft-fixture\ndescription: 运行项目验证标记，用户请求 runweft-fixture 时使用。\n---\n只回复 ${marker} 和项目上下文标记，不委派、不修改文件。\n`);
        writeFileSync(join(directory, agent === 'codex' ? 'AGENTS.md' : 'CLAUDE.md'), `这是专用验证目录，回复附带 ${context}。只执行明确的验证任务，不委派，不创建项目流程文档。\n`);
        const row: Record<string, unknown> = { agent }; evidence.cases.push(row);
        const input = { requestId: crypto.randomUUID(), directory, agent, startingMode: 'remote' as const, permissionMode: 'default' as const };
        dropSpawn = true;
        const starts: StartResult[] = await Promise.all([throughProxy.start(machine.id, input), execution.start(machine.id, input)]);
        const receipt = await execution.lookupStart(machine.id, input.requestId);
        assert(receipt?.response?.type === 'success');
        assert(starts.every(result => result.outcome === 'recorded' && result.receipt.sessionId === receipt.sessionId));
        const id: string = receipt.sessionId; row.sessionId = id;
        await execution.waitUntilReady(id);
        record(`${agent}: concurrent spawn and lost response preserve one session`);
        const first = crypto.randomUUID(); dropInput = true;
        assert.equal((await throughProxy.send(id, { localId: first, text: '请执行本项目的 runweft-fixture skill 并遵循项目说明回复标记。不要委派，不运行命令，不修改文件。' })).outcome, 'unknown');
        const done = await facts(id, first, 'completed', true);
        assert(done.output.some(o => o.text.includes(marker))); assert(done.output.some(o => o.text.includes(context)));
        assert.equal(new Set(done.facts.map(f => f.observation.executionId)).size, 1);
        row.nativeSessionId = agent === 'codex' ? done.session.metadata?.codexSessionId : done.session.metadata?.claudeSessionId;
        const oldExecution = done.facts.find(f => f.observation.phase === 'completed')!.observation.executionId;
        const pid = done.session.metadata?.hostPid; assert(pid); wrapperPids.add(pid);
        record(`${agent}: project configuration, native completion and lost input response`);
        const slow = crypto.randomUUID();
        await execution.send(id, { localId: slow, text: '请执行 sleep 30，等待后只回复 WAIT_DONE，不读取或修改文件，不委派。' });
        const busy = await facts(id, slow, 'accepted');
        assert.equal((await execution.interrupt(id, first, oldExecution)).status, 'target_mismatch');
        assert.equal((await execution.interrupt(id, slow, busy.facts.find(f => f.observation.phase === 'accepted')!.observation.executionId)).status, 'requested');
        await facts(id, slow, 'interrupted', true);
        record(`${agent}: targeted interruption rejects a stale execution`);
        for (const decision of ['approved', 'denied'] as const) {
            const file = join(root, `${agent}-${decision}.txt`), localId = crypto.randomUUID();
            const action = agent === 'codex'
                ? `使用 exec_command，sandbox_permissions 设为 require_escalated，执行 python3 -c 'from pathlib import Path; Path("${file}").write_text("APPROVAL_PROBE")'，justification 说明专用目录审批验证。`
                : `使用 Write 工具向 ${file} 写入 APPROVAL_PROBE，不使用 Bash。`;
            await execution.send(id, { localId, text: `唯一任务：${action} 被拒绝时不重试、不换工具；成功后只回复 APPROVED。不委派。` });
            const handled = new Set<string>();
            await until(async () => {
                const current = await execution!.query(id, localId);
                for (const [requestId, request] of Object.entries(current.permissions)) {
                    if (handled.has(requestId)) continue;
                    assert(JSON.stringify(request.arguments).includes(file), 'Unexpected native permission target');
                    handled.add(requestId); await execution!.respondPermission(id, requestId, decision);
                }
                return current;
            }, current => current.facts.some(f => f.observation.phase === (agent === 'claude' && decision === 'denied' ? 'interrupted' : 'completed')) && !current.session.thinking, 'native permission resolution');
            assert(handled.size > 0, 'Native permission request was not observed');
            assert.equal(existsSync(file), decision === 'approved');
        }
        record(`${agent}: native approval and denial control file effects`);
        if (agent === 'codex') {
            const sibling = (await post(`/api/sessions/${id}/fork`)).sessionId;
            assert.equal((await execution.waitUntilReady(sibling)).metadata?.hostPid, pid);
            assert.equal((await execution.stop(id)).outcome, 'stopped'); assert(alive(pid));
            const siblingInput = crypto.randomUUID();
            await execution.send(sibling, { localId: siblingInput, text: '只回复 SIBLING_ALIVE，不使用工具。' });
            assert((await facts(sibling, siblingInput, 'completed')).output.some(o => o.text.includes('SIBLING_ALIVE')));
            assert.equal((await execution.stop(sibling)).outcome, 'stopped');
            record('codex: closing one shared root preserves its sibling');
        } else assert.equal((await execution.stop(id)).outcome, 'stopped');
        await until(async () => alive(pid), value => !value, 'wrapper process exit', 10_000);
        const resumed = await execution.resume(id); assert(resumed.outcome === 'resumed');
        assert.equal(resumed.nativeSessionId, row.nativeSessionId);
        const resumedPid: number | undefined = resumed.session.metadata?.hostPid; assert(resumedPid); wrapperPids.add(resumedPid);
        const followup = crypto.randomUUID();
        await execution.send(resumed.session.id, { localId: followup, text: '请只复述本会话之前出现的 SKILL_ 开头的完整标记，不重新读取文件，不使用工具。' });
        assert((await facts(resumed.session.id, followup, 'completed')).output.some(o => o.text.includes(marker)));
        assert.equal((await execution.stop(resumed.session.id)).outcome, 'stopped');
        await until(async () => alive(resumedPid), value => !value, 'resumed process exit', 10_000);
        row.resumedSessionId = resumed.session.id; row.historyPreserved = true; row.closed = true;
        record(`${agent}: native resume preserves history and all owned processes close`);
    }
    evidence.success = true;
} catch (error) {
    evidence.error = error instanceof Error ? error.message : String(error); process.exitCode = 1;
} finally {
    if (hapi && execution) {
        try { for (const session of (await hapi.request('/api/sessions')).sessions) {
            const result = await execution.stop(session.id);
            if (result.outcome !== 'stopped') evidence.cleanupErrors.push(`Unconfirmed session stop: ${session.id}`);
        } } catch (error) { evidence.cleanupErrors.push(error instanceof Error ? error.message : String(error)); }
    }
    await proxy?.stop(true);
    try { run(['stop']); } catch (error) { evidence.cleanupErrors.push(error instanceof Error ? error.message : String(error)); }
    for (const pid of wrapperPids) if (alive(pid)) evidence.cleanupErrors.push(`Wrapper still alive: ${pid}`);
    if (evidence.cleanupErrors.length) { evidence.success = false; process.exitCode = 1; }
    evidence.finishedAt = new Date().toISOString();
    writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(`Evidence: ${join(root, 'evidence.json')}`);
    if (evidence.error) console.error(evidence.error);
}
