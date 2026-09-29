#!/usr/bin/env bun
import { Command, CommanderError } from 'commander';
import { stringify } from 'yaml';
import pkg from '../package.json';
import { configPath, dataPaths, initializeConfig, loadConfig, setConfig, type ResolvedConfig } from './config';
import { errorDetails } from './errors';
import { bindWorkspace, listWorkspaces } from './workspaces';
import { addServiceCommands } from './service-commands';
import { addMcpCommands } from './mcp/commands';

export const VERSION = pkg.version;

export function createProgram() {
    const program = new Command('runweft')
        .description('Runweft · HAPI 执行基础上的工作区协作工具')
        .version(VERSION)
        .option('--home <directory>', '配置与数据根目录（默认 ~/.runweft）')
        .option('--json', '输出结构化 JSON')
        .enablePositionalOptions()
        .showHelpAfterError()
        .exitOverride();
    function context(): ResolvedConfig { return loadConfig(program.opts().home); }
    function output(value: unknown, human: string) {
        console.log(program.opts().json ? JSON.stringify(value, null, 2) : human);
    }
    program.command('init').description('生成带说明的配置；保留已有配置')
        .option('--mode <local|hub>', '使用本地服务或已有 Hub')
        .option('--url <url>', 'Hub 地址；指定后默认使用 Hub 模式')
        .action(options => {
            const result = initializeConfig(program.opts().home, options);
            output({ created: result.created, file: result.file, mode: result.config.mode },
                `${result.created ? '已创建' : '保留已有'}配置：${result.file}\n模式：${result.config.mode}\n${result.config.mode === 'hub' ? '下一步：runweft auth login，然后 runweft start。' : '下一步：runweft start，然后 runweft open。'}\n查看生效配置：runweft config show`);
        });

    const config = program.command('config').description('查看、检查或编辑全局配置');
    config.command('path').description('显示配置文件位置').action(() => {
        const file = configPath(program.opts().home); output({ path: file }, file);
    });
    config.command('show').description('显示生效配置及各项来源').action(() => {
        const c = context();
        output({ file: c.file, exists: c.exists, config: c.config, sources: c.sources },
            `${stringify(c.config)}\n配置来源：\n${Object.entries(c.sources).map(([key, source]) => `  ${key}: ${source}`).join('\n')}`);
    });
    config.command('check').description('校验文件与环境覆盖后的配置').action(() => {
        const c = context(); output({ valid: true, file: c.file, exists: c.exists }, `配置有效${c.exists ? `：${c.file}` : '（当前使用默认配置）'}`);
    });
    config.command('set <key> <value>').description('修改配置项，如 server.port 3210；保留文件注释').action((key, value) => {
        const c = setConfig(context(), key, value);
        output({ updated: key, file: c.file, effectiveSource: c.sources[key] }, `已更新 ${key}：${c.file}\n生效来源：${c.sources[key] ?? c.file}`);
    });

    program.command('paths').description('列出持久数据、缓存及原生配置的位置').action(() => {
        const paths = dataPaths(context());
        output(paths, [
            `数据根：${paths.home}`, `配置：${paths.config}`, `Hub 数据：${paths.server}`,
            `当前连接 HAPI 数据：${paths.hapiClient}`, `本机工作区绑定：${paths.bindings}`,
            `日志：${paths.logs}`, `配置备份：${paths.backups}`, `可再生缓存：${paths.cache}`, `临时目录：${paths.temporary}`,
            `原生 Codex：${paths.nativeCodex}`, `原生 Claude Code：${paths.nativeClaude}`,
            '备份：停止托管服务后备份配置、server、connections 和 client.sqlite；原生目录按各工具规则备份。',
        ].join('\n'));
    });
    const workspace = program.command('workspace').description('绑定本机真实工作目录');
    workspace.command('bind [directory]').description('绑定目录；省略时使用当前目录').action((directory = process.cwd()) => {
        const binding = bindWorkspace(context(), directory);
        output(binding, `工作区：${binding.id}\n目录：${binding.path}\nGit 仓库：${binding.repositoryRoot ?? '无（仅共享目录模式可用）'}`);
    });
    workspace.command('list').description('列出本机已绑定工作区').action(() => {
        const items = listWorkspaces(context());
        output({ workspaces: items }, items.length ? items.map(w => `${w.id}  ${w.path}`).join('\n') : '尚未绑定工作区。进入项目目录后运行 runweft workspace bind。');
    });
    addServiceCommands(program, context, output);
    addMcpCommands(program, context, output);
    program.addHelpText('after', '\n开始使用：\n  runweft start\n  runweft open\n\n编辑配置：runweft init，然后 runweft config show。\n持久数据默认位于 ~/.runweft；使用 --home 可选择其他位置。');
    return program;
}

export async function main(args = process.argv) {
    const program = createProgram();
    try {
        await program.parseAsync(args);
    } catch (error) {
        if (error instanceof CommanderError) {
            process.exitCode = error.exitCode;
            return;
        }
        const details = errorDetails(error);
        console.error(program.opts().json ? JSON.stringify({ error: details }) : `错误：${details.message}${details.hint ? `\n${details.hint}` : ''}`);
        process.exitCode = 1;
    }
}

if (import.meta.main) await main();
