import type { Flavor } from '../resources/types';

/** Persisted current central Agent snapshot projection. */
export type AgentDefinition = { schemaVersion: 1; name?: string; description: string; instructions: string;
    runtime: string | null; flavor: Flavor | null; model: string | null; reasoningEffort: string | null };
