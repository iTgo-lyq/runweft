import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { HubError } from '../types';
import { canonicalCandidate, digest, observeRemote, RemoteCandidate, repositoryAlias } from './identity';

const privatePath = z.string().min(1).max(8192).refine(value => !/[\x00-\x1f\x7f]/.test(value) && (isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)));
export const GitObservation = z.object({ kind: z.literal('git'), cwd: privatePath, repositoryRoot: privatePath, gitCommonDir: privatePath,
    objectFormat: z.enum(['sha1', 'sha256']), remotes: z.array(z.object({ name: z.string().min(1).max(255).regex(/^[^\x00-\x20\x7f]+$/),
        urls: z.array(RemoteCandidate).min(1).max(64) }).strict()).max(64) }).strict();
export const Observation = z.union([GitObservation, z.object({ kind: z.literal('non_git'), cwd: privatePath }).strict()]);
export type GitObservation = z.infer<typeof GitObservation>;
export type Observation = z.infer<typeof Observation>;
export function observation(input: unknown): Observation {
    const parsed = Observation.safeParse(input);
    if (!parsed.success) throw new HubError(400, 'repository_observation_invalid', '工作区观察无效；请重新观察实际 Git 目录。');
    const value = parsed.data;
    if (value.kind === 'git') {
        if (new Set(value.remotes.map(r => r.name)).size !== value.remotes.length) throw new HubError(400, 'repository_observation_invalid', 'remote 名称重复。');
        value.remotes = value.remotes.map(remote => ({ name: remote.name, urls: remote.urls.map(canonicalCandidate) }));
    }
    return value;
}
export function remoteFingerprint(value: GitObservation) {
    const keys = value.remotes.flatMap(r => r.urls.map(u => u.kind === 'remote' ? repositoryAlias(u).canonicalKey : `${u.kind}:${u.digest}`));
    return digest(JSON.stringify([...new Set(keys)].sort()));
}

/** Reads only local Git metadata, including effective insteadOf URLs. Never prints Git stderr or credentials. */
export function observeRepository(directory: string): Observation {
    let cwd: string;
    try { cwd = realpathSync(directory); } catch { throw new HubError(400, 'repository_directory_unavailable', '无法访问工作区目录。'); }
    const env: NodeJS.ProcessEnv = { ...process.env, LC_ALL: 'C' };
    for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_CEILING_DIRECTORIES', 'GIT_CONFIG_COUNT']) delete env[key];
    const git = (...args: string[]) => execFileSync('git', ['--no-optional-locks', '-C', cwd, ...args],
        { env, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd();
    try { git('rev-parse', '--git-dir'); }
    catch (error) {
        const e = error as { code?: string; status?: number; stderr?: string | Buffer };
        if (e.status === 128 && /not a git repository/i.test(String(e.stderr))) return observation({ kind: 'non_git', cwd });
        throw new HubError(409, 'repository_git_unavailable', '无法读取 Git 工作区。', '检查 Git 安装、目录所有权及仓库配置。');
    }
    try {
        const repositoryRoot = realpathSync(git('rev-parse', '--show-toplevel'));
        const gitCommonDir = realpathSync(git('rev-parse', '--path-format=absolute', '--git-common-dir'));
        const names = git('remote').split('\n').filter(Boolean);
        const remotes = names.map(name => ({ name, urls: git('remote', 'get-url', '--all', '--', name).split('\n').map(observeRemote) }));
        return observation({ kind: 'git', cwd, repositoryRoot, gitCommonDir, objectFormat: git('rev-parse', '--show-object-format'), remotes });
    } catch { throw new HubError(409, 'repository_observation_failed', '无法完整读取 Git 工作区和 remote。', '请在工作树中执行，检查本机 Git 配置；不会把读取失败当作无 remote。'); }
}
