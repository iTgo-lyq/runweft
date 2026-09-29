import { isAbsolute } from 'node:path';
import { ArtifactNameSchema } from '../../hapi/shared/src/artifacts';
import type { ArtifactTransfer, ArtifactTransferRequest, PreparedFiles } from '../../hapi/shared/src/artifactTransfers';
import { ArtifactClient } from '../artifacts/client';
import { errorDetails, RunweftError } from '../errors';
import { HapiClient, HapiRequestError } from '../hapi';
import type { TaskStore } from './store';
import { TaskError, type ArtifactIntent, type Parent, type Round, type SendIntent, type SpawnIntent, type Task } from './types';

export function preparedFiles(task: Task, round: Round): PreparedFiles | undefined {
    return task.environment.mode === 'shared' && round.inputFiles ? { operationId: round.inputFiles.operationId } : undefined;
}
const uncertain = (error: unknown) => error instanceof HapiRequestError ? error.status >= 500
    : error instanceof RunweftError && ['connection_failed', 'invalid_hapi_response'].includes(error.code);

/** Task ownership and preparation only. HAPI owns all file bytes and machine transfers. */
export class TaskFiles {
    private readonly artifacts: ArtifactClient;
    constructor(private readonly hapi: HapiClient) { this.artifacts = new ArtifactClient(hapi); }

    async accept<T>(store: TaskStore, namespace: string, parent: Parent, requestId: string, intent: SpawnIntent | SendIntent, commit: () => T): Promise<T> {
        if (!intent.inputs?.length) return commit();
        const saved = store.beginArtifactIntent(namespace, parent, requestId, intent);
        try {
            if (!saved.files) {
                const files = [];
                for (const input of saved.requests) {
                    const object = await this.artifacts.show(input.artifactId);
                    if (object.state !== 'available') throw new TaskError(409, 'artifact_input_unavailable', `输入文件 ${input.artifactId} 尚未发布或已删除。`, '使用 artifact show 检查对象，发布完成后再委派。');
                    const name = ArtifactNameSchema.safeParse(input.name ?? object.filename);
                    if (!name.success) throw new TaskError(400, 'artifact_input_name_invalid', '附件名称无法安全落地。', '用 --input 名称=文件ID 显式指定单一文件名。');
                    files.push({ artifactId: object.id, name: name.data, size: object.size, sha256: object.sha256 });
                }
                if (new Set(files.map(file => file.name)).size !== files.length) throw new TaskError(400, 'artifact_input_name_duplicate', '本轮附件名称重复。', '用 --input 名称=文件ID 为每个输入指定不同名称。');
                saved.files = files; store.saveArtifactIntent(saved);
            }
            for (const input of saved.files) await this.artifacts.pin(input.artifactId, saved.reference, 'input');
            return commit();
        } catch (error) {
            // An uncertain PUT may still establish its reference. Retain the intent until
            // this request succeeds or the old hosting process is gone at startup recovery.
            if (!uncertain(error) && !store.artifactIntentAccepted(saved)) {
                try { await this.abandon(store, saved); }
                catch { throw new TaskError(503, 'artifact_acceptance_cleanup_pending', '任务尚未接受，部分附件引用等待对账。', `保留 request ID ${requestId} 重试相同请求；服务重启会对账已登记引用。`); }
            }
            throw error;
        }
    }
    async abandon(store: TaskStore, intent: ArtifactIntent) {
        for (const id of new Set(intent.requests.map(input => input.artifactId))) {
            try { await this.artifacts.unpin(id, intent.reference); }
            catch (error) { if (!(error instanceof HapiRequestError && error.status === 404)) throw error; }
        }
        store.deleteArtifactIntent(intent);
    }
    private async machine(task: Task, request: ArtifactTransferRequest): Promise<ArtifactTransfer> {
        const result = await this.hapi.request(`/api/machines/${encodeURIComponent(task.target.machineId)}/artifacts`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
        });
        if (!result.operation || result.operation.request?.operationId !== request.operationId) throw new RunweftError('invalid_hapi_response', '机器没有返回匹配的文件准备回执。');
        return result.operation;
    }
    async prepare(task: Task, round: Round, save: () => void) {
        const inputs = round.inputFiles;
        if (!inputs || inputs.status === 'ready') return true;
        const request = { action: 'materialize' as const, operationId: inputs.operationId, files: inputs.files };
        const attempted = inputs.attempted; inputs.attempted = true; save();
        try {
            let operation: ArtifactTransfer;
            if (attempted) {
                try { operation = await this.machine(task, { action: 'inspect', operationId: inputs.operationId }); }
                catch (error) {
                    if (!(error instanceof HapiRequestError && error.code === 'artifact_operation_missing')) throw error;
                    operation = await this.machine(task, request); // Same identity, even if the original RPC was delayed.
                }
                if (operation.status === 'unknown') operation = await this.machine(task, request); // Immutable download only; never a model retry.
            } else operation = await this.machine(task, request);
            if (JSON.stringify(operation.request) !== JSON.stringify(request)) throw new RunweftError('invalid_hapi_response', '机器文件回执与冻结输入不一致。');
            if (operation.status === 'failed' || operation.retention !== 'retained') {
                inputs.status = 'failed'; inputs.error = operation.error ?? { code: 'files_not_prepared', message: '准备输入已经释放。' };
                throw new TaskError(409, inputs.error.code, inputs.error.message, inputs.error.hint);
            }
            if (operation.status !== 'succeeded') {
                inputs.status = operation.status === 'unknown' ? 'unknown' : 'accepted'; inputs.error = operation.error;
                round.attention = operation.error ? { ...operation.error, scope: 'artifacts', stage: 'preparing' } : null;
                save(); return false;
            }
            const files = inputs.files.map(input => {
                const file = operation.files.find(file => file.name === input.name && file.artifactId === input.artifactId);
                if (!file || file.sha256 !== input.sha256 || file.size !== input.size || !isAbsolute(file.path)) throw new RunweftError('invalid_hapi_response', '机器输入路径或摘要与本轮不一致。');
                return file;
            });
            if (operation.files.length !== files.length) throw new RunweftError('invalid_hapi_response', '机器返回了额外输入文件。');
            inputs.downloaded = files; inputs.paths = files; inputs.status = 'ready'; delete inputs.error;
            round.attention = null; save(); return true;
        } catch (error) {
            const problem = errorDetails(error);
            if (error instanceof HapiRequestError && ['runner_upgrade_required', 'outside_workspace_roots', 'artifact_request_invalid', 'artifact_request_conflict', 'artifact_inputs_released', 'artifact_ownership_changed', 'artifact_receipt_invalid'].includes(error.code)) inputs.status = 'failed';
            if (inputs.status !== 'failed') inputs.status = 'unknown';
            inputs.error = problem; round.attention = { ...problem, scope: 'artifacts', stage: 'preparing' }; save(); throw error;
        }
    }
    async releaseIntermediate(task: Task, round: Round, save: () => void) {
        const inputs = round.inputFiles;
        if (task.environment.mode !== 'worktree' || !inputs || inputs.intermediateReleased) return;
        try {
            const operation = await this.machine(task, { action: 'release', operationId: inputs.operationId });
            if (operation.retention !== 'released') throw new RunweftError('invalid_hapi_response', '机器尚未确认中间输入副本释放。');
            inputs.intermediateReleased = true; round.attention = null; save();
        } catch (error) { round.attention = { ...errorDetails(error), scope: 'artifacts', stage: 'preparing' }; save(); throw error; }
    }
}
