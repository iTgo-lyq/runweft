import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fixture } from './helpers';

test('delivery assembly preserves exact source Git identities and validates copied artifacts', () => {
    const root = fixture('release-assembly'), assembler = resolve('scripts/assemble-release.mjs');
    function command(args: string[], cwd = root) {
        const result = spawnSync(args[0], args.slice(1), { cwd, encoding: 'utf8' });
        expect(result.status).toBe(0);
        return result.stdout.trim();
    }
    const native = join(root, 'hapi'); mkdirSync(native);
    for (const cwd of [root, native]) {
        command(['git', 'init', '-q'], cwd);
        command(['git', 'config', 'user.name', 'smoke'], cwd);
        command(['git', 'config', 'user.email', 'smoke@example.invalid'], cwd);
        command(['git', 'config', 'commit.gpgsign', 'false'], cwd);
    }
    writeFileSync(join(native, 'source.txt'), 'native source');
    command(['git', 'add', '.'], native); command(['git', 'commit', '-qm', 'native'], native);
    const nativeRevision = command(['git', 'rev-parse', 'HEAD'], native);
    mkdirSync(join(root, 'docs')); writeFileSync(join(root, 'docs/usage.md'), 'Usage');
    writeFileSync(join(root, '.gitignore'), 'dist/\nacceptance.md\nevidence.json\n');
    writeFileSync(join(root, '.gitmodules'), '[submodule "hapi"]\n path = hapi\n url = https://example.invalid/hapi.git\n');
    command(['git', 'add', '.']); command(['git', 'commit', '-qm', 'candidate']);
    const revision = command(['git', 'rev-parse', 'HEAD']);
    const packages = join(root, 'dist/packages'), website = join(root, 'dist/website');
    mkdirSync(join(packages, 'tarballs'), { recursive: true }); mkdirSync(join(website, 'downloads'), { recursive: true });
    const digest = (body: string) => createHash('sha256').update(body).digest('hex');
    const archive = 'runweft-linux-x64-1.1.0.tgz', skill = 'runweft-skill-1.1.0.tgz';
    writeFileSync(join(packages, 'tarballs', archive), 'program');
    writeFileSync(join(packages, skill), 'skill');
    writeFileSync(join(website, 'downloads', archive), 'program');
    writeFileSync(join(website, 'downloads', skill), 'skill');
    const source = { revision, dirty: false };
    const index = { version: '1.1.0', source, hapi: { version: '0.30.7', revision: nativeRevision },
        packages: [{ name: 'runweft-linux-x64', tarball: `tarballs/${archive}` }], skill: { tarball: skill, sha256: digest('skill') } };
    const body = JSON.stringify(index); writeFileSync(join(packages, 'index.json'), body);
    writeFileSync(join(packages, 'SHA256SUMS'), `${digest('program')}  tarballs/${archive}\n${digest('skill')}  ${skill}\n${digest(body)}  index.json\n`);
    writeFileSync(join(website, 'release.json'), JSON.stringify({ version: '1.1.0', source, platforms: [{ id: 'linux-x64', filename: archive }], skill: { filename: skill } }));
    writeFileSync(join(root, 'acceptance.md'), 'Explicit synthetic assembly fixture, not product acceptance');
    writeFileSync(join(root, 'evidence.json'), JSON.stringify({ version: '1.1.0', sourceRevision: revision, success: true }));
    const args = ['node', assembler, packages, website, 'acceptance.md', 'evidence.json'];
    command(args);
    const delivery = join(root, 'dist/runweft-1.1.0-release');
    command(['sha256sum', '-c', 'SHA256SUMS'], delivery);
    expect(command(['git', 'bundle', 'list-heads', join(delivery, 'source/runweft.bundle')])).toBe(`${revision} HEAD`);
    const checkout = join(root, 'dist/rebuild');
    command(['git', 'clone', join(delivery, 'source/runweft.bundle'), checkout]);
    command(['git', '-c', 'protocol.file.allow=always', '-c', `submodule.hapi.url=${join(delivery, 'source/hapi.bundle')}`, 'submodule', 'update', '--init', 'hapi'], checkout);
    expect(command(['git', 'rev-parse', 'HEAD'], checkout)).toBe(revision);
    expect(command(['git', '-C', 'hapi', 'rev-parse', 'HEAD'], checkout)).toBe(nativeRevision);
    expect(readFileSync(join(checkout, 'hapi/source.txt'), 'utf8')).toBe('native source');
    expect(spawnSync(args[0], args.slice(1), { cwd: root }).status).not.toBe(0);
}, 30_000);
