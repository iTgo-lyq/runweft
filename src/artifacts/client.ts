import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, realpath, rename, rm, type FileHandle } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { ArtifactSchema, ArtifactReserveSchema, ArtifactLimitsSchema, ArtifactUsageSchema, ArtifactPruneSchema, ArtifactPruneResultSchema, type ArtifactPrune, type Artifact, type ArtifactLimits, type ArtifactReference } from '../../hapi/shared/src/artifacts';
import { HapiClient } from '../hapi';
import { RunweftError } from '../errors';

function artifact(value: unknown): Artifact {
    const parsed = ArtifactSchema.safeParse(value);
    if (!parsed.success) throw new RunweftError('invalid_hapi_response', '服务返回了无效的文件对象。');
    return parsed.data;
}
/** Transfer deadlines measure silence, not total file duration. */
function progressSignal(signal?: AbortSignal, idleMs = 60_000) {
    const idle = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => { clearTimeout(timer); timer = setTimeout(() => idle.abort(new RunweftError('artifact_transfer_idle', '文件传输超过 60 秒没有进展。', '检查连接；使用同一 request ID 查询或重试。')), idleMs); };
    tick();
    return { signal: signal ? AbortSignal.any([signal, idle.signal]) : idle.signal, tick, close: () => clearTimeout(timer) };
}
async function hashFile(file: FileHandle, signal: AbortSignal, tick: () => void) {
    const before = await file.stat();
    if (!before.isFile()) throw new RunweftError('artifact_not_file', '只支持显式的普通文件；目录请先自行打包。');
    const hash = createHash('sha256'), buffer = Buffer.allocUnsafe(256 * 1024);
    let size = 0;
    while (true) {
        signal.throwIfAborted();
        const { bytesRead } = await file.read(buffer, 0, buffer.length, size);
        tick();
        if (!bytesRead) break;
        size += bytesRead; hash.update(buffer.subarray(0, bytesRead));
        if (size > before.size) throw new RunweftError('artifact_source_changed', '文件在读取期间发生变化。', '等待写入完成后重新上传。');
    }
    const after = await file.stat();
    if (size !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new RunweftError('artifact_source_changed', '文件在读取期间发生变化。', '等待写入完成后重新上传。');
    return { size, sha256: hash.digest('hex') };
}
export type TransferProgress = (bytes: number, total: number) => void;

export class ArtifactClient {
    constructor(readonly hapi: HapiClient) {}
    async limits(signal?: AbortSignal) {
        const result = await this.hapi.request('/api/artifacts/limits', { signal });
        const parsed = ArtifactLimitsSchema.safeParse(result.limits);
        if (!parsed.success || !Number.isSafeInteger(result.usedBytes) || result.usedBytes < 0) throw new RunweftError('invalid_hapi_response', '服务未返回有效的文件限制与用量。');
        const usage = ArtifactUsageSchema.safeParse(result.usage);
        if (!usage.success) throw new RunweftError('invalid_hapi_response', '服务未返回有效的文件用量明细；请更新配套 Hub。');
        return { limits: parsed.data, usedBytes: result.usedBytes as number, usage: usage.data };
    }
    async prune(options: Partial<ArtifactPrune> = {}, signal?: AbortSignal) {
        const request = ArtifactPruneSchema.safeParse(options);
        if (!request.success) throw new RunweftError('invalid_artifact_request', '清理参数无效。', 'limit 为 1–200；after 使用上页 nextCursor。');
        const result = ArtifactPruneResultSchema.safeParse(await this.hapi.request('/api/artifacts/prune', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request.data), signal,
        }));
        if (!result.success) throw new RunweftError('invalid_hapi_response', '服务未返回有效的清理结果；请查询对象状态后再继续。');
        return result.data;
    }
    async show(id: string, signal?: AbortSignal) { return artifact((await this.hapi.request(`/api/artifacts/${encodeURIComponent(id)}`, { signal })).artifact); }
    async lookup(requestId: string, signal?: AbortSignal) { return artifact((await this.hapi.request(`/api/artifacts/requests/${encodeURIComponent(requestId)}`, { signal })).artifact); }
    async list(offset = 0, limit = 50, signal?: AbortSignal) {
        const result = await this.hapi.request(`/api/artifacts?offset=${offset}&limit=${limit}`, { signal });
        if (!Array.isArray(result.artifacts) || (result.nextOffset !== null && !Number.isSafeInteger(result.nextOffset))) throw new RunweftError('invalid_hapi_response', '服务返回了无效的文件列表。');
        return { artifacts: result.artifacts.map(artifact), nextOffset: result.nextOffset as number | null };
    }
    async refs(id: string, signal?: AbortSignal): Promise<{ references: ArtifactReference[] }> {
        return this.hapi.request(`/api/artifacts/${encodeURIComponent(id)}/references`, { signal });
    }
    async pin(id: string, reference: string, purpose: string) {
        return this.hapi.request(`/api/artifacts/${encodeURIComponent(id)}/references/${encodeURIComponent(reference)}`, {
            method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reference, purpose }),
        });
    }
    async unpin(id: string, reference: string) {
        return this.hapi.request(`/api/artifacts/${encodeURIComponent(id)}/references/${encodeURIComponent(reference)}`, { method: 'DELETE' });
    }
    async remove(id: string, signal?: AbortSignal) { return artifact((await this.hapi.request(`/api/artifacts/${encodeURIComponent(id)}`, { method: 'DELETE', signal })).artifact); }
    async upload(source: string, requestId: string, options: { name?: string; signal?: AbortSignal; progress?: TransferProgress } = {}) {
        const path = await realpath(resolve(source));
        const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        const transfer = progressSignal(options.signal);
        try {
            const { limits } = await this.limits(transfer.signal);
            const stat = await file.stat();
            if (!stat.isFile()) throw new RunweftError('artifact_not_file', '只支持上传普通文件；目录请先自行打包。');
            if (stat.size > limits.maxFileBytes) throw new RunweftError('artifact_too_large', `文件超过服务端 ${limits.maxFileBytes} 字节限制。`, '调整托管服务的 server.artifacts.maxFileMiB，或选择较小文件。');
            const digest = await hashFile(file, transfer.signal, transfer.tick); transfer.tick();
            const parsed = ArtifactReserveSchema.safeParse({ requestId, filename: options.name ?? basename(source), ...digest });
            if (!parsed.success) throw new RunweftError('invalid_artifact_request', '文件名或 request ID 无效。', parsed.error.issues.map(issue => issue.message).join('; '));
            const reserved = artifact((await this.hapi.request('/api/artifacts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(parsed.data), signal: transfer.signal })).artifact);
            if (reserved.requestId !== requestId || reserved.sha256 !== digest.sha256 || reserved.size !== digest.size || reserved.filename !== parsed.data.filename) {
                throw new RunweftError('invalid_hapi_response', '服务返回的文件预约与本次内容不一致。');
            }
            if (reserved.state === 'available') return reserved;
            if (reserved.state !== 'reserved') throw new RunweftError('artifact_deleted', '该 request ID 对应的文件已经删除，不能复活。', '新上传请使用新的 request ID。');
            let position = 0;
            const stream = new ReadableStream<Uint8Array>({ async pull(controller) {
                transfer.signal.throwIfAborted();
                const buffer = Buffer.allocUnsafe(Math.min(256 * 1024, digest.size - position));
                const { bytesRead } = buffer.length ? await file.read(buffer, 0, buffer.length, position) : { bytesRead: 0 };
                if (!bytesRead) return controller.close();
                position += bytesRead; transfer.tick(); options.progress?.(position, digest.size);
                controller.enqueue(buffer.subarray(0, bytesRead));
            } });
            const response = await this.hapi.response(`/api/artifacts/${reserved.id}/content`, { method: 'PUT', headers: {
                'content-type': 'application/octet-stream', 'content-length': String(digest.size),
            }, body: stream, signal: transfer.signal });
            const published = artifact((await response.json()).artifact);
            if (published.id !== reserved.id || published.sha256 !== digest.sha256 || published.size !== digest.size || published.state !== 'available') {
                throw new RunweftError('invalid_hapi_response', '服务未确认本次文件的完整发布。', `使用 artifact lookup ${requestId} 查询原操作。`);
            }
            return published;
        } finally { transfer.close(); await file.close(); }
    }
    async download(id: string, destination: string, options: { overwrite?: boolean; signal?: AbortSignal; progress?: TransferProgress } = {}) {
        const object = await this.show(id, options.signal);
        if (object.state !== 'available') throw new RunweftError('artifact_not_available', `文件当前状态为 ${object.state}，尚不可下载。`);
        const path = resolve(destination), temporary = `${path}.${crypto.randomUUID()}.runweft-part`;
        const existing = await lstat(path).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
        if (existing && !options.overwrite) throw new RunweftError('artifact_destination_exists', '目标已存在，未覆盖。', '选择其他 --output 路径；明确替换时加 --overwrite。');
        if (existing?.isDirectory()) throw new RunweftError('artifact_destination_directory', '下载目标是目录，请指定文件路径。');
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        const transfer = progressSignal(options.signal);
        let file: FileHandle | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        try {
            file = await open(temporary, 'wx', 0o600);
            const response = await this.hapi.response(`/api/artifacts/${encodeURIComponent(id)}/content`, { signal: transfer.signal });
            reader = response.body?.getReader();
            const hash = createHash('sha256'); let size = 0;
            while (reader) {
                const part = await reader.read();
                if (part.done) break;
                transfer.tick(); size += part.value.byteLength;
                if (size > object.size) throw new RunweftError('artifact_checksum_mismatch', '下载内容超过已发布长度，未保存到目标。');
                hash.update(part.value);
                let offset = 0;
                while (offset < part.value.byteLength) offset += (await file.write(part.value, offset)).bytesWritten;
                options.progress?.(size, object.size);
            }
            if (size !== object.size || hash.digest('hex') !== object.sha256) throw new RunweftError('artifact_checksum_mismatch', '下载内容的长度或 SHA-256 不匹配，未保存到目标。');
            await file.sync(); await file.close(); file = undefined;
            if (options.overwrite) await rename(temporary, path);
            else {
                try { await link(temporary, path); }
                catch (error) {
                    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') throw new RunweftError('artifact_destination_exists', '目标已存在，未覆盖。', '选择其他 --output 路径；明确替换时加 --overwrite。');
                    throw error;
                }
            }
            return { artifact: object, path };
        } finally {
            transfer.close(); await reader?.cancel().catch(() => {}); reader?.releaseLock();
            await file?.close(); await rm(temporary, { force: true });
        }
    }
}
