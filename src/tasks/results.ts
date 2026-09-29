import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { RepositorySnapshotSchema, type RepositorySnapshot } from '../../hapi/shared/src/repositories';
import { ArtifactClient } from '../artifacts/client';
import { errorDetails } from '../errors';
import type { HapiClient } from '../hapi';
import { SnapshotPublisher } from '../remote/publication';
import { BaselineStore } from '../remote/store';
import { batches, invalid, stopped, uncertainPreparation } from '../remote/transfers';
import type { ImportBatch, SnapshotFile } from '../remote/types';
import { TaskError, type Round, type Task } from './types';
import { resultReference, type CodeDelivery, type CodeFetch, type CodeManifest, type RecoverySnapshot } from './result-types';
import type { TaskStore } from './store';
import { TaskWorkspaces } from './workspaces';

function recovery(snapshot: RepositorySnapshot, files: SnapshotFile[]): RecoverySnapshot {
    return { snapshot: structuredClone(snapshot), files: snapshot.files.map(file => {
        const item = files.find(item => item.name === file.name);
        if (!item?.artifactId || !item.pinned || item.sha256 !== file.sha256 || item.size !== file.size || item.kind !== file.kind) {
            throw new TaskError(409, 'result_files_incomplete', '恢复文件与已验证快照不一致。');
        }
        return { ...file, artifactId: item.artifactId };
    }) };
}
export function pendingCode(): CodeDelivery {
    return { id: randomUUID(), exportId: randomUUID(), exportAttempted: false, sourceReleased: false, status: 'capturing', stage: 'capture', pinned: [] };
}
export function codeView(task: Task, round: Round) {
    const environment = task.environment, code = round.code;
    const status = round.codeRetention?.state ?? (environment.mode === 'shared' || round.git?.status === 'not_prepared' ? 'not_applicable'
        : environment.remote ? code?.status ?? 'pending' : round.git?.status === 'sealed' ? 'available' : 'pending');
    const local = environment.mode === 'worktree' && !environment.remote;
    const ref = status === 'available' ? local ? round.git?.result?.resultRef : round.resultFetch?.status === 'available' ? round.resultFetch.ref : undefined : undefined;
    const fetching = round.resultFetch && !['available', 'failed'].includes(round.resultFetch.status);
    return { status, round_id: round.id, round: round.ordinal, version: code?.latest?.version,
        ref, fetch: round.resultFetch, retention: round.codeRetention ? {
            state: round.codeRetention.state, created_at: round.codeRetention.createdAt, completed_at: round.codeRetention.completedAt,
            discard_pending: round.codeRetention.discardPending, pending_references: round.codeRetention.references.filter(item => !item.done).length,
            pending_copies: round.codeRetention.copies.filter(item => !item.done).length, error: round.codeRetention.error,
        } : { state: 'retained' as const },
        result: round.git?.result, error: round.codeRetention ? round.codeRetention.error : code?.error, cleanup_error: code?.cleanupError,
        storage: status === 'not_applicable' ? null : local ? 'source_repository' : 'center',
        bytes: code?.files ? { uploaded: code.files.filter(file => !file.reused && file.pinned).reduce((n, file) => n + file.size, 0),
            reused: code.files.filter(file => file.reused).reduce((n, file) => n + file.size, 0),
            retained: round.codeRetention && round.codeRetention.state !== 'releasing' ? 0 : [...new Map([...(code.baseline?.files ?? []), ...code.files.filter(file => file.artifactId)].map(file => [file.artifactId, file.size])).values()].reduce((n, size) => n + size, 0) } : undefined,
        next: ['not_applicable', 'released', 'discarded'].includes(status) ? null : status === 'available' ? ref
            ? { action: 'review', command: `git diff ${round.git!.result!.startHead} ${ref}` }
            : fetching ? { action: 'read_agent', command: `runweft task result show ${task.id} --round ${round.id}` }
                : { action: 'fetch_result', command: `runweft task result fetch ${task.id} --round ${round.id}` }
            : status === 'needs_attention' ? { action: 'retry_result', command: `runweft task result retry ${task.id} --round ${round.id}`, hint: code?.error?.hint }
            : { action: 'read_agent', command: `runweft task result show ${task.id} --round ${round.id}` } };
}

/** Consumes HAPI sealing facts; never runs a model, checkpoints or merges code. */
export class TaskResults {
    private readonly publisher: SnapshotPublisher;
    private readonly artifacts: ArtifactClient;
    constructor(private readonly hapi: HapiClient, private readonly store: TaskStore, private readonly baselines: BaselineStore) {
        this.publisher = new SnapshotPublisher(() => hapi); this.artifacts = new ArtifactClient(hapi);
    }
    private context(task: Task, round: Round, save: () => void) {
        return { namespace: task.namespace, machine: task.target.machineId, reference: resultReference(task.id, round.id), kind: 'result' as const, save,
            reuse: round.code!.reuse, lookupLfs: (hash: string, size: number) => this.baselines.lfs(task.namespace, hash, size),
            rememberLfs: (hash: string, size: number, id: string) => this.baselines.rememberLfs(task.namespace, hash, size, id) };
    }
    private async available(snapshot: RecoverySnapshot) {
        for (const file of snapshot.files) if (!await this.publisher.transport.available(this.artifacts, file)) return false;
        return true;
    }
    private async capture(task: Task, round: Round, code: CodeDelivery, save: () => void) {
        const environment = task.environment;
        if (environment.mode !== 'worktree' || !environment.remote || !round.git?.result) throw new TaskError(409, 'result_source_missing', '缺少远端仓库来源或封存事实。');
        if (!code.baseline) {
            if (!environment.remote.snapshotId) throw new TaskError(409, 'result_baseline_unavailable', '任务尚未绑定固定输入基线。');
            const baseline = this.baselines.snapshot(environment.remote.snapshotId);
            if (baseline.namespace !== task.namespace || baseline.phase !== 'available' || !baseline.manifest || !baseline.files
                || ['machineId', 'repositoryId', 'commonDir', 'baseCommit', 'objectFormat'].some(key => baseline.origin[key as keyof typeof baseline.origin] !== environment.remote!.origin[key as keyof typeof baseline.origin])) throw new TaskError(409, 'result_baseline_unavailable', '任务固定输入基线尚不可恢复。');
            code.baseline = recovery(baseline.manifest, baseline.files); save();
        }
        if (code.manifest) return true;
        const candidates = [code.baseline, ...this.store.codeManifests(task.id).map(item => item.output)];
        for (const candidate of candidates) if (candidate.snapshot.baseCommit === round.git.result.resultHead && await this.available(candidate)) {
            code.manifest = structuredClone(candidate.snapshot); code.reuse = Object.fromEntries(candidate.files.map(file => [file.name, file.artifactId]));
            code.verified = { kind: candidate === code.baseline ? 'baseline' : 'result', manifestId: candidate.snapshot.manifestId };
            code.sourceReleased = true; code.stage = 'publish'; code.status = 'publishing'; save(); return true;
        }
        const attempted = code.exportAttempted; code.exportAttempted = true; code.status = 'capturing'; save();
        const receipt = await this.publisher.transport.repositoryReceipt(task.namespace, task.target.machineId,
            { action: 'export-result', operationId: code.exportId, environmentId: environment.environmentId, roundId: round.id }, attempted);
        if (!stopped(receipt)) return false;
        const manifest = RepositorySnapshotSchema.safeParse(receipt.snapshot), source = receipt.sealed?.source;
        if (!manifest.success || !source || !isDeepStrictEqual(receipt.sealed?.result, round.git.result)
            || manifest.data.manifestId !== code.exportId || manifest.data.sourceMachineId !== task.target.machineId
            || manifest.data.repositoryId !== environment.source.repositoryId || manifest.data.baseCommit !== round.git.result.resultHead
            || manifest.data.objectFormat !== environment.source.objectFormat || source.machineId !== task.target.machineId
            || source.repositoryId !== environment.source.repositoryId || source.commonDir !== environment.source.commonDir
            || source.baseCommit !== round.git.result.resultHead || source.sourcePath !== environment.checkout
            || receipt.retention !== 'retained' || !isAbsolute(receipt.directory)) return invalid('成果导出与本轮已保存的封存事实或仓库身份不一致。');
        code.manifest = structuredClone(manifest.data); code.directory = receipt.directory;
        code.verified = { kind: 'export', operationId: code.exportId, source, verifiedAt: receipt.sealed!.verifiedAt, snapshot: manifest.data };
        code.reuse = {};
        // A derived descriptor retains the original verified bundle ref and bytes when a module has not changed.
        for (const repository of code.manifest.repositories.filter(item => item.path !== '')) {
            for (const candidate of candidates) {
                const previous = candidate.snapshot.repositories.find(item => item.path === repository.path && item.commit === repository.commit
                    && item.objectFormat === repository.objectFormat && isDeepStrictEqual(item.module, repository.module));
                const file = previous && candidate.files.find(item => item.name === previous.file);
                if (!file || !await this.publisher.transport.available(this.artifacts, file)) continue;
                const index = code.manifest.files.findIndex(item => item.name === repository.file);
                if (index < 0) return invalid('成果清单缺少模块文件。');
                code.manifest.files[index] = { name: repository.file, kind: file.kind, sha256: file.sha256, size: file.size };
                repository.bundleRef = previous!.bundleRef; code.reuse[repository.file] = file.artifactId; break;
            }
        }
        code.stage = 'publish'; code.status = 'publishing'; save(); return true;
    }
    private async retry(task: Task, code: CodeDelivery, save: () => void) {
        const transport = this.publisher.transport, ns = task.namespace, machine = task.target.machineId;
        if (code.stage === 'capture' && code.exportAttempted) {
            const old = await transport.repository(ns, machine, { action: 'inspect', operationId: code.exportId });
            if (old.status === 'failed') {
                const released = await transport.repository(ns, machine, { action: 'release', operationId: code.exportId });
                if (released.retention !== 'released') return invalid('旧失败导出尚未释放。');
                code.exportId = randomUUID(); code.exportAttempted = false; save();
            }
        }
        for (const batch of code.batches ?? []) if (!batch.delivered) {
            if (batch.captureAttempted && !batch.captured) {
                const old = await transport.transfer(ns, machine, { action: 'inspect', operationId: batch.captureId });
                if (old.status === 'failed') {
                    const released = await transport.transfer(ns, machine, { action: 'release', operationId: batch.captureId });
                    if (released.retention !== 'released') return invalid('旧失败捕获尚未释放。');
                    batch.captureId = randomUUID(); batch.captureAttempted = false; save();
                }
            }
            if (batch.deliveryAttempted) {
                const old = await transport.transfer(ns, machine, { action: 'inspect', operationId: batch.deliveryId });
                if (old.status === 'failed') {
                    batch.deliveryId = randomUUID(); batch.deliveryAttempted = false; batch.deliveryStopped = false;
                    batch.deliveryNames = batch.names.filter(name => !code.files!.find(file => file.name === name)!.pinned); save();
                }
            }
        }
        delete code.retryRequested; delete code.error; code.status = code.stage === 'capture' ? 'capturing' : 'publishing'; save();
    }
    async advance(task: Task, round: Round, save: () => void) {
        if (round.codeRetention) return round.codeRetention.state !== 'releasing';
        if (task.environment.mode !== 'worktree' || !task.environment.remote || round.git?.status === 'not_prepared') return true;
        if (round.git?.status !== 'sealed' || !round.git.result) return false;
        round.code ??= pendingCode();
        const code = round.code, previousStatus = code.status, previousError = code.error, retryRequested = code.retryRequested; save();
        try {
            if (code.retryRequested) await this.retry(task, code, save);
            if (code.status === 'needs_attention') return !!code.manifest;
            if (code.latest) { await this.publisher.cleanup(code, this.context(task, round, save), true); return true; }
            if (!await this.capture(task, round, code, save)) return false;
            code.status = 'publishing'; save();
            if (!await this.publisher.advance(code, this.context(task, round, save))) return false;
            const output = recovery(code.manifest!, code.files!);
            const all = [...new Map([...code.baseline!.files, ...output.files].map(file => [file.artifactId, file])).values()];
            for (const file of all) {
                if (!await this.publisher.transport.available(this.artifacts, file)) throw new TaskError(409, 'result_object_unavailable', '中心恢复文件不可用，代码清单尚未发布。');
                await this.artifacts.pin(file.artifactId, resultReference(task.id, round.id), 'recovery');
                if (!code.pinned.includes(file.artifactId)) { code.pinned.push(file.artifactId); save(); }
            }
            const manifest: CodeManifest = { version: 1, taskId: task.id, roundId: round.id, jobId: code.id, origin: task.environment.remote.origin,
                result: structuredClone(round.git.result), baseline: code.baseline!, output, reference: resultReference(task.id, round.id),
                createdAt: Date.now(), verified: code.verified! };
            this.store.publishCode(task, round, manifest); await this.publisher.cleanup(code, this.context(task, round, save), true); return true;
        } catch (error) {
            code.status = uncertainPreparation(error) ? 'unknown' : 'needs_attention'; code.error = errorDetails(error);
            round.attention = { ...code.error, scope: 'code', stage: code.stage };
            if (retryRequested || previousStatus !== code.status || !isDeepStrictEqual(previousError, code.error)) round.codeRevision = this.store.require(task.namespace, task.id).task.revision + 1;
            save();
            return code.status === 'needs_attention' && !!code.manifest;
        }
    }
    private async materialize(task: Task, fetch: CodeFetch, records: ImportBatch[], material: RecoverySnapshot, save: () => void) {
        if (!records.length) { records.push(...batches(material.files.map(file => file.name)).map(names => ({ operationId: randomUUID(), names, attempted: false, released: false }))); save(); }
        for (const batch of records) if (!batch.files) {
            const attempted = batch.attempted; batch.attempted = true; save();
            const operation = await this.publisher.transport.transferReceipt(task.namespace, fetch.target.machineId,
                { action: 'materialize', operationId: batch.operationId, files: batch.names.map(name => {
                    const file = material.files.find(item => item.name === name)!; return { name, artifactId: file.artifactId, sha256: file.sha256, size: file.size };
                }) }, attempted);
            if (!stopped(operation)) return false;
            batch.files = batch.names.map(name => {
                const file = material.files.find(item => item.name === name)!, actual = operation.files.find(item => item.name === name);
                if (!actual || actual.artifactId !== file.artifactId || actual.sha256 !== file.sha256 || actual.size !== file.size || !isAbsolute(actual.path)) return invalid('下载回执与固定代码清单不一致。');
                return actual;
            });
            if (batch.files.length !== operation.files.length) return invalid('下载回执包含未请求的文件。'); save();
        }
        return true;
    }
    private async cleanupFetch(task: Task, fetch: CodeFetch, save: () => void) {
        try {
            for (const batch of [...fetch.baseline, ...fetch.output]) if (!batch.released) {
                const receipt = await this.publisher.transport.transfer(task.namespace, fetch.target.machineId, { action: 'release', operationId: batch.operationId });
                if (receipt.retention !== 'released') return invalid('取回下载副本尚未释放。'); batch.released = true; save();
            }
            if (fetch.attempted) {
                const receipt = await this.publisher.transport.repository(task.namespace, fetch.target.machineId, { action: 'release', operationId: fetch.operationId });
                if (receipt.retention !== 'released') return invalid('取回验证副本尚未释放。');
            }
            fetch.released = true; delete fetch.cleanupError;
        } catch (error) { fetch.cleanupError = errorDetails(error); }
        save();
    }
    async advanceFetch(task: Task, round: Round, fetch: CodeFetch) {
        const save = () => this.store.saveCodeFetch(task, round, fetch);
        if (round.codeRetention) {
            if (round.codeRetention.state === 'releasing' || fetch.released) return;
            if (fetch.status !== 'available') { fetch.status = 'failed'; fetch.error = { code: 'result_released', message: '该轮代码成果已显式释放。' }; }
            fetch.released = true; delete fetch.cleanupError; save(); return;
        }
        if (fetch.status === 'failed' || fetch.released) return;
        if (fetch.status === 'available') { await this.cleanupFetch(task, fetch, save); return; }
        try {
            if (task.environment.mode !== 'worktree') throw new TaskError(409, 'result_not_applicable', '共享目录没有独立成果。');
            if (!task.environment.remote) {
                if (round.git?.status === 'not_prepared') throw new TaskError(409, 'result_not_prepared', '该轮未准备工作区，没有封存成果。');
                if (round.git?.status !== 'sealed') return;
                const source = await new TaskWorkspaces(this.hapi, fetch.target.machineId).resolve(fetch.target.cwd, round.git.result!.baseCommit);
                if (source.commonDir !== fetch.target.commonDir || source.repositoryId !== fetch.target.repositoryId || source.objectFormat !== fetch.target.objectFormat) throw new TaskError(409, 'result_target_mismatch', '当前目录不属于原主仓库。');
                fetch.localRef = round.git.result!.resultRef; fetch.status = 'available'; fetch.released = true; delete fetch.error; save(); return;
            }
            const manifest = this.store.codeManifests(task.id, round.id).find(item => fetch.manifestVersion === undefined || item.version === fetch.manifestVersion);
            if (!manifest) {
                if (round.git?.status === 'not_prepared') throw new TaskError(409, 'result_not_prepared', '该轮没有封存成果。');
                return;
            }
            fetch.manifestVersion = manifest.version; fetch.status = 'materializing'; delete fetch.error; save();
            if (!await this.materialize(task, fetch, fetch.baseline, manifest.baseline, save)
                || !await this.materialize(task, fetch, fetch.output, manifest.output, save)) return;
            fetch.status = 'fetching'; const attempted = fetch.attempted; fetch.attempted = true; save();
            const receipt = await this.publisher.transport.repositoryReceipt(task.namespace, fetch.target.machineId,
                { action: 'fetch-result', operationId: fetch.operationId, target: fetch.target, result: manifest.result,
                    baseline: { snapshot: manifest.baseline.snapshot, files: fetch.baseline.flatMap(batch => batch.files!.map(file => ({ name: file.name, path: file.path }))) },
                    output: { snapshot: manifest.output.snapshot, files: fetch.output.flatMap(batch => batch.files!.map(file => ({ name: file.name, path: file.path }))) } }, attempted);
            if (!stopped(receipt)) return;
            if (!receipt.fetched || receipt.fetched.head !== manifest.result.resultHead || !isDeepStrictEqual(receipt.fetched.target, fetch.target)
                || receipt.fetched.ref !== `refs/hapi/results/${manifest.result.environmentId}/${round.id}`) return invalid('取回回执与本轮成果或目标仓库不一致。');
            fetch.fetched = receipt.fetched; fetch.status = 'available'; delete fetch.error; save(); await this.cleanupFetch(task, fetch, save);
        } catch (error) { fetch.status = uncertainPreparation(error) ? 'unknown' : 'failed'; fetch.error = errorDetails(error); save(); }
    }
}
