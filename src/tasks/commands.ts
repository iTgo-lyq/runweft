import type { Command } from 'commander';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { type ResolvedConfig } from '../config';
import { ArtifactOutputsSchema, type ArtifactOutput } from '../../hapi/shared/src/artifactTransfers';
import type { OutputManifest } from './output-types';
import { RunweftError } from '../errors';
import { openBrowser } from '../browser';
import { HubClient } from '../hub/client';
import { ArtifactInputSchema, parseTask, type ArtifactInput } from './types';
import type { HubTaskClient } from '../hub/delegation/client';
import type { overview } from './views';

type Summary = ReturnType<typeof overview>;
function taskText(task: Pick<Summary, 'agent_id' | 'round_id' | 'status' | 'attention' | 'report' | 'git'> & { code?: Summary['code']; artifacts?: Summary['artifacts']; input_files?: { status: string; count?: number; files?: ArtifactInput[] } | null }) {
    return `${task.agent_id} · ${task.status}\n轮次：${task.round_id}`
        + (task.input_files && task.input_files.status !== 'none' ? `\n输入文件：${task.input_files.count ?? task.input_files.files?.length ?? 0} · ${task.input_files.status}` : '')
        + (task.attention ? `\n需处理：${task.attention.message}${task.attention.hint ? `\n${task.attention.hint}` : ''}` : '')
        + (task.git === 'not_applicable' ? '' : `\nGit：${task.git.status}${task.git.checkout ? ` · ${task.git.checkout}` : ''}`
            + `\n工作区：${task.git.retained}`
            + (task.git.removal?.error ? `\n清理需处理：${task.git.removal.error.message}${task.git.removal.error.hint ? `\n${task.git.removal.error.hint}` : ''}` : '')
            + (task.git.remote?.release ? `\n目标缓存与输入基线：${task.git.remote.release.state}${task.git.remote.release.error ? ` · ${task.git.remote.release.error.message}` : ''}` : '')
            + (task.git.result_ref && !task.git.remote ? `\n成果引用：${task.git.result_ref}\n查看修改：git diff ${task.git.start_head} ${task.git.result_head}\n在主仓库目标分支审查并选择 merge 或 cherry-pick。` : ''))
        + (task.code && task.git !== 'not_applicable' && task.git.remote ? `\n代码成果：${task.code.status}${task.code.next ? `\n下一步：${task.code.next.command}` : ''}` : '')
        + (task.artifacts && task.artifacts.status !== 'none' ? `\n成果文件：${task.artifacts.status}${task.artifacts.manifest ? ` · 版本 ${task.artifacts.manifest.version}` : ''}\n查看清单：runweft task artifacts show ${task.agent_id} --round ${task.round_id}` : '')
        + (task.artifacts?.retention.state !== undefined && task.artifacts.retention.state !== 'retained' ? `\n附件留存：${task.artifacts.retention.state}；历史清单不保证文件仍可下载。` : '')
        + (task.report.text ? `\n${task.report.text}` : '')
        + (task.report.next_offset !== null ? `\n后续内容：runweft task show ${task.agent_id} --round ${task.round_id} --offset ${task.report.next_offset}` : '');
}
export function taskInputs(values: string[] = []): ArtifactInput[] {
    return values.map(value => {
        const split = value.lastIndexOf('=');
        return parseTask(ArtifactInputSchema, { artifactId: value.slice(split + 1), ...(split < 0 ? {} : { name: value.slice(0, split) }) });
    });
}
export function taskOutputs(values: string[] = []): ArtifactOutput[] | undefined {
    if (!values.length) return;
    return parseTask(ArtifactOutputsSchema, values.map(value => {
        const split = value.indexOf('='), relativePath = split < 0 ? value : value.slice(split + 1);
        return { relativePath, name: split < 0 ? relativePath.split('/').at(-1) : value.slice(0, split) };
    }));
}
function manifestText(manifest: OutputManifest) {
    return `版本 ${manifest.version} · ${manifest.status} · ${new Date(manifest.createdAt).toISOString()}\n`
        + manifest.items.map(item => `${item.name} · ${item.status} · ${item.relativePath}`
            + (item.artifactId ? `\n  下载：runweft artifact download ${item.artifactId} --output <目标路径>` : `\n  ${item.error?.message ?? '尚未交付'}`)).join('\n');
}
const addInput = (value: string, values: string[]) => [...values, value];
export function taskMessage(options: { message?: string; messageFile?: string }) {
    if ((options.message !== undefined) === (options.messageFile !== undefined)) throw new RunweftError('task_message_required', '请指定 --message 或 --message-file，两者选一个。');
    return options.message ?? readFileSync(options.messageFile === '-' ? 0 : options.messageFile!, 'utf8');
}
export function announceRequest(program: Command, requested?: string) {
    const id = requested ?? randomUUID();
    if (!z.uuid().safeParse(id).success) throw new RunweftError('invalid_request_id', 'request ID 必须是 UUID。');
    console.error(program.optsWithGlobals().json ? JSON.stringify({ event: 'task_request', request_id: id }) : `请求 ID：${id}（响应丢失时使用 --request-id ${id} 重试相同任务）`);
    return id;
}
export function addTaskCommands(program: Command, context: () => ResolvedConfig, output: (value: unknown, human: string) => void,
    hub: { client: () => HubTaskClient; url: () => string }) {
    const client = hub.client;
    function taskUrl(id:string,roundId?:string,spaceId?:string|null){
        parseTask(z.uuid(),id);if(roundId)parseTask(z.uuid(),roundId);
        const target=new URL('/hub',hub.url());
        const space=spaceId??new HubClient({url:hub.url(),home:context().home,space:program.optsWithGlobals().space},'hubAccounts','hub_accounts_unavailable').spaceId;
        if(!space)throw new RunweftError('hub_space_required','请先选择当前 Hub 空间。');
        target.hash=new URLSearchParams({space,task:id,...(roundId?{round:roundId}:{})}).toString();return target.toString();
    }
    const task = program.command('task').description('派生、续接与控制本机共享或本机/远端独立任务');
    task.command('open <id>').description('打开指定任务的 Hub 详情；登录后恢复定位').option('--round <id>','指定历史轮次').option('--print','只输出无凭据链接')
        .action(async(id,options)=>{const url=taskUrl(id,options.round);if(!options.print)await openBrowser(url);output({url,opened:!options.print},url);});
    task.command('workspace').description('管理保留的独立工作区').command('remove <id>').description('显式删除已结束任务的工作区；远端需已交付或明确放弃代码')
        .option('--discard-ignored', '明确丢弃 ignored 依赖和文件；默认存在时拒绝删除')
        .action(async (id, options) => {
            const result = await client().removeWorkspace(id, !!options.discardIgnored);
            output(result, `${result.environment.mode === 'worktree' && result.environment.status === 'removed' ? '工作区已移除。' : `已请求删除工作区：${id}；完成前不接受新轮次。`}`
                + '\n报告、中心成果及已取回的主仓库引用保留；远端自有 Git 引用随环境释放，本机成果引用保留。'
                + `\n查询工作区及缓存释放：runweft task show ${id}`);
        });
    const result = task.command('result').description('查看、取回或重试独立工作区代码成果');
    const resultText = (value: Awaited<ReturnType<HubTaskClient['result']>>) => {
        const fetch = value.fetches.at(-1), ref = fetch?.fetched?.ref ?? fetch?.localRef ?? value.code.ref;
        return `代码成果：${value.code.status}\n轮次：${value.round_id}`
            + (value.code.bytes ? `\n传输：上传 ${value.code.bytes.uploaded} 字节，复用 ${value.code.bytes.reused} 字节；中心保留 ${value.code.bytes.retained} 字节` : '')
            + (fetch ? `\n取回：${fetch.status} · ${fetch.id}` : '')
            + (value.code.error ? `\n${value.code.error.message}\n${value.code.error.hint ?? ''}` : '')
            + (fetch?.error ? `\n${fetch.error.message}\n${fetch.error.hint ?? ''}` : '')
            + (ref ? `\n成果引用：${ref}\n查看修改：git diff ${value.code.result?.startHead} ${ref}\n审查后自行 merge 或 cherry-pick。` : '')
            + (value.code.next ? `\n下一步：${value.code.next.command}` : '')
            + (fetch && !['available', 'failed'].includes(fetch.status) ? `\n查询取回：runweft task result show ${value.agent_id} --round ${value.round_id}` : '');
    };
    result.command('show <id>').option('--round <id>', '指定轮次；省略时显示最新接受轮次')
        .action(async (id, options) => { const value = await client().result(id, options.round); output(value, resultText(value)); });
    for (const action of ['fetch', 'retry'] as const) {
        const command = result.command(`${action} <id>`).description(action === 'fetch' ? '在原主仓库取回专用成果引用；不自动合入' : '只重试代码交付；不重新执行模型或封存')
            .option('--request-id <uuid>', '响应不明时以原 ID 和参数查询同一操作');
        if (action === 'retry') command.requiredOption('--round <id>', '指定需要重试的轮次');
        else command.option('--round <id>', '指定轮次；省略时固定最新接受轮次');
        command.action(async (id, options) => {
            const value = await client().resultAction(id, options.round, announceRequest(program, options.requestId), action);
            output(value, resultText(value));
        });
    }
    result.command('release <id>').description('预览代码成果留存；--apply 才释放，不删除工作区或主仓库成果')
        .option('--round <id>', '只释放指定轮次；省略时选择已停止或收尾中的轮次')
        .option('--apply', '保存并执行释放意图').option('--discard-pending', '明确放弃已停止但未完整交付的代码')
        .action(async (id, options) => {
            const value = await client().releaseResults(id, { roundId: options.round, apply: !!options.apply, discardPending: !!options.discardPending });
            output(value, `${value.applied ? '释放已受理' : '代码留存预览，尚未释放'}\n`
                + value.rounds.map(round => `${round.round_id} · ${round.state} · 本轮恢复引用 ${round.references.filter(item => !item.done).length} 个，副本操作 ${round.copies.filter(item => !item.done).length} 个`
                    + (round.unpublished ? round.discardPending ? '（明确放弃未交付代码）' : '（先 retry，或明确 --discard-pending）' : '')).join('\n')
                + (value.applied ? `\n查询：runweft task result show ${id}${options.round ? ` --round ${options.round}` : ''}` : '\n确认后以相同参数加 --apply。释放后不再承诺取回；其他轮次引用保留，文件字节仍按 artifact prune/remove 清理。'));
        });
    const artifacts = task.command('artifacts').description('查看成果版本、重传候选或显式补收文件');
    artifacts.command('show <id>').requiredOption('--round <id>', '指定业务轮次').option('--version <n>', '只查看某个不可变版本')
        .action(async (id, options) => {
            const result = await client().artifacts(id, options.round);
            const versions = options.version === undefined ? result.manifests : result.manifests.filter(item => item.version === Number(options.version));
            if (options.version !== undefined && !versions.length) throw new RunweftError('artifact_version_unknown', '没有指定清单版本。');
            output({ ...result, manifests: versions }, `附件留存：${result.retention.state}${result.retention.state === 'retained' ? '' : '（历史发布状态不保证当前仍可下载）'}\n`
                + (versions.map(manifestText).join('\n\n') || '本轮尚无成果清单。') + (result.pending.length ? `\n文件操作：${result.pending.map(job => job.phase).join(', ')}` : ''));
        });
    artifacts.command('release <id>').description('预览已结束轮次的附件留存；--apply 才释放，不删除报告或工作区')
        .option('--round <id>', '只释放指定轮次；省略时选择全部已结束轮次').option('--apply', '保存并执行释放意图')
        .option('--discard-pending', '明确放弃已确认停止但未交付的捕获候选')
        .action(async (id, options) => {
            const result = await client().releaseArtifacts(id, { roundId: options.round, apply: !!options.apply, discardPending: !!options.discardPending });
            output(result, `${result.applied ? '释放已受理' : '附件留存预览，尚未释放'}\n`
                + result.rounds.map(round => `${round.round_id} · ${round.state}\n  本轮引用 ${round.references.filter(item => !item.done).length} 个，本机副本操作 ${round.transfers.filter(item => !item.done).length} 个`
                    + (round.pendingCandidates.length ? `\n  未交付候选：${round.pendingCandidates.map(item => item.name).join('、')}${round.discardPending ? '（将显式放弃）' : '（先 retry，或明确 --discard-pending）'}` : '')).join('\n')
                + (result.applied ? `\n查询：runweft task show ${id}${options.round ? ` --round ${options.round}` : ''}` : '\n确认后以相同参数加 --apply 执行。中心文件还需 remove 或到期 prune 才删除字节；其他来源的引用保留。'));
        });
    for (const action of ['retry', 'collect'] as const) {
        const command = artifacts.command(`${action} <id>`).description(action === 'retry' ? '重传失败候选；不重读工作目录或执行模型' : '任务静止时捕获指定文件，发布新的成果版本')
            .requiredOption('--round <id>', '指定业务轮次').option('--request-id <uuid>', '重试同一文件操作时复用 ID');
        if (action === 'collect') command.requiredOption('--path <name=path|path>', '工作区内文件；可重复', addInput, []);
        command.action(async (id, options) => {
            const requestId = announceRequest(program, options.requestId);
            const accepted = await client().artifactAction(id, options.round, requestId, action, taskOutputs(options.path));
            output(accepted, `文件操作已接受：${accepted.artifact_operation_id}\n查看：runweft task artifacts show ${id} --round ${options.round}\n等待更新：runweft task wait ${id} --after-revision '${JSON.stringify({ [id]: accepted.revision })}' `);
        });
    }
    const spawn = task.command('spawn [agent]').description('接受新任务后立即返回；执行由服务继续推进')
        .option('--message <text>', '任务描述').option('--message-file <path>', '从文件读取任务；- 读取 stdin')
        .option('--request-id <uuid>', '相同请求重试时复用 ID').option('--workspace-mode <shared|worktree>', '共享当前目录或准备独立 Git worktree', 'shared')
        .option('--base <ref>', 'worktree 的已提交基线；本机默认 HEAD，远端必填；不包含未提交内容')
        .option('--input <name=id|id>', '使用已上传文件；可重复，默认采用对象文件名', addInput, [])
        .option('--output <name=path|path>', '声明工作区内成果文件；可重复，结束后自动交付', addInput, [])
        .action(async (agent, options) => {
            const message = taskMessage(options), id = announceRequest(program, options.requestId);
            const result = await client().spawn(agent, message, id, options.workspaceMode, undefined, options.base, taskInputs(options.input), taskOutputs(options.output),
                { runtimeId: options.runtime, remote: options.remote });
            output(result, `任务已接受：${result.agent_id}\n轮次：${result.round_id}\n原生执行尚待确认。\n等待：runweft task wait ${result.agent_id}`);
        });
    spawn.option('--runtime <id>', '本次显式 runtime UUID').option('--remote <name>', '显式选择工作区 fetch remote');
    task.command('list').description('列出当前发起目录的任务').option('--all', '查看当前身份/空间全部任务').action(async options => {
        const result = await client().list(options.all); output(result, result.agents.map(taskText).join('\n\n') || '尚无任务。用 runweft agent list 查看可选定义。');
    });
    task.command('send <id>').description('默认排队下一轮；--steer 追加到指定活跃 Codex 轮次')
        .option('--message <text>', '任务描述').option('--message-file <path>', '从文件读取任务；- 读取 stdin')
        .option('--input <name=id|id>', '下一轮的已上传输入文件；可重复，steer 不支持', addInput, [])
        .option('--output <name=path|path>', '下一轮的成果文件；可重复，steer 不支持', addInput, [])
        .option('--request-id <uuid>', '重试相同追加请求时复用 ID').option('--steer', '运行中追加，需 --round').option('--round <id>', 'steer 的目标轮次')
        .action(async (id, options) => {
            const message = taskMessage(options), request = announceRequest(program, options.requestId);
            const result = await client().send(id, message, request, { mode: options.steer ? 'steer' : 'next', roundId: options.round, inputs: taskInputs(options.input), outputs: taskOutputs(options.output) });
            output(result, `${options.steer ? '追加已接受，实际原生交付请查询任务' : '下一轮已排队'}：${result.agent_id}\n轮次：${result.round_id}\n输入：${result.input_id}\n查看：runweft task show ${result.agent_id} --round ${result.round_id}`);
        });
    task.command('interrupt <id>').description('取消指定轮次；已结束的轮次不影响后续执行').requiredOption('--round <id>', '固定业务轮次')
        .action(async (id, options) => {
            const result = await client().interrupt(id, options.round);
            output(result, result.status === 'already_finished' ? '指定轮次已结束；未中断其他轮次。' : result.status === 'execution_already_stopped' ? '原生执行已停止，正在完成成果收尾；未更改取消状态。' : `已请求取消轮次：${result.round_id}\n确认关闭前仍可查看状态：runweft task show ${id} --round ${result.round_id}`);
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
            const current=client();const result = await current.read(id, { roundId: options.round, offset: Number(options.offset), limit: Number(options.limit) });
            const permissions = Object.entries(result.permissions ?? {}).map(([requestId, request]) => `\n待审批：${requestId} · ${request.tool}\n参数：${JSON.stringify(request.arguments).slice(0, 1200)}\n`
                + `响应：runweft task permission ${id} --round ${result.round_id} --request ${requestId} --decision <approved|denied|abort>`).join('\n');
            output(result, taskText(result) + `\n原生会话：${result.session_id ?? '未建立'}\n执行关闭：${result.stop} · 收尾：${result.finish}`
                + `\nWeb 详情：${taskUrl(id,result.round_id,current.connection.spaceId)}` + permissions
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
