import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const command = fileURLToPath(new URL('../../.agents/skills/spec-trail/scripts/change.mjs', import.meta.url));
function fixture(t) {
    const base = mkdtempSync(join(tmpdir(), 'spec-trail-size-'));
    t.after(() => rmSync(base, { recursive: true, force: true }));
    const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
    for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) delete env[key];
    const run = (bin, args, cwd = base) => spawnSync(bin, args, { cwd, env, encoding: 'utf8' });
    const git = (...args) => {
        const r = run('git', args); assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
    };
    const remote = join(base, 'origin.git'), repo = join(base, 'repo');
    git('init', '--bare', '-b', 'develop', remote);
    git('init', '-b', 'develop', repo);
    const localGit = (...args) => git('-C', repo, ...args);
    localGit('config', 'user.name', 'Fixture'); localGit('config', 'user.email', 'fixture@example.invalid');
    localGit('config', 'core.hooksPath', '/dev/null'); localGit('config', 'commit.gpgsign', 'false');
    localGit('commit', '--allow-empty', '-m', 'Baseline');
    const at = '2026-10-01T00:00:00.000Z';
    const state = {
        schemaVersion: 1, id: 'feature', title: 'Prototype', size: 'medium', status: 'active', stage: 'close', branch: 'codex/feature',
        confirmations: Object.fromEntries(['requirement', 'technical', 'plan'].map(p => [p, { at, summary: p, source: 'Fixture' }])),
        tasks: { T1: { title: 'Deliver prototype', status: 'done', verification: 'Browser flows passed' } },
        closure: { verification: { at, result: 'passed', summary: 'Prototype passed' } },
        waitingFor: { kind: 'confirmation', summary: 'Review prototype' },
        previews: [{ id: 'tasks', title: 'Tasks', kind: 'page', devices: ['pc-web'], artifact: {
            type: 'hosted', url: 'https://preview.example.invalid/tasks/index.html', version: 'a'.repeat(64),
            digest: 'sha256:' + 'b'.repeat(64), sourceCommit: localGit('rev-parse', 'HEAD'),
        } }],
    };
    const file = join(repo, 'docs/project/changes/feature/change.json');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(join(repo, 'docs/project/workflow.json'), JSON.stringify({ schemaVersion: 2, collaborationBranch: 'develop', protectedBranches: ['main'], prototype: { status: 'enabled', packagePath: 'packages/prototype', hosting: { provider: 'custom' } } }));
    writeFileSync(file, JSON.stringify(state, null, 2) + '\n');
    localGit('add', '.'); localGit('commit', '-m', 'Register Change');
    localGit('remote', 'add', 'origin', remote); localGit('push', 'origin', 'develop');
    localGit('switch', '-c', 'codex/feature'); localGit('push', '-u', 'origin', 'HEAD');
    const rework = (...args) => run(process.execPath, [command, 'rework', '--repo', repo, '--change', 'feature', '--reason', 'Expand scope', '--approach', 'Replan product UI', ...args]);
    return { state, rework, contents: () => readFileSync(file, 'utf8'), read: () => JSON.parse(readFileSync(file, 'utf8')) };
}

test('requirement rework upgrades size while preserving delivered tasks and immutable previews', t => {
    const f = fixture(t), r = f.rework('--stage', 'requirement', '--size', 'large');
    assert.equal(r.status, 0, r.stderr);
    const next = f.read();
    assert.equal(next.size, 'large'); assert.equal(next.stage, 'requirement'); assert.equal(next.status, 'active');
    assert.equal(next.id, f.state.id); assert.equal(next.branch, f.state.branch);
    assert.deepEqual(next.tasks, f.state.tasks); assert.deepEqual(next.previews, f.state.previews);
    assert.deepEqual(next.confirmations, {}); assert.deepEqual(next.closure, {}); assert.equal(next.waitingFor, undefined);
    assert.equal(next.rework.reason, 'Expand scope'); assert(Number.isFinite(Date.parse(next.rework.at)));
});

test('dry-run reports resized state without changing the original record', t => {
    const f = fixture(t), before = f.contents(), r = f.rework('--stage', 'requirement', '--size', 'large', '--dry-run');
    assert.equal(r.status, 0, r.stderr); assert.equal(JSON.parse(r.stdout).state.size, 'large'); assert.equal(f.contents(), before);
});

test('ordinary rework preserves the existing size', t => {
    const f = fixture(t), r = f.rework('--stage', 'requirement');
    assert.equal(r.status, 0, r.stderr); assert.equal(f.read().size, 'medium');
});

for (const [name, args, error] of [
    ['downstream resizing', ['--stage', 'technical', '--size', 'large'], /Size changes require requirement rework/],
    ['unknown size', ['--stage', 'requirement', '--size', 'huge'], /Size rework supports/],
    ['empty size', ['--stage', 'requirement', '--size', ''], /Size rework supports/],
    ['implicit parent conversion', ['--stage', 'requirement', '--size', 'xlarge'], /explicit parent\/child planning/],
]) test(`rejects ${name} without mutating any workflow facts`, t => {
    const f = fixture(t), before = f.contents(), r = f.rework(...args);
    assert.notEqual(r.status, 0); assert.match(r.stderr, error); assert.equal(f.contents(), before);
});
