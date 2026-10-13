import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { preflightBinaries, preflightBrowser } from './fixtures/smoke-preflight';

// Fixed groups; each script owns and cleans its mutable environment.
const group = process.argv[2], binary = resolve(process.argv[3] ?? 'dist/runweft');
const history = process.argv.slice(4);
const groups = ['access', 'storage', 'web', 'service-package'];
assert(groups.includes(group!), `Usage: test:integration <${groups.join('|')}> [CLI] [web history evidence...]`);
assert(group === 'web' || history.length === 0, 'Only web accepts native history evidence');
const binaries = preflightBinaries(binary), hapi = binaries.hapi.path;
const cases: Record<string, string[][]> = {
    access: [
        ['smoke-hub-access.ts', hapi], ['smoke-hub-realtime.ts', hapi],
        ['smoke-hub-resources.ts', hapi, binary], ['smoke-hub-configuration.ts', hapi, binary],
    ],
    storage: [
        ['smoke-artifacts.ts', binary, hapi], ['smoke-inputs.ts', binary, hapi],
        ['smoke-outputs.ts', binary, hapi], ['smoke-artifact-prune.ts', binary, hapi],
        ['smoke-repository-export.ts', binary, hapi], ['smoke-repository-import.ts', binary, hapi],
        ['smoke-result-export.ts', binary, hapi, '--fetch'], ['smoke-result-export.ts', binary, hapi, '--tasks'],
        ['smoke-workspace-preparation.ts', binary, hapi],
        ['smoke-hub-delegation-native.ts', hapi], ['smoke-hub-delegation-preparation.ts', hapi],
    ],
    web: [
        ['smoke-hub.ts', binary, hapi], ['smoke-hub-connect.ts', binary],
        ['smoke-hub-console.ts', binary, ...history],
    ],
    'service-package': [
        // Both run the full service suite: standalone tarball/symlink and npm launcher.
        ['verify-packages.mjs', resolve(process.env.RUNWEFT_SMOKE_PACKAGES ?? 'dist/packages')],
        ['smoke-install.mjs', resolve(process.env.RUNWEFT_SMOKE_PACKAGES ?? 'dist/packages')],
    ],
};
mkdirSync('.dev-smoke', { recursive: true });
const root = mkdtempSync(resolve('.dev-smoke/integration-'));
const evidence = { group, binaries, startedAt: new Date().toISOString(), success: false,
    cases: [] as { script: string; startedAt: string; elapsedMs: number; exitCode: number | null }[] };
console.log(`Evidence: ${root}`);
try {
    if (group === 'web') await preflightBrowser();
    for (const [script, ...args] of cases[group!]!) {
        const item = { script: script!, startedAt: new Date().toISOString(), elapsedMs: 0, exitCode: null as number | null };
        evidence.cases.push(item);
        const started = Date.now();
        const child = Bun.spawn([script!.endsWith('.mjs') ? 'node' : process.execPath, resolve('scripts', script!), ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
        item.exitCode = await child.exited; item.elapsedMs = Date.now() - started;
        assert.equal(item.exitCode, 0, `${script} failed; inspect its evidence before rerunning this case`);
    }
    evidence.success = true;
} finally {
    writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
}
