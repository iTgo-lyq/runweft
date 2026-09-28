import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import pkg from '../package.json';
import { selectedPlatforms, type Platform } from './platforms';

export async function command(args: string[], cwd = process.cwd()) {
    const child = Bun.spawn(args, { cwd, stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' });
    if (await child.exited !== 0) throw new Error(`Build command failed: ${args.join(' ')}`);
}

export function verifyHapiSource() {
    const head = Bun.spawnSync(['git', '-C', 'hapi', 'rev-parse', 'HEAD']);
    if (head.exitCode !== 0 || head.stdout.toString().trim() !== pkg.hapi.revision) throw new Error('HAPI submodule does not match package.json. Run git submodule update --init.');
    const status = Bun.spawnSync(['git', '-C', 'hapi', 'status', '--porcelain']);
    if (status.exitCode !== 0 || status.stdout.toString().trim()) throw new Error('HAPI source has uncommitted changes; release builds require the pinned clean revision.');
    const manifest = JSON.parse(readFileSync('hapi/cli/package.json', 'utf8'));
    if (manifest.version !== pkg.hapi.version) throw new Error('Pinned HAPI version does not match its manifest.');
}

export async function buildHapi(targets: readonly Platform[]) {
    verifyHapiSource();
    const root = resolve('hapi');
    await command(['bun', 'install', '--frozen-lockfile'], root);
    await command(['bun', 'run', 'download:tunwg'], root);
    await command(['bun', 'run', 'build:web'], root);
    await command(['bun', 'run', '--cwd', 'hub', 'generate:embedded-web-assets'], root);
    const binaries: Record<string, { path: string; sha256: string }> = {};
    for (const platform of targets) {
        await command(['bun', 'run', 'scripts/build-executable.ts', '--with-web-assets', '--target', platform.target], resolve(root, 'cli'));
        const path = resolve(root, 'cli', 'dist-exe', platform.target, 'hapi');
        binaries[platform.id] = { path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') };
    }
    mkdirSync('dist', { recursive: true });
    writeFileSync('dist/hapi-build.json', JSON.stringify({ revision: pkg.hapi.revision, version: pkg.hapi.version, binaries }, null, 2));
    return binaries;
}

if (import.meta.main) await buildHapi(selectedPlatforms());
