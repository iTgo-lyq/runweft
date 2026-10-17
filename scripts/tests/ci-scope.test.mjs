import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { changedFiles, selectChecks, verifyJobs } from '../ci-scope.mjs';

test('scope separates docs and subprojects, selects changed tests, and fails closed for shared changes', () => {
    assert.equal(selectChecks(['docs/release.md', 'AGENTS.md']).checks, false);
    for (const [path, check] of [['website/build.mjs', 'website'], ['packages/prototype/verify.mjs', 'prototype'], ['.agents/skills/runweft-kit/SKILL.md', 'kit']]) {
        const scope = selectChecks([path]); assert.equal(scope[check], true); assert.equal(scope.core, false); assert.deepEqual(scope.groups, []);
    }
    assert.equal(selectChecks(['test/tasks.test.ts', 'test/compiled-cli.ts']).core, true);
    assert.equal(selectChecks(['scripts/tests/npm-publish.test.mjs']).tools, true);
    assert.deepEqual(selectChecks(['src/hub/native-page.ts']).groups, ['web']);
    for (const file of ['hapi', 'bun.lock', 'src/unknown.ts', '.github/workflows/checks.yml', 'scripts/ci-scope.mjs']) {
        const scope = selectChecks([file]); assert.equal(scope.install, true); assert.equal(scope.prototype, true);
        assert.deepEqual(scope.groups, ['access', 'storage', 'web', 'service']); assert(scope.native.includes('R-codex'));
    }
});

test('real Git comparison handles first push, merge base, moves, deletions and uncommitted consumers', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'runweft-scope-'));
    const git = (...args) => { const r = spawnSync('git', args, { cwd, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
    const write = (name, body) => writeFileSync(join(cwd, name), body);
    try {
        git('init', '-qb', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'commit.gpgsign', 'false');
        write('README.md', 'base'); git('add', '.'); git('commit', '-qm', 'base'); const base = git('rev-parse', 'HEAD');
        git('checkout', '-qb', 'feature'); write('README.md', 'docs'); git('commit', '-qam', 'docs');
        const first = changedFiles({ cwd, base: '0'.repeat(40), defaultBranch: 'main' });
        assert.equal(first.base, base); assert.equal(selectChecks(first.files).checks, false);
        git('checkout', 'main'); write('package.json', '{}'); git('add', '.'); git('commit', '-qm', 'other'); git('checkout', 'feature');
        assert.deepEqual(changedFiles({ cwd, base: 'main', mergeBase: true }).files, ['README.md']);
        mkdirSync(join(cwd, 'test')); renameSync(join(cwd, 'README.md'), join(cwd, 'test/helper.ts')); git('add', '.'); git('commit', '-qm', 'move');
        assert.deepEqual(changedFiles({ cwd, base }).files, ['README.md', 'test/helper.ts']);
        write('new.ts', 'untracked'); rmSync(join(cwd, 'test/helper.ts'));
        assert.deepEqual(changedFiles({ cwd, base: 'HEAD', workingTree: true }).files, ['new.ts', 'test/helper.ts']);
        assert.throws(() => changedFiles({ cwd, base: 'missing-ref' }), /Cannot determine scope/);
        assert.equal(selectChecks(changedFiles({ cwd, defaultBranch: 'missing-ref' }).files).install, true);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('aggregate refuses failed, cancelled, missing or skipped required jobs', () => {
    const scope = selectChecks(['test/tasks.test.ts']);
    const jobs = { scope: { result: 'success' }, checks: { result: 'success' }, prototype: { result: 'skipped' } };
    verifyJobs(scope, jobs);
    for (const result of ['failure', 'cancelled', 'skipped', undefined]) assert.throws(() => verifyJobs(scope, { ...jobs, checks: { result } }), /did not succeed/);
    assert.throws(() => verifyJobs(scope, { ...jobs, scope: { result: 'failure' } }));
});
