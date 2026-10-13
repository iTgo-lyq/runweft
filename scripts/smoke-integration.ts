import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { preflightBinaries, preflightBrowser } from './fixtures/smoke-preflight';
import { integrationCases, integrationShards, runIntegrationCases } from './fixtures/integration-cases';

// Fixed groups; each script owns and cleans its mutable environment.
const group = process.argv[2], binary = resolve(process.argv[3] ?? 'dist/runweft');
const history = process.argv.slice(4);
const groups = Object.keys(integrationShards);
assert(groups.includes(group!), `Usage: test:integration <${groups.join('|')}> [CLI] [web history evidence...]`);
assert(group === 'web' || history.length === 0, 'Only web accepts native history evidence');
const shard = process.env.RUNWEFT_SMOKE_SHARD;
assert(process.env.RUNWEFT_SMOKE_SERIAL === undefined || process.env.RUNWEFT_SMOKE_SERIAL === '1', 'RUNWEFT_SMOKE_SERIAL must be 1 or unset');
const binaries = preflightBinaries(binary), hapi = binaries.hapi.path;
const cases = integrationCases(group!, { binary, hapi, history, packages: resolve(process.env.RUNWEFT_SMOKE_PACKAGES ?? 'dist/packages') }, shard);
const parallel = group === 'service-package' && process.env.RUNWEFT_SMOKE_SERIAL !== '1';
mkdirSync('.dev-smoke', { recursive: true });
const root = mkdtempSync(resolve('.dev-smoke/integration-'));
const evidence = { group, shard: shard ?? null, parallel, binaries, startedAt: new Date().toISOString(), success: false,
    cases: [] as { id: string; script: string; startedAt: string; elapsedMs: number; exitCode: number | null }[] };
console.log(`Evidence: ${root}`);
try {
    if (group === 'web') await preflightBrowser();
    await runIntegrationCases(cases, parallel, async ({ id, command: [script, ...args] }) => {
        const item = { id, script: script!, startedAt: new Date().toISOString(), elapsedMs: 0, exitCode: null as number | null };
        evidence.cases.push(item);
        const started = Date.now();
        try {
            const child = Bun.spawn([script!.endsWith('.mjs') ? 'node' : process.execPath, resolve('scripts', script!), ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
            item.exitCode = await child.exited;
            assert.equal(item.exitCode, 0, `${id} failed; inspect its evidence before rerunning this case`);
        } finally { item.elapsedMs = Date.now() - started; }
    });
    evidence.success = true;
} finally {
    writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
}
