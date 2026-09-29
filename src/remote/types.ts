import { z } from 'zod';
import type { RepositoryFile, RepositorySnapshot } from '../../hapi/shared/src/repositories';
import type { WorkspaceSource } from '../../hapi/shared/src/workspaces';
import type { MaterializedInput } from '../../hapi/shared/src/artifactTransfers';
import { AgentIdSchema } from '../agents/definitions';
import { ParentSchema, type Parent } from '../tasks/types';
import { RunweftError } from '../errors';
import type { Problem } from '../resources/types';

export const PreparationIntentSchema = z.strictObject({ agent: AgentIdSchema, baseRef: z.string().trim().min(1) });
export const SelectionSchema = z.strictObject({ id: AgentIdSchema, definitionVersion: z.string().min(1), runtimeId: z.uuid(),
    machineId: z.string().min(1), flavor: z.enum(['codex', 'claude']), namespace: z.string().min(1) });
export const LookupPreparationSchema = z.strictObject({ parent: ParentSchema, requestId: z.uuid(), intent: PreparationIntentSchema });
export const AcceptPreparationSchema = LookupPreparationSchema.extend({ agent: SelectionSchema });
export type PreparationIntent = z.infer<typeof PreparationIntentSchema>;
export type Selection = z.infer<typeof SelectionSchema>;
export type TransferBatch = { captureId: string; deliveryId: string; names: string[]; captured: boolean; delivered: boolean;
    captureAttempted: boolean; deliveryAttempted: boolean; deliveryStopped: boolean; released: boolean; releasedNames: string[] };
export type SnapshotFile = RepositoryFile & { requestId: string; artifactId?: string; reused: boolean; pinned: boolean };
export type BaselineSnapshot = { id: string; namespace: string; generation: number; origin: WorkspaceSource;
    phase: 'exporting' | 'uploading' | 'available' | 'failed' | 'unknown'; stage: 'export' | 'publish';
    exportId: string; exportAttempted: boolean; directory?: string; manifest?: RepositorySnapshot;
    files?: SnapshotFile[]; batches?: TransferBatch[]; sourceReleased: boolean;
    error?: Problem; cleanupError?: Problem; createdAt: number; updatedAt: number };
export type ImportBatch = { operationId: string; names: string[]; attempted: boolean; files?: MaterializedInput[]; released: boolean };
export type BaselineImport = { id: string; snapshotId: string; namespace: string; machineId: string; generation: number;
    phase: 'importing' | 'available' | 'failed' | 'unknown'; batches?: ImportBatch[];
    operationId: string; attempted: boolean; source?: WorkspaceSource; error?: Problem; cleanupError?: Problem; updatedAt: number };
export type BaselineConsumer = { id: string; namespace: string; snapshotId: string; importId: string;
    kind: 'diagnostic' | 'task' | 'result'; owner: string; origin: WorkspaceSource; snapshotReused: boolean; active: boolean; createdAt: number };
export type Preparation = { id: string; namespace: string; requestId: string; parent: Parent; intent: PreparationIntent;
    agent: Selection; origin: WorkspaceSource; consumerId: string; environmentId: string; preparationId: string; attempted: boolean;
    phase: 'preparing' | 'ready' | 'failed' | 'unknown' | 'releasing' | 'released';
    workspace?: { cwd: string; checkout: string; branch: string; readyAt: number };
    error?: Problem; createdAt: number; updatedAt: number };
export class PreparationError extends RunweftError {
    constructor(readonly status: number, code: string, message: string, hint?: string) { super(code, message, hint); }
}
export function parsePreparation<T>(schema: z.ZodType<T>, value: unknown): T {
    const result = schema.safeParse(value);
    if (!result.success) throw new PreparationError(400, 'invalid_preparation_request', '工作区准备参数无效。', result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '));
    return result.data;
}
export const recoveryReference = (id: string) => `runweft:baseline:${id}`;
