import { setTimeout as delay } from 'node:timers/promises';
import { ExecutionClient } from '../execution';
import { errorDetails } from '../errors';
import type { HapiClient } from '../hapi';
import { ResourceStore } from '../resources/store';
import { ResourceService } from '../resources/service';
import type { ExecutionTarget } from '../resources/types';
import { TaskStore } from './store';
import { AcceptSchema, LookupSchema, SendSchema, InterruptSchema, PermissionSchema, RemoveWorkspaceSchema, nativeTerminal, parseTask, TaskError, type Input, type Parent, type Round, type Task } from './types';
import { detail, overview } from './views';
import { historyContext, parseReport } from './reports';
import { TaskWorkspaces, preparedReference } from './workspaces';
import { TaskFiles, preparedFiles } from './files';

export class TaskCoordinator {
    readonly store: TaskStore;
    private readonly resources: ResourceStore;
    private readonly clients = new Map<string, HapiClient>();
    private readonly working = new Map<string, Promise<void>>();
    private timer?: ReturnType<typeof setInterval>;
    private closing = false;
    constructor(path: string, private readonly clientFor: (namespace: string) => HapiClient, private readonly pollMs = 1000) {
        this.store = new TaskStore(path); this.resources = new ResourceStore(path);
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
        this.store.close(); this.resources.close();
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
            this.requireLocal(target, parent, intent.workspaceMode);
            const source = intent.workspaceMode === 'worktree' ? await new TaskWorkspaces(this.client(namespace), target.machineId).resolve(parent.cwd, intent.baseRef) : undefined;
            if (this.closing) throw new TaskError(503, 'service_stopping', '服务正在停止；请用同一 request ID 查询接受结果。');
            const accepted = await new TaskFiles(this.client(namespace)).accept(this.store, namespace, parent, requestId, intent,
                () => this.store.accept(namespace, parent, requestId, intent, agent, target, source));
            this.kick(namespace, accepted.agent_id);
            return accepted;
        });
    }

    private requireLocal(target: ExecutionTarget, parent: Parent, mode: Task['environment']['mode']) {
        if (target.machineId !== parent.machineId) throw new TaskError(409, mode === 'shared' ? 'shared_target_required' : 'remote_workspace_unavailable',
            '当前任务需要发起机上的 runtime，Hub 模式也支持同机执行。', '绑定本机 runtime；跨机工作区准备与结果回收尚未交付。');
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
            this.store.require(namespace, intent.id, parent);
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
                    : bundle.rounds.find(round => (round.completedRevision ?? 0) > after[id]) ?? bundle.rounds.at(-1)!;
                const view = overview(bundle, round);
                return after[id] !== undefined && (round.completedRevision ?? 0) > after[id]
                    ? { ...view, revision: round.completedRevision!, current_revision: bundle.task.revision } : { ...view, current_revision: bundle.task.revision };
            });
            const ready = agents.some(agent => agent.status !== 'running' && (after[agent.agent_id] === undefined
                || (['completed', 'failed', 'interrupted'].includes(agent.status) ? (agent.completed_revision ?? 0) > after[agent.agent_id] : agent.revision > after[agent.agent_id])));
            if (ready || Date.now() >= deadline) return { agents, timed_out: !ready };
            await delay(Math.min(200, Math.max(1, deadline - Date.now())), undefined, { signal });
        }
    }
    private async advance(namespace: string, id: string) {
        const { task, rounds, inputs: allInputs } = this.store.require(namespace, id);
        const workspaces = new TaskWorkspaces(this.client(namespace), task.target.machineId);
        const files = new TaskFiles(this.client(namespace));
        if (task.environment.mode === 'worktree' && task.environment.status === 'deleting') {
            try { await workspaces.remove(task, () => this.store.saveEnvironment(task)); }
            catch (error) {
                task.environment.removal!.status = 'unknown'; task.environment.removal!.error = errorDetails(error);
                this.store.saveEnvironment(task);
            }
            return;
        }
        const round = rounds.find(round => !['finished', 'failed'].includes(round.phase));
        if (!round) return;
        const inputs = allInputs.filter(input => input.roundId === round.id);
        const execution = new ExecutionClient(this.client(namespace));
        const save = () => this.store.save(task, round, inputs);
        try {
            if (round.phase === 'queued') {
                const target = await this.resourceService(namespace).resolveExecutionTarget(task.target.runtimeId);
                this.requireLocal(target, task.parent, task.environment.mode);
                if (target.machineId !== task.target.machineId || target.flavor !== task.target.flavor) throw new TaskError(409, 'task_target_changed', '已接受任务的固定 runtime 目标不一致。');
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
                if (task.environment.mode === 'worktree') round.phase = 'finishing';
                else { round.finish = 'complete'; round.phase = 'finished'; round.completedAt = Date.now(); }
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
            if (round.phase === 'finishing' && !this.closing && await workspaces.finish(task, round, inputs, save)) {
                round.finish = 'complete'; round.phase = 'finished'; round.completedAt = Date.now();
                round.attention = round.startupFailure ? { ...round.startupFailure, stage: 'starting' } : null; save();
            }
        } catch (error) {
            const problem = errorDetails(error);
            const artifactPhase = round.phase === 'preparing' && !!round.inputFiles && (round.inputFiles.status !== 'ready' || round.attention?.scope === 'artifacts');
            const workspacePhase = !artifactPhase && (round.phase === 'preparing' || round.phase === 'finishing');
            round.attention = { ...problem, stage: round.phase, ...(artifactPhase ? { scope: 'artifacts' as const } : workspacePhase ? { scope: 'workspace' as const } : {}) };
            if (round.phase === 'preparing' && !artifactPhase && round.preparation.mode === 'worktree') round.preparation.status = 'unknown';
            if (round.phase === 'finishing' && round.git) round.git.status = 'unknown';
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
                : `模式：独立 Git worktree；来源 ${task.environment.source.sourcePath}，固定基线 ${task.environment.source.baseCommit}，本轮起点 ${round.preparation.mode === 'worktree' ? round.preparation.startHead : ''}。\n`
                    + `${task.environment.source.dirty ? '主工作区有未提交改动，未带入本工作区。' : ''}工程指令/skills 来自该基线；未提交或 ignored 内容不会自动复制。\n`
                    + '在此目录完成任务，按需安装依赖；可以自行提交完成的修改。进程停止后 HAPI 会为遗留修改创建 checkpoint 并保留 worktree。不要修改主目录；合入与冲突由主 agent 处理。',
            round.inputFiles?.paths.length ? `本轮输入文件已准备并校验，按以下实际路径读取；不要覆盖这些输入：\n${JSON.stringify(round.inputFiles.paths.map(file => ({ name: file.name, path: file.path, sha256: file.sha256, size: file.size })))}` : '',
            '请完成以下任务并报告结果。不要通过 Runweft 再次委派；原生内置工具按原有规则使用。', round.reconstruction?.context ?? '', input.text,
            '最后给出完成内容、测试结果和未解决事项；可用 fenced runweft-report JSON，字段 summary、changes、tests、remaining。'].filter(Boolean).join('\n\n');
    }
}
