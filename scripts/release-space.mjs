import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, statfsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const gib = 1024 ** 3;
export const releaseReserveBytes = 14 * gib; // Observed consumption ~9 GiB, plus headroom; sample the new peak below.
const removable = ['/usr/share/dotnet', '/opt/ghc', '/usr/local/lib/android'];
const availableBytes = () => { const { bavail, bsize } = statfsSync(process.cwd()); return bavail * bsize; };

export function ensureReleaseSpace({ available = availableBytes, clean = path => {
    assert(process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted' && process.env.RUNNER_OS === 'Linux',
        'Automatic SDK cleanup is restricted to GitHub-hosted Linux runners');
    const result = spawnSync('sudo', ['rm', '-rf', '--', path], { stdio: 'inherit' });
    assert.equal(result.status, 0, 'Hosted SDK cleanup failed');
} } = {}) {
    const result = { requiredBytes: releaseReserveBytes, beforeBytes: available(), afterBytes: 0, cleaned: [] };
    result.afterBytes = result.beforeBytes;
    for (const path of removable) {
        if (result.afterBytes >= releaseReserveBytes) break;
        const started = Date.now(); clean(path);
        result.afterBytes = available(); result.cleaned.push({ path, elapsedMs: Date.now() - started, availableBytes: result.afterBytes });
    }
    assert(result.afterBytes >= releaseReserveBytes, `Insufficient release space: ${result.afterBytes} bytes; need ${releaseReserveBytes}`);
    return result;
}

export async function measureReleaseSpace(command, { available = availableBytes, sampleIntervalMs = 1000 } = {}) {
    assert(command.length, 'measure requires a command');
    const result = { beforeBytes: available(), minAvailableBytes: 0, afterBytes: 0, sampleIntervalMs, exitCode: null };
    result.minAvailableBytes = result.beforeBytes;
    const sample = () => {
        try { result.afterBytes = available(); result.minAvailableBytes = Math.min(result.minAvailableBytes, result.afterBytes); }
        catch (error) { result.samplingError = error.message; } // Await the owned command; a telemetry failure must not orphan it.
    };
    const child = spawn(command[0], command.slice(1), { stdio: 'inherit' });
    let interrupted = false;
    const term = () => { interrupted = true; child.kill('SIGTERM'); };
    const int = () => { interrupted = true; child.kill('SIGINT'); };
    process.on('SIGTERM', term); process.on('SIGINT', int);
    const timer = setInterval(sample, result.sampleIntervalMs);
    try {
        result.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => resolve(interrupted ? 1 : code ?? 1)); });
    } finally { clearInterval(timer); process.off('SIGTERM', term); process.off('SIGINT', int); sample(); }
    if (result.samplingError && result.exitCode === 0) result.exitCode = 1;
    return result;
}

async function main() {
    const [mode, ...command] = process.argv.slice(2);
    assert(['ensure', 'measure'].includes(mode), 'Usage: release-space.mjs ensure | measure <command...>');
    if (mode === 'ensure') assert.equal(command.length, 0);
    const directory = resolve(process.env.GITHUB_WORKSPACE ?? '.', '.dev-smoke/release-space');
    mkdirSync(directory, { recursive: true });
    const file = join(mkdtempSync(join(directory, mode + '-')), 'evidence.json');
    const started = Date.now(), report = { mode, startedAt: new Date().toISOString(), success: false };
    try {
        Object.assign(report, mode === 'ensure' ? ensureReleaseSpace() : await measureReleaseSpace(command));
        report.success = mode === 'ensure' || report.exitCode === 0;
        if (!report.success) process.exitCode = report.exitCode;
    } catch (error) { report.error = error.message; throw error; }
    finally {
        report.elapsedMs = Date.now() - started;
        writeFileSync(file, JSON.stringify(report, null, 2));
        console.log('Release disk evidence: ' + JSON.stringify(report));
    }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
