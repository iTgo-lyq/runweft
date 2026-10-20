import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { changedFiles, selectChecks, verifyJobs, successfulPushBase } from '../ci-scope.mjs';

test('scope separates docs and subprojects, selects changed tests, and fails closed for shared changes', () => {
    assert.equal(selectChecks(['docs/release.md', 'AGENTS.md']).checks, false);
    for (const [path, check] of [['website/build.mjs', 'website'], ['packages/prototype/verify.mjs', 'prototype'], ['.agents/skills/runweft-kit/SKILL.md', 'kit']]) {
        const scope = selectChecks([path]); assert.equal(scope[check], true); assert.equal(scope.core, false); assert.deepEqual(scope.integration, []);
    }
    assert(selectChecks(['test/integration/compiled-cli.ts']).integration.includes('test/integration/tasks.test.ts'));
    assert.deepEqual(selectChecks(['test/integration/tasks.test.ts']).integration, ['test/integration/tasks.test.ts']);
    for (const file of ['test/core/config.test.ts', 'test/integration/tasks.test.ts']) assert.equal(selectChecks([file]).typecheck, true);
    for (const [source, test] of [['src/mcp/claude-hook.ts', 'test/core/state.test.ts'], ['src/mcp/install.ts', 'test/integration/cli-uninstall.test.ts'],
        ['src/mcp/server.ts', 'test/integration/task-outputs.test.ts'], ['src/mcp/tasks.ts', 'test/integration/workspace-results.test.ts'], ['src/tasks/store.ts', 'test/integration/hub-delegation.test.ts']]) {
        const scope = selectChecks([source]); assert(test.startsWith('test/core') ? scope.core : scope.integration.includes(test));
    }
    assert.equal(selectChecks(['test/integration/workspace-preparation.test.ts']).clients, true);
    assert.equal(selectChecks(['scripts/tests/npm-publish.test.mjs']).tools, true);
    assert(selectChecks(['src/hub/native-page.ts']).integration.every(file => /web-|hub-console/.test(file)));
    for (const file of ['src/hub/web/app.tsx', 'src/hub/page.ts', 'packages/ui/src/components/button.tsx']) {
        const scope = selectChecks([file]);
        assert(scope.typecheck && scope.checks && scope.integration.length > 0); assert(scope.integration.every(test => /web-|hub-console/.test(test)), file);
        assert.equal(scope.install, false); assert.deepEqual(scope.native, []);
    }
    const library = selectChecks(['packages/ui/src/styles/components.css']);
    assert(library.ui && library.prototype); assert.equal(selectChecks(['src/hub/web/app.tsx']).ui, false);
    assert.equal(selectChecks(['src/hub/csp.ts']).ui, true);
    assert.deepEqual(selectChecks(['src/hub/native-page.ts']).native, ['N1', 'N5']);
    const recovery = selectChecks(['test/acceptance/recovery.ts']);
    assert.deepEqual(recovery.integration, ['test/integration/acceptance-fixtures.test.ts']);
    assert.deepEqual(recovery.native, ['R-codex', 'R-claude', 'L-claude']);
    assert(!recovery.install && !recovery.prototype && !recovery.kit && !recovery.website && !recovery.build);
    const install = selectChecks(['test/acceptance/install.mjs']);
    assert(install.install); assert.deepEqual(install.native, []); assert(!install.prototype && !install.website);
    for (const file of ['hapi', 'bun.lock', 'src/unknown.ts', '.github/workflows/checks.yml', 'scripts/ci-scope.mjs']) {
        const scope = selectChecks([file]); assert.equal(scope.install, true); assert.equal(scope.prototype, true); assert.equal(scope.ui, true);
        assert(scope.integration.length > 20); assert(scope.native.includes('R-codex'));
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
    const scope = selectChecks(['test/integration/tasks.test.ts']);
    const jobs = { scope: { result: 'success' }, checks: { result: 'success' }, prototype: { result: 'skipped' }, install: { result: 'skipped' } };
    verifyJobs(scope, jobs);
    for (const result of ['failure', 'cancelled', 'skipped', undefined]) assert.throws(() => verifyJobs(scope, { ...jobs, checks: { result } }), /did not succeed/);
    assert.throws(() => verifyJobs(scope, { ...jobs, scope: { result: 'failure' } }));
});

test('push selection carries unchecked changes across failed/cancelled runs and rejects unrelated or missing history', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'runweft-scope-history-'));
    const git = (...args) => { const r = spawnSync('git', args, { cwd, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
    try {
        git('init', '-qb', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'commit.gpgsign', 'false');
        writeFileSync(join(cwd, 'README.md'), 'base'); git('add', '.'); git('commit', '-qm', 'verified'); const verified = git('rev-parse', 'HEAD');
        git('checkout', '-qb', 'other'); writeFileSync(join(cwd, 'other'), 'unrelated'); git('add', '.'); git('commit', '-qm', 'other'); const unrelated = git('rev-parse', 'HEAD'); git('checkout', 'main');
        writeFileSync(join(cwd, 'code.ts'), 'unchecked'); git('add', '.'); git('commit', '-qm', 'code'); const unchecked = git('rev-parse', 'HEAD');
        writeFileSync(join(cwd, 'README.md'), 'docs'); git('commit', '-qam', 'docs'); const head = git('rev-parse', 'HEAD');
        const run = (sha, conclusion = 'success') => ({ head_sha: sha, conclusion, event: 'push', head_branch: 'main', id: 1 });
        const context = { cwd, repository: 'owner/repo', head, token: 'fixture' };
        const request = runs => async url => { assert.equal(url.searchParams.get('status'), 'success'); assert(!url.searchParams.has('branch')); return { ok: true, json: async () => ({ workflow_runs: runs }) }; };
        for (const outcome of ['failure', 'cancelled']) {
            const baseline = await successfulPushBase({ ...context, request: request([run(unchecked, outcome), run(unrelated), run(verified)]) });
            assert.equal(baseline.base, verified);
            assert.deepEqual(changedFiles({ cwd, base: baseline.base, head }).files, ['README.md', 'code.ts']);
        }
        for (const runs of [[], [run(unrelated)], [run('a'.repeat(40))]]) assert.equal((await successfulPushBase({ ...context, request: request(runs) })).base, null);
        git('checkout', '-qb', 'first-doc-push', verified); writeFileSync(join(cwd, 'README.md'), 'new branch docs'); git('commit', '-qam', 'docs');
        const firstHead = git('rev-parse', 'HEAD');
        const firstBase = await successfulPushBase({ ...context, head: firstHead, request: request([run(verified)]) });
        assert.equal(firstBase.base, verified); assert.equal(selectChecks(changedFiles({ cwd, base: firstBase.base, head: firstHead }).files).checks, false);
        assert.equal((await successfulPushBase({ ...context, request: async () => { throw new Error('unavailable'); } })).base, null);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
});
