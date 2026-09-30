import { randomUUID } from 'node:crypto';
import type { RepositorySnapshot } from '../../hapi/shared/src/repositories';
import { ArtifactClient } from '../artifacts/client';
import { errorDetails } from '../errors';
import type { HapiHttp } from '../hapi';
import type { Problem } from '../resources/types';
import { batches, invalid, stopped, RepositoryTransfers } from './transfers';
import { PreparationError, type SnapshotFile, type TransferBatch } from './types';

export type SnapshotPublication = { exportId: string; directory?: string; manifest?: RepositorySnapshot; files?: SnapshotFile[];
    batches?: TransferBatch[]; sourceReleased: boolean; cleanupError?: Problem };
export type PublicationContext = { namespace: string; machine: string; reference: string; kind: 'baseline' | 'result'; save: () => void;
    lookupLfs: (hash: string, size: number) => string | undefined; rememberLfs: (hash: string, size: number, id: string) => void; reuse?: Record<string, string> };

/** Fixed repository bytes use the same capture, delivery and recovery pins for input and output snapshots. */
export class SnapshotPublisher {
    readonly transport: RepositoryTransfers;
    constructor(private readonly client: (namespace: string) => HapiHttp) { this.transport = new RepositoryTransfers(client); }
    async advance(record: SnapshotPublication, context: PublicationContext) {
        const { namespace, machine, reference, kind, save, lookupLfs, rememberLfs } = context;
        const artifacts = new ArtifactClient(this.client(namespace));
        if (!record.files) {
            const files: SnapshotFile[] = [];
            for (const file of [...record.manifest!.files].sort((a, b) => a.name.localeCompare(b.name))) {
                const artifactId = context.reuse?.[file.name] ?? (file.kind === 'lfs' ? lookupLfs(file.sha256, file.size) : undefined);
                const object = await this.transport.available(artifacts, { ...file, artifactId });
                files.push({ ...file, requestId: randomUUID(), ...(object ? { artifactId: object.id } : {}), reused: !!object, pinned: false });
            }
            record.files = files;
            record.batches = batches(files.filter(file => !file.reused).map(file => file.name)).map(names => ({ captureId: randomUUID(), deliveryId: randomUUID(), names,
                captured: false, delivered: false, captureAttempted: false, deliveryAttempted: false, deliveryStopped: false, released: false, releasedNames: [] })); save();
        }
        if (record.files.some(file => !file.reused && !file.pinned)) {
            const limits = await artifacts.limits(), upload = record.files.filter(file => !file.reused && !file.pinned), bytes = upload.reduce((sum, file) => sum + file.size, 0);
            if (upload.some(file => file.size > limits.limits.maxFileBytes)) throw new PreparationError(409, `${kind}_file_too_large`, '代码文件超过中心单文件限制。', `预计上传 ${bytes} 字节；调整 Hub server.artifacts.maxFileMiB 后重试交付。`);
            if (limits.usedBytes + bytes > limits.limits.namespaceQuotaBytes) throw new PreparationError(409, `${kind}_quota_exceeded`, '中心剩余文件配额不足以发布代码文件。', `还需 ${bytes} 字节；清理无引用文件或调整 Hub server.artifacts.namespaceQuotaGiB。`);
        }
        save();
        for (const file of record.files.filter(file => file.reused && !file.pinned)) {
            await artifacts.pin(file.artifactId!, reference, 'recovery'); file.pinned = true; save();
        }
        for (const batch of record.batches!) {
            if (batch.delivered) continue;
            if (!batch.captured) {
                const attempted = batch.captureAttempted; batch.captureAttempted = true; save();
                const captured = await this.transport.transferReceipt(namespace, machine, { action: 'capture', operationId: batch.captureId,
                    cwd: record.directory!, files: batch.names.map(name => ({ name, relativePath: name })) }, attempted);
                if (!stopped(captured)) return false;
                for (const name of batch.names) {
                    const file = record.files.find(file => file.name === name)!, candidate = captured.candidates?.find(item => item.name === name);
                    if (!candidate || candidate.status !== 'captured' || candidate.sha256 !== file.sha256 || candidate.size !== file.size) return invalid('固定导出候选在上传前发生变化。');
                }
                batch.captured = true; save();
            }
            const attempted = batch.deliveryAttempted; batch.deliveryAttempted = true; save();
            const delivered = await this.transport.transferReceipt(namespace, machine, { action: 'deliver', operationId: batch.deliveryId,
                captureOperationId: batch.captureId, files: (batch.deliveryNames ?? batch.names).map(name => ({ name, requestId: record.files!.find(file => file.name === name)!.requestId,
                    reference: { reference: reference, purpose: 'recovery' } })) }, attempted);
            for (const item of delivered.deliveries ?? []) if (item.status === 'available') {
                const file = record.files.find(file => file.name === item.name);
                if (!file || !batch.names.includes(file.name) || item.artifact.sha256 !== file.sha256 || item.artifact.size !== file.size || item.artifact.requestId !== file.requestId) return invalid('已发布文件与代码清单不一致。');
                file.artifactId = item.artifact.id; file.pinned = true;
                if (file.kind === 'lfs') rememberLfs(file.sha256, file.size, item.artifact.id);
            }
            batch.deliveryStopped = ['succeeded', 'failed'].includes(delivered.status); save();
            if (batch.deliveryStopped) await this.cleanup(record, context, false);
            if (!stopped(delivered)) return false;
            if (batch.names.some(name => !record.files!.find(file => file.name === name)!.artifactId)) return invalid('发布回执缺少代码文件。');
            batch.delivered = true; save();
            await this.cleanup(record, context, false);
        }
        if (record.files.some(file => !file.artifactId || !file.pinned)) return invalid('快照尚未取得完整恢复引用。');
        return true;
    }
    async cleanup(record: SnapshotPublication, context: PublicationContext, complete: boolean) {
        const { namespace, machine, save } = context;
        try {
            for (const batch of record.batches ?? []) if (batch.deliveryStopped && !batch.released) {
                const names = batch.names.filter(name => !batch.releasedNames.includes(name) && record.files!.some(file => file.name === name && file.artifactId && file.pinned));
                if (!names.length) continue;
                const captured = await this.transport.transfer(namespace, machine, { action: 'release', operationId: batch.captureId, names });
                if (names.some(name => !captured.candidates?.some(file => file.name === name && file.status === 'captured' && file.retention === 'released'))) return invalid('源端尚未确认已交付捕获副本释放。');
                const exported = await this.transport.repository(namespace, machine, { action: 'release', operationId: record.exportId, names });
                if (exported.retention !== 'released' && names.some(name => !exported.releasedFiles.includes(name))) return invalid('源端尚未确认已交付导出候选释放。');
                batch.releasedNames.push(...names); batch.released = batch.releasedNames.length === batch.names.length; save();
            }
            if (complete && !record.sourceReleased) {
                const result = await this.transport.repository(namespace, machine, { action: 'release', operationId: record.exportId });
                if (result.retention !== 'released') return invalid('源端尚未确认导出候选已释放。');
                record.sourceReleased = true;
            }
            delete record.cleanupError;
        } catch (error) { record.cleanupError = errorDetails(error); }
        save();
    }
}
