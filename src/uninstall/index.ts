import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, rmSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseDocument } from 'yaml';
import { Command } from 'commander';
import { configPath, validateConfig, type ResolvedConfig } from '../config';
import { RunweftError } from '../errors';
import { applyConfigChanges, clientFiles, prepareMcpChanges } from '../mcp/install';
import { inspectInstallation, within, type Installation } from './installation';
import { assertNoInstalledProcesses, assertNoOtherInstalledProcesses, inspectManagedProcesses, stopManagedProcesses } from './processes';
import { inspectWorkspaces, removeWorkspaces } from './workspaces';
import { checkRemovalTree, checkWritableDirectory, treeFiles } from './files';

function context(homeOption: string | undefined, env: NodeJS.ProcessEnv): ResolvedConfig {
    const file = configPath(homeOption || env.RUNWEFT_HOME || join(env.HOME || homedir(), '.runweft'), env);
    return { home: dirname(file), file, exists: existsSync(file), env, config: validateConfig({}), sources: {} };
}
function checkHome(c: ResolvedConfig, installation: Installation) {
    const user = resolve(c.env.HOME || homedir());
    const protectedPaths = [user, '/', '/etc', '/usr', '/var', '/tmp', '/opt', '/bin', '/sbin', '/lib', '/lib64', installation.root, ...(installation.prefix ? [installation.prefix] : [])];
    const native = [c.env.CODEX_HOME || join(user, '.codex'), c.env.CLAUDE_CONFIG_DIR || join(user, '.claude'), join(user, '.agents'), join(user, '.hapi')].map(path => resolve(path));
    if (protectedPaths.some(path => c.home === path || within(c.home, path)) || within(installation.root, c.home)
        || (installation.prefix && within(installation.prefix, c.home)) || native.some(path => within(c.home, path) || within(path, c.home))) {
        throw new RunweftError('uninstall_home_unsafe', '所选数据根包含程序、系统目录或其他软件数据，拒绝删除。', '使用 --home 指定专用 Runweft 数据目录。');
    }
    const stat = lstatSync(c.home, { throwIfNoEntry: false });
    if (!stat) return;
    const allowed = new Set(['config.yaml', 'server', 'connections', 'client.sqlite', 'client.sqlite-wal', 'client.sqlite-shm', 'client.sqlite-journal', 'logs', 'backups', 'cache', 'tmp']);
    if (!stat.isDirectory() || stat.isSymbolicLink() || readdirSync(c.home).some(name => !allowed.has(name) && !/^config\.yaml\.[a-f0-9-]{36}\.tmp$/.test(name))) {
        throw new RunweftError('uninstall_home_unsafe', '数据根包含未知内容、用户项目或不是普通目录，拒绝删除。', `检查 ${c.home}；未知内容不会被自动清理。`);
    }
    let generatedConfig = false;
    try { generatedConfig = readFileSync(c.file, 'utf8').startsWith('# Runweft 全局配置；'); } catch { /* Config may have been removed or corrupted. */ }
    if (!generatedConfig && !['server/runweft', 'client.sqlite', 'backups/mcp'].some(path => existsSync(join(c.home, path)))
        && !connections(c.home).some(path => ['identity.json', 'machine.json', 'connect.json'].some(name => existsSync(join(path, name))))) {
        throw new RunweftError('uninstall_home_unsafe', '未找到 Runweft 专属数据标记，拒绝删除普通目录。', `检查 ${c.home}，不要将用户项目指定为 --home。`);
    }
    for (const path of [...native, installation.executable, ...clientFiles(c, 'codex'), ...clientFiles(c, 'claude')]) {
        if (existsSync(path) && (within(realpathSync(c.home), realpathSync(path)) || within(realpathSync(path), realpathSync(c.home)))) throw new RunweftError('uninstall_home_unsafe', '数据根与需保留的原生配置或程序重叠，拒绝删除。');
    }
}
function connections(home: string) {
    const root = join(home, 'connections');
    if (!lstatSync(root, { throwIfNoEntry: false })?.isDirectory()) return [];
    return readdirSync(root).map(name => join(root, name)).filter(path => lstatSync(path).isDirectory());
}
function skills(c: ResolvedConfig, installation: Installation) {
    const user = c.env.HOME || homedir();
    const candidates = [...new Set([join(user, '.agents', 'skills', 'runweft'), join(c.env.CODEX_HOME || join(user, '.codex'), 'skills', 'runweft'),
        join(c.env.CLAUDE_CONFIG_DIR || join(user, '.claude'), 'skills', 'runweft')].map(path => resolve(path)))];
    const packaged = new Set(treeFiles(join(dirname(dirname(installation.executable)), 'skills', 'runweft')));
    return candidates.filter(path => {
        const stat = lstatSync(path, { throwIfNoEntry: false });
        if (!stat) return false;
        if (stat.isSymbolicLink()) return true; // Remove only the link, never its target.
        let name: string | undefined;
        try {
            const text = readFileSync(join(path, 'SKILL.md'), 'utf8'), header = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
            const document = header && parseDocument(header[1]!);
            if (document && !document.errors.length) name = document.get('name') as string;
        } catch { /* Not a known product Skill. */ }
        if (name !== 'runweft' || treeFiles(path).some(file => !packaged.has(file))) throw new RunweftError('uninstall_skill_unknown', '同名 Skill 目录包含未知用户内容，未删除。', `检查 ${path}，保留其中用户内容后重试。`);
        return true;
    });
}
function removeInstallation(installation: Installation, env: NodeJS.ProcessEnv, home: string) {
    if (installation.kind === 'npm') {
        const npmEnv = Object.fromEntries(Object.entries(env).filter(([key]) => !/^npm_config_/i.test(key)));
        const result = spawnSync(installation.npm!, ['uninstall', '--global', '--prefix', installation.prefix!, 'runweft', '--dry-run=false', '--ignore-scripts', '--no-audit', '--no-fund', '--offline', '--logs-max=0', '--loglevel=error', '--cache', join(home, 'tmp', 'npm-uninstall')],
            { cwd: dirname(installation.prefix!), env: npmEnv, encoding: 'utf8', timeout: 120_000 });
        if (result.error || result.status !== 0) throw new RunweftError('uninstall_program_failed', 'npm 程序卸载失败；Runweft 数据尚未删除。', `检查 ${installation.prefix} 的权限和 npm，然后重试。`);
    } else {
        for (const path of installation.links) if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink() && realpathSync(path) === installation.executable) unlinkSync(path);
        rmSync(installation.root, { recursive: true });
    }
    if (existsSync(installation.root) || existsSync(installation.executable) || installation.links.some(path => lstatSync(path, { throwIfNoEntry: false }))) {
        throw new RunweftError('uninstall_program_failed', '程序或入口仍然存在；Runweft 数据尚未删除。', '检查安装目录与入口归属后重试。');
    }
}
export async function uninstall(homeOption?: string, options: { yes?: boolean; dryRun?: boolean } = {}, env = process.env) {
    const c = context(homeOption, env), installation = { ...inspectInstallation(process.execPath, env), dataHome: c.home };
    checkHome(c, installation);
    const scope = { executables: [installation.executable, ...(installation.kind === 'npm' ? [realpathSync(join(installation.root, 'bin', 'runweft.cjs'))] : [])] };
    const clients = prepareMcpChanges(c, false, undefined, undefined, scope), skillPaths = skills(c, installation), roots = connections(c.home);
    checkRemovalTree(c.home); checkRemovalTree(installation.root);
    checkWritableDirectory(dirname(installation.root));
    for (const change of clients.filter(value => value.before !== value.after)) checkWritableDirectory(dirname(change.path));
    for (const path of skillPaths) { checkRemovalTree(path); checkWritableDirectory(dirname(path)); }
    if (installation.prefix) for (const path of [join(installation.prefix, 'lib', 'node_modules'), join(installation.prefix, 'bin')]) checkWritableDirectory(path);
    if (process.getuid?.() === 0 && lstatSync(c.env.HOME || homedir()).uid !== 0) throw new RunweftError('uninstall_permission_denied', 'root 不接管其他用户 HOME，拒绝卸载。');
    const processes = await inspectManagedProcesses(c.home, roots, installation), workspaces = inspectWorkspaces(roots, c.home);
    assertNoOtherInstalledProcesses(installation, processes);
    const summary = { installation: { kind: installation.kind, root: installation.root, executable: installation.executable, links: installation.links, prefix: installation.prefix },
        dataRoot: c.home, mcpFiles: clients.filter(change => change.before !== change.after).map(change => change.path), skills: skillPaths,
        processes: processes.map(({ kind, pid }) => ({ kind, pid })), workspaces: workspaces.map(item => item.checkout), backups: 'delete_without_creating' };
    if (!options.yes || options.dryRun) return { ...summary, applied: false };
    await stopManagedProcesses(processes);
    assertNoInstalledProcesses(installation);
    checkHome(c, installation);
    checkRemovalTree(c.home);
    // Re-read ownership after process shutdown, before making irreversible changes.
    const currentWorkspaces = inspectWorkspaces(roots, c.home);
    skills(c, installation);
    applyConfigChanges(c, 'complete-uninstall', clients, undefined, false);
    removeWorkspaces(currentWorkspaces);
    for (const path of skillPaths) rmSync(path, { recursive: true, force: true });
    removeInstallation(installation, env, c.home);
    try { rmSync(c.home, { recursive: true, force: true }); }
    catch { throw new RunweftError('uninstall_incomplete', '程序已卸载，但数据目录未能完整删除。', `剩余路径：${c.home}\n修复该目录权限后删除此路径；程序已删除，不能再调用 runweft 重试。`); }
    if (prepareMcpChanges(c, false, undefined, undefined, scope).some(change => change.before !== change.after)) throw new RunweftError('uninstall_incomplete', '原生配置中仍有此次卸载的 Runweft 接入。', '从 Codex/Claude 设置移除已失效的 Runweft 注册；未生成备份。');
    if (existsSync(c.home) || skillPaths.some(path => lstatSync(path, { throwIfNoEntry: false }))) throw new RunweftError('uninstall_incomplete', '仍有 Runweft 文件存在，未完成卸载。', '检查目录权限与外部进程；未生成备份。');
    return { ...summary, applied: true };
}
export function addUninstallCommand(program: Command, output: (value: unknown, human: string) => void) {
    program.command('uninstall').description('完整卸载本机 Runweft 程序、接入、选定数据与备份；默认预览')
        .option('--yes', '执行完整删除，不保留备份')
        .option('--dry-run', '仅预览，不停止服务或修改文件')
        .action(async options => {
            const result = await uninstall(program.opts().home, options);
            output(result, result.applied ? `Runweft 已完整卸载；未保留备份。\n已删除数据目录：${result.dataRoot}\n其他软件配置、模型凭据与用户源项目保留。`
                : `完整卸载预览：\n程序：${result.installation.root}\n数据及备份：${result.dataRoot}\nMCP 配置：${result.mcpFiles.join('、') || '无需修改'}\nSkill：${result.skills.join('、') || '无'}\n需停止进程：${result.processes.map(value => `${value.kind} ${value.pid}`).join('、') || '无'}\n受管工作区：${result.workspaces.length} 个\n执行：runweft${program.opts().home ? ` --home '${result.dataRoot.replaceAll("'", "'\\''")}'` : ''} uninstall --yes`);
        });
}
