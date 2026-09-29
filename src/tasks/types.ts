import { z } from 'zod';
import { isAbsolute } from 'node:path';
import { AgentIdSchema, DefinitionSchema, ScopeSchema } from '../agents/definitions';
import type { ExecutionObservation } from '../../hapi/shared/src/execution';
import type { SessionResponse } from '../../hapi/shared/src/apiTypes';
import type { HistoryCursor } from '../execution';
import type { ExecutionTarget, Problem } from '../resources/types';
import { RunweftError } from '../errors';

const identifier = z.string().min(1).max(512);
const cwd = z.string().min(1).refine(isAbsolute, '工作目录必须是绝对路径');
export const ParentSchema = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('cli'), machineId: identifier, cwd, hapiSessionId: identifier.optional() }),
    z.strictObject({ kind: z.literal('mcp'), machineId: identifier, cwd, host: z.enum(['codex', 'claude']), nativeSessionId: identifier,
        hapiSessionId: identifier.optional() }),
]);
export type Parent = z.infer<typeof ParentSchema>;
export const SpawnIntentSchema = z.strictObject({ agentType: AgentIdSchema, message: z.string().trim().min(1).max(200_000), workspaceMode: z.literal('shared') });
export type SpawnIntent = z.infer<typeof SpawnIntentSchema>;
export const SnapshotSchema = z.strictObject({ id: AgentIdSchema, definition: DefinitionSchema,
    source: z.strictObject({ scope: ScopeSchema, path: z.string(), key: z.string(), linkTarget: z.string().nullable() }),
    definitionVersion: z.string().min(1), resolvedVersion: z.string().min(1), runtimeId: z.uuid(),
    machineId: identifier, flavor: z.enum(['codex', 'claude']), namespace: identifier });
export type AgentSnapshot = z.infer<typeof SnapshotSchema>;
export const AcceptSchema = z.strictObject({ parent: ParentSchema, requestId: z.uuid(), intent: SpawnIntentSchema, agent: SnapshotSchema });
export const LookupSchema = z.strictObject({ parent: ParentSchema, requestId: z.uuid(), intent: SpawnIntentSchema });
export type Attention = Problem & { stage: string; permissionIds?: string[] };
export type Status = 'running' | 'needs_attention' | 'completed' | 'failed' | 'interrupted' | 'unknown';
export type Acceptance = { agent_id: string; round_id: string; request_id: string; revision: number; accepted: true };
export type Task = { id: string; namespace: string; parent: Parent; agent: AgentSnapshot; target: ExecutionTarget;
    environment: { mode: 'shared'; machineId: string; cwd: string }; createdAt: number; revision: number; updatedAt: number };
export type Round = { id: string; taskId: string; ordinal: number; requestId: string; message: string;
    phase: 'queued' | 'starting' | 'running' | 'stopping' | 'finished' | 'failed';
    preparation: { mode: 'shared'; status: 'pending' | 'ready'; checkedAt?: number };
    spawnRequestId: string; spawnAttempted: boolean; sessionId?: string; nativeSessionId?: string;
    cursor?: HistoryCursor; report: string; structuredMissing: boolean;
    stop: 'not_started' | 'stopping' | 'stopped'; finish: 'pending' | 'complete';
    attention: Attention | null; createdAt: number; completedAt?: number; completedRevision?: number;
    observedAt?: number; permissions: NonNullable<SessionResponse['session']['agentState']>['requests'];
    startupFailure?: Problem; hostPid?: number };
export type Input = { id: string; roundId: string; kind: 'initial' | 'steer'; text: string;
    delivery: 'pending' | 'attempted' | 'stored' | 'unknown'; messageId?: string;
    observation?: ExecutionObservation; output: { messageId: string; text: string }[]; observedAt?: number };
export type TaskBundle = { task: Task; rounds: Round[]; inputs: Input[] };
export class TaskError extends RunweftError {
    constructor(readonly status: number, code: string, message: string, hint?: string) { super(code, message, hint); }
}
export function parseTask<T>(schema: z.ZodType<T>, value: unknown): T {
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new TaskError(400, 'invalid_task_request', '任务参数无效。', parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '));
    return parsed.data;
}
export function parentKey(parent: Parent) {
    return JSON.stringify(parent.kind === 'mcp' ? [parent.kind, parent.host, parent.nativeSessionId] : [parent.kind, parent.machineId, parent.cwd]);
}
export function nativeTerminal(observation?: ExecutionObservation) {
    return !!observation && observation.source !== 'transport' && ['completed', 'failed', 'interrupted'].includes(observation.phase);
}
