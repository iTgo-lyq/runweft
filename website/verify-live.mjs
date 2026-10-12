import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const receipt = JSON.parse(await readFile('.dev-smoke/website-pages/deployment.json', 'utf8'));
const selectedWidths = process.argv.slice(2).map(Number);
assert(selectedWidths.every(width => [1440, 390].includes(width)), 'Usage: node website/verify-live.mjs [1440] [390]');
const widths = selectedWidths.length ? [...new Set(selectedWidths)] : [1440, 390];
assert.equal(receipt.success, true, '先完成唯一部署 URL 和正式域名的文件校验。');
if (receipt.mode === 'production') assert.equal(receipt.production?.success, true);
const url = receipt.mode === 'production' ? receipt.production.url : receipt.url;
const evidence = { url, version: receipt.version, sourceRevision: receipt.sourceRevision, widths, success: false, checks: [], errors: [] };
const browser = await chromium.launch({ headless: true });
try {
  for (const width of widths) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    page.on('pageerror', error => evidence.errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) evidence.errors.push('HTTP ' + response.status()); });
    for (const route of ['', 'guide.html', 'manual.html']) {
      const response = await page.goto(new URL(route, url).href, { waitUntil: 'networkidle' });
      assert.equal(response.status(), 200); assert.match(await page.title(), /Runweft/);
      assert.equal(await page.locator('h1').count(), 1);
      const layout = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
      assert(layout.scroll <= layout.width + 1, `${route} ${width}px 横向溢出。`);
      if (route !== 'manual.html') assert((await page.locator('body').innerText()).includes(`runweft@${receipt.version}`));
      for (const image of await page.locator('img').all()) {
        if (!await image.isVisible()) continue;
        await image.scrollIntoViewIfNeeded();
        assert(await image.evaluate(async element => { await element.decode(); return element.complete && element.naturalWidth > 0; }));
      }
      evidence.checks.push({ route: route || 'index.html', width });
    }
    await page.close();
  }
  assert.deepEqual(evidence.errors, []);
  evidence.success = true;
} finally {
  await browser.close();
  const suffix = selectedWidths.length ? '-' + widths.join('-') : '';
  await writeFile('.dev-smoke/website-pages/browser' + suffix + '.json', JSON.stringify(evidence, null, 2) + '\n');
}
