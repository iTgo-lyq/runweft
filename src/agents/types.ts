import { z } from 'zod';
import { FlavorSchema } from '../resources/types';

export const AgentIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
export const ScopeSchema = z.enum(['global', 'project']);
export type AgentScope = z.infer<typeof ScopeSchema>;
const nullable = (value: unknown) => typeof value === 'string' ? value.trim() || null : value ?? null;
const optionalText = z.preprocess(nullable, z.string().nullable());
export const DefinitionSchema = z.strictObject({
    schemaVersion: z.literal(1).default(1), name: z.string().trim().min(1).optional(),
    description: z.string().default(''), instructions: z.string().default(''),
    runtime: z.preprocess(nullable, z.uuid().nullable()),
    flavor: z.preprocess(nullable, FlavorSchema.nullable()), model: optionalText, reasoningEffort: optionalText,
}).superRefine((value, ctx) => {
    if ((value.model || value.reasoningEffort) && !value.flavor) ctx.addIssue({ code: 'custom', path: ['flavor'], message: '配置模型或推理参数时必须填写 codex 或 claude' });
});
export type AgentDefinition = Omit<z.infer<typeof DefinitionSchema>, 'name'> & { name: string };
