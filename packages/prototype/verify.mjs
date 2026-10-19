import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { htmlIssues, sandboxCsp } from '../../.agents/skills/spec-trail/prototype/scripts/html.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(await readFile(join(root, 'prototype.json'), 'utf8'));
const devices = {
  'pc-web': { viewport: { width: 1440, height: 1000 } },
  ipad: { viewport: { width: 834, height: 1112 }, hasTouch: true },
  mobile: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
};
const screenshots = process.argv.includes('--screenshots');
const html = new Map();
for (const entry of manifest.entries) {
  const data = await readFile(join(root, 'dist', entry.id, 'index.html'), 'utf8');
  assert.deepEqual(htmlIssues(data), [], entry.id);
  html.set(`/${entry.id}/index.html`, data);
}
const server = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/') {
    const entry = html.has(`/${url.searchParams.get('entry')}/index.html`) ? url.searchParams.get('entry') : 'tasks';
    return res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%}iframe{width:100%;height:100%;border:0;display:block}</style><iframe title="原型" sandbox="allow-scripts" src="/${entry}/index.html"></iframe>`);
  }
  if (html.has(url.pathname)) { res.setHeader('Content-Security-Policy', sandboxCsp); return res.end(html.get(url.pathname)); }
  res.writeHead(404).end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

// ---- helpers -------------------------------------------------------------------------
function tools(page, f, device) {
  const touch = device !== 'pc-web';
  const press = async locator => (touch ? locator.tap() : locator.click());
  const button = (name, scope = f) => scope.getByRole('button', { name, exact: true });
  const dialog = () => f.locator('dialog[open]');
  const toast = text => f.locator('.toast', { hasText: text }).first().waitFor();
  const heading = name => f.getByRole('heading', { name, exact: true }).first().waitFor();
  const demo = async (group, option) => {
    await press(button('演示'));
    const panel = f.getByRole('dialog', { name: '演示设置' });
    await press(panel.getByRole('radiogroup', { name: group }).getByRole('radio', { name: option, exact: true }));
    if (await panel.isVisible()) await page.keyboard.press('Escape');
  };
  const nav = async label => {
    if (device === 'mobile') await press(button('打开导航'));
    await press(f.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: label, exact: true }));
    await heading(label);
  };
  const confirm = async label => { await press(button(label, dialog())); await dialog().waitFor({ state: 'detached' }); };
  const row = key => f.locator(`.row[data-key="${key}"]`);
  const panel = () => f.locator('aside.panel:not([hidden])');
  const frame = () => page.frames().find(x => x.parentFrame());
  // On tablet and phone the inspector is a sheet over the list; close it before reaching the list again.
  const reveal = async () => { if (touch && await panel().isVisible()) { await press(button('关闭详情', panel())); await panel().waitFor({ state: 'detached' }); } };
  const openRow = async key => { await reveal(); await press(row(key)); };
  return { press, button, dialog, toast, heading, demo, nav, confirm, row, panel, frame, reveal, openRow };
}

async function accountFlow(t, f) {
  await t.heading('第一次使用 Runweft');
  await f.getByLabel('用户名', { exact: true }).fill('demo-user');
  await f.getByLabel('密码', { exact: true }).fill('a demo passphrase with spaces');
  await t.press(t.button('注册并连接'));
  await t.heading('可以返回原对话了');
  await t.press(t.button('查看工作台'));
  await t.heading('还没有任务');
  await t.demo('账号场景', '已有账号（多个空间）');
  await f.getByLabel('连接后默认使用的空间').selectOption({ label: '个人实验' });
  await f.getByLabel('密码', { exact: true }).fill('a demo passphrase with spaces');
  await t.press(t.button('登录并连接'));
  await t.heading('可以返回原对话了');
  await t.demo('账号场景', '连接请求过期');
  await t.heading('这个连接请求已过期');
  await t.press(t.button('用账号登录'));
  await t.heading('欢迎回来');
  await t.press(t.button('忘记密码？'));
  await f.getByLabel('一次性重置码', { exact: true }).fill('wrong');
  await f.getByLabel('新密码', { exact: true }).fill('a new demo passphrase');
  await t.press(t.button('重置密码'));
  await f.locator('.banner', { hasText: '重置码不正确' }).waitFor();
  await f.getByLabel('一次性重置码', { exact: true }).fill('demo');
  await t.press(t.button('重置密码'));
  await f.locator('.banner', { hasText: '密码已更新' }).waitFor();
  await t.demo('账号场景', '账号设置');
  await t.heading('账号设置');
  await t.press(f.locator('.line', { hasText: '构建服务器 bj-04' }).getByRole('button', { name: '断开' }));
  await t.confirm('断开环境');
  await f.locator('.line', { hasText: '构建服务器 bj-04' }).getByText('命令行 · 已断开').waitFor();
  await f.getByLabel('当前密码', { exact: true }).fill('a demo passphrase with spaces');
  await f.getByLabel('新密码', { exact: true }).fill('a changed demo passphrase');
  await t.press(t.button('修改密码并退出全部环境'));
  await t.heading('欢迎回来');
  await f.locator('.banner', { hasText: '密码已更新' }).waitFor();
  await f.getByLabel('密码', { exact: true }).fill('a changed demo passphrase');
  await t.press(t.button('登录'));
  await t.heading('任务');
}

async function taskFlow(t, f, page, device) {
  await t.heading('任务');
  await t.row('task-a41e').waitFor();
  // Server order: attention and unconfirmed first.
  assert.equal(await f.locator('.task-row').first().getAttribute('data-key'), 'task-a41e');
  await t.press(t.row('task-91f0'));
  await t.panel().getByRole('heading', { name: '代码审阅' }).waitFor();
  assert.equal(await t.row('task-91f0').getAttribute('data-opened'), 'true');
  const pager = t.panel().locator('.reading .pager-text');
  const before = await pager.innerText();
  await t.press(t.button('下一段', t.panel()));
  await t.panel().locator('.reading .pager-text', { hasNotText: before }).waitFor();
  await t.press(t.panel().locator('.weft button', { hasText: '第 1 轮' }));
  await t.panel().getByText('第 1 轮：发现 4 处问题，已列出具体位置。').waitFor();
  for (const tab of ['交付', '详情', '继续处理']) { await t.press(t.panel().getByRole('tab', { name: tab })); await t.panel().getByRole('tab', { name: tab, selected: true }).waitFor(); }
  await t.panel().locator('.prompt', { hasText: 'task show' }).waitFor();
  await t.press(t.button('打开原生会话', t.panel()));
  await t.dialog().getByRole('heading', { name: '原生会话' }).waitFor();
  await page.keyboard.press('Escape');
  await t.dialog().waitFor({ state: 'detached' });
  if (device === 'pc-web') {
    // Escape closes the inspector and returns focus to the row that opened it.
    await t.panel().getByRole('heading', { name: '代码审阅' }).focus();
    await page.keyboard.press('Escape');
    await t.panel().waitFor({ state: 'detached' });
    assert.equal(await t.frame().evaluate(() => document.activeElement?.dataset?.key), 'task-91f0');
    await page.keyboard.press('ArrowDown');
    assert.equal(await t.frame().evaluate(() => document.activeElement?.dataset?.key), 'task-2d8c');
    await page.keyboard.press('Enter');
    await t.panel().getByRole('heading', { name: '功能实现' }).waitFor();
  }
  await t.press(t.button('关闭详情', t.panel()));
  await t.panel().waitFor({ state: 'detached' });
  await t.press(f.getByRole('radiogroup', { name: '按状态筛选' }).getByRole('radio', { name: '需要处理' }));
  await f.locator('.list-meta', { hasText: '符合条件的任务 1 个' }).waitFor();
  await t.press(f.getByRole('radiogroup', { name: '按状态筛选' }).getByRole('radio', { name: '全部' }));
  await f.locator('.list-meta', { hasText: '你的任务 14 个' }).waitFor();
  await f.getByRole('searchbox', { name: '在本页查找' }).fill('远端');
  await f.locator('.list-note', { hasText: '找到 3 个' }).waitFor();
  await f.getByRole('searchbox', { name: '在本页查找' }).fill('');
  await t.press(t.button('筛选'));
  const filters = f.getByRole('dialog', { name: '筛选任务' });
  await filters.getByLabel('来源工作目录包含').fill('hub-service');
  await filters.getByLabel('每页数量').selectOption('10');
  await t.press(t.button('应用筛选', filters));
  await f.locator('.token', { hasText: 'hub-service' }).waitFor();
  await f.locator('.list-meta', { hasText: '符合条件的任务 5 个' }).waitFor();
}

async function machineFlow(t, f) {
  await t.heading('机器');
  await t.press(t.row('machine-3f8a'));
  await t.panel().getByRole('heading', { name: '林舟的 MacBook Pro' }).waitFor();
  await t.press(t.button('探测原生工具', t.panel()));
  await t.panel().locator('.tool-list', { hasText: 'Claude Code' }).waitFor();
  await t.press(t.panel().getByRole('switch', { name: '个人实验', exact: true }));
  await t.confirm('撤回关联');
  await t.toast('已撤回“个人实验”的关联');
  await t.panel().locator('.switch[aria-checked=false]').first().waitFor();
  await t.press(t.button('修改机器名称', t.panel()));
  await t.panel().getByLabel('机器名称').fill('林舟的笔记本');
  await t.press(t.button('保存', t.panel()));
  await t.toast('机器名称已保存');
  await t.demo('我在“产品协作”的角色', '成员');
  await t.openRow('machine-6d4e');
  await t.panel().getByText('这是陈雨的机器').waitFor();
  assert.equal(await t.panel().getByRole('switch').count(), 0);
}

async function runtimeFlow(t, f) {
  await t.heading('Runtime');
  await t.press(t.button('登记 Runtime'));
  await t.dialog().getByLabel('执行机器').selectOption({ label: '测试机 lab-02 · 尚未首次连接' });
  await t.press(t.button('登记 Runtime', t.dialog()));
  await t.dialog().locator('.banner', { hasText: '机器不在线，无法登记' }).waitFor();
  await t.dialog().getByLabel('执行机器').selectOption({ label: '构建服务器 bj-04 · 在线' });
  await t.press(t.dialog().getByRole('radio', { name: 'Claude Code' }));
  await t.press(t.button('登记 Runtime', t.dialog()));
  await t.toast('Runtime 已登记');
  await t.panel().getByRole('heading', { name: '构建服务器 bj-04 · Claude Code' }).waitFor();
  await t.press(t.button('检查 Runtime', t.panel()));
  await t.panel().locator('.banner', { hasText: '找到 Claude Code' }).waitFor();
  assert.equal(await t.panel().getByRole('switch', { name: '个人实验', exact: true }).isDisabled(), true);
  await t.press(t.panel().getByRole('switch', { name: '产品协作', exact: true }));
  await t.confirm('共享');
  await t.toast('已共享到“产品协作”');
}

async function agentFlow(t, f) {
  await t.heading('Agent');
  await t.press(t.row('agent-review'));
  await t.panel().getByRole('heading', { name: '代码审阅' }).waitFor();
  await t.press(t.button('编辑定义', t.panel()));
  await t.panel().getByLabel('名称', { exact: true }).fill('代码审阅（严格）');
  await t.press(t.button('保存为 v4', t.panel()));
  await t.toast('已保存为 v4');
  await t.press(t.panel().getByRole('tab', { name: '版本历史' }));
  await t.panel().locator('.versions summary', { hasText: 'v4' }).waitFor();
  await t.press(t.panel().getByRole('tab', { name: '分享' }));
  await t.press(t.panel().getByRole('radio', { name: '指定成员' }));
  await t.panel().getByLabel('周北').check();
  await t.press(t.button('保存分享范围', t.panel()));
  await t.confirm('保存');
  await t.toast('分享范围已保存');
  await t.openRow('agent-release');
  await t.panel().getByText('只能查看治理概要').waitFor();
  await t.reveal();
  await t.press(t.button('创建 Agent'));
  await t.panel().getByLabel('名称', { exact: true }).fill('文档整理');
  await t.press(t.button('创建 Agent', t.panel()));
  await t.toast('Agent 已创建');
}

async function repositoryFlow(t, f) {
  await t.heading('仓库');
  await t.press(t.row('repo-web'));
  await t.panel().getByRole('heading', { name: 'runweft-web' }).waitFor();
  await t.panel().getByLabel('添加 Git 别名').fill('not a remote');
  await t.press(t.button('添加别名', t.panel()));
  await t.panel().locator('.banner', { hasText: '这不是可识别的 Git 地址' }).waitFor();
  await t.panel().getByLabel('添加 Git 别名').fill('git@gitlab.example.com:team/runweft-web.git');
  await t.press(t.button('添加别名', t.panel()));
  await t.toast('别名已添加');
  await t.press(t.button('移除别名 https://github.com/example/runweft-web', t.panel()));
  await t.confirm('移除');
  await t.toast('别名已移除');
  await t.reveal();
  await t.press(t.button('登记仓库'));
  await t.dialog().getByLabel('仓库名称').fill('docs-site');
  await t.press(t.button('登记仓库', t.dialog()));
  await t.toast('仓库已登记');
}

async function selectionFlow(t, f) {
  await t.heading('我的选择');
  const card = () => f.locator('.choice', { hasText: 'hub-service' });
  await card().getByText('已保存的 Agent 当前不可调用').waitFor();
  await t.press(card().getByRole('button', { name: '修改' }));
  await t.dialog().getByLabel('Agent', { exact: true }).selectOption({ label: '远端测试 · v2' });
  await t.press(t.button('保存选择', t.dialog()));
  await t.toast('选择已保存');
  await card().getByText('有效').waitFor();
  await f.getByLabel('仓库', { exact: true }).selectOption({ label: 'hub-service' });
  await t.press(t.button('解析'));
  await f.locator('.resolution', { hasText: '我的仓库选择' }).waitFor();
  await f.getByLabel('显式 Runtime（可选）').selectOption({ label: 'MacBook · Codex' });
  await t.press(t.button('解析'));
  await f.locator('.resolution .banner', { hasText: 'Runtime 类型与 Agent 不匹配' }).waitFor();
}

async function memberFlow(t, f) {
  await t.heading('成员');
  await t.press(t.button('邀请成员').first());
  await t.press(t.dialog().getByRole('radio', { name: '管理员' }));
  await t.press(t.button('生成邀请', t.dialog()));
  await t.dialog().locator('.secret-value', { hasText: 'rw_inv_demo' }).waitFor();
  await t.press(t.button('完成', t.dialog()));
  await t.dialog().waitFor({ state: 'detached' });
  await f.locator('.line', { hasText: '管理员邀请' }).first().waitFor();
  await t.press(t.button('周北 的操作'));
  await t.press(f.getByRole('menuitem', { name: '设为管理员' }));
  await t.toast('周北 已设为管理员');
  assert.equal(await t.button('退出空间').isDisabled(), true);
  await t.demo('我在“产品协作”的角色', '管理员');
  await t.press(t.button('邀请成员').first());
  assert.equal(await t.dialog().getByRole('radio').count(), 1);
  await t.press(t.button('取消', t.dialog()));
  await t.demo('我在“产品协作”的角色', '成员');
  await t.heading('成员');
  assert.equal(await t.button('邀请成员').count(), 0);
  assert.equal(await t.button('退出空间').isDisabled(), false);
}

// Scenario, theme and preference checks on one desktop page.
async function scenarioFlow(t, f, page, client) {
  await t.heading('任务');
  await t.demo('数据场景', '空数据');
  await t.heading('还没有任务');
  await t.demo('数据场景', '首次加载失败');
  await t.heading('无法读取任务');
  await t.demo('数据场景', '刷新失败');
  await f.locator('.banner', { hasText: '刷新失败：无法连接 Hub' }).waitFor();
  assert.ok(await f.locator('.task-row').count() > 0, 'refresh failure keeps loaded tasks');
  await t.demo('数据场景', '离线或结果未知');
  await f.locator('.banner', { hasText: '机器状态暂时无法读取' }).waitFor();
  await t.nav('机器');
  await t.press(t.row('machine-b210'));
  await t.press(t.panel().getByRole('switch', { name: '在“产品协作”停用这台机器' }));
  await t.confirm('停用');
  await f.locator('.page-alert .banner', { hasText: '结果还没有确认' }).waitFor();
  await t.demo('数据场景', '登录过期');
  await t.heading('欢迎回来');
  await f.locator('.banner', { hasText: '登录已失效' }).waitFor();
  await f.getByLabel('密码', { exact: true }).fill('a demo passphrase with spaces');
  await t.press(t.button('登录'));
  await t.heading('机器');
  // Dialogs close with Escape and return focus to their trigger.
  await t.button('接入新环境').focus();
  await page.keyboard.press('Enter');
  await t.dialog().getByRole('heading', { name: '让 Agent 帮你接入' }).waitFor();
  await page.keyboard.press('Escape');
  await t.dialog().waitFor({ state: 'detached' });
  assert.equal(await t.frame().evaluate(() => document.activeElement?.textContent), '接入新环境');
  // Theme follows the system and can be switched in the demo controls.
  await t.demo('外观', '深色');
  assert.equal(await f.locator('html').getAttribute('data-theme'), 'dark');
  await t.demo('外观', '跟随系统');
  // Reduced transparency removes the blur; reduced motion removes the inspector animation.
  await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
  await t.frame().evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const style = await t.frame().evaluate(() => ({ blur: getComputedStyle(document.querySelector('.toolbar')).backdropFilter, supported: matchMedia('(prefers-reduced-transparency: reduce)').matches }));
  if (style.supported) assert.equal(style.blur, 'none', 'reduced transparency keeps the toolbar opaque');
  await t.press(t.row('machine-3f8a'));
  const duration = await t.frame().evaluate(() => parseFloat(getComputedStyle(document.querySelector('.panel')).animationDuration));
  assert.ok(duration < .01, 'reduced motion disables the inspector animation');
  return style.supported;
}

const flows = { 'account-onboarding': accountFlow, tasks: taskFlow, machines: machineFlow, runtimes: runtimeFlow, agents: agentFlow, repositories: repositoryFlow, selections: selectionFlow, members: memberFlow };

let browser;
const receipt = [];
async function open(entry, device, scheme = 'light') {
  const page = await browser.newPage({ ...devices[device], colorScheme: scheme });
  const errors = [], requests = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('**/*', route => {
    const r = route.request(), url = new URL(r.url());
    if (url.origin !== origin || r.resourceType() !== 'document') { requests.push(r.url()); return route.abort(); }
    return route.continue();
  });
  await page.goto(`${origin}/?entry=${entry}`);
  const f = page.frameLocator('iframe');
  await f.locator('body[data-ready=true]').waitFor();
  return { page, f, errors, requests };
}
async function checkFrame(page, entry, device) {
  const frame = page.frames().find(f => f.parentFrame());
  assert.equal(await frame.evaluate(() => { try { void sessionStorage.length; return 'allowed'; } catch { return 'opaque'; } }), 'opaque');
  assert.equal(await frame.evaluate(() => innerWidth), devices[device].viewport.width, `${entry}/${device} iframe width`);
  const handshake = await page.evaluate(async () => {
    const reply = new Promise(resolve => window.addEventListener('message', function handler(e) { if (e.source === document.querySelector('iframe').contentWindow && e.data?.requestId === 'smoke-ready') { window.removeEventListener('message', handler); resolve(e.data); } }));
    document.querySelector('iframe').contentWindow.postMessage({ type: 'openfolio:preview:init', requestId: 'smoke-ready' }, '*');
    return Promise.race([reply, new Promise(resolve => setTimeout(() => resolve(null), 3000))]);
  });
  assert.equal(handshake?.status, 'ready'); assert.equal(handshake?.version, 'local-preview');
  assert(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${entry}/${device} horizontal overflow`);
}

try {
  browser = await chromium.launch({ // GitHub's Ubuntu runner restricts unprivileged user namespaces.
    chromiumSandbox: process.env.CI !== 'true', ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  for (const entry of manifest.entries) for (const device of entry.devices) {
    if (screenshots) for (const scheme of ['light', 'dark']) {
      const { page, errors } = await open(entry.id, device, scheme);
      await page.locator('iframe').screenshot({ path: join(root, 'dist', entry.id, `${device}${scheme === 'dark' ? '-dark' : ''}.png`), animations: 'disabled' });
      assert.deepEqual(errors, [], `${entry.id}/${device}/${scheme} errors`);
      await page.close();
    }
    const { page, f, errors, requests } = await open(entry.id, device);
    await checkFrame(page, entry.id, device);
    await flows[entry.id](tools(page, f, device), f, page, device);
    await checkFrame(page, entry.id, device);
    assert.deepEqual(errors, [], `${entry.id}/${device} errors`); assert.deepEqual(requests, [], `${entry.id}/${device} network`);
    receipt.push(`${entry.id}/${device}`); console.log(`PASS ${entry.id}/${device}`); await page.close();
  }
  const { page, f, errors, requests } = await open('tasks', 'pc-web');
  const client = await page.context().newCDPSession(page);
  const transparency = await scenarioFlow(tools(page, f, 'pc-web'), f, page, client);
  assert.deepEqual(errors, [], 'scenario errors'); assert.deepEqual(requests, [], 'scenario network');
  console.log(`PASS scenarios, focus return, theme and reduced motion${transparency ? ' and reduced transparency' : ' (this Chromium cannot emulate reduced transparency)'}`);
  await page.close();
  console.log(`${receipt.length} opaque-iframe entry flows passed${screenshots ? ` with ${receipt.length * 2} light/dark screenshots` : ''}; no service requests, storage or browser errors.`);
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
