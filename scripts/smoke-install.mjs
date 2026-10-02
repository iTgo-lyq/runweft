import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createHash } from 'node:crypto';
import { verifyMcpInstallation } from './smoke-mcp-install.mjs';
import { installedBinaries } from './fixtures/installed-binaries.mjs';

const packageRoot = resolve(process.argv[2] ?? 'dist/packages');
const index = JSON.parse(readFileSync(join(packageRoot, 'index.json'), 'utf8'));
assert.equal(index.product, 'hub-console-v1');
const smokeRoot = resolve(process.env.RUNWEFT_SMOKE_ROOT ?? '.dev-smoke');
mkdirSync(smokeRoot, { recursive: true });
const root = mkdtempSync(join(smokeRoot, 'install-'));
const prefix = join(root, 'prefix');
const consumer = join(root, 'consumer');
const nodeOnly = join(root, 'tools');
for (const directory of [consumer, nodeOnly]) mkdirSync(directory, { recursive: true });
symlinkSync(process.execPath, join(nodeOnly, 'node'));
const userConfig = join(root, 'npmrc');
writeFileSync(userConfig, '');
const globalConfig = join(root, 'npmrc-global');
writeFileSync(globalConfig, '');
const env = { ...process.env };
for (const key of Object.keys(env)) if (/^npm_config_/i.test(key) || key.startsWith('RUNWEFT_')) delete env[key];
env.NPM_CONFIG_USERCONFIG = userConfig;
env.NPM_CONFIG_GLOBALCONFIG = globalConfig;
env.NPM_CONFIG_CACHE = join(root, 'npm-cache');
env.NPM_CONFIG_UPDATE_NOTIFIER = 'false';
const requests = [];
const entries = new Map(index.packages.map(entry => [entry.name, {
    ...entry, manifest: JSON.parse(readFileSync(join(packageRoot, entry.path, 'package.json'), 'utf8')),
}]));
let registry;
const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    requests.push(path);
    if (path.startsWith('/tarballs/')) {
        const entry = [...entries.values()].find(entry => basename(entry.tarball) === basename(path));
        if (entry) {
            const file = join(packageRoot, entry.tarball);
            response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': statSync(file).size });
            createReadStream(file).pipe(response); return;
        }
    }
    const entry = entries.get(path.slice(1));
    if (!entry) { response.writeHead(404); response.end('{}'); return; }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ name: entry.name, 'dist-tags': { latest: entry.version }, versions: {
        [entry.version]: { ...entry.manifest, dist: { tarball: `${registry}/tarballs/${basename(entry.tarball)}`, integrity: `sha512-${entry.sha512}` } },
    } }));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
registry = `http://127.0.0.1:${server.address().port}`;
async function command(executable, args, overrides = {}) {
    const child = spawn(executable, args, { cwd: consumer, env, stdio: 'inherit', ...overrides });
    const result = await new Promise((resolve, reject) => {
        child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    assert.equal(result.code, 0, `${basename(executable)} exited with ${result.code ?? result.signal}`);
}
const npmOptions = ['--prefix', prefix, '--registry', registry, '--include=optional', '--ignore-scripts', '--no-audit', '--no-fund'];
const evidence = { platform: process.platform, architecture: process.arch, version: index.version, source: index.source,
    root, registryRequests: requests, checks: [], success: false };
try {
    await command('npm', ['install', '--global', `runweft@${index.version}`, ...npmOptions]);
    const cli = join(prefix, 'bin', 'runweft');
    const require = createRequire(join(prefix, 'lib', 'node_modules', 'runweft', 'package.json'));
    const platformName = `runweft-${process.platform}-${process.arch}`;
    const platformDirectory = dirname(require.resolve(`${platformName}/package.json`));
    evidence.binaries = Object.fromEntries(['runweft', 'hapi'].map(name => [name, createHash('sha256').update(readFileSync(join(platformDirectory, 'bin', name))).digest('hex')]));
    evidence.installedBinaries = installedBinaries(cli);
    const packageEntry = index.packages.find(entry => entry.name === platformName);
    for (const name of ['runweft', 'hapi']) if (packageEntry.binaries) assert.equal(evidence.binaries[name], packageEntry.binaries[`bin/${name}`]);
    const guide = readFileSync(join(prefix, 'lib', 'node_modules', 'runweft', 'README.md'), 'utf8');
    assert(guide.includes('retry-finish')); assert(guide.includes('task workspace remove')); assert(guide.includes('worktree'));
    assert(guide.includes('upload_artifact')); assert(guide.includes('task artifacts release'));
    assert(guide.includes('workspace prepare')); assert(guide.includes('workspace release'));
    assert(guide.includes('task result fetch')); assert(guide.includes('task result release'));
    assert(guide.includes('hub connect')); assert(guide.includes('/hub'));
    assert(readFileSync(join(platformDirectory, 'skills/runweft/SKILL.md'), 'utf8').includes('hub connect begin/complete'));
    assert(requests.includes('/runweft'));
    assert(requests.some(path => path.endsWith(`${platformName}-${index.version}.tgz`)));
    for (const file of ['bin/runweft', 'bin/hapi', 'HAPI-LICENSE', 'HAPI-NOTICE', 'SOURCES.txt', 'hapi-source.tar.gz']) assert(existsSync(join(platformDirectory, file)), `Missing packaged ${file}`);
    const cleanEnv = { ...env, PATH: `${nodeOnly}:/usr/bin:/bin`, RUNWEFT_SMOKE_ROOT: join(root, 'services') };
    const version = spawnSync(cli, ['--version'], { env: cleanEnv, cwd: consumer, encoding: 'utf8' });
    assert.equal(version.status, 0, version.stderr); assert.equal(version.stdout.trim(), index.version);
    evidence.checks.push('npm registry metadata and platform optional dependency installation');
    const help = spawnSync(cli, ['task', '--help'], { env: cleanEnv, cwd: consumer, encoding: 'utf8' });
    assert.equal(help.status, 0, help.stderr);
    for (const command of ['spawn', 'list', 'show', 'wait', 'send', 'interrupt', 'permission', 'retry-finish', 'workspace', 'result']) assert(help.stdout.includes(command));
    const spawnHelp = spawnSync(cli, ['task', 'spawn', '--help'], { env: cleanEnv, cwd: consumer, encoding: 'utf8' });
    assert.equal(spawnHelp.status, 0, spawnHelp.stderr);
    assert(spawnHelp.stdout.includes('--workspace-mode')); assert(spawnHelp.stdout.includes('--base'));
    assert(spawnHelp.stdout.includes('--input')); assert(spawnHelp.stdout.includes('--output'));
    const openHelp = spawnSync(cli, ['open', '--help'], { env: cleanEnv, cwd: consumer, encoding: 'utf8' });
    assert.equal(openHelp.status, 0, openHelp.stderr); assert(openHelp.stdout.includes('--print'));
    const mcpHome = join(root, 'mcp-discovery');
    const transport = new StdioClientTransport({ command: cli, args: ['--home', mcpHome, 'mcp', 'serve', '--client', 'codex'],
        cwd: consumer, env: cleanEnv, stderr: 'pipe' });
    transport.stderr?.on('data', () => {});
    const client = new Client({ name: 'installed-runweft-probe', version: '1' });
    try {
        await client.connect(transport, { timeout: 5000 });
        assert.deepEqual((await client.listTools()).tools.map(tool => tool.name), ['runweft_status', 'list_agent_definitions', 'spawn_agent', 'list_agents', 'read_agent', 'wait', 'send_input', 'interrupt_agent', 'retry_finish', 'fetch_result', 'retry_result', 'retry_artifacts', 'collect_artifacts', 'respond_to_permission', 'upload_artifact', 'read_artifact', 'download_artifact']);
        assert(!existsSync(mcpHome), 'MCP discovery created runtime data');
    } finally { await client.close(); }
    evidence.checks.push('installed task commands and side-effect-free MCP catalog without Bun or source checkout on PATH');
    await command(process.execPath, [resolve('scripts/smoke-service.mjs'), cli], { env: cleanEnv });
    evidence.checks.push('installed CLI services and signals with no Bun or source checkout on PATH');
    if (process.env.RUNWEFT_SMOKE_NATIVE_INSTALL === '1') {
        evidence.nativeMcp = verifyMcpInstallation(cli, join(root, 'native-mcp'), env);
        evidence.checks.push('installed CLI native MCP install, idempotency, uninstall and explicit backup restoration');
    }
    const marker = join(root, 'services', 'retained-install.txt'); writeFileSync(marker, 'KEEP_INSTALLED_DATA');
    await command('npm', ['install', '--global', `runweft@${index.version}`, ...npmOptions]);
    assert.equal(readFileSync(marker, 'utf8'), 'KEEP_INSTALLED_DATA');
    assert.deepEqual(installedBinaries(cli), evidence.installedBinaries);
    evidence.checks.push('same-version npm reinstall preserves dedicated service data and exact paired binaries');
    const unavailable = `${platformDirectory}.unavailable`;
    renameSync(platformDirectory, unavailable);
    try {
        const missing = spawnSync(cli, ['--version'], { cwd: consumer, env: cleanEnv, encoding: 'utf8' });
        assert.equal(missing.status, 1); assert.match(missing.stderr, /缺少平台包/); assert.match(missing.stderr, /include=optional/);
    } finally { renameSync(unavailable, platformDirectory); }
    evidence.checks.push('missing platform dependency has an actionable diagnostic');
    await command('npm', ['uninstall', '--global', 'runweft', ...npmOptions]);
    assert(!existsSync(cli));
    assert(existsSync(join(root, 'services')));
    assert.equal(readFileSync(marker, 'utf8'), 'KEEP_INSTALLED_DATA');
    evidence.checks.push('npm uninstall removes executable and preserves service data');
    if (process.env.RUNWEFT_SMOKE_KEEP_INSTALL === '1') {
        await command('npm', ['install', '--global', `runweft@${index.version}`, ...npmOptions]);
        evidence.installedCli = cli;
        evidence.installedBinary = join(platformDirectory, 'bin', 'runweft');
        evidence.installedHapi = join(platformDirectory, 'bin', 'hapi');
        evidence.checks.push('dedicated installation retained for subsequent native acceptance');
    }
    evidence.success = true;
} finally {
    await new Promise(resolve => server.close(resolve));
    writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(`Installation evidence: ${join(root, 'evidence.json')}`);
}
