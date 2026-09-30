import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { stringify } from 'yaml';
import { agentContext, initAgent, listAgents, readAgent } from '../src/agents/definitions';
import { dataPaths, loadConfig } from '../src/config';
import { fixture } from './helpers';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function setup() {
    const root = fixture('agents'); directories.push(root);
    const userHome = join(root, 'user'), project = join(userHome, 'project'), home = join(root, 'runweft');
    mkdirSync(project, { recursive: true });
    const env = { ...process.env, GIT_CEILING_DIRECTORIES: root, HOME: userHome };
    for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_')) delete (env as NodeJS.ProcessEnv)[key];
    const c = loadConfig(home, env);
    function git(cwd: string, ...args: string[]) {
        const result = spawnSync('git', ['-C', cwd, ...args], { env, encoding: 'utf8' });
        if (result.status !== 0) throw new Error(result.stderr);
        return result.stdout.trim();
    }
    function put(scope: 'global' | 'project', id: string, data: object | string) {
        const directory = scope === 'global' ? join(home, 'agents') : join(project, '.runweft', 'agents');
        mkdirSync(directory, { recursive: true });
        const path = join(directory, `${id}.yaml`);
        writeFileSync(path, typeof data === 'string' ? data : stringify(data)); return path;
    }
    return { root, userHome, project, home, env, c, git, put };
}

test('agent reads are side effect free; whole project override is explicit and snapshots reflect content', () => {
    const h = setup();
    expect(listAgents(h.c, h.project).agents).toEqual([]);
    expect(existsSync(h.home)).toBe(false);
    const global = initAgent(h.c, h.project, 'review', { name: 'Review' });
    expect(global.definition).toMatchObject({ name: 'Review', runtime: null, model: null, reasoningEffort: null });
    expect(() => initAgent(h.c, h.project, 'review')).toThrow('已存在');
    h.put('global', 'review', { name: 'Global', instructions: 'Global instructions', flavor: 'codex', model: 'global-model' });
    h.put('project', 'review', { description: 'Project review' });
    const item = readAgent(h.c, h.project, 'review');
    expect(item.source.scope).toBe('project'); expect(item.shadowed).toEqual([{ scope: 'global', path: global.source.path }]);
    expect(item.definition).toMatchObject({ name: 'review', instructions: '', model: null });
    expect(readAgent(h.c, h.project, 'review', 'global').definition.model).toBe('global-model');
    const first = item.definitionVersion;
    h.put('project', 'review', '# comment\nname: review\ndescription: Project review\n');
    expect(readAgent(h.c, h.project, 'review').definitionVersion).toBe(first);
    h.put('project', 'review', { description: 'Changed' });
    expect(readAgent(h.c, h.project, 'review').definitionVersion).not.toBe(first);
    expect(item.definition.description).toBe('Project review');
    expect(existsSync(dataPaths(h.c).bindings)).toBe(false);
});

test('bad selected files never fall back; unrelated and shadowed errors do not disable valid agents', () => {
    const h = setup();
    h.put('global', 'review', {}); h.put('project', 'review', 'instructions: one\ninstructions: two\n');
    h.put('global', 'other', { model: 'specific-model' });
    h.put('global', 'valid', {}); h.put('global', 'shadowed', { machine: 'invalid' }); h.put('project', 'shadowed', {});
    h.put('project', 'BadName', {});
    writeFileSync(join(h.project, '.runweft', 'agents', 'legacy.yml'), '{}');
    const catalog = listAgents(h.c, h.project);
    expect(catalog.agents.map(agent => agent.id)).toEqual(['shadowed', 'valid']);
    expect(catalog.errors).toHaveLength(4);
    expect(catalog.errors.find(item => item.id === 'review')?.error.message).toContain('（2:1）');
    expect(catalog.errors.find(item => item.id === 'other')?.error.message).toContain('flavor');
    expect(catalog.errors.find(item => item.id === 'legacy')?.error.hint).toContain('.yaml');
    expect(() => readAgent(h.c, h.project, 'review')).toThrow('YAML');
    expect(readAgent(h.c, h.project, 'review', 'global').source.scope).toBe('global');
    expect(readAgent(h.c, h.project, 'valid').id).toBe('valid');
    expect(() => readAgent(h.c, h.project, 'shadowed', 'global')).toThrow('machine');
    expect(() => readAgent(h.c, h.project, '../outside')).toThrow('标识');
    h.put('project', 'review', { flavor: 'claude', model: ' ', reasoningEffort: null });
    expect(readAgent(h.c, h.project, 'review').definition.model).toBeNull();
});

test('Git worktrees use their own definitions and share repository identity; clones remain distinct', () => {
    const h = setup();
    h.git(h.project, 'init', '-b', 'main');
    h.put('project', 'review', { instructions: 'base instructions' });
    h.git(h.project, 'add', '.'); h.git(h.project, '-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-m', 'baseline');
    const worktree = join(h.userHome, 'worktree'), clone = join(h.userHome, 'clone');
    h.git(h.project, 'worktree', 'add', '-b', 'child', worktree);
    h.git(h.project, 'clone', h.project, clone);
    const nested = join(worktree, 'src'); mkdirSync(nested);
    const child = readAgent(h.c, nested, 'review');
    expect(child.context.projectRoot).toBe(worktree); expect(child.context.sourceCwd).toBe(nested);
    expect(child.source.key).toBe(readAgent(h.c, h.project, 'review').source.key);
    expect(readAgent(h.c, clone, 'review').source.key).not.toBe(child.source.key);
    writeFileSync(join(worktree, '.runweft', 'agents', 'review.yaml'), 'instructions: child instructions\n');
    expect(readAgent(h.c, nested, 'review').definition.instructions).toBe('child instructions');
    expect(readAgent(h.c, h.project, 'review').definition.instructions).toBe('base instructions');
});

test('non-Git discovery stops before user home and supports read-only dotfile symlinks', () => {
    const h = setup();
    const defaultAgents = join(h.userHome, '.runweft', 'agents'); mkdirSync(defaultAgents, { recursive: true });
    writeFileSync(join(defaultAgents, 'accidental.yaml'), '{}');
    expect(listAgents(h.c, h.project).agents).toEqual([]);
    expect(agentContext(h.c, h.userHome).projectRoot).toBe(h.userHome);
    expect(listAgents(h.c, h.userHome).agents).toEqual([]);
    expect(() => initAgent(h.c, h.userHome, 'local', { scope: 'project' })).toThrow('项目 Agent 作用域');
    const defaultHome = loadConfig(join(h.userHome, '.runweft'), h.env);
    expect(readAgent(defaultHome, h.userHome, 'accidental').source.scope).toBe('global');
    const global = initAgent(h.c, h.project, 'linked');
    const target = join(h.root, 'dotfile.yaml'); writeFileSync(target, 'instructions: linked instructions');
    rmSync(global.source.path); symlinkSync(target, global.source.path);
    const nested = join(h.project, 'src', 'lib'); mkdirSync(nested, { recursive: true });
    h.put('project', 'local', {});
    expect(readAgent(h.c, nested, 'local').context.projectRoot).toBe(h.project);
    expect(readAgent(h.c, nested, 'linked').source.linkTarget).toBe(target);
    expect(() => initAgent(h.c, nested, 'linked')).toThrow('已存在');
    expect(readFileSync(target, 'utf8')).toBe('instructions: linked instructions');
    rmSync(target);
    expect(() => readAgent(h.c, nested, 'linked')).toThrow();
});
