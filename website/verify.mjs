import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, realpath, stat, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { serveSite } from './serve.mjs';

const run = promisify(execFile);
const repository = resolve(import.meta.dirname, '..');
const output = join(repository, 'dist/website');
await mkdir(join(repository, '.dev-smoke'), { recursive: true });
const evidenceRoot = await mkdtemp(join(repository, '.dev-smoke/website-'));
const evidence = { root: evidenceRoot, success: false, checks: [], layouts: [], pageErrors: [], networkErrors: [] };
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
  assert.deepEqual(release, { version: release.version, installation: 'npm', package: 'runweft', registry: 'https://registry.npmjs.org/' });
  const staticFiles = await readdir(output, { recursive: true });
  assert(!staticFiles.some(file => /(^|\/)downloads(\/|$)|\.(tgz|gz|sha256)$|SHA256SUMS/.test(file)));
  const sizes = await Promise.all(staticFiles.map(async file => { const info = await stat(join(output, file)); return info.isFile() ? info.size : 0; }));
  evidence.staticBytes = sizes.reduce((total, size) => total + size, 0);
  check('Static website has npm metadata and contains no downloads, archives or checksums');
  const started = await serveSite({ root: output, port: 0 }); servers.push(started.server);
  const subpath = await serveSite({ root: output, port: 0, mount: '/sub/' }); servers.push(subpath.server);
  browser = await chromium.launch({ headless: true, ...(process.env.RUNWEFT_SITE_CHROMIUM ? { executablePath: process.env.RUNWEFT_SITE_CHROMIUM } : {}) });
  evidence.browser = browser.version();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
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
  assert.equal(await page.locator('#routing-label').textContent(), '本机 Hub 调度');
  check('Local / remote diagram is interactive and explicitly illustrative');

  await page.locator('[data-copy="onboarding-prompt"]').click();
  const prompt = await page.locator('#onboarding-prompt').textContent();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), prompt);
  assert(prompt.includes(`npm 安装 runweft@${release.version}`) && prompt.includes('安装、升级和卸载都使用 npm'));
  const expected = await page.locator('#install-command').textContent();
  assert.match(expected, new RegExp(`^npm install -g runweft@${release.version.replaceAll('.', '\\.')} --registry=https://registry.npmjs.org/ --include=optional &&\\nrunweft --version$`));
  await writeFile(join(evidenceRoot, 'install-from-dom.sh'), expected + '\n');
  await page.locator('[data-copy="install-command"]').click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), expected);
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('Denied by test')) } }));
  await page.locator('[data-copy="install-command"]').click();
  assert.equal(await page.evaluate(() => window.getSelection().toString()), expected);
  assert((await page.locator('#copy-status').textContent()).includes('未允许自动复制'));
  assert(await page.locator('#install-command').evaluate(element => element.closest('pre') === document.activeElement));
  check('Agent prompt and npm commands copy correctly; clipboard denial selects the command with accessible feedback');

  await page.locator('#faq details summary').first().click();
  assert(await page.locator('#faq details').first().evaluate(element => element.open));
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const route of ['', 'guide.html', 'manual.html']) {
      await page.goto(started.url + route);
      assert.equal(await page.locator('a[download],a[href*="downloads/"]').count(), 0);
      assert(!(await page.locator('body').textContent()).includes('尚未发布到公共 npm'));
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
  assert.equal(await page.locator('#guide-install-command').textContent(), expected);
  const skillCommand = await page.locator('#skill-path-command').textContent();
  await writeFile(join(evidenceRoot, 'skill-path-from-dom.sh'), skillCommand + '\n');
  await page.locator('#mcp summary').click();
  await page.locator('[data-client="claude"]').click();
  assert.equal(await page.locator('#mcp-command').textContent(), 'runweft mcp install --client claude\nrunweft mcp check --client claude');
  await page.locator('#resources summary').click();
  await page.locator('[data-runtime="claude"]').click();
  assert((await page.locator('#runtime-command').textContent()).includes('runtime register claude --machine <machineId>'));
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
  check(`Relative deployment: ${checkedLinks.size} local links and anchors`);

  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto(started.url);
  assert.equal(await page.locator('.map-flow').evaluate(element => getComputedStyle(element).animationName), 'none');
  const plain = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 1000 } });
  const plainPage = await plain.newPage(); await plainPage.goto(started.url);
  assert.equal(await plainPage.locator('#install-command').textContent(), expected);
  await plainPage.locator('a[href="guide.html"]').first().click();
  assert.equal(await plainPage.locator('#guide-install-command').textContent(), expected);
  assert.equal(await plainPage.locator('#skill-path-command').textContent(), skillCommand);
  await assertLayout(plainPage, 'no-js guide', 390); await plainPage.close(); await plain.close();
  check('Reduced motion and the same npm installation / Skill location commands without JavaScript');

  // Execute the exact rendered commands without inheriting user npm configuration, credentials or installed binaries.
  const installHome = join(evidenceRoot, 'install-home'); await mkdir(installHome);
  const prefix = join(installHome, 'npm-global'), nodeOnly = join(evidenceRoot, 'node-bin');
  await mkdir(nodeOnly); await symlink(process.execPath, join(nodeOnly, 'node'));
  await symlink(await realpath(join(dirname(process.execPath), 'npm')), join(nodeOnly, 'npm'));
  const userconfig = join(installHome, 'npmrc'), globalconfig = join(installHome, 'npmrc-global');
  await writeFile(userconfig, '', { mode: 0o600 }); await writeFile(globalconfig, '', { mode: 0o600 });
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) if (/^npm_config_/i.test(key) || /^(NPM_TOKEN|NODE_AUTH_TOKEN|BASH_ENV|ENV)$/i.test(key)) delete environment[key];
  Object.assign(environment, { HOME: installHome, RUNWEFT_HOME: join(installHome, '.runweft'),
    PATH: `${prefix}/bin:${nodeOnly}:/usr/bin:/bin`, npm_config_prefix: prefix,
    npm_config_userconfig: userconfig, npm_config_globalconfig: globalconfig, npm_config_cache: join(installHome, 'npm-cache'),
  });
  const failedBin = join(evidenceRoot, 'failed-bin'); await mkdir(failedBin);
  const marker = join(evidenceRoot, 'unexpected-runweft');
  await writeFile(join(failedBin, 'npm'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  await writeFile(join(failedBin, 'runweft'), '#!/bin/sh\ntouch "$RUNWEFT_TEST_MARKER"\n', { mode: 0o755 });
  await assert.rejects(run('/bin/bash', ['--noprofile', '--norc', join(evidenceRoot, 'install-from-dom.sh')], {
    env: { ...environment, PATH: `${failedBin}:/usr/bin:/bin`, RUNWEFT_TEST_MARKER: marker }, timeout: 10_000,
  }));
  await assert.rejects(stat(marker), { code: 'ENOENT' });
  check('A failed npm install stops the DOM command before running any existing Runweft');
  check('Installing the exact DOM npm command in a dedicated prefix from the public registry');
  const installed = await run('/bin/bash', ['--noprofile', '--norc', join(evidenceRoot, 'install-from-dom.sh')], {
    env: environment, timeout: 600_000, maxBuffer: 4 * 1024 * 1024,
  });
  assert(installed.stdout.trim().endsWith(release.version));
  const located = await run('/bin/bash', ['--noprofile', '--norc', '-c', 'command -v runweft'], { env: environment });
  const binary = join(prefix, 'bin/runweft'); assert.equal(located.stdout.trim(), binary);
  const version = await run(binary, ['--version'], { env: environment }); assert.equal(version.stdout.trim(), release.version);
  const locatedSkill = await run('/bin/bash', ['--noprofile', '--norc', join(evidenceRoot, 'skill-path-from-dom.sh')], { env: environment });
  const skillDirectory = locatedSkill.stdout.trim();
  assert.equal(skillDirectory, join(prefix, 'lib/node_modules/runweft/skills/runweft'));
  for (const file of ['SKILL.md', 'references/onboarding.md', 'references/configuration.md', 'references/delegation.md', 'references/maintenance.md']) {
    assert((await stat(join(skillDirectory, file))).size > 0);
  }
  const installedPackage = JSON.parse(await readFile(join(prefix, 'lib/node_modules/runweft/package.json'), 'utf8'));
  assert.equal(installedPackage.name, release.package); assert.equal(installedPackage.version, release.version);
  evidence.install = { version: version.stdout.trim(), commandSource: 'rendered DOM', prefix, binary, launcherSha256: await hash(binary), skillDirectory };
  check('DOM npm install and Skill location succeed; the installed binary belongs to the isolated prefix and all Skill references exist');
  assert.equal((await fetch(started.url + '../package.json')).status, 404);
  assert.equal((await fetch(started.url, { method: 'POST' })).status, 405);
  check('Preview root and method boundaries hold');

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
