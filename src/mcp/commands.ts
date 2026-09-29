import { Command } from 'commander';
import type { ResolvedConfig } from '../config';
import { RunweftError } from '../errors';
import { recordClaudeCall } from './claude-hook';
import { hostClientSchema } from './identity';
import { serveMcp } from './server';

export function addMcpCommands(program: Command, context: () => ResolvedConfig) {
    const mcp = program.command('mcp').description('为 Codex 和 Claude Code 提供工作区协作工具');
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
