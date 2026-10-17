import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { parseArgs } from 'node:util';
import { verifyServiceVersionDiagnosis } from './service-version.mjs';
import { installCandidate } from '../../scripts/candidate.mjs';

const { values } = parseArgs({ options: { candidate: { type: 'string' }, case: { type: 'string' }, report: { type: 'string' } } });
assert(values.candidate && values.report, 'Usage: test:install --candidate directory --case npm|standalone|all --report file');
const selection = values.case ?? 'all'; assert(['npm', 'standalone', 'all'].includes(selection), 'Unknown installation case');
const report = resolve(values.report), evidence = { startedAt: new Date().toISOString(), platform: `${process.platform}-${process.arch}`, cases: [], success: false };
mkdirSync(dirname(report), { recursive: true });
const pause = () => new Promise(resolve => setTimeout(resolve, 100));
async function until(check, label) {
    const deadline = Date.now() + 20000;
    do { if (await check()) return; await pause(); } while (Date.now() < deadline);
    throw new Error(label + ' timed out');
}
async function closed(url) { try { await fetch(url, { signal: AbortSignal.timeout(500) }); return false; } catch { return true; } }
async function freePort() {
    const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}

async function verify(layout) {
    const root = mkdtempSync(join(tmpdir(), `runweft-install-${layout}-`)), home = join(root, 'data');
    const item = { layout, root, checks: [], success: false, cleanupErrors: [] }; evidence.cases.push(item);
    let installed, foreground, url;
    function run(args, overrides = {}) {
        const result = spawnSync(installed.cli, ['--home', home, '--json', ...args], { cwd: root, env: installed.env, encoding: 'utf8', timeout: 65000, ...overrides });
        assert.equal(result.status, 0, result.stderr || result.error?.message);
        return JSON.parse(result.stdout);
    }
    try {
        installed = await installCandidate(values.candidate, root, layout);
        Object.assign(item, { source: installed.index.source, hapi: installed.index.hapi, binaries: installed.binaries });
        const tools = join(root, 'node-tools'); mkdirSync(tools);
        const npm = spawnSync('/usr/bin/which', ['npm'], { encoding: 'utf8' }).stdout.trim(); assert(npm);
        symlinkSync(process.execPath, join(tools, 'node')); symlinkSync(realpathSync(npm), join(tools, 'npm'));
        installed.env.PATH = `${tools}:/usr/bin:/bin:/usr/sbin:/sbin`;
        assert.equal(spawnSync('bun', ['--version'], { env: installed.env }).error?.code, 'ENOENT', 'Acceptance PATH must exclude Bun');
        const version = spawnSync(installed.cli, ['--version'], { cwd: root, env: installed.env, encoding: 'utf8' });
        assert.equal(version.status, 0); assert.equal(version.stdout.trim(), installed.index.version);
        item.checks.push('unchanged candidate archives and paired programs resolve outside checkout without Bun');

        const nativeConfig = join(installed.env.CLAUDE_CONFIG_DIR, '.claude.json');
        const original = { mcpServers: { keep: { command: 'keep-command' } }, other: 'preserve' };
        writeFileSync(nativeConfig, JSON.stringify(original));
        const sentinel = join(installed.env.HOME, 'project.txt'); writeFileSync(sentinel, 'KEEP');
        run(['init']);
        const port = await freePort(); url = `http://127.0.0.1:${port}`;
        run(['config', 'set', 'server.port', String(port)]);
        run(['config', 'set', 'hub.url', url]);
        assert(run(['start']).service.running);
        const identity = await (await fetch(url + '/api/runweft/hub/identities', { method: 'POST',
            headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'installation' }) })).json();
        const paths = run(['paths']);
        if (layout === 'npm') item.versionMismatch = await verifyServiceVersionDiagnosis(installed.cli, root, installed.env, JSON.parse(readFileSync(paths.process, 'utf8')), url);
        mkdirSync(dirname(paths.identityConnection), { recursive: true });
        writeFileSync(paths.identityConnection, JSON.stringify({ schemaVersion: 1, hub: url, ownerId: identity.identity.id,
            spaceId: identity.personalSpace.id, token: identity.token, requestId: randomUUID(), createdAt: Date.now() }), { mode: 0o600 });
        const machine = run(['machine', 'enroll']); run(['machine', 'associate', machine.machineId, identity.personalSpace.id]);
        assert(run(['runner', 'start']).online);
        run(['mcp', 'install', '--client', 'claude']);
        const checked = run(['mcp', 'check', '--client', 'claude']); assert(checked.configurationOk);
        assert(checked.checks.every(check => check.ok && check.handshake));
        assert.deepEqual(JSON.parse(readFileSync(nativeConfig, 'utf8')).mcpServers.keep, original.mcpServers.keep);
        item.checks.push('installed Hub, adjacent HAPI Runner and MCP handshake preserve unrelated native settings');
        run(['stop']); await until(() => closed(url + '/health'), 'background service stop');

        foreground = spawn(installed.cli, ['--home', home, 'serve'], { cwd: root, env: installed.env, stdio: 'ignore' });
        await until(async () => { assert.equal(foreground.exitCode, null); return !(await closed(url + '/api/runweft/health')); }, 'foreground service');
        foreground.kill('SIGTERM');
        await until(() => foreground.exitCode !== null || foreground.signalCode !== null, 'foreground exit');
        assert(foreground.exitCode === 0 || foreground.signalCode === 'SIGTERM');
        await until(() => closed(url + '/health'), 'foreground port release');
        item.checks.push('launcher forwards SIGTERM and actual foreground services release their port');

        run(['start']); run(['runner', 'start']);
        const before = readFileSync(join(home, 'config.yaml'));
        assert.equal(run(['uninstall', '--yes', '--dry-run']).applied, false);
        assert.deepEqual(readFileSync(join(home, 'config.yaml')), before);
        if (layout === 'npm') {
            const failing = join(root, 'failing-tools'); mkdirSync(failing);
            writeFileSync(join(failing, 'npm'), '#!/bin/sh\nexit 7\n', { mode: 0o700 });
            const result = spawnSync(installed.cli, ['--home', home, '--json', 'uninstall', '--yes'], {
                cwd: root, env: { ...installed.env, PATH: `${failing}:${installed.env.PATH}` }, encoding: 'utf8', timeout: 65000 });
            assert.equal(result.status, 1); assert.equal(JSON.parse(result.stderr).error.code, 'uninstall_program_failed');
            assert(existsSync(home) && existsSync(installed.cli));
            item.checks.push('failed npm removal retains program and data for explicit retry');
        }
        assert.equal(run(['uninstall', '--yes']).applied, true);
        assert(!existsSync(home) && !existsSync(installed.cli));
        await until(() => closed(url + '/health'), 'uninstalled service');
        assert.deepEqual(JSON.parse(readFileSync(nativeConfig, 'utf8')), original);
        assert.equal(readFileSync(sentinel, 'utf8'), 'KEEP');
        item.checks.push('complete uninstall stops owned services, removes its program/data and preserves external native config/project');
        item.success = true;
    } catch (error) { item.error = error.message; throw error; }
    finally {
        if (foreground && foreground.exitCode === null && foreground.signalCode === null) {
            foreground.kill('SIGTERM');
            try { await until(() => foreground.exitCode !== null || foreground.signalCode !== null, 'cleanup foreground'); }
            catch (error) { foreground.kill('SIGKILL'); item.cleanupErrors.push(error.message); }
        }
        if (installed && existsSync(installed.cli) && existsSync(join(home, 'config.yaml'))) {
            try { run(['stop']); const status = run(['status']); assert(!status.service.running && !status.runner.running); }
            catch (error) { item.cleanupErrors.push(error.message); }
        }
        if (url && !(await closed(url + '/health'))) item.cleanupErrors.push('Service still responds; installation root retained');
        if (item.cleanupErrors.length) { item.success = false; process.exitCode = 1; }
        else rmSync(root, { recursive: true, force: true });
        item.finishedAt = new Date().toISOString();
    }
}
try {
    for (const layout of selection === 'all' ? ['npm', 'standalone'] : [selection]) await verify(layout);
    evidence.success = evidence.cases.every(item => item.success);
} catch (error) { evidence.error = error.message; process.exitCode = 1; }
finally {
    evidence.finishedAt = new Date().toISOString();
    writeFileSync(report, JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
    console.log('Installation report: ' + report);
}
