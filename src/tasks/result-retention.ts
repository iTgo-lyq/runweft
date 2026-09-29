import type { ArtifactTransfer } from '../../hapi/shared/src/artifactTransfers';
import type { RepositoryOperation } from '../../hapi/shared/src/repositories';
import { ArtifactClient } from '../artifacts/client';
import { errorDetails } from '../errors';
import { HapiRequestError, type HapiClient } from '../hapi';
import { RepositoryTransfers, invalid } from '../remote/transfers';
import type { Problem } from '../resources/types';
import { resultReference, type CodeFetch } from './result-types';
import { TaskError, type Round, type Task, type TaskBundle } from './types';

export type CodeRetention = {
    state: 'releasing' | 'released' | 'discarded'; createdAt: number; completedAt?: number;
    discardPending: boolean; unpublished: boolean; references: { artifactId: string; done: boolean }[];
    copies: { machineId: string; domain: 'repositories' | 'artifacts'; operationId: string; done: boolean }[];
    error?: Problem;
};
export function assertResultReleaseIdle(bundle: TaskBundle, selected: Round[], discardPending: boolean) {
    if (bundle.task.environment.mode !== 'worktree' || !bundle.task.environment.remote) throw new TaskError(409, 'result_release_not_applicable', '只有远端代码成果使用中心恢复引用；本机 Git 引用由主仓库保留。');
    if (!selected.length || selected.some(round => !['finished', 'failed', 'finishing'].includes(round.phase))) throw new TaskError(409, 'result_release_active', '请选择已停止或待收尾的代码轮次。');
    const discarded = selected.find(round => round.phase === 'finishing' && discardPending && round.code?.status === 'needs_attention'
        && round.git?.status === 'sealed' && (round.stop === 'stopped' || round.executionAbsent));
    for (const round of bundle.rounds) {
        if (discarded && round.ordinal > discarded.ordinal && round.phase === 'queued' && !round.spawnAttempted
            && round.preparation.mode === 'worktree' && !round.preparation.attempted) continue;
        if ((!['finished', 'failed'].includes(round.phase) && round !== discarded)
            || (!round.executionAbsent && round.stop !== 'stopped')
            || (round.git && !['sealed', 'not_prepared'].includes(round.git.status))
            || round.outputFiles?.jobs.some(job => job.phase !== 'complete')
            || round.code?.retryRequested || ['capturing', 'publishing', 'unknown'].includes(round.code?.status ?? '')) {
            throw new TaskError(409, 'result_release_active', '任务或成果操作尚未确定停止，不能释放。', '先查询并完成收尾；已停止且代码捕获确定失败的轮次可显式 --discard-pending。');
        }
    }
}

/** Release only this round's recovery pins and stopped operation copies; never user Git refs or bytes. */
export class TaskResultRetention {
    private readonly transport: RepositoryTransfers;
    private readonly artifacts: ArtifactClient;
    constructor(hapi: HapiClient) { this.transport = new RepositoryTransfers(() => hapi); this.artifacts = new ArtifactClient(hapi); }
    private stopped(operation: RepositoryOperation | ArtifactTransfer) {
        if (operation.retention !== 'released' && !['succeeded', 'failed'].includes(operation.status)) {
            throw new TaskError(409, 'result_operation_pending', '代码或文件操作仍在执行或结果未知，不能释放。', `先核对原操作 ${operation.request.operationId}。`);
        }
    }
    private async inspect(task: Task, step: CodeRetention['copies'][number]) {
        const request = { action: 'inspect' as const, operationId: step.operationId };
        return step.domain === 'repositories' ? this.transport.repository(task.namespace, step.machineId, request)
            : this.transport.transfer(task.namespace, step.machineId, request);
    }
    private async reference(task: Task, round: Round, artifactId: string) {
        const current = (await this.artifacts.refs(artifactId)).references.find(item => item.reference === resultReference(task.id, round.id));
        if (current && current.purpose !== 'recovery') throw new TaskError(409, 'result_reference_changed', '代码恢复引用用途已改变，保留该引用。');
        return current;
    }
    async plan(task: Task, round: Round, fetches: CodeFetch[], discardPending: boolean): Promise<CodeRetention> {
        if (round.codeRetention) return structuredClone(round.codeRetention);
        const code = round.code, unpublished = !!round.git?.result && !code?.latest;
        const plan: CodeRetention = { state: 'releasing', createdAt: Date.now(), discardPending: unpublished && discardPending,
            unpublished, references: [], copies: [] };
        const copy = async (machineId: string, domain: 'repositories' | 'artifacts', operationId: string, release = true) => {
            const step = { machineId, domain, operationId, done: false }, operation = await this.inspect(task, step); this.stopped(operation);
            if (release) { step.done = operation.retention === 'released'; plan.copies.push(step); }
        };
        if (code?.exportAttempted && !code.sourceReleased) await copy(task.target.machineId, 'repositories', code.exportId);
        for (const batch of code?.batches ?? []) {
            if (batch.deliveryAttempted && !batch.deliveryStopped) await copy(task.target.machineId, 'artifacts', batch.deliveryId, false);
            if (batch.captureAttempted && !batch.released) await copy(task.target.machineId, 'artifacts', batch.captureId);
        }
        for (const fetch of fetches) {
            if (fetch.released) continue;
            // A waiting request has performed no machine writes; the tombstone will fail it explicitly.
            if (!['waiting', 'failed', 'available'].includes(fetch.status)) throw new TaskError(409, 'result_fetch_pending', '代码取回尚未确定结束，不能释放恢复文件。');
            if (fetch.attempted) await copy(fetch.target.machineId, 'repositories', fetch.operationId);
            for (const batch of [...fetch.baseline, ...fetch.output]) if (batch.attempted && !batch.released) await copy(fetch.target.machineId, 'artifacts', batch.operationId);
        }
        const ids = new Set([...(code?.pinned ?? []), ...(code?.baseline?.files ?? []).map(file => file.artifactId),
            ...(code?.files ?? []).flatMap(file => file.artifactId ? [file.artifactId] : [])]);
        for (const file of code?.files ?? []) if (!file.artifactId && !file.reused) {
            try { ids.add((await this.artifacts.lookup(file.requestId)).id); }
            catch (error) { if (!(error instanceof HapiRequestError && error.status === 404)) throw error; }
        }
        for (const artifactId of ids) plan.references.push({ artifactId, done: !await this.reference(task, round, artifactId) });
        return plan;
    }
    async advance(task: Task, round: Round, save: () => void) {
        const plan = round.codeRetention;
        if (!plan || plan.state !== 'releasing') return;
        try {
            for (const step of plan.copies) if (!step.done) {
                const previous = await this.inspect(task, step); this.stopped(previous);
                const request = { action: 'release' as const, operationId: step.operationId };
                const receipt = previous.retention === 'released' ? previous : step.domain === 'repositories'
                    ? await this.transport.repository(task.namespace, step.machineId, request)
                    : await this.transport.transfer(task.namespace, step.machineId, request);
                if (receipt.retention !== 'released') return invalid('机器尚未确认代码副本释放。');
                step.done = true; save();
            }
            for (const step of plan.references) if (!step.done) {
                if (await this.reference(task, round, step.artifactId)) await this.artifacts.unpin(step.artifactId, resultReference(task.id, round.id));
                step.done = true; save();
            }
            plan.state = plan.discardPending ? 'discarded' : 'released'; plan.completedAt = Date.now(); delete plan.error;
            if (round.code) {
                round.code.sourceReleased = true; delete round.code.cleanupError;
                for (const batch of round.code.batches ?? []) { batch.released = true; batch.releasedNames = [...batch.names]; }
            }
            if (round.attention?.scope === 'code') round.attention = null;
            round.codeRevision = task.revision + 1; save();
        } catch (error) {
            const problem = errorDetails(error);
            if (JSON.stringify(plan.error) !== JSON.stringify(problem)) round.codeRevision = task.revision + 1;
            plan.error = problem; round.attention = { ...problem, scope: 'code', stage: 'result_release' }; save();
        }
    }
}
