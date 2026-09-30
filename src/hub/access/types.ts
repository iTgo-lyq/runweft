import { z } from 'zod';

export const HAPI_EXECUTION_NAMESPACE = 'runweft';
export const ExecutionId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const ObjectKind = z.enum(['machine', 'task', 'session', 'artifact']);
export type ObjectKind = z.infer<typeof ObjectKind>;
export type Operation = 'read' | 'write' | 'report';
export type PrincipalKind = 'user' | 'machine' | 'task';
export type Principal = {
    kind: PrincipalKind; id: string; ownerId: string; userNumber: number; name: string;
    digest: string; machineId: string | null; taskId: string | null; spaceId: string | null;
};
export const Binding = z.object({
    kind: ObjectKind, id: ExecutionId, ownerId: z.uuid(), spaceId: z.uuid().nullable().default(null),
    taskId: ExecutionId.nullable().default(null), machineId: ExecutionId.nullable().default(null),
}).strict();
export type Binding = z.infer<typeof Binding>;
export type ExecutionObject = Binding & { createdAt: number; retiredAt: number | null };
export const IntentInput = z.object({
    requestKey: z.string().min(1).max(200), ownerId: z.uuid(), spaceId: z.uuid().nullable().default(null),
    taskId: ExecutionId.nullable().default(null), machineId: ExecutionId,
    sourceSessionId: ExecutionId.nullable().default(null),
    operation: z.enum(['spawn', 'resume', 'reopen', 'fork', 'clear']),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/), expiresAt: z.number().int().positive(),
}).strict();
export type IntentInput = z.infer<typeof IntentInput>;
export type ExecutionIntent = IntentInput & { id: string; createdAt: number; sessionId: string | null; cancelledAt: number | null };
export const CredentialToken = /^(rw_mc_|rw_task_)[A-Za-z0-9_-]{43}$/;
