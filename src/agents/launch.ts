import { RunweftError } from '../errors';
import type { Flavor } from '../resources/types';

export type AgentLaunchOptions = { agent: Flavor; model?: string; effort?: string; modelReasoningEffort?: string; disabledMcpServers: string[] };
export function agentLaunchOptions(definition: { flavor: Flavor | null; model: string | null; reasoningEffort: string | null }, flavor: Flavor): AgentLaunchOptions {
    if (definition.flavor && definition.flavor !== flavor) throw new RunweftError('agent_flavor_mismatch', `Agent 要求 ${definition.flavor}，所选 runtime 为 ${flavor}。`, '选择同类型 runtime，或有意修改定义的类型与模型参数。');
    const launch: AgentLaunchOptions = { agent: flavor, disabledMcpServers: ['runweft'] };
    if (definition.model) launch.model = definition.model;
    if (definition.reasoningEffort) {
        if (flavor === 'codex') launch.modelReasoningEffort = definition.reasoningEffort;
        else launch.effort = definition.reasoningEffort;
    }
    return launch;
}
