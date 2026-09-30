import { chmodSync, copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import pkg from '../package.json';
import { buildHapi, readHapiBuild, command } from './build-hapi';
import { platforms, selectedPlatforms } from './platforms';

const selected = selectedPlatforms();
const binaries = process.argv.includes('--reuse-hapi') ? readHapiBuild(selected) : await buildHapi(selected);
const destination = resolve('dist/packages');
mkdirSync('dist', { recursive: true });
const output = mkdtempSync(resolve('dist/packages-build-'));
try {
    const tarballs = join(output, 'tarballs');
    mkdirSync(tarballs, { recursive: true });
    const source = resolve('dist', `hapi-source-${pkg.hapi.revision}.tar.gz`);
    await command(['git', '-C', 'hapi', 'archive', '--format=tar.gz', '--output', source, pkg.hapi.revision]);
    const sourceInfo = `HAPI ${pkg.hapi.version}\nRevision: ${pkg.hapi.revision}\nSource: https://github.com/iTgo-lyq/hapi/tree/${pkg.hapi.revision}\nOriginal source archive: hapi-source.tar.gz\nRebuild: follow scripts/build-hapi.ts in https://github.com/iTgo-lyq/runweft\nThe HAPI executable is built without source changes.\n`;
    const hash = (file: string, algorithm = 'sha256', encoding: 'hex' | 'base64' = 'hex') => createHash(algorithm).update(readFileSync(file)).digest(encoding);
    const packages: { name: string; version: string; path: string; tarball: string; sha512: string; binaries?: Record<string, string> }[] = [];
    async function pack(directory: string, binaryHashes?: Record<string, string>) {
        const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
        const child = Bun.spawn(['npm', 'pack', '--json', '--ignore-scripts', '--pack-destination', tarballs], { cwd: directory, stdout: 'pipe', stderr: 'inherit' });
        const result = await new Response(child.stdout).text();
        if (await child.exited !== 0) throw new Error(`npm pack failed for ${manifest.name}`);
        const tarball = join(tarballs, JSON.parse(result)[0].filename);
        packages.push({ name: manifest.name, version: manifest.version, path: relative(output, directory), tarball: relative(output, tarball),
            sha512: hash(tarball, 'sha512', 'base64'), ...(binaryHashes ? { binaries: binaryHashes } : {}) });
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
        copyFileSync('docs/usage.md', join(directory, 'README.md'));
        writeFileSync(join(directory, 'SOURCES.txt'), sourceInfo);
        writeFileSync(join(directory, 'package.json'), JSON.stringify({
            name, version: pkg.version, description: `Runweft and HAPI executables for ${platform.id}`,
            os: [platform.os], cpu: [platform.cpu], ...(platform.os === 'linux' ? { libc: ['glibc'] } : {}),
            files: ['bin', 'README.md', 'HAPI-LICENSE', 'HAPI-NOTICE', 'tool-licenses', 'TUNWG-LICENSE', 'SOURCES.txt', 'hapi-source.tar.gz'],
            engines: { node: '>=20' }, runweft: { hapi: pkg.hapi },
        }, null, 2));
        await pack(directory, Object.fromEntries(['runweft', 'hapi'].map(name => [`bin/${name}`, hash(join(directory, 'bin', name))])));
    }
    const main = join(output, 'runweft');
    mkdirSync(join(main, 'bin'), { recursive: true });
    copyFileSync('scripts/npm-launcher.cjs', join(main, 'bin', 'runweft.cjs'));
    chmodSync(join(main, 'bin', 'runweft.cjs'), 0o755);
    copyFileSync('docs/usage.md', join(main, 'README.md'));
    writeFileSync(join(main, 'package.json'), JSON.stringify({ name: 'runweft', version: pkg.version,
        description: 'One CLI for HAPI execution and Runweft collaboration', bin: { runweft: 'bin/runweft.cjs' },
        files: ['bin', 'README.md'], engines: { node: '>=20' },
        optionalDependencies: Object.fromEntries(platforms.map(platform => [`runweft-${platform.id}`, pkg.version])),
    }, null, 2));
    await pack(main);
    function git(args: string[]) {
        const result = Bun.spawnSync(['git', ...args]);
        if (result.exitCode !== 0) throw new Error(`Cannot record release source: git ${args.join(' ')}`);
        return result.stdout.toString().trim();
    }
    writeFileSync(join(output, 'index.json'), JSON.stringify({ version: pkg.version,
        source: { revision: git(['rev-parse', 'HEAD']), dirty: git(['status', '--porcelain']) !== '' },
        bunVersion: Bun.version, hapi: pkg.hapi, packages,
    }, null, 2) + '\n');
    writeFileSync(join(output, 'SHA256SUMS'), [...packages.map(entry => entry.tarball), 'index.json']
        .map(file => `${hash(join(output, file))}  ${file}\n`).join(''));
    // Replace only a fully built release; failed builds leave the previous packages available.
    const previous = `${output}.previous`;
    if (existsSync(destination)) renameSync(destination, previous);
    try { renameSync(output, destination); }
    catch (error) { if (existsSync(previous)) renameSync(previous, destination); throw error; }
    rmSync(previous, { recursive: true, force: true });
    console.log(`Release packages: ${join(destination, 'index.json')}`);
} finally { rmSync(output, { recursive: true, force: true }); }
