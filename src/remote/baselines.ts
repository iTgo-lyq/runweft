import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { RepositorySnapshotSchema, type RepositoryOperation, type RepositoryRequest } from '../../hapi/shared/src/repositories';
import { WorkspaceSourceSchema, type WorkspaceSource } from '../../hapi/shared/src/workspaces';
import type { ArtifactTransfer, ArtifactTransferRequest } from '../../hapi/shared/src/artifactTransfers';
import type { Artifact } from '../../hapi/shared/src/artifacts';
import { ArtifactClient } from '../artifacts/client';
import { errorDetails, RunweftError } from '../errors';
import { HapiRequestError, type HapiClient } from '../hapi';
import { BaselineStore } from './store';
import { PreparationError, recoveryReference, type BaselineImport, type BaselineSnapshot, type SnapshotFile } from './types';

const batches = <T>(items: T[]) => Array.from({ length: Math.ceil(items.length / 100) }, (_, index) => items.slice(index * 100, (index + 1) * 100));
export function uncertainPreparation(error: unknown) {
    return error instanceof HapiRequestError || error instanceof PreparationError
        ? error.status >= 500 || ['machine_offline', 'repository_process_unknown', 'workspace_process_unknown'].includes(error.code)
        : !(error instanceof RunweftError) || ['connection_failed', 'invalid_hapi_response'].includes(error.code);
}
const invalid = (message: string): never => { throw new RunweftError('invalid_hapi_response', message); };
function stopped(operation: { status: string; error?: { code: string; message: string; hint?: string } }) {
    if (operation.status === 'failed' || operation.status === 'unknown') throw new PreparationError(operation.status === 'unknown' ? 503 : 409,
        operation.error?.code ?? 'repository_operation_failed', operation.error?.message ?? 'HAPI 尚未确认仓库操作成功。', operation.error?.hint);
    return operation.status === 'succeeded';
}

/** Fixed source -> center recovery objects -> owned target source. No task or native-session lifecycle. */
export class RemoteBaselines {
    private readonly locks = new Map<string, Promise<void>>();
    constructor(readonly store: BaselineStore, private readonly client: (namespace: string) => HapiClient) {}
    private async serial<T>(key: string, action: () => Promise<T>) {
        const work = (this.locks.get(key) ?? Promise.resolve()).then(action);
        const done = work.then(() => {}, () => {}).finally(() => { if (this.locks.get(key) === done) this.locks.delete(key); });
        this.locks.set(key, done); return work;
    }
    private key(namespace: string, source: WorkspaceSource) { return JSON.stringify([namespace, source.repositoryId, source.baseCommit]); }
    private async repository(namespace: string, machine: string, request: RepositoryRequest): Promise<RepositoryOperation> {
        const result = await this.client(namespace).request(`/api/machines/${encodeURIComponent(machine)}/repositories`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
        });
        if (!result.operation || result.operation.request?.operationId !== request.operationId) return invalid('机器未返回指定仓库操作的回执。');
        return result.operation;
    }
    private async repositoryReceipt(namespace: string, machine: string, request: Extract<RepositoryRequest, { action: 'export' | 'import' }>, attempted: boolean) {
        let result: RepositoryOperation;
        if (!attempted) result = await this.repository(namespace, machine, request);
        else {
            try { result = await this.repository(namespace, machine, { action: 'inspect', operationId: request.operationId }); }
            catch (error) { if (!(error instanceof HapiRequestError && error.code === 'repository_operation_missing')) throw error; result = await this.repository(namespace, machine, request); }
        }
        if (!isDeepStrictEqual(result.request, request)) return invalid('仓库回执与冻结请求不一致。');
        return result;
    }
    private async transfer(namespace: string, machine: string, request: ArtifactTransferRequest): Promise<ArtifactTransfer> {
        const result = await this.client(namespace).request(`/api/machines/${encodeURIComponent(machine)}/artifacts`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
        });
        if (!result.operation || result.operation.request?.operationId !== request.operationId) return invalid('机器未返回指定文件操作的回执。');
        return result.operation;
    }
    private async transferReceipt(namespace: string, machine: string, request: Extract<ArtifactTransferRequest, { action: 'capture' | 'deliver' | 'materialize' }>, attempted: boolean) {
        let result: ArtifactTransfer;
        if (!attempted) result = await this.transfer(namespace, machine, request);
        else {
            try { result = await this.transfer(namespace, machine, { action: 'inspect', operationId: request.operationId }); }
            catch (error) { if (!(error instanceof HapiRequestError && error.code === 'artifact_operation_missing')) throw error; result = await this.transfer(namespace, machine, request); }
            // Existing immutable file operations support resuming interrupted transfers with the same identity.
            if (result.status === 'unknown' && request.action !== 'capture') result = await this.transfer(namespace, machine, request);
        }
        if (!isDeepStrictEqual(result.request, request)) return invalid('文件回执与冻结请求不一致。');
        return result;
    }
    private async available(artifacts: ArtifactClient, file: Pick<SnapshotFile, 'artifactId' | 'sha256' | 'size'>): Promise<Artifact | null> {
        if (!file.artifactId) return null;
        let object: Artifact;
        try { object = await artifacts.show(file.artifactId); }
        catch (error) { if (error instanceof HapiRequestError && error.status === 404) return null; throw error; }
        return object.state === 'available' && object.sha256 === file.sha256 && object.size === file.size ? object : null;
    }
    async forSource<T>(namespace: string, origin: WorkspaceSource, consume: (snapshot: BaselineSnapshot) => T) {
        return this.serial(this.key(namespace, origin), async () => {
            let record = this.store.latest(namespace, origin);
            if (record?.phase === 'available') {
                const artifacts = new ArtifactClient(this.client(namespace));
                for (const file of record.files ?? []) if (!await this.available(artifacts, file)) {
                    record.phase = 'failed'; record.error = { code: 'baseline_object_unavailable', message: '中心恢复对象已不可用；新准备将创建新的传输代次。' }; this.store.saveSnapshot(record); break;
                }
            }
            if (!record || record.phase === 'failed' || record.retention && record.retention !== 'retained') record = this.store.createSnapshot(namespace, origin);
            return consume(record);
        });
    }
    async checkTarget(snapshot: BaselineSnapshot, machine: string) {
        const previous = this.store.latestImport(snapshot.id, machine);
        if (!previous || previous.phase !== 'available' || previous.retention && previous.retention !== 'retained') return;
        await this.serial(`import:${previous.id}`, async () => {
            const record = this.store.imported(previous.id);
            try {
                const receipt = await this.repository(record.namespace, machine, { action: 'inspect', operationId: record.operationId });
                if (!stopped(receipt) || receipt.retention !== 'retained' || !isDeepStrictEqual(receipt.imported?.source, record.source)) throw new PreparationError(409, 'baseline_cache_unavailable', '目标缓存已不可用，需要重新导入。');
            } catch (error) {
                if (uncertainPreparation(error)) throw error;
                record.phase = 'failed'; record.error = errorDetails(error); this.store.saveImport(record);
            }
        });
    }
    async advanceSnapshot(id: string) {
        const initial = this.store.snapshot(id);
        return this.serial(this.key(initial.namespace, initial.origin), async () => {
            const record = this.store.snapshot(id), save = () => this.store.saveSnapshot(record);
            if (!this.store.consumers(id).length || record.retention && record.retention !== 'retained') return;
            if (record.phase === 'failed') { if (record.cleanupError) await this.cleanupSnapshot(record); return; }
            if (record.phase === 'available') { await this.cleanupSnapshot(record); return; }
            try {
                delete record.error;
                if (!record.manifest) {
                    record.phase = 'exporting'; record.stage = 'export'; const attempted = record.exportAttempted; record.exportAttempted = true; save();
                    const receipt = await this.repositoryReceipt(record.namespace, record.origin.machineId, { action: 'export', operationId: record.exportId, source: record.origin }, attempted);
                    if (!stopped(receipt)) return;
                    const manifest = RepositorySnapshotSchema.safeParse(receipt.snapshot);
                    if (!manifest.success || manifest.data.manifestId !== record.exportId || manifest.data.repositoryId !== record.origin.repositoryId
                        || manifest.data.sourceMachineId !== record.origin.machineId || manifest.data.baseCommit !== record.origin.baseCommit
                        || manifest.data.objectFormat !== record.origin.objectFormat || receipt.retention !== 'retained' || !isAbsolute(receipt.directory)) return invalid('导出清单与已冻结的源仓库不一致。');
                    record.manifest = manifest.data; record.directory = receipt.directory; record.stage = 'publish'; record.phase = 'uploading'; save();
                }
                const artifacts = new ArtifactClient(this.client(record.namespace));
                if (!record.files) {
                    const files: SnapshotFile[] = [];
                    for (const file of [...record.manifest.files].sort((a, b) => a.name.localeCompare(b.name))) {
                        const artifactId = file.kind === 'lfs' ? this.store.lfs(record.namespace, file.sha256, file.size) : undefined;
                        const object = await this.available(artifacts, { ...file, artifactId });
                        files.push({ ...file, requestId: randomUUID(), ...(object ? { artifactId: object.id } : {}), reused: !!object, pinned: false });
                    }
                    record.files = files;
                    record.batches = batches(files.filter(file => !file.reused).map(file => file.name)).map(names => ({ captureId: randomUUID(), deliveryId: randomUUID(), names,
                        captured: false, delivered: false, captureAttempted: false, deliveryAttempted: false, deliveryStopped: false, released: false, releasedNames: [] })); save();
                    const limits = await artifacts.limits(), upload = files.filter(file => !file.reused), bytes = upload.reduce((sum, file) => sum + file.size, 0);
                    if (upload.some(file => file.size > limits.limits.maxFileBytes)) throw new PreparationError(409, 'baseline_file_too_large', '基线文件超过中心单文件限制。', `预计上传 ${bytes} 字节；调整 Hub server.artifacts.maxFileMiB 后用固定 SHA 创建新准备。`);
                    if (limits.usedBytes + bytes > limits.limits.namespaceQuotaBytes) throw new PreparationError(409, 'baseline_quota_exceeded', '中心剩余文件配额不足以发布此基线。', `还需 ${bytes} 字节；清理无引用文件或调整 Hub server.artifacts.namespaceQuotaGiB。`);
                }
                record.phase = 'uploading'; save();
                for (const file of record.files.filter(file => file.reused && !file.pinned)) {
                    await artifacts.pin(file.artifactId!, recoveryReference(record.id), 'recovery'); file.pinned = true; save();
                }
                for (const batch of record.batches!) {
                    if (batch.delivered) continue;
                    if (!batch.captured) {
                        const attempted = batch.captureAttempted; batch.captureAttempted = true; save();
                        const captured = await this.transferReceipt(record.namespace, record.origin.machineId, { action: 'capture', operationId: batch.captureId,
                            cwd: record.directory!, files: batch.names.map(name => ({ name, relativePath: name })) }, attempted);
                        if (!stopped(captured)) return;
                        for (const name of batch.names) {
                            const file = record.files.find(file => file.name === name)!, candidate = captured.candidates?.find(item => item.name === name);
                            if (!candidate || candidate.status !== 'captured' || candidate.sha256 !== file.sha256 || candidate.size !== file.size) return invalid('固定导出候选在上传前发生变化。');
                        }
                        batch.captured = true; save();
                    }
                    const attempted = batch.deliveryAttempted; batch.deliveryAttempted = true; save();
                    const delivered = await this.transferReceipt(record.namespace, record.origin.machineId, { action: 'deliver', operationId: batch.deliveryId,
                        captureOperationId: batch.captureId, files: batch.names.map(name => ({ name, requestId: record.files!.find(file => file.name === name)!.requestId,
                            reference: { reference: recoveryReference(record.id), purpose: 'recovery' } })) }, attempted);
                    for (const item of delivered.deliveries ?? []) if (item.status === 'available') {
                        const file = record.files.find(file => file.name === item.name);
                        if (!file || !batch.names.includes(file.name) || item.artifact.sha256 !== file.sha256 || item.artifact.size !== file.size || item.artifact.requestId !== file.requestId) return invalid('已发布文件与基线清单不一致。');
                        file.artifactId = item.artifact.id; file.pinned = true;
                        if (file.kind === 'lfs') this.store.rememberLfs(record.namespace, file.sha256, file.size, item.artifact.id);
                    }
                    batch.deliveryStopped = ['succeeded', 'failed'].includes(delivered.status); save();
                    if (batch.deliveryStopped) await this.cleanupSnapshot(record);
                    if (!stopped(delivered)) return;
                    if (batch.names.some(name => !record.files!.find(file => file.name === name)!.artifactId)) return invalid('发布回执缺少基线文件。');
                    batch.delivered = true; save();
                    await this.cleanupSnapshot(record);
                }
                if (record.files.some(file => !file.artifactId || !file.pinned)) return invalid('基线尚未取得完整恢复引用。');
                record.phase = 'available'; delete record.error; save(); await this.cleanupSnapshot(record);
            } catch (error) { record.phase = uncertainPreparation(error) ? 'unknown' : 'failed'; record.error = errorDetails(error); save(); }
        });
    }
    private async cleanupSnapshot(record: BaselineSnapshot) {
        try {
            for (const batch of record.batches ?? []) if (batch.deliveryStopped && !batch.released) {
                const names = batch.names.filter(name => !batch.releasedNames.includes(name) && record.files!.some(file => file.name === name && file.artifactId && file.pinned));
                if (!names.length) continue;
                const captured = await this.transfer(record.namespace, record.origin.machineId, { action: 'release', operationId: batch.captureId, names });
                if (names.some(name => !captured.candidates?.some(file => file.name === name && file.status === 'captured' && file.retention === 'released'))) return invalid('源端尚未确认已交付捕获副本释放。');
                const exported = await this.repository(record.namespace, record.origin.machineId, { action: 'release', operationId: record.exportId, names });
                if (exported.retention !== 'released' && names.some(name => !exported.releasedFiles.includes(name))) return invalid('源端尚未确认已交付导出候选释放。');
                batch.releasedNames.push(...names); batch.released = batch.releasedNames.length === batch.names.length; this.store.saveSnapshot(record);
            }
            if (record.phase === 'available' && !record.sourceReleased) {
                const result = await this.repository(record.namespace, record.origin.machineId, { action: 'release', operationId: record.exportId });
                if (result.retention !== 'released') return invalid('源端尚未确认导出候选已释放。');
                record.sourceReleased = true;
            }
            delete record.cleanupError;
        } catch (error) { record.cleanupError = errorDetails(error); }
        this.store.saveSnapshot(record);
    }
    async advanceImport(id: string) {
        return this.serial(`import:${id}`, async () => {
            const record = this.store.imported(id), snapshot = this.store.snapshot(record.snapshotId), save = () => this.store.saveImport(record);
            if (record.phase === 'failed' || snapshot.phase !== 'available' || record.retention && record.retention !== 'retained') return;
            if (record.phase === 'available') { await this.cleanupImport(record); return; }
            try {
                record.phase = 'importing'; delete record.error;
                record.batches ??= batches(snapshot.files!.map(file => file.name)).map(names => ({ operationId: randomUUID(), names, attempted: false, released: false })); save();
                for (const batch of record.batches) if (!batch.files) {
                    const attempted = batch.attempted; batch.attempted = true; save();
                    const operation = await this.transferReceipt(record.namespace, record.machineId, { action: 'materialize', operationId: batch.operationId,
                        files: batch.names.map(name => { const file = snapshot.files!.find(file => file.name === name)!; return { name, artifactId: file.artifactId!, sha256: file.sha256, size: file.size }; }) }, attempted);
                    if (!stopped(operation)) return;
                    const files = batch.names.map(name => {
                        const expected = snapshot.files!.find(file => file.name === name)!, actual = operation.files.find(file => file.name === name);
                        if (!actual || actual.artifactId !== expected.artifactId || actual.sha256 !== expected.sha256 || actual.size !== expected.size || !isAbsolute(actual.path)) return invalid('目标下载文件与基线清单不一致。');
                        return actual;
                    });
                    if (operation.files.length !== files.length) return invalid('目标返回了额外的基线文件。');
                    batch.files = files; save();
                }
                const attempted = record.attempted; record.attempted = true; save();
                const imported = await this.repositoryReceipt(record.namespace, record.machineId, { action: 'import', operationId: record.operationId, snapshot: snapshot.manifest!,
                    files: record.batches.flatMap(batch => batch.files!.map(file => ({ name: file.name, path: file.path }))) }, attempted);
                if (!stopped(imported)) return;
                const source = WorkspaceSourceSchema.safeParse(imported.imported?.source);
                if (!source.success || source.data.machineId !== record.machineId || source.data.baseCommit !== snapshot.origin.baseCommit
                    || source.data.snapshot?.importOperationId !== record.operationId || source.data.snapshot.manifestId !== snapshot.manifest!.manifestId || imported.retention !== 'retained') return invalid('目标导入来源与固定快照不一致。');
                record.source = source.data; record.phase = 'available'; save(); await this.cleanupImport(record);
            } catch (error) { record.phase = uncertainPreparation(error) ? 'unknown' : 'failed'; record.error = errorDetails(error); save(); }
        });
    }
    private async cleanupImport(record: BaselineImport) {
        try {
            for (const batch of record.batches ?? []) if (!batch.released) {
                const operation = await this.transfer(record.namespace, record.machineId, { action: 'release', operationId: batch.operationId });
                if (operation.retention !== 'released') return invalid('目标尚未确认基线下载副本已释放。');
                batch.released = true; this.store.saveImport(record);
            }
            delete record.cleanupError;
        } catch (error) { record.cleanupError = errorDetails(error); }
        this.store.saveImport(record);
    }
    result(consumerId: string) {
        const consumer = this.store.consumer(consumerId), imported = this.store.imported(consumer.importId);
        if (!consumer.active || imported.phase !== 'available' || imported.retention && imported.retention !== 'retained' || !imported.source) return null;
        return { snapshotId: consumer.snapshotId, origin: consumer.origin, targetSource: { ...imported.source, relativePath: consumer.origin.relativePath } };
    }
    async releaseConsumer(consumerId: string) {
        const initial = this.store.consumer(consumerId), origin = this.store.snapshot(initial.snapshotId).origin;
        return this.serial(this.key(initial.namespace, origin), async () => {
            const consumer = this.store.consumer(consumerId); if (!consumer.active) return;
            const snapshot = this.store.snapshot(consumer.snapshotId), others = this.store.consumers(snapshot.id).filter(item => item.id !== consumerId);
            const imported = this.store.imported(consumer.importId);
            if (!others.some(item => item.importId === imported.id)) await this.serial(`import:${imported.id}`, async () => {
                const record = this.store.imported(imported.id); record.retention = 'releasing'; this.store.saveImport(record);
                for (const batch of record.batches ?? []) if (batch.attempted && !batch.released) {
                    await this.releaseTransfer(record.namespace, record.machineId, batch.operationId);
                    batch.released = true; this.store.saveImport(record);
                }
                if (record.attempted) {
                    try {
                        const receipt = await this.repository(record.namespace, record.machineId, { action: 'release', operationId: record.operationId });
                        if (receipt.retention !== 'released') return invalid('目标尚未确认缓存引用已释放。');
                        record.cache = receipt.cache; this.store.saveImport(record);
                        if (receipt.cache?.retained && receipt.cache.reason?.code !== 'repository_other_imports') {
                            throw new PreparationError(409, receipt.cache.reason?.code ?? 'repository_cache_retained', receipt.cache.reason?.message ?? '目标缓存仍有未确认占用。', receipt.cache.reason?.hint);
                        }
                    } catch (error) { if (!(error instanceof HapiRequestError && error.code === 'repository_operation_missing')) throw error; }
                }
                record.retention = 'released'; delete record.cleanupError; this.store.saveImport(record);
            });
            if (!others.length) {
                snapshot.retention = 'releasing'; this.store.saveSnapshot(snapshot);
                for (const batch of snapshot.batches ?? []) if (batch.captureAttempted && !batch.released) {
                    await this.releaseTransfer(snapshot.namespace, snapshot.origin.machineId, batch.captureId);
                    batch.released = true; batch.releasedNames = [...batch.names]; this.store.saveSnapshot(snapshot);
                }
                if (snapshot.exportAttempted && !snapshot.sourceReleased) {
                    try {
                        const receipt = await this.repository(snapshot.namespace, snapshot.origin.machineId, { action: 'release', operationId: snapshot.exportId });
                        if (receipt.retention !== 'released') return invalid('源端尚未确认候选已释放。');
                    } catch (error) { if (!(error instanceof HapiRequestError && error.code === 'repository_operation_missing')) throw error; }
                    snapshot.sourceReleased = true; this.store.saveSnapshot(snapshot);
                }
                const artifacts = new ArtifactClient(this.client(snapshot.namespace));
                for (const file of snapshot.files ?? []) if (file.artifactId && file.pinned) {
                    await artifacts.unpin(file.artifactId, recoveryReference(snapshot.id)); file.pinned = false; this.store.saveSnapshot(snapshot);
                }
                snapshot.retention = 'released'; delete snapshot.cleanupError; this.store.saveSnapshot(snapshot);
            }
            this.store.releaseConsumer(consumer);
        });
    }
    private async releaseTransfer(namespace: string, machine: string, operationId: string) {
        try {
            const receipt = await this.transfer(namespace, machine, { action: 'release', operationId });
            if (receipt.retention !== 'released') return invalid('机器尚未确认准备文件副本已释放。');
        } catch (error) { if (!(error instanceof HapiRequestError && error.code === 'artifact_operation_missing')) throw error; }
    }
}
