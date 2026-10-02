import type { Command } from 'commander';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ResolvedConfig } from '../config';
import { RunweftError } from '../errors';
import { type PreparationView } from './types';
import type { HubPreparationClient } from '../hub/delegation/client';

const phases: Record<string, string> = { exporting: '固定基线导出中', uploading: '中心发布中', importing: '目标导入中', preparing: '工作树准备中', ready: '已就绪', failed: '失败', unknown: '等待原操作确认', releasing: '释放中', released: '已释放' };
const stages: Record<string, string> = { export: '固定基线导出', publish: '中心文件发布', download: '目标下载', import: '目标缓存导入', worktree: '独立工作树准备', complete: '准备完成', release_worktree: '检查并移除诊断工作树', release_baseline: '释放缓存与恢复引用', released: '释放完成' };
export function preparationText(view: PreparationView) {
    return `${view.id} · ${view.release?.status === 'failed' ? '释放未完成' : phases[view.phase] ?? view.phase}\n阶段：${stages[view.stage]}\n请求 ID：${view.requestId}\nAgent：${view.agent.id} · ${view.agent.flavor}\n目标机器：${view.target.machineId}`
        + `\n固定基线：${view.origin.baseCommit}\n来源：${view.origin.baseRef} · ${view.origin.relativePath || '仓库根目录'}${view.origin.dirty ? '（未提交内容已排除）' : ''}`
        + `\n基线：${view.snapshot.id} · 第 ${view.snapshot.generation} 代${view.transfer.snapshotReused ? '（复用已发布快照）' : ''}`
        + (view.transfer.known ? `\n文件：${view.transfer.files}；需上传 ${view.transfer.uploadBytes} 字节，复用 ${view.transfer.reusedBytes} 字节；中心已发布 ${view.transfer.publishedBytes}/${view.transfer.totalBytes} 字节` : '\n文件清单和大小尚在生成中。')
        + (view.workspace ? `\n工作目录：${view.workspace.cwd}\n分支：${view.workspace.branch}` : '')
        + (view.release ? `\n工作树：${view.release.environmentRemoved ? '已移除或未创建' : '保留'}；恢复基线：${view.snapshot.retention}` : '')
        + (view.target.cache?.retained ? `\n共享缓存保留：${view.target.cache.reason?.message ?? view.target.cache.directory}` : '')
        + (view.error ? `\n需处理：${view.error.message}${view.error.hint ? `\n${view.error.hint}` : ''}` : '')
        + view.cleanup.errors.map(error => `\n中间副本清理待处理：${error!.message}`).join('')
        + `\n${view.next}`;
}
export function addPreparationCommands(workspace: Command, program: Command, context: () => ResolvedConfig, output: (value: unknown, human: string) => void,
    hubClient: () => HubPreparationClient) {
    const client = hubClient;
    const prepare = workspace.command('prepare').description('诊断远端 Git 环境；固定基线并准备 worktree，不启动模型')
        .requiredOption('--base <ref>', '明确已提交基线，可用 HEAD；排除未提交内容')
        .option('--request-id <uuid>', '响应丢失时以相同 ID 和参数重试')
        .action(async options => {
            const requestId = options.requestId ?? randomUUID();
            if (!z.uuid().safeParse(requestId).success) throw new RunweftError('invalid_request_id', 'request ID 必须是 UUID。');
            console.error(program.optsWithGlobals().json ? JSON.stringify({ event: 'workspace_request', request_id: requestId }) : `请求 ID：${requestId}（响应丢失时使用 --request-id ${requestId} 重试相同准备）`);
            const preparation = await client().prepare(options.agent, options.base, requestId, { runtimeId: options.runtime, remote: options.remote });
            output({ preparation }, preparationText(preparation));
        });
    prepare.option('--agent <id>', '显式 Agent UUID；省略使用本人默认选择').option('--runtime <id>', '显式 runtime UUID').option('--remote <name>', '明确 fetch remote');
    workspace.command('preparations').description('列出当前目录的远端诊断准备').option('--all', '查看当前身份/空间全部准备记录')
        .action(async options => { const preparations = await client().list(!!options.all); output({ preparations }, preparations.length ? preparations.map(item => `${item.id} · ${phases[item.phase]} · ${item.agent.id} · ${item.origin.baseCommit.slice(0, 12)}`).join('\n') : '尚无远端准备记录。需要检查远端环境时运行 workspace prepare --agent <name> --base <ref>。'); });
    workspace.command('inspect <id>').description('查询原准备的基线、进度、工作目录和错误')
        .action(async id => { const preparation = await client().inspect(id); output({ preparation }, preparationText(preparation)); });
    workspace.command('release <id>').description('释放诊断 worktree 及其基线引用；有未回收改动时保留')
        .option('--discard-ignored', '明确允许丢弃 ignored 依赖和文件；仍拒绝未封存代码')
        .action(async (id, options) => { const preparation = await client().release(id, !!options.discardIgnored); output({ preparation }, preparationText(preparation)); });
}
