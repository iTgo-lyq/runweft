import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { TaskStore } from '../src/tasks/store';
import { Database } from 'bun:sqlite';
import { HapiClient } from '../src/hapi';
import { getSessionTitle } from '../hapi/web/src/lib/sessionTitle';
import { OverviewQuerySchema, taskOverview } from '../src/tasks/query';
import type { TaskBundle } from '../src/tasks/types';
import type { MachineView } from '../src/resources/types';
import { chromium } from 'playwright';

// No models: real history is read-only; active/failed states exist only in this browser fixture.
const binary = resolve(process.argv[2] ?? 'dist/runweft'), hapiBinary = resolve(process.argv[3] ?? 'dist/hapi');
const sources = process.argv.slice(4);
assert(sources.length, 'Supply completed remote-collaboration evidence files');
mkdirSync('.dev-smoke', { recursive: true });
const root = mkdtempSync(resolve('.dev-smoke/dashboard-')), home = join(root, 'home');
const nonce = crypto.randomUUID(), control = `/__dashboard_smoke/${nonce}`;
const evidence: any = { root, pid: process.pid, binary, sourceFixtures: sources, fixtureStates: 'synthetic browser states plus completed native history', success: false, cleanupErrors: [] };
const bundles: TaskBundle[] = [];
let nativeHistorySource: string | undefined;
for (const source of sources) {
    const previous = JSON.parse(readFileSync(resolve(source), 'utf8')); assert(previous.success && previous.remote);
    nativeHistorySource ??= join(previous.root, 'local/server/hapi/hapi.db');
    const store = new TaskStore(join(previous.root, 'local/server/runweft/state.sqlite'));
    try { for (const item of previous.cases) {
        const bundle = store.require('default', item.first.agent_id);
        assert(bundle.rounds.every(round => round.phase === 'finished' && round.stop === 'stopped'));
        bundles.push(bundle);
    } } finally { store.close(); }
}
assert(bundles.length);
// SQLite serialization includes committed WAL pages and never writes the original acceptance database.
mkdirSync(join(home, 'server/hapi'), { recursive: true, mode: 0o700 });
const history = new Database(nativeHistorySource!, { readonly: true });
try { writeFileSync(join(home, 'server/hapi/hapi.db'), history.serialize(), { mode: 0o600 }); }
finally { history.close(); }
const retainedSessionId = bundles[0].rounds.at(-1)!.sessionId!;
for (let i = 0; i < 60; i++) {
    const bundle = structuredClone(bundles[0]), round = bundle.rounds.at(-1)!;
    bundle.task.id = crypto.randomUUID(); bundle.task.updatedAt = Date.now() + i;
    bundle.task.parent = { kind: 'mcp', host: 'codex', machineId: bundle.task.parent.machineId, cwd: `/dashboard/${i % 2 ? 'beta' : 'alpha'}`,
        nativeSessionId: `native-parent-${i}`, ...(i === 0 ? { hapiSessionId: 'parent-fixture' } : {}) };
    bundle.task.agent.definition.name = i === 0 ? 'Browser safety <img onerror=alert(1)>' : `Review ${i}`;
    bundle.task.environment.cwd = `/synthetic/worktree-${i}`;
    round.attention = null; round.report = '<img src=x onerror="window.dashboardInjected=true">\nFixture summary';
    round.observedAt = Date.now(); delete round.cancellation; delete round.startupFailure; delete round.executionAbsent;
    if (i % 6 < 3) {
        round.phase = i % 6 === 0 ? 'preparing' : 'running'; round.stop = 'not_started'; round.finish = 'pending';
        if (i % 6 === 1) round.attention = { code: 'permission_required', stage: 'input', message: '审批待处理' };
        if (i % 6 === 2) round.attention = { code: 'execution_unknown', stage: 'observe', message: '执行状态未知' };
    } else {
        round.phase = i % 6 === 4 ? 'failed' : 'finished'; round.stop = 'stopped'; round.finish = 'complete';
        if (i % 6 === 5) round.cancellation = { requestedAt: 1, confirmed: true };
    }
    if (i === 0) {
        bundle.task.environment = { mode: 'shared', machineId: bundle.task.target.machineId, cwd: '/synthetic/shared' };
        delete round.outputFiles; delete round.sessionId;
    }
    bundles.push(bundle);
}
const machines: MachineView[] = [...new Set(bundles.map(bundle => bundle.task.target.machineId))].map(id => ({
    id, name: 'Browser fixture machine', host: 'fixture', platform: 'test', online: true, lastActiveAt: Date.now(), registered: true, registration: null, eligibility: { eligible: true, reason: null },
}));
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_')) delete env[key];
const cli = (args: string[]) => {
    const result = spawnSync(binary, ['--home', home, '--json', ...args], { env, encoding: 'utf8', timeout: 60_000 });
    assert.equal(result.status, 0, result.stderr || String(result.error)); return JSON.parse(result.stdout);
};
const listener = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('reserved') });
const port = listener.port!; listener.stop(true);
let proxy: ReturnType<typeof Bun.serve> | undefined;
let stopped = false;
function cleanup() {
    if (stopped) return; stopped = true;
    try { cli(['stop']); } catch (error) { evidence.cleanupErrors.push(String(error)); }
    proxy?.stop(true);
    writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
}
try {
    cli(['init']); cli(['config', 'set', 'server.port', String(port)]); cli(['config', 'set', 'server.runner', 'false']); cli(['config', 'set', 'hapi.executable', hapiBinary]);
    const started = cli(['start']); assert.equal(started.runner, false);
    const token = JSON.parse(readFileSync(join(home, 'server/hapi/settings.json'), 'utf8')).cliApiToken;
    const upstream = `http://127.0.0.1:${port}`;
    const api = new HapiClient(upstream, token);
    const retainedSession = (await api.request(`/api/sessions/${retainedSessionId}`)).session;
    assert.equal(retainedSession.active, false); assert.equal(retainedSession.metadata.lifecycleState, 'archived');
    const initialSessions = (await api.request('/api/sessions')).sessions.map((session: any) => session.id).sort();
    evidence.nativeHistory = { sessionId: retainedSessionId, sessionCount: initialSessions.length, copied: true };
    let unavailable = false, expireOnce = false, authRejected = false, empty = false, offline = false, authCalls = 0, readCalls = 0, sessionReads = 0;
    const javascript = new Bun.Transpiler({ loader: 'ts', target: 'browser' }).transformSync(await Bun.file(join(import.meta.dir, 'dashboard-browser.ts')).text());
    proxy = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
        const url = new URL(request.url), path = url.pathname;
        const json = (value: unknown) => Response.json(value, { headers: { 'cache-control': 'no-store' } });
        if (path === control) return new Response(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Runweft 自动浏览器验收</title><h1>Runweft 自动浏览器验收</h1><p id="progress">等待检查…</p><iframe title="Runweft 测试页面" width="1200" height="900"></iframe><script type="module" src="${control}/driver.js"></script></html>`, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
        if (path === control + '/driver.js') return new Response(javascript, { headers: { 'content-type': 'text/javascript', 'cache-control': 'no-store' } });
        if (path === control + '/config') return json({ token, control, taskCount: bundles.length, realTaskCount: bundles.length - 60,
            retainedSessionId, retainedSessionTitle: getSessionTitle(retainedSession) });
        if (path === control + '/state') {
            if (request.method === 'POST') {
                const values = await request.json() as Record<string, boolean>;
                unavailable = values.unavailable ?? unavailable; expireOnce = values.expireOnce ?? expireOnce;
                authRejected = values.authRejected ?? authRejected; empty = values.empty ?? empty; offline = values.offline ?? offline;
            }
            return json({ authCalls, readCalls, sessionReads });
        }
        if (path === control + '/result' && request.method === 'POST') {
            const browser = await request.json() as { success: boolean };
            assert.deepEqual((await api.request('/api/sessions')).sessions.map((session: any) => session.id).sort(), initialSessions);
            evidence.browser = browser; evidence.success = browser.success;
            writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
            console.log(`Browser result received: success=${browser.success}`); return json({ ok: true });
        }
        if (path === '/api/auth') {
            authCalls++;
            if (authRejected) return Response.json({ error: 'synthetic authentication failure' }, { status: 401 });
        }
        if (path === `/api/sessions/${retainedSessionId}`) sessionReads++;
        const headers = new Headers(request.headers); headers.delete('host'); headers.delete('origin');
        // Bun fetch decodes upstream compression; keep this test proxy's body and headers consistent.
        headers.set('accept-encoding', 'identity');
        if (path === '/api/runweft/tasks/overview') {
            readCalls++;
            if (unavailable) return new Response('', { status: 503 });
            if (expireOnce) { expireOnce = false; return new Response('', { status: 401 }); }
            const identity = await fetch(`${upstream}/api/runweft/identity`, { headers });
            if (!identity.ok) return identity;
            for (const machine of machines) machine.online = !offline;
            const query = OverviewQuerySchema.parse(Object.fromEntries(url.searchParams));
            return json({ namespace: 'default', ...taskOverview(empty ? [] : bundles, [], { machines, error: null }, query) });
        }
        return fetch(upstream + path + url.search, { method: request.method, headers,
            body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(), redirect: 'manual' });
    } });
    const address = proxy.url.origin + control;
    evidence.url = address; evidence.upstream = upstream;
    writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
    writeFileSync('.dev-smoke/dashboard-current.json', JSON.stringify({ root, url: address }, null, 2));
    console.log(`Browser acceptance URL: ${address}\nEvidence: ${join(root, 'evidence.json')}`);
    const browser = await chromium.launch({ headless: true, executablePath: process.env.RUNWEFT_SMOKE_CHROMIUM });
    try {
        const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
        const page = await context.newPage();
        evidence.pageErrors = [];
        evidence.http = [];
        page.on('pageerror', error => evidence.pageErrors.push(error.message.replaceAll(token, '[redacted]')));
        page.on('requestfailed', request => evidence.http.push({ path: new URL(request.url()).pathname, failed: request.failure()?.errorText }));
        page.on('response', response => {
            const path = new URL(response.url()).pathname;
            if (path.startsWith('/api/')) evidence.http.push({ path, status: response.status() });
        });
        await page.goto(address);
        await page.waitForFunction(() => document.getElementById('progress')?.textContent?.startsWith('自动验收'), null, { timeout: 120_000 });
        await page.screenshot({ path: join(root, 'driver.png') });
        assert(evidence.browser?.success, JSON.stringify(evidence.browser?.failures ?? evidence.pageErrors));
        assert.deepEqual(evidence.pageErrors, []);
        const dashboard = await context.newPage();
        await dashboard.goto(proxy.url.origin + '/runweft/');
        await dashboard.locator('.task').first().waitFor();
        for (const width of [1200, 375]) {
            await dashboard.setViewportSize({ width, height: 900 });
            await dashboard.locator('.task summary').first().click();
            await dashboard.screenshot({ path: join(root, `dashboard-${width}.png`) });
        }
        evidence.playwright = { browser: browser.version(), screenshots: ['dashboard-1200.png', 'dashboard-375.png'] };
    } finally { await browser.close(); }
} catch (error) {
    evidence.success = false; evidence.error = String(error); console.error(evidence.error);
} finally { cleanup(); }
if (!evidence.success || evidence.cleanupErrors.length) process.exitCode = 1;
