import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { installCandidate, readCandidate } from '../../scripts/candidate.mjs';
import { assertFrozenCandidate, packageInputs } from '../../scripts/release-inputs.mjs';
import { preflightBrowser } from '../preflight';
import { nativeFixture, type Flavor } from './native-fixture';
import { collaboration } from './collaboration';
import { controls } from './controls';
import { recovery } from './recovery';
import pkg from '../../package.json';

export const mainCases = ['N1', 'N4', 'N5', 'C-codex', 'C-claude'];
const cases = [...mainCases, 'R-codex', 'R-claude', 'L-claude'];
const testInputs = ['test/acceptance', 'test/integration/console-history.ts', 'test/preflight.ts', 'test/lifecycle.ts', 'scripts/candidate.mjs', 'scripts/installed-binaries.mjs', 'scripts/release-inputs.mjs', 'package.json', 'bun.lock'];
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
function git(...args: string[]) { const r = spawnSync('git', args, { encoding: 'utf8' }); assert.equal(r.status, 0, 'Cannot read frozen Git inputs'); return r.stdout.trim(); }
function tree(source: string, paths: string[]) { return sha(git('ls-tree', '-r', source, '--', ...paths)); }
export function selectedCases(value: string) { assert(value === 'main' || cases.includes(value), 'Select main, N1/N4/N5, C-codex/C-claude, R-codex/R-claude or L-claude'); return value === 'main' ? [...mainCases] : [value]; }
export function verifyReports(files: string[], source: string, required: string[]) {
    assert.match(source, /^[a-f0-9]{40}$/); assert(required.length && new Set(required).size === required.length && required.every(id => cases.includes(id)), 'Caller must provide known, unique required cases');
    const inputs = tree(source, packageInputs), tests = tree(source, testInputs), results = new Map<string, any>();
    const records = files.map(path => { const bytes = readFileSync(path); return { digest: sha(bytes), value: JSON.parse(bytes.toString()) }; });
    assert.equal(new Set(records.map(r => r.digest)).size, records.length, 'Duplicate reports');
    for (const { value: report } of records) {
        assert.equal(report.kind, 'runweft-native-v1');
        assert(report.binding && report.cases.length > 0, 'Missing execution evidence');
        const b = report.binding;
        assert.equal(b.packageInputs, inputs); assert.equal(b.testInputs, tests);
        assert.equal(tree(b.source, packageInputs), inputs); assert.equal(tree(b.testSource, testInputs), tests);
        assert.deepEqual(b.hapi, JSON.parse(git('show', source + ':package.json')).hapi);
        assert.equal(b.bun, pkg.packageManager.split('@')[1]); assert.equal(b.build, 'package-default');
        assert.match(b.binaries.runweft, /^[a-f0-9]{64}$/); assert.match(b.binaries.hapi, /^[a-f0-9]{64}$/);
        assert(b.archives.length === 2 && b.archives.every((v: any) => typeof v.name === 'string' && typeof v.sha512 === 'string'));
        const seen = new Set();
        for (const item of report.cases) {
            assert(cases.includes(item.id) && !seen.has(item.id), 'Unknown or duplicate case'); seen.add(item.id);
            if (!item.success) continue;
            assert.deepEqual(item.cleanupErrors, []); assert(item.finishedAt && item.facts && item.versions && item.models);
            assert(!results.has(item.id), 'Conflicting successful case reports'); results.set(item.id, item);
        }
    }
    for (const { digest, value } of records) for (const item of value.cases) if (!item.success)
        assert(records.some(r => r.value.retryOf === digest && r.value.cases.some((c: any) => c.id === item.id && c.success)), 'Failed case needs an explicit successful retry reference');
    for (const id of required) assert(results.has(id), `Missing successful case ${id}`);
    return { source, required, reports: records.map(r => r.digest), passed: true };
}
function diagnostic(error: unknown) {
    const e = error as any;
    const location = String(e?.stack ?? '').split('\n').find(line => /(?:test|scripts)\//.test(line))?.trim();
    return { name: e?.name ?? 'Error', code: e?.code, location, message: e?.generatedMessage ? 'Assertion failed' : String(e?.message ?? 'Unknown failure').split('\n')[0].slice(0, 180) };
}
async function main() {
    const { values: args } = parseArgs({ options: { candidate: { type: 'string' }, case: { type: 'string' }, report: { type: 'string' }, 'retry-of': { type: 'string' },
        'verify-report': { type: 'string', multiple: true }, source: { type: 'string' }, 'required-cases': { type: 'string' } }, strict: true });
    if (args['verify-report']) { console.log(JSON.stringify(verifyReports(args['verify-report'], args.source!, args['required-cases']?.split(',') ?? []))); return; }
    assert(args.report, '--report is required'); const output = resolve(args.report); assert(!existsSync(output), 'Report already exists; preserve previous results');
    mkdirSync(dirname(output), { recursive: true });
    const report: any = { kind: 'runweft-native-v1', startedAt: new Date().toISOString(), success: false, cases: [] };
    const save = () => writeFileSync(output, JSON.stringify(report, null, 2), { mode: 0o600 }); save();
    try {
        const selected = selectedCases(args.case ?? ''); assert(args.candidate, '--candidate is required');
        const candidate = readCandidate(args.candidate);
        assertFrozenCandidate(candidate.index);
        const testSource = git('rev-parse', 'HEAD');
        assert.equal(git('diff', 'HEAD', '--', ...testInputs), '', 'Freeze acceptance code before model work');
        assert.equal(git('ls-files', '--others', '--exclude-standard', '--', ...testInputs), '', 'Commit acceptance inputs before model work');
        assert.equal(candidate.index.bunVersion, Bun.version);
        report.binding = { source: candidate.index.source.revision, testSource, packageInputs: tree(candidate.index.source.revision, packageInputs), testInputs: tree(testSource, testInputs),
            hapi: candidate.index.hapi, bun: Bun.version, build: 'package-default', platform: `${process.platform}-${process.arch}`,
            archives: candidate.entries.map((entry: any) => ({ name: entry.name, sha512: entry.sha512 })),
            binaries: { runweft: candidate.entries[1].binaries['bin/runweft'], hapi: candidate.entries[1].binaries['bin/hapi'] } };
        if (args['retry-of']) {
            const bytes = readFileSync(args['retry-of']), previous = JSON.parse(bytes.toString());
            assert.equal(previous.kind, report.kind); assert.deepEqual(previous.binding, report.binding);
            assert(selected.length === 1 && previous.cases.some((c: any) => c.id === selected[0] && !c.success)); report.retryOf = sha(bytes);
        }
        for (const id of selected) {
            const item: any = { id, startedAt: new Date().toISOString(), success: false, cleanupErrors: [] }; report.cases.push(item); save();
            let fixture: Awaited<ReturnType<typeof nativeFixture>> | undefined;
            try {
                if (['N1', 'N5'].includes(id)) await preflightBrowser();
                item.root = mkdtempSync(join(tmpdir(), 'runweft-native-'));
                const installed = await installCandidate(candidate.directory, join(item.root, 'candidate'), 'standalone');
                const flavors: Flavor[] = id === 'N1' || id.endsWith('codex') ? ['codex'] : id.startsWith('N') ? ['codex', 'claude'] : ['claude'];
                fixture = await nativeFixture(item.root, installed.cli, installed.env, flavors, ['N1', 'N4'].includes(id));
                item.models = Object.fromEntries(flavors.map(flavor => [flavor, fixture!.selections[flavor]]));
                item.versions = Object.fromEntries(flavors.map(flavor => {
                    const command = flavor === 'codex' ? 'codex' : fixture!.models.nativeClaude!;
                    const result = spawnSync(command, ['--version'], { env: installed.env, encoding: 'utf8', timeout: 20_000 }); assert.equal(result.status, 0);
                    return [flavor, result.stdout.trim()];
                })); save();
                item.facts = id.startsWith('N') ? await collaboration(fixture, id) : id.startsWith('C-') ? await controls(fixture, flavors[0]!) : await recovery(fixture, flavors[0]!, id === 'L-claude');
                item.success = true;
            } catch (error) { item.error = diagnostic(error); }
            finally {
                try { await fixture?.close(); } catch (error) { item.cleanupErrors.push(diagnostic(error)); }
                if (item.cleanupErrors.length) item.success = false;
                if (item.success) try { rmSync(item.root, { recursive: true }); } catch (error) { item.cleanupErrors.push(diagnostic(error)); item.success = false; }
                item.finishedAt = new Date().toISOString(); save();
            }
            console.log(JSON.stringify({ case: id, success: item.success, report: output }));
            if (!item.success) throw new Error(`Case ${id} failed; diagnose before a fresh single-case retry`);
        }
        report.success = true;
    } catch (error) { report.error = diagnostic(error); process.exitCode = 1; }
    finally { report.finishedAt = new Date().toISOString(); save(); }
}
if (import.meta.main) await main();
