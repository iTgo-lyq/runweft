import { z } from 'zod';
import { FlavorSchema, NameSchema, ResourceError, type Flavor, type Inspection, type Eligibility } from '../../resources/types';

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
    host?: string | null; platform?: string | null; spaceIds?: string[];
    blockedInSpace: boolean;
    permissions: { manage: boolean; associate: boolean; govern: boolean };
};
export const RuntimeInput = z.object({ machineId: z.uuid(), flavor: FlavorSchema, name: NameSchema.optional() }).strict();
export type RuntimeRecord = { id: string; ownerId: string; machineId: string; flavor: Flavor; name: string;
    registered: boolean; inspection: Inspection | null; createdAt: number; updatedAt: number };
export type Observation = { version: string | null; versionStatus: Inspection['details']['versionStatus'] | null;
    checkedAt: number | null; toolFound: boolean | null };
export type RuntimeView = Omit<RuntimeRecord, 'inspection'> & Observation & { inspection?: Inspection | null;
    inspectionCurrent: boolean; online: boolean; eligibility: Eligibility; shared: boolean; shareSpaceIds?: string[];
    blockedInSpace: boolean; machineBlockedInSpace: boolean;
    permissions: { manage: boolean; share: boolean; use: boolean; govern: boolean };
    modelAuthentication: 'not_checked'; execution: 'not_checked' };
export type PublicExecutionTarget = Observation & { runtimeId: string; machineId: string; flavor: Flavor; ownerId: string; spaceId: string; shared: boolean };
export const resourceForbidden = () => new ResourceError(403, 'resource_action_forbidden', '只有资源所有者可以执行此操作。');
export const replacedCredential = () => new ResourceError(409, 'machine_credential_replaced', '原机器凭据已被替换或撤销。', '查询原接入 requestId 的机器记录，显式替换凭据后重新启动 Runner；不要重复创建机器。');
