import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const source = resolve(process.argv[2] ?? 'dist/packages');
const index = JSON.parse(readFileSync(join(source, 'index.json'), 'utf8'));
mkdirSync('.dev-smoke', { recursive: true });
const root = mkdtempSync(resolve('.dev-smoke/release-packages-'));
const evidence = { root, version: index.version, source: index.source, hapi: index.hapi, platforms: [], success: false };
const hash = (file, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(readFileSync(file)).digest(encoding);
function command(bin, args, options = {}) {
    const result = spawnSync(bin, args, { encoding: 'utf8', timeout: 120_000, ...options });
    assert.equal(result.status, 0, `${bin}: ${result.stderr || result.error}`);
    return result.stdout;
}
try {
    assert.match(index.source.revision, /^[a-f0-9]{40}$/);
    assert.equal(typeof index.source.dirty, 'boolean');
    assert.deepEqual(index.packages.map(item => item.name).sort(), ['runweft', 'runweft-darwin-arm64', 'runweft-darwin-x64', 'runweft-linux-arm64', 'runweft-linux-x64']);
    assert.deepEqual(readdirSync(join(source, 'tarballs')).sort(), index.packages.map(item => item.tarball.split('/').at(-1)).sort());
    const checksums = readFileSync(join(source, 'SHA256SUMS'), 'utf8').trim().split('\n');
    assert.equal(checksums.length, index.packages.length + 1);
    for (const line of checksums) {
        const [expected, file] = line.split('  ');
        assert.equal(hash(join(source, file)), expected);
    }
    for (const entry of index.packages) {
        assert.equal(entry.version, index.version);
        assert.equal(hash(join(source, entry.tarball), 'sha512', 'base64'), entry.sha512);
        const directory = join(root, entry.name); mkdirSync(directory);
        command('tar', ['-xzf', join(source, entry.tarball), '-C', directory, '--strip-components=1']);
        const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
        assert.equal(manifest.version, index.version); assert.equal(manifest.name, entry.name);
        assert.notEqual(manifest.private, true);
        assert(readFileSync(join(directory, 'README.md'), 'utf8').includes('task result fetch'));
        if (entry.name === 'runweft') {
            assert(Object.values(manifest.optionalDependencies).every(value => value === index.version));
            continue;
        }
        const [, os, arch] = entry.name.split('-');
        assert.deepEqual(manifest.os, [os]); assert.deepEqual(manifest.cpu, [arch]);
        assert.deepEqual(manifest.runweft.hapi, index.hapi);
        const binaries = {};
        for (const name of ['runweft', 'hapi']) {
            const file = join(directory, 'bin', name), bytes = readFileSync(file);
            assert(statSync(file).mode & 0o111);
            assert.equal(hash(file), entry.binaries[`bin/${name}`]);
            if (os === 'darwin') {
                assert.equal(bytes.readUInt32LE(0), 0xfeedfacf);
                assert.equal(bytes.readUInt32LE(4), arch === 'arm64' ? 0x100000c : 0x1000007);
            } else {
                assert.equal(bytes.subarray(0, 4).toString('hex'), '7f454c46');
                assert.equal(bytes[4], 2); assert.equal(bytes[5], 1);
                assert.equal(bytes.readUInt16LE(18), arch === 'arm64' ? 183 : 62);
            }
            binaries[name] = { sha256: hash(file), format: command('file', ['-b', file]).trim() };
        }
        for (const file of ['HAPI-LICENSE', 'HAPI-NOTICE', 'TUNWG-LICENSE', 'tool-licenses']) assert(existsSync(join(directory, file)));
        assert(readFileSync(join(directory, 'SOURCES.txt'), 'utf8').includes(index.hapi.revision));
        assert.equal(JSON.parse(command('tar', ['-xOf', join(directory, 'hapi-source.tar.gz'), 'cli/package.json'])).version, index.hapi.version);
        evidence.platforms.push({ platform: `${os}-${arch}`, directory, binaries, nativeExecuted: false });
        if (os === process.platform && arch === process.arch) {
            mkdirSync(join(root, 'entrypoint'));
            const link = join(root, 'entrypoint', 'runweft'); symlinkSync(join(directory, 'bin/runweft'), link);
            const env = { ...process.env, PATH: '/usr/bin:/bin' };
            for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_')) delete env[key];
            assert.equal(command(link, ['--version'], { cwd: root, env }).trim(), index.version);
            assert(command(link, ['hapi', '--version'], { cwd: root, env }).includes(index.hapi.version));
            const log = command(process.execPath, [resolve('scripts/smoke-service.mjs'), link], { cwd: root, env: { ...env, RUNWEFT_SMOKE_ROOT: join(root, 'standalone-services') } });
            writeFileSync(join(root, 'standalone-services.log'), log);
            evidence.platforms.at(-1).nativeExecuted = true;
        }
    }
    evidence.success = true;
} finally {
    writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(`Package evidence: ${join(root, 'evidence.json')}`);
}
