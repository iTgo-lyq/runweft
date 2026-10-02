import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { installedBinaries } from './fixtures/installed-binaries.mjs';
import { assertFrozenCandidate } from './fixtures/release-inputs.mjs';

const packages = resolve(process.argv[2] ?? 'dist/packages');
const qemu = process.env.RUNWEFT_SMOKE_QEMU, sysroot = process.env.RUNWEFT_SMOKE_SYSROOT;
assert(qemu && sysroot, 'Set RUNWEFT_SMOKE_QEMU and RUNWEFT_SMOKE_SYSROOT; no global binfmt changes are made');
const index = JSON.parse(readFileSync(join(packages, 'index.json'), 'utf8'));
assertFrozenCandidate(index);
const entry = index.packages.find(item => item.name === 'runweft-linux-arm64');
assert(entry, 'Missing linux-arm64 package');
mkdirSync('.dev-smoke', { recursive: true });
const root = mkdtempSync(resolve('.dev-smoke/arm64-')), home = join(root, 'home');
const unpacked = join(root, 'platform'); mkdirSync(unpacked);
assert.equal(spawnSync('tar', ['-xzf', join(packages, entry.tarball), '-C', unpacked, '--strip-components=1']).status, 0);
const binaries = installedBinaries(join(unpacked, 'bin/runweft'));
for (const name of ['runweft', 'hapi']) assert.equal(binaries[name].sha256, entry.binaries[`bin/${name}`]);
const env = { ...process.env, HOME: root, CODEX_HOME: join(root, 'codex'), CLAUDE_CONFIG_DIR: join(root, 'claude') };
for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_') || key.startsWith('HAPI_') || ['CLI_API_TOKEN', 'DB_PATH', 'TELEGRAM_BOT_TOKEN'].includes(key)) delete env[key];
const evidence = { root, source: index.source, version: index.version, binaries, qemu: resolve(qemu), sysroot: resolve(sysroot),
    scope: 'QEMU user aarch64 on Linux x64; no native arm64 service tree, model execution or physical remote', commands: [], success: false };
function run(name, args, expected = 0) {
    const result = spawnSync(qemu, ['-L', sysroot, binaries[name].path, ...args], { cwd: root, env, encoding: 'utf8', timeout: 90_000 });
    evidence.commands.push({ binary: name, args, exitCode: result.status, stdout: result.stdout, stderr: result.stderr });
    assert.equal(result.status, expected, result.stderr || String(result.error));
    return result;
}
try {
    const version = spawnSync(qemu, ['--version'], { encoding: 'utf8' });
    assert.equal(version.status, 0); evidence.qemuVersion = version.stdout.split('\n')[0];
    assert.equal(run('runweft', ['--version']).stdout.trim(), index.version);
    assert(run('hapi', ['--version']).stdout.includes(index.hapi.version));
    const cli = (args, expected = 0) => run('runweft', ['--home', home, '--json', ...args], expected);
    assert.equal(JSON.parse(cli(['init']).stdout).created, true);
    cli(['config', 'check']); const paths = JSON.parse(cli(['paths']).stdout);
    assert.equal(paths.home, home);
    const missing = cli(['agent', 'list'], 1);
    assert.equal(JSON.parse(missing.stderr).error.code, 'hub_connection_required');
    evidence.success = true;
} finally {
    writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
    console.log(`Evidence: ${join(root, 'evidence.json')}`);
}
