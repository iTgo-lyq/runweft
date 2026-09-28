import { SpawnReceiptSchema, SpawnSessionRequestSchema, SendMessageRequestSchema,
    type SpawnReceipt, type SpawnSessionRequest, type SendMessageRequest, type SessionResponse,
    type MessagesResponse, type QueuedStateResponse } from '../hapi/shared/src/apiTypes';
import { ExecutionObservationSchema, InterruptExecutionResponseSchema, type ExecutionObservation } from '../hapi/shared/src/execution';
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

    async waitUntilReady(sessionId: string, timeoutMs = 15_000) {
        const until = Date.now() + timeoutMs;
        do {
            const { session } = await this.hapi.request(`/api/sessions/${encodeURIComponent(sessionId)}`) as SessionResponse;
            if (session.active && session.metadata?.capabilities?.execution === 1) return session;
            if (session.metadata?.lifecycleState === 'archived') throw new RunweftError('execution_closed', '会话在就绪前已关闭。');
            if (Date.now() >= until) break;
            await new Promise(resolve => setTimeout(resolve, 100));
        } while (true);
        throw new RunweftError('execution_not_ready', '会话已关联，但执行尚未确认就绪。', '保留当前 sessionId 检查 Runner 状态；不要自动新建会话。');
    }

    private async session(sessionId: string) {
        const { session } = await this.hapi.request(`/api/sessions/${encodeURIComponent(sessionId)}`) as SessionResponse;
        if (session.metadata?.capabilities?.execution !== 1) {
            throw new RunweftError('execution_capability_missing', '该会话不具备原生结果关联和定向中断能力。', '更新配套 Runner，并重新启动 Codex 或 Claude Code 会话。');
        }
        return session;
    }

    async send(sessionId: string, input: SendMessageRequest & { localId: string }) {
        const parsed = SendMessageRequestSchema.safeParse(input);
        if (!parsed.success || !parsed.data.localId) throw new RunweftError('invalid_execution_input', '输入必须包含固定 localId 和有效内容。');
        await this.session(sessionId);
        try {
            await this.hapi.request(`/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
                method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(parsed.data),
            });
            return { outcome: 'stored' as const, localId: input.localId };
        } catch (error) {
            if (!isAmbiguous(error)) throw error;
            // An empty lookup cannot rule out an in-flight POST. Never resend here.
            return { outcome: 'unknown' as const, localId: input.localId, error: errorDetails(error) };
        }
    }

    async query(sessionId: string, localId: string) {
        const session = await this.session(sessionId);
        const base = `/api/sessions/${encodeURIComponent(session.id)}/messages`;
        const delivery = await this.hapi.request(`${base}/queued-state`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ localIds: [localId] }),
        }) as QueuedStateResponse;
        // Read a bounded page at a time using HAPI's existing cursor. Preserve
        // facts separately from delivery acknowledgements and UI readiness.
        const messages: MessagesResponse['messages'] = [];
        let before: { at: number; seq: number } | undefined;
        do {
            const params = new URLSearchParams({ limit: '200' });
            if (before) { params.set('beforeAt', String(before.at)); params.set('beforeSeq', String(before.seq)); }
            const page = await this.hapi.request(`${base}?${params}`) as MessagesResponse;
            messages.push(...page.messages);
            if (!page.page.hasMore) break;
            if (page.page.nextBeforeAt === null || page.page.nextBeforeSeq === null
                || (before?.at === page.page.nextBeforeAt && before?.seq === page.page.nextBeforeSeq)) {
                throw new RunweftError('invalid_hapi_response', 'HAPI 历史分页没有继续向前移动。');
            }
            before = { at: page.page.nextBeforeAt, seq: page.page.nextBeforeSeq };
        } while (true);
        messages.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
        const facts: Array<{ messageId: string; observation: ExecutionObservation }> = [];
        for (const message of messages) {
            const envelope = record(record(message.content).content);
            if (record(message.content).role !== 'agent' || envelope.type !== 'event') continue;
            const parsed = ExecutionObservationSchema.safeParse(envelope.data);
            if (parsed.success && parsed.data.inputLocalIds.includes(localId)) facts.push({ messageId: message.id, observation: parsed.data });
        }
        const prefixes = facts.filter(f => f.observation.runtime === 'codex')
            .map(f => `codex:${f.observation.nativeSessionId}:${f.observation.nativeTurnId}:`);
        const output = messages.flatMap(message => {
            const data = record(record(record(message.content).content).data);
            return record(message.content).role === 'agent' && data.type === 'message' && typeof data.message === 'string'
                && typeof message.localId === 'string' && prefixes.some(prefix => message.localId!.startsWith(prefix))
                ? [{ messageId: message.id, text: data.message }] : [];
        });
        for (const fact of facts) {
            const result = fact.observation.nativeResult?.result;
            if (fact.observation.runtime === 'claude' && typeof result === 'string') output.push({ messageId: fact.messageId, text: result });
        }
        return { session, localId, delivery, facts, output,
            inputMessageId: messages.find(m => m.localId === localId && record(m.content).role === 'user')?.id,
            permissions: session.agentState?.requests ?? {} };
    }

    async interrupt(sessionId: string, inputLocalId: string, executionId: string) {
        await this.session(sessionId);
        return InterruptExecutionResponseSchema.parse(await this.hapi.request(`/api/sessions/${encodeURIComponent(sessionId)}/execution/interrupt`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ inputLocalId, executionId }),
        }));
    }

    async cancelQueued(sessionId: string, localId: string) {
        const current = await this.query(sessionId, localId);
        if (!current.inputMessageId || !current.delivery.queuedLocalIds.includes(localId)) {
            return { status: 'not_queued', localId };
        }
        return this.hapi.request(`/api/sessions/${encodeURIComponent(current.session.id)}/messages/${encodeURIComponent(current.inputMessageId)}`, { method: 'DELETE' });
    }

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
            if (!isAmbiguous(error)) throw error;
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

function isAmbiguous(error: unknown): boolean {
    return error instanceof HapiRequestError ? error.status >= 500
        : error instanceof RunweftError && ['connection_failed', 'invalid_hapi_response'].includes(error.code);
}

function record(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
