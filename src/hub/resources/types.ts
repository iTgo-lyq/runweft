import { z } from 'zod';
import { NameSchema, ResourceError } from '../../resources/types';

export const MachineToken = z.string().regex(/^rw_mc_[A-Za-z0-9_-]{43}$/);
export const EnrollmentInput = z.object({ requestId: z.uuid(), token: MachineToken, name: NameSchema.optional() }).strict();
export const ReplacementInput = z.object({ expectedCredentialId: z.uuid(), token: MachineToken }).strict();
export type MachineRecord = {
    machineId: string; ownerId: string; name: string | null; registered: boolean; createdAt: number; updatedAt: number;
};
export type CredentialInfo = { id: string; createdAt: number; revokedAt: number | null; status: 'active' | 'revoked' };
export type Enrollment = { machineId: string; requestId: string; credential: CredentialInfo; originalCredentialCurrent: boolean };
export type MachineView = MachineRecord & {
    id: string; name: string; online: boolean; connection: 'pending' | 'online' | 'offline'; lastActiveAt: number | null;
    host: string | null; platform: string | null; spaceIds: string[];
    permissions: { manage: boolean; associate: boolean };
};
export const resourceForbidden = () => new ResourceError(403, 'resource_action_forbidden', '只有资源所有者可以执行此操作。');
export const replacedCredential = () => new ResourceError(409, 'machine_credential_replaced', '原机器凭据已被替换或撤销。', '查询原接入 requestId 的机器记录，显式替换凭据后重新启动 Runner；不要重复创建机器。');
