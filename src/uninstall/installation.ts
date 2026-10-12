import { lstatSync, readFileSync, realpathSync, readdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { RunweftError } from '../errors';

export type Installation = { kind: 'npm' | 'standalone'; root: string; executable: string; hapi: string; links: string[]; prefix?: string; npm?: string; dataHome?: string };
export const within = (root: string, path: string) => path === root || path.startsWith(root + '/');
export function manifest(path: string): any {
    try { return JSON.parse(readFileSync(join(path, 'package.json'), 'utf8')); } catch { return null; }
}
export function inspectInstallation(executable: string, env: NodeJS.ProcessEnv): Installation {
    const binary = realpathSync(executable), platform = dirname(dirname(binary));
    const pkg = manifest(platform);
    if (basename(binary) !== 'runweft' || basename(dirname(binary)) !== 'bin'
        || pkg?.name !== `runweft-${process.platform}-${process.arch}` || !existsSync(join(platform, 'bin', 'hapi'))) {
        throw new RunweftError('uninstall_installation_unknown', '当前入口不是可识别的 Runweft 安装包。', '使用 npm 安装或独立平台包中的 runweft 执行卸载；源码与单独复制的二进制不会被删除。');
    }
    let main: string | undefined;
    for (let directory = dirname(platform); directory !== dirname(directory); directory = dirname(directory)) {
        const candidate = manifest(directory)?.name === 'runweft' ? directory
            : basename(directory) === 'node_modules' ? join(directory, 'runweft') : undefined;
        if (!candidate) continue;
        const data = manifest(candidate);
        if (data?.name !== 'runweft' || data.bin?.runweft !== 'bin/runweft.cjs' || !data.optionalDependencies?.[pkg.name]) continue;
        try {
            const require = createRequire(join(candidate, 'package.json'));
            if (realpathSync(dirname(require.resolve(`${pkg.name}/package.json`))) === platform) { main = realpathSync(candidate); break; }
        } catch { /* Candidate did not install this executable. */ }
    }
    if (main) {
        const modules = dirname(main), library = dirname(modules), prefix = dirname(library);
        if (basename(modules) !== 'node_modules' || basename(library) !== 'lib') {
            throw new RunweftError('uninstall_installation_unknown', '当前程序不是 npm 全局安装。', '本地项目依赖请在项目中使用 npm uninstall runweft；不要通过完整卸载删除用户项目。');
        }
        const launcher = join(main, 'bin', 'runweft.cjs'), link = join(prefix, 'bin', 'runweft');
        if (!lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink() || realpathSync(link) !== realpathSync(launcher)) {
            throw new RunweftError('uninstall_installation_unknown', 'npm 的 runweft 入口归属不一致。', `检查 ${link}；未删除程序。`);
        }
        const npm = Bun.which('npm', { PATH: env.PATH });
        if (!npm) throw new RunweftError('uninstall_npm_missing', '找不到 npm，不能卸载此安装。', '将 npm 加入 PATH 后重试。');
        return { kind: 'npm', root: main, executable: binary, hapi: realpathSync(join(platform, 'bin', 'hapi')), prefix, npm, links: [link] };
    }
    // A platform dependency inside node_modules must never be mistaken for an independent installation.
    if (binary.split('/').includes('node_modules') || lstatSync(platform).isSymbolicLink()
        || !Array.isArray(pkg.files) || readdirSync(platform).some(name => !['package.json', ...pkg.files].includes(name))) {
        throw new RunweftError('uninstall_installation_unknown', '独立平台包目录包含未知内容或属于 npm 依赖。', `检查 ${platform}；未删除目录。`);
    }
    const links: string[] = [];
    for (const directory of new Set((env.PATH ?? '').split(':').filter(Boolean).map(path => resolve(path)))) {
        const path = join(directory, 'runweft');
        try { if (lstatSync(path).isSymbolicLink() && realpathSync(path) === binary) links.push(path); }
        catch { /* No matching entry in this PATH directory. */ }
    }
    return { kind: 'standalone', root: platform, executable: binary, hapi: realpathSync(join(platform, 'bin', 'hapi')), links };
}
