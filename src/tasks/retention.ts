import type { ArtifactTransfer, ArtifactTransferRequest } from '../../hapi/shared/src/artifactTransfers';
import type { ArtifactReference } from '../../hapi/shared/src/artifacts';
import { ArtifactClient } from '../artifacts/client';
import { errorDetails, RunweftError } from '../errors';
import { HapiClient, HapiRequestError } from '../hapi';
import type { Problem } from '../resources/types';
import { outputAttention } from './outputs';
import type { OutputManifest } from './output-types';
import { TaskError, type Round, type Task } from './types';

export type ArtifactRetention = {
    state: 'releasing' | 'released' | 'discarded'; createdAt: number; completedAt?: number; discardPending: boolean;
    references: { artifactId: string; reference: string; purpose: 'input' | 'output'; done: boolean }[];
    transfers: { operationId: string; done: boolean }[];
    pendingCandidates: { name: string; operationId: string }[]; error?: Problem;
};

/** Only removes references owned by this round and its confirmed machine copies. */
export class TaskRetention {
    private readonly artifacts: ArtifactClient;
    constructor(private readonly hapi: HapiClient) { this.artifacts = new ArtifactClient(hapi); }
    private async machine(task: Task, request: ArtifactTransferRequest): Promise<ArtifactTransfer> {
        const value = await this.hapi.request(`/api/machines/${encodeURIComponent(task.target.machineId)}/artifacts`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
        });
        if (value.operation?.request?.operationId !== request.operationId) throw new RunweftError('invalid_hapi_response', '机器未返回匹配的文件操作回执。');
        return value.operation;
    }
    private stopped(operation: ArtifactTransfer) {
        if (operation.retention !== 'released' && !['succeeded', 'failed'].includes(operation.status)) {
            throw new TaskError(409, 'artifact_operation_pending', '文件操作仍在执行或结果未知，不能释放。', `先查询机器文件操作 ${operation.request.operationId}，确认停止后再重试。`);
        }
    }
    private async reference(value: Pick<ArtifactRetention['references'][number], 'artifactId' | 'reference' | 'purpose'>) {
        const refs = (await this.artifacts.refs(value.artifactId)).references;
        const current = refs.find(item => item.reference === value.reference);
        if (current && current.purpose !== value.purpose) throw new TaskError(409, 'artifact_reference_changed', '引用用途与本轮记录不一致，保留该引用。');
        return current;
    }
    async plan(task: Task, round: Round, manifests: OutputManifest[], discardPending: boolean): Promise<ArtifactRetention> {
        if (round.artifactRetention) return structuredClone(round.artifactRetention);
        const plan: ArtifactRetention = { state: 'releasing', createdAt: Date.now(), discardPending: false, references: [], transfers: [], pendingCandidates: [] };
        const references = new Map<string, ArtifactRetention['references'][number]>();
        for (const input of round.inputFiles?.files ?? []) {
            const reference = round.inputFiles!.reference;
            references.set(`${input.artifactId}:${reference}`, { artifactId: input.artifactId, reference, purpose: 'input', done: false });
        }
        const uploads = new Map<string, { requestId: string; reference: Pick<ArtifactReference, 'reference' | 'purpose'> }>();
        for (const job of round.outputFiles?.jobs ?? []) for (const item of job.items ?? []) {
            if (item.upload) uploads.set(item.upload.requestId, item.upload);
        }
        for (const upload of uploads.values()) {
            try {
                const artifact = await this.artifacts.lookup(upload.requestId);
                references.set(`${artifact.id}:${upload.reference.reference}`, { artifactId: artifact.id, reference: upload.reference.reference, purpose: 'output', done: false });
            } catch (error) { if (!(error instanceof HapiRequestError && error.status === 404)) throw error; }
        }
        for (const reference of references.values()) {
            reference.done = !await this.reference(reference); plan.references.push(reference);
        }
        if (round.inputFiles?.attempted && !round.inputFiles.intermediateReleased) {
            const operation = await this.machine(task, { action: 'inspect', operationId: round.inputFiles.operationId }); this.stopped(operation);
            plan.transfers.push({ operationId: operation.request.operationId, done: operation.retention === 'released' });
        }
        const delivered = new Set(manifests.flatMap(manifest => manifest.items.filter(item => item.status === 'available').map(item => `${item.captureOperationId}:${item.name}`)));
        for (const job of round.outputFiles?.jobs ?? []) {
            if (!job.capture?.result) continue;
            const operationId = job.capture.request.operationId;
            const cleaned = new Set(round.outputFiles!.jobs.flatMap(value => value.cleanup?.filter(item => item.operationId === operationId && item.done).flatMap(item => item.names) ?? []));
            const captured = job.capture.result.candidates?.filter(item => item.status === 'captured') ?? [];
            if (captured.length && captured.every(item => cleaned.has(item.name))) continue;
            const candidates = captured.filter(item => !cleaned.has(item.name));
            const operation = await this.machine(task, { action: 'inspect', operationId }); this.stopped(operation);
            if (JSON.stringify(operation.request) !== JSON.stringify(job.capture.request)) throw new RunweftError('invalid_hapi_response', '候选回执与原捕获请求不一致。');
            for (const candidate of candidates) {
                const current = operation.candidates?.find(item => item.name === candidate.name);
                if (!current || current.status !== 'captured') throw new RunweftError('invalid_hapi_response', '原捕获候选无法确认，未释放文件。');
                if (current.retention === 'released') continue;
                if (!delivered.has(`${operationId}:${current.name}`)) plan.pendingCandidates.push({ name: current.name, operationId });
            }
            // Releasing the whole stopped capture also removes unconfirmed partial files,
            // including captures where every declared file failed before a candidate was recorded.
            if (operation.retention !== 'released') plan.transfers.push({ operationId, done: false });
        }
        plan.discardPending = discardPending && plan.pendingCandidates.length > 0;
        return plan;
    }
    async advance(task: Task, round: Round, save: () => void, notify: () => void) {
        const plan = round.artifactRetention;
        if (!plan || plan.state !== 'releasing') return;
        try {
            for (const step of plan.transfers) if (!step.done) {
                const previous = await this.machine(task, { action: 'inspect', operationId: step.operationId }); this.stopped(previous);
                const result = previous.retention === 'released' ? previous : await this.machine(task, { action: 'release', operationId: step.operationId });
                if (result.retention !== 'released') throw new RunweftError('invalid_hapi_response', '机器尚未确认副本释放。');
                step.done = true;
                if (round.inputFiles?.operationId === step.operationId) { round.inputFiles.intermediateReleased = true; delete round.inputFiles.cleanupError; }
                save();
            }
            for (const step of plan.references) if (!step.done) {
                if (await this.reference(step)) await this.artifacts.unpin(step.artifactId, step.reference);
                step.done = true; save();
            }
            plan.state = plan.discardPending ? 'discarded' : 'released'; plan.completedAt = Date.now(); delete plan.error;
            if (round.attention?.stage === 'artifact_release' || round.attention?.stage === 'input_cleanup' || round.attention?.code === 'artifacts_incomplete') round.attention = outputAttention(task, round);
            notify();
        } catch (error) {
            const problem = errorDetails(error), changed = JSON.stringify(plan.error) !== JSON.stringify(problem);
            plan.error = problem; round.attention = { ...problem, scope: 'artifacts', stage: 'artifact_release' };
            if (changed) notify(); else save();
        }
    }
}
