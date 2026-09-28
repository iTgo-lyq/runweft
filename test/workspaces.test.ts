import { expect, test } from 'bun:test';
import { mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadConfig } from '../src/config';
import { bindWorkspace, listWorkspaces } from '../src/workspaces';
import { fixture } from './helpers';

test('workspace binding resolves symlinks and preserves identity across restarts', () => {
    const root = fixture('workspace');
    const home = join(root, 'state');
    const directory = join(root, 'project with spaces');
    const alias = join(root, 'alias');
    mkdirSync(directory);
    symlinkSync(directory, alias);
    const c = loadConfig(home, {});
    const previous = process.env.GIT_CEILING_DIRECTORIES;
    // Fixtures live under the development checkout; exclude that parent repo for this non-Git case.
    process.env.GIT_CEILING_DIRECTORIES = root;
    let original;
    try { original = bindWorkspace(c, directory); }
    finally {
        if (previous === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
        else process.env.GIT_CEILING_DIRECTORIES = previous;
    }
    expect(original.repositoryRoot).toBeNull();
    expect(bindWorkspace(loadConfig(home, {}), alias).id).toBe(original.id);
    expect(listWorkspaces(c)).toHaveLength(1);
    expect(() => bindWorkspace(c, join(root, 'missing'))).toThrow('已存在的目录');
});

test('binding a Git subdirectory records the actual repository without changing it', () => {
    const root = fixture('git');
    const repo = join(root, 'repo');
    mkdirSync(repo);
    expect(spawnSync('git', ['init', '-q', repo]).status).toBe(0);
    const subdir = join(repo, 'packages', 'app');
    mkdirSync(subdir, { recursive: true });
    const binding = bindWorkspace(loadConfig(join(root, 'state'), {}), subdir);
    expect(binding.path).toBe(subdir);
    expect(binding.repositoryRoot).toBe(repo);
    expect(spawnSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' }).stdout).toBe('');
});
