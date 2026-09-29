import { z } from 'zod';
import { isAbsolute } from 'node:path';
import { AgentIdSchema, DefinitionSchema, ScopeSchema } from '../agents/definitions';
import type { ExecutionObservation } from '../../hapi/shared/src/execution';
import type { SessionResponse } from '../../hapi/shared/src/apiTypes';
import type { WorkspaceSource, WorkspaceResult } from '../../hapi/shared/src/workspaces';
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
const spawnFields = { agentType: AgentIdSchema, message: z.string().trim().min(1).max(200_000) };
export const SpawnIntentSchema = z.discriminatedUnion('workspaceMode', [
    z.strictObject({ ...spawnFields, workspaceMode: z.literal('shared') }),
    z.strictObject({ ...spawnFields, workspaceMode: z.literal('worktree'), baseRef: z.string().trim().min(1).default('HEAD') }),
]);
export type SpawnIntent = z.infer<typeof SpawnIntentSchema>;
export const SendIntentSchema = z.strictObject({ id: z.uuid(), message: z.string().trim().min(1).max(200_000), mode: z.enum(['next', 'steer']), roundId: z.uuid().optional() })
    .refine(value => value.mode === 'steer' ? !!value.roundId : value.roundId === undefined, 'steer 必须指定 roundId；next 不接受 roundId');
export type SendIntent = z.infer<typeof SendIntentSchema>;
export const SnapshotSchema = z.strictObject({ id: AgentIdSchema, definition: DefinitionSchema,
    source: z.strictObject({ scope: ScopeSchema, path: z.string(), key: z.string(), linkTarget: z.string().nullable() }),
    definitionVersion: z.string().min(1), resolvedVersion: z.string().min(1), runtimeId: z.uuid(),
    machineId: identifier, flavor: z.enum(['codex', 'claude']), namespace: identifier });
export type AgentSnapshot = z.infer<typeof SnapshotSchema>;
export const AcceptSchema = z.strictObject({ parent: ParentSchema, requestId: z.uuid(), intent: SpawnIntentSchema, agent: SnapshotSchema });
export const LookupSchema = z.strictObject({ parent: ParentSchema, requestId: z.uuid(), intent: SpawnIntentSchema });
export const SendSchema = z.strictObject({ parent: ParentSchema, requestId: z.uuid(), intent: SendIntentSchema });
export const InterruptSchema = z.strictObject({ parent: ParentSchema, id: z.uuid(), roundId: z.uuid() });
export const PermissionSchema = InterruptSchema.extend({ requestId: z.string().min(1), decision: z.enum(['approved', 'denied', 'abort']),
    answers: z.union([z.record(z.string(), z.array(z.string())), z.record(z.string(), z.object({ answers: z.array(z.string()) }))]).optional() });
export type Attention = Problem & { stage: string; scope?: 'workspace'; permissionIds?: string[] };
export type Status = 'running' | 'needs_attention' | 'completed' | 'failed' | 'interrupted' | 'unknown';
export type Acceptance = { agent_id: string; round_id: string; request_id: string; revision: number; accepted: true; input_id?: string };
export type StructuredReport = { summary: string; changes: string; tests: string; remaining: string };
export type TaskEnvironment = { mode: 'shared'; machineId: string; cwd: string }
    | { mode: 'worktree'; machineId: string; environmentId: string; source: WorkspaceSource; cwd: string;
        checkout?: string; branch?: string; status: 'retained' | 'deleting' | 'removed' };
export type Task = { version: 2; id: string; namespace: string; parent: Parent; agent: AgentSnapshot; target: ExecutionTarget;
    environment: TaskEnvironment; createdAt: number; revision: number; updatedAt: number };
export type Preparation = { mode: 'shared'; status: 'pending' | 'ready'; checkedAt?: number }
    | { mode: 'worktree'; preparationId: string; status: 'pending' | 'accepted' | 'ready' | 'failed' | 'unknown';
        attempted: boolean; expectedHead?: string; startHead?: string; checkedAt?: number };
export type GitDelivery = { status: 'pending' | 'sealing' | 'sealed' | 'needs_attention' | 'unknown';
    attemptId?: string; attempted: boolean; partial?: boolean; result?: WorkspaceResult; error?: Problem };
export function pendingPreparation(environment: TaskEnvironment): Preparation {
    return environment.mode === 'shared' ? { mode: 'shared', status: 'pending' }
        : { mode: 'worktree', preparationId: crypto.randomUUID(), status: 'pending', attempted: false };
}
export type Round = { id: string; taskId: string; ordinal: number; requestId: string; message: string;
    phase: 'queued' | 'preparing' | 'starting' | 'resuming' | 'running' | 'stopping' | 'finishing' | 'finished' | 'failed';
    preparation: Preparation; git?: GitDelivery;
    spawnRequestId: string; spawnAttempted: boolean; sessionId?: string; nativeSessionId?: string;
    cursor?: HistoryCursor; report: string; structuredMissing: boolean;
    stop: 'not_started' | 'stopping' | 'stopped'; finish: 'pending' | 'complete';
    attention: Attention | null; createdAt: number; completedAt?: number; completedRevision?: number;
    observedAt?: number; permissions: NonNullable<SessionResponse['session']['agentState']>['requests'];
    startupFailure?: Problem; hostPid?: number; permissionBaseline?: string[]; structuredReport?: StructuredReport;
    resume?: { previousSessionId: string; previousNativeSessionId?: string; attempted: boolean; candidateSessionId: string; outcome: 'pending' | 'resumed' | 'missing' | 'unknown' };
    reconstruction?: { reason: 'native_session_missing'; sourceRoundIds: string[]; context: string };
    cancellation?: { requestedAt: number; controlAttempted?: boolean; confirmed?: boolean; error?: Problem } };
export type Input = { id: string; roundId: string; kind: 'initial' | 'steer'; text: string;
    requestId?: string;
    delivery: 'pending' | 'attempted' | 'stored' | 'unknown'; messageId?: string;
    observation?: ExecutionObservation; output: { messageId: string; text: string }[]; observedAt?: number;
    steer?: { attempted: boolean; status: 'pending' | 'steered' | 'queued' | 'invoked' | 'unknown'; error?: string } };
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
