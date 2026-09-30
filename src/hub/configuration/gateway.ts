import { createResourceGateway } from '../resources/gateway';
import { handleRepositoryRequest } from '../repositories/api';
import { RepositoryStore } from '../repositories/store';
import { HubAgentStore } from '../agents/store';
import { handleAgentRequest } from '../agents/api';
import { AgentSelectionStore } from '../agents/selections';
import { HubAgentResolver } from '../agents/resolver';
import { handleAgentSelectionRequest } from '../agents/selection-api';

/** Independent central configuration entry. Default delegation switches in its own migration. */
export async function createConfigurationGateway(options: Parameters<typeof createResourceGateway>[0]) {
    let repositories: RepositoryStore;
    let agents: HubAgentStore;
    let resolver: HubAgentResolver;
    const gateway = await createResourceGateway({ ...options,
        capabilities: { ...options.capabilities, hubRepositories: 1, hubAgentDefinitions: 1, hubAgents: 1 },
        business: async (request, response, actor, lease) =>
            await handleRepositoryRequest(request, response, lease, repositories) || await handleAgentRequest(request, response, lease, agents) || await handleAgentSelectionRequest(request, response, lease, resolver) || await options.business?.(request, response, actor, lease) || false,
    });
    repositories = new RepositoryStore(gateway.resources.store);
    agents = new HubAgentStore(repositories);
    const selections = new AgentSelectionStore(agents);
    resolver = new HubAgentResolver(selections, gateway.resources);
    return { ...gateway, repositories, agents, selections, resolver };
}
