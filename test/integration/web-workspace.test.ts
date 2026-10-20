import { afterEach, expect, test } from 'bun:test';
import { accountWebFixture } from './account-web-fixture';
import { fixtureCleanup } from '../fixture-cleanup';
import { accountMenu, button, confirmDialog, expectNoOverflow, field, fillAccount, hubTab, savedSession, signIn, viewports } from './hub-web';
const owner = fixtureCleanup([]); afterEach(() => owner.close());

test('the workspace shell renames the identity, creates, switches and joins spaces, and follows space links', async () => {
    const h = await accountWebFixture(owner.resources), password = 'a synthetic workspace passphrase';
    const { page, problems } = await hubTab(h.browser);
    const spaceButton = () => page.getByRole('button', { name: /^当前空间：/ });
    await page.goto(h.url + '/hub'); await button(page, '没有账号？注册').click(); await signIn(page, 'shell-owner', password, '注册');
    const first = (await savedSession(page))!.spaceId!;
    expect(await page.title()).toContain('任务'); expect(await spaceButton().getAttribute('aria-label')).toContain('所有者');

    await accountMenu(page, '账号设置'); await button(page, '修改显示名称').click();
    await field(page, '显示名称').fill('林舟'); await button(page, '保存').click();
    await page.getByRole('button', { name: /^账号：林舟/ }).waitFor();

    await spaceButton().click(); await page.getByRole('menuitem', { name: '创建空间…' }).click();
    const create = page.getByRole('dialog', { name: '创建空间' }); await create.getByLabel('空间名称').fill('设计评审'); await create.getByRole('button', { name: '创建空间' }).click();
    await page.getByText('空间“设计评审”已创建').waitFor(); await create.waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.querySelector('.space-switch')?.getAttribute('aria-label')?.includes('设计评审'));
    const team = (await savedSession(page))!.spaceId!; expect(team).not.toBe(first);
    expect(await page.locator('.crumb-space').innerText()).toBe('设计评审');

    await spaceButton().click(); await page.getByRole('menuitemradio', { name: /shell-owner/ }).click();
    await page.getByText(/^已切换到/).waitFor(); expect((await savedSession(page))!.spaceId).toBe(first);

    const invitation = await h.api(`/api/runweft/hub/spaces/${team}/invitations`, (await savedSession(page))!.token, { role: 'member' });
    const guest = await hubTab(h.browser), other = guest.page;
    await other.goto(h.url + '/hub'); await button(other, '没有账号？注册').click(); await signIn(other, 'shell-guest', password, '注册');
    await other.getByRole('button', { name: /^当前空间：/ }).click(); await other.getByRole('menuitem', { name: '接受邀请…' }).click();
    const join = other.getByRole('dialog', { name: '接受空间邀请' });
    await join.getByLabel('邀请').fill('rw_inv_not-a-real-invitation'); await join.getByRole('button', { name: '加入空间' }).click();
    await join.getByRole('alert').waitFor();
    await join.getByLabel('邀请').fill(invitation.body.token); await join.getByRole('button', { name: '加入空间' }).click();
    await other.getByText('已加入空间').waitFor(); await join.waitFor({ state: 'detached' });
    expect((await savedSession(other))!.spaceId).toBe(team);
    expect(await other.getByRole('button', { name: /^当前空间：/ }).getAttribute('aria-label')).toContain('成员');
    expect(await other.locator('body').innerText()).not.toContain(invitation.body.token);

    await page.goto(`${h.url}/hub#space=${team}&task=t-unknown`); await page.waitForFunction(() => document.querySelector('.crumb-space')?.textContent === '设计评审');
    await page.goto(`${h.url}/hub#space=not-a-space`); await page.getByRole('heading', { name: '此链接的空间不可访问' }).waitFor();
    await button(page, '返回 Hub').click(); await page.getByRole('navigation', { name: '主导航' }).waitFor(); expect(page.url()).toBe(h.url + '/hub');
    expect((await h.api('/api/runweft/hub/accounts', '', { username: 'shell-stranger', password })).status).toBe(201);
    const stranger = await hubTab(h.browser); await stranger.page.goto(`${h.url}/hub#space=${team}`);
    await fillAccount(stranger.page, 'shell-stranger', password); await button(stranger.page, '登录').click();
    await stranger.page.getByRole('heading', { name: '此链接的空间不可访问' }).waitFor(); await button(stranger.page, '返回 Hub').click();
    await stranger.page.getByRole('navigation', { name: '主导航' }).waitFor(); expect(await stranger.page.locator('.crumb-space').innerText()).not.toBe('设计评审');

    await button(page, '接入新环境').click(); const help = page.getByRole('dialog', { name: '让 Agent 帮你接入' });
    expect(await help.locator('pre').innerText()).toContain(h.url); await help.getByRole('button', { name: '完成' }).click(); await help.waitFor({ state: 'detached' });
    expect(await page.evaluate(() => document.activeElement?.textContent)).toContain('接入新环境');

    await page.setViewportSize(viewports.phone); await button(page, '打开导航').click();
    await page.getByRole('link', { name: '机器', exact: true }).click(); await page.getByRole('heading', { name: '机器', level: 1 }).waitFor();
    expect(await page.evaluate(() => document.body.dataset.nav)).toBe('closed'); expect(page.url()).toContain('view=machines');
    await expectNoOverflow(page); await expectNoOverflow(other);
    expect([...problems, ...guest.problems, ...stranger.problems]).toEqual([]);
}, 90_000);

test('late identity refreshes cannot undo a newer space choice or sign-out', async () => {
    const h = await accountWebFixture(owner.resources), { page, problems } = await hubTab(h.browser);
    await page.goto(h.url + '/hub'); await button(page, '没有账号？注册').click();
    await signIn(page, 'context-owner', 'a synthetic context passphrase', '注册');
    const saved = (await savedSession(page))!;
    const created = await h.api('/api/runweft/hub/spaces', saved.token, { name: '最新空间' });
    const team = created.body.space.id;
    const finalSpace = (await h.api('/api/runweft/hub/spaces', saved.token, { name: '最终空间' })).body.space.id;
    await page.reload(); await page.getByRole('navigation', { name: '主导航' }).waitFor();
    const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const delays = new Map<string, { gate: Promise<void>; seen(): void; beforeFetch: boolean }>();
    await page.route('**/api/runweft/hub/**', async route => {
        const path = new URL(route.request().url()).pathname;
        const delay = delays.get(path);
        if (!delay) { await route.continue(); return; }
        delays.delete(path);
        if (delay.beforeFetch) { delay.seen(); await delay.gate; }
        const response = await route.fetch();
        if (!delay.beforeFetch) { delay.seen(); await delay.gate; }
        await route.fulfill({ response });
    });
    async function holdResponse(path = '/identity', beforeFetch = false) {
        let release!: () => void, seen!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const started = new Promise<void>(resolve => { seen = resolve; });
        const url = `**/api/runweft/hub${path}`;
        delays.set(`/api/runweft/hub${path}`, { gate, seen, beforeFetch });
        return { started, async finish() {
            const response = page.waitForResponse(url);
            release(); await response; await settle();
        } };
    }
    // A refresh of A completes after the explicit switch to B.
    const refresh = await holdResponse();
    await button(page, '刷新').click(); await refresh.started;
    await page.getByRole('button', { name: /^当前空间：/ }).click();
    await page.getByRole('menuitemradio', { name: /最新空间/ }).click();
    await page.waitForFunction(id => JSON.parse(sessionStorage.getItem('runweft.hub.session')!).spaceId === id, team);
    await refresh.finish();
    expect((await savedSession(page))!.spaceId).toBe(team);
    expect(await page.locator('.crumb-space').innerText()).toBe('最新空间');

    // The same rule applies to an old external deep-link evaluation.
    const linked = await holdResponse();
    await page.evaluate(id => { location.hash = `space=${id}`; }, saved.spaceId!);
    await linked.started;
    await page.evaluate(id => { location.hash = `space=${id}&view=members`; }, team);
    await page.getByRole('heading', { name: '成员', level: 1 }).waitFor();
    await linked.finish();
    expect((await savedSession(page))!.spaceId).toBe(team);
    expect(await page.getByRole('heading', { name: '成员', level: 1 }).count()).toBe(1);

    // A second explicit choice supersedes a switch that has not returned yet.
    const firstChoice = await holdResponse();
    await page.getByRole('button', { name: /^当前空间：/ }).click();
    await page.getByRole('menuitemradio', { name: /context-owner/ }).click();
    await firstChoice.started;
    await page.getByRole('button', { name: /^当前空间：/ }).click();
    await page.getByRole('menuitemradio', { name: /最终空间/ }).click();
    await page.waitForFunction(id => JSON.parse(sessionStorage.getItem('runweft.hub.session')!).spaceId === id, finalSpace);
    await firstChoice.finish();
    expect((await savedSession(page))!.spaceId).toBe(finalSpace);
    expect(await page.locator('.crumb-space').innerText()).toBe('最终空间');

    // Explicit logout wins in both response orders, even before the server revokes the credential.
    for (const switchFirst of [false, true]) {
        if (switchFirst) await signIn(page, 'context-owner', 'a synthetic context passphrase', '登录');
        const oldName = await page.locator('.crumb-space').innerText();
        const switching = await holdResponse();
        await page.getByRole('button', { name: /^当前空间：/ }).click();
        await page.getByRole('menuitemradio', { name: oldName === '最新空间' ? /最终空间/ : /最新空间/ }).click();
        await switching.started;
        const logout = await holdResponse('/sessions/logout', true);
        await accountMenu(page, '退出此浏览器'); await confirmDialog(page, '退出'); await logout.started;
        if (switchFirst) {
            await switching.finish();
            expect(await page.locator('.crumb-space').innerText()).toBe(oldName);
        }
        await logout.finish();
        await button(page, '登录').waitFor();
        if (!switchFirst) await switching.finish();
        expect((await savedSession(page))?.token).toBe('');
        expect(await button(page, '登录').isVisible()).toBe(true);
    }
    expect(problems).toEqual([]);
}, 90_000);
