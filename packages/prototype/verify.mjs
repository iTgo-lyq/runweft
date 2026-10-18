import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { htmlIssues, sandboxCsp } from '../../.agents/skills/spec-trail/prototype/scripts/html.mjs';
const root = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(await readFile(join(root, 'prototype.json'), 'utf8'));
const devices = { 'pc-web': { width: 1440, height: 1000 }, ipad: { width: 834, height: 1112 }, mobile: { width: 390, height: 844 } };
const screenshots = process.argv.includes('--screenshots');
const onlyEntry = process.argv.includes('--entry') ? process.argv[process.argv.indexOf('--entry') + 1] : null;
assert(!onlyEntry || manifest.entries.some(e => e.id === onlyEntry), 'Unknown entry');
const html = new Map();
for (const entry of manifest.entries) {
  const data = await readFile(join(root, 'dist', entry.id, 'index.html'), 'utf8');
  assert.deepEqual(htmlIssues(data), [], entry.id);
  html.set(`/${entry.id}/index.html`, data);
}
const server = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/') return res.end(`<meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%}iframe{width:100%;height:100%;border:0;display:block}</style><iframe title="原型" sandbox="allow-scripts" src="/${html.has('/' + url.searchParams.get('entry') + '/index.html') ? url.searchParams.get('entry') : 'tasks'}/index.html"></iframe>`);
  if (html.has(url.pathname)) { res.setHeader('Content-Security-Policy', sandboxCsp); return res.end(html.get(url.pathname)); }
  res.writeHead(404).end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const receipt = [];
try {
  browser = await chromium.launch({ chromiumSandbox: process.env.CI !== 'true', ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  for (const entry of manifest.entries.filter(e => !onlyEntry || e.id === onlyEntry)) for (const device of entry.devices) {
    const page = await browser.newPage({ viewport: devices[device], ...(device === 'mobile' ? {isMobile: true, hasTouch: true} : {}) }), errors = [], requests = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin || request.resourceType() !== 'document') { requests.push(request.url()); return route.abort(); }
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
    assert.equal(await frame.evaluate(() => innerWidth), devices[device].width, 'Viewport matches declared device');
    const noOverflow = async () => assert(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${entry.id}/${device} horizontal overflow`);
    await noOverflow();
    assert.equal(await f.locator('#console-navigation button').count(), 8);
    assert.equal(await f.locator('#console-navigation [aria-current=page]').getAttribute('data-view'), entry.id);
    if (screenshots) await page.locator('iframe').screenshot({ path: join(root, 'dist', entry.id, `${device}.png`), animations: 'disabled' });
    const navigate = async view => {
      if (devices[device].width <= 760) await f.getByRole('button', { name: '打开导航', exact: true }).click();
      await f.locator(`#console-navigation [data-view=${view}]`).click();
    };
    const close = () => f.locator('#modal [data-action=modal-close]').first().click();
    if (entry.id === 'tasks') {
      await f.getByRole('textbox', { name: '搜索任务', exact: true }).fill('梳理仓库');
      assert.equal(await f.locator('[data-task-row]').count(), 1);
      await f.getByRole('textbox', { name: '搜索任务', exact: true }).fill('不存在的任务');
      await f.getByRole('heading', { name: '没有找到匹配的任务' }).waitFor();
      await f.locator('[data-action=clear-filters]').click();
      assert.equal(await f.locator('[data-task-row]').count(), 8);
      await f.locator('.segmented [data-status=attention]').click();
      assert.equal(await f.locator('[data-task-row]').count(), 1);
      await f.locator('[data-task=t1]').click();
      await f.locator('#detail[open]').waitFor();
      await f.locator('#detail-round').selectOption('1');
      assert((await f.locator('.report-label').innerText()).includes('第 1 轮'));
      await f.getByRole('tab', { name: '执行记录', exact: true }).click();
      assert.equal(await f.locator('.timeline > div').count(), 3);
      await f.getByRole('tab', { name: '附件', exact: false }).click();
      await f.locator('[data-action=file]').click();
      await f.getByRole('heading', { name: 'review.md', exact: true }).waitFor(); await close();
      await f.getByRole('tab', { name: '概览', exact: true }).click();
      if (screenshots) await page.locator('iframe').screenshot({ path: join(root, 'dist', entry.id, `${device}-detail.png`), animations: 'disabled' });
      await f.locator('[data-action=detail-close]').first().click();
      await f.locator('.segmented [data-status=all]').click();
      await f.locator('[data-action=demo]').click();
      await f.locator('#demo-scenario').selectOption('empty'); await close();
      await f.getByRole('heading', { name: '从第一次协作开始' }).waitFor();
      await f.locator('[data-action=demo]').click(); await f.locator('#demo-scenario').selectOption('offline'); await close();
      await f.locator('.offline-banner').waitFor();
      await f.locator('[data-action=demo]').click(); await f.locator('#demo-scenario').selectOption('error'); await close();
      await f.getByRole('heading', { name: '暂时无法加载' }).waitFor();
      await f.locator('[data-action=recover]').click(); assert.equal(await f.locator('[data-task-row]').count(), 8);
      await f.locator('[data-action=search]').click();await f.locator('#global-query').fill('身份');
      assert.equal(await f.locator('.search-result').count(), 1); await close();
    } else if (['agents','machines','runtimes','repositories'].includes(entry.id)) {
      await f.locator('.resource-card [data-action^="edit:"]').first().click();
      await f.locator('#resource-form [name=name]').fill('原型验证资源');
      await f.locator('#resource-form button[type=submit]').click();
      await f.getByRole('heading', { name: '原型验证资源', exact: true }).waitFor();
      if(entry.id==='agents') {
        await f.locator('[data-action="new:agents"]').first().click();
        await f.locator('#resource-form [name=name]').fill('新增助手');
        await f.locator('#resource-form button[type=submit]').click();
        assert.equal(await f.locator('.resource-card').count(), 4);
      }
    } else if(entry.id==='members') {
      await f.locator('[data-action=invite]').first().click();
      await f.locator('#invite-form [name=name]').fill('设计团队同伴');
      await f.locator('#invite-form [name=role]').selectOption({label:'管理员'});
      await f.locator('#invite-form button[type=submit]').click();
      await f.getByRole('heading', {name:'邀请已生成'}).waitFor(); await close();
      assert((await f.locator('.invite-list').innerText()).includes('设计团队同伴'));
      await f.locator('[data-action="revoke:0"]').click();
      await f.getByText('没有待接受的邀请', {exact:true}).waitFor();
    } else if(entry.id==='identity') {
      await f.locator('[data-action=rename]').click();
      await f.locator('#rename-form input').fill('原型体验者');
      await f.locator('#rename-form button[type=submit]').click();
      assert.equal(await f.locator('#identity-name').innerText(),'原型体验者');
      await f.locator('[data-action=new-space]').click();
      await f.locator('#space-form input').fill('新的协作空间');
      await f.locator('#space-form button[type=submit]').click();
      assert((await f.locator('.breadcrumb').innerText()).includes('新的协作空间'));
      await navigate('tasks');await f.getByRole('heading',{name:'从第一次协作开始'}).waitFor();
    } else if(entry.id==='selections') {
      await f.locator('#selection-form [name=agent]').selectOption('前端协作助手');
      await f.locator('#selection-form button[type=submit]').click();
      await f.locator('[data-action=resolve]').click();
      await f.locator('.resolution').getByRole('heading',{name:'前端协作助手'}).waitFor();await close();
    }
    await navigate('tasks'); await f.locator('.task-list').waitFor();
    await noOverflow();
    assert.deepEqual(errors, [], `${entry.id}/${device} errors`);
    assert.deepEqual(requests, [], `${entry.id}/${device} network`);
    receipt.push({ entry: entry.id, device, passed: true });console.log(`PASS ${entry.id}/${device}`);
    await page.close();
  }
  await writeFile(join(root,'dist','verification.json'),JSON.stringify({flows:receipt,isolation:'opaque iframe; no external requests; no persistent storage',screenshots},null,2)+'\n');
  console.log(`${receipt.length} opaque-iframe viewport flows passed; critical interactions, no service requests or browser errors.`);
} finally {await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
