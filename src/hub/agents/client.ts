import { HubClient, type HubConnectionOptions } from '../client';
import type { AccessMode, AgentVersion, AgentView } from './types';
import type { PersonalSelection, ResolveInput } from './selections';
import type { ResolvedHubAgent } from './resolver';
const prefix = '/api/runweft/agents';
const part = (id: string) => encodeURIComponent(id);
export class HubAgentClient extends HubClient {
    constructor(options: HubConnectionOptions) { super(options, 'hubAgentDefinitions', 'hub_agents_unavailable'); }
    create(requestId: string, definition: unknown) { return this.request<{ agent: AgentView }>(prefix, 'POST', { requestId, definition }); }
    receipt(requestId: string) { return this.request<{ agent: AgentView }>(`${prefix}/requests/${part(requestId)}`); }
    list(signal?: AbortSignal) { return this.request<{ agents: AgentView[] }>(prefix, 'GET', undefined, signal); }
    agent(id: string) { return this.request<{ agent: AgentView }>(`${prefix}/${part(id)}`); }
    update(id: string, expectedVersion: number, definition: unknown) { return this.request<{ agent: AgentView }>(`${prefix}/${part(id)}`, 'PATCH', { expectedVersion, definition }); }
    register(id: string, registered: boolean) { return this.request<{ agent: AgentView }>(`${prefix}/${part(id)}${registered ? '/register' : ''}`, registered ? 'POST' : 'DELETE', {}); }
    access(id: string, mode: AccessMode, memberIds: string[] = []) { return this.request<{ agent: AgentView }>(`${prefix}/${part(id)}/access`, 'PUT', { mode, memberIds }); }
    block(id: string, blocked: boolean) { return this.request<{ agent: AgentView }>(`${prefix}/${part(id)}/block`, blocked ? 'PUT' : 'DELETE', {}); }
    versions(id: string) { return this.request<{ versions: AgentVersion[] }>(`${prefix}/${part(id)}/versions`); }
    async selections() { await this.requireCapability('hubAgents', 'hub_agent_resolution_unavailable'); return this.request<{ selections: PersonalSelection[] }>('/api/runweft/agent-selections'); }
    async select(agentId: string, repositoryId: string | null = null, runtimeId: string | null = null) {
        await this.requireCapability('hubAgents', 'hub_agent_resolution_unavailable');
        return this.request<{ selection: PersonalSelection }>('/api/runweft/agent-selections', 'PUT', { agentId, repositoryId, runtimeId });
    }
    async unselect(repositoryId: string | null = null) {
        await this.requireCapability('hubAgents', 'hub_agent_resolution_unavailable');
        return this.request<{ removed: boolean }>('/api/runweft/agent-selections', 'DELETE', { repositoryId });
    }
    async resolve(input: Partial<ResolveInput> = {}, signal?: AbortSignal) {
        await this.requireCapability('hubAgents', 'hub_agent_resolution_unavailable', signal);
        return this.request<{ resolution: ResolvedHubAgent }>('/api/runweft/agent-resolution', 'POST', input, signal);
    }

}
