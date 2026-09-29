import { lstat, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { z } from 'zod';
import { ArtifactNameSchema } from '../../hapi/shared/src/artifacts';
import { ArtifactClient } from '../artifacts/client';
import { RunweftError, errorDetails } from '../errors';
import { hapiClient } from '../hapi';
import type { McpCallContext, McpTool } from './server';
import { taskRequestId, tool } from './tool';

/** Resolve existing links, including ancestors of a new destination, before file I/O. */
export async function workspaceFile(cwd: string, input: string, writing = false): Promise<string> {
    const root = await realpath(cwd);
    const check = (path: string) => {
        const part = relative(root, path);
        if (part === '..' || part.startsWith('../') || isAbsolute(part)) {
            throw new RunweftError('artifact_path_outside_workspace', 'MCP 文件路径必须位于当前宿主工作目录内。', '先将文件放到工作目录；显式操作目录外文件可使用 Runweft CLI。');
        }
        return path;
    };
    const path = check(resolve(root, input));
    if (!writing) return check(await realpath(path));
    let ancestor = path;
    while (true) {
        const stat = await lstat(ancestor).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
        if (stat) return check(resolve(check(await realpath(ancestor)), relative(ancestor, path)));
        ancestor = dirname(ancestor);
    }
}

const client = (c: McpCallContext) => new ArtifactClient(hapiClient(c.config));
export function artifactTools(): McpTool[] {
    return [
        tool('upload_artifact', '将当前宿主工作目录内的单个普通文件上传到中心，返回对象 ID、名称、大小和 SHA-256，不返回文件内容。目录请先自行打包。request_id 可显式指定；响应不明先用 read_artifact 按原 request_id 查询，重试使用相同 ID 和原文件。传输按 60 秒无进展中止，可取消，没有固定总传输时限。',
            z.strictObject({ path: z.string().min(1), name: ArtifactNameSchema.optional(), request_id: z.uuid().optional() }), false,
            async (args, c) => {
                const requestId = args.request_id ?? taskRequestId(c.identity, 'artifact-upload');
                const path = await workspaceFile(c.identity.cwd, args.path);
                try {
                    return { request_id: requestId, artifact: await client(c).upload(path, requestId, { name: args.name ?? basename(args.path), signal: c.signal }) };
                } catch (error) {
                    const details = errorDetails(error);
                    throw new RunweftError(details.code, details.message, `${details.hint ?? ''} 使用 read_artifact(request_id="${requestId}") 查询原上传；需重试时保持同一 ID 和原文件。`.trim());
                }
            }, null),
        tool('read_artifact', '查询中心文件的元数据及是否可下载，不读取二进制内容。id 与 request_id 必须且只能传一个；request_id 用于核对上传响应不明的原操作。',
            z.strictObject({ id: z.uuid().optional(), request_id: z.uuid().optional() }).refine(args => !!args.id !== !!args.request_id), true,
            async (args, c) => ({ artifact: args.id ? await client(c).show(args.id, c.signal) : await client(c).lookup(args.request_id!, c.signal) })),
        tool('download_artifact', '将中心已发布文件下载到当前宿主工作目录内的指定文件路径，校验长度和 SHA-256 后原子保存。path 是文件而非目录；目标已存在默认拒绝，只有明确替换才设 overwrite=true。返回保存路径与元数据，不把文件内容放入上下文。传输可取消，按 60 秒无进展中止，没有固定总传输时限。',
            z.strictObject({ id: z.uuid(), path: z.string().min(1), overwrite: z.boolean().default(false) }), false,
            async (args, c) => client(c).download(args.id, await workspaceFile(c.identity.cwd, args.path, true), { overwrite: args.overwrite, signal: c.signal }), null),
    ];
}
