import { afterEach, expect, test } from 'bun:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { chromium, type Page } from 'playwright';
import { hubResourceFixture } from './hub-resources-fixture';
import { fixtureCleanup } from '../fixture-cleanup';
import { button, confirmDialog, expectNoOverflow, hubTab, signIn } from './hub-web';
const owner = fixtureCleanup([]); afterEach(() => owner.close());
const password = 'synthetic unknown-account comparison';

test('Agent, repository and selection pages create with receipts, version, share and keep failed choices visible', async () => {
    const h = await hubResourceFixture(owner.resources, true), space = h.a.personalSpace.id;
    const machine = h.store.enroll(h.actor, { requestId: randomUUID(), token: `rw_mc_${randomBytes(32).toString('base64url')}`, name: '构建服务器' }).machineId;
    h.connect(machine); h.store.associate(h.actor, machine, space, true);
    const jwt = await h.auth(h.a.token, space);
    const runtime = (await h.request('/api/runweft/resources/runtimes', jwt, 'POST', { machineId: machine, flavor: 'codex', name: '构建机 Codex' })).body.runtime;
    expect((await h.request(`/api/runweft/resources/runtimes/${runtime.id}/spaces/${space}`, await h.auth(h.a.token), 'PUT', {})).status).toBe(200);
    const usernameOf = (id: string) => (h.hub.db.query('SELECT username FROM hub_accounts WHERE userId=?').get(id) as { username: string }).username;
    const browser = await chromium.launch({ headless: true }); owner.resources.push(() => browser.close());
    const { page, problems } = await hubTab(browser);
    await page.goto(`${h.url}/hub#space=${space}`); await signIn(page, usernameOf(h.a.identity.id), password);
    const open = async (target: Page, view: string) => { await target.getByRole('link', { name: view, exact: true }).click(); await target.getByRole('heading', { name: view, level: 1 }).waitFor(); };
    const panel = (target: Page, label: string) => target.getByRole('complementary', { name: label });

    // A lost answer keeps the request; submitting the same form again finds it instead of creating a second repository.
    await open(page, '仓库'); await page.getByText('还没有仓库').waitFor();
    await button(page, '登记仓库').first().click(); const create = page.getByRole('dialog', { name: '登记仓库' });
    await create.getByLabel('仓库名称').fill('runweft-web'); await create.getByLabel('Git 别名（可选，每行一个）').fill('git@github.com:team/runweft-web.git');
    await page.route('**/api/runweft/repositories', async route => { if (route.request().method() !== 'POST') return route.continue(); await route.fetch(); await route.abort('failed'); }, { times: 1 });
    await page.route('**/api/runweft/repositories/requests/*', route => route.abort('failed'), { times: 1 });
    await create.getByRole('button', { name: '登记仓库' }).click(); await create.getByText(/^创建结果未确认，已保留请求/).waitFor();
    await create.getByRole('button', { name: '登记仓库' }).click(); await page.getByText('仓库已登记。在项目里让 Agent 观察 Git 并绑定 checkout。').waitFor();
    expect((await h.request('/api/runweft/repositories', jwt)).body.repositories).toHaveLength(1);
    const repository = panel(page, '仓库详情'); await repository.getByRole('heading', { name: 'runweft-web' }).waitFor();
    await repository.getByLabel('添加 Git 别名').fill('https://github.com/team/runweft-web'); await repository.getByRole('button', { name: '添加别名' }).click();
    await page.getByText('别名已添加').waitFor(); await repository.locator('.alias-list li').nth(1).waitFor();
    await repository.locator('.alias-list li').nth(1).getByRole('button').click(); await confirmDialog(page, '移除'); await page.getByText('别名已移除').waitFor();
    await repository.getByText('还没有 checkout 关联').waitFor();

    await open(page, 'Agent'); await page.getByText('还没有 Agent').waitFor();
    await button(page, '创建 Agent').first().click(); const editor = panel(page, 'Agent 详情');
    await editor.getByLabel('名称', { exact: true }).fill('代码评审'); await editor.getByLabel('用途').fill('审阅改动并给出结论');
    await editor.getByLabel('指令').fill('只读评审，不修改文件。'); await editor.getByLabel('作用仓库').selectOption({ label: 'runweft-web' });
    await editor.getByLabel('默认 Runtime').selectOption(runtime.id); await editor.getByLabel('模型（可选）').fill('gpt-test');
    await editor.getByText('填写模型或推理等级时需要选择原生类型。').waitFor();
    await editor.getByRole('button', { name: '创建 Agent' }).click(); await editor.getByRole('alert').waitFor();
    await editor.getByLabel('原生类型').selectOption('codex'); await editor.getByRole('button', { name: '创建 Agent' }).click();
    await page.getByText('Agent 已创建，目前只有你能看到').waitFor(); await editor.getByRole('heading', { name: '代码评审' }).waitFor();
    await editor.getByRole('button', { name: '编辑定义' }).click(); await editor.getByLabel('指令').fill('只读评审，不修改文件。先列风险。');
    await editor.getByRole('button', { name: '保存为 v2' }).click(); await page.getByText('已保存为 v2').waitFor();
    await editor.getByRole('tab', { name: '版本历史' }).click(); await editor.locator('.versions > li').nth(1).waitFor();
    expect(await editor.locator('.versions details[open]').innerText()).toContain('先列风险');
    await editor.getByRole('tab', { name: '分享' }).click(); await editor.getByRole('radio', { name: '空间成员' }).click();
    await editor.getByRole('button', { name: '保存分享范围' }).click(); await confirmDialog(page, '保存'); await page.getByText('分享范围已保存').waitFor();
    const privateAgent = (await h.request('/api/runweft/agents', jwt, 'POST', { requestId: randomUUID(), definition: { name: '私人助理', instructions: 'secret instructions' } })).body.agent;

    await open(page, '我的选择'); await page.getByText('还没有保存选择').waitFor();
    await button(page, '添加选择').click(); const choose = page.getByRole('dialog', { name: '添加选择' });
    await choose.getByLabel('作用范围').selectOption({ label: 'runweft-web' }); await choose.getByLabel('Agent', { exact: true }).selectOption({ label: '代码评审 · v2' });
    await choose.getByRole('button', { name: '保存选择' }).click(); await page.getByText('选择已保存，只影响你自己').waitFor();
    await page.locator('.choice').getByText('有效').waitFor();
    await page.getByLabel('仓库', { exact: true }).selectOption({ label: 'runweft-web' }); await button(page, '解析').click();
    const outcome = page.locator('.resolution'); await outcome.getByText('代码评审 · v2').waitFor();
    expect(await outcome.innerText()).toContain('我的仓库选择'); expect(await outcome.innerText()).toContain('构建机 Codex');

    await open(page, 'Agent'); await page.locator('.rows .row').filter({ hasText: '代码评审' }).click();
    await panel(page, 'Agent 详情').getByRole('button', { name: 'Agent 操作' }).click(); await page.getByRole('menuitem', { name: '取消 Agent 登记' }).click();
    await confirmDialog(page, '取消登记'); await page.getByText('Agent 已取消登记', { exact: true }).waitFor();
    await open(page, '我的选择'); await page.locator('.choice').getByText('已保存的 Agent 当前不可调用').waitFor();
    expect(await page.locator('article.choice').innerText()).toContain('代码评审');
    await button(page, '解析').click(); await outcome.getByRole('status').or(outcome.locator('.banner')).first().waitFor();
    expect(await outcome.locator('.resolution-ok').count()).toBe(0);

    const member = await hubTab(browser); await member.page.goto(`${h.url}/hub#space=${space}`); await signIn(member.page, usernameOf(h.b.identity.id), password);
    await open(member.page, 'Agent');
    await member.page.locator(`.row[data-key="${privateAgent.id}"]`).getByText('owner的私有 Agent。你只能查看治理概要。').waitFor();
    await member.page.locator(`.row[data-key="${privateAgent.id}"]`).click(); await panel(member.page, 'Agent 详情').getByText('只能查看治理概要').waitFor();
    expect(await member.page.locator('body').innerText()).not.toContain('secret instructions');
    await panel(member.page, 'Agent 详情').getByRole('switch', { name: /停用这个 Agent/ }).click(); await confirmDialog(member.page, '停用');
    await member.page.getByText('Agent 已在此空间停用', { exact: true }).waitFor();
    await member.page.locator('.rows .row').filter({ hasText: '代码评审' }).click(); await panel(member.page, 'Agent 详情').getByText('由owner分享给你').waitFor();
    expect(await panel(member.page, 'Agent 详情').getByRole('button', { name: '编辑定义' }).count()).toBe(0);
    await expectNoOverflow(page); expect([...problems, ...member.problems]).toEqual([]);
}, 120_000);
