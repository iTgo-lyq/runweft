import { z } from 'zod';
import { FlavorSchema, type Problem } from '../../resources/types';
import { HubError, HubName } from '../types';

const text = z.preprocess(value => typeof value === 'string' ? value.trim() || null : value ?? null, z.string().max(256).nullable());
export const AgentDefinition = z.object({
    name: HubName, description: z.string().max(4096).default(''), instructions: z.string().max(32768).default(''),
    repositoryId: z.uuid().nullable().default(null), runtimeId: z.uuid().nullable().default(null),
    flavor: FlavorSchema.nullable().default(null), model: text, reasoningEffort: text,
}).strict().superRefine((value, ctx) => {
    if ((value.model || value.reasoningEffort) && !value.flavor) ctx.addIssue({ code: 'custom', path: ['flavor'], message: '模型参数需要明确 runtime 类型。' });
});
export type AgentDefinition = z.infer<typeof AgentDefinition>;
export const AccessMode = z.enum(['private', 'members', 'space']);
export type AccessMode = z.infer<typeof AccessMode>;
export const CreateAgent = z.object({ requestId: z.uuid(), definition: AgentDefinition }).strict();
export const UpdateAgent = z.object({ expectedVersion: z.number().int().positive(), definition: AgentDefinition }).strict();
export const AgentAccess = z.object({ mode: AccessMode, memberIds: z.array(z.uuid()).max(500).default([]) }).strict()
    .refine(value => value.mode === 'members' || value.memberIds.length === 0);
export const agentInvalid = () => new HubError(400, 'agent_input_invalid', 'Agent 参数无效。', '提交允许的业务字段；完整定义须有 name，模型参数须有 flavor，修改须提供 expectedVersion。');
export const agentOwnerRequired = () => new HubError(403, 'agent_owner_required', '只有 Agent 所有者可以修改内容、登记、分享或查看历史版本。');
export function agentInput<T>(schema: z.ZodType<T>, value: unknown): T { const parsed = schema.safeParse(value); if (!parsed.success) throw agentInvalid(); return parsed.data; }
export type AgentVersion = { agentId: string; version: number; contentHash: string; definition: AgentDefinition; createdAt: number };
export type AgentSummary = { id: string; ownerId: string; spaceId: string; name: string; repositoryId: string | null; version: number;
    registered: boolean; accessMode: AccessMode; blocked: boolean; ownerPresent: boolean; createdAt: number; updatedAt: number;
    permissions: { edit: boolean; share: boolean; govern: boolean; readDefinition: boolean; invoke: boolean; history: boolean } };
export type AgentView = AgentSummary & ({ view: 'governance' } | { view: 'definition'; definition: AgentDefinition; contentHash: string; memberIds?: string[] });
export type Invocable = { eligible: boolean; reason: Problem | null };
