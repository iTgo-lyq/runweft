import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { RunweftError } from '../errors';
import { within } from './installation';
import { checkWritableDirectory, regularPath } from './files';

export type WorkspaceRemoval = { checkout: string; repository: string; refs: { name: string; head: string }[]; registered: boolean };
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const hash = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
function git(repository: string, args: string[]) {
    const result = spawnSync('git', ['-C', repository, ...args], { encoding: 'utf8', timeout: 30_000 });
    if (result.error || result.status !== 0) throw new RunweftError('uninstall_workspace_unknown', '无法验证或清理受管 Git 工作区。', `检查 ${repository}；修复后重试卸载。`);
    return result.stdout.trim();
}
function invalid(checkout: string): never {
    throw new RunweftError('uninstall_workspace_unknown', '工作区或 Git 引用已偏离受管记录，未删除。', `检查 ${checkout}；保留用户项目并确认该工作区的归属后重试。`);
}
export function inspectWorkspaces(connections: string[], home: string): WorkspaceRemoval[] {
    const removals: WorkspaceRemoval[] = [];
    for (const connection of connections) {
        const root = join(connection, 'hapi', 'workspaces', 'environments');
        if (!regularPath(home, root)) continue;
        for (const id of readdirSync(root)) {
            const directory = join(root, id), checkout = join(directory, 'checkout');
            if (!lstatSync(directory).isDirectory()) continue;
            const path = join(directory, 'workspace.json');
            if (!existsSync(path)) { if (existsSync(join(checkout, '.git'))) invalid(checkout); continue; }
            let record: any;
            try { record = JSON.parse(readFileSync(path, 'utf8')); } catch { invalid(checkout); }
            if (!uuid.test(id) || record.version !== 1 || record.environmentId !== id || record.checkout !== checkout
                || record.branch !== `hapi-task/${id}` || typeof record.source?.repositoryRoot !== 'string' || !hash.test(record.source?.baseCommit ?? '')) invalid(checkout);
            const repository = record.source.repositoryRoot;
            if (!existsSync(repository)) continue;
            const commonDir = git(repository, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
            if (within(home, realpathSync(repository)) || within(home, realpathSync(commonDir))) continue;
            if (typeof record.source.commonDir !== 'string' || realpathSync(commonDir) !== realpathSync(record.source.commonDir)) invalid(checkout);
            if (existsSync(checkout)) {
                if (lstatSync(checkout).isSymbolicLink() || git(checkout, ['rev-parse', '--path-format=absolute', '--git-common-dir']) !== commonDir) invalid(checkout);
            }
            const prefix = `refs/hapi/workspaces/${id}/`, branch = `refs/heads/hapi-task/${id}`;
            const expected = new Map<string, string>([[prefix + 'base', record.source.baseCommit]]);
            let last = { sealedAt: -1, head: record.source.baseCommit };
            for (const [round, result] of Object.entries(record.results ?? {}) as [string, any][]) {
                if (!uuid.test(round) || result.resultRef !== prefix + 'rounds/' + round || !hash.test(result.resultHead ?? '') || !Number.isFinite(result.sealedAt)) invalid(checkout);
                expected.set(result.resultRef, result.resultHead);
                if (result.sealedAt > last.sealedAt) last = { sealedAt: result.sealedAt, head: result.resultHead };
            }
            expected.set(branch, last.head);
            const refs = git(repository, ['for-each-ref', '--format=%(refname) %(objectname)', prefix, branch]).split('\n').filter(Boolean)
                .map(line => { const [name, head] = line.split(' '); return { name: name!, head: head! }; }).filter(ref => ref.name === branch || ref.name.startsWith(prefix));
            for (const ref of refs) if (expected.get(ref.name) !== ref.head) invalid(checkout);
            const trees = git(repository, ['worktree', 'list', '--porcelain', '-z']);
            const registered = trees.includes(`worktree ${checkout}\0`);
            for (const tree of trees.split('\0\0')) {
                const fields = tree.split('\0');
                if (fields.includes(`branch ${branch}`) && fields[0] !== `worktree ${checkout}`) invalid(checkout);
            }
            if (existsSync(checkout) && (!registered || git(checkout, ['symbolic-ref', 'HEAD']) !== branch)) invalid(checkout);
            checkWritableDirectory(commonDir);
            removals.push({ checkout, repository, refs, registered });
        }
    }
    return removals;
}
export function removeWorkspaces(removals: WorkspaceRemoval[]) {
    for (const item of removals) {
        if (item.registered) git(item.repository, ['worktree', 'remove', '--force', '--force', item.checkout]);
        for (const ref of item.refs) git(item.repository, ['update-ref', '-d', ref.name, ref.head]);
    }
}
