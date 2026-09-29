import { errorDetails, RunweftError } from '../errors';
import { randomUUID } from 'node:crypto';
import { HapiRequestError, type HapiClient } from '../hapi';
import { ResourceService } from '../resources/service';
import { ResourceStore } from '../resources/store';
import { TaskStore } from '../tasks/store';
import type { Parent } from '../tasks/types';
import { TaskWorkspaces } from '../tasks/workspaces';
import { RemoteBaselines, uncertainPreparation } from './baselines';
import { BaselineStore } from './store';
import { AcceptPreparationSchema, LookupPreparationSchema, PreparationError, parsePreparation, type Preparation } from './types';

export class WorkspacePreparations {
    readonly store: BaselineStore;
    readonly baselines: RemoteBaselines;
    private readonly tasks: TaskStore;
    private readonly resources: ResourceStore;
    private readonly clients = new Map<string, HapiClient>();
    private readonly working = new Map<string, Promise<void>>();
    private timer?: ReturnType<typeof setInterval>;
    private closing = false;
    constructor(path: string, private readonly clientFor: (namespace: string) => HapiClient, private readonly pollMs = 1000) {
        this.store = new BaselineStore(path); this.tasks = new TaskStore(path); this.resources = new ResourceStore(path);
        this.baselines = new RemoteBaselines(this.store, namespace => this.client(namespace));
    }
    private client(namespace: string) {
        if (!this.clients.has(namespace)) this.clients.set(namespace, this.clientFor(namespace)); return this.clients.get(namespace)!;
    }
    private async serial<T>(key: string, action: () => Promise<T>) {
        const work = (this.working.get(key) ?? Promise.resolve()).then(() => {
            if (this.closing) throw new PreparationError(503, 'service_stopping', '服务正在停止；请查询原准备记录。');
            return action();
        });
        const done = work.then(() => {}, () => {}).finally(() => { if (this.working.get(key) === done) this.working.delete(key); });
        this.working.set(key, done); return work;
    }
    private kick(key: string, action: () => Promise<unknown>) {
        if (this.closing || this.working.has(key)) return;
        void this.serial(key, action).catch(error => console.error(JSON.stringify({ code: 'preparation_service_failed', operation: key, error: errorDetails(error) })));
    }
    start() { if (!this.timer) { this.timer = setInterval(() => this.scan(), this.pollMs); this.scan(); } }
    private scan() {
        if (this.closing) return;
        for (const snapshot of this.store.snapshots()) if ((!snapshot.retention || snapshot.retention === 'retained') && (snapshot.phase === 'failed' ? snapshot.cleanupError : snapshot.phase !== 'available' || !snapshot.sourceReleased)) {
            this.kick(`snapshot:${snapshot.id}`, () => this.baselines.advanceSnapshot(snapshot.id));
        }
        for (const imported of this.store.imports()) if ((!imported.retention || imported.retention === 'retained') && imported.phase !== 'failed' && (imported.phase !== 'available' || imported.batches?.some(batch => !batch.released))) {
            this.kick(`import:${imported.id}`, () => this.baselines.advanceImport(imported.id));
        }
        for (const preparation of this.store.preparations()) if (['preparing', 'unknown'].includes(preparation.phase)) {
            this.kick(`preparation:${preparation.id}`, () => this.advance(preparation.namespace, preparation.id));
        } else if (preparation.phase === 'releasing' && preparation.release && ['pending', 'unknown'].includes(preparation.release.status)) {
            this.kick(`preparation:${preparation.id}`, () => this.advanceRelease(preparation.namespace, preparation.id));
        }
    }
    async close() {
        this.closing = true; clearInterval(this.timer); this.timer = undefined;
        await Promise.all(this.working.values()); this.store.close(); this.resources.close(); this.tasks.close();
    }
    lookup(namespace: string, raw: unknown) {
        const input = parsePreparation(LookupPreparationSchema, raw); this.tasks.assertCanDelegate(namespace, input.parent);
        const record = this.store.lookup(namespace, input.parent, input.requestId, input.intent);
        return record ? this.view(record) : null;
    }
    async accept(namespace: string, raw: unknown) {
        const { parent, requestId, intent, agent } = parsePreparation(AcceptPreparationSchema, raw);
        return this.serial(`accept:${namespace}:${requestId}`, async () => {
            this.tasks.assertCanDelegate(namespace, parent);
            const prior = this.store.lookup(namespace, parent, requestId, intent); if (prior) return this.view(prior);
            if (agent.namespace !== namespace || agent.id !== intent.agent) throw new PreparationError(409, 'agent_snapshot_mismatch', 'Agent 选择不属于当前准备请求。');
            const resources = new ResourceService(this.resources, namespace, (path, init) => this.client(namespace).request(path, init));
            const target = await resources.resolveExecutionTarget(agent.runtimeId);
            if (target.machineId !== agent.machineId || target.flavor !== agent.flavor) throw new PreparationError(409, 'agent_target_changed', 'Agent 的 runtime 绑定已变化，请重新解析。');
            if (target.machineId === parent.machineId) throw new PreparationError(409, 'local_workspace_task_required', '目标 runtime 在发起机上，无需远端准备。', '直接使用 runweft task spawn <agent> --workspace-mode worktree，或让主 agent 调度本机工作目录。');
            const inventory = await this.client(namespace).request('/api/machines?includeOffline=true');
            for (const [id, capability] of [[parent.machineId, 'repositoryExport'], [target.machineId, 'repositoryImport']] as const) {
                const machine = inventory.machines?.find((item: { id: string }) => item.id === id);
                if (!machine?.active) throw new PreparationError(409, 'machine_offline', '源或目标 Runner 不在线。', '在对应机器运行 runweft start。');
                if (machine.runnerState?.capabilities?.[capability] !== 1 || machine.runnerState?.capabilities?.artifactTransfers !== 1
                    || (capability === 'repositoryExport' && machine.runnerState?.capabilities?.artifactOutputs !== 1)
                    || (capability === 'repositoryImport' && machine.runnerState?.capabilities?.managedWorkspaces !== 1)) {
                    throw new PreparationError(409, 'runner_upgrade_required', '源或目标 Runner 缺少仓库准备能力。', '更新两端配套 Runweft，然后 restart。');
                }
            }
            const origin = await new TaskWorkspaces(this.client(namespace), parent.machineId).resolve(parent.cwd, intent.baseRef);
            const existing = this.store.latest(namespace, origin);
            if (existing?.phase === 'available') await this.baselines.checkTarget(existing, target.machineId);
            const record = await this.baselines.forSource(namespace, origin, snapshot => this.store.accept(namespace, parent, requestId, intent, agent, origin, snapshot));
            this.scan(); return this.view(record);
        });
    }
    private async advance(namespace: string, id: string) {
        const record = this.store.preparation(namespace, id), consumer = this.store.consumer(record.consumerId);
        const snapshot = this.store.snapshot(consumer.snapshotId), imported = this.store.imported(consumer.importId);
        if (snapshot.phase === 'failed' || imported.phase === 'failed') {
            record.phase = 'failed'; record.error = snapshot.phase === 'failed' ? snapshot.error : imported.error; this.store.savePreparation(record); return;
        }
        const baseline = this.baselines.result(record.consumerId); if (!baseline) return;
        try {
            const attempted = record.attempted; record.attempted = true; record.phase = 'preparing'; delete record.error; this.store.savePreparation(record);
            const { operation, workspace } = await new TaskWorkspaces(this.client(namespace), record.agent.machineId).receipt({ action: 'prepare', environmentId: record.environmentId,
                preparationId: record.preparationId, roundId: record.id, source: baseline.targetSource, expectedHead: record.origin.baseCommit, inputs: [] }, attempted);
            if (operation.status === 'succeeded') {
                const ready = workspace.preparations[record.preparationId];
                if (!ready || ready.roundId !== record.id || ready.startHead !== record.origin.baseCommit) throw new RunweftError('invalid_hapi_response', '准备回执与固定基线不一致。');
                record.workspace = { cwd: ready.cwd, checkout: workspace.checkout, branch: workspace.branch, readyAt: ready.readyAt }; record.phase = 'ready';
            } else if (operation.status === 'failed' || operation.status === 'unknown') {
                record.phase = operation.status; record.error = operation.error;
            }
        } catch (error) { record.phase = uncertainPreparation(error) ? 'unknown' : 'failed'; record.error = errorDetails(error); }
        this.store.savePreparation(record);
    }
    inspect(namespace: string, parent: Parent, id: string) { return this.view(this.store.preparation(namespace, id, parent)); }
    list(namespace: string, parent: Parent, all = false) { return this.store.preparations(namespace, parent, all).map(record => this.view(record)); }
    async release(namespace: string, parent: Parent, id: string, discardIgnored: boolean) {
        this.tasks.assertCanDelegate(namespace, parent);
        return this.serial(`preparation:${id}`, async () => {
            const record = this.store.preparation(namespace, id, parent);
            if (record.phase === 'released' || record.release && ['pending', 'unknown'].includes(record.release.status)) return this.view(record);
            if (!['ready', 'failed', 'releasing'].includes(record.phase)) throw new PreparationError(409, 'preparation_pending', '准备仍在进行或结果未知，先查询原记录再释放。');
            const consumer = this.store.consumer(record.consumerId), snapshot = this.store.snapshot(consumer.snapshotId), imported = this.store.imported(consumer.importId);
            if (!['available', 'failed'].includes(snapshot.phase) || (imported.attempted || imported.batches?.some(batch => batch.attempted)) && !['available', 'failed'].includes(imported.phase)) {
                throw new PreparationError(409, 'preparation_pending', '基线或目标操作尚未确定，不能释放恢复对象。');
            }
            record.release = { status: 'pending', discardIgnored, environmentRemoved: record.release?.environmentRemoved ?? false,
                finalize: { attemptId: randomUUID(), attempted: false }, remove: { attemptId: randomUUID(), attempted: false } };
            record.phase = 'releasing'; this.store.savePreparation(record); this.scan(); return this.view(record);
        });
    }
    private async advanceRelease(namespace: string, id: string) {
        const record = this.store.preparation(namespace, id), release = record.release!;
        const save = () => this.store.savePreparation(record), workspaces = new TaskWorkspaces(this.client(namespace), record.agent.machineId);
        try {
            delete release.error; release.status = 'pending'; save();
            if (!release.environmentRemoved && record.attempted) {
                let workspace;
                try { workspace = await workspaces.inspect(record.environmentId); }
                catch (error) { if (!(error instanceof HapiRequestError && error.code === 'workspace_not_found')) throw error; }
                if (workspace && workspace.status !== 'removed') {
                    const check = (operation: { status: string; error?: { code: string; message: string; hint?: string } }) => {
                        if (['failed', 'unknown'].includes(operation.status)) throw new PreparationError(operation.status === 'unknown' ? 503 : 409,
                            operation.error?.code ?? 'workspace_release_failed', operation.error?.message ?? '工作区释放尚未确认。', operation.error?.hint);
                        return operation.status === 'succeeded';
                    };
                    if (workspace.preparations[record.preparationId]) {
                        const attempted = release.finalize.attempted; release.finalize.attempted = true; save();
                        const result = await workspaces.receipt({ action: 'finalize', environmentId: record.environmentId, preparationId: record.preparationId,
                            roundId: record.id, attemptId: release.finalize.attemptId, partial: false, unchangedHead: record.origin.baseCommit }, attempted);
                        if (!check(result.operation)) return;
                    }
                    const attempted = release.remove.attempted; release.remove.attempted = true; save();
                    const result = await workspaces.receipt({ action: 'remove', environmentId: record.environmentId, attemptId: release.remove.attemptId,
                        expectedHead: record.origin.baseCommit, discardIgnored: release.discardIgnored }, attempted);
                    if (!check(result.operation)) return;
                    if (result.workspace.status !== 'removed') throw new RunweftError('invalid_hapi_response', '工作区移除回执未确认删除。');
                }
            }
            release.environmentRemoved = true; save();
            await this.baselines.releaseConsumer(record.consumerId);
            release.status = 'complete'; record.phase = 'released'; save();
        } catch (error) { release.status = uncertainPreparation(error) ? 'unknown' : 'failed'; release.error = errorDetails(error); save(); }
    }
    private view(record: Preparation) {
        const consumer = this.store.consumer(record.consumerId), snapshot = this.store.snapshot(consumer.snapshotId), imported = this.store.imported(consumer.importId);
        const problem = record.release?.error ?? (record.release ? undefined : record.error ?? snapshot.error ?? imported.error);
        const phase = ['ready', 'failed', 'released', 'releasing'].includes(record.phase) ? record.phase
            : snapshot.phase !== 'available' ? snapshot.phase : imported.phase !== 'available' ? imported.phase : record.phase;
        const files = snapshot.files ?? [], sum = (items: typeof files) => items.reduce((total, file) => total + file.size, 0);
        return { id: record.id, requestId: record.requestId, phase, createdAt: record.createdAt, updatedAt: Math.max(record.updatedAt, snapshot.updatedAt, imported.updatedAt),
            stage: record.phase === 'released' ? 'released' : record.release ? (record.release.environmentRemoved ? 'release_baseline' : 'release_worktree') : record.phase === 'ready' ? 'complete' : snapshot.phase !== 'available' ? snapshot.stage : imported.phase !== 'available' ? (imported.attempted ? 'import' : 'download') : 'worktree',
            agent: record.agent, origin: record.origin, snapshot: { id: snapshot.id, generation: snapshot.generation, phase: snapshot.phase, retention: snapshot.retention ?? 'retained' },
            target: { machineId: imported.machineId, importId: imported.id, generation: imported.generation, phase: imported.phase, retention: imported.retention ?? 'retained', cache: imported.cache ?? null },
            transfer: { known: !!snapshot.files, files: files.length, totalBytes: sum(files), uploadBytes: consumer.snapshotReused ? 0 : sum(files.filter(file => !file.reused)), reusedBytes: consumer.snapshotReused ? sum(files) : sum(files.filter(file => file.reused)),
                publishedBytes: sum(files.filter(file => !!file.artifactId)), snapshotReused: consumer.snapshotReused },
            workspace: record.workspace ?? null, environmentId: record.environmentId, preparationId: record.preparationId,
            release: record.release ?? null, consumerActive: consumer.active,
            error: problem ?? null, cleanup: { sourceReleased: snapshot.sourceReleased, downloadsReleased: !!imported.batches?.every(batch => batch.released),
                errors: [snapshot.cleanupError, imported.cleanupError].filter(Boolean) },
            nativeExecution: 'not_started' as const, next: phase === 'released' ? '诊断环境已释放；历史记录保留，其他消费者的基线不受影响。'
                : record.release?.status === 'failed' ? record.release.error?.code === 'workspace_ignored_files'
                    ? `确认可丢弃 ignored 依赖和文件后运行 runweft workspace release ${record.id} --discard-ignored；否则保留环境。`
                    : `释放未完成，恢复对象仍保留；处理错误后再次运行 runweft workspace release ${record.id}。`
                : phase === 'ready' ? '诊断工作区已就绪；尚未启动任务。正式远端委派将在结果回收能力接通后开放。'
                : phase === 'failed' ? `修复错误后用新的 request ID 准备，固定基线为 ${record.origin.baseCommit}；原记录保留。`
                : `用 runweft workspace inspect ${record.id} 查询；响应丢失时复用原 request ID，不要重新发起。` };
    }
}
