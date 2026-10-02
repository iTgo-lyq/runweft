import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { chromium, type Page } from 'playwright';
import { freePort } from '../../src/services';
import { consoleTasks } from './hub-console-tasks';
import { installedBinaries } from './installed-binaries.mjs';
import { consoleHistory } from './hub-console-history';
import { closeSmoke } from './smoke-lifecycle';
import { hubConnectionPaths } from '../../src/hub/resources/connection';

export async function smokeConsole(options: { binary: string; hapiBinary?: string; sourceFixtures?: string[] }) {
mkdirSync('.dev-smoke', { recursive: true });
const root = mkdtempSync(resolve('.dev-smoke/hub-console-')), home = join(root, 'home');
const binary = resolve(options.binary);
const selectedBinaries = installedBinaries(binary);
if (options.hapiBinary) { const path = resolve(options.hapiBinary); selectedBinaries.hapi = { path, sha256: new Bun.CryptoHasher('sha256').update(await Bun.file(path).arrayBuffer()).digest('hex') }; }
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('HAPI_') || key.startsWith('RUNWEFT_') || ['CLI_API_TOKEN', 'DB_PATH', 'TELEGRAM_BOT_TOKEN'].includes(key)) delete env[key];
const port = await freePort(), origin = `http://127.0.0.1:${port}`;
const evidence: any = { root, binary, sourceFixtures: options.sourceFixtures ?? [], binaries: selectedBinaries, origin, checks: [], screenshots: [], success: false, cleanupErrors: [],
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
    const invalid = `rw_id_${randomBytes(32).toString('base64url')}`; let reads = 0, creates = 0;
    const observe = (request: import('playwright').Request) => { const path = new URL(request.url()).pathname; if (path === '/api/runweft/hub/identity') reads++; if (path === '/api/runweft/hub/identities' && request.method() === 'POST') creates++; };
    page.on('request', observe);
    await page.locator('#import-token').fill(invalid); await page.locator('#import-identity button').click(); await ready(page);
    assert.equal(reads, 1); assert.equal(creates, 0); assert.equal(await page.evaluate(() => sessionStorage.getItem('runweft.hub.identity')), null);
    assert(!(await page.locator('body').innerText()).includes(invalid)); assert(await page.locator('#notice').isVisible());
    page.off('request', observe);
    await page.locator('#import-token').fill(token); await page.locator('#import-identity button').click(); await ready(page);
    await page.locator('#spaces button').filter({ hasText: '后台验收' }).click(); await ready(page);
    assert.equal(await page.locator('#space-id').innerText(), spaceId);
}
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
console.log('Evidence: ' + root);
try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.RUNWEFT_SMOKE_CHROMIUM });
    await cli(['init']); await cli(['config', 'set', 'hapi.executable', selectedBinaries.hapi.path]); await cli(['config', 'set', 'server.port', String(port)]); await cli(['start']);
    const connection = await cli(['hub', '--url', origin, 'connect', 'begin', '--name', 'Console acceptance']);
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage();
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => { if (message.type() !== 'error') output.push(message.text()); });
    await page.goto(connection.confirmationUrl); await ready(page);
    await page.route(origin + '/api/runweft/tasks/overview*', route => route.fulfill({ status: 503, json: { error: { message: '首次任务读取失败' } } }), { times: 1 });
    await page.locator('#new-name').fill('后台验收'); await page.locator('#create-identity button').click();
    await page.locator('#secret-dialog[open]').waitFor(); await ready(page);
    assert.match(await page.locator('#console-content').innerText(), /资源未能加载/);
    assert(!(await page.locator('#console-content').innerText()).includes('正在读取'));
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
    await navigate(page, '仓库');
    await page.getByText('登记仓库', { exact: true }).first().click();
    await page.getByLabel('仓库名称', { exact: true }).fill('后台仓库');
    await page.getByLabel('Git remote 别名（每行一个，可选）').fill('https://example.invalid/team/console.git');
    await page.route(origin + '/api/runweft/repositories', async route => {
        if (route.request().method() !== 'POST') return route.continue();
        await route.fetch(); await route.abort('failed'); await page.unroute(origin + '/api/runweft/repositories');
    });
    await page.getByRole('button', { name: '登记仓库', exact: true }).click(); await ready(page);
    const repositories = (await request('/api/runweft/repositories', ownerToken)).body.repositories;
    assert.equal(repositories.length, 1);
    const repository = repositories[0]; card = page.locator(`[data-resource-id="${repository.id}"]`);
    await card.waitFor(); assert.match(await card.innerText(), /example.invalid/);
    assert.equal((await request(`/api/runweft/repositories/${repository.id}`, memberToken, { name: '越权改名' }, 'PATCH')).status, 403);
    await navigate(memberPage, '仓库');
    assert.equal(await memberPage.locator(`[data-resource-id="${repository.id}"]`).getByRole('button').count(), 0);
    check('repository create recovers lost response by receipt without duplicate; member UI and API remain read-only');
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
    await card.getByText('编辑定义 · v2', { exact: true }).click();
    await card.getByLabel('业务指令', { exact: true }).fill('完整定义 v3 marker-console-private');
    await card.getByLabel('模型（可选）').fill('model-inspection-only');
    await card.getByLabel('推理等级（可选）').fill('high');
    await card.getByRole('button', { name: '保存新版本' }).click(); await ready(page);
    await card.getByRole('button', { name: '查看版本历史' }).click(); await ready(page);
    assert.equal(await card.locator('.version-history details').count(), 3);
    assert.equal((await request('/api/runweft/agents', memberToken)).body.agents.length, 0);
    assert.equal((await request(`/api/runweft/agents/${agent.id}`, memberToken)).status, 404);
    await navigate(memberPage, 'Agent'); assert(!(await memberPage.locator('#console-content').innerText()).includes('marker-console-private'));
    check('full Agent definition, optimistic version conflict preserves form, owner-only history and private member invisibility');
    await card.getByText('管理 Agent 分享', { exact: true }).click();
    await card.getByLabel('分享范围').selectOption('members');
    await card.getByRole('checkbox', { name: /^独立成员/ }).check();
    await card.getByRole('button', { name: '保存分享范围' }).click(); await confirm(page);
    await memberPage.locator('#refresh').click(); await ready(memberPage);
    let memberCard = memberPage.locator(`[data-resource-id="${agent.id}"]`);
    await memberCard.getByText('查看当前定义', { exact: true }).click();
    assert.match(await memberCard.innerText(), /marker-console-private/);
    assert.equal(await memberCard.getByRole('button', { name: '保存新版本' }).count(), 0);
    agent = (await request(`/api/runweft/agents/${agent.id}`, ownerToken)).body.agent;
    assert.equal((await request(`/api/runweft/agents/${agent.id}`, memberToken, { expectedVersion: 3, definition: agent.definition }, 'PATCH')).status, 403);
    assert.equal((await request(`/api/runweft/agents/${agent.id}/versions`, memberToken)).status, 403);
    await navigate(page, '我的选择');
    await page.getByLabel('选择 Agent', { exact: true }).selectOption(agent.id);
    await page.getByRole('button', { name: '保存我的选择' }).click(); await ready(page);
    await page.getByLabel('选择作用范围').selectOption(repository.id); await page.getByLabel('个人 Runtime override').selectOption(runtime.id);
    await page.getByLabel('选择 Agent', { exact: true }).selectOption(agent.id);
    await page.getByRole('button', { name: '保存我的选择' }).click(); await ready(page);
    const personalAgent = (await request('/api/runweft/agents', memberToken, { requestId: crypto.randomUUID(),
        definition: { ...agent.definition, name: '成员私有 Agent', instructions: 'private-member-instructions', model: null, reasoningEffort: null } })).body.agent;
    await navigate(memberPage, '我的选择'); await memberPage.getByLabel('选择作用范围').selectOption(repository.id);
    await memberPage.getByLabel('选择 Agent', { exact: true }).selectOption(personalAgent.id);
    await memberPage.getByRole('button', { name: '保存我的选择' }).click(); await ready(memberPage);
    assert.equal((await request('/api/runweft/agent-selections', memberToken)).body.selections[0].agentId, personalAgent.id);
    assert.equal((await request('/api/runweft/agent-selections', ownerToken)).body.selections.length, 2);
    await page.getByText('验证我的选择', { exact: true }).click(); await page.getByLabel('解析仓库').selectOption(repository.id);
    await page.getByRole('button', { name: '解析当前配置' }).click(); await ready(page);
    assert.match(await page.locator('.resolution-result').innerText(), /repository/);
    check('member sharing without edit/history rights, independent per-repository choices and actual runtime resolution');
    await navigate(page, 'Agent');
    const privateCard = page.locator(`[data-resource-id="${personalAgent.id}"]`);
    assert.match(await privateCard.innerText(), /治理概要/); assert(!(await page.locator('#console-content').innerText()).includes('private-member-instructions'));
    assert.equal((await request(`/api/runweft/agents/${personalAgent.id}/access`, ownerToken, { mode: 'space' }, 'PUT')).status, 403);
    check('private governance summary excludes instructions and cannot grant owner editing rights');
    await screenshot(page, 'agents-desktop');
    await page.setViewportSize({ width: 390, height: 844 }); await screenshot(page, 'agents-mobile');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await consoleTasks({ origin, home, root, page, memberPage, context, identityToken, memberToken, memberIdentity: member.token,
        ownerToken, spaceId, machineId: machine.machineId, agentId: agent.id, memberAgentId: personalAgent.id, ready, navigate, screenshot, check });
    await memberPage.close();
    await navigate(page, 'Runtime');
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
    try { await closeSmoke([() => cli(['stop']), () => cli(['runner', 'stop']), async () => { await browser?.close(); }]); } catch (error) { evidence.success = false; evidence.cleanupErrors.push(String(error)); process.exitCode = 1; }
    let stopped = false;
    try { const status = await cli(['status']); assert(!status.service.running && !status.runner.running); stopped = true; } catch (error) { evidence.success = false; evidence.cleanupErrors.push(String(error)); process.exitCode = 1; }
    if (stopped) {
        const paths = hubConnectionPaths(home, origin);
        try { await closeSmoke([paths.identityConnection, paths.pendingConnection, paths.machineConnection, join(paths.connection, 'hapi/settings.json'), join(home, 'server/hapi/settings.json'), join(home, 'server/hapi/jwt-secret.json')].map(path => () => rmSync(path, { force: true }))); }
        catch (error) { evidence.success = false; evidence.cleanupErrors.push(String(error)); process.exitCode = 1; }
        if (evidence.success && !evidence.cleanupErrors.length) rmSync(home, { recursive: true, force: true });
    }
    evidence.consoleSuccess = evidence.success;
    if (options.sourceFixtures?.length) evidence.success = false;
    writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
}
if (evidence.cleanupErrors.length) throw new AggregateError(evidence.cleanupErrors, 'Console cleanup failed');
if (options.sourceFixtures?.length) {
    evidence.historyResults = [];
    try {
        await consoleHistory({ binary, hapiBinary: selectedBinaries.hapi.path, sources: options.sourceFixtures, record: result => evidence.historyResults.push(result) });
        assert(evidence.consoleSuccess && evidence.historyResults.length === options.sourceFixtures.length && evidence.historyResults.every((result: { success: boolean }) => result.success));
        evidence.success = true; // The owning case consumer performs source cleanup.
    } catch (error) { evidence.success = false; evidence.error = String(error); throw error; }
    finally { writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2)); }
}
}
