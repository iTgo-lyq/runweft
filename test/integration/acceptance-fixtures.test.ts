import { afterEach, expect, spyOn, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fixture } from '../helpers';
import { fixtureCleanup } from '../fixture-cleanup';
import { watchNativeHost } from '../acceptance/native-host';
import { installedBinaries, assertCandidateBinaries } from '../../scripts/installed-binaries.mjs';
import { preflightBrowser } from '../preflight';

const cleanup = fixtureCleanup([]);
afterEach(() => cleanup.close());

test('preflight resolves installed launcher/core consistently and rejects bad hash and browser before model work', async () => {
    const root = fixture('candidate-contract', cleanup.resources), packageRoot = join(root, 'node_modules/runweft');
    const native = join(packageRoot, `node_modules/runweft-${process.platform}-${process.arch}`);
    mkdirSync(join(native, 'bin'), { recursive: true });
    writeFileSync(join(native, 'package.json'), '{}');
    const core = join(native, 'bin/runweft'), launcher = join(packageRoot, 'runweft.cjs');
    writeFileSync(core, 'CORE'); writeFileSync(join(native, 'bin/hapi'), 'HAPI'); writeFileSync(launcher, 'LAUNCHER');
    const command = join(root, 'runweft'); symlinkSync(launcher, command);
    const produced = installedBinaries(command);
    expect(assertCandidateBinaries(command, JSON.parse(JSON.stringify(produced)))).toEqual(installedBinaries(core));
    expect(() => assertCandidateBinaries(command, { ...produced, runweft: { path: launcher, sha256: 'wrong-launcher-hash' } })).toThrow('Candidate runweft hash differs');
    await expect(preflightBrowser(join(root, 'missing-chromium'))).rejects.toThrow();
});

test('native host timeout fails even when SIGTERM exits zero; diagnostics never retain raw stderr', async () => {
    const child = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>process.exit(0));console.log('READY');setInterval(()=>{},1000)"], { stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise<void>((resolve, reject) => { child.stdout!.once('data', () => resolve()); child.once('error', reject); });
    const watcher = watchNativeHost(child, 30, 1000);
    try {
        child.stderr!.emit('data', Buffer.from('PRIVATE_SECRET prompt source serverOverloaded'));
        watcher.progress('wait');
        const code = await new Promise<number | null>(resolve => child.once('exit', resolve));
        expect(code).toBe(0); expect(() => watcher.check(code)).toThrow('host_timeout');
        expect(watcher.state.errors).toEqual(['serverOverloaded']);
        expect(JSON.stringify(watcher.state)).not.toContain('PRIVATE_SECRET');
    } finally { watcher.close(); if (child.exitCode === null) child.kill('SIGKILL'); }
});


// Verify the acceptance boundary without dispatching any native model.
test('native entry rejects missing candidates and preserves failure receipts; report verification uses caller requirements and frozen inputs', async () => {
    const { selectedCases, verifyReports } = await import('../acceptance/native');
    const { createHash } = await import('node:crypto');
    const { packageInputs } = await import('../../scripts/release-inputs.mjs');
    const root = fixture('native-boundary', cleanup.resources), report = join(root, 'failure.json');
    expect(selectedCases('main')).toEqual(['N1', 'N4', 'N5', 'C-codex', 'C-claude']);
    expect(() => selectedCases('expanded')).toThrow(); expect(() => selectedCases('N2')).toThrow();
    const child = spawnSync(process.execPath, ['test/acceptance/native.ts', '--candidate', join(root, 'absent'), '--case', 'N1', '--report', report], { encoding: 'utf8', timeout: 20_000 });
    expect(child.status).toBe(1); expect(JSON.parse(readFileSync(report, 'utf8')).success).toBe(false);
    const git = (...args: string[]) => { const r = spawnSync('git', args, { encoding: 'utf8' }); expect(r.status).toBe(0); return r.stdout.trim(); };
    const source = git('rev-parse', 'HEAD'), hash = (paths: string[]) => createHash('sha256').update(git('ls-tree', '-r', source, '--', ...paths)).digest('hex');
    const pkg = JSON.parse(git('show', source + ':package.json'));
    const inputs = ['test/acceptance', 'test/integration/console-history.ts', 'test/preflight.ts', 'test/lifecycle.ts', 'scripts/candidate.mjs', 'scripts/installed-binaries.mjs', 'scripts/release-inputs.mjs', 'package.json', 'bun.lock'];
    const record = { kind: 'runweft-native-v1', binding: { source, testSource: source, packageInputs: hash(packageInputs), testInputs: hash(inputs), hapi: pkg.hapi,
        bun: pkg.packageManager.split('@')[1], build: 'package-default', platform: 'linux-x64', binaries: { runweft: 'a'.repeat(64), hapi: 'b'.repeat(64) },
        archives: [{ name: 'runweft', sha512: Buffer.alloc(64).toString('base64') }, { name: 'runweft-linux-x64', sha512: Buffer.alloc(64).toString('base64') }] },
        cases: [{ id: 'N1', success: true, cleanupErrors: [], finishedAt: new Date().toISOString(), facts: {}, models: { codex: { model: 'fixture', reasoningEffort: 'high' } }, versions: { codex: 'fixture' } }] };
    const path = join(root, 'report.json'), save = () => writeFileSync(path, JSON.stringify(record)); save();
    expect(verifyReports([path], source, ['N1']).passed).toBe(true);
    expect(() => verifyReports([path], source, ['N1', 'N5'])).toThrow('N5');
    expect(() => verifyReports([path], source, ['unknown'])).toThrow();
    record.binding.packageInputs = 'wrong'; save(); expect(() => verifyReports([path], source, ['N1'])).toThrow();
    record.binding.packageInputs = hash(packageInputs); record.cases[0]!.success = false; save(); expect(() => verifyReports([path], source, ['N1'])).toThrow('retry');
});
