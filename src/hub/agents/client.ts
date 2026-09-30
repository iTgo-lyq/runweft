import { HubClient, type HubConnectionOptions } from '../client';
import type { AccessMode, AgentVersion, AgentView } from './types';
const prefix = '/api/runweft/agents';
const part = (id: string) => encodeURIComponent(id);
export class HubAgentClient extends HubClient {
    constructor(options: HubConnectionOptions) { super(options, 'hubAgentDefinitions', 'hub_agents_unavailable'); }
    create(requestId: string, definition: unknown) { return this.request<{ agent: AgentView }>(prefix, 'POST', { requestId, definition }); }
    receipt(requestId: string) { return this.request<{ agent: AgentView }>(`${prefix}/requests/${part(requestId)}`); }
    list() { return this.request<{ agents: AgentView[] }>(prefix); }
    agent(id: string) { return this.request<{ agent: AgentView }>(`${prefix}/${part(id)}`); }
    update(id: string, expectedVersion: number, definition: unknown) { return this.request<{ agent: AgentView }>(`${prefix}/${part(id)}`, 'PATCH', { expectedVersion, definition }); }
    register(id: string, registered: boolean) { return this.request<{ agent: AgentView }>(`${prefix}/${part(id)}${registered ? '/register' : ''}`, registered ? 'POST' : 'DELETE', {}); }
    access(id: string, mode: AccessMode, memberIds: string[] = []) { return this.request<{ agent: AgentView }>(`${prefix}/${part(id)}/access`, 'PUT', { mode, memberIds }); }
    block(id: string, blocked: boolean) { return this.request<{ agent: AgentView }>(`${prefix}/${part(id)}/block`, blocked ? 'PUT' : 'DELETE', {}); }
    versions(id: string) { return this.request<{ versions: AgentVersion[] }>(`${prefix}/${part(id)}/versions`); }
}
