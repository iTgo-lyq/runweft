import { afterEach, expect, test } from 'bun:test';
import { accountWebFixture } from './account-web-fixture';
import { fixtureCleanup } from '../fixture-cleanup';
import { button, confirmDialog, expectNoOverflow, hubTab, savedSession, signIn } from './hub-web';
const owner = fixtureCleanup([]); afterEach(() => owner.close());
const password = 'a synthetic members passphrase';

test('members page invites once, changes roles within limits, revokes invitations and keeps the last owner', async () => {
    const h = await accountWebFixture(owner.resources), { page, problems } = await hubTab(h.browser);
    await page.goto(h.url + '/hub'); await button(page, '没有账号？注册').click(); await signIn(page, 'team-owner', password, '注册');
    const space = (await savedSession(page))!.spaceId!;
    await page.getByRole('link', { name: '成员', exact: true }).click(); await page.getByRole('heading', { name: '成员', level: 1 }).waitFor();
    await page.getByText('只有你一个人').waitFor();
    expect(await button(page, '退出空间').isDisabled()).toBe(true); await page.getByText('你是这个空间唯一的所有者。').waitFor();

    await page.getByRole('button', { name: '修改空间名称' }).click(); await page.getByLabel('空间名称', { exact: true }).fill('设计评审组'); await button(page, '保存').click();
    await page.getByText('空间名称已保存').waitFor(); await page.waitForFunction(() => document.querySelector('.crumb-space')?.textContent === '设计评审组');

    await button(page, '邀请成员').first().click(); const dialog = page.getByRole('dialog', { name: '邀请成员' });
    await dialog.getByRole('radio', { name: '管理员' }).click(); await dialog.getByRole('button', { name: '生成邀请' }).click();
    const first = await dialog.locator('.secret-value').innerText(); expect(first).toMatch(/^rw_inv_[A-Za-z0-9_-]{43}$/);
    await page.waitForFunction(() => document.activeElement?.classList.contains('secret-value'));
    expect(await dialog.getByRole('button', { name: /下载/ }).count()).toBe(0);
    await dialog.getByRole('button', { name: '完成' }).click(); await dialog.waitFor({ state: 'detached' });
    expect(await page.locator('body').innerText()).not.toContain(first);
    await page.locator('.line').getByText('管理员邀请').waitFor();
    await page.locator('.line').getByRole('button', { name: '撤销' }).click(); await confirmDialog(page, '撤销邀请'); await page.getByText('邀请已撤销').waitFor();
    const revoked = await h.api('/api/runweft/hub/accounts', '', { username: 'late-guest', password });
    expect((await h.api('/api/runweft/hub/invitations/accept', revoked.body.token, { token: first })).status).not.toBe(200);

    await button(page, '邀请成员').first().click(); await dialog.getByRole('button', { name: '生成邀请' }).click();
    const second = await dialog.locator('.secret-value').innerText(); await dialog.getByRole('button', { name: '完成' }).click();
    const guest = await hubTab(h.browser), other = guest.page;
    await other.goto(h.url + '/hub'); await button(other, '没有账号？注册').click(); await signIn(other, 'team-guest', password, '注册');
    await other.getByRole('button', { name: /^当前空间：/ }).click(); await other.getByRole('menuitem', { name: '接受邀请…' }).click();
    const join = other.getByRole('dialog', { name: '接受空间邀请' }); await join.getByLabel('邀请').fill(second); await join.getByRole('button', { name: '加入空间' }).click();
    await join.waitFor({ state: 'detached' }); expect((await savedSession(other))!.spaceId).toBe(space);

    await page.reload(); await page.locator('.person').nth(1).waitFor();
    const guestRow = page.locator('.person').filter({ hasText: 'team-guest' });
    expect(await guestRow.innerText()).toContain('成员');
    await guestRow.getByRole('button', { name: 'team-guest 的操作' }).click(); await page.getByRole('menuitem', { name: '设为管理员' }).click();
    await confirmDialog(page, '更改角色'); await page.getByText('team-guest 已设为管理员').waitFor();
    await guestRow.getByText('管理员').waitFor();

    await other.getByRole('link', { name: '成员', exact: true }).click(); await other.locator('.person').nth(1).waitFor();
    expect(await other.locator('.person').filter({ hasText: 'team-owner' }).getByRole('button').count()).toBe(0);
    expect(await other.getByRole('button', { name: '退出空间' }).isDisabled()).toBe(false);
    await other.getByRole('button', { name: '退出空间' }).click(); await confirmDialog(other, '退出空间');
    await other.getByText('已退出“设计评审组”').waitFor();
    await other.waitForFunction(id => JSON.parse(sessionStorage.getItem('runweft.hub.session')!).spaceId !== id, space);
    expect(await other.locator('.crumb-space').innerText()).not.toBe('设计评审组');

    await page.reload(); await page.getByText('只有你一个人').waitFor();
    await expectNoOverflow(page); expect([...problems, ...guest.problems]).toEqual([]);
}, 90_000);

test('an owner can hand over ownership and lower their own role without stale owner controls', async () => {
    const h = await accountWebFixture(owner.resources), { page, problems } = await hubTab(h.browser);
    const ownerAccount = (await h.api('/api/runweft/hub/accounts', '', { username: 'handoff-owner', password })).body;
    const nextAccount = (await h.api('/api/runweft/hub/accounts', '', { username: 'next-owner', password })).body;
    const space = ownerAccount.personalSpace.id;
    const invitation = (await h.api(`/api/runweft/hub/spaces/${space}/invitations`, ownerAccount.token, { role: 'member' })).body.token;
    expect((await h.api('/api/runweft/hub/invitations/accept', nextAccount.token, { token: invitation })).status).toBe(200);
    const nextId = (await h.api('/api/runweft/hub/identity', nextAccount.token)).body.identity.id;
    expect((await h.api(`/api/runweft/hub/spaces/${space}/members/${nextId}`, ownerAccount.token, { role: 'owner' }, 'PATCH')).status).toBe(200);
    await page.goto(h.url + '/hub'); await signIn(page, 'handoff-owner', password);
    await page.getByRole('link', { name: '成员', exact: true }).click();
    const self = page.locator('.person').filter({ hasText: 'handoff-owner' });
    await self.getByRole('button', { name: 'handoff-owner 的操作' }).click();
    expect(await page.getByRole('menuitem', { name: '移出空间' }).count()).toBe(0);
    await page.getByRole('menuitem', { name: '设为管理员' }).click();
    await confirmDialog(page, '更改角色');
    await page.waitForFunction(() => document.querySelector('.space-switch')?.getAttribute('aria-label')?.includes('管理员'));
    await self.getByText('管理员', { exact: true }).waitFor();
    expect(await page.locator('.person').filter({ hasText: 'next-owner' }).getByRole('button').count()).toBe(0);
    expect(problems).toEqual([]);
}, 60_000);
