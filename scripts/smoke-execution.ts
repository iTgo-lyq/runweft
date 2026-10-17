import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ExecutionClient, type StartResult } from '../src/execution';
import type { HapiHttp } from '../src/hapi';
import { nativeUserSmoke } from './fixtures/native-user-smoke';
import { modelHomes } from './fixtures/model-homes';
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
function record(check: string) { evidence.checks.push(check); console.log(`PASS ${check}`); }
function alive(pid: number) { try { process.kill(pid, 0); return true; } catch { return false; } }
async function until<T>(read: () => Promise<T>, accept: (value: T) => boolean, label: string, timeout = 90_000): Promise<T> {
    const end = Date.now() + timeout;
    do { const value = await read(); if (accept(value)) return value; await Bun.sleep(200); } while (Date.now() < end);
    throw new Error(`Timed out: ${label}`);
}
let hapi: HapiHttp | undefined;
let fixture: Awaited<ReturnType<typeof nativeUserSmoke>> | undefined, models: ReturnType<typeof modelHomes> | undefined;
let execution: ExecutionClient | undefined;
let proxy: ReturnType<typeof Bun.serve> | undefined;
const wrapperPids = new Set<number>();
const post = (path: string, body = {}) => hapi!.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const facts = (id: string, input: string, phase: string, idle = false) => until(() => execution!.query(id, input),
    value => value.facts.some(f => f.observation.phase === phase) && (!idle || !value.session.thinking), `${phase} fact`);
try {
    models = modelHomes(root, env);
    fixture = await nativeUserSmoke(root, executable, env); Object.assign(evidence, { candidate: fixture.candidate });
    const selected = await fixture.runner(home), machine = { id: selected.machineId }, url = fixture.url;
    hapi = selected.http; execution = new ExecutionClient(hapi);
    const health = await hapi.request('/health'); assert.equal(health.capabilities.execution, 1);
    let dropSpawn = false, dropInput = false;
    proxy = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: async request => {
        const incoming = new URL(request.url), path = incoming.pathname;
        const response = await fetch(url + path + incoming.search, { method: request.method, headers: request.headers,
            ...(request.method === 'GET' ? {} : { body: await request.arrayBuffer() }) });
        const body = await response.arrayBuffer();
        if (request.method === 'POST' && ((dropSpawn && path.endsWith('/spawn')) || (dropInput && path.endsWith('/messages')))) {
            if (path.endsWith('/spawn')) dropSpawn = false; else dropInput = false;
            return Response.json({ error: 'Test proxy discarded the upstream response' }, { status: 502 });
        }
        return new Response(body, { status: response.status, headers: response.headers });
    }});
    const throughProxy = new ExecutionClient(fixture.proxyHttp(`http://127.0.0.1:${proxy.port}`));
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
    models.verify(); Object.assign(evidence, { sourceModelConfigurationUnchanged: true, ownedNativeHostPids: [...wrapperPids] }); evidence.success = true;
} catch (error) {
    evidence.error = error instanceof Error ? error instanceof AggregateError ? error.errors.map(String).join('; ') : error.message : String(error); process.exitCode = 1;
} finally {
    const modelPids = new Set<number>();
    let modelShutdownConfirmed = true;
    if (hapi && execution) {
        try { for (const session of (await hapi.request('/api/sessions')).sessions) {
            if (session.metadata?.hostPid) modelPids.add(session.metadata.hostPid);
            try { const result = await execution.stop(session.id);
            if (result.outcome !== 'stopped') { modelShutdownConfirmed = false; evidence.cleanupErrors.push(`Unconfirmed session stop: ${session.id}`); }
            } catch (error) { modelShutdownConfirmed = false; evidence.cleanupErrors.push(String(error)); }
        } } catch (error) { modelShutdownConfirmed = false; evidence.cleanupErrors.push(error instanceof Error ? error instanceof AggregateError ? error.errors.map(String).join('; ') : error.message : String(error)); }
    }
    try { await proxy?.stop(true); } catch (error) { evidence.cleanupErrors.push(String(error)); }
    for (const pid of wrapperPids) modelPids.add(pid);
    try { await fixture?.close(false); } catch (error) { modelShutdownConfirmed = false; evidence.cleanupErrors.push(String(error)); }
    try { await models?.waitHosts(modelPids); } catch (error) { modelShutdownConfirmed = false; evidence.cleanupErrors.push(String(error)); }
    if (modelShutdownConfirmed) try { await models?.remove(); } catch (error) { evidence.cleanupErrors.push(String(error)); }
    if (evidence.success && !evidence.cleanupErrors.length) try { await (await import('../test/integration/native-files')).removeFileSmokeData(root); } catch (error) { evidence.cleanupErrors.push(String(error)); }
    if (evidence.cleanupErrors.length) { evidence.success = false; process.exitCode = 1; }
    evidence.finishedAt = new Date().toISOString();
    writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(`Evidence: ${join(root, 'evidence.json')}`);
    if (evidence.error) console.error(evidence.error);
}
