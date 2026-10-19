import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { htmlIssues, sandboxCsp } from '../../.agents/skills/spec-trail/prototype/scripts/html.mjs';
const root = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(await readFile(join(root, 'prototype.json'), 'utf8'));
const devices = { 'pc-web': { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };
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
  browser = await chromium.launch({ // GitHub's Ubuntu runner restricts unprivileged user namespaces.
    chromiumSandbox: process.env.CI !== 'true', ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  for (const entry of manifest.entries) for (const device of entry.devices.filter(device => device !== 'ipad')) {
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
    if (screenshots) {
      if (device === 'mobile' && !['identity', 'account-onboarding'].includes(entry.id)) await f.locator('.space-content').scrollIntoViewIfNeeded();
      await page.locator('iframe').screenshot({ path: join(root, 'dist', entry.id, `${device}.png`), animations: 'disabled' });
    }
    const button = label => f.getByRole('button', { name: label, exact: true });
    if (entry.id === 'account-onboarding') {
      await f.getByLabel('用户名', { exact: true }).fill('demo-user');
      await f.getByLabel('密码', { exact: true }).fill('a demo passphrase with spaces');
      await button('注册并连接').click();
      await f.getByRole('heading', { name: '可以返回原对话了' }).waitFor();
      await button('已有账号').click();
      await button('演示：多个空间').click();
      await f.getByLabel('默认工作空间').selectOption({ label: '产品团队' });
      await f.getByLabel('密码', { exact: true }).fill('a demo passphrase with spaces');
      await button('登录并连接').click();
      await f.getByRole('heading', { name: '可以返回原对话了' }).waitFor();
      await button('请求过期').click();
      await f.getByRole('heading', { name: '这个连接请求已过期' }).waitFor();
      await button('忘记密码').click();
      await f.getByLabel('一次性重置码', { exact: true }).fill('demo');
      await f.getByLabel('新密码', { exact: true }).fill('a new demo passphrase');
      await button('重置密码').click();
      await f.getByText('密码已更新，请使用新密码登录。', { exact: true }).waitFor();
      await button('账号设置').click();
      await button('断开环境').click();
      await f.locator('#confirm[open]').waitFor();
      await f.locator('#confirm').getByRole('button', { name: '断开环境', exact: true }).click();
      await f.getByText('命令行 · 已断开', { exact: true }).waitFor();
      await f.getByLabel('当前密码', { exact: true }).fill('a demo passphrase with spaces');
      await f.getByLabel('新密码', { exact: true }).fill('a changed demo passphrase');
      await button('修改密码并退出全部环境').click();
      await f.getByText('密码已更新，请使用新密码登录。', { exact: true }).waitFor();
      await button('账号设置').click();
      await button('退出全部环境').click();
      await f.getByLabel('当前密码', { exact: true }).fill('a changed demo passphrase');
      await button('确认退出全部环境').click();
      await button('首次工作台').click();
      await f.getByRole('heading', { name: '还没有任务' }).waitFor();
    } else if (entry.id === 'identity') {
      await f.locator('#new-name').fill('原型体验者'); await button('领取身份 token').click();
      await f.locator('#secret-dialog[open]').waitFor(); await button('关闭').click();
      assert.equal(await f.locator('#identity-name').innerText(), '原型体验者');
    } else {
      await f.locator('#console-navigation').getByRole('button', { name: '任务', exact: true }).click();
      await f.locator('.task-list').waitFor();
      if (entry.id === 'tasks') {
        await button('查看任务详情').first().click();
        await f.locator('.task-detail').waitFor();
        await button('返回任务列表').click();
      }
    }
    assert.deepEqual(errors, [], `${entry.id}/${device} errors`); assert.deepEqual(requests, [], `${entry.id}/${device} network`);
    receipt.push(`${entry.id}/${device}`); console.log(`PASS ${entry.id}/${device}`); await page.close();
  }
  console.log(`${receipt.length} opaque-iframe viewport flows passed; no service requests or browser errors.`);
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
