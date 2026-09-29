import { setTimeout as delay } from 'node:timers/promises';
import { ExecutionClient } from '../execution';
import { errorDetails } from '../errors';
import type { HapiClient } from '../hapi';
import { ResourceStore } from '../resources/store';
import { ResourceService } from '../resources/service';
import type { ExecutionTarget } from '../resources/types';
import { TaskStore } from './store';
import { AcceptSchema, LookupSchema, nativeTerminal, parseTask, TaskError, type Input, type Parent, type Round, type Task } from './types';
import { detail, overview } from './views';

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
        const work = this.advance(namespace, id).catch(error => {
            // Domain failures are stored below; this is an outer storage/runtime failure.
            console.error(JSON.stringify({ code: 'task_coordinator_failed', taskId: id, error: errorDetails(error) }));
        }).finally(() => { this.working.delete(id); });
        this.working.set(id, work);
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
        this.requireShared(target, parent);
        const accepted = this.store.accept(namespace, parent, requestId, intent, agent, target);
        this.kick(namespace, accepted.agent_id);
        return accepted;
    }
    private requireShared(target: ExecutionTarget, parent: Parent) {
        if (target.machineId !== parent.machineId) throw new TaskError(409, 'shared_target_required', '共享目录任务只能在发起机执行，Hub 模式也需要同机 runtime。', '绑定本机 runtime；独立工作区与远端模式将在后续能力就绪后开放。');
    }
    list(namespace: string, parent: Parent, all = false) {
        return { agents: this.store.list(namespace, parent, all).map(bundle => ({ ...overview(bundle),
            accepted_requests: bundle.rounds.slice(-20).map(round => ({ request_id: round.requestId, round_id: round.id, created_at: round.createdAt })) })) };
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
                return overview(bundle, round);
            });
            const ready = agents.some(agent => agent.status !== 'running' && (after[agent.agent_id] === undefined || agent.revision > after[agent.agent_id]));
            if (ready || Date.now() >= deadline) return { agents, timed_out: !ready };
            await delay(Math.min(200, Math.max(1, deadline - Date.now())), undefined, { signal });
        }
    }
    private async advance(namespace: string, id: string) {
        const { task, rounds, inputs: allInputs } = this.store.require(namespace, id);
        const round = rounds.find(round => !['finished', 'failed'].includes(round.phase));
        if (!round) return;
        const inputs = allInputs.filter(input => input.roundId === round.id);
        const execution = new ExecutionClient(this.client(namespace));
        const save = () => this.store.save(task, round, inputs);
        try {
            if (round.phase === 'queued') {
                const target = await this.resourceService(namespace).resolveExecutionTarget(task.target.runtimeId);
                this.requireShared(target, task.parent);
                if (target.machineId !== task.target.machineId || target.flavor !== task.target.flavor) throw new TaskError(409, 'task_target_changed', '已接受任务的固定 runtime 目标不一致。');
                round.preparation = { mode: 'shared', status: 'ready', checkedAt: Date.now() };
                round.phase = 'starting'; round.attention = null; save();
            }
            if (this.closing) return;
            if (round.phase === 'starting') {
                if (!round.sessionId) {
                    const attempted = round.spawnAttempted;
                    round.spawnAttempted = true; save();
                    const definition = task.agent.definition;
                    const receipt = attempted ? await execution.lookupStart(task.target.machineId, round.spawnRequestId)
                        : await execution.start(task.target.machineId, {
                            requestId: round.spawnRequestId, directory: task.environment.cwd, agent: task.target.flavor,
                            disabledMcpServers: ['runweft'], startingMode: 'remote',
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
                            round.phase = 'failed'; round.completedAt = Date.now(); round.attention = { ...round.startupFailure, stage: 'starting' }; save(); return;
                        }
                        // A child may exist even if readiness failed. Close the exact reserved execution.
                        round.phase = 'stopping'; save();
                    }
                    save(); // Store the receipt's interpretation together with its reserved session.
                }
                if (round.phase === 'starting') {
                    const session = await execution.waitUntilReady(round.sessionId!);
                    round.nativeSessionId = task.target.flavor === 'codex' ? session.metadata?.codexSessionId : session.metadata?.claudeSessionId;
                    round.hostPid = session.metadata?.hostPid; save(); // Persist role before any task input.
                    if (session.metadata?.machineId !== task.target.machineId || session.metadata.path !== task.environment.cwd || session.metadata.flavor !== task.target.flavor) {
                        round.startupFailure = { code: 'execution_target_mismatch', message: 'HAPI 返回的执行目录、机器或 runtime 与绑定目标不一致。' };
                        round.phase = 'stopping'; save();
                    } else {
                        round.cursor = await execution.historyHead(session.id);
                        round.phase = 'running'; round.attention = null; save();
                    }
                }
            }
            if (this.closing) return;
            if (round.phase === 'running') {
                for (const input of inputs) {
                    if (input.delivery === 'pending') {
                        input.delivery = 'attempted'; save();
                        const sent = await execution.send(round.sessionId!, { localId: input.id, text: this.prompt(task, round, input) });
                        input.delivery = sent.outcome === 'stored' ? 'stored' : 'unknown'; save();
                    }
                }
                round.attention = null;
                for (const input of inputs) {
                    const observed = await execution.query(round.sessionId!, input.id, round.cursor);
                    round.observedAt = input.observedAt = Date.now();
                    round.permissions = observed.permissions;
                    round.hostPid = observed.session.metadata?.hostPid ?? round.hostPid;
                    round.nativeSessionId = task.target.flavor === 'codex' ? observed.session.metadata?.codexSessionId : observed.session.metadata?.claudeSessionId;
                    if (observed.inputMessageId || observed.facts.length || observed.delivery.queuedLocalIds.includes(input.id)
                        || observed.delivery.invokedLocalMessages.some(item => item.localId === input.id)) input.delivery = 'stored';
                    if (observed.inputMessageId) input.messageId = observed.inputMessageId;
                    const latest = observed.facts.at(-1)?.observation;
                    const terminal = [...observed.facts].reverse().find(fact => nativeTerminal(fact.observation))?.observation;
                    if (terminal || !nativeTerminal(input.observation)) input.observation = terminal ?? latest ?? input.observation;
                    if (observed.output.length) input.output = observed.output;
                    if (!nativeTerminal(input.observation) && (!observed.session.active || input.observation?.phase === 'unknown' || input.delivery !== 'stored')) {
                        round.attention = { stage: 'running', code: 'task_execution_unknown', message: '尚无本轮输入的可靠执行结论。', hint: '查看 HAPI 会话和 Runner；中心不会重复发送输入。' };
                    }
                }
                round.report = [...new Map(inputs.flatMap(input => input.output).map(output => [output.messageId, output.text])).values()].join('\n\n');
                const permissionIds = Object.keys(round.permissions ?? {});
                if (permissionIds.length) round.attention = { stage: 'running', code: 'permission_required', message: '原生执行正在等待权限响应。', hint: '在 HAPI 会话中处理当前请求。', permissionIds };
                if (inputs.every(input => nativeTerminal(input.observation))) { round.phase = 'stopping'; round.attention = null; }
                save();
            }
            if (round.phase === 'stopping' && !this.closing) {
                round.stop = 'stopping'; save();
                const stopped = await execution.stop(round.sessionId!);
                if (stopped.outcome !== 'stopped') {
                    round.attention = { ...stopped.error, code: 'task_stop_unknown', stage: 'stopping', hint: '报告已保留；确认停止前不会启动下一轮。' }; save(); return;
                }
                round.stop = 'stopped'; round.finish = 'complete'; round.phase = 'finished'; round.completedAt = Date.now();
                round.attention = round.startupFailure ? { ...round.startupFailure, stage: 'starting' } : null; round.permissions = {}; save();
            }
        } catch (error) {
            const problem = errorDetails(error);
            round.attention = { ...problem, stage: round.phase };
            // Preparation and explicit pre-dispatch rejection are business failures, never invented native failures.
            if (round.phase === 'queued' || (round.phase === 'starting' && !round.sessionId && !['connection_failed', 'invalid_hapi_response', 'request_failed'].includes(problem.code))) {
                round.phase = 'failed'; round.completedAt = Date.now();
            }
            save();
        }
    }
    private prompt(task: Task, round: Round, input: Input) {
        return [`你是 Runweft 委派的 ${task.agent.definition.name ?? task.agent.id}。`, task.agent.definition.description, task.agent.definition.instructions,
            `工作目录：${task.environment.cwd}\n模式：本机共享目录；共享写入由主 agent 调度。任务 ${task.id}，轮次 ${round.id}。`,
            '请完成以下任务并报告结果。不要通过 Runweft 再次委派；原生内置工具按原有规则使用。', input.text,
            '最后给出完成内容、测试结果和未解决事项；可用 fenced runweft-report JSON，字段 summary、changes、tests、remaining。'].filter(Boolean).join('\n\n');
    }
}
