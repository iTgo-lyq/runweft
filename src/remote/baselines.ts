import { SnapshotPublisher } from './publication';
import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { RepositorySnapshotSchema } from '../../hapi/shared/src/repositories';
import { WorkspaceSourceSchema, type WorkspaceSource } from '../../hapi/shared/src/workspaces';
import { ArtifactClient } from '../artifacts/client';
import { errorDetails } from '../errors';
import { HapiRequestError, type HapiHttp } from '../hapi';
import { BaselineStore } from './store';
import { batches, invalid, stopped, uncertainPreparation, RepositoryTransfers } from './transfers';
export { uncertainPreparation } from './transfers';
import { PreparationError, recoveryReference, type BaselineImport, type BaselineSnapshot } from './types';

/** Fixed source -> center recovery objects -> owned target source. No task or native-session lifecycle. */
export class RemoteBaselines {
    private readonly locks = new Map<string, Promise<void>>();
    private readonly transport: RepositoryTransfers;
    private readonly publisher: SnapshotPublisher;
    constructor(readonly store: BaselineStore, private readonly client: (namespace: string) => HapiHttp) { this.transport = new RepositoryTransfers(client); this.publisher = new SnapshotPublisher(client); }
    private async serial<T>(key: string, action: () => Promise<T>) {
        const work = (this.locks.get(key) ?? Promise.resolve()).then(action);
        const done = work.then(() => {}, () => {}).finally(() => { if (this.locks.get(key) === done) this.locks.delete(key); });
        this.locks.set(key, done); return work;
    }
    private key(namespace: string, source: WorkspaceSource) { return JSON.stringify([namespace, source.repositoryId, source.baseCommit]); }
    async forSource<T>(namespace: string, origin: WorkspaceSource, consume: (snapshot: BaselineSnapshot) => T) {
        return this.serial(this.key(namespace, origin), async () => {
            let record = this.store.latest(namespace, origin);
            if (record?.phase === 'available') {
                const artifacts = new ArtifactClient(this.client(namespace));
                for (const file of record.files ?? []) if (!await this.transport.available(artifacts, file)) {
                    record.phase = 'failed'; record.error = { code: 'baseline_object_unavailable', message: '中心恢复对象已不可用；新准备将创建新的传输代次。' }; this.store.saveSnapshot(record); break;
                }
            }
            if (!record || record.phase === 'failed' || record.retention && record.retention !== 'retained') record = this.store.createSnapshot(namespace, origin);
            return consume(record);
        });
    }
    async forTask(namespace: string, origin: WorkspaceSource, machine: string, taskId: string) {
        const previous = this.store.consumerForOwner(namespace, 'task', taskId);
        if (previous) {
            if (!previous.active || this.store.imported(previous.importId).machineId !== machine) throw new PreparationError(409, 'baseline_consumer_conflict', '任务基线已经释放或目标不一致。');
            return previous;
        }
        const existing = this.store.latest(namespace, origin);
        if (existing?.phase === 'available') await this.checkTarget(existing, machine);
        return this.forSource(namespace, origin, snapshot => this.store.consume(snapshot, machine, origin, 'task', taskId));
    }
    async checkTarget(snapshot: BaselineSnapshot, machine: string) {
        const previous = this.store.latestImport(snapshot.id, machine);
        if (!previous || previous.phase !== 'available' || previous.retention && previous.retention !== 'retained') return;
        await this.serial(`import:${previous.id}`, async () => {
            const record = this.store.imported(previous.id);
            try {
                const receipt = await this.transport.repository(record.namespace, machine, { action: 'inspect', operationId: record.operationId });
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
                    const receipt = await this.transport.repositoryReceipt(record.namespace, record.origin.machineId, { action: 'export', operationId: record.exportId, source: record.origin }, attempted);
                    if (!stopped(receipt)) return;
                    const manifest = RepositorySnapshotSchema.safeParse(receipt.snapshot);
                    if (!manifest.success || manifest.data.manifestId !== record.exportId || manifest.data.repositoryId !== record.origin.repositoryId
                        || manifest.data.sourceMachineId !== record.origin.machineId || manifest.data.baseCommit !== record.origin.baseCommit
                        || manifest.data.objectFormat !== record.origin.objectFormat || receipt.retention !== 'retained' || !isAbsolute(receipt.directory)) return invalid('导出清单与已冻结的源仓库不一致。');
                    record.manifest = manifest.data; record.directory = receipt.directory; record.stage = 'publish'; record.phase = 'uploading'; save();
                }
                record.phase = 'uploading'; save();
                if (!await this.publisher.advance(record, this.publicationContext(record))) return;
                record.phase = 'available'; delete record.error; save(); await this.cleanupSnapshot(record);
            } catch (error) { record.phase = uncertainPreparation(error) ? 'unknown' : 'failed'; record.error = errorDetails(error); save(); }
        });
    }
    private publicationContext(record: BaselineSnapshot) {
        return { namespace: record.namespace, machine: record.origin.machineId, reference: recoveryReference(record.id), kind: 'baseline' as const,
            save: () => this.store.saveSnapshot(record), lookupLfs: (hash: string, size: number) => this.store.lfs(record.namespace, hash, size),
            rememberLfs: (hash: string, size: number, id: string) => this.store.rememberLfs(record.namespace, hash, size, id) };
    }
    private cleanupSnapshot(record: BaselineSnapshot) {
        return this.publisher.cleanup(record, this.publicationContext(record), record.phase === 'available');
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
                    const operation = await this.transport.transferReceipt(record.namespace, record.machineId, { action: 'materialize', operationId: batch.operationId,
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
                const imported = await this.transport.repositoryReceipt(record.namespace, record.machineId, { action: 'import', operationId: record.operationId, snapshot: snapshot.manifest!,
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
                const operation = await this.transport.transfer(record.namespace, record.machineId, { action: 'release', operationId: batch.operationId });
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
                        const receipt = await this.transport.repository(record.namespace, record.machineId, { action: 'release', operationId: record.operationId });
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
                        const receipt = await this.transport.repository(snapshot.namespace, snapshot.origin.machineId, { action: 'release', operationId: snapshot.exportId });
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
            const receipt = await this.transport.transfer(namespace, machine, { action: 'release', operationId });
            if (receipt.retention !== 'released') return invalid('机器尚未确认准备文件副本已释放。');
        } catch (error) { if (!(error instanceof HapiRequestError && error.code === 'artifact_operation_missing')) throw error; }
    }
}
