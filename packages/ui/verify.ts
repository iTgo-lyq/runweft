// Browser checks for the UI library, run against the component catalog under the Hub's CSP.
// Usage: bun packages/ui/verify.ts [--screenshots]   (set CI=true where Chromium cannot use its process sandbox)
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Locator, type Page } from 'playwright';
import { HUB_CSP } from '../../src/hub/csp';
import { UI_ROOT, buildFrontend } from './build';

const screenshots = process.argv.includes('--screenshots');
const build = await buildFrontend({ entry: join(UI_ROOT, 'catalog/main.tsx'), css: join(UI_ROOT, 'catalog/catalog.css') });
const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>Runweft UI</title><link rel="stylesheet" href="/app.css"><script type="module" src="/app.js"></script></head><body><div id="root"></div></body></html>';
const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch(request) {
  const path = new URL(request.url).pathname, headers = { 'content-security-policy': HUB_CSP };
  if (path === '/') return new Response(html, { headers: { ...headers, 'content-type': 'text/html; charset=utf-8' } });
  if (path === '/app.js') return new Response(build.js, { headers: { ...headers, 'content-type': 'text/javascript; charset=utf-8' } });
  if (path === '/app.css') return new Response(build.css, { headers: { ...headers, 'content-type': 'text/css; charset=utf-8' } });
  return new Response('', { status: 404 });
} });
const origin = `http://127.0.0.1:${server.port}`;
// Headless software compositing skips backdrop blur on rounded elements; screenshots use SwiftShader GPU compositing.
const browser = await chromium.launch({ chromiumSandbox: process.env.CI !== 'true', ...(screenshots ? { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } : {}) });
const passed: string[] = [];
const check = async (name: string, run: () => Promise<void>) => { await run(); passed.push(name); };

async function open(viewport = { width: 1280, height: 900 }, options: Parameters<typeof browser.newPage>[0] = {}) {
  const page = await browser.newPage({ viewport, ...options });
  const problems: string[] = [];
  await page.addInitScript(() => document.addEventListener('securitypolicyviolation', event => console.error(`CSP ${event.violatedDirective}`)));
  page.on('console', message => { if (message.type() === 'error') problems.push(message.text()); });
  page.on('pageerror', error => problems.push(error.message));
  await page.goto(origin + '/');
  await page.getByRole('heading', { name: 'Runweft UI' }).waitFor();
  return { page, problems };
}
/** React applies state after the event, so attribute checks wait for the value instead of reading once. */
async function waitAttr(locator: Locator, name: string, value: string) {
  await locator.evaluate((node, [attribute, expected]) => new Promise<void>((resolve, reject) => {
    const observer = new MutationObserver(() => done());
    const timer = setTimeout(() => { observer.disconnect(); reject(new Error(`${attribute} stayed ${node.getAttribute(attribute)}`)); }, 3000);
    const done = () => { if (node.getAttribute(attribute) === expected) { clearTimeout(timer); observer.disconnect(); resolve(); } };
    observer.observe(node, { attributes: true });
    done();
  }), [name, value] as const);
}
/** Radix moves roving focus in a timer and checks radios only while the arrow key is still down, as with a real keypress. */
async function holdKey(page: Page, key: string) {
  await page.keyboard.down(key);
  await page.waitForTimeout(60);
  await page.keyboard.up(key);
}
/** Focus moves after Radix's close animation frame; wait for it rather than reading once. */
async function waitFocus(locator: Locator) {
  await locator.evaluate(node => new Promise<void>((resolve, reject) => {
    const started = performance.now();
    const tick = () => node === document.activeElement ? resolve() : performance.now() - started > 3000 ? reject(new Error(`focus is on ${(document.activeElement as HTMLElement | null)?.outerHTML.slice(0, 120)}`)) : requestAnimationFrame(tick);
    tick();
  }));
}
const focusedText = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.innerText?.trim() ?? '');

try {
  const { page, problems } = await open();

  await check('focus ring is visible on keyboard focus', async () => {
    await page.keyboard.press('Tab');
    const shadow = await page.evaluate(() => getComputedStyle(document.activeElement!).boxShadow);
    assert.notEqual(shadow, 'none');
  });

  await check('segmented and chips move selection with arrow keys', async () => {
    const group = page.getByRole('radiogroup', { name: '任务状态' });
    await group.getByRole('radio', { name: '全部' }).focus();
    await holdKey(page, 'ArrowRight');
    await waitAttr(group.getByRole('radio', { name: '需要处理' }), 'aria-checked', 'true');
  });

  await check('tabs switch with arrow keys', async () => {
    await page.getByRole('tab', { name: '概览' }).focus();
    await page.keyboard.press('ArrowRight');
    await waitAttr(page.getByRole('tab', { name: '交付' }), 'aria-selected', 'true');
    await page.getByText('当前标签：delivery').waitFor();
  });

  await check('switch toggles and disabled switch stays put', async () => {
    const toggle = page.getByRole('switch', { name: '共享到“产品协作”' });
    await toggle.click();
    await waitAttr(toggle, 'aria-checked', 'false');
    assert.equal(await page.getByRole('switch', { name: '不可用的开关' }).isDisabled(), true);
  });

  await check('menu opens from the keyboard, moves with arrows and returns focus on Escape', async () => {
    const trigger = page.getByRole('button', { name: /当前空间：产品协作/ });
    await trigger.focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu', { name: '切换空间' });
    await menu.waitFor();
    assert.equal(await menu.evaluate(node => node.classList.contains('glass')), true);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'detached' });
    await waitFocus(trigger);
  });

  await check('menu radio item selects a value', async () => {
    await page.getByRole('button', { name: /当前空间：产品协作/ }).click();
    await page.getByRole('menuitemradio', { name: /个人实验/ }).click();
    await page.getByRole('button', { name: /当前空间：个人实验/ }).waitFor();
  });

  await check('popover closes on Escape and returns focus', async () => {
    const trigger = page.getByRole('button', { name: '筛选' });
    await trigger.click();
    await page.getByRole('dialog', { name: '筛选' }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('dialog', { name: '筛选' }).waitFor({ state: 'detached' });
    await waitFocus(trigger);
  });

  await check('dialog focuses its first field and restores focus on Escape', async () => {
    const trigger = page.getByRole('button', { name: '打开对话框' });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: '登记仓库' });
    await dialog.waitFor();
    await waitFocus(page.getByLabel('仓库名称'));
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    await waitFocus(trigger);
  });

  await check('confirmations start on the safe choice and resolve', async () => {
    await page.getByRole('button', { name: '危险确认' }).click();
    await page.getByRole('alertdialog', { name: '撤回共享？' }).waitFor();
    assert.equal(await focusedText(page), '取消');
    await page.keyboard.press('Escape');
    await page.locator('#confirm-result', { hasText: 'false' }).waitFor();
    await page.getByRole('button', { name: '确认框' }).click();
    assert.equal(await focusedText(page), '保存');
    await page.keyboard.press('Enter');
    await page.locator('#confirm-result', { hasText: 'true' }).waitFor();
  });

  await check('toast is announced in a live region', async () => {
    await page.getByRole('button', { name: '轻提示' }).click();
    await page.getByRole('status').filter({ hasText: '设置已保存' }).waitFor();
  });

  await check('rows move with arrow keys; the inspector opens, focuses its heading and closes on Escape', async () => {
    const first = page.getByRole('button', { name: /林舟的 MacBook Pro/ }).first();
    await first.focus();
    await page.keyboard.press('ArrowDown');
    assert.match(await focusedText(page), /构建服务器/);
    await page.keyboard.press('Enter');
    const panel = page.getByRole('complementary', { name: '机器详情' });
    await panel.getByRole('heading', { name: '构建服务器 bj-04' }).waitFor();
    await waitFocus(panel.getByRole('heading', { name: '构建服务器 bj-04' }));
    await page.keyboard.press('Escape');
    await panel.waitFor({ state: 'hidden' });
    assert.match(await focusedText(page), /构建服务器/);
  });

  await check('inline edit saves and Escape returns focus to its trigger', async () => {
    await page.getByRole('button', { name: /林舟的 MacBook Pro/ }).first().click();
    await page.getByRole('button', { name: '修改机器名称' }).click();
    const input = page.getByLabel('机器名称', { exact: true }).last();
    await input.fill('林舟的新电脑');
    await page.getByRole('button', { name: '保存', exact: true }).last().click();
    await page.getByText('林舟的新电脑').first().waitFor();
    await page.getByRole('button', { name: '修改机器名称' }).click();
    await page.keyboard.press('Escape');
    await waitFocus(page.getByRole('button', { name: '修改机器名称' }));
  });

  await check('slash focuses the page filter', async () => {
    await page.locator('body').click({ position: { x: 4, y: 4 } });
    await page.keyboard.press('/');
    assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute('data-find')), true);
  });

  await check('dark theme re-layers surfaces', async () => {
    await page.getByRole('radio', { name: '深色' }).first().click();
    const canvas = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert.equal(canvas, 'rgb(13, 16, 21)');
    await page.getByRole('radio', { name: '浅色' }).first().click();
  });

  await check('reduced motion shortens animations', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: '更多操作' }).last().click();
    const duration = await page.getByRole('menu', { name: '更多操作' }).evaluate(node => getComputedStyle(node).animationDuration);
    assert.ok(parseFloat(duration) < 0.01, duration);
    await page.keyboard.press('Escape');
    await page.getByRole('menu').waitFor({ state: 'detached' });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  });

  await check('reduced transparency turns glass opaque', async () => {
    const session = await page.context().newCDPSession(page);
    await session.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
    await page.getByRole('button', { name: '更多操作' }).last().click();
    const menu = page.getByRole('menu', { name: '更多操作' });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const style = await menu.evaluate(node => { const s = getComputedStyle(node); return { image: s.backgroundImage, filter: s.backdropFilter }; });
    assert.deepEqual(style, { image: 'none', filter: 'none' });
    await page.keyboard.press('Escape');
    await page.getByRole('menu').waitFor({ state: 'detached' });
    await session.send('Emulation.setEmulatedMedia', { features: [] });
  });

  await check('workspace shell renders with a glass toolbar and the phone drawer', async () => {
    const shell = await open({ width: 390, height: 844 }, { isMobile: true, hasTouch: true });
    await shell.page.getByRole('button', { name: '工作台壳' }).tap();
    await shell.page.getByRole('heading', { name: '任务' }).waitFor();
    assert.equal(await shell.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await shell.page.getByRole('button', { name: '打开导航' }).tap();
    assert.equal(await shell.page.evaluate(() => document.body.dataset.nav), 'open');
    await shell.page.keyboard.press('Escape');
    assert.equal(await shell.page.evaluate(() => document.body.dataset.nav), 'closed');
    assert.deepEqual(shell.problems, []);
    await shell.page.close();
  });

  await check('phone width has no horizontal overflow', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  });

  assert.deepEqual(problems, [], 'browser errors or CSP violations');

  if (screenshots) {
    const out = join(UI_ROOT, 'catalog/dist');
    mkdirSync(out, { recursive: true });
    for (const scheme of ['light', 'dark'] as const) {
      for (const [device, viewport] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]] as const) {
        const shot = await open(viewport, { colorScheme: scheme, deviceScaleFactor: 2 });
        await shot.page.screenshot({ path: join(out, `catalog-${device}-${scheme}.png`), fullPage: true });
        await shot.page.close();
      }
    }
  }
  console.log(`${passed.length} UI checks passed under the Hub CSP${screenshots ? '; screenshots in packages/ui/catalog/dist' : ''}.`);
} finally {
  await browser.close();
  server.stop(true);
}
