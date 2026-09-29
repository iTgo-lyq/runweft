import { z } from 'zod';
import type { RepositoryFile, RepositoryOperation, RepositorySnapshot } from '../../hapi/shared/src/repositories';
import type { WorkspaceResult, WorkspaceSource } from '../../hapi/shared/src/workspaces';
import type { SnapshotPublication } from '../remote/publication';
import type { ImportBatch } from '../remote/types';
import type { Problem } from '../resources/types';
import { ParentSchema, type Parent } from './types';

export const ResultShowSchema = z.strictObject({ parent: ParentSchema, id: z.uuid(), roundId: z.uuid().optional() });
export const ResultFetchSchema = ResultShowSchema.extend({ requestId: z.uuid() });
export const ResultRetrySchema = ResultShowSchema.extend({ roundId: z.uuid(), requestId: z.uuid() });
export const ResultReleaseSchema = ResultShowSchema.extend({ apply: z.boolean().default(false), discardPending: z.boolean().default(false) });
export type ResultAction = z.infer<typeof ResultFetchSchema> & { action: 'fetch' | 'retry' };
export type RecoveryFile = RepositoryFile & { artifactId: string };
export type RecoverySnapshot = { snapshot: RepositorySnapshot; files: RecoveryFile[] };
export type CodeManifest = { version: number; taskId: string; roundId: string; jobId: string; origin: WorkspaceSource;
    result: WorkspaceResult; baseline: RecoverySnapshot; output: RecoverySnapshot; reference: string; createdAt: number;
    verified: { kind: 'export'; operationId: string; source: WorkspaceSource; verifiedAt: number; snapshot: RepositorySnapshot }
        | { kind: 'baseline' | 'result'; manifestId: string } };
export type CodeDelivery = SnapshotPublication & { id: string; exportAttempted: boolean;
    status: 'capturing' | 'publishing' | 'available' | 'needs_attention' | 'unknown'; stage: 'capture' | 'publish';
    baseline?: RecoverySnapshot; verified?: CodeManifest['verified']; reuse?: Record<string, string>;
    pinned: string[]; retryRequested?: boolean; latest?: CodeManifest; error?: Problem };
export type CodeFetch = { id: string; requestId: string; taskId: string; roundId: string; parent: Parent;
    target: Extract<RepositoryOperation['request'], { action: 'fetch-result' }>['target']; manifestVersion?: number;
    status: 'waiting' | 'materializing' | 'fetching' | 'available' | 'failed' | 'unknown'; operationId: string; attempted: boolean;
    baseline: ImportBatch[]; output: ImportBatch[]; released: boolean; fetched?: RepositoryOperation['fetched'];
    localRef?: string; createdAt: number; updatedAt: number; error?: Problem; cleanupError?: Problem };
export const resultReference = (taskId: string, roundId: string) => `runweft:result:${taskId}:${roundId}`;
