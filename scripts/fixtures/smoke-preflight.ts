import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { installedBinaries } from './installed-binaries.mjs';

export function preflightBinaries(binary: string) {
    const binaries = installedBinaries(binary);
    for (const [name, value] of Object.entries(binaries)) {
        const result = spawnSync(value.path, ['--version'], { encoding: 'utf8', timeout: 10_000 });
        assert.equal(result.status, 0, `preflight: ${name} cannot start (${result.error?.name ?? result.signal ?? result.status})`);
    }
    return binaries;
}

export async function preflightBrowser(executablePath = process.env.RUNWEFT_SMOKE_CHROMIUM) {
    const browser = await chromium.launch({ headless: true, executablePath });
    try { const page = await browser.newPage(); await page.goto('about:blank'); }
    finally { await browser.close(); }
}
