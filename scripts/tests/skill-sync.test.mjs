import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const script = resolve('scripts/sync-runweft-skill.sh');
const run = (cwd, command, args) => spawnSync(command, args, { cwd, encoding: 'utf8' });
const git = (cwd, ...args) => {
    const result = run(cwd, 'git', args);
    assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
};
const put = (root, path, body) => {
    mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), body);
};
function fixture(t) {
    mkdirSync('.dev-smoke', { recursive: true });
    const root = mkdtempSync(resolve('.dev-smoke/runweft skill sync-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const source = join(root, 'source'), distribution = join(root, 'distribution'), remote = join(root, 'remote.git');
    git(root, 'init', '--bare', '-b', 'main', remote);
    git(root, 'init', '-b', 'main', source);
    git(root, 'clone', remote, distribution);
    for (const repo of [source, distribution]) {
        git(repo, 'config', 'user.name', 'Fixture'); git(repo, 'config', 'user.email', 'fixture@example.invalid');
        git(repo, 'config', 'core.hooksPath', '/dev/null'); git(repo, 'config', 'commit.gpgsign', 'false');
    }
    put(source, '.agents/skills/runweft/SKILL.md', '---\nname: runweft\ndescription: Runweft installation and delegation.\n---\n\n[Install](references/onboarding.md)\n');
    for (const name of ['onboarding', 'configuration', 'delegation', 'maintenance']) put(source, `.agents/skills/runweft/references/${name}.md`, `# ${name}\n`);
    put(source, 'src/private.ts', 'Private product source\n');
    put(source, '.agents/skills/spec-trail/SKILL.md', 'Internal engineering instructions\n');
    git(source, 'add', '.'); git(source, 'commit', '-m', 'Source Skill');
    const sourceCommit = git(source, 'rev-parse', 'HEAD');
    put(distribution, 'README.md', 'Public installation instructions\n');
    put(distribution, 'LICENSE', 'Distribution metadata\n');
    put(distribution, 'skills/runweft/stale.md', 'Stale file\n');
    put(distribution, 'skills/another/SKILL.md', 'Independent Skill\n');
    git(distribution, 'add', '.'); git(distribution, 'commit', '-m', 'Distribution baseline');
    git(distribution, 'push', '-u', 'origin', 'main');
    return { root, source, distribution, remote, sourceCommit, sync: () => run(root, 'bash', [script, source, distribution]) };
}

test('sync publishes the committed Skill only, deletes stale files, preserves distribution content and is idempotent', t => {
    const f = fixture(t);
    put(f.source, '.agents/skills/runweft/SKILL.md', 'Uncommitted draft\n');
    put(f.source, '.agents/skills/runweft/local-only.txt', 'Untracked draft\n');
    const result = f.sync(); assert.equal(result.status, 0, result.stdout + result.stderr);
    const paths = git(f.remote, 'ls-tree', '-r', '--name-only', 'main').split('\n');
    assert.deepEqual(paths.filter(path => path.startsWith('skills/runweft/')), [
        'skills/runweft/SKILL.md', ...['configuration', 'delegation', 'maintenance', 'onboarding'].map(name => `skills/runweft/references/${name}.md`),
    ]);
    assert(!paths.some(path => /private|spec-trail|local-only|stale/.test(path)));
    assert.equal(git(f.remote, 'show', 'main:README.md'), 'Public installation instructions');
    assert.equal(git(f.remote, 'show', 'main:LICENSE'), 'Distribution metadata');
    assert.equal(git(f.remote, 'show', 'main:skills/another/SKILL.md'), 'Independent Skill');
    assert.match(git(f.remote, 'show', 'main:skills/runweft/SKILL.md'), /Runweft installation/);
    assert(git(f.remote, 'log', '-1', '--format=%B', 'main').includes(f.sourceCommit));
    assert.equal(git(f.distribution, 'status', '--porcelain'), '');
    const published = git(f.remote, 'rev-parse', 'main'), again = f.sync();
    assert.equal(again.status, 0, again.stderr); assert.match(again.stdout, /already matches/);
    assert.equal(git(f.remote, 'rev-parse', 'main'), published);
});

test('sync refuses dirty or non-main distribution checkouts before changing files', t => {
    const f = fixture(t), before = git(f.remote, 'rev-parse', 'main');
    put(f.distribution, 'README.md', 'Local edit\n');
    const dirty = f.sync(); assert.notEqual(dirty.status, 0); assert.match(dirty.stderr, /must be clean/);
    git(f.distribution, 'restore', 'README.md'); git(f.distribution, 'switch', '-c', 'draft');
    const draft = f.sync(); assert.notEqual(draft.status, 0); assert.match(draft.stderr, /must be on main/);
    assert.equal(git(f.remote, 'rev-parse', 'main'), before);
    assert.equal(readFileSync(join(f.distribution, 'skills/runweft/stale.md'), 'utf8'), 'Stale file\n');
});

test('sync rejects missing references and links to private source without changing the public tree', t => {
    const f = fixture(t), before = git(f.remote, 'rev-parse', 'main');
    rmSync(join(f.source, '.agents/skills/runweft/references/delegation.md'));
    git(f.source, 'add', '.'); git(f.source, 'commit', '-m', 'Missing reference');
    const missing = f.sync(); assert.notEqual(missing.status, 0);
    assert.equal(git(f.remote, 'rev-parse', 'main'), before);
    git(f.source, 'restore', '--source', f.sourceCommit, '.agents/skills/runweft');
    put(f.source, '.agents/skills/runweft/references/onboarding.md', '[Source](../../../../src/private.ts)\n');
    git(f.source, 'add', '.'); git(f.source, 'commit', '-m', 'Link to private source');
    const escaping = f.sync(); assert.notEqual(escaping.status, 0); assert.match(escaping.stderr, /leaves its directory/);
    assert.equal(git(f.remote, 'rev-parse', 'main'), before);
    assert.equal(git(f.distribution, 'status', '--porcelain'), '');
});

test('sync rejects invalid or hidden Skill metadata', t => {
    const f = fixture(t), before = git(f.remote, 'rev-parse', 'main');
    for (const frontmatter of [
        'name: another\ndescription: Wrong identity',
        'name: runweft\ndescription: ""',
        'name: runweft\ndescription: Internal\nmetadata:\n  internal: true',
        'name: [broken YAML',
    ]) {
        put(f.source, '.agents/skills/runweft/SKILL.md', `---\n${frontmatter}\n---\n`);
        git(f.source, 'add', '.'); git(f.source, 'commit', '-m', 'Invalid metadata');
        const result = f.sync(); assert.notEqual(result.status, 0);
        assert.equal(git(f.remote, 'rev-parse', 'main'), before);
        assert.equal(git(f.distribution, 'status', '--porcelain'), '');
    }
});

test('a rejected push is reported as failure while keeping the local publication commit', t => {
    const f = fixture(t), before = git(f.remote, 'rev-parse', 'main');
    writeFileSync(join(f.remote, 'hooks/pre-receive'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const rejected = f.sync(); assert.notEqual(rejected.status, 0); assert.match(rejected.stderr, /declined/);
    assert.equal(git(f.remote, 'rev-parse', 'main'), before);
    assert.notEqual(git(f.distribution, 'rev-parse', 'HEAD'), before);
    assert.equal(git(f.distribution, 'status', '--porcelain'), '');
});
