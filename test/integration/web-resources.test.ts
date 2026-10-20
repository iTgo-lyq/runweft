import { afterEach, expect, test } from 'bun:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { chromium, type Page } from 'playwright';
import { hubResourceFixture } from './hub-resources-fixture';
import { fixtureCleanup } from '../fixture-cleanup';
import { button, confirmDialog, expectNoOverflow, hubTab, signIn } from './hub-web';
const owner = fixtureCleanup([]); afterEach(() => owner.close());
const password = 'synthetic unknown-account comparison';

test('machines and Runtime pages manage owned resources, share them to spaces and show others only a governed summary', async () => {
    const h = await hubResourceFixture(owner.resources), space = h.a.personalSpace.id;
    const enroll = (who: typeof h.actor, name: string) => h.store.enroll(who, { requestId: randomUUID(), token: `rw_mc_${randomBytes(32).toString('base64url')}`, name }).machineId;
    const build = enroll(h.actor, '构建服务器'), pending = enroll(h.actor, '尚未连接的笔记本'), theirs = enroll(h.member, '成员的工作站');
    h.connect(build); h.connect(theirs);
    h.store.associate(h.actor, build, space, true); h.store.associate(h.member, theirs, space, true);
    const team = (await h.request('/api/runweft/hub/spaces', h.a.token, 'POST', { name: '第二个空间' })).body.space;
    const usernameOf = (id: string) => (h.hub.db.query('SELECT username FROM hub_accounts WHERE userId=?').get(id) as { username: string }).username;
    const browser = await chromium.launch({ headless: true }); owner.resources.push(() => browser.close());
    const { page, problems } = await hubTab(browser);
    await page.goto(`${h.url}/hub#space=${space}`); await signIn(page, usernameOf(h.a.identity.id), password);
    const open = async (target: Page, view: string) => { await target.getByRole('link', { name: view, exact: true }).click(); await target.getByRole('heading', { name: view, level: 1 }).waitFor(); };
    const panel = (target: Page, label: string) => target.getByRole('complementary', { name: label });
    const row = (target: Page, id: string) => target.locator(`.row[data-key="${id}"]`);

    await open(page, '机器');
    await row(page, build).waitFor(); expect(await page.locator('.rows .row').count()).toBe(3);
    expect(await row(page, theirs).innerText()).toContain('member的机器');
    await row(page, build).click(); const machine = panel(page, '机器详情');
    await machine.getByText(/^有效/).waitFor();
    await machine.getByRole('button', { name: '修改机器名称' }).click(); await machine.getByLabel('机器名称').fill('主构建机'); await machine.getByRole('button', { name: '保存' }).click();
    await page.getByText('机器名称已保存').waitFor(); await row(page, build).getByText('主构建机').waitFor();
    await machine.getByRole('button', { name: '探测原生工具' }).click();
    await machine.locator('.tool-list li[data-found=true]').nth(1).waitFor(); expect(await machine.locator('.tool-list').innerText()).toContain('Claude Code');
    await machine.getByRole('switch', { name: '第二个空间' }).click(); await page.getByText('已关联到“第二个空间”').waitFor();
    await machine.getByRole('switch', { name: '第二个空间' }).click(); await confirmDialog(page, '撤回关联'); await page.getByText('已撤回“第二个空间”的关联').waitFor();

    await row(page, pending).click(); await machine.getByText('这台机器还没有完成首次连接').waitFor();
    expect(await machine.getByRole('button', { name: '探测原生工具' }).isDisabled()).toBe(true);
    await row(page, theirs).click(); await machine.getByText('这是member的机器').waitFor();
    expect(await machine.getByRole('button', { name: '修改机器名称' }).count()).toBe(0);
    await machine.getByRole('switch', { name: /停用这台机器/ }).click(); await confirmDialog(page, '停用'); await row(page, theirs).getByText('已在此空间停用').waitFor({ state: 'attached' });
    await machine.getByRole('switch', { name: /停用这台机器/ }).click(); await confirmDialog(page, '解除停用'); await page.getByText('已解除停用').waitFor();
    await page.keyboard.press('Escape'); await machine.waitFor({ state: 'hidden' });

    await open(page, 'Runtime'); await page.getByText('还没有 Runtime').waitFor();
    await button(page, '登记 Runtime').first().click(); const dialog = page.getByRole('dialog', { name: '登记 Runtime' });
    await dialog.getByLabel('执行机器').selectOption(build); await dialog.getByLabel('名称（可选）').fill('构建机 Codex');
    await dialog.getByRole('button', { name: '登记 Runtime' }).click(); await page.getByText('Runtime 已登记，目前只有你能选用').waitFor();
    const runtime = panel(page, 'Runtime 详情'); await runtime.getByRole('heading', { name: '构建机 Codex' }).waitFor();
    await runtime.getByRole('button', { name: '检查 Runtime' }).click(); await runtime.getByText(/^找到 Codex/).waitFor();
    expect(await runtime.getByRole('switch', { name: '第二个空间' }).isDisabled()).toBe(true);
    await runtime.getByRole('switch', { name: h.a.personalSpace.name, exact: true }).click(); await confirmDialog(page, '共享');
    await page.getByText(`已共享到“${h.a.personalSpace.name}”`).waitFor(); await page.locator('.rows .row').getByText('已共享').waitFor({ state: 'attached' });

    const member = await hubTab(browser); await member.page.goto(`${h.url}/hub#space=${space}`); await signIn(member.page, usernameOf(h.b.identity.id), password);
    await open(member.page, 'Runtime'); await member.page.locator('.rows .row').first().click();
    await panel(member.page, 'Runtime 详情').getByText('由owner共享到此空间').waitFor();
    expect(await panel(member.page, 'Runtime 详情').getByRole('button', { name: '修改Runtime 名称' }).count()).toBe(0);

    await runtime.getByRole('switch', { name: h.a.personalSpace.name, exact: true }).click(); await confirmDialog(page, '撤回共享'); await page.getByText(/已撤回“.*”的共享/).waitFor();
    await runtime.getByRole('button', { name: 'Runtime 操作' }).click(); await page.getByRole('menuitem', { name: '取消 Runtime 登记' }).click(); await confirmDialog(page, '取消登记');
    await page.getByText('Runtime 已取消登记', { exact: true }).waitFor(); await page.locator('.rows .row .tag').getByText('已取消登记').waitFor();

    await open(page, '机器'); await row(page, build).click();
    await machine.getByRole('button', { name: '机器操作' }).click(); await page.getByRole('menuitem', { name: '撤销机器凭据' }).click(); await confirmDialog(page, '撤销凭据');
    await machine.getByText('机器凭据已撤销', { exact: true }).waitFor();
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '机器操作');
    await machine.getByRole('button', { name: '机器操作' }).click(); await page.getByRole('menuitem', { name: '取消机器登记' }).click(); await confirmDialog(page, '取消登记');
    await row(page, build).getByText('已取消登记').waitFor();
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '机器操作');
    await machine.getByRole('button', { name: '机器操作' }).click(); await page.getByRole('menuitem', { name: '恢复机器登记' }).click(); await page.getByText('机器已恢复登记').waitFor();
    await expectNoOverflow(page); expect([...problems, ...member.problems]).toEqual([]);
}, 90_000);
