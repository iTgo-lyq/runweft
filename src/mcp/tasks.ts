import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AgentClient } from '../agents/client';
import { TaskClient } from '../tasks/client';
import type { HostIdentity } from './identity';
import type { McpCallContext, McpTool } from './server';

// A retransmission of one native call is the same request; another call is new intent.
export function taskRequestId(identity: HostIdentity, operation: string): string {
    const bytes = createHash('sha256').update(JSON.stringify(['runweft', identity.host, identity.nativeSessionId, identity.callId, operation])).digest().subarray(0, 16);
    bytes[6] = (bytes[6]! & 0x0f) | 0x80; bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
const client = (context: McpCallContext) => new TaskClient(context.config, context.identity.cwd, context.identity);
const message = z.string().trim().min(1).max(200_000);
const id = z.uuid();
const recovery = '接受只表示已持久排队，不代表执行完成。接受响应不明确时先 list_agents 查询 request_id；用相同 request_id 和原参数重试，避免重复派生。';

function tool<S extends z.ZodObject>(name: string, description: string, input: S, readOnly: boolean,
    run: (args: z.output<S>, context: McpCallContext) => Promise<Record<string, unknown>>, timeoutMs = 60_000): McpTool {
    return { name, description, input, timeoutMs,
        annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, openWorldHint: true },
        // createMcpServer validates this exact schema before invoking the handler.
        run: (args, context) => run(args as z.output<S>, context) };
}

export function taskTools(): McpTool[] {
    return [
        tool('list_agent_definitions', '查看当前工作区有效的 Agent 定义及各自 runtime 可选状态。不会启动任务；派生用返回的定义 id 作为 agent_type。', z.strictObject({}), true,
            async (_, c) => new AgentClient(c.config, c.identity.cwd).list(c.signal)),
        tool('spawn_agent', `在当前工作目录派生 Agent，立即返回 agent_id、round_id、request_id 和 revision。支持本机 shared 或 worktree；shared 写入由主 agent 协调，worktree 从已提交 HEAD 准备独立目录并封存成果。${recovery}`,
            z.strictObject({ agent_type: z.string().min(1), message, request_id: id.optional(), workspace_mode: z.string().default('shared') }), false,
            async (args, c) => client(c).spawn(args.agent_type, args.message, args.request_id ?? taskRequestId(c.identity, 'spawn'), args.workspace_mode, c.signal)),
        tool('list_agents', '列出当前原生父会话的子任务、状态、报告和最近接受的 request_id/round_id。用于恢复不明确的接受响应；不列出其他父会话的任务。', z.strictObject({}), true,
            async (_, c) => client(c).list(false, c.signal)),
        tool('read_agent', '读取子任务的轮次状态、报告、原生引用和待处理审批。默认最新接受轮次；长报告按 offset/limit 分页。执行完成与合码验收分别判断。',
            z.strictObject({ id, round_id: id.optional(), offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(64_000).optional() }), true,
            async (args, c) => client(c).read(args.id, { roundId: args.round_id, offset: args.offset, limit: args.limit }, c.signal)),
        tool('wait', '等待任一子任务完成或需要处理，返回状态及有界报告。默认观察最新接受轮次；after_revision 按任务 ID 传上次 revision 以消费新结果。超时返回 timed_out=true；取消等待不会中断任务。',
            z.strictObject({ ids: z.array(id).min(1).max(8), timeout_ms: z.number().int().min(0).max(540_000).default(30_000),
                after_revision: z.record(id, z.number().int().min(0)).optional() }), true,
            async (args, c) => client(c).wait(args.ids, args.timeout_ms, args.after_revision, c.signal), 570_000),
        tool('send_input', `给已有子任务追加消息。next 默认串行排下一轮并复用 session；steer 必须指定活跃 round_id，仅 Codex 支持，实际投递状态从 read_agent 查看。${recovery}`,
            z.strictObject({ id, message, mode: z.enum(['next', 'steer']).default('next'), round_id: id.optional(), request_id: id.optional() }), false,
            async (args, c) => client(c).send(args.id, args.message, args.request_id ?? taskRequestId(c.identity, 'send'), { mode: args.mode, roundId: args.round_id }, c.signal)),
        tool('interrupt_agent', '请求取消指定 round_id 并关闭该轮子执行；不影响其他轮次。requested 不代表已经停止，用 read_agent/wait 确认。',
            z.strictObject({ id, round_id: id }), false,
            async (args, c) => client(c).interrupt(args.id, args.round_id, c.signal)),
        tool('respond_to_permission', '响应 read_agent 中当前轮次的真实原生审批，须给出 round_id 和原生 request_id；decision 为 approved/denied/abort，可带原生 answers。不会更改默认权限模式。',
            z.strictObject({ id, round_id: id, request_id: z.string().min(1), decision: z.enum(['approved', 'denied', 'abort']),
                answers: z.union([z.record(z.string(), z.array(z.string())), z.record(z.string(), z.strictObject({ answers: z.array(z.string()) }))]).optional() }), false,
            async (args, c) => client(c).permission(args.id, args.round_id, args.request_id, args.decision, args.answers, c.signal)),
    ];
}
