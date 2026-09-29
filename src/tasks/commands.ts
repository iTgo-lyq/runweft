import type { Command } from 'commander';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { ResolvedConfig } from '../config';
import { RunweftError } from '../errors';
import { TaskClient } from './client';
import type { overview } from './views';

type Summary = ReturnType<typeof overview>;
function taskText(task: Pick<Summary, 'agent_id' | 'round_id' | 'status' | 'attention' | 'report'>) {
    return `${task.agent_id} · ${task.status}\n轮次：${task.round_id}`
        + (task.attention ? `\n需处理：${task.attention.message}${task.attention.hint ? `\n${task.attention.hint}` : ''}` : '')
        + (task.report.text ? `\n${task.report.text}` : '')
        + (task.report.next_offset !== null ? `\n后续内容：runweft task show ${task.agent_id} --round ${task.round_id} --offset ${task.report.next_offset}` : '');
}
export function taskMessage(options: { message?: string; messageFile?: string }) {
    if ((options.message !== undefined) === (options.messageFile !== undefined)) throw new RunweftError('task_message_required', '请指定 --message 或 --message-file，两者选一个。');
    return options.message ?? readFileSync(options.messageFile === '-' ? 0 : options.messageFile!, 'utf8');
}
export function announceRequest(program: Command, requested?: string) {
    const id = requested ?? randomUUID();
    if (!z.uuid().safeParse(id).success) throw new RunweftError('invalid_request_id', 'request ID 必须是 UUID。');
    console.error(program.opts().json ? JSON.stringify({ event: 'task_request', request_id: id }) : `请求 ID：${id}（响应丢失时使用 --request-id ${id} 重试相同任务）`);
    return id;
}
export function addTaskCommands(program: Command, context: () => ResolvedConfig, output: (value: unknown, human: string) => void) {
    const client = () => new TaskClient(context(), process.cwd());
    const task = program.command('task').description('派生、查看与等待本机共享目录任务');
    task.command('spawn <agent>').description('接受新任务后立即返回；执行由服务继续推进')
        .option('--message <text>', '任务描述').option('--message-file <path>', '从文件读取任务；- 读取 stdin')
        .option('--request-id <uuid>', '相同请求重试时复用 ID').option('--workspace-mode <mode>', '当前仅 shared', 'shared')
        .action(async (agent, options) => {
            const message = taskMessage(options), id = announceRequest(program, options.requestId);
            const result = await client().spawn(agent, message, id, options.workspaceMode);
            output(result, `任务已接受：${result.agent_id}\n轮次：${result.round_id}\n原生执行尚待确认。\n等待：runweft task wait ${result.agent_id}`);
        });
    task.command('list').description('列出当前发起目录的任务').option('--all', '查看当前 namespace 全部任务').action(async options => {
        const result = await client().list(options.all); output(result, result.agents.map(taskText).join('\n\n') || '尚无任务。用 runweft agent list --check 查看可选定义。');
    });
    task.command('show <id>').description('查看任务事实与报告').option('--round <id>', '历史轮次').option('--offset <n>', '报告字符偏移', '0').option('--limit <n>', '报告最多字符数', '16000')
        .action(async (id, options) => {
            const result = await client().read(id, { roundId: options.round, offset: Number(options.offset), limit: Number(options.limit) });
            output(result, taskText(result) + `\n原生会话：${result.session_id ?? '未建立'}\n执行关闭：${result.stop} · 收尾：${result.finish}`);
        });
    task.command('wait <ids...>').description('等待完成或需要处理；超时和取消不终止任务').option('--timeout <ms>', '等待毫秒数（0–540000）', '30000')
        .option('--after-revision <json>', '按任务 ID 提供已读版本，如 {"任务ID":12}')
        .action(async (ids, options) => {
            const timeout = Number(options.timeout);
            if (!Number.isInteger(timeout) || timeout < 0 || timeout > 540_000) throw new RunweftError('invalid_wait_timeout', '等待时间必须为 0–540000 毫秒。');
            let after: Record<string, number> | undefined;
            try { if (options.afterRevision) after = JSON.parse(options.afterRevision); }
            catch { throw new RunweftError('invalid_revision_cursor', '--after-revision 必须是 JSON 对象。'); }
            const result = await client().wait(ids, timeout, after);
            output(result, `${result.timed_out ? '等待超时；任务继续运行。\n' : ''}${result.agents.map(taskText).join('\n\n')}`);
        });
}
