import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

export const packageInputs = [
    'src', 'skills', 'docs/usage.md', 'package.json', 'bun.lock', 'hapi',
    'scripts/package.ts', 'scripts/build.ts', 'scripts/build-hapi.ts', 'scripts/hapi-source.ts', 'scripts/platforms.ts', 'scripts/npm-launcher.cjs',
];

export function assertFrozenCandidate(index, cwd = process.cwd()) {
    assert.match(index.source.revision, /^[a-f0-9]{40}$/);
    assert.equal(index.source.dirty, false, 'Final candidate must come from a clean source commit');
    const diff = spawnSync('git', ['diff', '--exit-code', index.source.revision, '--', ...packageInputs], { cwd, encoding: 'utf8' });
    assert.equal(diff.status, 0, 'Package inputs changed since candidate build; rebuild and revalidate');
    const untracked = spawnSync('git', ['ls-files', '--others', '--exclude-standard', '--', ...packageInputs], { cwd, encoding: 'utf8' });
    assert.equal(untracked.status, 0, 'Cannot inspect untracked package inputs');
    assert.equal(untracked.stdout.trim(), '', 'Untracked package inputs require a new clean candidate');
}
