import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { buildSite } from './build.mjs';
import { serveSite } from './serve.mjs';

const run = promisify(execFile);
const repository = resolve(import.meta.dirname, '..');
const output = join(repository, 'dist/website');
await mkdir(join(repository, '.dev-smoke'), { recursive: true });
const evidenceRoot = await mkdtemp(join(repository, '.dev-smoke/website-'));
const evidence = { root: evidenceRoot, success: false, checks: [], downloads: [], layouts: [], pageErrors: [], networkErrors: [] };
const servers = [];
let browser;
const hash = async path => { const value = createHash('sha256'); for await (const chunk of createReadStream(path)) value.update(chunk); return value.digest('hex'); };
const check = text => { evidence.checks.push(text); console.log(text); };
const assertLayout = async (page, route, width) => {
  const layout = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  assert(layout.scroll <= layout.client + 1, `${route} overflow at ${width}: ${JSON.stringify(layout)}`);
  evidence.layouts.push({ route, width, ...layout });
};

try {
  const release = JSON.parse(await readFile(join(output, 'release.json'), 'utf8'));
  const packageIndexHash = await hash(join(repository, 'dist/packages/index.json'));
  const started = await serveSite({ root: output, port: 0 }); servers.push(started.server);
  const subpath = await serveSite({ root: output, port: 0, mount: '/sub/' }); servers.push(subpath.server);
  browser = await chromium.launch({ headless: true, ...(process.env.RUNWEFT_SITE_CHROMIUM ? { executablePath: process.env.RUNWEFT_SITE_CHROMIUM } : {}) });
  evidence.browser = browser.version();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  page.on('pageerror', error => evidence.pageErrors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) evidence.networkErrors.push({ url: response.url(), status: response.status() }); });
  await page.goto(started.url, { waitUntil: 'networkidle' });
  assert.match(await page.title(), /Runweft/);
  assert.equal(await page.locator('h1').count(), 1);
  await page.locator('[data-mode="remote"]').click();
  assert.equal(await page.locator('#routing-label').textContent(), '通过 Hub 调度');
  assert((await page.locator('#map-description').textContent()).includes('远端示意'));
  await page.locator('[data-mode="local"]').click();
  assert.equal(await page.locator('#routing-label').textContent(), '在本机调度');
  check('Local / remote diagram is interactive and explicitly illustrative');

  // Download from browser clicks, then verify the actual bytes saved on disk.
  const downloads = join(evidenceRoot, 'downloads'); await mkdir(downloads);
  for (const item of release.platforms) {
    await page.locator(`[data-platform="${item.id}"]`).click();
    assert.equal(await page.locator(`#platform-${item.id}`).getAttribute('aria-selected'), 'true');
    const commands = await page.locator('#install-command').textContent();
    assert(commands.includes(item.sha256) && commands.includes(item.filename));
    assert(commands.includes(item.id.startsWith('darwin') ? 'shasum -a 256 -c -' : 'sha256sum -c -'));
    const waiting = page.waitForEvent('download');
    await page.locator('#platform-download').click();
    const download = await waiting;
    assert.equal(download.suggestedFilename(), item.filename);
    const target = join(downloads, item.filename); await download.saveAs(target);
    assert.equal(await download.failure(), null);
    assert.equal(await hash(target), item.sha256);
    assert.equal(await (await fetch(started.url + `downloads/${item.filename}.sha256`)).text(), `${item.sha256}  ${item.filename}\n`);
    const head = await fetch(started.url + `downloads/${item.filename}`, { method: 'HEAD' });
    assert.equal(head.headers.get('content-encoding'), null);
    assert.equal(Number(head.headers.get('content-length')), item.bytes);
    evidence.downloads.push({ platform: item.id, filename: item.filename, sha256: item.sha256, bytes: item.bytes });
    if (item.id === 'linux-x64') await writeFile(join(evidenceRoot, 'install-from-dom.sh'), commands + '\n');
  }
  check('All four browser downloads match release hashes; per-file checksum paths and platform commands agree');

  await page.locator('[data-platform="linux-x64"]').click();
  const expected = await page.locator('#install-command').textContent();
  await page.locator('[data-copy="install-command"]').click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), expected);
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('Denied by test')) } }));
  await page.locator('[data-copy="install-command"]').click();
  assert.equal(await page.evaluate(() => window.getSelection().toString()), expected);
  assert((await page.locator('#copy-status').textContent()).includes('未允许自动复制'));
  await page.locator('[data-platform="darwin-arm64"]').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('[data-platform="darwin-x64"]').getAttribute('aria-selected'), 'true');
  assert.notEqual(await page.locator('[data-platform="darwin-x64"]').evaluate(element => getComputedStyle(element).outlineStyle), 'none');
  await page.keyboard.press('End');
  assert.equal(await page.locator('[data-platform="linux-arm64"]').getAttribute('aria-selected'), 'true');
  check('Clipboard success / denial selection, accessible feedback and keyboard platform tabs');

  await page.locator('.all-downloads summary').click();
  assert.equal(await page.locator('.all-downloads tbody tr').count(), 4);
  await page.locator('#faq details summary').first().click();
  assert(await page.locator('#faq details').first().evaluate(element => element.open));
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const route of ['', 'guide.html', 'manual.html']) {
      await page.goto(started.url + route);
      await assertLayout(page, route || 'index.html', width);
    }
  }
  check('Home, guide and manual have no page overflow at 1440 / 1024 / 768 / 390 / 320px');

  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto(started.url);
  await page.locator('#menu-toggle').focus(); await page.keyboard.press('Enter');
  assert.equal(await page.locator('#menu-toggle').getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#menu-toggle').getAttribute('aria-expanded'), 'false');
  assert(await page.locator('#menu-toggle').evaluate(element => element === document.activeElement));
  await page.locator('#menu-toggle').click();
  await page.locator('#site-nav a[href="guide.html"]').click();
  assert(page.url().endsWith('/guide.html'));
  await page.locator('[data-client="claude"]').click();
  assert.equal(await page.locator('#mcp-command').textContent(), 'runweft mcp install --client claude\nrunweft mcp check --client claude');
  await page.locator('[data-runtime="claude"]').click();
  assert((await page.locator('#runtime-command').textContent()).includes('runtime register claude'));
  check('Mobile menu, Escape focus and guide client/runtime switches');

  // Follow every local document link under a non-root deployment prefix.
  const checkedLinks = new Set();
  for (const route of ['', 'guide.html', 'manual.html']) {
    await page.goto(subpath.url + route);
    const links = await page.locator('a[href],link[href],script[src],img[src]').evaluateAll(elements => elements.map(element => element.href || element.src));
    for (const value of links) {
      const url = new URL(value, page.url());
      if (url.origin !== new URL(subpath.url).origin) continue;
      assert(url.pathname.startsWith('/sub/'), `Escaped deployment prefix: ${url.href}`);
      const key = url.pathname + url.hash;
      if (checkedLinks.has(key)) continue; checkedLinks.add(key);
      const response = await fetch(url, { method: 'HEAD' }); assert.equal(response.status, 200, key);
      if (url.hash) {
        const html = await (await fetch(url)).text();
        assert(html.includes(`id="${decodeURIComponent(url.hash.slice(1))}"`), `Missing anchor: ${key}`);
      }
    }
    await assertLayout(page, '/sub/' + route, 390);
  }
  await page.goto(subpath.url);
  await page.locator('[data-platform="linux-x64"]').click();
  const downloadAtSubpath = page.waitForEvent('download'); await page.locator('#platform-download').click();
  const subDownload = await downloadAtSubpath; const subFile = join(evidenceRoot, 'subpath-linux-x64.tgz'); await subDownload.saveAs(subFile);
  assert.equal(await hash(subFile), release.platforms.find(item => item.id === 'linux-x64').sha256);
  check(`Relative deployment: ${checkedLinks.size} local links and anchors, plus an actual /sub/ browser download`);

  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto(started.url);
  assert.equal(await page.locator('.map-flow').evaluate(element => getComputedStyle(element).animationName), 'none');
  const plain = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 1000 } });
  const plainPage = await plain.newPage(); await plainPage.goto(started.url);
  await plainPage.locator('.all-downloads summary').click(); assert.equal(await plainPage.locator('.all-downloads tbody tr').count(), 4);
  assert.equal(await plainPage.locator('.no-script-installs details').count(), 4);
  await plainPage.locator('.no-script-installs summary').filter({ hasText: 'Linux x64' }).click();
  assert((await plainPage.locator('.no-script-installs details[open] pre').textContent()).includes('sha256sum -c -'));
  await assertLayout(plainPage, 'no-js home', 390); await plainPage.close(); await plain.close();
  check('Reduced motion and readable no-JavaScript downloads / installation commands');

  // Use the exact command copied from rendered DOM, with a dedicated shell environment.
  const installHome = join(evidenceRoot, 'install-home'); await mkdir(installHome);
  const environment = { ...process.env, HOME: installHome, RUNWEFT_HOME: join(installHome, '.runweft'), PATH: '/usr/bin:/bin' };
  delete environment.BASH_ENV; delete environment.ENV;
  const installed = await run('/bin/bash', ['--noprofile', '--norc', join(evidenceRoot, 'install-from-dom.sh')], { cwd: downloads, env: environment, timeout: 120_000 });
  assert.match(installed.stdout, /1\.0\.0\s*$/);
  const binary = join(installHome, '.local/bin/runweft');
  const version = await run(binary, ['--version'], { env: environment }); assert.equal(version.stdout.trim(), release.version);
  const index = JSON.parse(await readFile(join(repository, 'dist/packages/index.json'), 'utf8'));
  assert.equal(await hash(binary), index.packages.find(item => item.name === 'runweft-linux-x64').binaries['bin/runweft']);
  await writeFile(join(evidenceRoot, 'install-output.txt'), installed.stdout);
  evidence.install = { version: version.stdout.trim(), sha256: await hash(binary), home: installHome };
  check('Exact Linux x64 DOM commands install the release and run without global Bun/Node/HAPI');

  // Failed website builds must keep the already usable website and release artifacts intact.
  const beforeHome = await hash(join(output, 'index.html'));
  const stagingBefore = (await readdir(join(repository, 'dist'))).filter(name => name.startsWith('.website-')).sort();
  const incomplete = join(evidenceRoot, 'invalid-packages'); await mkdir(incomplete);
  for (const file of ['index.json', 'SHA256SUMS']) await cp(join(repository, 'dist/packages', file), join(incomplete, file));
  await assert.rejects(buildSite({ packagesDirectory: incomplete, outputDirectory: output }), /ENOENT/);
  await mkdir(join(incomplete, 'tarballs'));
  await writeFile(join(incomplete, 'tarballs', release.platforms[0].filename), 'invalid archive');
  await assert.rejects(buildSite({ packagesDirectory: incomplete, outputDirectory: output }), /校验失败/);
  assert.equal(await hash(join(output, 'index.html')), beforeHome);
  assert.equal(await hash(join(repository, 'dist/packages/index.json')), packageIndexHash);
  assert.deepEqual((await readdir(join(repository, 'dist'))).filter(name => name.startsWith('.website-')).sort(), stagingBefore);
  assert.equal((await fetch(started.url + '../package.json')).status, 404);
  assert.equal((await fetch(started.url, { method: 'POST' })).status, 405);
  check('Missing / corrupt package builds preserve the website; preview root and method boundaries hold');

  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto(started.url); await page.screenshot({ path: join(evidenceRoot, 'home-desktop.png') });
  await page.locator('#install').scrollIntoViewIfNeeded(); await page.screenshot({ path: join(evidenceRoot, 'install-desktop.png') });
  await page.goto(started.url + 'guide.html'); await page.screenshot({ path: join(evidenceRoot, 'guide-desktop.png') });
  await page.setViewportSize({ width: 390, height: 1050 }); await page.goto(started.url); await page.screenshot({ path: join(evidenceRoot, 'home-mobile.png') });
  await page.goto(started.url + 'guide.html'); await page.screenshot({ path: join(evidenceRoot, 'guide-mobile.png') });
  assert.deepEqual(evidence.pageErrors, []); assert.deepEqual(evidence.networkErrors, []);
  evidence.success = true;
} catch (error) {
  evidence.error = error.stack || String(error); console.error(evidence.error); process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  for (const server of servers) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  await writeFile(join(evidenceRoot, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(`Website evidence: ${join(evidenceRoot, 'evidence.json')}`);
}
