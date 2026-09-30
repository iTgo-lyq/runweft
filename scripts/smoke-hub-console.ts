import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import { freePort } from '../src/services';

mkdirSync('.dev-smoke', { recursive: true });
const root = mkdtempSync(resolve('.dev-smoke/hub-console-')), home = join(root, 'home');
const binary = resolve(process.argv[2] ?? 'dist/runweft');
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('HAPI_') || key.startsWith('RUNWEFT_') || ['CLI_API_TOKEN', 'DB_PATH', 'TELEGRAM_BOT_TOKEN'].includes(key)) delete env[key];
const port = await freePort(), origin = `http://127.0.0.1:${port}`;
const evidence: any = { root, binary, origin, checks: [], screenshots: [], success: false, cleanupErrors: [], scope: 'compiled CLI, real HAPI/Runner and Chromium; no model execution' };
const secrets: string[] = [], pageErrors: string[] = [], output: string[] = [];
async function cli(args: string[]) {
    const child = Bun.spawn([binary, '--home', home, '--json', ...args], { env, stdout: 'pipe', stderr: 'pipe' });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    output.push(stdout, stderr); assert.equal(code, 0, `${args.slice(0, 2).join(' ')} failed: ${stderr}`); return JSON.parse(stdout);
}
async function ready(page: Page) {
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('#logout')?.disabled);
}
async function confirm(page: Page) { await page.locator('#confirm-dialog[open]').waitFor(); await page.locator('#confirm-dialog button[value=yes]').click(); await ready(page); }
async function screenshot(page: Page, name: string) {
    const path = join(root, name + '.png'); await page.screenshot({ path, fullPage: true }); evidence.screenshots.push(path);
}
function check(name: string) { evidence.checks.push(name); console.log('PASS ' + name); }
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
console.log('Evidence: ' + root);
try {
    await cli(['init']); await cli(['config', 'set', 'server.port', String(port)]); await cli(['start']);
    const connection = await cli(['hub', '--url', origin, 'connect', 'begin', '--name', 'Console acceptance']);
    browser = await chromium.launch({ headless: true, executablePath: process.env.RUNWEFT_SMOKE_CHROMIUM });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage();
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => { if (message.type() !== 'error') output.push(message.text()); });
    await page.goto(connection.confirmationUrl); await ready(page);
    await page.locator('#new-name').fill('后台验收'); await page.locator('#create-identity button').click();
    await page.locator('#secret-dialog[open]').waitFor(); await ready(page);
    const identityToken = await page.locator('#secret-value').innerText(); secrets.push(identityToken);
    await page.locator('#close-secret').click();
    const spaceId = await page.locator('#space-id').innerText();
    await page.locator('#confirm-connection').click(); await ready(page);
    assert.equal((await cli(['hub', '--url', origin, 'connect', 'complete'])).status, 'connected');
    const machine = await cli(['machine', 'enroll', '--name', '验收机器']);
    await cli(['machine', 'associate', machine.machineId, spaceId]); await cli(['runner', 'start']);
    await page.locator('#refresh').click(); await ready(page);
    let card = page.locator(`[data-resource-id="${machine.machineId}"]`);
    await card.waitFor(); assert.match(await card.innerText(), /在线/);
    await card.getByText('修改机器名称', { exact: true }).click();
    await card.getByLabel('机器名称', { exact: true }).fill('已改名机器');
    await card.getByRole('button', { name: '保存机器名称', exact: true }).click(); await ready(page);
    assert.equal((await cli(['machine', 'show', machine.machineId])).machine.name, '已改名机器');
    check('encrypted Web/CLI onboarding, independent machine enrollment and real Runner rename');
    await page.locator('#console-navigation').getByRole('button', { name: 'Runtime', exact: true }).click(); await ready(page);
    await page.getByText('登记 Runtime', { exact: true }).first().click();
    await page.getByLabel('Runtime 名称（可选）').fill('浏览器 Codex');
    await page.getByRole('button', { name: '登记 Runtime', exact: true }).click(); await ready(page);
    const runtime = (await cli(['runtime', 'list'])).runtimes[0]; assert(runtime);
    card = page.locator(`[data-resource-id="${runtime.id}"]`); await card.waitFor();
    assert.match(await card.innerText(), /模型认证 \/ 执行[\s\S]*未检查/);
    await card.getByText('管理 Runtime 分享', { exact: true }).click();
    await card.getByRole('button', { name: /^共享到/ }).click(); await confirm(page);
    assert((await cli(['runtime', 'show', runtime.id])).runtime.shared);
    card = page.locator(`[data-resource-id="${runtime.id}"]`);
    await card.getByRole('button', { name: '在空间停用 Runtime', exact: true }).click(); await confirm(page);
    assert((await cli(['runtime', 'show', runtime.id])).runtime.blockedInSpace);
    await card.getByRole('button', { name: '解除 Runtime 停用', exact: true }).click(); await confirm(page);
    assert(!(await cli(['runtime', 'show', runtime.id])).runtime.blockedInSpace);
    check('browser registers actual Codex runtime, shares explicitly, governs and restores without claiming model readiness');
    await screenshot(page, 'runtimes-desktop');
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await screenshot(page, 'runtimes-mobile');
    await page.locator('#console-navigation').getByRole('button', { name: '成员', exact: true }).click(); await ready(page);
    assert(await page.locator('#members-panel').isVisible()); assert(await page.locator('#leave-space').isHidden());
    await screenshot(page, 'members-mobile');
    await page.locator('#logout').click(); await ready(page);
    assert.equal(await page.locator('#console-content').innerText(), '');
    check('390px layout, service-provided last-owner controls and logout clear prior resource data');
    assert.deepEqual(pageErrors, []);
    for (const secret of secrets) assert(!output.some(text => text.includes(secret)), 'secret leaked into ordinary output');
    evidence.success = true;
} catch (error) { evidence.error = String(error); throw error; }
finally {
    await browser?.close();
    try { await cli(['runner', 'stop']); await cli(['stop']); } catch (error) { evidence.cleanupErrors.push(String(error)); }
    writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
}
