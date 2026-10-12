import assert from 'node:assert/strict';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';

// Uses verified candidate tarballs; only the fixture main package dependency points to a local file.
const packageRoot = resolve(process.argv[2] ?? 'dist/packages');
const index = JSON.parse(readFileSync(join(packageRoot, 'index.json'), 'utf8'));
const output = resolve(process.argv[3] ?? '.dev-smoke/complete-uninstall/npm-evidence.json');
mkdirSync(dirname(output), { recursive: true });
const root = mkdtempSync(resolve('.dev-smoke/uninstall-npm-'));
const prefix = join(root, 'prefix'), user = join(root, 'user'), home = join(user, '.runweft'), otherHome = join(root, 'other-home');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(RUNWEFT_|HAPI_|npm_config_)/i.test(key) && !['CLI_API_TOKEN', 'DB_PATH', 'TELEGRAM_BOT_TOKEN'].includes(key)));
Object.assign(env, { HOME: user, CODEX_HOME: join(user, '.codex'), CLAUDE_CONFIG_DIR: join(user, '.claude'),
    NPM_CONFIG_USERCONFIG: join(root, 'npmrc'), NPM_CONFIG_GLOBALCONFIG: join(root, 'npmrc-global'), NPM_CONFIG_CACHE: join(root, 'npm-cache'), NPM_CONFIG_UPDATE_NOTIFIER: 'false' });
for (const path of [user, env.CODEX_HOME, env.CLAUDE_CONFIG_DIR]) mkdirSync(path, { recursive: true });
const tools = join(root, 'tools'); mkdirSync(tools);
const npm = spawnSync('/usr/bin/which', ['npm'], { encoding: 'utf8' }).stdout.trim();
assert(npm, 'npm must be available');
symlinkSync(process.execPath, join(tools, 'node')); symlinkSync(realpathSync(npm), join(tools, 'npm'));
env.PATH = `${tools}:/usr/bin:/bin:/usr/sbin:/sbin`;
for (const name of ['ps', 'tar', 'git', 'npm', ...(process.platform === 'darwin' ? ['lsof'] : [])])
    assert.equal(spawnSync('/usr/bin/which', [name], { env, encoding: 'utf8' }).status, 0, `${name} must be available`);
writeFileSync(env.NPM_CONFIG_USERCONFIG, ''); writeFileSync(env.NPM_CONFIG_GLOBALCONFIG, '');
const cli = join(prefix, 'bin', 'runweft'), sourceCli = join(root, 'control', 'bin', 'runweft'), sourceHapi = join(root, 'control', 'bin', 'hapi');
const secrets = [], runnerStates = [], children = [];
const evidence = { platform: process.platform, architecture: process.arch, version: index.version, source: index.source,
    scope: 'verified candidate tarballs, dedicated npm prefix/HOME, real HAPI Hub and two Runners, control-session substitutes; no model clients',
    fixtureManifestChange: 'main optionalDependencies only; platform tarball unchanged', checks: [], success: false };
function check(name) { evidence.checks.push(name); console.log(`PASS ${name}`); }
function command(executable, args, overrides = {}) {
    const result = spawnSync(executable, args, { cwd: root, env, encoding: 'utf8', timeout: 65_000, ...overrides });
    for (const secret of secrets) assert(!(result.stdout + result.stderr).includes(secret), 'Credential was printed');
    assert.equal(result.status, 0, `${args[0]} failed: ${result.stderr || result.error}`);
    return result.stdout.trim();
}
function run(args, directory = home, overrides = {}) { return JSON.parse(command(cli, ['--home', directory, '--json', ...args], overrides)); }
function source(args, directory = otherHome) { return JSON.parse(command(sourceCli, ['--home', directory, '--json', ...args])); }
function fail(args, code, overrides = {}) {
    const result = spawnSync(cli, ['--home', home, '--json', ...args], { cwd: root, env, encoding: 'utf8', timeout: 65_000, ...overrides });
    assert.equal(result.status, 1); for (const secret of secrets) assert(!(result.stdout + result.stderr).includes(secret), 'Credential was printed');
    assert.equal(JSON.parse(result.stderr).error.code, code); return result;
}
async function uninstallAsync(expectedError, overrides = {}) {
    const child = spawn(cli, ['--home', home, '--json', 'uninstall', '--yes'], { cwd: root, env, ...overrides });
    let stdout = '', stderr = ''; child.stdout.on('data', value => { stdout += value; }); child.stderr.on('data', value => { stderr += value; });
    const status = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    for (const secret of secrets) assert(!(stdout + stderr).includes(secret), 'Credential was printed');
    if (expectedError) {
        assert.equal(status, 1); const error = JSON.parse(stderr).error;
        assert.equal(error.code, expectedError, JSON.stringify(error)); return error;
    }
    assert.equal(status, 0, stderr); return JSON.parse(stdout);
}
const put = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value), { mode: 0o600 }); };
async function request(url, body) {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
    assert(response.ok); return response.json();
}
async function freePort() {
    const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
function alive(pid) { const result = spawnSync('ps', ['-p', String(pid), '-o', 'stat='], { encoding: 'utf8' }); return result.status === 0 && result.stdout.trim() && !result.stdout.trim().startsWith('Z'); }
async function until(check) { const deadline = Date.now() + 20_000; while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error('Uninstall condition timed out'); }
function snapshot(path) {
    const result = {};
    function visit(path, name = '') {
        for (const file of readdirSync(path)) {
            const child = join(path, file), key = name + '/' + file, stat = lstatSync(child);
            if (stat.isDirectory()) visit(child, key);
            else if (stat.isFile()) result[key] = createHash('sha256').update(readFileSync(child)).digest('hex');
        }
    }
    if (existsSync(path)) visit(path); return result;
}
function connect(url, identity) {
    run(['config', 'set', 'hub.url', url]); const paths = run(['paths']);
    secrets.push(identity.token);
    put(paths.identityConnection, { schemaVersion: 1, hub: url, ownerId: identity.identity.id, spaceId: identity.personalSpace.id,
        token: identity.token, requestId: randomUUID(), createdAt: Date.now() });
    run(['machine', 'enroll']); run(['runner', 'start']);
    const file = join(paths.hapiClient, 'runner.state.json'), state = JSON.parse(readFileSync(file, 'utf8'));
    runnerStates.push({ ...state, file, nativeHome: paths.hapiClient }); return { paths, state, file };
}
try {
    const platformName = `runweft-${process.platform}-${process.arch}`, stage = join(root, 'stage'), nativeStage = join(stage, platformName), mainStage = join(stage, 'runweft');
    const platformEntry = index.packages.find(entry => entry.name === platformName), mainEntry = index.packages.find(entry => entry.name === 'runweft');
    assert(platformEntry && mainEntry, 'Candidate must contain the main and current platform package');
    for (const [entry, directory] of [[platformEntry, nativeStage], [mainEntry, mainStage]]) {
        const tarball = join(packageRoot, entry.tarball);
        assert.equal(createHash('sha512').update(readFileSync(tarball)).digest('base64'), entry.sha512, `${entry.name} tarball differs`);
        mkdirSync(directory, { recursive: true });
        command('tar', ['-xzf', tarball, '--strip-components=1', '-C', directory]);
    }
    cpSync(nativeStage, join(root, 'control'), { recursive: true });
    const mainManifest = JSON.parse(readFileSync(join(mainStage, 'package.json'), 'utf8'));
    assert.equal(mainManifest.version, index.version);
    mainManifest.optionalDependencies = { [platformName]: `file:${join(packageRoot, platformEntry.tarball)}` };
    put(join(mainStage, 'package.json'), mainManifest);
    const mainPacked = JSON.parse(command('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', stage], { cwd: mainStage }))[0].filename;
    command('npm', ['install', '--global', '--prefix', prefix, join(stage, mainPacked), '--ignore-scripts', '--no-audit', '--no-fund', '--offline']);
    const require = createRequire(join(prefix, 'lib', 'node_modules', 'runweft', 'package.json'));
    const nativeRoot = dirname(require.resolve(`${platformName}/package.json`));
    evidence.binaries = Object.fromEntries(['runweft', 'hapi'].map(name => {
        const hash = createHash('sha256').update(readFileSync(join(nativeRoot, 'bin', name))).digest('hex');
        assert.equal(hash, platformEntry.binaries[`bin/${name}`], `${name} binary differs`); return [name, hash];
    }));
    assert.equal(command(cli, ['--version']), index.version);
    check('real npm global installation resolves the verified candidate and its unchanged platform tarball');

    const keepFiles = [join(user, '.codex', 'auth.json'), join(user, '.codex', 'sessions', 'native.jsonl'), join(user, '.claude', '.credentials.json'),
        join(user, '.claude', 'projects', 'native.jsonl'), join(user, 'project', 'uncommitted.txt'), join(user, '.hapi', 'settings.json'),
        join(user, '.agents', 'skills', 'other', 'SKILL.md'), join(prefix, 'lib', 'node_modules', 'keep-tool', 'package.json'), join(prefix, 'bin', 'keep-tool')];
    for (const file of keepFiles) put(file, file === join(prefix, 'lib', 'node_modules', 'keep-tool', 'package.json') ? { name: 'keep-tool', version: '1.0.0' } : 'KEEP');
    const kept = keepFiles.map(file => readFileSync(file));
    const codexOriginal = '# preserve model comment\nmodel="keep-model"\n[mcp_servers.keep]\ncommand="keep-command" # keep-comment\n';
    put(join(env.CODEX_HOME, 'config.toml'), codexOriginal);
    const claudeOriginal = { other: 'keep-setting', mcpServers: { keep: { command: 'keep-command' } } };
    const settingsOriginal = { model: 'keep-model', hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'other-hook' }] }] } };
    put(join(env.CLAUDE_CONFIG_DIR, '.claude.json'), claudeOriginal); put(join(env.CLAUDE_CONFIG_DIR, 'settings.json'), settingsOriginal);
    run(['init']); run(['mcp', 'install', '--client', 'claude']);
    put(join(env.CODEX_HOME, 'config.toml'), codexOriginal + '\n[mcp_servers.runweft]\ncommand=' + JSON.stringify(join(nativeRoot, 'bin', 'runweft'))
        + '\nargs=' + JSON.stringify(['--home', home, 'mcp', 'serve', '--client', 'codex']) + '\n[mcp_servers.runweft.env]\nRUNWEFT_MCP_MANAGED="1"\n');
    for (const directory of [join(user, '.agents', 'skills', 'runweft'), join(user, '.codex', 'skills', 'runweft'), join(user, '.claude', 'skills', 'runweft')]) cpSync(join(nativeStage, 'skills/runweft'), directory, { recursive: true });
    const cold = snapshot(home), configs = snapshot(env.CODEX_HOME);
    assert.equal(run(['uninstall']).applied, false); assert.equal(run(['uninstall', '--yes', '--dry-run']).applied, false);
    assert.deepEqual(snapshot(home), cold); assert.deepEqual(snapshot(env.CODEX_HOME), configs);
    check('cold preview is byte-for-byte read-only, including existing MCP backups');

    const firstUrl = `http://127.0.0.1:${await freePort()}`; run(['config', 'set', 'server.port', String(new URL(firstUrl).port)]); run(['start']);
    const hosted = JSON.parse(readFileSync(join(home, 'server', 'process.json'), 'utf8'));
    const first = connect(firstUrl, await request(firstUrl + '/api/runweft/hub/identities', { name: 'uninstall fixture one' }));
    const recoveredChild = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { env: { ...env, HAPI_HOME: first.paths.hapiClient }, detached: true, stdio: 'ignore' }); children.push(recoveredChild);
    const marker = command('ps', ['-p', String(recoveredChild.pid), '-o', 'lstart='], { env: { ...env, LC_ALL: 'C', TZ: 'UTC' } });
    put(first.file + '.resume-processes.json', [{ requestedSessionId: randomUUID(), pid: recoveredChild.pid, processStartMarker: marker }]);
    run(['runner', 'stop']); assert(alive(recoveredChild.pid)); run(['runner', 'start']);
    const recoveredState = JSON.parse(readFileSync(first.file, 'utf8')); runnerStates.push({ ...recoveredState, file: first.file, nativeHome: first.paths.hapiClient });
    assert.equal((await request(`http://127.0.0.1:${recoveredState.httpPort}/list`, {})).children.length, 0);

    source(['init']); const secondUrl = `http://127.0.0.1:${await freePort()}`; source(['config', 'set', 'server.port', String(new URL(secondUrl).port)]); source(['start']);
    const otherHub = JSON.parse(readFileSync(join(otherHome, 'server', 'process.json'), 'utf8'));
    const second = connect(secondUrl, await request(secondUrl + '/api/runweft/hub/identities', { name: 'uninstall fixture two' }));
    const activeChild = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { env: { ...env, HAPI_HOME: second.paths.hapiClient }, detached: true, stdio: 'ignore' }); children.push(activeChild);
    await request(`http://127.0.0.1:${second.state.httpPort}/session-started`, { sessionId: randomUUID(), metadata: { hostPid: activeChild.pid, startedBy: 'fixture-terminal' } });
    assert.equal((await request(`http://127.0.0.1:${second.state.httpPort}/list`, {})).children.length, 1);
    const firstBytes = readFileSync(first.file); put(first.file, { ...recoveredState, httpPort: second.state.httpPort });
    fail(['uninstall', '--yes'], 'uninstall_process_unknown'); writeFileSync(first.file, firstBytes);
    assert(alive(hosted.pid) && alive(recoveredState.pid) && alive(second.state.pid) && alive(otherHub.pid));
    check('a tampered control port is refused before stopping either Runner');

    chmodSync(join(prefix, 'bin'), 0o500);
    try { fail(['uninstall', '--yes'], 'uninstall_permission_denied'); } finally { chmodSync(join(prefix, 'bin'), 0o755); }
    assert(alive(hosted.pid) && alive(recoveredState.pid) && alive(second.state.pid));
    const activePreview = run(['uninstall']); assert.equal(activePreview.applied, false);
    assert.equal(activePreview.processes.filter(item => item.kind === 'runner').length, 2);
    assert(alive(hosted.pid) && alive(recoveredChild.pid) && alive(activeChild.pid));
    check('read-only prefix and active preview leave the Hub, both connections and detached sessions alive');

    const fakeTools = join(root, 'fake-tools'); mkdirSync(fakeTools); put(join(fakeTools, 'npm'), '#!/bin/sh\nexit 7\n'); chmodSync(join(fakeTools, 'npm'), 0o755);
    await uninstallAsync('uninstall_program_failed', { env: { ...env, PATH: `${fakeTools}:${env.PATH}` } });
    await until(() => !alive(hosted.pid) && !alive(recoveredState.pid) && !alive(second.state.pid) && !alive(recoveredChild.pid) && !alive(activeChild.pid));
    assert(existsSync(home) && existsSync(cli)); assert(alive(otherHub.pid));
    check('real control APIs stop current and recovered session substitutes, both Runners and Hub; npm failure retains data and program');
    const result = await uninstallAsync(undefined, { env: { ...env, npm_config_dry_run: 'true', NPM_CONFIG_DRY_RUN: 'true' } });
    assert.equal(result.applied, true); assert(!existsSync(home) && !existsSync(cli) && !existsSync(nativeRoot) && !existsSync(join(prefix, 'lib/node_modules/runweft')));
    for (const directory of [join(user, '.agents/skills/runweft'), join(user, '.codex/skills/runweft'), join(user, '.claude/skills/runweft')]) assert(!existsSync(directory));
    for (const [index, file] of keepFiles.entries()) assert.deepEqual(readFileSync(file), kept[index]);
    assert.equal(readFileSync(join(env.CODEX_HOME, 'config.toml'), 'utf8').trim(), codexOriginal.trim());
    assert.deepEqual(JSON.parse(readFileSync(join(env.CLAUDE_CONFIG_DIR, '.claude.json'), 'utf8')), claudeOriginal);
    assert.deepEqual(JSON.parse(readFileSync(join(env.CLAUDE_CONFIG_DIR, 'settings.json'), 'utf8')), settingsOriginal);
    assert(alive(otherHub.pid)); assert(existsSync(otherHome));
    check('retry self-uninstalls npm candidate despite dry-run env, deletes data and all backups/Skills, and preserves native config, credentials, projects and other software');

    command('npm', ['install', '--global', '--prefix', prefix, join(stage, mainPacked), '--ignore-scripts', '--no-audit', '--no-fund', '--offline']);
    assert.equal(run(['uninstall', '--yes']).applied, true); assert(!existsSync(home) && !existsSync(cli));
    check('reinstalled candidate can repeat uninstall with its prior data and integrations already absent');
    const standaloneHome = join(root, 'standalone-data'), standaloneTools = join(root, 'standalone-tools'), standalone = join(nativeStage, 'bin', 'runweft');
    mkdirSync(standaloneTools); symlinkSync(standalone, join(standaloneTools, 'runweft'));
    const standaloneEnv = { ...env, PATH: `${standaloneTools}:${env.PATH}` };
    command(standalone, ['--home', standaloneHome, 'init'], { env: standaloneEnv });
    const independent = JSON.parse(command(standalone, ['--home', standaloneHome, '--json', 'uninstall', '--yes'], { env: standaloneEnv }));
    assert(independent.applied); assert(!existsSync(nativeStage) && !existsSync(standaloneHome) && !existsSync(join(standaloneTools, 'runweft')));
    check('real complete platform package self-uninstalls its generated-config-only home and matching PATH symlink');
    evidence.success = true;
} catch (error) { evidence.error = error.message; throw error; }
finally {
    const cleanupErrors = [];
    for (const state of runnerStates) if (alive(state.pid) && existsSync(state.file)) {
        const result = spawnSync(sourceHapi, ['runner', 'stop'], { env: { ...env, HAPI_HOME: state.nativeHome }, encoding: 'utf8', timeout: 20_000 });
        if (result.status !== 0 || alive(state.pid)) cleanupErrors.push('fixture Runner did not stop');
    }
    for (const directory of [home, otherHome]) if (existsSync(join(directory, 'config.yaml'))) {
        const result = spawnSync(sourceCli, ['--home', directory, '--json', 'stop'], { env, encoding: 'utf8', timeout: 35_000 });
        if (result.status !== 0) cleanupErrors.push('fixture Hub stop failed');
    }
    for (const child of children) if (alive(child.pid)) { child.kill('SIGTERM'); await until(() => !alive(child.pid)); }
    if (cleanupErrors.length) { evidence.success = false; evidence.cleanupErrors = cleanupErrors; process.exitCode = 1; }
    else rmSync(root, { recursive: true, force: true });
    writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n'); console.log(`Evidence: ${output}`);
}
