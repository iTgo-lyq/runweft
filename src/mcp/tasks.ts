import { z } from 'zod';
import { AgentClient } from '../agents/client';
import { TaskClient } from '../tasks/client';
import { ArtifactOutputsSchema } from '../../hapi/shared/src/artifactTransfers';
import { ArtifactInputSchema } from '../tasks/types';
import { taskRequestId, tool } from './tool';
import type { McpCallContext, McpTool } from './server';

const client = (context: McpCallContext) => new TaskClient(context.config, context.identity.cwd, context.identity);
const message = z.string().trim().min(1).max(200_000);
const id = z.uuid();
const files = { inputs: z.array(ArtifactInputSchema).max(100).optional(), outputs: ArtifactOutputsSchema.optional() };
const fileHelp = 'inputs 为 {artifactId:上传结果 artifact.id,name?:输入名} 数组；outputs 为 {name,relativePath} 数组，声明工作区内的文件。输入准备完成后才启动，输出在原生停止后收集；worktree 中未忽略的输出也会进入 Git 成果。';
const resultAction = async (context: McpCallContext, id: string, roundId: string | undefined, requestId: string, action: 'fetch' | 'retry') => {
    const result = await client(context).resultAction(id, roundId, requestId, action, context.signal);
    const { manifests, fetches, ...summary } = result;
    const fetch = fetches.find(item => item.id === result.result_operation_id);
    return { ...summary, fetch: fetch ? { id: fetch.id, status: fetch.status, ref: fetch.fetched?.ref ?? fetch.localRef,
        head: fetch.fetched?.head, error: fetch.error, cleanup_error: fetch.cleanupError } : undefined };
};
const recovery = '接受只表示已持久排队，不代表执行完成。接受响应不明确时先 list_agents 查询 request_id；用相同 request_id 和原参数重试，避免重复派生。';

export function taskTools(): McpTool[] {
    return [
        tool('list_agent_definitions', '查看当前工作区有效的 Agent 定义及各自 runtime 可选状态。不会启动任务；派生用返回的定义 id 作为 agent_type。', z.strictObject({}), true,
            async (_, c) => new AgentClient(c.config, c.identity.cwd).list(c.signal)),
        tool('spawn_agent', `在当前工作目录派生 Agent，立即返回 agent_id、round_id、request_id 和 revision。支持本机 shared 和本机/远端 worktree；shared 写入由主 agent 协调。worktree 要求主工作区受 Git 管理；本机 base_ref 默认 HEAD，远端必须明确指定，接受时冻结为 commit；不包含主目录未提交内容，准备完成后才启动，每轮停止后封存成果。base_ref 仅用于 worktree。${fileHelp}${recovery}`,
            z.strictObject({ agent_type: z.string().min(1), message, request_id: id.optional(), workspace_mode: z.string().default('shared'), base_ref: z.string().trim().min(1).optional(), ...files }), false,
            async (args, c) => client(c).spawn(args.agent_type, args.message, args.request_id ?? taskRequestId(c.identity, 'spawn'), args.workspace_mode, c.signal, args.base_ref, args.inputs, args.outputs)),
        tool('list_agents', '列出当前原生父会话的子任务、状态、报告和最近接受的 request_id/round_id。用于恢复不明确的接受响应；不列出其他父会话的任务。', z.strictObject({}), true,
            async (_, c) => client(c).list(false, c.signal)),
        tool('read_agent', '读取子任务的轮次状态、报告、原生引用和待处理审批。独立工作区返回准备状态、base/start/result SHA、成果 ref 和目录留存状态；Git 收尾失败时保留原生报告。input_files 给出实际输入与副本留存，artifacts 给出文件交付状态、清单和待处理操作，成功项的 artifactId 可用 download_artifact 下载；文件交付失败不改写原生结论。默认最新接受轮次；长报告按 offset/limit 分页。同仓库成果可从 ref 审查合入，合码和冲突由主 agent 处理。',
            z.strictObject({ id, round_id: id.optional(), offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(64_000).optional() }), true,
            async (args, c) => client(c).read(args.id, { roundId: args.round_id, offset: args.offset, limit: args.limit }, c.signal)),
        tool('wait', '等待任一子任务完成或需要处理，返回状态及有界报告。worktree 在原生执行停止、Git 封存及首次代码交付确定后才完成；workspace attention 要先处理，不能当作已交付。默认观察最新接受轮次；after_revision 按任务 ID 传上次 revision 以消费新结果。代码补交与取回通过 code_revision 通知；文件交付或补交通过 artifacts_revision 通知；artifacts attention 使用 retry_artifacts/collect_artifacts 处理。超时返回 timed_out=true；取消等待不会中断任务。',
            z.strictObject({ ids: z.array(id).min(1).max(8), timeout_ms: z.number().int().min(0).max(540_000).default(30_000),
                after_revision: z.record(id, z.number().int().min(0)).optional() }), true,
            async (args, c) => client(c).wait(args.ids, args.timeout_ms, args.after_revision, c.signal), 570_000),
        tool('send_input', `给已有子任务追加消息。next 默认串行排下一轮并复用 session；steer 必须指定活跃 round_id，仅 Codex 支持，实际投递状态从 read_agent 查看。只有 next 接受本轮 inputs/outputs，不自动沿用上一轮文件声明；steer 不接受附件。${fileHelp}${recovery}`,
            z.strictObject({ id, message, mode: z.enum(['next', 'steer']).default('next'), round_id: id.optional(), request_id: id.optional(), ...files }), false,
            async (args, c) => client(c).send(args.id, args.message, args.request_id ?? taskRequestId(c.identity, 'send'), { mode: args.mode, roundId: args.round_id, inputs: args.inputs, outputs: args.outputs }, c.signal)),
        tool('interrupt_agent', '请求取消指定 round_id 并关闭该轮子执行；不影响其他轮次。requested 不代表已经停止，用 read_agent/wait 确认。',
            z.strictObject({ id, round_id: id }), false,
            async (args, c) => client(c).interrupt(args.id, args.round_id, c.signal)),
        tool('retry_finish', '修复 Git 收尾错误后，显式重试指定 round_id 的成果封存；不会重新启动模型或发送任务。仅用于 read_agent 返回的 Git needs_attention；未知或进行中的操作先查询原回执，不能重复 commit/hook。返回重试受理后，用 read_agent/wait 确认封存。',
            z.strictObject({ id, round_id: id }), false,
            async (args, c) => client(c).retryFinish(args.id, args.round_id, c.signal)),
        tool('fetch_result', '将指定轮次的完整代码对象和成果引用取回原主仓库，不合并、不改变工作文件。省略 round_id 时固定最新接受轮次；尚未就绪返回当前状态，不取旧成果。request_id 可用于丢回执后查询同一操作；用 read_agent 查看 code.fetch、ref 和下一步。',
            z.strictObject({ id, round_id: id.optional(), request_id: id.optional() }), false,
            async (args, c) => resultAction(c, args.id, args.round_id, args.request_id ?? taskRequestId(c.identity, 'result-fetch'), 'fetch')),
        tool('retry_result', '重试指定轮次的 Git/子模块/LFS 代码交付；不重跑模型或再次封存。候选固定后仅推进传输；unknown 先核对原操作。普通声明附件用 retry_artifacts。返回受理后用 read_agent/wait 查看 code 与 code_revision。',
            z.strictObject({ id, round_id: id, request_id: id.optional() }), false,
            async (args, c) => resultAction(c, args.id, args.round_id, args.request_id ?? taskRequestId(c.identity, 'result-retry'), 'retry')),
        tool('retry_artifacts', '重试指定已结束轮次的文件交付，只上传已捕获候选，不重新读取工作区、不重启模型。缺失文件须显式 collect_artifacts。返回受理后用 read_agent/wait 查询；响应不明先 list_agents 查询原 request_id，再 read_agent 查看 artifacts.pending；保持相同 ID 和参数重试。',
            z.strictObject({ id, round_id: id, request_id: id.optional() }), false,
            async (args, c) => client(c).artifactAction(args.id, args.round_id, args.request_id ?? taskRequestId(c.identity, 'artifacts-retry'), 'retry', undefined, c.signal)),
        tool('collect_artifacts', '在任务全部轮次与文件操作静止后，补收指定工作区文件，files 为 {name,relativePath} 数组。产生新捕获时间和不可变清单版本，不修改旧对象、不重启模型。返回受理后用 read_agent/wait 查询；响应不明先 list_agents 查询原 request_id，再 read_agent 查看 artifacts.pending；保持相同 ID 和参数重试。',
            z.strictObject({ id, round_id: id, request_id: id.optional(), files: ArtifactOutputsSchema }), false,
            async (args, c) => client(c).artifactAction(args.id, args.round_id, args.request_id ?? taskRequestId(c.identity, 'artifacts-collect'), 'collect', args.files, c.signal)),
        tool('respond_to_permission', '响应 read_agent 中当前轮次的真实原生审批，须给出 round_id 和原生 request_id；decision 为 approved/denied/abort，可带原生 answers。不会更改默认权限模式。',
            z.strictObject({ id, round_id: id, request_id: z.string().min(1), decision: z.enum(['approved', 'denied', 'abort']),
                answers: z.union([z.record(z.string(), z.array(z.string())), z.record(z.string(), z.strictObject({ answers: z.array(z.string()) }))]).optional() }), false,
            async (args, c) => client(c).permission(args.id, args.round_id, args.request_id, args.decision, args.answers, c.signal)),
    ];
}
