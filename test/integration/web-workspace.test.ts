import { afterEach, expect, test } from 'bun:test';
import { accountWebFixture } from './account-web-fixture';
import { fixtureCleanup } from '../fixture-cleanup';
import { accountMenu, button, expectNoOverflow, field, fillAccount, hubTab, savedSession, signIn, viewports } from './hub-web';
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
