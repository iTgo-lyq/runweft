import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export function verifyHapiSourceArchive(archive, platform, revision, destination) {
    function command(bin, args) {
        const result = spawnSync(bin, args, { encoding: 'utf8', timeout: 120_000 });
        assert.equal(result.status, 0, result.stderr || result.error?.message);
        return result.stdout;
    }
    const tree = command('git', ['-C', 'hapi', 'ls-tree', '-r', '-z', revision]).split('\0').filter(Boolean).map(line => {
        const [metadata, path] = line.split('\t');
        const [mode, type, hash] = metadata.split(' ');
        return { path, mode, type, hash };
    }).filter(entry => entry.type === 'blob');
    const suffix = `-${platform.cpu}-${platform.os}.tar.gz`;
    const expected = tree.filter(entry => !entry.path.startsWith('cli/tools/archives/') ||
        !entry.path.endsWith('.tar.gz') || entry.path.endsWith(suffix));
    for (const tool of ['difftastic', 'ripgrep']) assert(expected.some(entry => entry.path === `cli/tools/archives/${tool}${suffix}`));
    const actual = command('tar', ['-tzf', archive]).trim().split('\n').filter(path => !path.endsWith('/'));
    assert.deepEqual(actual.sort(), expected.map(entry => entry.path).sort(), 'HAPI archive must preserve every source and license file');
    mkdirSync(destination, { recursive: true });
    command('tar', ['-xzf', archive, '-C', destination]);
    for (const entry of expected) {
        const file = join(destination, entry.path);
        const bytes = entry.mode === '120000' ? Buffer.from(readlinkSync(file)) : readFileSync(file);
        const object = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
        assert.equal(object, entry.hash, `Source differs from pinned HAPI: ${entry.path}`);
    }
    return { files: expected.length, platform: platform.id, sourceBlobsMatch: true };
}
