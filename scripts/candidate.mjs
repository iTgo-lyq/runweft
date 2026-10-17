import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createReadStream, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { installedBinaries } from './installed-binaries.mjs';

export function readCandidate(directory) {
    directory = resolve(directory);
    const index = JSON.parse(readFileSync(join(directory, 'index.json'), 'utf8'));
    assert.equal(index.product, 'hub-console-v1');
    assert.match(index.source.revision, /^[a-f0-9]{40}$/);
    assert.equal(index.source.dirty, false, 'Candidate must come from a clean source commit');
    const platform = `runweft-${process.platform}-${process.arch}`;
    const entries = ['runweft', platform].map(name => {
        const entry = index.packages.find(item => item.name === name);
        assert(entry, `Candidate lacks ${name}`);
        assert.equal(entry.version, index.version);
        const archive = resolve(directory, entry.tarball);
        assert(archive.startsWith(directory + sep), 'Candidate archive leaves its directory');
        assert.equal(createHash('sha512').update(readFileSync(archive)).digest('base64'), entry.sha512, `${name} archive changed`);
        return { ...entry, archive };
    });
    return { directory, index, platform, entries };
}

/** Install verified, unchanged tarballs into the caller's private root. No service or model starts. */
export async function installCandidate(directory, root, layout = 'npm') {
    assert(['npm', 'standalone'].includes(layout), 'Select npm or standalone');
    const candidate = readCandidate(directory), { index, entries, platform } = candidate;
    root = resolve(root);
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
        !/^(RUNWEFT_|HAPI_|npm_config_)/i.test(key) && !['NPM_TOKEN', 'NODE_AUTH_TOKEN', 'CLI_API_TOKEN', 'DB_PATH', 'TELEGRAM_BOT_TOKEN'].includes(key)));
    Object.assign(env, { HOME: join(root, 'user'), CODEX_HOME: join(root, 'user/.codex'), CLAUDE_CONFIG_DIR: join(root, 'user/.claude'),
        NPM_CONFIG_USERCONFIG: join(root, 'npmrc'), NPM_CONFIG_GLOBALCONFIG: join(root, 'npmrc-global'),
        NPM_CONFIG_CACHE: join(root, 'npm-cache'), NPM_CONFIG_UPDATE_NOTIFIER: 'false' });
    for (const directory of [root, env.HOME, env.CODEX_HOME, env.CLAUDE_CONFIG_DIR]) mkdirSync(directory, { recursive: true, mode: 0o700 });
    writeFileSync(env.NPM_CONFIG_USERCONFIG, ''); writeFileSync(env.NPM_CONFIG_GLOBALCONFIG, '');
    let cli;
    if (layout === 'standalone') {
        const destination = join(root, platform); mkdirSync(destination);
        const extracted = spawnSync('tar', ['-xzf', entries[1].archive, '--strip-components=1', '-C', destination], { env, encoding: 'utf8' });
        assert.equal(extracted.status, 0, extracted.stderr);
        mkdirSync(join(root, 'bin')); cli = join(root, 'bin/runweft'); symlinkSync(join(destination, 'bin/runweft'), cli);
    } else {
        // The local registry serves the original archives, including the real optional dependency layout.
        const manifests = new Map(entries.map(entry => {
            const result = spawnSync('tar', ['-xOf', entry.archive, 'package/package.json'], { encoding: 'utf8' });
            assert.equal(result.status, 0, result.stderr);
            const manifest = JSON.parse(result.stdout);
            assert.equal(manifest.name, entry.name); assert.equal(manifest.version, index.version);
            return [entry.name, manifest];
        }));
        let registry;
        const server = createServer((request, response) => {
            const path = new URL(request.url, 'http://localhost').pathname;
            const entry = entries.find(entry => path === '/' + entry.name || path === '/tarballs/' + basename(entry.archive));
            if (!entry) { response.writeHead(404); response.end('{}'); return; }
            if (path.startsWith('/tarballs/')) {
                response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': statSync(entry.archive).size });
                createReadStream(entry.archive).pipe(response); return;
            }
            response.setHeader('content-type', 'application/json');
            response.end(JSON.stringify({ name: entry.name, 'dist-tags': { latest: index.version }, versions: {
                [index.version]: { ...manifests.get(entry.name), dist: { tarball: registry + '/tarballs/' + basename(entry.archive), integrity: 'sha512-' + entry.sha512 } },
            } }));
        });
        try {
            await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
            registry = `http://127.0.0.1:${server.address().port}`;
            const prefix = join(root, 'prefix');
            const child = spawn('npm', ['install', '--global', '--prefix', prefix, '--registry', registry, '--include=optional',
                '--ignore-scripts', '--no-audit', '--no-fund', `runweft@${index.version}`], { cwd: root, env, stdio: ['ignore', 'ignore', 'pipe'] });
            let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
            const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
            assert.equal(code, 0, stderr);
            cli = join(prefix, 'bin/runweft');
        } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    }
    const binaries = installedBinaries(cli);
    const manifest = JSON.parse(readFileSync(join(dirname(binaries.runweft.path), '../package.json'), 'utf8'));
    assert.equal(manifest.name, platform); assert.equal(manifest.version, index.version);
    assert.deepEqual(manifest.os, [process.platform]); assert.deepEqual(manifest.cpu, [process.arch]);
    assert.deepEqual(manifest.runweft.hapi, index.hapi);
    for (const name of ['runweft', 'hapi']) assert.equal(binaries[name].sha256, entries[1].binaries[`bin/${name}`], `Installed ${name} changed`);
    return { ...candidate, cli, binaries, env, root };
}
