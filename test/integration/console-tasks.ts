import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { decodeJwt } from 'jose';
import { closeSmoke } from '../lifecycle';
import { io, type Socket } from 'socket.io-client';
import type { BrowserContext, Page } from 'playwright';
import { AccessStore } from '../../src/hub/access/store';
import { DelegationScopes, agentSnapshot } from '../../src/hub/delegation/context';
import { TaskStore } from '../../src/tasks/store';
import { hubConnectionPaths } from '../../src/hub/resources/connection';
import { appendFixtureRound } from './fixture-round';

export async function consoleTasks(options: { origin: string; home: string; root: string; page: Page; memberPage: Page; context: BrowserContext;
    identityToken: string; memberToken: string; memberIdentity: string; ownerToken: string; spaceId: string; machineId: string; agentId: string; memberAgentId: string;
    ready(page: Page): Promise<void>; navigate(page: Page, name: string): Promise<void>; screenshot(page: Page, name: string): Promise<void>; check(name: string): void }) {
    const { origin, home, page, memberPage, context, ready, navigate, check } = options;
    const statePath = join(home, 'server/runweft/state.sqlite'), access = new AccessStore(statePath);
    const tasks = new TaskStore(statePath, { db: access.db, ownsScope: () => true, accepted: task => {
        access.bind({ kind: 'task', id: task.id, ownerId: task.hub!.ownerId, spaceId: task.hub!.spaceId, machineId: task.target.machineId });
    } });
    const scopes = new DelegationScopes(access), sockets: Socket[] = [], nativePages: Page[] = [], clockContexts: BrowserContext[] = [];
    const heartbeats: ReturnType<typeof setInterval>[] = [];
    const urls: string[] = [], authBodies: string[] = [], errors: string[] = [];
    const nativeRequests: { path: string; claims: ReturnType<typeof decodeJwt> }[] = [];
    const observed = new Set<Page>(), credentials = new Set([options.identityToken, options.memberIdentity, options.ownerToken, options.memberToken]);
    const machine = JSON.parse(readFileSync(hubConnectionPaths(home, origin).machineConnection, 'utf8'));
    async function api(path: string, token: string, body?: unknown) {
        const response = await fetch(origin + path, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body) });
        const result = await response.json() as any; assert.equal(response.status, 200, `${path}: ${result.error?.code}`); return result;
    }
    async function until(condition: () => Promise<boolean>, label: string) {
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) { if (await condition()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
        throw new Error('Timeout: ' + label);
    }
    async function session(ownerToken: string, identity: string, agentId: string, marker: string, count: number) {
        const actor = access.authenticate(identity, options.spaceId), namespace = scopes.ensure(actor);
        const resolved = (await api('/api/runweft/agent-resolution', ownerToken, { agentId, hubRepositoryId: null })).resolution;
        const snapshot = agentSnapshot(namespace, resolved), parent = { kind: 'cli' as const, machineId: options.machineId, cwd: options.root };
        const sessionId = randomUUID(), nativeId = randomUUID();
        let taskId = '', roundId = '';
        access.db.transaction(() => { for (let index = 0; index < count; index++) {
            const accepted = tasks.accept(namespace, parent, randomUUID(), { agentType: agentId, message: 'Browser fixture only', workspaceMode: 'shared' }, snapshot, resolved.target);
            const bundle = tasks.require(namespace, accepted.agent_id), round = bundle.rounds[0];
            round.phase = 'finished'; round.stop = 'stopped'; round.finish = 'complete'; round.report = `${marker} ${index}\n` + '<img src=x onerror=alert(1)>'.repeat(index === 0 ? 800 : 1);
            if (index === 0) { round.sessionId = sessionId; round.nativeSessionId = nativeId; taskId = accepted.agent_id; roundId = round.id; }
            tasks.save(bundle.task, round, bundle.inputs);
            if (index === 0) {
                appendFixtureRound(tasks, bundle.task, snapshot, { stop: 'stopped', report: marker + '_SECOND_ROUND', sessionId, nativeSessionId: nativeId });
            }
        } }).immediate();
        access.bind({ kind: 'session', id: sessionId, ownerId: actor.ownerId, spaceId: options.spaceId, machineId: options.machineId, taskId });
        await api('/cli/sessions', machine.active.token, { id: sessionId, tag: marker, metadata: { name: marker, path: options.root, host: 'console fixture',
            flavor: 'codex', machineId: options.machineId, codexSessionId: nativeId } });
        const socket = io(origin + '/cli', { auth: { token: machine.active.token, sessionId }, transports: ['websocket'], reconnection: false }); sockets.push(socket);
        await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
        const ping = () => new Promise<void>(resolve => socket.emit('ping', resolve));
        const heartbeat = () => socket.emit('session-alive', { sid: sessionId, time: Date.now(), thinking: false });
        heartbeat(); heartbeats.push(setInterval(heartbeat, 5000)); await ping();
        socket.emit('message', { sid: sessionId, message: { role: 'agent', content: { type: 'codex', data: { type: 'message', message: marker + '_NATIVE_MESSAGE' } } } }); await ping();
        return { id: sessionId, taskId, roundId, namespace, socket, ping };
    }
    function observe(tab: Page) {
        if (observed.has(tab)) return; observed.add(tab);
        nativePages.push(tab); tab.on('pageerror', error => errors.push(error.message));
        tab.on('request', request => {
            try {
            urls.push(request.url()); const path = new URL(request.url()).pathname;
            if (path === '/api/auth') {
                authBodies.push(request.postData() ?? '');
            }
            if (path.startsWith('/api/sessions/') || path === '/api/events') {
                const authorization = request.headers().authorization ?? '';
                assert(authorization.startsWith('Bearer ') && !authorization.includes(options.identityToken) && !authorization.includes(options.memberIdentity));
                credentials.add(authorization.slice(7)); const claims = decodeJwt(authorization.slice(7));
                assert.equal(claims.iss, 'runweft-hub'); assert.equal(claims.aud, 'runweft-access'); assert.equal(claims.kind, 'user');
                assert.equal(claims.space, options.spaceId); assert.equal(claims.exp! - claims.iat!, 900);
                nativeRequests.push({ path, claims });
            }
            } catch { errors.push('Native request authorization boundary failed: ' + new URL(request.url()).pathname); }
        });
    }
    context.on('page', observe);
    async function openNative(files = false) {
        const popup = context.waitForEvent('page');
        await page.getByRole('button', { name: files ? '打开原生文件' : '打开原生详情 / 审批', exact: true }).click();
        const tab = await popup; observe(tab);
        await tab.waitForURL(/\/sessions\//);
        await tab.getByRole('link', { name: /返回 Runweft Hub/ }).waitFor(); await ready(page); return tab;
    }
    try {
        const owner = await session(options.ownerToken, options.identityToken, options.agentId, 'OWNER_CONSOLE_HISTORY', 27);
        const other = await session(options.memberToken, options.memberIdentity, options.memberAgentId, 'MEMBER_ONLY_HISTORY', 1);
        await navigate(page, '任务'); assert.match(await page.locator('.task-list').innerText(), /你的任务 27 个/);
        assert(!(await page.locator('.task-list').innerText()).includes('MEMBER_ONLY_HISTORY'));
        await page.route(origin + '/api/runweft/tasks/overview*', async route => {
            const response = await route.fetch(), view = await response.json(); assert(view.items.length >= 3);
            Object.assign(view.items[0], { status: 'unknown', stop: 'not_started', execution_not_started: false, summary: '<img src=x onerror=alert(1)>', attention: { message: '<img src=x>执行状态未知' } });
            view.items[0].agent.name = '<img src=x>Agent'; view.items[0].code.status = 'unknown';
            Object.assign(view.items[1], { stop: 'not_started', execution_not_started: true }); view.items[1].code.status = 'not_applicable'; view.items[1].files.status = 'none';
            Object.assign(view.items[2].files, { status: 'delivered', retention: 'released', available: 1, count: 1 });
            await route.fulfill({ response, json: view });
        }, { times: 1 });
        await page.getByRole('button', { name: '刷新任务列表' }).click(); await ready(page);
        const projection = await page.locator('.task-list').innerText();
        for (const label of ['执行未确认', '尚未确认进程结束', '已确认未启动', '不适用', '未声明', '已释放', '<img src=x>Agent']) assert(projection.includes(label));
        assert.equal(await page.locator('.task-list img').count(), 0);
        await page.getByRole('button', { name: '刷新任务列表' }).click(); await ready(page);
        check('authorized current overview DOM projections distinguish uncertain/absent/stopped execution and delivery retention; names, summary and attention are text only');

        await page.getByRole('button', { name: '下一页任务' }).click(); await ready(page);
        assert.equal(await page.locator('[data-task-id]').count(), 2);
        await page.getByRole('button', { name: '上一页任务' }).click(); await ready(page);
        await page.getByLabel('来源工作目录筛选').fill('does-not-match');
        await page.getByRole('button', { name: '应用筛选' }).click(); await ready(page);
        assert.match(await page.locator('.task-list').innerText(), /你的任务 0 个/); assert.match(await page.locator('.task-list').innerText(), /调整筛选/);
        await page.getByLabel('来源工作目录筛选').fill(''); await page.getByLabel('每页任务数').selectOption('50');
        await page.getByRole('button', { name: '应用筛选' }).click(); await ready(page);
        await page.getByLabel('来源工作目录筛选').fill(options.root);
        await page.getByLabel('主宿主筛选').fill('cli'); await page.getByLabel('任务状态').selectOption('completed');
        await page.getByRole('button', { name: '应用筛选' }).click(); await ready(page);
        assert.match(await page.locator('.task-list').innerText(), /你的任务 27 个/);
        const overviewRoute = origin + '/api/runweft/tasks/overview*';
        await page.route(overviewRoute, route => route.fulfill({ status: 503, json: { error: { message: '读取暂不可用 <img src=x>' } } }), { times: 1 });
        const priorList = await page.locator('.task-list').innerText();
        await page.getByRole('button', { name: '刷新任务列表' }).click(); await ready(page);
        assert.equal(await page.locator('.task-list').innerText(), priorList);
        assert.match(await page.locator('#notice').innerText(), /读取暂不可用/); assert.equal(await page.locator('#notice img').count(), 0);
        await page.getByRole('button', { name: '刷新任务列表' }).click(); await ready(page); assert.equal(await page.locator('#notice').innerText(), '');
        let releaseRead!: () => void; const delayed = new Promise<void>(resolve => { releaseRead = resolve; });
        let calls = 0;
        await page.route(overviewRoute, async route => { calls++; await delayed; await route.continue(); }, { times: 1 });
        await page.getByRole('button', { name: '刷新任务列表' }).click();
        await until(async () => calls === 1, 'delayed overview request');
        assert(await page.getByRole('button', { name: '应用筛选' }).isDisabled());
        await page.getByRole('button', { name: '刷新任务列表' }).evaluate(node => { (node as HTMLButtonElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); });
        assert.equal(calls, 1); releaseRead(); await ready(page);
        await page.route(overviewRoute, route => route.fulfill({ status: 503, json: { error: { message: '全局刷新暂不可用' } } }), { times: 1 });
        const beforeGlobal = await page.locator('.task-list').innerText();
        await page.locator('#refresh').click(); await ready(page);
        assert.equal(await page.locator('.task-list').innerText(), beforeGlobal); assert.match(await page.locator('#notice').innerText(), /全局刷新暂不可用/);
        await page.locator('#refresh').click(); await ready(page); assert.equal(await page.locator('#notice').innerText(), '');
        check('combined current filters, escaped local/global 503 retain prior data and recovery clears error; busy action suppresses duplicate reads');
        await page.getByLabel('每页任务数').selectOption('50'); await page.getByRole('button', { name: '应用筛选' }).click(); await ready(page);
        await page.locator(`[data-task-id="${owner.taskId}"]`).getByRole('button', { name: '查看任务详情' }).click(); await ready(page);
        assert.match(await page.locator('.task-report').first().innerText(), /SECOND_ROUND/);
        await page.getByLabel('查看轮次').selectOption(owner.roundId); await ready(page);
        assert.match(await page.locator('.task-report').first().innerText(), /<img src=x/);
        assert.equal(await page.locator('.task-report img').count(), 0);
        await page.getByRole('button', { name: '下一段报告' }).click(); await ready(page);
        assert.match(await page.locator('.task-detail').innerText(), /16000–/);
        await page.getByRole('button', { name: '上一段报告' }).click(); await ready(page);
        const inspection = page.locator('.task-detail details').first(); await inspection.locator('summary').click();
        const previousReport = await page.locator('.task-report').first().innerText();
        const detailRoute = origin + `/api/runweft/tasks/details/${owner.taskId}*`;
        await page.route(detailRoute, route => route.fulfill({ status: 503, json: { error: { message: '详情暂不可用' } } }), { times: 1 });
        await page.getByRole('button', { name: '刷新任务详情' }).click(); await ready(page);
        assert.equal(await page.locator('.task-report').first().innerText(), previousReport); assert.match(await page.locator('#notice').innerText(), /详情暂不可用/);
        await page.getByRole('button', { name: '刷新任务详情' }).click(); await ready(page);
        assert.equal(await page.locator('.task-report').first().innerText(), previousReport); assert.equal(await page.getByLabel('查看轮次').inputValue(), owner.roundId);
        assert(await inspection.evaluate(node => (node as HTMLDetailsElement).open)); assert.equal(await page.locator('#notice').innerText(), '');
        for (const width of [375, 1200]) {
            await page.setViewportSize({ width, height: 900 });
            await page.locator('.task-detail details').first().evaluate(node => { (node as HTMLDetailsElement).open = true; });
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
            await page.locator('.task-detail summary').first().focus();
            await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
            assert.notEqual(await page.locator('.task-detail summary').first().evaluate(node => getComputedStyle(node).outlineStyle), 'none');
            await options.screenshot(page, `tasks-detail-${width}`);
        }
        await navigate(memberPage, '任务'); assert.match(await memberPage.locator('.task-list').innerText(), /你的任务 1 个/);
        check('task inventory and count isolate identities; filtering, pagination, full report paging and escaped content');
        await page.evaluate(() => localStorage.setItem('hapi-lang', 'zh-CN'));
        const native = await openNative();
        await native.getByText('OWNER_CONSOLE_HISTORY_NATIVE_MESSAGE', { exact: true }).waitFor({ timeout: 20000 });
        assert.equal(await native.evaluate(() => sessionStorage.getItem('runweft.hub.identity')), null);
        assert.equal(await native.evaluate(() => opener), null);
        assert.equal(await native.evaluate(() => localStorage.getItem('hapi-lang')), 'zh-CN');
        assert.equal(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('hapi_access_token::')).length), 0);
        await native.reload(); await native.getByText('OWNER_CONSOLE_HISTORY_NATIVE_MESSAGE', { exact: true }).waitFor();
        const eventsBefore = urls.filter(url => new URL(url).pathname === '/api/events').length;
        assert(eventsBefore > 0); assert(urls.every(url => !new URL(url).searchParams.has('token')));
        owner.socket.emit('message', { sid: owner.id, message: { role: 'agent', content: { type: 'codex', data: { type: 'message', message: 'LIVE_HEADER_SSE_MESSAGE' } } } }); await owner.ping();
        await native.getByText('LIVE_HEADER_SSE_MESSAGE', { exact: true }).waitFor();
        assert(nativeRequests.some(item => item.path === '/api/events')); assert(nativeRequests.some(item => item.path === `/api/sessions/${owner.id}`));
        assert(authBodies.length > 0); assert(authBodies.every(body => !body.includes(options.identityToken) && JSON.parse(body).accessToken.includes('.')));
        check('real HAPI history loads and refreshes through scoped tab JWT; live SSE uses authorization header, never URL or localStorage');
        const nativeSession = (await api(`/api/sessions/${owner.id}`, options.ownerToken)).session;
        const permissionId = randomUUID();
        await new Promise<void>(resolve => owner.socket.emit('update-state', { sid: owner.id, expectedVersion: nativeSession.agentStateVersion,
            agentState: { requests: { [permissionId]: { tool: 'Bash', arguments: { command: 'printf console-approval' }, createdAt: Date.now() } } } }, () => resolve()));
        let approved = false;
        owner.socket.on('rpc-request', (data, acknowledge) => {
            const method = data.method.slice(owner.id.length + 1);
            if (method === 'permission') { const request = JSON.parse(data.params); approved = request.id === permissionId && request.approved === true; acknowledge(JSON.stringify({ success: true })); }
            else if (method === 'readFile') acknowledge(JSON.stringify({ success: true, content: Buffer.from('CONSOLE_FILE_BYTES').toString('base64') }));
            else acknowledge(JSON.stringify({ success: true, stdout: '', stderr: '', exitCode: 0 }));
        });
        for (const method of ['permission', 'git-status', 'git-diff-numstat', 'git-diff-file', 'readFile']) owner.socket.emit('rpc-register', { method: `${owner.id}:${method}` });
        await owner.ping();
        await until(async () => (await api(`/api/sessions/${owner.id}`, options.ownerToken)).session.active === true, 'approval fixture heartbeat');
        await native.getByRole('button', { name: /允许一次|Allow once|^允许$|^Allow$|^是$|^Yes$/ }).first().click({ timeout: 15000 });
        await until(async () => approved, 'native approval RPC');
        await options.screenshot(native, 'native-detail-desktop');
        const files = await openNative(true);
        await files.getByText(/变更|Changes/).first().waitFor();
        await files.goto(`${origin}/sessions/${owner.id}/file?path=console.txt`);
        await files.getByText('CONSOLE_FILE_BYTES', { exact: false }).first().waitFor({ timeout: 15000 });
        await options.screenshot(files, 'native-file-desktop');
        check('native approval and file deep links use same identity with real HAPI and a declared session RPC fixture, no model or OS shell');
        await memberPage.locator(`[data-task-id="${other.taskId}"]`).getByRole('button', { name: '查看任务详情' }).click(); await ready(memberPage);
        const memberPopup = memberPage.waitForEvent('popup');
        await memberPage.getByRole('button', { name: '打开原生详情 / 审批' }).click();
        const memberNative = await memberPopup; observe(memberNative);
        await memberNative.getByText('MEMBER_ONLY_HISTORY_NATIVE_MESSAGE', { exact: true }).waitFor();
        await native.reload(); await native.getByText('OWNER_CONSOLE_HISTORY_NATIVE_MESSAGE', { exact: true }).waitFor();
        assert(!(await native.locator('body').innerText()).includes('MEMBER_ONLY_HISTORY'));
        const denied = await memberNative.evaluate(async id => (await fetch(`/api/sessions/${id}`, { headers: { authorization: `Bearer ${sessionStorage.getItem('runweft.native.access')}` } })).status, owner.id);
        assert.equal(denied, 404);
        const controlled = await native.evaluate(async id => (await fetch(`/api/sessions/${id}/resume`, { method: 'POST',
            headers: { authorization: `Bearer ${sessionStorage.getItem('runweft.native.access')}`, 'content-type': 'application/json' }, body: '{}' })).status, owner.id);
        assert.equal(controlled, 409);
        assert.equal((await fetch(`${origin}/sessions/${owner.id}/terminal`)).status, 403);
        const viewer = io(origin + '/terminal', { auth: { token: options.memberToken }, transports: ['websocket'], reconnection: false }); sockets.push(viewer);
        await new Promise<void>((resolve, reject) => { viewer.once('connect', resolve); viewer.once('connect_error', reject); });
        const terminalDenied = new Promise<any>(resolve => viewer.once('error', resolve));
        viewer.emit('terminal:create', { sessionId: other.id, terminalId: 'forbidden-shell', cols: 80, rows: 24 });
        assert.equal((await terminalDenied).code, 'access-denied');
        const previousMemberJwt = await memberNative.evaluate(() => sessionStorage.getItem('runweft.native.access'));
        await memberPage.locator('#rotate-token').click(); await memberPage.locator('#secret-dialog[open]').waitFor();
        const replacement = await memberPage.locator('#secret-value').innerText(); credentials.add(replacement);
        await memberPage.locator('#apply-rotation').click(); await ready(memberPage); await memberPage.locator('#close-secret').click();
        assert.equal((await fetch(origin + '/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accessToken: options.memberIdentity, spaceId: options.spaceId }) })).status, 401);
        assert.equal((await fetch(origin + `/api/sessions/${other.id}`, { headers: { authorization: `Bearer ${previousMemberJwt}` } })).status, 401);
        // Actual rotation redirects the native tab. Do not create an unauthenticated EventSource on the new Hub page.
        await memberNative.waitForURL(/\/hub#native-expired/);
        assert(await memberNative.evaluate(() => sessionStorage.getItem('runweft.native.access') === null), 'Revoked native credential must clear');
        assert.equal((await fetch(origin + `/api/sessions/${owner.id}`, { headers: { authorization: `Bearer ${options.ownerToken}` } })).status, 200);
        await navigate(memberPage, '任务');
        await memberPage.locator(`[data-task-id="${other.taskId}"]`).getByRole('button', { name: '查看任务详情' }).click(); await ready(memberPage);
        const renewedPopup = context.waitForEvent('page'); await memberPage.getByRole('button', { name: '打开原生详情 / 审批' }).click();
        const renewed = await renewedPopup; await renewed.getByText('MEMBER_ONLY_HISTORY_NATIVE_MESSAGE', { exact: true }).waitFor();
        assert((await renewed.evaluate(() => sessionStorage.getItem('runweft.native.access'))) !== previousMemberJwt, 'Explicit reopen must issue a new credential');
        assert(JSON.parse(await memberPage.evaluate(() => sessionStorage.getItem('runweft.hub.identity')) as string).token === replacement, 'Member identity rotation must persist');
        check('actual identity rotation rejects old long token and native JWT, expired SSE clears tab credential; independent owner remains authorized and explicit reopen gets new scope token');
        const emptySpace = (await api('/api/runweft/hub/spaces', options.identityToken, { name: 'T7 empty scope' })).space;
        const scopeReads: string[] = [];
        const observeScope = (request: import('playwright').Request) => {
            if (new URL(request.url()).pathname === '/api/runweft/tasks/overview') scopeReads.push(String(decodeJwt(request.headers().authorization.slice(7)).space));
        };
        page.on('request', observeScope);
        await page.locator('#refresh').click(); await ready(page);
        await page.locator('#spaces button').filter({ hasText: 'T7 empty scope' }).click(); await ready(page);
        assert.equal(await page.locator('#space-id').innerText(), emptySpace.id);
        assert.match(await page.locator('.task-list').innerText(), /你的任务 0 个/); assert.match(await page.locator('.task-list').innerText(), /首次委派/);
        assert(!(await page.locator('#console-content').innerText()).includes('OWNER_CONSOLE_HISTORY'));
        assert.equal(scopeReads.at(-1), emptySpace.id);
        await page.locator('#spaces button').filter({ hasText: '后台验收' }).click(); await ready(page);
        assert.equal(await page.locator('#space-id').innerText(), options.spaceId); assert.equal(scopeReads.at(-1), options.spaceId);
        assert.match(await page.locator('.task-list').innerText(), /你的任务 27 个/);
        page.off('request', observeScope);
        check('actual empty owner space differs from no-match filter; space switch clears prior view and JWT cache never reuses another scope');
        for (const failure of [false, true]) {
            await page.reload(); await ready(page); await navigate(page, '任务');
            let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; }); let arrived = false;
            const routePattern = origin + '/api/runweft/tasks/overview*';
            await page.route(routePattern, async route => {
                arrived = true; const response = await route.fetch(); await held;
                await route.fulfill(failure ? { status: 503, json: { error: { message: 'LATE_READ_FAILURE' } } } : { response });
            }, { times: 1 });
            await page.evaluate(async ({ token, spaceId, ownerId }) => {
                const modulePath = '/hub/console.js', consoleModule = await import(modulePath);
                const state = window as unknown as { pendingRead: Promise<void>; readErrors: string[] };
                state.readErrors = [];
                state.pendingRead = consoleModule.mountConsole({ userId: ownerId, spaceId, members: [], spaces: [],
                    request: async (path: string) => { const response = await fetch('/api/runweft' + path, { headers: { authorization: `Bearer ${token}` } }); if (!response.ok) throw new Error('LATE_READ_FAILURE'); return response.json(); },
                    action: async (operation: () => Promise<void>) => operation(), confirm: async () => false, notice: (message: string) => state.readErrors.push(message), openNative: async () => {} }).catch((error: Error) => { state.readErrors.push(error.message); });
            }, { token: options.ownerToken, spaceId: options.spaceId, ownerId: decodeJwt(options.ownerToken).sub! });
            await until(async () => arrived, 'served console lifecycle request');
            await page.evaluate(async () => { const modulePath = '/hub/console.js'; (await import(modulePath)).clearConsole(); });
            release();
            await page.evaluate(async () => { await (window as unknown as { pendingRead: Promise<void> }).pendingRead; });
            assert.equal(await page.locator('#console-content').innerText(), ''); assert.equal(await page.locator('#console-navigation').innerText(), '');
            assert.deepEqual(await page.evaluate(() => (window as unknown as { readErrors: string[] }).readErrors), []);
        }
        await page.reload(); await ready(page);
        check('served console clear lifecycle ignores late authorized success and failure even with uncancelled HTTP; cleared view/navigation never revive');
        const beforeReloadJwt = await native.evaluate(() => sessionStorage.getItem('runweft.native.access'));
        await native.reload(); await native.getByText('OWNER_CONSOLE_HISTORY_NATIVE_MESSAGE', { exact: true }).waitFor();
        assert((await native.evaluate(() => sessionStorage.getItem('runweft.native.access'))) === beforeReloadJwt, 'Reload must preserve JWT lifetime');
        // Install before application timers exist; the clock affects an entire browser context.
        const clockContext = await context.browser()!.newContext(); clockContexts.push(clockContext);
        const expiring = await clockContext.newPage(); observe(expiring); await expiring.clock.install();
        const expiryAuthTokens: string[] = []; let identityCreates = 0;
        expiring.on('request', request => {
            const path = new URL(request.url()).pathname;
            if (path === '/api/auth') expiryAuthTokens.push(JSON.parse(request.postData() ?? '{}').accessToken);
            if (path === '/api/runweft/hub/identities' && request.method() === 'POST') identityCreates++;
        });
        await expiring.goto(origin + '/hub'); await ready(expiring);
        await expiring.evaluate(token => sessionStorage.setItem('runweft.native.access', token!), beforeReloadJwt);
        await expiring.goto(native.url()); await expiring.getByText('OWNER_CONSOLE_HISTORY_NATIVE_MESSAGE', { exact: true }).waitFor();
        assert.equal(await expiring.evaluate(() => sessionStorage.getItem('runweft.native.access')), beforeReloadJwt);
        const remainingMs = decodeJwt(beforeReloadJwt!).exp! * 1000 - await expiring.evaluate(() => Date.now());
        assert(remainingMs > 60_000);
        const refresh = expiring.waitForResponse(response => new URL(response.url()).pathname === '/api/auth');
        await expiring.clock.fastForward(remainingMs - 30_000);
        const refreshed = await refresh; assert.equal(refreshed.status(), 200);
        assert((await refreshed.json()).token === beforeReloadJwt, 'Native auth check must not extend JWT lifetime');
        assert(await expiring.evaluate(() => sessionStorage.getItem('runweft.native.access')) === beforeReloadJwt);
        await expiring.clock.fastForward(60_000); await expiring.waitForURL(/\/hub#native-expired/);
        assert.match(await expiring.locator('#notice').innerText(), /限时身份/);
        assert(await expiring.evaluate(() => sessionStorage.getItem('runweft.native.access') === null), 'Expired native credential must clear');
        assert(expiryAuthTokens.length > 0 && expiryAuthTokens.every(token => token === beforeReloadJwt), 'Native auth must only use the original limited JWT');
        assert.equal(identityCreates, 0, 'Expiry must not create a new identity');
        assert(await page.locator('#workspace').isVisible());

        assert(urls.every(url => !new URL(url).searchParams.has('token'))); assert.deepEqual(errors, []);
        check('same-browser native tabs keep different identities; foreign API, managed resume and shared-machine terminal denied; expiry never creates identity');
    } catch (error) {
        for (const [index, tab] of nativePages.entries()) {
            await tab.screenshot({ path: join(options.root, `native-failure-${index}.png`) });
            writeFileSync(join(options.root, `native-failure-${index}.txt`), await tab.locator('body').innerText());
        }
        writeFileSync(join(options.root, 'native-errors.json'), JSON.stringify({ errors, urls: urls.map(url => {
            const value = new URL(url); value.searchParams.delete('token'); return value.href;
        }) }, null, 2));
        let message = error instanceof Error ? error.message : String(error);
        for (const credential of credentials) message = message.replaceAll(credential, '[redacted]');
        throw new Error(message);
    } finally {
        for (const timer of heartbeats) clearInterval(timer);
        context.off('page', observe);
        await closeSmoke([() => access.close(), () => tasks.close(), ...sockets.map(socket => () => socket.disconnect()), ...nativePages.map(tab => () => tab.close()), ...clockContexts.map(clock => () => clock.close())]);
    }
}
