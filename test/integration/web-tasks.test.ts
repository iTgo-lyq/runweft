import { afterEach, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { hubDelegationFixture } from './hub-delegation-fixture';
import { fixtureCleanup } from '../fixture-cleanup';
import { until } from '../helpers';
import { button, expectNoOverflow, hubTab, signIn, viewports } from './hub-web';
const owner = fixtureCleanup([]); afterEach(() => owner.close());
const next = (id: string) => ({ requestId: randomUUID(), intent: { id, mode: 'next', message: 'Continue' } });

test('the tasks page filters and finds tasks, reads every round in the inspector and keeps the link in step', async () => {
    const h = await hubDelegationFixture(owner.resources);
    const first = await h.post('spawn', h.payload()), read = (id: string) => h.post('read', { id });
    const started = await until(() => read(first.agent_id), value => value.inputs[0]?.observation?.phase === 'accepted');
    const long = Array.from({ length: 1600 }, (_, line) => `第 ${line + 1} 行：评审意见。`).join('\n');
    h.complete(started.session_id, `FIRST_ROUND_REPORT <img src=x onerror=alert(1)>\n${long}\nFIRST_ROUND_END`);
    await until(() => read(first.agent_id), value => value.status === 'completed');
    await h.post('send', next(first.agent_id));
    const resumed = await until(() => read(first.agent_id), value => value.round_id !== started.round_id && value.inputs[0]?.observation?.phase === 'accepted');
    h.complete(resumed.session_id, 'SECOND_ROUND_REPORT');
    await until(() => read(first.agent_id), value => value.status === 'completed');
    const second = await h.post('spawn', h.payload());
    await until(() => read(second.agent_id), value => value.inputs[0]?.observation?.phase === 'accepted');

    const username = (h.hub.db.query('SELECT username FROM hub_accounts WHERE userId=?').get(h.owner.identity.id) as { username: string }).username;
    const browser = await chromium.launch({ headless: true }); owner.resources.push(() => browser.close());
    const { page, problems } = await hubTab(browser); let alerts = 0; page.on('dialog', dialog => { alerts++; void dialog.dismiss(); });
    await page.goto(h.url + '/hub'); await signIn(page, username, 'synthetic unknown-account comparison');
    const rows = page.getByRole('list', { name: '任务列表' }).locator('.row'), inspector = page.getByRole('complementary', { name: '任务详情' });
    await rows.first().waitFor(); expect(await rows.count()).toBe(2);
    expect(await rows.first().getAttribute('data-key')).toBe(second.agent_id);
    expect(await page.locator('.list-meta').innerText()).toContain('你的任务 2 个');

    await page.getByRole('radio', { name: '已完成' }).click(); await page.waitForFunction(() => document.querySelectorAll('.rows .row').length === 1);
    expect(await rows.first().getAttribute('data-key')).toBe(first.agent_id);
    await page.getByRole('radio', { name: '全部' }).click(); await page.waitForFunction(() => document.querySelectorAll('.rows .row').length === 2);
    await page.keyboard.press('/'); await page.keyboard.type('second_round');
    await page.getByText('在这一页的 2 个任务中找到 1 个').waitFor(); expect(await rows.count()).toBe(1);
    await page.getByLabel('在本页查找').fill('');

    await page.locator(`.row[data-key="${first.agent_id}"]`).click();
    await inspector.locator('.task-report').getByText('SECOND_ROUND_REPORT', { exact: true }).waitFor();
    expect(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('task')).toBe(first.agent_id);
    expect(await inspector.locator('.weft button').count()).toBe(2);
    await inspector.getByRole('button', { name: /第 1 轮/ }).click();
    await inspector.locator('.task-report').getByText(/^FIRST_ROUND_REPORT/).waitFor();
    expect(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('round')).toBe(started.round_id);
    expect(await inspector.locator('.task-report img').count()).toBe(0);
    const segments = inspector.getByRole('navigation', { name: '报告分段' });
    expect(await segments.getByRole('button', { name: '上一段' }).isDisabled()).toBe(true);
    await segments.getByRole('button', { name: '下一段' }).click(); await inspector.locator('.task-report').getByText(/FIRST_ROUND_END$/).waitFor();
    expect(await page.evaluate(() => document.activeElement?.classList.contains('task-report'))).toBe(true);
    expect(await segments.getByRole('button', { name: '下一段' }).isDisabled()).toBe(true);

    await inspector.getByRole('tab', { name: '交付' }).click();
    await inspector.getByText('没有声明附件').waitFor(); await inspector.getByText('不交付代码').waitFor();
    await inspector.getByRole('tab', { name: '详情' }).click();
    await inspector.getByText(started.round_id, { exact: true }).waitFor();
    await inspector.getByText('本轮 Agent 配置快照').click(); expect(await inspector.locator('pre.code-block').first().innerText()).toContain('Central reviewer');
    await inspector.getByRole('tab', { name: '继续处理' }).click();
    const prompt = await inspector.locator('pre.prompt').innerText();
    expect(prompt).toContain(first.agent_id); expect(prompt).toContain(started.round_id); expect(prompt).toContain(h.url);

    await page.keyboard.press('Escape'); await inspector.waitFor({ state: 'hidden' });
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-key'))).toBe(first.agent_id);
    expect(new URL(page.url()).hash).not.toContain('task=');

    await button(page, '筛选').click(); const filters = page.getByRole('dialog', { name: '筛选任务' });
    await filters.getByLabel('来源工作目录包含').fill('no-such-directory'); await filters.getByRole('button', { name: '应用筛选' }).click();
    await page.getByText('没有符合条件的任务').waitFor(); await button(page, '筛选 · 1').waitFor();
    await page.getByRole('button', { name: '清除“工作目录包含”' }).click(); await rows.nth(1).waitFor();

    await page.goto(`${h.url}/hub#space=${h.space}&task=${first.agent_id}&round=${started.round_id}`);
    await inspector.locator('.task-report').getByText(/^FIRST_ROUND_REPORT/).waitFor();
    await page.setViewportSize(viewports.phone); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await inspector.getByRole('button', { name: '关闭详情' }).click(); await expectNoOverflow(page);
    expect(alerts).toBe(0); expect(problems).toEqual([]);
}, 90_000);
