import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ensureReleaseSpace, measureReleaseSpace, releaseReserveBytes } from '../release-space.mjs';

test('space reserve avoids cleanup when sufficient and stops as soon as the reserve is restored', () => {
    const clean = [];
    assert.deepEqual(ensureReleaseSpace({ available: () => releaseReserveBytes, clean: path => clean.push(path) }).cleaned, []);
    let free = releaseReserveBytes - 1;
    const result = ensureReleaseSpace({ available: () => free, clean: path => { clean.push(path); free += 1024; } });
    assert.deepEqual(clean, ['/usr/share/dotnet']); assert(result.afterBytes >= releaseReserveBytes);
});

test('insufficient space and cleanup failure stop the release rather than continuing optimistically', () => {
    const clean = [];
    assert.throws(() => ensureReleaseSpace({ available: () => 0, clean: path => clean.push(path) }), /Insufficient release space/);
    assert.deepEqual(clean, ['/usr/share/dotnet', '/opt/ghc', '/usr/local/lib/android']);
    assert.throws(() => ensureReleaseSpace({ available: () => 0, clean: () => { throw new Error('permission denied'); } }), /permission denied/);
});

test('space measurement preserves the child failure and records an observed minimum', async () => {
    const result = await measureReleaseSpace([process.execPath, '-e', 'process.exit(7)']);
    assert.equal(result.exitCode, 7); assert(result.minAvailableBytes > 0);
    assert(result.minAvailableBytes <= result.beforeBytes); assert(result.minAvailableBytes <= result.afterBytes);
    await assert.rejects(measureReleaseSpace(['/missing/runweft-measure-command']), /ENOENT/);
});

test('sampling failure waits for the command to finish and cannot report a successful measurement', async () => {
    let reads = 0;
    const result = await measureReleaseSpace([process.execPath, '-e', 'setTimeout(()=>{},50)'], {
        available: () => { if (reads++) throw new Error('statfs failed'); return 1024; }, sampleIntervalMs: 10,
    });
    assert.equal(result.exitCode, 1); assert.equal(result.samplingError, 'statfs failed'); assert(reads > 2);
    assert.equal(result.afterBytes, null);
    let first = true;
    const nonError = await measureReleaseSpace([process.execPath, '-e', ''], {
        available: () => { if (first) { first = false; return 1024; } throw undefined; },
    });
    assert.equal(nonError.exitCode, 1); assert(nonError.samplingError); assert.equal(nonError.afterBytes, null);
});

test('measurement SIGTERM reaches the owned command and writes a failed report even if the child exits zero', async () => {
    mkdirSync('.dev-smoke', { recursive: true });
    const root = mkdtempSync(resolve('.dev-smoke/space-signal-'));
    const wrapper = spawn(process.execPath, ['scripts/release-space.mjs', 'measure', process.execPath, '-e',
        "process.on('SIGTERM',()=>process.exit(0)); console.log(process.pid); setInterval(()=>{},1000)"],
    { env: { ...process.env, GITHUB_WORKSPACE: root }, stdio: ['ignore', 'pipe', 'pipe'] });
    const closed = once(wrapper, 'close'); let pid;
    const kill = id => { if (id) try { process.kill(id, 'SIGKILL'); } catch {} };
    const watchdog = setTimeout(() => { kill(wrapper.pid); kill(pid); }, 5000);
    try {
        const [chunk] = await Promise.race([once(wrapper.stdout, 'data'), closed.then(() => { throw new Error('Wrapper exited before child readiness'); })]);
        pid = Number(String(chunk).trim()); assert(Number.isSafeInteger(pid) && pid > 0);
        wrapper.kill('SIGTERM'); const [code] = await closed; assert.equal(code, 1);
        assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
        const directory = join(root, '.dev-smoke/release-space');
        const evidence = JSON.parse(readFileSync(join(directory, readdirSync(directory)[0], 'evidence.json')));
        assert.equal(evidence.success, false); assert.equal(evidence.exitCode, 1);
    } finally {
        clearTimeout(watchdog);
        if (wrapper.exitCode === null && wrapper.signalCode === null) { kill(wrapper.pid); kill(pid); await closed; }
        rmSync(root, { recursive: true, force: true });
    }
});
