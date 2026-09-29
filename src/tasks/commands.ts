import type { Command } from 'commander';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { targetUrl, type ResolvedConfig } from '../config';
import { RunweftError } from '../errors';
import { ArtifactInputSchema, parseTask, type ArtifactInput } from './types';
import { TaskClient } from './client';
import type { overview } from './views';

type Summary = ReturnType<typeof overview>;
function taskText(task: Pick<Summary, 'agent_id' | 'round_id' | 'status' | 'attention' | 'report' | 'git'> & { input_files?: { status: string; count?: number; files?: ArtifactInput[] } | null }) {
    return `${task.agent_id} · ${task.status}\n轮次：${task.round_id}`
        + (task.input_files && task.input_files.status !== 'none' ? `\n输入文件：${task.input_files.count ?? task.input_files.files?.length ?? 0} · ${task.input_files.status}` : '')
        + (task.attention ? `\n需处理：${task.attention.message}${task.attention.hint ? `\n${task.attention.hint}` : ''}` : '')
        + (task.git === 'not_applicable' ? '' : `\nGit：${task.git.status}${task.git.checkout ? ` · ${task.git.checkout}` : ''}`
            + `\n工作区：${task.git.retained}`
            + (task.git.removal?.error ? `\n清理需处理：${task.git.removal.error.message}${task.git.removal.error.hint ? `\n${task.git.removal.error.hint}` : ''}` : '')
            + (task.git.result_ref ? `\n成果引用：${task.git.result_ref}\n查看修改：git diff ${task.git.start_head} ${task.git.result_head}\n在主仓库目标分支审查并选择 merge 或 cherry-pick。` : ''))
        + (task.report.text ? `\n${task.report.text}` : '')
        + (task.report.next_offset !== null ? `\n后续内容：runweft task show ${task.agent_id} --round ${task.round_id} --offset ${task.report.next_offset}` : '');
}
export function taskInputs(values: string[] = []): ArtifactInput[] {
    return values.map(value => {
        const split = value.lastIndexOf('=');
        return parseTask(ArtifactInputSchema, { artifactId: value.slice(split + 1), ...(split < 0 ? {} : { name: value.slice(0, split) }) });
    });
}
const addInput = (value: string, values: string[]) => [...values, value];
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
    const task = program.command('task').description('派生、续接与控制本机 shared/worktree 任务');
    task.command('workspace').description('管理保留的独立工作区').command('remove <id>').description('显式删除已结束任务的工作区；保留报告和 Git 成果引用')
        .option('--discard-ignored', '明确丢弃 ignored 依赖和文件；默认存在时拒绝删除')
        .action(async (id, options) => {
            const result = await client().removeWorkspace(id, !!options.discardIgnored);
            output(result, result.environment.mode === 'worktree' && result.environment.status === 'removed' ? '工作区已移除；报告和 Git 成果引用保留。'
                : `已请求删除工作区：${id}\n完成前不接受新轮次；报告和成果引用保留。\n查询结果：runweft task show ${id}`);
        });
    task.command('spawn <agent>').description('接受新任务后立即返回；执行由服务继续推进')
        .option('--message <text>', '任务描述').option('--message-file <path>', '从文件读取任务；- 读取 stdin')
        .option('--request-id <uuid>', '相同请求重试时复用 ID').option('--workspace-mode <shared|worktree>', '共享当前目录或准备独立 Git worktree', 'shared')
        .option('--base <ref>', 'worktree 的已提交 Git 基线，默认 HEAD；不包含主目录未提交内容')
        .option('--input <name=id|id>', '使用已上传文件；可重复，默认采用对象文件名', addInput, [])
        .action(async (agent, options) => {
            const message = taskMessage(options), id = announceRequest(program, options.requestId);
            const result = await client().spawn(agent, message, id, options.workspaceMode, undefined, options.base, taskInputs(options.input));
            output(result, `任务已接受：${result.agent_id}\n轮次：${result.round_id}\n原生执行尚待确认。\n等待：runweft task wait ${result.agent_id}`);
        });
    task.command('list').description('列出当前发起目录的任务').option('--all', '查看当前 namespace 全部任务').action(async options => {
        const result = await client().list(options.all); output(result, result.agents.map(taskText).join('\n\n') || '尚无任务。用 runweft agent list --check 查看可选定义。');
    });
    task.command('send <id>').description('默认排队下一轮；--steer 追加到指定活跃 Codex 轮次')
        .option('--message <text>', '任务描述').option('--message-file <path>', '从文件读取任务；- 读取 stdin')
        .option('--input <name=id|id>', '下一轮的已上传输入文件；可重复，steer 不支持', addInput, [])
        .option('--request-id <uuid>', '重试相同追加请求时复用 ID').option('--steer', '运行中追加，需 --round').option('--round <id>', 'steer 的目标轮次')
        .action(async (id, options) => {
            const message = taskMessage(options), request = announceRequest(program, options.requestId);
            const result = await client().send(id, message, request, { mode: options.steer ? 'steer' : 'next', roundId: options.round, inputs: taskInputs(options.input) });
            output(result, `${options.steer ? '追加已接受，实际原生交付请查询任务' : '下一轮已排队'}：${result.agent_id}\n轮次：${result.round_id}\n输入：${result.input_id}\n查看：runweft task show ${result.agent_id} --round ${result.round_id}`);
        });
    task.command('interrupt <id>').description('取消指定轮次；已结束的轮次不影响后续执行').requiredOption('--round <id>', '固定业务轮次')
        .action(async (id, options) => {
            const result = await client().interrupt(id, options.round);
            output(result, result.status === 'already_finished' ? '指定轮次已结束；未中断其他轮次。' : result.status === 'execution_already_stopped' ? '原生执行已停止，正在进行 Git 收尾；未更改取消状态。' : `已请求取消轮次：${result.round_id}\n确认关闭前仍可查看状态：runweft task show ${id} --round ${result.round_id}`);
        });
    task.command('retry-finish <id>').description('修复后重试指定轮次的 Git 收尾；不会重发原生任务').requiredOption('--round <id>', '固定业务轮次')
        .action(async (id, options) => {
            const result = await client().retryFinish(id, options.round);
            output(result, `已请求重新封存：${result.round_id}\n查看：runweft task show ${id} --round ${result.round_id}`);
        });
    task.command('permission <id>').description('响应指定活跃轮次的原生权限请求；不改变默认权限模式')
        .requiredOption('--round <id>', '固定业务轮次').requiredOption('--request <native-id>', '原生权限请求 ID')
        .requiredOption('--decision <approved|denied|abort>', '批准本次、拒绝或中止').option('--answers <json>', '原生问答的 JSON 回答')
        .action(async (id, options) => {
            let answers;
            try { if (options.answers) answers = JSON.parse(options.answers); }
            catch { throw new RunweftError('invalid_permission_answers', '--answers 必须是 JSON 对象。'); }
            const result = await client().permission(id, options.round, options.request, options.decision, answers);
            output(result, `已响应：${result.request_id} · ${result.decision}\n后续结果请查看或等待任务。`);
        });
    task.command('show <id>').description('查看任务事实与报告').option('--round <id>', '历史轮次').option('--offset <n>', '报告字符偏移', '0').option('--limit <n>', '报告最多字符数', '16000')
        .action(async (id, options) => {
            const result = await client().read(id, { roundId: options.round, offset: Number(options.offset), limit: Number(options.limit) });
            const permissions = Object.entries(result.permissions ?? {}).map(([requestId, request]) => `\n待审批：${requestId} · ${request.tool}\n参数：${JSON.stringify(request.arguments).slice(0, 1200)}\n`
                + `响应：runweft task permission ${id} --round ${result.round_id} --request ${requestId} --decision <approved|denied|abort>`).join('\n');
            output(result, taskText(result) + `\n原生会话：${result.session_id ?? '未建立'}\n执行关闭：${result.stop} · 收尾：${result.finish}`
                + (result.session_id ? `\nHAPI 详情：${targetUrl(context().config)}/sessions/${encodeURIComponent(result.session_id)}` : '') + permissions
                + (result.input_files?.paths.map(file => `\n输入 ${file.name}：${file.path}`).join('') ?? ''));
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
