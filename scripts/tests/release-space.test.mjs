import assert from 'node:assert/strict';
import test from 'node:test';
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
