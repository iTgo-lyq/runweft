import { z } from 'zod';
import { ArtifactOutputsSchema } from '../../../hapi/shared/src/artifactTransfers';
import { ParentSchema, ArtifactInputSchema, type SpawnIntent } from '../../tasks/types';
import { Observation } from '../repositories/observation';

const fields = { agentId: z.uuid().optional(), runtimeId: z.uuid().optional(), observation: Observation,
    remote: z.string().min(1).max(255).optional() };
export const HubSpawnIntent = z.object({ ...fields, message: z.string().trim().min(1).max(200_000),
    inputs: z.array(ArtifactInputSchema).max(100).optional(), outputs: ArtifactOutputsSchema.optional(),
    workspaceMode: z.enum(['shared', 'worktree']), baseRef: z.string().trim().min(1).optional() }).strict()
    .refine(value => value.workspaceMode === 'worktree' || value.baseRef === undefined, '共享工作区不接受 baseRef');
export const HubSpawn = z.object({ parent: ParentSchema, requestId: z.uuid(), intent: HubSpawnIntent }).strict();
export const HubPreparation = z.object({ parent: ParentSchema, requestId: z.uuid(),
    intent: z.object({ ...fields, baseRef: z.string().trim().min(1) }).strict() }).strict();
export function taskIntent(input: z.infer<typeof HubSpawnIntent>): SpawnIntent {
    const { agentId, runtimeId, observation, remote, ...intent } = input;
    return { ...intent, agentType: agentId ?? 'default', hubRequest: { agentId, runtimeId, observation, remote } };
}
