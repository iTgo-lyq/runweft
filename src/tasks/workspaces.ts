import { isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorkspaceSourceSchema, type PreparedWorkspace, type WorkspaceRequest, type WorkspaceResponse,
    type WorkspaceMutation } from '../../hapi/shared/src/workspaces';
import { HapiClient, HapiRequestError } from '../hapi';
import { RunweftError } from '../errors';
import { nativeTerminal, TaskError, type Task, type Round, type Input } from './types';

type Save = () => void;
export function preparedReference(task: Task, round: Round): PreparedWorkspace | undefined {
    return task.environment.mode === 'worktree' && round.preparation.mode === 'worktree'
        ? { environmentId: task.environment.environmentId, preparationId: round.preparation.preparationId } : undefined;
}

/** Coordinates durable machine operations; Git and process ownership stay in HAPI. */
export class TaskWorkspaces {
    constructor(private readonly hapi: HapiClient, private readonly machineId: string) {}
    private async request(request: WorkspaceRequest): Promise<WorkspaceResponse> {
        return this.hapi.request(`/api/machines/${encodeURIComponent(this.machineId)}/workspaces`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
        });
    }
    async resolve(cwd: string, baseRef: string) {
        const result = await this.request({ action: 'resolve', cwd, baseRef });
        const parsed = WorkspaceSourceSchema.safeParse('source' in result ? result.source : undefined);
        if (!parsed.success || parsed.data.machineId !== this.machineId) throw new RunweftError('invalid_hapi_response', 'HAPI 没有返回发起机的有效 Git 基线。');
        return parsed.data;
    }
    private async receipt(request: WorkspaceMutation, attempted: boolean) {
        let result: WorkspaceResponse;
        if (attempted) {
            try { result = await this.request({ action: 'inspect', environmentId: request.environmentId }); }
            catch (error) {
                if (!(error instanceof HapiRequestError) || error.code !== 'workspace_not_found') throw error;
                // Same durable identity: even a delayed original RPC cannot repeat the operation.
                result = await this.request(request);
            }
        } else result = await this.request(request);
        if (!('workspace' in result) || result.workspace.environmentId !== request.environmentId) throw new RunweftError('invalid_hapi_response', 'HAPI 返回的工作区身份不匹配。');
        const key = request.action === 'prepare' ? `prepare:${request.preparationId}`
            : request.action === 'finalize' ? `finalize:${request.roundId}:${request.attemptId}` : `remove:${request.attemptId}`;
        let operation = result.workspace.operations[key];
        if (!operation && attempted) {
            // The environment exists but this operation may not have reached its Runner.
            const accepted = await this.request(request);
            if (!('workspace' in accepted)) throw new RunweftError('invalid_hapi_response', 'HAPI 未返回工作区操作回执。');
            result = accepted; operation = result.workspace.operations[key];
        }
        if (!operation) throw new RunweftError('invalid_hapi_response', 'HAPI 未返回指定操作的持久回执。');
        return { workspace: result.workspace, operation };
    }
    async prepare(task: Task, round: Round, save: Save) {
        const environment = task.environment, preparation = round.preparation;
        if (environment.mode !== 'worktree' || preparation.mode !== 'worktree' || !preparation.expectedHead) throw new TaskError(409, 'workspace_preparation_missing', '独立任务尚未固定本轮起点。');
        const attempted = preparation.attempted;
        preparation.attempted = true; save();
        const { workspace, operation } = await this.receipt({ action: 'prepare', environmentId: environment.environmentId,
            preparationId: preparation.preparationId, roundId: round.id, source: environment.source,
            expectedHead: preparation.expectedHead, inputs: (round.inputFiles?.downloaded ?? []).map(({ name, path, size, sha256 }) => ({ name, path, size, sha256 })) }, attempted);
        environment.checkout = workspace.checkout; environment.branch = workspace.branch;
        if (operation.status === 'succeeded') {
            const ready = workspace.preparations[preparation.preparationId];
            if (!ready || ready.roundId !== round.id || ready.startHead !== preparation.expectedHead) throw new RunweftError('invalid_hapi_response', 'HAPI 的准备结果与本轮固定基线不一致。');
            if (round.inputFiles) {
                if (ready.inputs.length !== round.inputFiles.files.length) throw new RunweftError('invalid_hapi_response', '工作区输入数量与本轮不一致。');
                round.inputFiles.paths = round.inputFiles.files.map(file => {
                    const mapped = ready.inputs.find(input => input.name === file.name);
                    if (!mapped || !isAbsolute(mapped.path) || mapped.size !== file.size || mapped.sha256 !== file.sha256) throw new RunweftError('invalid_hapi_response', '工作区输入路径或摘要与本轮不一致。');
                    return { ...file, path: mapped.path };
                });
            }
            preparation.status = 'ready'; preparation.startHead = ready.startHead; preparation.checkedAt = ready.readyAt;
            environment.cwd = ready.cwd;
            round.attention = null; save(); return true;
        }
        preparation.status = operation.status === 'failed' ? 'failed' : operation.status === 'unknown' ? 'unknown' : 'accepted';
        round.attention = operation.error ? { ...operation.error, scope: 'workspace', stage: 'preparing',
            hint: `${operation.error.hint ?? ''}\n保留目录：${workspace.checkout}；原生任务尚未启动。`.trim() } : null;
        if (operation.status === 'failed') {
            round.executionAbsent = true; round.phase = round.cancellation ? 'finished' : 'failed'; round.finish = 'complete'; round.completedAt = Date.now();
            if (round.git) round.git.status = 'not_prepared';
            if (round.cancellation) round.cancellation.confirmed = true;
        }
        save(); return false;
    }
    async finish(task: Task, round: Round, inputs: Input[], save: Save) {
        const environment = task.environment, preparation = round.preparation, delivery = round.git;
        if (environment.mode !== 'worktree' || preparation.mode !== 'worktree' || !delivery
            || (!round.executionAbsent && (!round.sessionId || round.stop !== 'stopped'))) {
            throw new TaskError(409, 'workspace_finish_unavailable', '只有已准备且确认停止的独立任务才能封存。');
        }
        if (delivery.status === 'needs_attention') return false;
        delivery.attemptId ??= randomUUID();
        delivery.partial ??= !!round.cancellation || !!round.startupFailure || inputs.some(input => !nativeTerminal(input.observation) || input.observation?.phase !== 'completed');
        const attempted = delivery.attempted;
        delivery.attempted = true; if (delivery.status === 'pending') delivery.status = 'sealing'; save();
        const { workspace, operation } = await this.receipt({ action: 'finalize', environmentId: environment.environmentId,
            preparationId: preparation.preparationId, roundId: round.id, attemptId: delivery.attemptId,
            ...(round.executionAbsent ? {} : { sessionId: round.sessionId }), partial: delivery.partial }, attempted);
        if (operation.status === 'succeeded') {
            const result = workspace.results[round.id];
            if (!result || result.environmentId !== environment.environmentId || result.startHead !== preparation.startHead) throw new RunweftError('invalid_hapi_response', 'HAPI 的 Git 成果与本轮不匹配。');
            delivery.result = result; delivery.status = 'sealed'; delete delivery.error;
            round.attention = null; save(); return true;
        }
        delivery.status = operation.status === 'failed' ? 'needs_attention' : operation.status === 'unknown' ? 'unknown' : 'sealing';
        delivery.error = operation.error;
        round.attention = operation.error ? { ...operation.error, scope: 'workspace', stage: 'finishing',
            hint: `${operation.error.hint ?? ''}\n保留目录：${workspace.checkout}\n修复或手工提交后运行 runweft task retry-finish ${task.id} --round ${round.id}；不会重新执行任务。`.trim() } : null;
        save(); return false;
    }
    retry(round: Round) {
        if (round.phase !== 'finishing' || (!round.executionAbsent && round.stop !== 'stopped') || !round.git) throw new TaskError(409, 'workspace_finish_unavailable', '指定轮次不在待收尾状态。');
        if (round.git.status !== 'needs_attention') throw new TaskError(409, 'workspace_finish_pending', '当前 Git 操作尚未确认失败，中心会继续查询原回执。', '确认原操作及其进程状态后再重试；不会重复 commit 或 hook。');
        round.git = { status: 'pending', attempted: false, attemptId: randomUUID(), partial: round.git.partial };
        round.attention = null;
    }
    async remove(task: Task, save: Save) {
        const environment = task.environment;
        if (environment.mode !== 'worktree' || environment.status !== 'deleting' || !environment.removal) throw new TaskError(409, 'workspace_remove_unavailable', '没有已接受的工作区删除请求。');
        const removal = environment.removal, attempted = removal.attempted;
        removal.attempted = true; save();
        const { workspace, operation } = await this.receipt({ action: 'remove', environmentId: environment.environmentId,
            attemptId: removal.attemptId, expectedHead: removal.expectedHead, discardIgnored: removal.discardIgnored }, attempted);
        removal.status = operation.status === 'accepted' ? 'running' : operation.status;
        removal.error = operation.error ? { ...operation.error,
            hint: `${operation.error.hint ?? ''}\n${operation.status === 'failed'
                ? operation.error.code === 'workspace_ignored_files' ? `确认可丢弃这些 ignored 文件后运行 runweft task workspace remove ${task.id} --discard-ignored。`
                    : `保留目录：${workspace.checkout}；修复后再次运行 runweft task workspace remove ${task.id}。`
                : '中心继续查询原删除回执；未知操作不会换新身份重发。'}`.trim() } : undefined;
        if (operation.status === 'succeeded') {
            if (workspace.status !== 'removed') throw new RunweftError('invalid_hapi_response', '删除回执与工作区留存状态不一致。');
            environment.status = 'removed';
        } else if (operation.status === 'failed') environment.status = 'retained';
        save();
    }
}
