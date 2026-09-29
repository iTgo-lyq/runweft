import { Command } from 'commander';
import type { ResolvedConfig } from '../config';
import { RunweftError } from '../errors';
import { recordClaudeCall } from './claude-hook';
import { hostClientSchema } from './identity';
import { serveMcp } from './server';
import { checkMcp, configureMcp, listMcpBackups, restoreMcp } from './install';

export function addMcpCommands(program: Command, context: () => ResolvedConfig, output: (value: unknown, human: string) => void) {
    const mcp = program.command('mcp').description('为 Codex 和 Claude Code 提供工作区协作工具');
    for (const [name, install, description] of [
        ['install', true, '全局安装或更新 Runweft MCP；自动检测原生客户端'],
        ['uninstall', false, '移除 Runweft 自身的 MCP 与 hook；保留其他设置和数据'],
    ] as const) {
        mcp.command(name).description(description).option('--client <codex|claude|all>', '只处理指定客户端；省略时自动检测')
            .action(options => {
                const config = context();
                const prefix = `runweft --home '${config.home.replaceAll("'", "'\\''")}'`;
                const result = configureMcp(config, install, options.client);
                output(result, `${result.clients.join('、')}：${result.changed ? install ? '已安装或更新' : '已卸载' : '无需修改'}。`
                    + (result.backupId ? `\n备份：${result.backupPath}\n恢复：${prefix} mcp restore ${result.backupId}` : '')
                    + (install ? `\n在实际项目目录重新启动原生客户端即可使用。\n检查：${prefix} mcp check` : ''));
            });
    }
    mcp.command('check').description('检查全局注册、stdio 握手与服务连接；不调用模型')
        .option('--client <codex|claude|all>', '检查指定客户端；省略时自动检测')
        .action(async options => {
            const value = await checkMcp(context(), options.client);
            output(value, value.checks.map(check => `${check.ok ? '✓' : '✗'} ${check.client}: ${check.ok ? `stdio 握手成功 · ${check.command}\n  数据目录：${check.home}` : `${check.error?.message}${check.error?.hint ? `\n  ${check.error.hint}` : ''}`}\n  配置：${check.files.join('、')}`).join('\n')
                + `\n模式：${value.mode} · 服务：${value.connection.running ? '已连接' : '未连接，运行 runweft status / doctor 检查'}\n原生会话中的实际调用：本命令未验证。`);
            if (!value.ok) process.exitCode = 1;
        });
    mcp.command('backups').description('列出集中保存的 MCP 配置备份；不显示配置内容').action(() => {
        const backups = listMcpBackups(context());
        output({ backups }, backups.length ? backups.map(backup => `${backup.id}  ${backup.createdAt}  ${backup.operation}\n  ${backup.files.join('、')}`).join('\n') : '尚无 MCP 配置备份。');
    });
    mcp.command('restore <backup-id>').description('恢复该操作前的配置快照；拒绝覆盖后续配置修改').action(id => {
        const result = restoreMcp(context(), id);
        output(result, result.changed ? `已恢复配置：${result.files.join('、')}\n恢复前备份：${result.backupPath}` : '配置已符合备份，无需修改。');
    });
    mcp.command('serve').description('运行 stdio MCP 服务（由原生客户端启动）')
        .requiredOption('--client <codex|claude>', '接入的原生客户端')
        .action(async options => {
            const client = hostClientSchema.safeParse(options.client);
            if (!client.success) throw new RunweftError('unsupported_host', 'MCP 接入仅支持 codex 或 claude。');
            await serveMcp(client.data, context);
        });
    mcp.command('hook', { hidden: true }).description('接收 Claude PreToolUse 身份事件')
        .action(async () => {
            let input: unknown;
            try { input = JSON.parse(await Bun.stdin.text()); }
            catch { throw new RunweftError('claude_hook_invalid', 'Claude hook 输入不是有效 JSON。'); }
            recordClaudeCall(context(), input);
        });
}
