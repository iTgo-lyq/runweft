import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join, parse, relative, resolve } from 'node:path';
import { configPath } from './config';
import { RunweftError } from './errors';

/** Prerelease reset: a fixed list of product records, no migration or repository traversal. */
export function resetData(homeOption?: string, apply = false) {
    const home = dirname(configPath(homeOption));
    if (home === parse(home).root) throw new RunweftError('reset_root_invalid', '不能以文件系统根目录作为 Runweft 数据根。');
    const root = existsSync(home) ? realpathSync(home) : resolve(home);
    const managed = (path: string) => {
        const rel = relative(home, path);
        let parent = home;
        for (const part of rel.split('/').filter(Boolean)) {
            parent = join(parent, part);
            const stat = lstatSync(parent, { throwIfNoEntry: false });
            if (stat?.isSymbolicLink()) throw new RunweftError('reset_symlink', '清理路径中存在符号链接，未删除任何数据。', `先检查并移除链接：${parent}`);
        }
        return path;
    };
    const stopped = (path: string, name: string) => {
        managed(path);
        if (!existsSync(path)) return;
        let state: { pid?: number };
        try { state = JSON.parse(readFileSync(path, 'utf8')); }
        catch { throw new RunweftError('reset_process_unknown', `${name} 进程记录无法解析。`, `核对 ${path}，确认服务停止后移除损坏记录。`); }
        if (!Number.isInteger(state.pid) || state.pid! <= 0) throw new RunweftError('reset_process_unknown', `${name} 进程 ID 无效。`, `核对 ${path}。`);
        try { process.kill(state.pid!, 0); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return; throw error; }
        throw new RunweftError('reset_service_running', `${name} 仍在运行，未删除任何数据。`, '先停止托管 Hub 和此数据根的所有 Runner，再重试 data reset --apply。');
    };
    const connections = join(home, 'connections'); managed(connections);
    const names = existsSync(connections) ? readdirSync(connections, { withFileTypes: true }).filter(entry => entry.isDirectory() || entry.isSymbolicLink()).map(entry => entry.name) : [];
    const remove = [join(home, 'config.yaml'), join(home, 'agents'), join(home, 'server', 'runweft'), join(home, 'server', 'process.json'),
        ...['settings.json', 'jwt-secret.json', 'hapi.db', 'hapi.db-wal', 'hapi.db-shm', 'artifacts'].map(name => join(home, 'server', 'hapi', name)),
        ...['client.sqlite', 'client.sqlite-wal', 'client.sqlite-shm'].map(name => join(home, name))];
    const preserved = [join(home, 'backups'), join(home, 'logs')];
    const runnerStates: string[] = [];
    for (const name of names) {
        const connection = join(connections, name); managed(connection);
        for (const file of ['identity.json', 'connect.json', 'machine.json']) remove.push(join(connection, file));
        for (const file of ['settings.json', 'runner.state.json', 'runner.state.json.lock']) remove.push(join(connection, 'hapi', file));
        runnerStates.push(join(connection, 'hapi', 'runner.state.json'));
        preserved.push(join(connection, 'hapi', 'workspaces'), join(connection, 'hapi', 'artifact-transfers'));
    }
    for (const path of remove) managed(path);
    // Preview always works while running. Applying checks every process before the first deletion.
    if (apply) {
        stopped(join(home, 'server', 'process.json'), '托管 Hub');
        for (const state of runnerStates) stopped(state, 'Runner');
        for (const path of remove) rmSync(path, { recursive: true, force: true });
    }
    return { applied: apply, dataRoot: root, remove, preserved,
        consequences: '清除配置、身份、登记、任务历史与中心附件；重新 init、连接身份、登记机器/runtime 和 Agent。',
        retained: '仓库、worktree、Git 缓存和未交付文件保留原路径；历史关联丢失，需自行审查回收。用户原生配置、模型凭据和 MCP 安装备份保留。' };
}
