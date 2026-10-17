import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import { Database } from 'bun:sqlite';
import { freePort } from '../../src/services';
import { hubConnectionPaths } from '../../src/hub/resources/connection';
import { installedBinaries } from '../../scripts/installed-binaries.mjs';
import { closeSmoke } from '../lifecycle';
import { afterEach, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { rmSync as removeRoot } from 'node:fs';
import { integrationBinaries } from './binaries';

let closeOwned: () => Promise<void> = async () => {};
afterEach(() => closeOwned());

test('web-connect real integration', async () => {
    integrationBinaries();
    const binary = integrationBinaries().runweft.path;
    const root = mkdtempSync(join(tmpdir(), 'runweft-hub-connect-')), home = join(root, 'client'), serverHome = join(root, 'server');
    const port = await freePort(), url = `http://127.0.0.1:${port}`;
    const evidence: any = { root, binary, binaries: installedBinaries(binary), success: false, checks: [], screenshots: [], cleanupErrors: [],
        scope: 'installed default Hub and adjacent HAPI, public identity API, readonly SQLite assertions, RSA/WebCrypto and Chromium; no models' };
    const secretValues: string[] = [], outputTexts: string[] = [], pageErrors: string[] = [], requestUrls: string[] = [], consoleMessages: string[] = [];
    const env = { ...process.env }; for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_') || key.startsWith('HAPI_')) delete env[key];
    const check = (name: string) => { evidence.checks.push(name); console.log(`PASS ${name}`); };
    async function cli(args: string[]) {
        const child = Bun.spawn([binary, '--home', home, '--json', 'hub', '--url', url, ...args], { env, stdout: 'pipe', stderr: 'pipe' });
        const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        outputTexts.push(stdout, stderr); assert.equal(exit, 0, 'compiled CLI command failed'); return JSON.parse(stdout);
    }
    async function api(path: string, body: object, token = '') {
        const response = await fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
        assert.equal(response.status, 200); return await response.json() as any;
    }
    async function ready(page: Page) { await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('#logout')?.disabled); }
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    let database: Database | undefined;
    async function service(args: string[]) {
        const child = Bun.spawn([binary, '--home', serverHome, '--json', ...args], { env, stdout: 'pipe', stderr: 'pipe' });
        const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        outputTexts.push(stdout, stderr); assert.equal(code, 0, stderr); return JSON.parse(stdout);
    }

    let closing: Promise<void> | undefined;
    closeOwned = () => closing ??= (async () => {
        let serviceStopped = !existsSync(join(serverHome, 'config.yaml'));
        const resources: Array<() => void | Promise<void>> = [
            async () => { assert(serviceStopped, 'Service still running; connection secrets retained');
                const paths = hubConnectionPaths(home, url);
                await closeSmoke([paths.pendingConnection, paths.identityConnection, paths.machineConnection]
                    .map(file => () => rmSync(file, { force: true }))); },
            async () => { if (!serviceStopped) { await service(['stop']); serviceStopped = true; } },
            () => database?.close(), async () => { await browser?.close(); },
        ];
        try { await closeSmoke(resources); } catch (error) { evidence.cleanupErrors.push(...(error instanceof AggregateError ? error.errors.map(String) : [String(error)])); }
        if (evidence.cleanupErrors.length) { evidence.success = false;  }
        writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
        console.log(`Evidence: ${join(root, 'evidence.json')}`);

        if (evidence.cleanupErrors?.length) throw new AggregateError(evidence.cleanupErrors, 'Integration cleanup failed');
        if (evidence.success) removeRoot(root, { recursive: true, force: true });
    })();
    try {
        await service(['init']); await service(['config', 'set', 'server.port', String(port)]); await service(['start']);
        database = new Database((await service(['paths'])).state, { readonly: true });
        browser = await chromium.launch({ headless: true, executablePath: process.env.RUNWEFT_SMOKE_CHROMIUM });
        const context = await browser.newContext({ viewport: { width: 1280, height: 960 } }), page = await context.newPage();
        page.on('pageerror', error => pageErrors.push(error.message)); page.on('console', msg => consoleMessages.push(msg.text()));
        page.on('request', request => requestUrls.push(request.url()));
        const first = await cli(['connect', 'begin', '--name', '开发工作区']), paths = hubConnectionPaths(home, url);
        const pending = JSON.parse(readFileSync(paths.pendingConnection, 'utf8'));
        secretValues.push(pending.secret, pending.privateKey); assert.equal(statSync(paths.pendingConnection).mode & 0o777, 0o600);
        assert.deepEqual(await cli(['connect', 'begin', '--name', '开发工作区']), first);
        await page.goto(first.confirmationUrl); await ready(page);
        assert.equal(await page.locator('#connect-code').textContent(), first.code);
        assert(await page.locator('#confirm-connection').isHidden()); assert.match(await page.locator('#connect-status').innerText(), /先进入/);
        assert.equal((await cli(['connect', 'complete'])).status, 'pending');
        check('anonymous confirmation link shows origin, machine and code; never automatically confirms');

        await page.locator('#new-name').fill('连接验收'); await page.locator('#create-identity button').click();
        await page.locator('#secret-dialog[open]').waitFor(); await ready(page);
        const token = await page.locator('#secret-value').innerText(); secretValues.push(token);
        const ownerId = await page.locator('#identity-id').innerText();
        await page.locator('#close-secret').click();
        // An alternate space proves the browser selects membership instead of defaulting to the personal space.
        await page.getByText('创建协作空间', { exact: true }).click(); await page.locator('#new-space-name').fill('目标协作空间');
        await page.getByRole('button', { name: '创建空间', exact: true }).click(); await ready(page);
        await page.waitForFunction(() => document.querySelector('#space-name')?.textContent === '目标协作空间');
        const spaceId = await page.locator('#space-id').innerText();
        assert.match(await page.locator('#connect-identity').innerText(), /目标协作空间/);
        await page.locator('#confirm-connection').click(); await ready(page);
        assert.match(await page.locator('#connect-status').innerText(), /连接已确认/);
        assert(await page.locator('#confirm-connection').isHidden());
        const row = database.query('SELECT * FROM hub_connection_requests WHERE id=?').get(first.requestId) as any;
        assert.equal(row.ownerId, ownerId); assert.equal(row.spaceId, spaceId); assert.equal(row.pollingDigest, createHash('sha256').update(pending.secret).digest('hex'));
        assert(row.ciphertext && !JSON.stringify(row).includes(token)); secretValues.push(row.ciphertext);
        await page.screenshot({ path: join(root, 'confirmed-desktop.png'), fullPage: true }); evidence.screenshots.push(join(root, 'confirmed-desktop.png'));
        check('WebCrypto encrypts current identity after explicit space selection; Hub persists ciphertext and token digest only');

        const [done, repeat] = await Promise.all([cli(['connect', 'complete']), cli(['connect', 'complete'])]);
        assert.equal(done.status, 'connected'); assert.equal(repeat.status, 'connected'); assert.equal(done.ownerId, ownerId); assert.equal(done.spaceId, spaceId);
        const stored = JSON.parse(readFileSync(paths.identityConnection, 'utf8')); assert.equal(stored.token, token);
        assert.equal(statSync(paths.identityConnection).mode & 0o777, 0o600); assert(!existsSync(paths.pendingConnection));
        assert.equal((await cli(['identity'])).identity.id, ownerId);
        assert.equal((await cli(['connect', 'complete'])).status, 'connected');
        const consumed = database.query('SELECT status,ciphertext FROM hub_connection_requests WHERE id=?').get(first.requestId) as any;
        assert.equal(consumed.status, 'consumed'); assert.equal(consumed.ciphertext, null);
        await page.reload(); await ready(page); assert(await page.locator('#confirm-connection').isHidden());
        check('compiled CLI decrypts and validates identity/membership, saves atomically, consumes once and survives concurrent completion');

        const next = await cli(['connect', 'begin']);
        await page.setViewportSize({ width: 390, height: 844 }); await page.goto(next.confirmationUrl); await ready(page);
        await page.locator('#logout').click(); await ready(page);
        assert(await page.locator('#confirm-connection').isHidden());
        await page.locator('#import-token').fill(token); await page.locator('#import-identity button').click(); await ready(page);
        await page.locator('#confirm-connection').waitFor();
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
        await page.screenshot({ path: join(root, 'pending-mobile.png'), fullPage: true }); evidence.screenshots.push(join(root, 'pending-mobile.png'));
        await cli(['connect', 'cancel']); await page.reload(); await ready(page); await page.locator('#notice').waitFor();
        assert.match(await page.locator('#notice').innerText(), /过期或取消/); assert.equal(JSON.parse(readFileSync(paths.identityConnection, 'utf8')).token, token);
        check('mobile confirmation requires an active identity; cancellation invalidates the request and preserves the existing connection');

        const wrongOrigin = await api('/api/runweft/connect', { requestId: randomUUID(), origin: 'https://different.invalid', label: '地址不匹配', publicKey: pending.publicKey,
            pollingDigest: createHash('sha256').update(randomBytes(32)).digest('hex') });
        await page.goto(`${url}/hub#connect=${wrongOrigin.id}`); await ready(page);
        assert.match(await page.locator('#connect-status').innerText(), /地址与当前页面不一致/); assert(await page.locator('#confirm-connection').isHidden());
        assert.equal(pageErrors.length, 0, 'browser threw an error');
        for (const secret of secretValues) for (const output of [...outputTexts, ...requestUrls, ...consoleMessages]) assert(!output.includes(secret), 'secret escaped into observable output');
        check('origin mismatch cannot confirm; CLI output, browser URLs and console contain no identity token, private key or polling secret');
        evidence.success = true;
    } finally { await closeOwned(); }
}, 120000);
