import { HubClient, type HubConnectionOptions } from '../client';
import { repositoryAlias } from './identity';
import type { Observation } from './observation';
import type { Checkout, Repository, RepositoryMatch } from './store';
const prefix = '/api/runweft/repositories';
const part = (id: string) => encodeURIComponent(id);
export class HubRepositoryClient extends HubClient {
    constructor(options: HubConnectionOptions) { super(options, 'hubRepositories', 'hub_repositories_unavailable'); }
    create(value: { requestId: string; name: string; aliases?: unknown[] }) {
        return this.request<{ repository: Repository }>(prefix, 'POST', { ...value, aliases: (value.aliases ?? []).map(a => repositoryAlias(a).descriptor) });
    }
    receipt(requestId: string) { return this.request<{ repository: Repository }>(`${prefix}/requests/${part(requestId)}`); }
    list() { return this.request<{ repositories: Repository[] }>(prefix); }
    repository(id: string) { return this.request<{ repository: Repository }>(`${prefix}/${part(id)}`); }
    rename(id: string, name: string) { return this.request<{ repository: Repository }>(`${prefix}/${part(id)}`, 'PATCH', { name }); }
    register(id: string, registered: boolean) { return this.request<{ repository: Repository }>(`${prefix}/${part(id)}${registered ? '/register' : ''}`, registered ? 'POST' : 'DELETE', {}); }
    alias(id: string, alias: unknown, add: boolean) {
        const body = !add && typeof alias === 'string' && /^[a-f0-9]{64}$/.test(alias) ? { canonicalKey: alias } : { alias: repositoryAlias(alias).descriptor };
        return this.request<{ repository: Repository }>(`${prefix}/${part(id)}/aliases`, add ? 'PUT' : 'DELETE', body);
    }
    match(machineId: string, observation: Observation, remote?: string, signal?: AbortSignal) { return this.request<RepositoryMatch>('/api/runweft/checkouts', 'POST', { machineId, observation, remote }, signal); }
    bind(machineId: string, observation: Observation, repositoryId: string) { return this.request<{ checkout: Checkout }>('/api/runweft/checkouts', 'PUT', { machineId, observation, repositoryId }); }
    unbind(machineId: string, observation: Observation) { return this.request<{ removed: boolean }>('/api/runweft/checkouts', 'DELETE', { machineId, observation }); }
    checkouts() { return this.request<{ checkouts: Checkout[] }>('/api/runweft/checkouts'); }
}
