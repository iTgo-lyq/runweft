import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import type { BrowserContext, Page } from 'playwright';
import { AccessStore } from '../../src/hub/access/store';
import { DelegationScopes, agentSnapshot } from '../../src/hub/delegation/context';
import { TaskStore } from '../../src/tasks/store';
import { hubConnectionPaths } from '../../src/hub/resources/connection';

export async function consoleTasks(options: { origin: string; home: string; root: string; page: Page; memberPage: Page; context: BrowserContext;
    identityToken: string; memberToken: string; memberIdentity: string; ownerToken: string; spaceId: string; machineId: string; agentId: string; memberAgentId: string;
    ready(page: Page): Promise<void>; navigate(page: Page, name: string): Promise<void>; screenshot(page: Page, name: string): Promise<void>; check(name: string): void }) {
    const { origin, home, page, memberPage, context, ready, navigate, check } = options;
    const statePath = join(home, 'server/runweft/state.sqlite'), access = new AccessStore(statePath);
    const tasks = new TaskStore(statePath, { db: access.db, ownsScope: () => true, accepted: task => {
        access.bind({ kind: 'task', id: task.id, ownerId: task.hub!.ownerId, spaceId: task.hub!.spaceId, machineId: task.target.machineId });
    } });
    const scopes = new DelegationScopes(access), sockets: Socket[] = [], nativePages: Page[] = [];
    const urls: string[] = [], authBodies: string[] = [], errors: string[] = [];
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
                const next = tasks.append(namespace, parent, randomUUID(), { id: taskId, mode: 'next', message: 'Second browser fixture round' });
                const updated = tasks.require(namespace, taskId), latest = updated.rounds.find(item => item.id === next.round_id)!;
                latest.phase = 'finished'; latest.stop = 'stopped'; latest.finish = 'complete';
                latest.report = marker + '_SECOND_ROUND'; latest.sessionId = sessionId; latest.nativeSessionId = nativeId;
                tasks.save(updated.task, latest, updated.inputs);
            }
        } }).immediate();
        access.bind({ kind: 'session', id: sessionId, ownerId: actor.ownerId, spaceId: options.spaceId, machineId: options.machineId, taskId });
        await api('/cli/sessions', machine.active.token, { id: sessionId, tag: marker, metadata: { name: marker, path: options.root, host: 'console fixture',
            flavor: 'codex', machineId: options.machineId, codexSessionId: nativeId } });
        const socket = io(origin + '/cli', { auth: { token: machine.active.token, sessionId }, transports: ['websocket'], reconnection: false }); sockets.push(socket);
        await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
        const ping = () => new Promise<void>(resolve => socket.emit('ping', resolve));
        socket.emit('session-alive', { sid: sessionId, time: Date.now(), thinking: false }); await ping();
        socket.emit('message', { sid: sessionId, message: { role: 'agent', content: { type: 'codex', data: { type: 'message', message: marker + '_NATIVE_MESSAGE' } } } }); await ping();
        return { id: sessionId, taskId, roundId, namespace, socket, ping };
    }
    function observe(tab: Page) {
        nativePages.push(tab); tab.on('pageerror', error => errors.push(error.message));
        tab.on('request', request => { urls.push(request.url()); if (request.url().endsWith('/api/auth')) authBodies.push(request.postData() ?? ''); });
    }
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
        await page.getByRole('button', { name: '下一页任务' }).click(); await ready(page);
        assert.equal(await page.locator('[data-task-id]').count(), 2);
        await page.getByRole('button', { name: '上一页任务' }).click(); await ready(page);
        await page.getByLabel('来源工作目录筛选').fill('does-not-match');
        await page.getByRole('button', { name: '应用筛选' }).click(); await ready(page);
        assert.match(await page.locator('.task-list').innerText(), /你的任务 0 个/);
        await page.getByLabel('来源工作目录筛选').fill(''); await page.getByLabel('每页任务数').selectOption('50');
        await page.getByRole('button', { name: '应用筛选' }).click(); await ready(page);
        await page.locator(`[data-task-id="${owner.taskId}"]`).getByRole('button', { name: '查看任务详情' }).click(); await ready(page);
        assert.match(await page.locator('.task-report').first().innerText(), /SECOND_ROUND/);
        await page.getByLabel('查看轮次').selectOption(owner.roundId); await ready(page);
        assert.match(await page.locator('.task-report').first().innerText(), /<img src=x/);
        assert.equal(await page.locator('.task-report img').count(), 0);
        await page.getByRole('button', { name: '下一段报告' }).click(); await ready(page);
        assert.match(await page.locator('.task-detail').innerText(), /16000–/);
        await page.getByRole('button', { name: '上一段报告' }).click(); await ready(page);
        await options.screenshot(page, 'tasks-detail-mobile');
        await page.setViewportSize({ width: 1440, height: 1000 }); await options.screenshot(page, 'tasks-detail-desktop');
        await navigate(memberPage, '任务'); assert.match(await memberPage.locator('.task-list').innerText(), /你的任务 1 个/);
        check('task inventory and count isolate identities; filtering, pagination, full report paging and escaped content');
        const native = await openNative();
        await native.getByText('OWNER_CONSOLE_HISTORY_NATIVE_MESSAGE', { exact: true }).waitFor({ timeout: 20000 });
        assert.equal(await native.evaluate(() => sessionStorage.getItem('runweft.hub.identity')), null);
        assert.equal(await native.evaluate(() => opener), null);
        assert.equal(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('hapi_access_token::')).length), 0);
        await native.reload(); await native.getByText('OWNER_CONSOLE_HISTORY_NATIVE_MESSAGE', { exact: true }).waitFor();
        const eventsBefore = urls.filter(url => new URL(url).pathname === '/api/events').length;
        assert(eventsBefore > 0); assert(urls.every(url => !new URL(url).searchParams.has('token')));
        owner.socket.emit('message', { sid: owner.id, message: { role: 'agent', content: { type: 'codex', data: { type: 'message', message: 'LIVE_HEADER_SSE_MESSAGE' } } } }); await owner.ping();
        await native.getByText('LIVE_HEADER_SSE_MESSAGE', { exact: true }).waitFor();
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
        await native.clock.install(); await native.reload(); await native.getByText('OWNER_CONSOLE_HISTORY_NATIVE_MESSAGE', { exact: true }).waitFor();
        await native.clock.fastForward(16 * 60_000); await native.waitForURL(/\/hub#native-expired/);
        assert.match(await native.locator('#notice').innerText(), /限时身份/);
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
        throw error;
    } finally {
        for (const tab of nativePages) await tab.close();
        for (const socket of sockets) socket.disconnect();
        tasks.close(); access.close();
    }
}
