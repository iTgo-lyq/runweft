import { z } from 'zod';
import { connectionName, type ResolvedConfig } from '../config';
import { errorDetails, RunweftError } from '../errors';
import { hapiClient, type HapiClient } from '../hapi';
import { ResourceClient } from '../resources/client';
import type { ExecutionTarget, Flavor, Problem, RuntimeView } from '../resources/types';
import { agentBindings, removeAgentBinding, saveAgentBinding, type AgentBinding } from './bindings';
import { contentVersion, listAgents, readAgent, type AgentDocument, type AgentScope } from './definitions';

export type AgentConnection = { name: string; namespace: string };
export type AgentSelection = { runtimeId: string; source: 'binding' | 'definition' };
export type AgentLaunchOptions = { agent: Flavor; model?: string; effort?: string; modelReasoningEffort?: string; disabledMcpServers: string[] };
export type ResolvedAgent = AgentDocument & {
    connection: AgentConnection; selection: AgentSelection; target: ExecutionTarget; launchOptions: AgentLaunchOptions; resolvedVersion: string;
    modelAuthentication: 'not_checked'; modelCompatibility: 'not_checked'; execution: 'not_checked';
};
export type AgentAvailability = AgentDocument & { selection: AgentSelection | null; runtime: RuntimeView | null; error: Problem | null };

function selection(agent: AgentDocument, bindings: AgentBinding[], namespace: string): AgentSelection {
    const binding = bindings.find(binding => binding.sourceKey === agent.source.key && binding.namespace === namespace);
    const runtimeId = binding?.runtimeId ?? agent.definition.runtime;
    if (!runtimeId) throw new RunweftError('agent_unbound', `Agent ${agent.id} 尚未绑定执行目标。`, `运行 runweft agent bind ${agent.id} --scope ${agent.source.scope} --runtime <ID>；用 runweft runtime list 查看 ID。`);
    return { runtimeId, source: binding ? 'binding' : 'definition' };
}
function matchFlavor(agent: AgentDocument, flavor: Flavor) {
    if (agent.definition.flavor && agent.definition.flavor !== flavor) throw new RunweftError('agent_flavor_mismatch', `Agent ${agent.id} 要求 ${agent.definition.flavor}，所选 runtime 为 ${flavor}。`, '选择同类型 runtime，或有意修改定义中的 flavor 和相关模型参数。');
}
function snapshot(agent: AgentDocument, connection: AgentConnection, selected: AgentSelection, target: ExecutionTarget): ResolvedAgent {
    matchFlavor(agent, target.flavor);
    const launchOptions: AgentLaunchOptions = { agent: target.flavor, disabledMcpServers: ['runweft'] };
    if (agent.definition.model) launchOptions.model = agent.definition.model;
    if (agent.definition.reasoningEffort) {
        if (target.flavor === 'codex') launchOptions.modelReasoningEffort = agent.definition.reasoningEffort;
        else launchOptions.effort = agent.definition.reasoningEffort;
    }
    return structuredClone({ ...agent, connection, selection: selected, target, launchOptions,
        resolvedVersion: contentVersion({ definitionVersion: agent.definitionVersion, connection, selection: selected, machineId: target.machineId, flavor: target.flavor }),
        modelAuthentication: 'not_checked', modelCompatibility: 'not_checked', execution: 'not_checked',
    });
}

/** Definition consumption only. Dispatch must resolve again; no method here creates an execution. */
export class AgentClient {
    private readonly resources: ResourceClient;
    private identity?: Promise<AgentConnection>;
    constructor(private readonly config: ResolvedConfig, private readonly cwd: string, private readonly hapi: HapiClient = hapiClient(config)) {
        this.resources = new ResourceClient(config, hapi);
    }
    private authenticate(signal?: AbortSignal): Promise<AgentConnection> {
        signal?.throwIfAborted();
        return this.identity ??= this.hapi.authenticate(signal).then(identity => {
            if (typeof identity.namespace !== 'string' || !identity.namespace) throw new RunweftError('invalid_hapi_response', 'HAPI 未返回有效 namespace。');
            return { name: connectionName(this.config.config), namespace: identity.namespace };
        }).catch(error => { this.identity = undefined; throw error; });
    }
    async resolve(id: string, scope?: AgentScope, signal?: AbortSignal): Promise<ResolvedAgent> {
        signal?.throwIfAborted();
        const agent = readAgent(this.config, this.cwd, id, scope);
        const connection = await this.authenticate(signal);
        const selected = selection(agent, agentBindings(this.config, agent.source.key), connection.namespace);
        const target = await this.resources.resolveExecutionTarget(selected.runtimeId, signal);
        return snapshot(agent, connection, selected, target);
    }
    async bind(id: string, runtimeId: string, scope?: AgentScope) {
        if (!z.uuid().safeParse(runtimeId).success) throw new RunweftError('agent_runtime_invalid', '绑定需要 runtime UUID。', '运行 runweft runtime list 查看 ID。');
        const agent = readAgent(this.config, this.cwd, id, scope);
        const connection = await this.authenticate();
        const { runtime } = await this.resources.runtime(runtimeId);
        matchFlavor(agent, runtime.flavor);
        const problem = runtime.eligibility.reason;
        if (problem?.code === 'local_machine_missing' || problem?.code === 'local_target_required') throw new RunweftError(problem.code, problem.message, problem.hint);
        const binding = saveAgentBinding(this.config, agent.source.key, connection.namespace, runtimeId);
        return { agent, connection, binding, runtime };
    }
    async unbind(id: string, scope?: AgentScope) {
        const agent = readAgent(this.config, this.cwd, id, scope);
        const connection = await this.authenticate();
        const removed = removeAgentBinding(this.config, agent.source.key, connection.namespace);
        return { agent, connection, removed, declaredRuntime: agent.definition.runtime };
    }
    async list(signal?: AbortSignal) {
        signal?.throwIfAborted();
        const catalog = listAgents(this.config, this.cwd);
        const connection = await this.authenticate(signal);
        const bindings = agentBindings(this.config);
        const { runtimes } = await this.resources.runtimes(true, signal);
        const byId = new Map(runtimes.map(runtime => [runtime.id, runtime]));
        const agents: AgentAvailability[] = catalog.agents.map(agent => {
            let selected: AgentSelection | null = null, runtime: RuntimeView | null = null;
            try {
                selected = selection(agent, bindings, connection.namespace);
                runtime = byId.get(selected.runtimeId) ?? null;
                if (!runtime) throw new RunweftError('runtime_unknown', `当前连接中找不到 runtime：${selected.runtimeId}`, '检查连接/namespace，或显式重新绑定。');
                matchFlavor(agent, runtime.flavor);
                return { ...agent, selection: selected, runtime, error: runtime.eligibility.reason };
            } catch (error) { return { ...agent, selection: selected, runtime, error: errorDetails(error) }; }
        });
        return { context: catalog.context, connection, agents, errors: catalog.errors, modelAuthentication: 'not_checked', modelCompatibility: 'not_checked', execution: 'not_checked' };
    }
}

/** Stored rows are possible bindings, not an authenticated choice. */
export function offlineAgent(agent: AgentDocument, bindings: AgentBinding[]) {
    return { ...agent, personalBindings: bindings.filter(binding => binding.sourceKey === agent.source.key), namespaceVerified: false };
}
