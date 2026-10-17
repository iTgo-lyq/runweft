import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import { freePort } from '../../src/services';
import { consoleTasks } from './console-tasks';
import { installedBinaries } from '../../scripts/installed-binaries.mjs';
import { closeSmoke } from '../lifecycle';
import { hubConnectionPaths } from '../../src/hub/resources/connection';

export async function smokeConsole(options: { binary: string; hapiBinary?: string; own?: (close: () => Promise<void>) => void }) {
const root = mkdtempSync(join(tmpdir(), 'runweft-hub-console-')), home = join(root, 'home');
const binary = resolve(options.binary);
const selectedBinaries = installedBinaries(binary);
if (options.hapiBinary) { const path = resolve(options.hapiBinary); selectedBinaries.hapi = { path, sha256: new Bun.CryptoHasher('sha256').update(await Bun.file(path).arrayBuffer()).digest('hex') }; }
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('HAPI_') || key.startsWith('RUNWEFT_') || ['CLI_API_TOKEN', 'DB_PATH', 'TELEGRAM_BOT_TOKEN'].includes(key)) delete env[key];
const port = await freePort(), origin = `http://127.0.0.1:${port}`;
const evidence: any = { root, binary, binaries: selectedBinaries, origin, checks: [], screenshots: [], success: false, cleanupErrors: [],
    scope: 'compiled CLI, real HAPI/Runner and Chromium; task history and session RPC are explicit browser fixtures, no model execution or OS terminal' };
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
async function request(path: string, token = '', body?: unknown, method = body === undefined ? 'GET' : 'POST') {
    const response = await fetch(origin + path, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() as any };
}
async function domain(token: string, spaceId: string) {
    const result = await request('/api/auth', '', { accessToken: token, spaceId }); assert.equal(result.status, 200); return result.body.token as string;
}
async function navigate(page: Page, name: string) {
    await page.locator('#console-navigation').getByRole('button', { name, exact: true }).click(); await ready(page);
}
async function importIdentity(page: Page, token: string, spaceId: string) {
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(origin + '/hub'); await ready(page);
    await page.locator('#import-token').fill(token); await page.locator('#import-identity button').click(); await ready(page);
    await page.locator('#spaces button').filter({ hasText: '后台验收' }).click(); await ready(page);
    assert.equal(await page.locator('#space-id').innerText(), spaceId);
}
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let closing: Promise<void> | undefined;
const close = () => closing ??= (async () => {
    try { await closeSmoke([() => cli(['stop']), () => cli(['runner', 'stop']), async () => { await browser?.close(); }]); } catch (error) { evidence.success = false; evidence.cleanupErrors.push(String(error)); process.exitCode = 1; }
    let stopped = false;
    try { const status = await cli(['status']); assert(!status.service.running && !status.runner.running); stopped = true; } catch (error) { evidence.success = false; evidence.cleanupErrors.push(String(error)); process.exitCode = 1; }
    if (stopped) {
        const paths = hubConnectionPaths(home, origin);
        try { await closeSmoke([paths.identityConnection, paths.pendingConnection, paths.machineConnection, join(paths.connection, 'hapi/settings.json'), join(home, 'server/hapi/settings.json'), join(home, 'server/hapi/jwt-secret.json')].map(path => () => rmSync(path, { force: true }))); }
        catch (error) { evidence.success = false; evidence.cleanupErrors.push(String(error)); process.exitCode = 1; }
        if (evidence.success && !evidence.cleanupErrors.length) rmSync(home, { recursive: true, force: true });
    }
    writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
if (evidence.cleanupErrors.length) throw new AggregateError(evidence.cleanupErrors, 'Console cleanup failed');
if (evidence.success) rmSync(root, { recursive: true, force: true });
})();
options.own?.(close);
console.log('Evidence: ' + root);
try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.RUNWEFT_SMOKE_CHROMIUM });
    await cli(['init']); await cli(['config', 'set', 'hapi.executable', selectedBinaries.hapi.path]); await cli(['config', 'set', 'server.port', String(port)]); await cli(['start']);
    const connection = await cli(['hub', '--url', origin, 'connect', 'begin', '--name', 'Console acceptance']);
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
    await navigate(page, '机器');
    let card = page.locator(`[data-resource-id="${machine.machineId}"]`);
    await card.waitFor(); assert.match(await card.innerText(), /在线/);
    check('encrypted Web/CLI onboarding, independent enrollment and online Runner');
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
    check('browser registers actual Codex runtime, shares explicitly without claiming model readiness');
    await screenshot(page, 'runtimes-desktop');
    const ownerToken = await domain(identityToken, spaceId);
    const member = (await request('/api/runweft/hub/identities', '', { name: '独立成员' })).body; secrets.push(member.token);
    const invitation = (await request(`/api/runweft/hub/spaces/${spaceId}/invitations`, identityToken, { role: 'member' })).body;
    secrets.push(invitation.token);
    assert.equal((await request('/api/runweft/hub/invitations/accept', member.token, { token: invitation.token })).status, 200);
    const memberToken = await domain(member.token, spaceId);
    const memberPage = await context.newPage();
    await importIdentity(memberPage, member.token, spaceId);
    await page.locator('#refresh').click(); await ready(page);
    await navigate(page, 'Agent'); await page.getByText('创建 Agent', { exact: true }).first().click();
    await page.getByLabel('Agent 名称', { exact: true }).fill('审查 Agent');
    await page.getByLabel('业务指令', { exact: true }).fill('私有业务指令 marker-console-private');
    await page.getByLabel('用途说明', { exact: true }).fill('检查项目，不自动提交。');
    await page.getByLabel('定义中的 Runtime').selectOption(runtime.id);
    await page.getByLabel('原生类型', { exact: true }).selectOption('codex');
    await page.getByRole('button', { name: '创建 Agent', exact: true }).click(); await ready(page);
    let agent = (await request('/api/runweft/agents', ownerToken)).body.agents[0];
    card = page.locator(`[data-resource-id="${agent.id}"]`);
    await card.getByText('编辑定义 · v1', { exact: true }).click();
    await card.getByLabel('业务指令', { exact: true }).fill('浏览器更新');
    assert.equal((await request(`/api/runweft/agents/${agent.id}`, ownerToken,
        { expectedVersion: 1, definition: { ...agent.definition, instructions: '并发修改' } }, 'PATCH')).status, 200);
    await card.getByRole('button', { name: '保存新版本' }).click(); await ready(page);
    assert.match(await page.locator('#notice').innerText(), /其他操作更新/);
    assert.equal(await card.getByLabel('业务指令', { exact: true }).inputValue(), '浏览器更新');
    await page.locator('#refresh').click(); await ready(page);
    agent = (await request(`/api/runweft/agents/${agent.id}`, ownerToken)).body.agent;
    check('Agent creation and conflicting edit preserve the unsaved form without overwriting the current definition');
    await navigate(page, '我的选择');
    await page.getByLabel('选择 Agent', { exact: true }).selectOption(agent.id);
    await page.getByRole('button', { name: '保存我的选择' }).click(); await ready(page);
    const personalAgent = (await request('/api/runweft/agents', memberToken, { requestId: crypto.randomUUID(),
        definition: { ...agent.definition, name: '成员私有 Agent', instructions: 'private-member-instructions', model: null, reasoningEffort: null } })).body.agent;
    await page.getByText('验证我的选择', { exact: true }).click();
    await page.getByRole('button', { name: '解析当前配置' }).click(); await ready(page);
    assert.match(await page.locator('.resolution-result').innerText(), new RegExp(machine.machineId));
    check('browser saves a personal Agent selection and resolves the actual registered Runtime');
    await consoleTasks({ origin, home, root, page, memberPage, context, identityToken, memberToken, memberIdentity: member.token,
        ownerToken, spaceId, machineId: machine.machineId, agentId: agent.id, memberAgentId: personalAgent.id, ready, navigate, check });
    await memberPage.close();
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.locator('#logout').click(); await ready(page);
    assert.equal(await page.locator('#console-content').innerText(), '');
    check('mobile layout and logout clear prior resource data');
    assert.deepEqual(pageErrors, []);
    for (const secret of secrets) assert(!output.some(text => text.includes(secret)), 'secret leaked into ordinary output');
    evidence.success = true;
} catch (error) { evidence.error = String(error); throw error; }
finally { await close(); }
if (evidence.cleanupErrors.length) throw new AggregateError(evidence.cleanupErrors, 'Console cleanup failed');
}
