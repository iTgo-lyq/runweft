import type { Command } from 'commander';
import { z } from 'zod';
import type { Artifact } from '../../hapi/shared/src/artifacts';
import type { ResolvedConfig } from '../config';
import { hapiClient } from '../hapi';
import { RunweftError } from '../errors';
import { ArtifactClient, type TransferProgress } from './client';

function text(file: Artifact) { return `${file.id} · ${file.state}\n${file.filename} · ${file.size} 字节\nSHA-256：${file.sha256}\n请求 ID：${file.requestId}`; }
async function transfer<T>(program: Command, action: (signal: AbortSignal, progress: TransferProgress) => Promise<T>) {
    const cancel = new AbortController(), stop = () => cancel.abort();
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    let last = 0;
    try {
        return await action(cancel.signal, (bytes, total) => {
            if (Date.now() - last < 1000 && bytes !== total) return;
            last = Date.now();
            console.error(program.optsWithGlobals().json ? JSON.stringify({ event: 'artifact_transfer', bytes, total }) : `已传输 ${bytes} / ${total} 字节`);
        });
    } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}
export function addArtifactCommands(program: Command, context: () => ResolvedConfig, output: (value: unknown, human: string) => void,
    client = () => new ArtifactClient(hapiClient(context()))) {
    const command = program.command('artifact').description('上传、下载与管理当前中心的持久文件；无需活跃 agent');
    command.command('limits').description('查看服务端文件限制与 namespace 用量').action(async () => {
        const result = await client().limits(); output(result, `单文件：${result.limits.maxFileBytes} 字节\n已预约/保留：${result.usedBytes} / ${result.limits.namespaceQuotaBytes} 字节\n已发布：${result.usage.availableBytes} 字节；待上传：${result.usage.reservedBytes} 字节；删除中：${result.usage.deletingBytes} 字节\n引用保留：${result.usage.referencedCount} 个对象 / ${result.usage.referencedBytes} 字节\n未引用文件按发布时间满 ${result.limits.unreferencedDays} 天、未引用预约按创建时间满 ${result.limits.pendingHours} 小时可清理。\n这些限制来自当前所连服务；用 artifact prune 预览。`);
    });
    command.command('prune').description('预览已过期且无引用的文件；--apply 才删除字节')
        .option('--apply', '实际删除本页仍满足清理条件的对象').option('--limit <n>', '每页数量，最多 200', '100')
        .option('--after <cursor>', '上页返回的 nextCursor').action(async options => {
            const result = await client().prune({ apply: !!options.apply, limit: Number(options.limit), after: options.after });
            const bytes = result.candidates.reduce((sum, file) => sum + file.size, 0);
            output(result, `${result.applied ? '已执行清理' : '清理预览，尚未删除'}：本页 ${result.candidates.length} 个候选 / ${bytes} 字节\n`
                + result.candidates.map(file => `${file.id} · ${file.filename} · ${file.state} · ${file.size} 字节`).join('\n')
                + `\n已删除 ${result.deleted.length} 个，未处理 ${result.failures.length} 个；当前预约/保留 ${result.usedBytes} 字节。`
                + result.failures.map(item => `\n${item.id} · ${item.error.code}: ${item.error.message}`).join('')
                + (result.nextCursor ? `\n下一页：runweft artifact prune --after ${result.nextCursor}${result.applied ? ' --apply' : ''}` : '')
                + (!result.applied ? '\n确认此页后以相同参数加 --apply 执行；执行时重新检查引用和期限。' : ''));
            if (result.failures.length) process.exitCode = 1;
        });
    command.command('upload <path>').description('流式上传一个文件，校验并发布后返回稳定 ID')
        .option('--name <filename>', '显示文件名，默认源文件名').option('--request-id <uuid>', '重试同一内容时复用请求 ID')
        .action(async (path, options) => {
            const requestId = options.requestId ?? crypto.randomUUID();
            if (!z.uuid().safeParse(requestId).success) throw new RunweftError('invalid_request_id', 'request ID 必须为 UUID。');
            console.error(program.optsWithGlobals().json ? JSON.stringify({ event: 'artifact_request', request_id: requestId })
                : `请求 ID：${requestId}\n响应不明确时先运行 runweft artifact lookup ${requestId}；重试请带相同 --request-id。`);
            const result = await transfer(program, (signal, progress) => client().upload(path, requestId, { name: options.name, signal, progress }));
            output(result, `文件已发布：\n${text(result)}`);
        });
    command.command('show <id>').description('查看对象状态和完整性信息').action(async id => { const result = await client().show(id); output(result, text(result)); });
    command.command('lookup <request-id>').description('按原请求 ID 查询上传接受/发布结果').action(async requestId => { const result = await client().lookup(requestId); output(result, text(result)); });
    command.command('list').description('列出当前 namespace 文件与删除记录').option('--offset <n>', '分页偏移', '0').option('--limit <n>', '每页数量，最多 200', '50')
        .action(async options => { const result = await client().list(Number(options.offset), Number(options.limit)); output(result,
            result.artifacts.map(text).join('\n\n') + (result.nextOffset === null ? '' : `\n下一页：runweft artifact list --offset ${result.nextOffset}`) || '尚无文件。'); });
    command.command('download <id>').description('校验后保存到目标；默认不覆盖')
        .requiredOption('--output <path>', '保存位置').option('--overwrite', '明确替换已有目标文件')
        .action(async (id, options) => {
            const result = await transfer(program, (signal, progress) => client().download(id, options.output, { overwrite: options.overwrite, signal, progress }));
            output(result, `已校验并保存：${result.path}\n${text(result.artifact)}`);
        });
    command.command('refs <id>').description('查看阻止文件清理的留存引用').action(async id => {
        const result = await client().refs(id); output(result, result.references.map(ref => `${ref.purpose} · ${ref.reference}`).join('\n') || '没有留存引用。');
    });
    command.command('remove <id>').description('删除无引用文件；保留请求墓碑，不可用同一请求复活').action(async id => {
        const result = await client().remove(id); output(result, `文件字节已删除：${result.id}\n请求与完整性记录保留。`);
    });
}
