import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import { freePort } from '../src/services';
import { closeSmoke } from './fixtures/smoke-lifecycle';
import { installedBinaries } from './fixtures/installed-binaries.mjs';
import { createHash } from 'node:crypto';

const binary = resolve(process.argv[2] ?? 'dist/runweft'), hapi = resolve(process.argv[3] ?? 'dist/hapi');
mkdirSync('.dev-smoke', { recursive: true });
const root = mkdtempSync(resolve('.dev-smoke/hub-identity-')), home = join(root, 'home');
const evidence: any = { root, binary, candidate: { core: installedBinaries(binary).runweft, hapi: { path: hapi, sha256: createHash('sha256').update(readFileSync(hapi)).digest('hex') } }, cleanupErrors: [], success: false, checks: [], screenshots: [] };
const secrets: string[] = [], consoleMessages: string[] = [], pageErrors: string[] = [], requestUrls: string[] = [];
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_') || key.startsWith('HAPI_') || ['CLI_API_TOKEN', 'DB_PATH', 'TELEGRAM_BOT_TOKEN'].includes(key)) delete env[key];
const cli = (args: string[]) => {
    const result = spawnSync(binary, ['--home', home, '--json', ...args], { env, encoding: 'utf8', timeout: 60_000 });
    assert.equal(result.status, 0, result.stderr || String(result.error)); return JSON.parse(result.stdout);
};
const port = await freePort(), base = `http://127.0.0.1:${port}`, prefix = '/api/runweft/hub';
const check = (name: string) => { evidence.checks.push(name); console.log(`PASS ${name}`); };
async function api(path: string, token = '', body?: unknown, method = body === undefined ? 'GET' : 'POST') {
    const response = await fetch(base + path, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() as any };
}
async function ready(page: Page) { await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('#logout')?.disabled); }
async function create(page: Page, name: string) {
    await page.goto(base + '/hub');
    await page.keyboard.press('Tab');
    assert(await page.locator('.skip').evaluate(node => node === document.activeElement));
    await page.locator('#new-name').fill(name); await page.getByRole('button', { name: '领取身份 token', exact: true }).click();
    await page.locator('#secret-dialog[open]').waitFor(); await ready(page);
    const token = await page.locator('#secret-value').innerText(); secrets.push(token);
    const id = await page.locator('#identity-id').innerText(); assert(id);
    return { token, id };
}
async function closeSecret(page: Page) { await page.locator('#close-secret').click(); await page.locator('#secret-dialog[open]').waitFor({ state: 'hidden' }); }
async function socketReject(token: string, namespace: string) {
    return new Promise<void>((resolve, reject) => {
        const socket = new WebSocket(`ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket`);
        const timer = setTimeout(() => { socket.close(); reject(new Error(`Socket ${namespace} did not reject identity token`)); }, 8000);
        socket.onmessage = event => {
            const data = String(event.data);
            if (data.startsWith('0')) socket.send(`40/${namespace},${JSON.stringify({ token })}`);
            if (data === '2') socket.send('3');
            if (data.startsWith(`44/${namespace},`)) { clearTimeout(timer); socket.close(); resolve(); }
            if (data.startsWith(`40/${namespace},`)) { clearTimeout(timer); socket.close(); reject(new Error('Identity token unexpectedly accepted by native socket')); }
        };
        socket.onerror = () => { clearTimeout(timer); socket.close(); reject(new Error('Native Socket probe transport failed')); };
    });
}
let started = false;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
    cli(['init']); cli(['config', 'set', 'server.port', String(port)]); cli(['config', 'set', 'server.runner', 'false']); cli(['config', 'set', 'hapi.executable', hapi]);
    started = true; cli(['start']);
    browser = await chromium.launch({ headless: true, executablePath: process.env.RUNWEFT_SMOKE_CHROMIUM });
    const first = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    const second = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
    const alice = await first.newPage(), bob = await second.newPage();
    for (const page of [alice, bob]) {
        page.on('pageerror', error => pageErrors.push(error.message));
        page.on('console', message => consoleMessages.push(message.text()));
        page.on('request', request => requestUrls.push(request.url()));
    }
    const a = await create(alice, 'Alice <img src=x onerror=alert(1)>');
    assert.match(a.token, /^rw_id_[A-Za-z0-9_-]{43}$/);
    const downloadPromise = alice.waitForEvent('download'); await alice.locator('#download-secret').click();
    const download = await downloadPromise, backup = join(root, 'identity-backup.txt'); await download.saveAs(backup);
    assert(readFileSync(backup, 'utf8').includes(a.token));
    await closeSecret(alice); await alice.reload(); await ready(alice);
    await alice.locator('#workspace').waitFor(); assert.equal(await alice.locator('#identity-id').innerText(), a.id);
    assert.equal(await alice.locator('#identity-name img').count(), 0);
    const sid = await alice.locator('#space-id').innerText();
    await alice.getByText('修改显示名称', { exact: true }).click();
    await alice.locator('#identity-name-input').fill('Alice'); await alice.getByRole('button', { name: '保存名称', exact: true }).click(); await ready(alice);
    assert.equal(await alice.locator('#identity-name').innerText(), 'Alice');
    check('compiled /hub creates identity, downloads backup, refreshes same identity and escapes user names');

    const b = await create(bob, 'Bob'); assert.notEqual(a.id, b.id); await closeSecret(bob);
    assert.equal((await api(`${prefix}/spaces/${sid}`, b.token)).status, 404);
    for (const page of [alice, bob]) { await page.locator('#console-navigation').getByRole('button', { name: '成员', exact: true }).click(); await ready(page); }
    await alice.locator('#invitation-role').selectOption('admin');
    await alice.getByRole('button', { name: '生成邀请', exact: true }).click(); await alice.locator('#secret-dialog[open]').waitFor(); await ready(alice);
    const invitation = await alice.locator('#secret-value').innerText(); secrets.push(invitation); await closeSecret(alice);
    await bob.getByText('接受空间邀请', { exact: true }).click();
    await bob.locator('#invitation-token').fill(invitation); await bob.getByRole('button', { name: '加入空间', exact: true }).click(); await ready(bob);
    await bob.waitForFunction(space => document.getElementById('space-id')?.textContent === space, sid);
    assert.equal(await bob.locator('#invitation-role option[value=admin]').count(), 0);
    assert.equal((await api(`${prefix}/spaces/${sid}/invitations`, b.token, { role: 'admin' })).status, 403);
    const replay = await api(`${prefix}/invitations/accept`, b.token, { token: invitation }); assert.equal(replay.status, 200);
    await alice.locator('#refresh').click(); await ready(alice);
    assert.equal(await alice.locator('#members tr').count(), 2);
    check('two browser identities join by single-use invitation; admin cannot create another admin');

    await alice.locator('#space-name-input').fill('评审协作'); await alice.locator('#rename-space button').click(); await ready(alice);
    assert.equal(await alice.locator('#space-name').innerText(), '评审协作');
    await alice.getByText('创建协作空间', { exact: true }).click();
    await alice.locator('#new-space-name').fill('另一个空间'); await alice.getByRole('button', { name: '创建空间', exact: true }).click(); await ready(alice);
    assert.equal(await alice.locator('#space-name').innerText(), '另一个空间');
    await alice.locator('#spaces button').filter({ hasText: '评审协作' }).click(); await ready(alice);
    const bobRow = alice.locator('#members tr').filter({ hasText: 'Bob' });
    await bobRow.locator('select').selectOption('member'); await bobRow.getByRole('button', { name: '保存', exact: true }).click();
    await alice.locator('#confirm-dialog button[value=yes]').click(); await ready(alice);
    await bob.locator('#refresh').click(); await ready(bob); assert(await bob.locator('#invitation-manager').isHidden());
    assert.equal((await api(`${prefix}/spaces/${sid}/members`, b.token)).status, 200);
    check('keyboard entry, profile rename, space creation/switching and owner role changes work through Web');
    await alice.locator('#rotate-token').click(); await alice.locator('#secret-dialog[open]').waitFor();
    const rotated = await alice.locator('#secret-value').innerText(); secrets.push(rotated); assert.notEqual(rotated, a.token);
    // Drop the successful rotation response once. The client must recover using its saved candidate.
    await alice.route('**/api/runweft/hub/identity/rotate', async route => { await route.fetch(); await route.abort('failed'); }, { times: 1 });
    await alice.locator('#apply-rotation').click(); await ready(alice);
    await alice.waitForFunction(() => document.getElementById('notice')?.textContent?.includes('token 已更换'));
    assert.equal((await api(`${prefix}/identity`, a.token)).status, 401);
    assert.equal((await api(`${prefix}/identity`, rotated)).body.identity.id, a.id);
    await closeSecret(alice); await alice.locator('#logout').click(); await ready(alice);
    await alice.locator('#import-token').fill(rotated); await alice.getByRole('button', { name: '进入原身份', exact: true }).click(); await ready(alice);
    await alice.locator('#workspace').waitFor(); assert.equal(await alice.locator('#identity-id').innerText(), a.id);
    await alice.locator('#spaces button').filter({ hasText: '评审协作' }).click(); await ready(alice);
    check('rotation survives lost response; old token rejected; saved token restores original identity');

    const attributes = await alice.evaluate(() => Array.from(document.querySelectorAll('*')).flatMap(node => Array.from(node.attributes).map(attribute => attribute.value)));
    for (const token of secrets) assert(!attributes.some(value => value.includes(token)));
    assert.equal(await bob.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    for (const [page, file] of [[alice, 'desktop.png'], [bob, 'mobile.png']] as const) {
        await page.screenshot({ path: join(root, file), fullPage: true }); evidence.screenshots.push(join(root, file));
    }
    const unknown = await fetch(base + '/hub/not-a-route'); assert.equal(unknown.status, 404);
    check('desktop and mobile views, secret-free DOM attributes and unknown Hub route 404');

    const rootToken = JSON.parse(readFileSync(join(home, 'server/hapi/settings.json'), 'utf8')).cliApiToken as string;
    secrets.push(rootToken);
    assert.equal((await api('/api/auth', '', { accessToken: rootToken })).status, 401);
    const native = await api('/api/auth', '', { accessToken: rotated, spaceId: sid }); assert.equal(native.status, 200);
    const jwt = native.body.token as string; secrets.push(jwt); assert(jwt);
    for (const token of [rootToken, jwt]) assert.equal((await api(`${prefix}/identity`, token)).status, 401);
    assert.equal((await api('/api/auth', '', { accessToken: rotated })).status, 200);
    assert.equal((await api('/api/auth', '', { accessToken: jwt, spaceId: sid })).status, 401);
    for (const route of ['/api/sessions', '/api/events', '/cli/sessions/resumable', '/api/runweft/agents', '/api/runweft/machines', '/api/runweft/tasks/overview', '/api/runweft/workspaces/list']) {
        assert.equal((await api(route, rotated)).status, 401, route);
    }
    await socketReject(rotated, 'cli'); await socketReject(rotated, 'terminal');
    check('current public authority exchanges only identity credentials, rejects root and JWT scope substitution; raw identity cannot access native routes or either Socket namespace');

    assert.equal(pageErrors.length, 0, pageErrors.join('\n'));
    for (const token of secrets) {
        assert(!consoleMessages.some(message => message.includes(token)), 'console secret');
        assert(!requestUrls.some(url => url.includes(token)), 'URL secret');
    }
    // HAPI legitimately persists its internal root credential in settings. Scan only Hub business DB and logs for user secrets.
    const identitySecrets = secrets.filter(value => value.startsWith('rw_id_') || value.startsWith('rw_inv_'));
    const files: string[] = [];
    function walk(path: string) { for (const item of readdirSync(path)) { const file = join(path, item); if (statSync(file).isDirectory()) walk(file); else files.push(file); } }
    walk(join(home, 'server/runweft')); walk(join(home, 'logs'));
    for (const path of files) { const bytes = readFileSync(path); for (const token of identitySecrets) assert(!bytes.includes(Buffer.from(token)), 'persistent secret'); }
    check('identity/invitation plaintext absent from state DB, WAL and logs after negative probes');
    cli(['stop']); started = false; cli(['start']); started = true;
    assert.equal((await api(`${prefix}/identity`, rotated)).body.identity.id, a.id);
    assert.equal((await api(`${prefix}/spaces/${sid}`, b.token)).body.space.role, 'member');
    check('compiled service restart preserves identities and membership without native Runner');
    evidence.success = true;
} catch (error) {
    evidence.error = error instanceof Error ? error.message : 'smoke failed'; process.exitCode = 1;
} finally {
    let stopped = false;
    try { await closeSmoke([() => { if (started) cli(['stop']); const status = cli(['status']); assert(!status.service.running && !status.runner.running); stopped = true; }, async () => { await browser?.close(); }]); }
    catch (error) { evidence.cleanupErrors.push(String(error)); evidence.success = false; process.exitCode = 1; }
    if (stopped) {
        try { await closeSmoke([join(root, 'identity-backup.txt'), join(home, 'server/hapi/settings.json'), join(home, 'server/hapi/jwt-secret.json')].map(path => () => rmSync(path, { force: true }))); }
        catch (error) { evidence.cleanupErrors.push(String(error)); evidence.success = false; process.exitCode = 1; }
        if (evidence.success && !evidence.cleanupErrors.length) rmSync(home, { recursive: true, force: true });
    }
    // Do not emit token values, including assertion diagnostics, into the saved report.
    let report = JSON.stringify(evidence, null, 2);
    for (const token of secrets) report = report.replaceAll(token, '[redacted]');
    writeFileSync(join(root, 'evidence.json'), report, { mode: 0o600 });
    console.log(report);
}
