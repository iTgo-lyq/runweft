import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { htmlIssues, sandboxCsp } from '../../.agents/skills/spec-trail/prototype/scripts/html.mjs';
const root = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(await readFile(join(root, 'prototype.json'), 'utf8'));
const devices = { 'pc-web': { width: 1440, height: 900 }, ipad: { width: 834, height: 1194 }, mobile: { width: 390, height: 844 } };
const screenshots = process.argv.includes('--screenshots');
const html = new Map();
for (const entry of manifest.entries) { const data = await readFile(join(root, 'dist', entry.id, 'index.html'), 'utf8'); assert.deepEqual(htmlIssues(data), [], entry.id); html.set(`/${entry.id}/index.html`, data); }
const server = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/') return res.end(`<style>html,body{margin:0;height:100%}iframe{width:100%;height:100%;border:0;display:block}</style><iframe title="原型" sandbox="allow-scripts" src="/${html.has('/' + url.searchParams.get('entry') + '/index.html') ? url.searchParams.get('entry') : 'tasks'}/index.html"></iframe>`);
  if (html.has(url.pathname)) { res.setHeader('Content-Security-Policy', sandboxCsp); return res.end(html.get(url.pathname)); }
  res.writeHead(404).end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const receipt = [];
try {
  browser = await chromium.launch({ chromiumSandbox: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  for (const entry of manifest.entries) for (const device of entry.devices) {
    const page = await browser.newPage({ viewport: devices[device] }), errors = [], requests = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.route('**/*', route => {
      const r = route.request(), url = new URL(r.url());
      if (url.origin !== origin || !['document'].includes(r.resourceType())) { requests.push(r.url()); return route.abort(); }
      return route.continue();
    });
    await page.goto(`${origin}/?entry=${entry.id}`);
    const f = page.frameLocator('iframe');
    await f.locator('body[data-ready=true]').waitFor();
    const frame = page.frames().find(f => f.parentFrame());
    assert.equal(await frame.evaluate(() => { try { void sessionStorage.length; return 'allowed'; } catch { return 'opaque'; } }), 'opaque');
    const handshake = await page.evaluate(async () => {
      const reply = new Promise(resolve => window.addEventListener('message', function handler(e) { if (e.source === document.querySelector('iframe').contentWindow && e.data?.requestId === 'smoke-ready') { window.removeEventListener('message', handler); resolve(e.data); } }));
      document.querySelector('iframe').contentWindow.postMessage({ type: 'openfolio:preview:init', requestId: 'smoke-ready' }, '*');
      return Promise.race([reply, new Promise(resolve => setTimeout(() => resolve(null), 3000))]);
    });
    assert.equal(handshake?.status, 'ready'); assert.equal(handshake?.version, 'local-preview');
    assert(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${entry.id}/${device} horizontal overflow`);
    if (screenshots) await page.locator('iframe').screenshot({ path: join(root, 'dist', entry.id, `${device}.png`), animations: 'disabled' });
    const button = label => f.getByRole('button', { name: label, exact: true });
    const open = label => f.locator('summary').filter({ hasText: new RegExp('^' + label + '$') }).first().click();
    const confirm = () => f.locator('#confirm-dialog').getByRole('button', { name: '确认', exact: true }).click();
    if (entry.id === 'identity') {
      await f.locator('#new-name').fill('原型体验者'); await button('领取身份 token').click(); await f.locator('#secret-dialog[open]').waitFor(); await button('关闭').click();
      assert.equal(await f.locator('#identity-name').innerText(), '原型体验者');
      await open('创建协作空间'); await f.locator('#new-space-name').fill('新演示空间'); await button('创建空间').click();
      await f.getByRole('heading', { name: '新演示空间', exact: true }).waitFor();
      await button('退出此浏览器').click(); await f.locator('#import-token').fill('demo'); await f.locator('#import-token').press('Enter'); await f.locator('#workspace:visible').waitFor();
    } else if (entry.id === 'tasks') {
      await f.getByLabel('每页任务数', { exact: true }).selectOption('10'); await button('应用筛选').click(); await button('下一页任务').click(); assert.equal(await f.locator('[data-task-id]').count(), 2);
      await button('上一页任务').click(); await button('查看任务详情').first().click(); await f.getByLabel('查看轮次', { exact: true }).selectOption('round-1');
      await f.getByRole('heading', { name: '代码审阅助手 · 第 1 轮', exact: true }).waitFor();
      await button('下一段报告').click(); await button('上一段报告').click();
      await button('打开原生详情 / 审批').click(); await f.locator('#secret-dialog[open]').waitFor(); await button('关闭').click(); await button('返回任务列表').click();
      await f.getByLabel('任务状态', { exact: true }).selectOption('failed'); await button('应用筛选').click(); await f.getByText('没有匹配的本人任务。调整筛选条件后重试。', { exact: true }).waitFor();
    } else if (entry.id === 'machines') {
      await open('修改机器名称'); await f.getByLabel('机器名称', { exact: true }).fill('新工作站'); await button('保存机器名称').click(); await f.getByRole('heading', { name: '新工作站', exact: true }).waitFor();
      await button('探测原生工具').click(); assert.match(await f.locator('.inspection-output').innerText(), /codex/);
      await button('取消机器登记').click(); await confirm(); await button('恢复机器登记').click(); await button('取消机器登记').waitFor();
    } else if (entry.id === 'runtimes') {
      await open('登记 Runtime'); await f.getByLabel('原生工具', { exact: true }).selectOption('claude'); await f.getByLabel('Runtime 名称（可选）', { exact: true }).fill('演示 Claude'); await button('登记 Runtime').click(); await f.getByRole('heading', { name: '演示 Claude', exact: true }).waitFor();
      await button('检查 Runtime').first().click(); assert.match(await f.locator('#notice').innerText(), /工具发现：是/);
    } else if (entry.id === 'agents') {
      await open('创建 Agent'); await f.getByLabel('Agent 名称', { exact: true }).first().fill('原型审阅员'); await button('创建 Agent').click();
      const card = f.locator('.resource-card').filter({ has: f.getByRole('heading', { name: '原型审阅员', exact: true }) }); await card.waitFor();
      await card.locator('summary').filter({ hasText: '编辑定义' }).click(); await card.getByLabel('用途说明', { exact: true }).fill('演示版本更新'); await card.getByRole('button', { name: '保存新版本', exact: true }).click();
      await card.getByRole('button', { name: '查看版本历史', exact: true }).click(); assert.match(await card.locator('.version-history').innerText(), /v2/);
      await card.locator('summary').filter({ hasText: '管理 Agent 分享' }).click(); await card.getByLabel('分享范围', { exact: true }).selectOption('space'); await card.getByRole('button', { name: '保存分享范围', exact: true }).click(); await confirm(); await card.locator('.facts').getByText('空间成员', { exact: true }).waitFor();
    } else if (entry.id === 'repositories') {
      await open('登记仓库'); await f.getByLabel('仓库名称', { exact: true }).fill('原型仓库'); await button('登记仓库').click();
      const card = f.locator('.resource-card').filter({ has: f.getByRole('heading', { name: '原型仓库', exact: true }) }); await card.waitFor();
      await card.locator('summary').filter({ hasText: '修改仓库目录' }).click(); await card.getByLabel('添加 Git remote 别名', { exact: true }).fill('https://example.com/team/new.git'); await card.getByRole('button', { name: '添加别名', exact: true }).click(); await card.locator('.alias-list').filter({ hasText: 'new.git' }).waitFor();
    } else if (entry.id === 'selections') {
      await f.getByLabel('个人 Runtime override', { exact: true }).selectOption('runtime-1'); await button('保存我的选择').click();
      await open('验证我的选择'); await button('解析当前配置').click(); await f.locator('.resolution-result').filter({ hasText: 'machine-1' }).waitFor();
      await f.getByLabel('场景', { exact: true }).selectOption('offline'); await open('验证我的选择'); await button('解析当前配置').click(); await f.locator('#notice').filter({ hasText: 'Runtime 不可用' }).waitFor();
    } else if (entry.id === 'members') {
      await button('设为管理员').click(); await button('设为成员').waitFor();
      await button('生成邀请').click(); await f.locator('#secret-dialog[open]').waitFor(); await button('关闭').click(); await button('撤销邀请').click(); assert.equal(await f.locator('#invitations p').count(), 0);
      await button('移除成员').click(); await confirm(); await f.locator('#member-count').filter({ hasText: /^1$/ }).waitFor();
    }
    // All resource pages must recover from a simulated request failure and show empty state.
    if (!['identity', 'members'].includes(entry.id)) {
      await f.getByLabel('场景', { exact: true }).selectOption('error'); await f.locator('#notice').filter({ hasText: '演示：Hub 暂时不可用' }).waitFor();
      await f.getByLabel('场景', { exact: true }).selectOption('empty'); await f.locator('.empty-state').first().waitFor();
      await f.getByLabel('场景', { exact: true }).selectOption('normal');
    }
    assert.deepEqual(errors, [], `${entry.id}/${device} errors`); assert.deepEqual(requests, [], `${entry.id}/${device} network`);
    receipt.push(`${entry.id}/${device}`); console.log(`PASS ${entry.id}/${device}`); await page.close();
  }
  console.log(`${receipt.length} opaque-iframe viewport flows passed; no service requests or browser errors.`);
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
