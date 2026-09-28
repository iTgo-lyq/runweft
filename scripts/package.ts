import { chmodSync, copyFileSync, cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import pkg from '../package.json';
import { buildHapi, verifyHapiSource, command } from './build-hapi';
import { platforms, selectedPlatforms } from './platforms';

const selected = selectedPlatforms();
const binaries = process.argv.includes('--reuse-hapi') ? (() => {
    verifyHapiSource();
    const build = JSON.parse(readFileSync('dist/hapi-build.json', 'utf8'));
    if (build.revision !== pkg.hapi.revision) throw new Error('Cached HAPI build revision is different.');
    for (const platform of selected) {
        const binary = build.binaries[platform.id];
        if (!binary || createHash('sha256').update(readFileSync(binary.path)).digest('hex') !== binary.sha256) throw new Error(`Missing or modified HAPI build: ${platform.id}`);
    }
    return build.binaries as Record<string, { path: string; sha256: string }>;
})() : await buildHapi(selected);
const output = resolve('dist/packages');
const tarballs = join(output, 'tarballs');
mkdirSync(tarballs, { recursive: true });
const source = resolve('dist', `hapi-source-${pkg.hapi.revision}.tar.gz`);
await command(['git', '-C', 'hapi', 'archive', '--format=tar.gz', '--output', source, pkg.hapi.revision]);
const sourceInfo = `HAPI ${pkg.hapi.version}\nRevision: ${pkg.hapi.revision}\nSource: https://github.com/iTgo-lyq/hapi/tree/${pkg.hapi.revision}\nOriginal source archive: hapi-source.tar.gz\nRebuild: follow scripts/build-hapi.ts in https://github.com/iTgo-lyq/runweft\nThe HAPI executable is built without source changes.\n`;
const packages: { name: string; version: string; path: string; tarball: string; sha512: string }[] = [];
async function pack(directory: string) {
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
    const child = Bun.spawn(['npm', 'pack', '--json', '--ignore-scripts', '--pack-destination', tarballs], { cwd: directory, stdout: 'pipe', stderr: 'inherit' });
    const result = await new Response(child.stdout).text();
    if (await child.exited !== 0) throw new Error(`npm pack failed for ${manifest.name}`);
    const tarball = join(tarballs, JSON.parse(result)[0].filename);
    packages.push({ name: manifest.name, version: manifest.version, path: relative(output, directory), tarball: relative(output, tarball),
        sha512: createHash('sha512').update(readFileSync(tarball)).digest('base64') });
}

for (const platform of selected) {
    const name = `runweft-${platform.id}`;
    const directory = join(output, name);
    mkdirSync(join(directory, 'bin'), { recursive: true });
    const result = await Bun.build({ entrypoints: ['src/cli.ts'], compile: {
        target: platform.target, outfile: join(directory, 'bin', 'runweft'), autoloadDotenv: false,
    } });
    if (!result.success) throw new Error(`Runweft build failed for ${platform.id}: ${result.logs.join('\n')}`);
    copyFileSync(binaries[platform.id].path, join(directory, 'bin', 'hapi'));
    for (const binary of ['runweft', 'hapi']) chmodSync(join(directory, 'bin', binary), 0o755);
    copyFileSync('hapi/LICENSE', join(directory, 'HAPI-LICENSE'));
    copyFileSync('hapi/cli/NOTICE', join(directory, 'HAPI-NOTICE'));
    cpSync('hapi/cli/tools/licenses', join(directory, 'tool-licenses'), { recursive: true });
    copyFileSync('hapi/shared/tools/tunwg/LICENSE', join(directory, 'TUNWG-LICENSE'));
    copyFileSync(source, join(directory, 'hapi-source.tar.gz'));
    writeFileSync(join(directory, 'SOURCES.txt'), sourceInfo);
    writeFileSync(join(directory, 'package.json'), JSON.stringify({
        name, version: pkg.version, private: true, description: `Runweft candidate binaries for ${platform.id}`,
        os: [platform.os], cpu: [platform.cpu], ...(platform.os === 'linux' ? { libc: ['glibc'] } : {}),
        files: ['bin', 'HAPI-LICENSE', 'HAPI-NOTICE', 'tool-licenses', 'TUNWG-LICENSE', 'SOURCES.txt', 'hapi-source.tar.gz'],
        engines: { node: '>=20' }, runweft: { hapi: pkg.hapi },
    }, null, 2));
    await pack(directory);
}
const main = join(output, 'runweft');
mkdirSync(join(main, 'bin'), { recursive: true });
copyFileSync('scripts/npm-launcher.cjs', join(main, 'bin', 'runweft.cjs'));
chmodSync(join(main, 'bin', 'runweft.cjs'), 0o755);
writeFileSync(join(main, 'README.md'), '# Runweft candidate package\n\nInstall through the supplied package registry, then run `runweft start` and `runweft open`.\n\nThis candidate is not a public release. HAPI license, notices and matching source are included in each platform package.\n');
writeFileSync(join(main, 'package.json'), JSON.stringify({ name: 'runweft', version: pkg.version, private: true,
    description: 'One CLI for HAPI execution and Runweft collaboration', bin: { runweft: 'bin/runweft.cjs' },
    files: ['bin', 'README.md'], engines: { node: '>=20' },
    optionalDependencies: Object.fromEntries(platforms.map(platform => [`runweft-${platform.id}`, pkg.version])),
}, null, 2));
await pack(main);
writeFileSync(join(output, 'index.json'), JSON.stringify({ version: pkg.version, packages }, null, 2));
console.log(`Candidate packages: ${join(output, 'index.json')}`);
