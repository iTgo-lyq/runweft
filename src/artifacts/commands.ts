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
            console.error(program.opts().json ? JSON.stringify({ event: 'artifact_transfer', bytes, total }) : `已传输 ${bytes} / ${total} 字节`);
        });
    } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}
export function addArtifactCommands(program: Command, context: () => ResolvedConfig, output: (value: unknown, human: string) => void) {
    const client = () => new ArtifactClient(hapiClient(context()));
    const command = program.command('artifact').description('上传、下载与管理当前中心的持久文件；无需活跃 agent');
    command.command('limits').description('查看服务端文件限制与 namespace 用量').action(async () => {
        const result = await client().limits(); output(result, `单文件：${result.limits.maxFileBytes} 字节\n已预约/保留：${result.usedBytes} / ${result.limits.namespaceQuotaBytes} 字节\n这些限制来自当前所连服务。`);
    });
    command.command('upload <path>').description('流式上传一个文件，校验并发布后返回稳定 ID')
        .option('--name <filename>', '显示文件名，默认源文件名').option('--request-id <uuid>', '重试同一内容时复用请求 ID')
        .action(async (path, options) => {
            const requestId = options.requestId ?? crypto.randomUUID();
            if (!z.uuid().safeParse(requestId).success) throw new RunweftError('invalid_request_id', 'request ID 必须为 UUID。');
            console.error(program.opts().json ? JSON.stringify({ event: 'artifact_request', request_id: requestId })
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
