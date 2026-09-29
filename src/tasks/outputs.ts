import { randomUUID } from 'node:crypto';
import type { Machine } from '../../hapi/shared/src/schemas';
import type { ArtifactTransfer, ArtifactTransferRequest, CaptureRequest, DeliverRequest } from '../../hapi/shared/src/artifactTransfers';
import { ArtifactClient } from '../artifacts/client';
import { errorDetails, RunweftError } from '../errors';
import { HapiClient, HapiRequestError } from '../hapi';
import type { TaskStore } from './store';
import { TaskError, type Attention, type Round, type Task } from './types';
import type { OutputItem, OutputJob, OutputStep } from './output-types';

export function outputAttention(task: Task, round: Round): Attention | null {
    if (round.outputFiles?.latest?.status !== 'incomplete') return null;
    const released = round.artifactRetention?.state === 'released' || round.artifactRetention?.state === 'discarded';
    return { scope: 'artifacts', stage: 'delivery', code: 'artifacts_incomplete', message: released ? '部分成果文件当时未交付；附件留存已释放，历史清单保留。' : '部分成果文件未交付；原生执行结果和已交付文件保留。',
        hint: released ? '本轮附件留存已释放，历史未交付项不能重传；新的成果请通过 next 新建轮次。'
            : `查看 task artifacts show ${task.id} --round ${round.id}；传输失败用 retry，缺失文件用 collect。` };
}

export class TaskOutputs {
    private readonly artifacts: ArtifactClient;
    constructor(private readonly hapi: HapiClient, private readonly store: TaskStore) { this.artifacts = new ArtifactClient(hapi); }
    async requireSupported(machineId: string) {
        const { machines } = await this.hapi.request('/api/machines?includeOffline=true') as { machines: Machine[] };
        if (machines.find(machine => machine.id === machineId)?.runnerState?.capabilities?.artifactOutputs !== 1) {
            throw new TaskError(409, 'runner_upgrade_required', '目标 Runner 尚不支持成果文件交付。', '更新配套 Runweft 后再发起包含输出的任务。');
        }
    }
    private async machine(task: Task, request: ArtifactTransferRequest): Promise<ArtifactTransfer> {
        const result = await this.hapi.request(`/api/machines/${encodeURIComponent(task.target.machineId)}/artifacts`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
        });
        if (result.operation?.request?.operationId !== request.operationId) throw new RunweftError('invalid_hapi_response', '机器没有返回匹配的文件操作回执。');
        return result.operation;
    }
    private async step(task: Task, step: OutputStep<CaptureRequest | DeliverRequest>, save: () => void) {
        if (step.result) return step.result;
        const attempted = step.attempted; step.attempted = true; save();
        let operation: ArtifactTransfer;
        if (attempted) {
            try { operation = await this.machine(task, { action: 'inspect', operationId: step.request.operationId }); }
            catch (error) {
                if (!(error instanceof HapiRequestError && error.code === 'artifact_operation_missing')) throw error;
                operation = await this.machine(task, step.request);
            }
            if (operation.status === 'unknown') operation = await this.machine(task, step.request);
        } else operation = await this.machine(task, step.request);
        if (JSON.stringify(operation.request) !== JSON.stringify(step.request)) throw new RunweftError('invalid_hapi_response', '文件操作回执与固定请求不一致。');
        if (['accepted', 'running', 'unknown'].includes(operation.status)) return null;
        if (!['succeeded', 'failed'].includes(operation.status)) throw new RunweftError('invalid_hapi_response', '文件操作没有返回有效状态。');
        step.result = operation; save(); return operation;
    }
    private captured(task: Task, round: Round, job: OutputJob, result: ArtifactTransfer) {
        const next: OutputItem[] = job.declarations.map(declaration => {
            const candidate = result.candidates?.find(file => file.name === declaration.name);
            if (!candidate || candidate.relativePath !== declaration.relativePath) throw new RunweftError('invalid_hapi_response', '捕获回执缺少声明的文件或路径不一致。');
            if (candidate.status === 'failed') return { ...declaration, status: 'failed', error: candidate.error };
            if (!Number.isSafeInteger(candidate.size) || candidate.size < 0 || !/^[a-f0-9]{64}$/.test(candidate.sha256) || !Number.isFinite(candidate.capturedAt)) {
                throw new RunweftError('invalid_hapi_response', '捕获回执没有有效的大小、摘要或时间。');
            }
            return { ...declaration, status: 'failed', captureOperationId: result.request.operationId, size: candidate.size, sha256: candidate.sha256, capturedAt: candidate.capturedAt,
                upload: { requestId: randomUUID(), reference: { reference: `runweft:output:${task.id}:${round.id}:${job.id}:${declaration.name}`, purpose: 'output' } } };
        });
        job.items = [...job.base.filter(item => !next.some(value => value.name === item.name)), ...next];
    }
    private deliveries(job: OutputJob) {
        const selected = job.items!.filter(item => item.status === 'failed' && item.captureOperationId && item.upload
            && (job.kind === 'retry' || item.captureOperationId === job.capture?.request.operationId));
        return [...new Set(selected.map(item => item.captureOperationId!))].map(captureOperationId => ({ attempted: false,
            request: { action: 'deliver' as const, operationId: randomUUID(), captureOperationId,
                files: selected.filter(item => item.captureOperationId === captureOperationId).map(item => ({ name: item.name, ...item.upload! })) } }));
    }
    private async verifiedItems(job: OutputJob) {
        const items = structuredClone(job.items!);
        for (const delivery of job.deliveries ?? []) for (const input of delivery.request.files) {
            const item = items.find(item => item.name === input.name)!;
            const result = delivery.result!.deliveries?.find(value => value.name === input.name);
            const failed = result?.status === 'failed' ? result.error : delivery.result!.error;
            try {
                const object = await this.artifacts.lookup(input.requestId);
                if (object.filename !== item.name || object.sha256 !== item.sha256 || object.size !== item.size
                    || (result?.status === 'available' && result.artifact.id !== object.id)) throw new RunweftError('invalid_hapi_response', '成果对象与固定捕获候选不一致。');
                if (object.state === 'available') {
                    // This also restores our stable pin before manifest publication if it was explicitly removed.
                    await this.artifacts.pin(object.id, input.reference.reference, input.reference.purpose);
                    item.status = 'available'; item.artifactId = object.id; delete item.error;
                } else {
                    item.status = 'failed'; item.error = failed ?? object.error ?? { code: 'artifact_not_available', message: `成果对象仍为 ${object.state}，尚未交付。` };
                }
            } catch (error) {
                if (!(error instanceof HapiRequestError && error.status === 404)) throw error;
                item.status = 'failed'; item.error = failed ?? { code: 'artifact_upload_missing', message: '中心没有此候选的上传记录。' };
            }
        }
        return items;
    }
    private attention(task: Task, round: Round) {
        if (round.outputFiles?.latest?.status === 'incomplete' || round.attention?.scope === 'artifacts') round.attention = outputAttention(task, round);
    }
    /** Operates on persisted file steps only. Never starts a native session or seals Git. */
    async advance(task: Task, round: Round, save: () => void) {
        const job = round.outputFiles?.jobs.find(job => job.phase !== 'complete');
        if (!job) return true;
        try {
            if (job.phase === 'pending') {
                if (job.kind === 'retry') { job.items = structuredClone(job.base); job.phase = 'delivering'; }
                else if (job.kind === 'initial' && (round.executionAbsent || round.startupFailure)) {
                    job.items = job.declarations.map(file => ({ ...file, status: 'failed', error: { code: 'execution_not_started', message: '本轮未启动执行，没有自动收集成果。' } }));
                    job.phase = 'publishing';
                } else {
                    job.capture = { attempted: false, request: { action: 'capture', operationId: randomUUID(), cwd: task.environment.cwd, files: job.declarations } };
                    job.phase = 'capturing';
                }
                save();
            }
            if (job.phase === 'capturing') {
                const result = await this.step(task, job.capture!, save); if (!result) return false;
                this.captured(task, round, job, result); job.phase = 'delivering'; save();
            }
            if (job.phase === 'delivering') {
                if (!job.deliveries) { job.deliveries = this.deliveries(job); save(); }
                for (const delivery of job.deliveries) if (!await this.step(task, delivery, save)) return false;
                job.phase = 'publishing'; save();
            }
            if (job.phase === 'publishing') {
                const items = await this.verifiedItems(job);
                const available = items.filter(item => item.status === 'available' && job.deliveries?.some(delivery => delivery.request.captureOperationId === item.captureOperationId
                    && delivery.request.files.some(file => file.name === item.name)));
                job.cleanup = [...new Set(available.map(item => item.captureOperationId!))].map(operationId => ({ operationId,
                    names: available.filter(item => item.captureOperationId === operationId).map(item => item.name), done: false }));
                this.store.publishArtifacts(task, round, job, items); this.attention(task, round); save();
            }
            if (job.phase === 'cleanup') {
                for (const cleanup of job.cleanup ?? []) if (!cleanup.done) {
                    const result = await this.machine(task, { action: 'release', operationId: cleanup.operationId, names: cleanup.names });
                    if (!cleanup.names.every(name => result.candidates?.some(file => file.name === name && file.status === 'captured' && file.retention === 'released'))) {
                        throw new RunweftError('invalid_hapi_response', 'Runner 尚未确认已交付候选的本地副本释放。');
                    }
                    cleanup.done = true; save();
                }
                job.phase = 'complete'; delete job.error; this.attention(task, round); save();
            }
            return !!job.publishedVersion;
        } catch (error) {
            job.error = errorDetails(error);
            round.attention = { ...job.error, scope: 'artifacts', stage: job.phase };
            save(); return !!job.publishedVersion;
        }
    }
}
