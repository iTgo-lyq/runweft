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
import { openTaskHistory } from './console-history';

export async function consoleTasks(options: { origin: string; home: string; root: string; page: Page; memberPage: Page; context: BrowserContext;
    memberUsername: string; memberPassword: string; identityToken: string; memberToken: string; memberIdentity: string; ownerToken: string; spaceId: string; machineId: string; agentId: string; memberAgentId: string;
    ready(page: Page): Promise<void>; navigate(page: Page, name: string): Promise<void>; check(name: string): void }) {
    const { origin, home, page, memberPage, context, ready, navigate, check } = options;
    const statePath = join(home, 'server/runweft/state.sqlite'), access = new AccessStore(statePath);
    const tasks = new TaskStore(statePath, { db: access.db, ownsScope: () => true, accepted: task => {
        access.bind({ kind: 'task', id: task.id, ownerId: task.hub!.ownerId, spaceId: task.hub!.spaceId, machineId: task.target.machineId });
    } });
    const scopes = new DelegationScopes(access), sockets: Socket[] = [], nativePages: Page[] = [];
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
    async function session(ownerToken: string, identity: string, agentId: string, marker: string) {
        const actor = access.authenticate(identity, options.spaceId), namespace = scopes.ensure(actor);
        const resolved = (await api('/api/runweft/agent-resolution', ownerToken, { agentId, hubRepositoryId: null })).resolution;
        const snapshot = agentSnapshot(namespace, resolved), parent = { kind: 'cli' as const, machineId: options.machineId, cwd: options.root };
        const sessionId = randomUUID(), nativeId = randomUUID();
        const accepted = tasks.accept(namespace, parent, randomUUID(), { agentType: agentId, message: 'Browser fixture only', workspaceMode: 'shared' }, snapshot, resolved.target);
        const bundle = tasks.require(namespace, accepted.agent_id), round = bundle.rounds[0];
        round.phase = 'finished'; round.stop = 'stopped'; round.finish = 'complete';
        round.report = marker + '\n<img src=x onerror=alert(1)>';
        round.sessionId = sessionId; round.nativeSessionId = nativeId;
        const taskId = accepted.agent_id;
        tasks.save(bundle.task, round, bundle.inputs);
        access.bind({ kind: 'session', id: sessionId, ownerId: actor.ownerId, spaceId: options.spaceId, machineId: options.machineId, taskId });
        await api('/cli/sessions', machine.active.token, { id: sessionId, tag: marker, metadata: { name: marker, path: options.root, host: 'console fixture',
            flavor: 'codex', machineId: options.machineId, codexSessionId: nativeId } });
        const socket = io(origin + '/cli', { auth: { token: machine.active.token, sessionId }, transports: ['websocket'], reconnection: false }); sockets.push(socket);
        await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
        const ping = () => new Promise<void>(resolve => socket.emit('ping', resolve));
        const heartbeat = () => socket.emit('session-alive', { sid: sessionId, time: Date.now(), thinking: false });
        heartbeat(); heartbeats.push(setInterval(heartbeat, 5000)); await ping();
        socket.emit('message', { sid: sessionId, message: { role: 'agent', content: { type: 'codex', data: { type: 'message', message: marker + '_NATIVE_MESSAGE' } } } }); await ping();
        return { id: sessionId, taskId, socket, ping };
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
    try {
        const owner = await session(options.ownerToken, options.identityToken, options.agentId, 'OWNER_CONSOLE_HISTORY');
        const other = await session(options.memberToken, options.memberIdentity, options.memberAgentId, 'MEMBER_ONLY_HISTORY');
        await navigate(page, '任务'); assert.match(await page.locator('.task-list').innerText(), /你的任务 1 个/);
        assert(!(await page.locator('.task-list').innerText()).includes('MEMBER_ONLY_HISTORY'));
        await navigate(memberPage, '任务'); assert.match(await memberPage.locator('.task-list').innerText(), /你的任务 1 个/);
        assert(!(await memberPage.locator('.task-list').innerText()).includes('OWNER_CONSOLE_HISTORY'));
        await page.evaluate(() => localStorage.setItem('hapi-lang', 'zh-CN'));
        const native = await openTaskHistory(page, owner.taskId, owner.id);
        assert.match(await page.locator('.task-report').first().innerText(), /<img src=x/);
        assert.equal(await page.locator('.task-report img').count(), 0);
        await native.getByText('OWNER_CONSOLE_HISTORY_NATIVE_MESSAGE', { exact: true }).waitFor({ timeout: 20000 });
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
        const memberNative = await openTaskHistory(memberPage, other.taskId, other.id); observe(memberNative);
        await memberNative.getByText('MEMBER_ONLY_HISTORY_NATIVE_MESSAGE', { exact: true }).waitFor();
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
        await memberPage.locator('#show-settings').click();
        await memberPage.locator('#current-password').fill(options.memberPassword);
        const newPassword = 'a changed console member passphrase';
        await memberPage.locator('#next-password').fill(newPassword); await memberPage.locator('#change-password button[type=submit]').click();
        await memberPage.locator('#auth-form').waitFor();
        assert.equal((await fetch(origin + '/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accessToken: options.memberIdentity, spaceId: options.spaceId }) })).status, 401);
        assert.equal((await fetch(origin + `/api/sessions/${other.id}`, { headers: { authorization: `Bearer ${previousMemberJwt}` } })).status, 401);
        // Password change redirects the native tab. Do not create an unauthenticated EventSource on the new Hub page.
        await memberNative.waitForURL(/\/hub#native-expired/);
        assert(await memberNative.evaluate(() => sessionStorage.getItem('runweft.native.access') === null), 'Revoked native credential must clear');
        assert.equal((await fetch(origin + `/api/sessions/${owner.id}`, { headers: { authorization: `Bearer ${options.ownerToken}` } })).status, 200);
        await memberPage.locator('#account-username').fill(options.memberUsername); await memberPage.locator('#account-password').fill(newPassword); await memberPage.locator('#auth-submit').click();
        await memberPage.locator('#workspace').waitFor(); await ready(memberPage);
        await memberPage.locator('#spaces button').filter({ hasText: 'console-owner' }).click(); await ready(memberPage);
        const replacement = await memberPage.evaluate(() => JSON.parse(sessionStorage.getItem('runweft.hub.session')!).token as string); credentials.add(replacement);
        await navigate(memberPage, '任务');
        await memberPage.locator(`[data-task-id="${other.taskId}"]`).getByRole('button', { name: '查看任务详情' }).click(); await ready(memberPage);
        const renewedPopup = context.waitForEvent('page'); await memberPage.getByRole('button', { name: '打开原生详情 / 审批' }).click();
        const renewed = await renewedPopup; await renewed.getByText('MEMBER_ONLY_HISTORY_NATIVE_MESSAGE', { exact: true }).waitFor();
        assert((await renewed.evaluate(() => sessionStorage.getItem('runweft.native.access'))) !== previousMemberJwt, 'Explicit reopen must issue a new credential');
        assert(JSON.parse(await memberPage.evaluate(() => sessionStorage.getItem('runweft.hub.session')) as string).token === replacement, 'Member account session must persist');
        check('password change rejects all old browser sessions and native JWT, expired SSE clears tab credential; independent owner remains authorized and explicit reopen gets new scope token');
        assert(urls.every(url => !new URL(url).searchParams.has('token'))); assert.deepEqual(errors, []);
        check('same-browser native tabs keep different identities; foreign API, managed resume and shared-machine terminal denied');
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
        await closeSmoke([() => access.close(), () => tasks.close(), ...sockets.map(socket => () => socket.disconnect()), ...nativePages.map(tab => () => tab.close())]);
    }
}
