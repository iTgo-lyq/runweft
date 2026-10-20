import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { assertFrozenCandidate } from '../release-inputs.mjs';

test('frozen candidates reject changed or new UI inputs but allow unrelated documentation', () => {
    const root = mkdtempSync(join(tmpdir(), 'release-inputs-'));
    const git = (...args) => {
        const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
        return result.stdout.trim();
    };
    const put = (path, content) => {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), content);
    };
    const inputs = ['packages/ui/build.ts', 'packages/ui/src/components/button.tsx',
        'packages/ui/src/styles/components.css', 'tsconfig.json', '.gitignore'];
    try {
        git('init', '-q');
        git('config', 'user.name', 'Fixture');
        git('config', 'user.email', 'fixture@example.invalid');
        git('config', 'commit.gpgsign', 'false');
        git('config', 'core.hooksPath', '/dev/null');
        for (const path of inputs) put(path, 'original\n');
        git('add', '.');
        git('commit', '-qm', 'Freeze UI inputs');
        const index = { source: { revision: git('rev-parse', 'HEAD'), dirty: false } };
        assert.doesNotThrow(() => assertFrozenCandidate(index, root));
        for (const path of inputs) {
            put(path, 'modified\n');
            assert.throws(() => assertFrozenCandidate(index, root), /Package inputs changed/);
            git('add', path);
            assert.throws(() => assertFrozenCandidate(index, root), /Package inputs changed/);
            git('commit', '-qm', 'Change UI input');
            assert.throws(() => assertFrozenCandidate(index, root), /Package inputs changed/);
            git('restore', '--source', index.source.revision, '--staged', '--worktree', path);
            git('commit', '-qm', 'Restore UI input');
        }
        const added = 'packages/ui/src/components/new-control.tsx';
        put(added, 'new component\n');
        assert.throws(() => assertFrozenCandidate(index, root), /Untracked package inputs/);
        rmSync(join(root, added));
        put('packages/prototype/README.md', 'Prototype instructions\n');
        assert.doesNotThrow(() => assertFrozenCandidate(index, root));
        git('add', '.');
        git('commit', '-qm', 'Document prototype');
        assert.doesNotThrow(() => assertFrozenCandidate(index, root));
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
