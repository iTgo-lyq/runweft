import { SpawnReceiptSchema, SpawnSessionRequestSchema, type SpawnReceipt, type SpawnSessionRequest } from '../hapi/shared/src/apiTypes';
import { errorDetails, RunweftError } from './errors';
import { HapiClient, HapiRequestError } from './hapi';

export type StartRequest = Omit<SpawnSessionRequest, 'requestId' | 'agent'> & {
    requestId: string;
    agent: 'codex' | 'claude';
};

export type StartResult =
    | { outcome: 'recorded'; receipt: SpawnReceipt }
    | { outcome: 'unknown'; requestId: string; machineId: string; error: ReturnType<typeof errorDetails> };

/** Native execution calls only. The delegation layer owns durable business IDs. */
export class ExecutionClient {
    constructor(private readonly hapi: HapiClient) {}

    async lookupStart(machineId: string, requestId: string): Promise<SpawnReceipt | null> {
        try {
            return this.receipt(await this.hapi.request(`/api/machines/${encodeURIComponent(machineId)}/spawn-requests/${encodeURIComponent(requestId)}`), machineId, requestId);
        } catch (error) {
            if (error instanceof HapiRequestError && error.status === 404 && error.code === 'spawn_request_not_found') return null;
            throw error;
        }
    }

    async start(machineId: string, input: StartRequest): Promise<StartResult> {
        const parsed = SpawnSessionRequestSchema.safeParse(input);
        if (!parsed.success || !parsed.data.requestId || !['codex', 'claude'].includes(parsed.data.agent ?? '')) {
            throw new RunweftError('invalid_execution_request', '启动需要固定的 UUID requestId、工作目录，以及 codex 或 claude runtime。');
        }
        const health = await this.hapi.request('/health');
        if (health?.capabilities?.spawnReceipts !== 1) {
            throw new RunweftError('execution_capability_missing', '当前 HAPI Hub 不支持可重查的启动请求。', '更新配套 Runweft Hub 后再启动任务。');
        }
        try {
            const response = await this.hapi.request(`/api/machines/${encodeURIComponent(machineId)}/spawn`, {
                method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(parsed.data),
                signal: AbortSignal.timeout(40_000),
            });
            // Old runners can be rejected before a receipt is reserved.
            if (response?.type === 'error') throw new RunweftError(response.code ?? 'spawn_rejected', response.message);
            return { outcome: 'recorded', receipt: this.receipt(response, machineId, input.requestId) };
        } catch (error) {
            const ambiguous = error instanceof HapiRequestError ? error.status >= 500
                : error instanceof RunweftError && ['connection_failed', 'invalid_hapi_response'].includes(error.code);
            if (!ambiguous) throw error;
            try {
                const receipt = await this.lookupStart(machineId, input.requestId);
                if (receipt) return { outcome: 'recorded', receipt };
            } catch (lookupError) {
                return { outcome: 'unknown', requestId: input.requestId, machineId, error: errorDetails(lookupError) };
            }
            return { outcome: 'unknown', requestId: input.requestId, machineId, error: errorDetails(error) };
        }
    }

    private receipt(value: unknown, machineId: string, requestId: string): SpawnReceipt {
        const parsed = SpawnReceiptSchema.safeParse(value);
        if (!parsed.success || parsed.data.machineId !== machineId || parsed.data.requestId !== requestId) {
            throw new RunweftError('invalid_hapi_response', 'HAPI 未返回与本次启动请求匹配的回执。');
        }
        return parsed.data;
    }
}
