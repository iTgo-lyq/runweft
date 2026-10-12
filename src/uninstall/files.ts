import { accessSync, constants, lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { RunweftError } from '../errors';

/** Walk without following links; refuse foreign owners, mounts and unwritable directories before shutdown. */
export function checkRemovalTree(root: string) {
    const stat = lstatSync(root, { throwIfNoEntry: false });
    if (!stat) return;
    const uid = process.getuid?.();
    function visit(path: string) {
        const entry = lstatSync(path);
        if (uid !== undefined && entry.uid !== uid) throw new RunweftError('uninstall_permission_denied', '删除范围含其他用户的文件，拒绝卸载。', `检查 ${path} 的归属。`);
        if (!entry.isDirectory()) return;
        if (entry.dev !== stat!.dev) throw new RunweftError('uninstall_home_unsafe', '删除范围内存在其他挂载目录，拒绝卸载。', `先处理 ${path} 的挂载。`);
        checkWritableDirectory(path);
        for (const name of readdirSync(path)) visit(join(path, name));
    }
    visit(root);
}
export function checkWritableDirectory(path: string) {
    try { accessSync(path, constants.W_OK | constants.X_OK); }
    catch { throw new RunweftError('uninstall_permission_denied', '安装或数据目录不可写，未开始卸载。', `检查 ${path} 的权限。`); }
}
export function treeFiles(root: string): string[] {
    const files: string[] = [];
    function visit(path: string, relative = '') {
        for (const name of readdirSync(path)) {
            const child = join(path, name), key = relative ? relative + '/' + name : name;
            if (lstatSync(child).isDirectory()) visit(child, key);
            else files.push(key);
        }
    }
    visit(root);
    return files;
}

export function regularPath(root: string, path: string) {
    let current = root;
    for (const name of path.slice(root.length + 1).split('/')) {
        current = join(current, name);
        const stat = lstatSync(current, { throwIfNoEntry: false });
        if (!stat || stat.isSymbolicLink()) return false;
    }
    return true;
}
