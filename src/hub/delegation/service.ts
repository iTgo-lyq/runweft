import type { z } from 'zod';
import type { HapiHttp } from '../../hapi';
import { TaskCoordinator, type ResolvedAcceptance } from '../../tasks/coordinator';
import { TaskWorkspaces } from '../../tasks/workspaces';
import { TaskError, parseTask, SendSchema, type Parent, type Round, type Task, type AgentSnapshot } from '../../tasks/types';
import { WorkspacePreparations } from '../../remote/service';
import type { Preparation } from '../../remote/types';
import type { createConfigurationGateway } from '../configuration/gateway';
import type { ExecutionObject } from '../access/types';
import type { AuthorizationLease } from '../access/transport';
import { fingerprint } from '../access/transport';
import { HubError, hubNotFound } from '../types';
import { DelegationScopes, agentSnapshot } from './context';
import { DelegationNativeClient } from './native';
import { HubSpawn, HubSpawnIntent, HubPreparation, taskIntent } from './types';

type Configuration = Pick<Awaited<ReturnType<typeof createConfigurationGateway>>, 'store' | 'resources' | 'native' | 'repositories' | 'agents' | 'selections' | 'resolver'>;
export class HubDelegationService {
    readonly scopes: DelegationScopes;
    readonly coordinator: TaskCoordinator;
    readonly preparations: WorkspacePreparations;
    constructor(readonly path: string, readonly config: Configuration, pollMs = 1000) {
        this.scopes = new DelegationScopes(config.store);
        const store = { db: config.store.db, ownsScope: (namespace: string) => this.scopes.has(namespace), accepted: (task: Task) => {
            const round = { agent: task.agent } as Round; this.check(task, round);
            config.store.bind({ kind: 'task', id: task.id, ownerId: task.hub!.ownerId, spaceId: task.hub!.spaceId, machineId: task.target.machineId });
        } };
        this.preparations = new WorkspacePreparations(path, (namespace, record) => record ? this.preparationClient(record) : this.scopeClient(namespace), pollMs, { store });
        this.coordinator = new TaskCoordinator(path, (namespace, task, round) => task ? this.taskClient(task, round) : this.scopeClient(namespace), pollMs, this.preparations.baselines,
            { store, check: (task, round) => this.check(task, round), target: (task, round) => config.resources.resolve(this.scopes.lease(task.namespace, () => this.check(task, round)), task.target.runtimeId) });
    }
    start() { this.preparations.start(); this.coordinator.start(); }
    async close() { await this.coordinator.close(); await this.preparations.close(); }
    scope(lease: AuthorizationLease) { lease.check(); return this.scopes.ensure(lease.actor); }
    parent(lease: AuthorizationLease, parent: Parent) {
        lease.add(() => this.source(lease.actor.ownerId, lease.actor.spaceId!, parent.machineId));
        this.coordinator.store.assertCanDelegate(this.scope(lease), parent);
    }
    private source(ownerId: string, spaceId: string, machineId: string) {
        const actor = this.config.store.serviceUser(ownerId, spaceId);
        const machine = this.config.resources.store.ownMachine(actor, machineId);
        if (!machine.registered || this.config.resources.store.blocked(spaceId, 'machine', machineId)) throw new HubError(403, 'source_machine_unavailable', '发起机器未登记或已被当前空间停用。');
    }
    private snapshot(namespace: string, parent: Parent, snapshot: AgentSnapshot | Preparation['agent']) {
        const scope = this.scopes.get(namespace), hub = snapshot.hub;
        if (!hub || hub.actorId !== scope.ownerId || hub.spaceId !== scope.spaceId || snapshot.namespace !== namespace) throw hubNotFound();
        const actor = this.config.store.serviceUser(scope.ownerId, scope.spaceId);
        this.source(scope.ownerId, scope.spaceId, parent.machineId);
        if (hub.hubRepositoryId) this.config.repositories.requireRegistered(actor, hub.hubRepositoryId);
        const allowed = this.config.agents.invocable(scope.ownerId, scope.spaceId, hub.agentId, hub.hubRepositoryId);
        if (!allowed.eligible) throw new HubError(403, allowed.reason!.code, allowed.reason!.message, allowed.reason!.hint);
        this.config.resources.store.requireUsable(scope.ownerId, scope.spaceId, snapshot.runtimeId);
        const runtime = this.config.resources.store.runtime(actor, snapshot.runtimeId);
        if (runtime.machineId !== snapshot.machineId || runtime.flavor !== snapshot.flavor) throw new HubError(409, 'task_target_changed', '任务固定执行目标已改变，请创建新任务。');
        return scope;
    }
    check(task: Task, round: Round) {
        if (!task.hub) throw hubNotFound();
        const scope = this.snapshot(task.namespace, task.parent, round.agent);
        if (task.hub.ownerId !== scope.ownerId || task.hub.spaceId !== scope.spaceId
            || task.hub.hubRepositoryId !== round.agent.hub.hubRepositoryId) throw hubNotFound();
    }
    execution(binding?: ExecutionObject) {
        if (!binding?.taskId) return;
        const ns = this.config.store.db.query('SELECT namespace FROM delegation_tasks WHERE id=?').get(binding.taskId) as { namespace: string } | null;
        if (!ns) throw hubNotFound();
        const { task, rounds } = this.coordinator.store.require(ns.namespace, binding.taskId);
        if (task.hub.ownerId !== binding.ownerId || task.hub.spaceId !== binding.spaceId || task.target.machineId !== binding.machineId) throw hubNotFound();
        this.check(task, rounds.find(round => !['finished', 'failed'].includes(round.phase)) ?? rounds.at(-1)!);
    }
    sessionPolicy(binding: ExecutionObject, method: string, suffix: string) {
        if (!binding.taskId || method === 'GET') return;
        if (method === 'POST' && ['resume', 'reopen', 'fork', 'clear', 'messages', 'model', 'model-reasoning-effort', 'effort', 'collaboration-mode', 'codex/plan/implement'].includes(suffix)
            || /^messages\/[^/]+\/(steer|retry)$/.test(suffix)) {
            throw new HubError(409, 'managed_task_control_required', '此会话由委派协调器管理。', '通过 task send/interrupt 操作轮次；新启动参数在 next 接受时解析。');
        }
        if (!['archive', 'abort', 'execution/interrupt'].includes(suffix)) this.execution(binding);
    }
    taskClient(task: Task, round?: Round) {
        const scope = this.scopes.get(task.namespace);
        if (!task.hub || task.hub.ownerId !== scope.ownerId || task.hub.spaceId !== scope.spaceId) throw hubNotFound();
        return new DelegationNativeClient(this.config.resources.store, this.config.native, { ...scope, sourceMachineId: task.parent.machineId,
            taskId: task.id, roundId: round?.id, target: task.target,
            check: operation => { if (operation === 'work') this.check(task, round ?? { agent: task.agent } as Round); } });
    }
    private preparationClient(record: Preparation) {
        return new DelegationNativeClient(this.config.resources.store, this.config.native, { ...this.scopes.get(record.namespace), sourceMachineId: record.parent.machineId,
            target: record.agent, check: () => { this.snapshot(record.namespace, record.parent, record.agent); } });
    }
    /** Baselines are shared within an owned scope, with machine calls limited to accepted consumers. */
    private scopeClient(namespace: string): HapiHttp {
        const scope = this.scopes.get(namespace);
        const files = new DelegationNativeClient(this.config.resources.store, this.config.native, { ...scope, sourceMachineId: '',
            check: () => { this.config.store.serviceUser(scope.ownerId, scope.spaceId); } });
        const forPath = (path: string, options?: RequestInit): HapiHttp => {
            const match = /^\/api\/machines\/([^/]+)\//.exec(path);
            if (!match) return files;
            const machineId = decodeURIComponent(match[1]);
            let operationId: string | undefined;
            try { operationId = JSON.parse(String(options?.body)).operationId; } catch { throw hubNotFound(); }
            if (!operationId) throw hubNotFound();
            const snapshots = this.preparations.store.snapshots().filter(row => row.namespace === namespace);
            const imports = this.preparations.store.imports().filter(row => row.namespace === namespace && row.machineId === machineId);
            const imported = imports.find(row => row.operationId === operationId || row.batches?.some(batch => batch.operationId === operationId));
            const snapshot = imported ? snapshots.find(row => row.id === imported.snapshotId) : snapshots.find(row => row.origin.machineId === machineId
                && (row.exportId === operationId || row.batches?.some(batch => batch.captureId === operationId || batch.deliveryId === operationId)));
            if (!snapshot) throw hubNotFound();
            for (const consumer of this.preparations.store.consumers(snapshot.id).filter(row => !imported || row.importId === imported.id)) {
                if (consumer.kind === 'task') {
                    let bundle;
                    try { bundle = this.coordinator.store.require(namespace, consumer.owner); }
                    catch (error) { if (error instanceof TaskError && error.code === 'state_record_invalid') continue; throw error; }
                    const { task, rounds } = bundle;
                    const round = rounds.find(r => !['finished', 'failed'].includes(r.phase)) ?? rounds.at(-1)!;
                    try { this.check(task, round); } catch { continue; }
                    return new DelegationNativeClient(this.config.resources.store, this.config.native, { ...scope, sourceMachineId: task.parent.machineId,
                        target: task.target, check: () => this.check(task, round) });
                }
                if (consumer.kind === 'diagnostic') {
                    const record = this.preparations.store.preparation(namespace, consumer.owner);
                    try { this.snapshot(namespace, record.parent, record.agent); } catch { continue; }
                    return this.preparationClient(record);
                }
            }
            throw new HubError(403, 'baseline_consumer_unavailable', '此基线机器操作已无可调用的中心消费者。', '原记录与候选保留；恢复原资源授权后再检查。');
        };
        return { request: (path, options) => forPath(path, options).request(path, options), response: (path, options) => forPath(path, options).response(path, options),
            releaseOutputs: ids => files.releaseOutputs(ids) };
    }
    private async resolve(lease: AuthorizationLease, namespace: string, parent: Parent, intent: z.infer<typeof HubSpawnIntent>): Promise<ResolvedAcceptance> {
        if (intent.observation.cwd !== parent.cwd) throw new HubError(409, 'repository_observation_mismatch', 'Git 观察必须来自本次主会话工作目录。');
        const matchInput = { machineId: parent.machineId, observation: intent.observation, remote: intent.remote };
        const matched = this.config.repositories.match(lease.actor, matchInput);
        if (!['matched', 'non_git'].includes(matched.status)) throw new HubError(409, `repository_${matched.status}`, '当前工作区尚未唯一关联 Hub 仓库。', '先检查 repository match 并显式绑定个人 checkout。');
        const hubRepositoryId = matched.status === 'matched' ? matched.repository.id : null;
        lease.add(() => {
            const current = this.config.repositories.match(lease.actor, matchInput);
            if (fingerprint(current) !== fingerprint(matched)) throw new HubError(409, 'repository_binding_changed', '接受期间仓库关联已变化，请重新观察并解析。');
        });
        const resolved = await this.config.resolver.resolve(lease, { hubRepositoryId, agentId: intent.agentId, runtimeId: intent.runtimeId });
        const agent = agentSnapshot(namespace, resolved);
        const client = new DelegationNativeClient(this.config.resources.store, this.config.native, { ownerId: lease.actor.ownerId, spaceId: lease.actor.spaceId!,
            sourceMachineId: parent.machineId, target: resolved.target, check: () => lease.check() });
        let source;
        if (intent.observation.kind === 'git') {
            source = await new TaskWorkspaces(client, parent.machineId).resolve(parent.cwd, intent.baseRef ?? 'HEAD');
            const seen = intent.observation;
            if (source.machineId !== parent.machineId || source.sourcePath !== seen.cwd || source.repositoryRoot !== seen.repositoryRoot
                || source.commonDir !== seen.gitCommonDir || source.objectFormat !== seen.objectFormat) throw new HubError(409, 'repository_observation_mismatch', '实际 Git 工作区与客户端观察不一致，请重新观察。');
        } else if (intent.workspaceMode === 'worktree') throw new HubError(409, 'workspace_git_required', '独立 worktree 任务需要 Git 管控的主工作区。');
        lease.check(); return { agent, target: resolved.target, source: intent.workspaceMode === 'worktree' ? source : undefined, client, check: () => lease.check() };
    }
    async spawn(lease: AuthorizationLease, value: unknown) {
        const input = parseTask(HubSpawn, value), namespace = this.scope(lease); this.parent(lease, input.parent);
        return this.coordinator.acceptResolved(namespace, { ...input, intent: taskIntent(input.intent) }, () => this.resolve(lease, namespace, input.parent, input.intent));
    }
    lookup(lease: AuthorizationLease, value: unknown) {
        const input = parseTask(HubSpawn, value), namespace = this.scope(lease); this.parent(lease, input.parent);
        return this.coordinator.store.lookup(namespace, input.parent, input.requestId, taskIntent(input.intent));
    }
    async send(lease: AuthorizationLease, value: unknown) {
        const input = parseTask(SendSchema, value), namespace = this.scope(lease); this.parent(lease, input.parent);
        return this.coordinator.send(namespace, input, async (task, previous) => {
            const saved = previous.agent.hub; if (!saved) throw hubNotFound();
            const resolved = await this.config.resolver.resolve(lease, { hubRepositoryId: task.hub!.hubRepositoryId, agentId: saved.agentId,
                ...(saved.selection.runtime === 'explicit' ? { runtimeId: saved.target.runtimeId } : {}) });
            if (resolved.target.runtimeId !== task.target.runtimeId || resolved.target.machineId !== task.target.machineId || resolved.target.flavor !== task.target.flavor) {
                throw new HubError(409, 'task_target_changed', '重新解析的执行目标与任务工作区不兼容，请创建新任务。');
            }
            return { agent: agentSnapshot(namespace, resolved), check: () => lease.check() };
        });
    }
    async prepare(lease: AuthorizationLease, value: unknown, lookup = false) {
        const input = parseTask(HubPreparation, value), namespace = this.scope(lease); this.parent(lease, input.parent);
        const intent = { agent: input.intent.agentId ?? 'default', baseRef: input.intent.baseRef, hubRequest: input.intent };
        if (lookup) {
            const found = this.preparations.store.lookup(namespace, input.parent, input.requestId, intent);
            return found ? this.preparations.inspect(namespace, input.parent, found.id) : null;
        }
        return this.preparations.acceptResolved(namespace, { ...input, intent }, () => this.resolve(lease, namespace, input.parent,
            { ...input.intent, message: '工作区准备', workspaceMode: 'worktree' }));
    }
}
