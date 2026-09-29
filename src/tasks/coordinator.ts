import { BaselineStore } from '../remote/store';
import { RemoteBaselines, uncertainPreparation } from '../remote/baselines';
import { TaskResults, codeView } from './results';
import { ResultShowSchema, ResultFetchSchema, ResultRetrySchema, ResultReleaseSchema } from './result-types';
import { assertResultReleaseIdle, TaskResultRetention } from './result-retention';
import { setTimeout as delay } from 'node:timers/promises';
import { ExecutionClient } from '../execution';
import { errorDetails } from '../errors';
import type { HapiClient } from '../hapi';
import { ResourceStore } from '../resources/store';
import { ResourceService } from '../resources/service';
import { TaskStore } from './store';
import { AcceptSchema, ArtifactActionSchema, ArtifactReleaseSchema, LookupSchema, SendSchema, InterruptSchema, PermissionSchema, RemoveWorkspaceSchema, validateWorkspaceTarget, nativeTerminal, parseTask, TaskError, type Input, type Parent, type Round, type Task } from './types';
import { detail, overview } from './views';
import { historyContext, parseReport } from './reports';
import { TaskWorkspaces, preparedReference } from './workspaces';
import { TaskFiles, preparedFiles } from './files';
import { TaskOutputs } from './outputs';
import { TaskRetention } from './retention';

export class TaskCoordinator {
    readonly store: TaskStore;
    private readonly resources: ResourceStore;
    private readonly baselines: RemoteBaselines;
    private readonly ownsBaselines: boolean;
    private readonly clients = new Map<string, HapiClient>();
    private readonly working = new Map<string, Promise<void>>();
    private timer?: ReturnType<typeof setInterval>;
    private closing = false;
    constructor(path: string, private readonly clientFor: (namespace: string) => HapiClient, private readonly pollMs = 1000, baselines?: RemoteBaselines) {
        this.store = new TaskStore(path); this.resources = new ResourceStore(path); this.ownsBaselines = !baselines;
        this.baselines = baselines ?? new RemoteBaselines(new BaselineStore(path), namespace => this.client(namespace));
    }
    private client(namespace: string) {
        if (!this.clients.has(namespace)) this.clients.set(namespace, this.clientFor(namespace));
        return this.clients.get(namespace)!;
    }
    private resourceService(namespace: string) {
        return new ResourceService(this.resources, namespace, (path, options) => this.client(namespace).request(path, options));
    }
    async reconcileFileIntents() {
        for (const intent of this.store.pendingArtifactIntents()) {
            if (!this.store.artifactIntentAccepted(intent)) await new TaskFiles(this.client(intent.namespace)).abandon(this.store, intent);
        }
    }
    start() {
        if (this.timer) return;
        this.closing = false;
        this.timer = setInterval(() => this.scan(), this.pollMs);
        this.scan();
    }
    private scan() {
        if (this.closing) return;
        for (const task of this.store.pending()) this.kick(task.namespace, task.id);
    }
    kick(namespace: string, id: string) {
        if (this.closing || this.working.has(id)) return;
        void this.serial(id, () => this.advance(namespace, id)).catch(error => {
            // Domain failures are stored below; this is an outer storage/runtime failure.
            console.error(JSON.stringify({ code: 'task_coordinator_failed', taskId: id, error: errorDetails(error) }));
        });
    }
    private serial<T>(id: string, action: () => Promise<T> | T): Promise<T> {
        const operation = (this.working.get(id) ?? Promise.resolve()).then(() => {
            if (this.closing) throw new TaskError(503, 'service_stopping', '服务正在停止；请查询已接受记录。');
            return action();
        });
        const busy = operation.then(() => {}, () => {}).finally(() => { if (this.working.get(id) === busy) this.working.delete(id); });
        this.working.set(id, busy);
        return operation;
    }
    async close() {
        if (this.closing) { await Promise.all(this.working.values()); return; }
        this.closing = true;
        clearInterval(this.timer); this.timer = undefined;
        await Promise.all(this.working.values());
        this.store.close(); this.resources.close(); if (this.ownsBaselines) this.baselines.store.close();
    }
    lookup(namespace: string, value: unknown) {
        const { parent, requestId, intent } = parseTask(LookupSchema, value);
        this.store.assertCanDelegate(namespace, parent);
        return this.store.lookup(namespace, parent, requestId, intent);
    }
    async accept(namespace: string, value: unknown) {
        const { parent, requestId, intent, agent } = parseTask(AcceptSchema, value);
        return this.serial(`accept:${namespace}:${requestId}`, async () => {
            if (this.closing) throw new TaskError(503, 'service_stopping', '服务正在停止；请用同一 request ID 查询接受结果。');
            this.store.assertCanDelegate(namespace, parent);
            const previous = this.store.lookup(namespace, parent, requestId, intent);
            if (previous) return previous;
            if (agent.namespace !== namespace || agent.id !== intent.agentType) throw new TaskError(409, 'agent_snapshot_mismatch', 'Agent 快照不属于当前请求或连接。');
            const target = await this.resourceService(namespace).resolveExecutionTarget(agent.runtimeId);
            if (this.closing) throw new TaskError(503, 'service_stopping', '服务正在停止；请用同一 request ID 查询接受结果。');
            if (agent.machineId !== target.machineId || agent.flavor !== target.flavor || (agent.definition.flavor && agent.definition.flavor !== target.flavor)) {
                throw new TaskError(409, 'agent_target_changed', 'Agent 快照与当前 runtime 不一致。', '重新运行 agent check 后创建新任务。');
            }
            validateWorkspaceTarget(target.machineId, parent, intent);
            if (target.machineId !== parent.machineId) await this.requireRemoteCapabilities(namespace, parent.machineId, target.machineId);
            if (intent.outputs?.length) await new TaskOutputs(this.client(namespace), this.store).requireSupported(target.machineId);
            const source = intent.workspaceMode === 'worktree' ? await new TaskWorkspaces(this.client(namespace), parent.machineId).resolve(parent.cwd, intent.baseRef ?? 'HEAD') : undefined;
            if (this.closing) throw new TaskError(503, 'service_stopping', '服务正在停止；请用同一 request ID 查询接受结果。');
            const accepted = await new TaskFiles(this.client(namespace)).accept(this.store, namespace, parent, requestId, intent,
                () => this.store.accept(namespace, parent, requestId, intent, agent, target, source));
            this.kick(namespace, accepted.agent_id);
            return accepted;
        });
    }

    private async requireRemoteCapabilities(namespace: string, origin: string, target: string) {
        const { machines } = await this.client(namespace).request('/api/machines?includeOffline=true');
        for (const [id, capabilities] of [[origin, ['repositoryExport', 'repositoryResults', 'artifactTransfers', 'artifactOutputs']],
            [target, ['repositoryImport', 'repositoryResults', 'artifactTransfers', 'artifactOutputs', 'managedWorkspaces', 'mcpToolFilter']]] as const) {
            const machine = machines.find((item: { id: string }) => item.id === id);
            if (!machine?.active) throw new TaskError(409, 'machine_offline', '源或目标 Runner 不在线。', '在对应机器运行 runweft start。');
            if (capabilities.some(name => machine.runnerState?.capabilities?.[name] !== (name === 'mcpToolFilter' ? true : 1))) throw new TaskError(409, 'runner_upgrade_required', '源或目标 Runner 缺少远端准备或成果回收能力。', '更新两端配套 Runweft 后 restart。');
        }
    }
    private async prepareRemote(task: Task, round: Round, save: () => void) {
        const environment = task.environment;
        if (environment.mode !== 'worktree' || !environment.remote) return true;
        const remote = environment.remote;
        try {
            if (!remote.consumerId) {
                const consumer = await this.baselines.forTask(task.namespace, remote.origin, task.target.machineId, task.id);
                remote.consumerId = consumer.id; remote.snapshotId = consumer.snapshotId; save();
            }
            const consumer = this.baselines.store.consumer(remote.consumerId);
            await this.baselines.advanceSnapshot(consumer.snapshotId);
            await this.baselines.advanceImport(consumer.importId);
            const snapshot = this.baselines.store.snapshot(consumer.snapshotId), imported = this.baselines.store.imported(consumer.importId);
            if (snapshot.phase === 'failed' || imported.phase === 'failed') {
                const problem = snapshot.phase === 'failed' ? snapshot.error : imported.error;
                throw new TaskError(409, problem?.code ?? 'remote_baseline_failed', problem?.message ?? '固定基线准备失败。',
                    `${problem?.hint ?? ''} 修复后重新 spawn，明确指定 --workspace-mode worktree --base ${remote.origin.baseCommit}；不会重新解析原任务基线。`.trim());
            }
            const baseline = this.baselines.result(consumer.id);
            if (!baseline) {
                const error = snapshot.error ?? imported.error;
                round.attention = error ? { ...error, scope: 'workspace', stage: 'remote_preparation' } : null; save(); return false;
            }
            environment.source = baseline.targetSource;
            if (!environment.checkout) environment.cwd = baseline.targetSource.sourcePath;
            round.attention = null; save(); return true;
        } catch (error) {
            if (!uncertainPreparation(error)) throw error;
            round.attention = { ...errorDetails(error), scope: 'workspace', stage: 'remote_preparation' }; save(); return false;
        }
    }
    result(namespace: string, value: unknown) {
        const { parent, id, roundId } = parseTask(ResultShowSchema, value);
        const { task, rounds } = this.store.require(namespace, id, parent);
        const round = roundId ? rounds.find(item => item.id === roundId) : rounds.at(-1);
        if (!round) throw new TaskError(404, 'round_unknown', '此任务中没有指定轮次。');
        return { agent_id: id, round_id: round.id, revision: task.revision, code_revision: round.codeRevision, code: codeView(task, round),
            manifests: this.store.codeManifests(id, round.id), fetches: this.store.codeFetches(id, round.id) };
    }
    async resultAction(namespace: string, action: 'fetch' | 'retry', value: unknown) {
        const parsed = parseTask(action === 'fetch' ? ResultFetchSchema : ResultRetrySchema, value);
        const accepted = await this.serial(parsed.id, () => this.store.resultAction(namespace, { ...parsed, action }));
        this.kick(namespace, parsed.id);
        return { ...accepted, ...this.result(namespace, { parent: parsed.parent, id: parsed.id, roundId: accepted.round_id }) };
    }
    async releaseResults(namespace: string, value: unknown) {
        const { parent, id, roundId, apply, discardPending } = parseTask(ResultReleaseSchema, value);
        if (parent.kind !== 'cli') throw new TaskError(403, 'result_release_cli_only', '代码成果释放通过操作者 CLI 显式执行。');
        const result = await this.serial(id, async () => {
            this.store.assertCanDelegate(namespace, parent);
            const bundle = this.store.require(namespace, id, parent);
            if (roundId && !bundle.rounds.some(round => round.id === roundId)) throw new TaskError(404, 'round_unknown', '此任务中没有指定轮次。');
            const selected = bundle.rounds.filter(round => roundId ? round.id === roundId : ['finished', 'failed', 'finishing'].includes(round.phase));
            assertResultReleaseIdle(bundle, selected, discardPending);
            const retention = new TaskResultRetention(this.client(namespace)), plans = [];
            for (const round of selected) plans.push({ roundId: round.id, retention: await retention.plan(bundle.task, round, this.store.codeFetches(id, round.id), discardPending) });
            const blocked = plans.some(plan => plan.retention.unpublished && !plan.retention.discardPending);
            if (apply && blocked) throw new TaskError(409, 'result_unpublished', '该轮代码尚未完整交付。', '先 retry；明确放弃时加 --discard-pending --apply。');
            const saved = apply ? this.store.beginResultRelease(namespace, parent, id, plans, discardPending) : bundle;
            return { agent_id: id, applied: apply, revision: saved.task.revision, can_release: !blocked,
                rounds: plans.map(plan => ({ round_id: plan.roundId, ...plan.retention, state: saved.rounds.find(round => round.id === plan.roundId)!.codeRetention?.state ?? 'retained' })) };
        });
        if (apply) this.kick(namespace, id);
        return result;
    }
    async retryFinish(namespace: string, value: unknown) {
        const { parent, id, roundId } = parseTask(InterruptSchema, value);
        const result = await this.serial(id, () => {
            const { task, rounds, inputs } = this.store.require(namespace, id, parent);
            const round = rounds.find(round => round.id === roundId);
            if (!round) throw new TaskError(404, 'round_unknown', '此任务中没有指定轮次。');
            new TaskWorkspaces(this.client(namespace), task.target.machineId).retry(round);
            this.store.save(task, round, inputs.filter(input => input.roundId === round.id));
            return { agent_id: id, round_id: roundId, status: 'retry_requested' as const };
        });
        this.kick(namespace, id); return result;
    }
    async removeWorkspace(namespace: string, value: unknown) {
        const { parent, id, discardIgnored } = parseTask(RemoveWorkspaceSchema, value);
        if (parent.kind !== 'cli') throw new TaskError(403, 'workspace_remove_cli_only', '工作区清理通过操作者 CLI 显式执行。');
        const task = await this.serial(id, () => this.store.beginRemoval(namespace, parent, id, discardIgnored));
        this.kick(namespace, id);
        return { agent_id: id, environment: task.environment };
    }
    async send(namespace: string, value: unknown) {
        const { parent, requestId, intent } = parseTask(SendSchema, value);
        if (this.closing) throw new TaskError(503, 'service_stopping', '服务正在停止；请查询已接受记录。');
        const accepted = await this.serial(`accept:${namespace}:${requestId}`, async () => {
            this.store.assertCanDelegate(namespace, parent);
            const previous = this.store.lookup(namespace, parent, requestId, intent);
            if (previous) return previous;
            const current = this.store.require(namespace, intent.id, parent);
            if (intent.outputs?.length) await new TaskOutputs(this.client(namespace), this.store).requireSupported(current.task.target.machineId);
            const accept = () => this.store.append(namespace, parent, requestId, intent);
            // Only steer changes the active execution; new rounds have their own acceptance lock.
            return intent.mode === 'steer' ? this.serial(intent.id, accept)
                : new TaskFiles(this.client(namespace)).accept(this.store, namespace, parent, requestId, intent, accept);
        });
        this.kick(namespace, intent.id);
        return accepted;
    }
    async interrupt(namespace: string, value: unknown) {
        const { parent, id, roundId } = parseTask(InterruptSchema, value);
        const result = await this.serial(id, () => {
            const { task, rounds, inputs } = this.store.require(namespace, id, parent);
            const round = rounds.find(round => round.id === roundId);
            if (!round) throw new TaskError(404, 'round_unknown', '此任务中没有指定轮次。');
            if (['finished', 'failed'].includes(round.phase)) return { status: 'already_finished', agent_id: id, round_id: roundId };
            if (round.phase === 'finishing') return { status: 'execution_already_stopped', agent_id: id, round_id: roundId };
            round.cancellation ??= { requestedAt: Date.now() };
            if (round.phase === 'queued') {
                this.finishUnstarted(task, round);
            }
            this.store.save(task, round, inputs.filter(input => input.roundId === round.id));
            return { status: 'requested', agent_id: id, round_id: roundId };
        });
        this.kick(namespace, id); return result;
    }
    async artifactAction(namespace: string, value: unknown) {
        const input = parseTask(ArtifactActionSchema, value);
        const result = await this.serial(input.id, () => this.store.artifactAction(namespace, input));
        this.kick(namespace, input.id); return result;
    }
    async releaseArtifacts(namespace: string, value: unknown) {
        const { parent, id, roundId, apply, discardPending } = parseTask(ArtifactReleaseSchema, value);
        const result = await this.serial(id, async () => {
            this.store.assertCanDelegate(namespace, parent);
            const bundle = this.store.require(namespace, id, parent);
            if (roundId && !bundle.rounds.some(round => round.id === roundId)) throw new TaskError(404, 'round_unknown', '此任务中没有指定轮次。');
            if (bundle.rounds.some(round => !['finished', 'failed'].includes(round.phase) || round.outputFiles?.jobs.some(job => job.phase !== 'complete'))) {
                throw new TaskError(409, 'artifact_release_active', '释放需要本任务所有轮次和文件操作结束。');
            }
            const retention = new TaskRetention(this.client(namespace)), plans = [];
            for (const round of bundle.rounds.filter(round => !roundId || round.id === roundId)) {
                plans.push({ roundId: round.id, retention: await retention.plan(bundle.task, round, this.store.manifests(id, round.id), discardPending) });
            }
            const blocked = plans.some(plan => plan.retention.pendingCandidates.length && !plan.retention.discardPending);
            if (apply && blocked) throw new TaskError(409, 'artifact_undelivered_candidates', '仍有未交付候选，普通释放会丢失重传来源。', '先 retry；明确放弃时使用 task artifacts release --discard-pending --apply。');
            const saved = apply ? this.store.beginArtifactRelease(namespace, parent, id, plans) : bundle;
            return { agent_id: id, applied: apply, revision: saved.task.revision, can_release: !blocked,
                rounds: plans.map(plan => ({ round_id: plan.roundId, ...plan.retention, state: saved.rounds.find(round => round.id === plan.roundId)!.artifactRetention?.state ?? 'retained' })) };
        });
        if (apply) this.kick(namespace, id);
        return result;
    }
    artifactManifests(namespace: string, parent: Parent, id: string, roundId: string) {
        const bundle = this.store.require(namespace, id, parent);
        const round = bundle.rounds.find(round => round.id === roundId);
        if (!round) throw new TaskError(404, 'round_unknown', '此任务中没有指定轮次。');
        return { agent_id: id, round_id: roundId, artifacts_revision: round.artifactsRevision,
            retention: round.artifactRetention ?? { state: 'retained' }, manifests: this.store.manifests(id, roundId), pending: round.outputFiles?.jobs.filter(job => job.phase !== 'complete').map(job => ({ id: job.id, kind: job.kind, phase: job.phase, error: job.error })) ?? [] };
    }
    async permission(namespace: string, value: unknown) {
        const { parent, id, roundId, requestId, decision, answers } = parseTask(PermissionSchema, value);
        return this.serial(id, async () => {
            const { task, rounds, inputs } = this.store.require(namespace, id, parent);
            const round = rounds.find(round => !['finished', 'failed'].includes(round.phase));
            if (round?.id !== roundId || round.phase !== 'running' || round.cancellation || !round.sessionId) throw new TaskError(409, 'round_not_running', '权限请求不属于指定的活跃轮次。');
            const execution = new ExecutionClient(this.client(namespace));
            const session = await execution.inspect(round.sessionId);
            if (!session.active || !session.agentState?.requests?.[requestId] || round.permissionBaseline?.includes(requestId)) throw new TaskError(409, 'permission_not_pending', '该原生权限请求已经处理或不属于当前轮次。');
            await execution.respondPermission(round.sessionId, requestId, decision, answers);
            round.permissions = Object.fromEntries(Object.entries((await execution.inspect(round.sessionId)).agentState?.requests ?? {})
                .filter(([id]) => !round.permissionBaseline?.includes(id)));
            if (!Object.keys(round.permissions).length && round.attention?.code === 'permission_required') round.attention = null;
            this.store.save(task, round, inputs.filter(input => input.roundId === round.id));
            return { agent_id: id, round_id: roundId, request_id: requestId, decision, responded: true };
        });
    }
    list(namespace: string, parent: Parent, all = false) {
        return { agents: this.store.list(namespace, parent, all).map(bundle => ({ ...overview(bundle, bundle.rounds.find(round => !['finished', 'failed'].includes(round.phase)) ?? bundle.rounds.at(-1)!),
            accepted_requests: this.store.requests(namespace, bundle.task.id) })) };
    }
    read(namespace: string, parent: Parent, id: string, options?: { roundId?: string; offset?: number; limit?: number }) {
        const result = detail(this.store.require(namespace, id, parent), options);
        if (!result) throw new TaskError(404, 'round_unknown', '此任务中没有指定轮次。');
        return result;
    }
    async wait(namespace: string, parent: Parent, ids: string[], timeoutMs: number, after: Record<string, number> = {}, signal?: AbortSignal) {
        const targets = new Map(ids.map(id => [id, this.store.require(namespace, id, parent).rounds.at(-1)!.id]));
        const deadline = Date.now() + timeoutMs;
        while (true) {
            signal?.throwIfAborted();
            if (this.closing) throw new TaskError(503, 'service_stopping', '等待因服务停止而结束；任务记录仍保留。');
            const agents = ids.map(id => {
                const bundle = this.store.require(namespace, id, parent);
                const round = after[id] === undefined ? bundle.rounds.find(round => round.id === targets.get(id))!
                    : bundle.rounds.filter(round => Math.max(round.completedRevision ?? 0, round.artifactsRevision ?? 0, round.codeRevision ?? 0) > after[id])
                        .sort((a, b) => Math.max(a.completedRevision ?? 0, a.artifactsRevision ?? 0, a.codeRevision ?? 0) - Math.max(b.completedRevision ?? 0, b.artifactsRevision ?? 0, b.codeRevision ?? 0))[0] ?? bundle.rounds.at(-1)!;
                const view = overview(bundle, round);
                return after[id] !== undefined && Math.max(round.completedRevision ?? 0, round.artifactsRevision ?? 0, round.codeRevision ?? 0) > after[id]
                    ? { ...view, revision: Math.max(round.completedRevision ?? 0, round.artifactsRevision ?? 0, round.codeRevision ?? 0), current_revision: bundle.task.revision } : { ...view, current_revision: bundle.task.revision };
            });
            const ready = agents.some(agent => agent.status !== 'running' && (after[agent.agent_id] === undefined
                || (['completed', 'failed', 'interrupted'].includes(agent.status) ? Math.max(agent.completed_revision ?? 0, agent.artifacts_revision ?? 0, agent.code_revision ?? 0) > after[agent.agent_id] : agent.revision > after[agent.agent_id])));
            if (ready || Date.now() >= deadline) return { agents, timed_out: !ready };
            await delay(Math.min(200, Math.max(1, deadline - Date.now())), undefined, { signal });
        }
    }
    private async advance(namespace: string, id: string) {
        const { task, rounds, inputs: allInputs } = this.store.require(namespace, id);
        const workspaces = new TaskWorkspaces(this.client(namespace), task.target.machineId);
        const files = new TaskFiles(this.client(namespace));
        const outputs = new TaskOutputs(this.client(namespace), this.store);
        const results = new TaskResults(this.client(namespace), this.store, this.baselines.store);
        for (const item of rounds) if (item.codeRetention?.state === 'releasing') {
            await new TaskResultRetention(this.client(namespace)).advance(task, item, () => this.store.save(task, item, []));
        }
        for (const previous of rounds.filter(item => ['finished', 'failed'].includes(item.phase))) {
            const savePrevious = () => this.store.save(task, previous, []);
            if (previous.code) await results.advance(task, previous, savePrevious);
            await outputs.advance(task, previous, savePrevious);
            await files.releaseAfterStop(task, previous, savePrevious);
            await new TaskRetention(this.client(namespace)).advance(task, previous, savePrevious, () => {
                previous.artifactsRevision = this.store.require(namespace, id).task.revision + 1; savePrevious();
            });
        }
        for (const fetch of this.store.codeFetches(id)) {
            const selected = rounds.find(round => round.id === fetch.roundId)!;
            await results.advanceFetch(task, selected, fetch);
        }
        if (task.environment.mode === 'worktree' && task.environment.status === 'deleting') {
            try { await workspaces.remove(task, () => this.store.saveEnvironment(task)); }
            catch (error) {
                task.environment.removal!.status = 'unknown'; task.environment.removal!.error = errorDetails(error);
                this.store.saveEnvironment(task);
            }
            return;
        }
        if (task.environment.mode === 'worktree' && task.environment.status === 'removed' && task.environment.remote?.release?.state === 'pending') {
            const remote = task.environment.remote;
            try {
                const consumerId = remote.consumerId ?? this.baselines.store.consumerForOwner(namespace, 'task', id)?.id;
                if (consumerId) { remote.consumerId = consumerId; await this.baselines.releaseConsumer(consumerId); }
                remote.release = { state: 'released' };
            } catch (error) { remote.release = { state: 'pending', error: errorDetails(error) }; }
            this.store.saveEnvironment(task); return;
        }
        if (rounds.some(item => item.codeRetention?.state === 'releasing')) return;
        const round = rounds.find(round => !['finished', 'failed'].includes(round.phase));
        if (!round) return;
        if (round.phase === 'queued' && rounds.some(item => item.outputFiles?.jobs.some(job => job.kind === 'collect' && !job.publishedVersion && job.phase !== 'complete'))) return;
        const inputs = allInputs.filter(input => input.roundId === round.id);
        const execution = new ExecutionClient(this.client(namespace));
        const save = () => this.store.save(task, round, inputs);
        try {
            if (round.phase === 'queued') {
                if (round.outputFiles?.declarations.length) await outputs.requireSupported(task.target.machineId);
                const target = await this.resourceService(namespace).resolveExecutionTarget(task.target.runtimeId);
                if (task.environment.mode === 'shared' && target.machineId !== task.parent.machineId) throw new TaskError(409, 'shared_target_required', '共享目录任务只能使用发起机上的 runtime。');
                if (target.machineId !== task.target.machineId || target.flavor !== task.target.flavor) throw new TaskError(409, 'task_target_changed', '已接受任务的固定 runtime 目标不一致。');
                if (!await this.prepareRemote(task, round, save)) return;
                if (task.environment.mode === 'worktree' && round.preparation.mode === 'worktree') {
                    const prior = [...rounds].reverse().find(item => item.ordinal < round.ordinal && item.git?.status === 'sealed');
                    round.preparation.expectedHead = prior?.git?.result?.resultHead ?? task.environment.source.baseCommit;
                    round.phase = 'preparing';
                } else { round.preparation = { mode: 'shared', status: 'ready', checkedAt: Date.now() }; round.phase = 'preparing'; }
                round.attention = null; save();
            }
            if (round.phase === 'preparing') {
                if (!await files.prepare(task, round, save)) return;
                if (task.environment.mode === 'worktree' && round.preparation.status !== 'ready' && !await workspaces.prepare(task, round, save)) return;
                if (round.preparation.status === 'ready') await files.releaseIntermediate(task, round, save);
            }
            if (round.phase === 'preparing' && round.preparation.status === 'ready') {
                if (round.cancellation) this.finishUnstarted(task, round);
                else {
                    const previous = [...rounds].reverse().find(item => item.ordinal < round.ordinal && item.sessionId && item.stop === 'stopped' && !item.startupFailure);
                    if (previous) round.resume = { previousSessionId: previous.sessionId!, previousNativeSessionId: previous.nativeSessionId,
                        candidateSessionId: previous.sessionId!, attempted: false, outcome: 'pending' };
                    round.phase = previous ? 'resuming' : 'starting'; round.attention = null;
                }
                save();
            }
            if (this.closing) return;
            if (round.cancellation && ((round.phase === 'resuming' && !round.resume?.attempted)
                || (round.phase === 'starting' && !round.sessionId && !round.spawnAttempted))) {
                this.finishUnstarted(task, round); save();
            }
            if (round.phase === 'resuming') {
                const resume = round.resume!;
                if (!resume.attempted) {
                    resume.attempted = true; save();
                    const result = await execution.resume(resume.previousSessionId, preparedReference(task, round), preparedFiles(task, round) ?? null);
                    resume.outcome = result.outcome;
                    if (result.outcome === 'missing') {
                        round.reconstruction = historyContext({ task, rounds, inputs: allInputs }, round);
                        round.phase = 'starting'; round.attention = null; save();
                    } else {
                        resume.candidateSessionId = result.outcome === 'resumed' ? result.session.id : result.sessionId;
                        save();
                    }
                }
                if (round.phase === 'resuming') {
                    const candidate = await execution.inspect(resume.candidateSessionId);
                    if (!candidate.active || candidate.metadata?.capabilities?.execution !== 1) {
                        round.attention = { stage: 'resuming', code: 'task_resume_unknown', message: '尚未确认续接执行就绪。', hint: '中心只查询已知 session，不重复 resume，也不创建替代会话。' }; save(); return;
                    }
                    round.sessionId = candidate.id; resume.outcome = 'resumed'; round.phase = 'starting'; save();
                }
            }
            if (round.phase === 'starting') {
                if (!round.sessionId) {
                    const attempted = round.spawnAttempted;
                    round.spawnAttempted = true; save();
                    const definition = task.agent.definition;
                    const receipt = attempted ? await execution.lookupStart(task.target.machineId, round.spawnRequestId)
                        : await execution.start(task.target.machineId, {
                            requestId: round.spawnRequestId, directory: task.environment.cwd, agent: task.target.flavor,
                            disabledMcpServers: ['runweft'], startingMode: 'remote', preparedWorkspace: preparedReference(task, round), preparedFiles: preparedFiles(task, round),
                            ...(definition.model ? { model: definition.model } : {}),
                            ...(definition.reasoningEffort ? task.target.flavor === 'codex' ? { modelReasoningEffort: definition.reasoningEffort } : { effort: definition.reasoningEffort } : {}),
                        }).then(result => result.outcome === 'recorded' ? result.receipt : null);
                    if (!receipt) {
                        round.attention = { stage: 'starting', code: 'task_spawn_unknown', message: '启动接受结果尚未确认。', hint: '保留 request ID；中心只查询原启动回执，不重新派生。' }; save(); return;
                    }
                    round.sessionId = receipt.sessionId;
                    if (receipt.response?.type === 'error') {
                        round.startupFailure = { code: receipt.response.code ?? 'spawn_failed', message: receipt.response.message };
                        if (receipt.response.childStarted === false) {
                            const finishing = this.finishUnstarted(task, round); save();
                            if (!finishing) return;
                        } else {
                            // A child may exist even if readiness failed. Close the exact reserved execution.
                            round.phase = 'stopping'; save();
                        }
                    }
                    save(); // Store the receipt's interpretation together with its reserved session.
                }
                if (round.phase === 'starting') {
                    const session = await execution.waitUntilReady(round.sessionId!);
                    round.nativeSessionId = (task.target.flavor === 'codex' ? session.metadata?.codexSessionId : session.metadata?.claudeSessionId) ?? round.nativeSessionId;
                    round.hostPid = session.metadata?.hostPid; save(); // Persist role before any task input.
                    const prepared = preparedReference(task, round);
                    if (session.metadata?.machineId !== task.target.machineId || session.metadata.path !== task.environment.cwd || session.metadata.flavor !== task.target.flavor
                        || (task.environment.mode === 'shared' && session.metadata.preparedFiles?.operationId !== preparedFiles(task, round)?.operationId)
                        || (prepared && (session.metadata.preparedWorkspace?.environmentId !== prepared.environmentId
                            || session.metadata.preparedWorkspace.preparationId !== prepared.preparationId))) {
                        round.startupFailure = { code: 'execution_target_mismatch', message: 'HAPI 返回的执行目录、机器或 runtime 与绑定目标不一致。' };
                        round.phase = 'stopping'; save();
                    } else if (round.cancellation) {
                        round.phase = 'stopping'; save();
                    } else {
                        round.cursor = await execution.historyHead(session.id);
                        round.permissionBaseline = Object.keys(session.agentState?.requests ?? {});
                        round.phase = 'running'; round.attention = null; save();
                    }
                }
            }
            if (this.closing) return;
            if (round.phase === 'running' && round.cancellation) {
                if (!round.cancellation.controlAttempted) {
                    round.cancellation.controlAttempted = true; save();
                    try {
                        for (const input of inputs) {
                            if (input.delivery === 'pending') continue;
                            const observed = await execution.query(round.sessionId!, input.id, round.cursor);
                            this.observe(input, observed);
                            const fact = input.observation;
                            if (observed.delivery.queuedLocalIds.includes(input.id)) await execution.cancelQueued(round.sessionId!, input.id, round.cursor);
                            else if (fact && !nativeTerminal(fact)) await execution.interrupt(round.sessionId!, input.id, fact.executionId);
                        }
                    } catch (error) { round.cancellation.error = errorDetails(error); }
                }
                round.phase = 'stopping'; save();
            }
            if (round.phase === 'running') {
                for (const input of inputs) {
                    if (input.delivery === 'pending') {
                        input.delivery = 'attempted'; save();
                        const sent = await execution.send(round.sessionId!, { localId: input.id, text: this.prompt(task, round, input) });
                        input.delivery = sent.outcome === 'stored' ? 'stored' : 'unknown'; save();
                    }
                }
                round.attention = null;
                const epochs = new Set<number>();
                for (const input of inputs) {
                    const observed = await execution.query(round.sessionId!, input.id, round.cursor);
                    if (observed.historyCursor) epochs.add(observed.historyCursor.epoch);
                    round.observedAt = input.observedAt = Date.now();
                    round.permissions = Object.fromEntries(Object.entries(observed.permissions).filter(([id]) => !round.permissionBaseline?.includes(id)));
                    round.hostPid = observed.session.metadata?.hostPid ?? round.hostPid;
                    round.nativeSessionId = (task.target.flavor === 'codex' ? observed.session.metadata?.codexSessionId : observed.session.metadata?.claudeSessionId)
                        ?? observed.facts.at(-1)?.observation.nativeSessionId ?? round.nativeSessionId;
                    this.observe(input, observed);
                    if (input.steer) {
                        if (observed.delivery.invokedLocalMessages.some(item => item.localId === input.id)
                            || observed.facts.some(fact => fact.observation.source === 'native' && fact.observation.phase === 'accepted')) {
                            if (input.steer.status !== 'steered') input.steer.status = 'invoked';
                        } else if (observed.delivery.indeterminateLocalIds?.includes(input.id)) input.steer.status = 'unknown';
                        else if (observed.delivery.queuedLocalIds.includes(input.id)) input.steer.status = 'queued';
                        if (!input.steer.attempted && input.messageId && input.steer.status === 'queued') {
                            input.steer.attempted = true; save();
                            try {
                                const result = await execution.steer(round.sessionId!, input.messageId);
                                input.steer.status = result.status === 'failed' ? 'unknown' : result.status;
                                if (result.status === 'failed') input.steer.error = result.error;
                            } catch (error) { input.steer.status = 'unknown'; input.steer.error = errorDetails(error).message; }
                        }
                    }

                    if (!nativeTerminal(input.observation) && (!observed.session.active || input.observation?.phase === 'unknown' || input.delivery !== 'stored' || input.steer?.status === 'unknown')) {
                        round.attention = { stage: 'running', code: 'task_execution_unknown', message: '尚无本轮输入的可靠执行结论。', hint: '查看 HAPI 会话和 Runner；中心不会重复发送输入。' };
                    }
                }
                // All inputs must reconcile the same epoch before we suppress further backfill scans.
                if (round.cursor && epochs.size === 1) round.cursor.epoch = [...epochs][0];
                round.report = [...new Map(inputs.flatMap(input => input.output).map(output => [output.messageId, output.text])).values()].join('\n\n');
                round.structuredReport = parseReport(round.report); round.structuredMissing = !round.structuredReport;
                const permissionIds = Object.keys(round.permissions ?? {});
                if (permissionIds.length) round.attention = { stage: 'running', code: 'permission_required', message: '原生执行正在等待权限响应。', hint: `运行 runweft task show ${id} --round ${round.id} 查看请求，并用 task permission 显式响应。`, permissionIds };
                if (inputs.every(input => nativeTerminal(input.observation))) { round.phase = 'stopping'; round.attention = null; }
                save();
            }
            if (round.phase === 'stopping' && !this.closing) {
                round.stop = 'stopping'; save();
                const stopped = await execution.stop(round.sessionId!);
                if (stopped.outcome !== 'stopped') {
                    round.attention = { ...stopped.error, code: 'task_stop_unknown', stage: 'stopping', hint: '报告已保留；确认停止前不会启动下一轮。' }; save(); return;
                }
                round.stop = 'stopped';
                round.phase = 'finishing';
                if (round.cancellation) {
                    round.cancellation.confirmed = true;
                    try {
                        for (const input of inputs.filter(input => input.delivery !== 'pending')) {
                            const observed = await execution.query(round.sessionId!, input.id, round.cursor);
                            this.observe(input, observed);
                        }
                    } catch (error) { round.cancellation.error = errorDetails(error); }
                    round.report = [...new Map(inputs.flatMap(input => input.output).map(output => [output.messageId, output.text])).values()].join('\n\n');
                    round.structuredReport = parseReport(round.report); round.structuredMissing = !round.structuredReport;
                }
                round.attention = round.startupFailure ? { ...round.startupFailure, stage: 'starting' } : null; round.permissions = {}; save();
            }
            if (round.phase === 'finishing' && !this.closing) {
                if (task.environment.mode === 'worktree' && round.git?.status !== 'sealed' && !await workspaces.finish(task, round, inputs, save)) return;
                if (!await results.advance(task, round, save)) return;
                if (!await outputs.advance(task, round, save)) return;
                await files.releaseAfterStop(task, round, save);
                round.finish = 'complete'; round.phase = 'finished'; round.completedAt = Date.now();
                if (!['artifacts', 'code'].includes(round.attention?.scope ?? '')) round.attention = round.startupFailure ? { ...round.startupFailure, stage: 'starting' } : null; save();
            }
        } catch (error) {
            const problem = errorDetails(error);
            const artifactPhase = round.phase === 'preparing' && !!round.inputFiles && (round.inputFiles.status !== 'ready' || round.attention?.scope === 'artifacts');
            const workspacePhase = !artifactPhase && (round.phase === 'preparing' || round.phase === 'finishing');
            round.attention = { ...problem, stage: round.phase, ...(artifactPhase ? { scope: 'artifacts' as const } : workspacePhase ? { scope: 'workspace' as const } : {}) };
            if (round.phase === 'preparing' && !artifactPhase && round.preparation.mode === 'worktree') round.preparation.status = 'unknown';
            if (round.phase === 'finishing' && round.git && round.git.status !== 'sealed') round.git.status = 'unknown';
            // Preparation and explicit pre-dispatch rejection are business failures, never invented native failures.
            if ((artifactPhase && round.inputFiles?.status === 'failed') || round.phase === 'queued' || (round.phase === 'starting' && !round.sessionId && !['connection_failed', 'invalid_hapi_response', 'request_failed'].includes(problem.code))
                || (round.phase === 'resuming' && ['no_machine_online', 'resume_unavailable', 'access_denied', 'authentication_failed', 'workspace_not_prepared', 'files_not_prepared'].includes(problem.code))) {
                round.startupFailure = problem; this.finishUnstarted(task, round);
                if (artifactPhase) round.attention = { ...problem, scope: 'artifacts', stage: 'preparing' };
            }
            save();
        }
    }
    private finishUnstarted(task: Task, round: Round) {
        round.executionAbsent = true;
        if (round.cancellation) round.cancellation.confirmed = true;
        if (task.environment.mode === 'worktree' && round.preparation.status === 'ready') round.phase = 'finishing';
        else {
            round.phase = round.startupFailure ? 'failed' : 'finished'; round.finish = 'complete'; round.completedAt = Date.now();
            if (round.git) round.git.status = 'not_prepared';
        }
        round.attention = round.startupFailure ? { ...round.startupFailure, stage: 'starting' } : null;
        return round.phase === 'finishing';
    }
    private observe(input: Input, observed: Awaited<ReturnType<ExecutionClient['query']>>) {
        input.observedAt = Date.now();
        if (observed.inputMessageId || observed.facts.length || observed.delivery.queuedLocalIds.includes(input.id)
            || observed.delivery.invokedLocalMessages.some(item => item.localId === input.id)) input.delivery = 'stored';
        if (observed.inputMessageId) input.messageId = observed.inputMessageId;
        const latest = observed.facts.at(-1)?.observation;
        const terminal = [...observed.facts].reverse().find(fact => nativeTerminal(fact.observation))?.observation;
        if (terminal || !nativeTerminal(input.observation)) input.observation = terminal ?? latest ?? input.observation;
        if (observed.output.length) input.output = [...new Map([...input.output, ...observed.output].map(output => [output.messageId, output])).values()];
    }
    private prompt(task: Task, round: Round, input: Input) {
        return [`你是 Runweft 委派的 ${task.agent.definition.name ?? task.agent.id}。`, task.agent.definition.description, task.agent.definition.instructions,
            `工作目录：${task.environment.cwd}\n任务 ${task.id}，轮次 ${round.id}。`,
            task.environment.mode === 'shared' ? '模式：本机共享目录；共享写入由主 agent 调度。'
                : `模式：独立 Git worktree；来源 ${(task.environment.remote?.origin ?? task.environment.source).sourcePath}，固定基线 ${task.environment.source.baseCommit}，本轮起点 ${round.preparation.mode === 'worktree' ? round.preparation.startHead : ''}。\n`
                    + `${(task.environment.remote?.origin ?? task.environment.source).dirty ? '主工作区有未提交改动，未带入本工作区。' : ''}工程指令/skills 来自该基线；未提交或 ignored 内容不会自动复制。\n`
                    + '在此目录完成任务，按需安装依赖；可以自行提交完成的修改。进程停止后 HAPI 会为遗留修改创建 checkpoint 并保留 worktree。不要修改主目录；合入与冲突由主 agent 处理。',
            round.inputFiles?.paths.length ? `本轮输入文件已准备并校验，按以下实际路径读取；不要覆盖这些输入：\n${JSON.stringify(round.inputFiles.paths.map(file => ({ name: file.name, path: file.path, sha256: file.sha256, size: file.size })))}` : '',
            round.outputFiles?.declarations.length ? `本轮约定成果文件：${JSON.stringify(round.outputFiles.declarations)}。在工作目录内按 relativePath 写入，结束后由程序收集；worktree 中未忽略的成果文件会随 Git 封存纳入修改。` : '',
            '请完成以下任务并报告结果。不要通过 Runweft 再次委派；原生内置工具按原有规则使用。', round.reconstruction?.context ?? '', input.text,
            '最后给出完成内容、测试结果和未解决事项；可用 fenced runweft-report JSON，字段 summary、changes、tests、remaining。'].filter(Boolean).join('\n\n');
    }
}
