import { z } from 'zod';
import { ParentSchema, TaskError, type Task, type Round, type Input } from './types';
import type { CodeFetch } from './result-types';

// Validate persisted current records without filling defaults or changing their contents.
const id = z.string().min(1), count = z.number().int().nonnegative();
const object = z.record(z.string(), z.unknown());
const target = z.looseObject({ runtimeId: id, machineId: id, flavor: z.enum(['codex', 'claude']), ownerId: id, spaceId: id });
const agent = z.looseObject({ id, namespace: id, runtimeId: id, machineId: id, flavor: z.enum(['codex', 'claude']),
    definitionVersion: id, resolvedVersion: id,
    definition: z.looseObject({ schemaVersion: z.literal(1), name: id, description: z.string(), instructions: z.string() }),
    source: z.looseObject({ scope: z.enum(['global', 'project']), hubId: id, repositoryId: id.nullable() }),
    hub: z.looseObject({ actorId: id, spaceId: id, hubRepositoryId: id.nullable(), agentId: id,
        version: count, contentHash: id, resolvedVersion: id, definition: object, launchOptions: object, target }),
});
const source = z.looseObject({ machineId: id, sourcePath: id, repositoryRoot: id, repositoryId: id, commonDir: id, baseCommit: id });
const environment = z.discriminatedUnion('mode', [
    z.looseObject({ mode: z.literal('shared'), machineId: id, cwd: id }),
    z.looseObject({ mode: z.literal('worktree'), machineId: id, cwd: id, environmentId: id, source,
        status: z.enum(['retained', 'deleting', 'removed']), remote: z.looseObject({ origin: source,
            release: z.looseObject({ state: z.enum(['pending', 'released']) }).optional() }).optional() }),
]);
const taskSchema = z.looseObject({ version: z.literal(2), id, namespace: id, parent: ParentSchema, agent, target, environment,
    hub: z.looseObject({ ownerId: id, spaceId: id, hubRepositoryId: id.nullable() }), createdAt: count, revision: count, updatedAt: count });
const retention = z.looseObject({ state: z.enum(['releasing', 'released', 'discarded']) });
const roundSchema = z.looseObject({ id, taskId: id, ordinal: z.number().int().positive(), requestId: id, message: z.string(), agent,
    phase: z.enum(['queued', 'preparing', 'starting', 'resuming', 'running', 'stopping', 'finishing', 'finished', 'failed']),
    preparation: z.discriminatedUnion('mode', [
        z.looseObject({ mode: z.literal('shared'), status: z.enum(['pending', 'ready']) }),
        z.looseObject({ mode: z.literal('worktree'), preparationId: id, status: z.enum(['pending', 'accepted', 'ready', 'failed', 'unknown']), attempted: z.boolean() }),
    ]), spawnRequestId: id, spawnAttempted: z.boolean(), report: z.string(), structuredMissing: z.boolean(),
    stop: z.enum(['not_started', 'stopping', 'stopped']), finish: z.enum(['pending', 'complete']), attention: object.nullable(), createdAt: count, permissions: object,
    inputFiles: z.looseObject({ reference: id, operationId: id, files: z.array(object), attempted: z.boolean(),
        status: z.enum(['pending', 'accepted', 'ready', 'failed', 'unknown']), downloaded: z.array(object), paths: z.array(object), intermediateReleased: z.boolean() }).optional(),
    outputFiles: z.looseObject({ declarations: z.array(object), jobs: z.array(z.looseObject({ id, requestId: id, kind: z.enum(['initial', 'collect', 'retry']),
        phase: z.enum(['pending', 'capturing', 'delivering', 'publishing', 'cleanup', 'complete']), declarations: z.array(object), base: z.array(object), createdAt: count })) }).optional(),
    artifactRetention: retention.optional(), codeRetention: retention.optional(),
    code: z.looseObject({ id, status: z.enum(['capturing', 'publishing', 'available', 'needs_attention', 'unknown']), pinned: z.array(id),
        retryRequested: z.boolean().optional(), sourceReleased: z.boolean().optional() }).optional(),
});
const inputSchema = z.looseObject({ id, roundId: id, kind: z.enum(['initial', 'steer']), text: z.string(),
    delivery: z.enum(['pending', 'attempted', 'stored', 'unknown']), output: z.array(z.looseObject({ messageId: id, text: z.string() })) });
const fetchSchema = z.looseObject({ id, requestId: id, taskId: id, roundId: id, parent: ParentSchema, target: object,
    status: z.enum(['waiting', 'materializing', 'fetching', 'available', 'failed', 'unknown']), operationId: id, attempted: z.boolean(),
    baseline: z.array(object), output: z.array(object), released: z.boolean(), createdAt: count, updatedAt: count });
export function invalidRecord(): never {
    throw new TaskError(503, 'state_record_invalid', '任务记录不是有效的当前格式。', '原记录保持不变；使用独立的新 Runweft home，不迁移或清理原数据。');
}
export function recordJSON(data: string): unknown { try { return JSON.parse(data); } catch { return invalidRecord(); } }
export function currentTask(value: unknown): Task { if (!taskSchema.safeParse(value).success) invalidRecord(); return value as Task; }
export function currentRound(value: unknown): Round { if (!roundSchema.safeParse(value).success) invalidRecord(); return value as Round; }
export function currentInput(value: unknown): Input { if (!inputSchema.safeParse(value).success) invalidRecord(); return value as Input; }
export function currentFetch(value: unknown): CodeFetch { if (!fetchSchema.safeParse(value).success) invalidRecord(); return value as CodeFetch; }
export function snapshotMatches(task: Task, snapshot: Task['agent']) {
    const hub = snapshot.hub;
    if (snapshot.namespace !== task.namespace || snapshot.id !== hub.agentId || snapshot.source.hubId !== hub.agentId
        || hub.actorId !== task.hub.ownerId || hub.spaceId !== task.hub.spaceId || hub.hubRepositoryId !== task.hub.hubRepositoryId
        || snapshot.source.repositoryId !== hub.definition.repositoryId || snapshot.runtimeId !== task.target.runtimeId
        || snapshot.machineId !== task.target.machineId || snapshot.flavor !== task.target.flavor
        || hub.target.runtimeId !== task.target.runtimeId || hub.target.machineId !== task.target.machineId || hub.target.flavor !== task.target.flavor) invalidRecord();
}
