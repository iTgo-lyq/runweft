import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { integrationGroups } from '../ci-scope.mjs';

test('ordinary changes select affected integration; unknown product and build paths cannot skip it', () => {
    assert.deepEqual(integrationGroups(['test/tasks.test.ts', 'docs/release.md', 'scripts/tests/npm-publish.test.mjs']), []);
    assert.deepEqual(integrationGroups(['src/hub/native-page.ts']), ['web']);
    assert.deepEqual(integrationGroups(['packages/prototype/src/app.js', '.githooks/pre-commit', 'scripts/check-workflow.mjs', 'scripts/check-docs.mjs']), []);
    assert.deepEqual(integrationGroups(['packages/prototype/src/app.js', 'src/hub/tasks-page.ts']), ['web']);
    assert.deepEqual(integrationGroups(['src/hub/access/api.ts', 'src/tasks/store.ts']), ['access', 'storage', 'web', 'service']);
    for (const file of ['package.json', 'hapi', 'src/new-module.ts', 'scripts/new-check.mjs', 'src/hub/delegation/service.ts', 'src/hub/resources/api.ts', 'src/hub/repositories/commands.ts']) {
        assert.deepEqual(integrationGroups([file]), ['access', 'storage', 'web', 'service']);
    }
});

test('scope command reads a real Git diff and refuses an unavailable base instead of reporting no checks', () => {
    mkdirSync('.dev-smoke', { recursive: true });
    const root = mkdtempSync(resolve('.dev-smoke/ci-scope-')), output = join(root, 'output');
    const git = (...args) => {
        const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
    };
    try {
        git('init', '-q'); git('config', 'user.name', 'CI fixture'); git('config', 'user.email', 'ci@example.invalid'); git('config', 'commit.gpgsign', 'false');
        writeFileSync(join(root, 'README.md'), 'fixture'); git('add', '.'); git('commit', '-qm', 'base'); const base = git('rev-parse', 'HEAD');
        writeFileSync(join(root, 'package.json'), '{}'); git('add', '.'); git('commit', '-qm', 'package'); const head = git('rev-parse', 'HEAD');
        const run = value => spawnSync(process.execPath, [resolve('scripts/ci-scope.mjs')], { cwd: root,
            env: { ...process.env, CI_BASE: value, CI_HEAD: head, GITHUB_OUTPUT: output }, encoding: 'utf8' });
        assert.equal(run(base).status, 0);
        assert.equal(readFileSync(output, 'utf8').trim(), 'groups=["access","storage","web","service"]');
        assert.notEqual(run('f'.repeat(40)).status, 0);
    } finally { rmSync(root, { recursive: true, force: true }); }
});
