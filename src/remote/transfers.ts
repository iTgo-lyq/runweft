import { isDeepStrictEqual } from 'node:util';
import type { RepositoryOperation, RepositoryRequest } from '../../hapi/shared/src/repositories';
import type { ArtifactTransfer, ArtifactTransferRequest } from '../../hapi/shared/src/artifactTransfers';
import type { Artifact } from '../../hapi/shared/src/artifacts';
import { ArtifactClient, artifactOperation } from '../artifacts/client';
import { RunweftError } from '../errors';
import { HapiRequestError, type HapiHttp } from '../hapi';
import { PreparationError, type SnapshotFile } from './types';

export const batches = <T>(items: T[]) => Array.from({ length: Math.ceil(items.length / 100) }, (_, index) => items.slice(index * 100, (index + 1) * 100));
export function uncertainPreparation(error: unknown) {
    return error instanceof HapiRequestError || error instanceof PreparationError
        ? error.status >= 500 || ['machine_offline', 'repository_process_unknown', 'workspace_process_unknown'].includes(error.code)
        : !(error instanceof RunweftError) || ['connection_failed', 'invalid_hapi_response'].includes(error.code);
}
export const invalid = (message: string): never => { throw new RunweftError('invalid_hapi_response', message); };
export function stopped(operation: { status: string; error?: { code: string; message: string; hint?: string } }) {
    if (operation.status === 'failed' || operation.status === 'unknown') throw new PreparationError(operation.status === 'unknown' ? 503 : 409,
        operation.error?.code ?? 'repository_operation_failed', operation.error?.message ?? 'HAPI 尚未确认仓库操作成功。', operation.error?.hint);
    return operation.status === 'succeeded';
}

/** Receipts retain the original machine operation identity across retries and process restarts. */
export class RepositoryTransfers {
    constructor(private readonly client: (namespace: string) => HapiHttp) {}
    async repository(namespace: string, machine: string, request: RepositoryRequest): Promise<RepositoryOperation> {
        const result = await this.client(namespace).request(`/api/machines/${encodeURIComponent(machine)}/repositories`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
        });
        if (!result.operation || result.operation.request?.operationId !== request.operationId) return invalid('机器未返回指定仓库操作的回执。');
        return result.operation;
    }
    async repositoryReceipt(namespace: string, machine: string, request: Extract<RepositoryRequest, { action: 'export' | 'import' | 'export-result' | 'fetch-result' }>, attempted: boolean) {
        let result: RepositoryOperation;
        if (!attempted) result = await this.repository(namespace, machine, request);
        else {
            try { result = await this.repository(namespace, machine, { action: 'inspect', operationId: request.operationId }); }
            catch (error) { if (!(error instanceof HapiRequestError && error.code === 'repository_operation_missing')) throw error; result = await this.repository(namespace, machine, request); }
        }
        if (!isDeepStrictEqual(result.request, request)) return invalid('仓库回执与冻结请求不一致。');
        return result;
    }
    transfer(namespace: string, machine: string, request: ArtifactTransferRequest): Promise<ArtifactTransfer> {
        return artifactOperation(this.client(namespace), machine, request, '机器未返回指定文件操作的回执。');
    }
    async transferReceipt(namespace: string, machine: string, request: Extract<ArtifactTransferRequest, { action: 'capture' | 'deliver' | 'materialize' }>, attempted: boolean) {
        let result: ArtifactTransfer;
        if (!attempted) result = await this.transfer(namespace, machine, request);
        else {
            try { result = await this.transfer(namespace, machine, { action: 'inspect', operationId: request.operationId }); }
            catch (error) { if (!(error instanceof HapiRequestError && error.code === 'artifact_operation_missing')) throw error; result = await this.transfer(namespace, machine, request); }
            // Existing immutable file operations support resuming interrupted transfers with the same identity.
            if (result.status === 'unknown' && request.action !== 'capture') result = await this.transfer(namespace, machine, request);
        }
        if (!isDeepStrictEqual(result.request, request)) return invalid('文件回执与冻结请求不一致。');
        return result;
    }
    async available(artifacts: ArtifactClient, file: Pick<SnapshotFile, 'artifactId' | 'sha256' | 'size'>): Promise<Artifact | null> {
        if (!file.artifactId) return null;
        let object: Artifact;
        try { object = await artifacts.show(file.artifactId); }
        catch (error) { if (error instanceof HapiRequestError && error.status === 404) return null; throw error; }
        return object.state === 'available' && object.sha256 === file.sha256 && object.size === file.size ? object : null;
    }
}
