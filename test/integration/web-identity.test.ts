import { afterEach, expect, test } from 'bun:test';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { accountWebFixture } from './account-web-fixture';
import { fixtureCleanup } from '../fixture-cleanup';
import { accountMenu, alertText, button, confirmDialog, expectNoOverflow, field, fillAccount, hubTab, savedSession, signIn } from './hub-web';
const owner = fixtureCleanup([]); afterEach(() => owner.close());

test('remote plaintext Web login refuses to transmit account passwords', async () => {
    const h = await accountWebFixture(owner.resources), { page, problems } = await hubTab(h.browser), origin = 'http://runweft-account.invalid'; let writes = 0;
    await page.route(origin + '/**', async route => {
        const request = route.request(), url = new URL(request.url());
        if (request.method() !== 'GET') { writes++; await route.fulfill({ status: 500, body: 'Unexpected write' }); return; }
        const response = await fetch(h.url + url.pathname + url.search);
        await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
    });
    await page.goto(origin + '/hub'); await fillAccount(page, 'plaintext-user', 'a synthetic plaintext test passphrase'); await button(page, '登录').click();
    await page.getByRole('alert').waitFor(); expect(await alertText(page)).toContain('HTTPS'); expect(writes).toBe(0); expect(problems).toEqual([]);
}, 30_000);

test('Web account lifecycle keeps identity, isolates browser environments and supports password recovery', async () => {
    const h = await accountWebFixture(owner.resources), { page: a, problems } = await hubTab(h.browser), { page: b, problems: other } = await hubTab(h.browser);
    const username = '.用户 A@' + '名'.repeat(40), password = 'x', changedPassword = '新🧵 !'.repeat(80), recoveredPassword = ' ';
    const identityOf = async (token: string) => (await h.api('/api/runweft/hub/identity', token)).body.identity.id as string;
    expect((await h.api('/api/runweft/hub/accounts', '', { username: '   ', password })).status).toBe(400);
    expect((await h.api('/api/runweft/hub/accounts', '', { username: 'empty-password', password: '' })).status).toBe(400);

    await a.goto(h.url + '/hub'); await a.getByRole('heading', { name: '欢迎回来' }).waitFor();
    expect(await a.locator('form').first().evaluate((form: HTMLFormElement) => form.checkValidity())).toBe(false);
    await button(a, '没有账号？注册').click(); await signIn(a, username, password, '注册');
    const saved = (await savedSession(a))!, id = await identityOf(saved.token);
    expect(saved.token).toMatch(/^rw_web_/); expect(saved.spaceId).toBeTruthy();
    expect(await a.locator('body').innerText()).not.toContain(saved.token); expect(a.url()).not.toContain(saved.token);
    expect(await a.evaluate(token => document.documentElement.outerHTML.includes(token), saved.token)).toBe(false);

    await b.goto(h.url + '/hub'); await button(b, '没有账号？注册').click();
    await fillAccount(b, '  ' + username.toUpperCase() + '  ', password); await button(b, '注册').click();
    await b.getByRole('alert').getByText(/用户名已被使用/).waitFor(); await button(b, '已有账号？登录').click();
    await signIn(b, username, password); const second = (await savedSession(b))!;

    await accountMenu(a, '退出此浏览器'); await confirmDialog(a, '退出');
    await a.getByRole('heading', { name: '欢迎回来' }).waitFor(); await a.getByRole('status').getByText('已退出当前浏览器').waitFor();
    expect((await h.api('/api/runweft/hub/identity', saved.token)).status).toBe(401); expect((await h.api('/api/runweft/hub/identity', second.token)).status).toBe(200);
    await signIn(a, username, password); const active = (await savedSession(a))!; expect(await identityOf(active.token)).toBe(id);

    const envs = await h.api('/api/runweft/hub/credentials', second.token), otherId = envs.body.currentCredentialId;
    await accountMenu(a, '账号设置'); await a.getByRole('heading', { name: '账号设置' }).waitFor();
    const row = a.locator(`[data-credential-id="${otherId}"]`);
    await row.getByRole('button', { name: '断开' }).click(); await confirmDialog(a, '断开环境');
    await row.getByRole('button').waitFor({ state: 'detached' }); expect(await row.getAttribute('data-revoked')).toBe('true');
    await b.reload(); await b.getByRole('heading', { name: '欢迎回来' }).waitFor(); await b.getByText('登录已失效').waitFor();

    await field(a, '当前密码').fill('the wrong current passphrase'); await field(a, '新密码').fill(changedPassword);
    await button(a, '修改密码并退出全部环境').click(); await a.getByRole('alert').waitFor();
    expect(await a.getByRole('heading', { name: '账号设置' }).isVisible()).toBe(true);
    await field(a, '当前密码').fill(password); await button(a, '修改密码并退出全部环境').click();
    await a.getByRole('heading', { name: '欢迎回来' }).waitFor(); await a.getByText('密码已更新').waitFor();
    expect((await h.api('/api/runweft/hub/identity', active.token)).status).toBe(401);
    await signIn(a, username, changedPassword); expect(await identityOf((await savedSession(a))!.token)).toBe(id);

    await accountMenu(a, '账号设置'); await button(a, '退出全部环境…').click();
    const dialog = a.getByRole('dialog', { name: '退出全部环境？' }); await dialog.waitFor();
    await a.waitForFunction(() => document.activeElement?.closest('[role=dialog]') !== null && document.activeElement?.tagName === 'INPUT');
    await dialog.getByLabel('当前密码', { exact: true }).fill(changedPassword); await dialog.getByRole('button', { name: '确认退出全部环境' }).click();
    await a.getByRole('heading', { name: '欢迎回来' }).waitFor(); await a.getByText('已退出全部环境').waitFor();

    await button(a, '忘记密码？').click(); await a.getByRole('heading', { name: '重置密码' }).waitFor(); await field(a, '用户名').fill(username);
    const file = join(h.root, 'reset-code.txt'); await h.service(['account', 'reset-password', username, '--output', file]);
    await field(a, '一次性重置码').fill(readFileSync(file, 'utf8').trim()); await field(a, '新密码').fill(recoveredPassword); await button(a, '重置密码').click();
    await a.getByRole('heading', { name: '欢迎回来' }).waitFor(); await a.getByText('请使用新密码登录').waitFor();
    await signIn(a, username, recoveredPassword); expect(await identityOf((await savedSession(a))!.token)).toBe(id);
    await expectNoOverflow(a); expect([...problems, ...other]).toEqual([]);
}, 90_000);

test('an expired session returns to sign-in and comes back to the same entry', async () => {
    const h = await accountWebFixture(owner.resources), { page, problems } = await hubTab(h.browser);
    await page.goto(h.url + '/hub'); await button(page, '没有账号？注册').click(); await signIn(page, 'expiry-user', 'an expiry passphrase', '注册');
    await page.getByRole('link', { name: '成员', exact: true }).click(); expect(page.url()).toContain('view=members');
    await page.evaluate(() => { const saved = JSON.parse(sessionStorage.getItem('runweft.hub.session')!); saved.token = 'rw_web_invalid'; sessionStorage.setItem('runweft.hub.session', JSON.stringify(saved)); });
    await page.reload(); await page.getByRole('heading', { name: '欢迎回来' }).waitFor(); await page.getByText('登录已失效').waitFor();
    await signIn(page, 'expiry-user', 'an expiry passphrase');
    expect(await page.getByRole('link', { name: '成员', exact: true }).getAttribute('aria-current')).toBe('page');
    await page.goto(h.url + '/hub#native-expired'); await page.getByText('原生页面的限时访问已失效').waitFor(); expect(page.url()).not.toContain('native-expired');
    expect(problems).toEqual([]);
}, 60_000);
