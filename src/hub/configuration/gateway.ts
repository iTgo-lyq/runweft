import { createResourceGateway } from '../resources/gateway';
import { handleRepositoryRequest } from '../repositories/api';
import { RepositoryStore } from '../repositories/store';
import { HubAgentStore } from '../agents/store';
import { handleAgentRequest } from '../agents/api';

/** Independent central configuration entry. Default delegation switches in its own migration. */
export async function createConfigurationGateway(options: Parameters<typeof createResourceGateway>[0]) {
    let repositories: RepositoryStore;
    let agents: HubAgentStore;
    const gateway = await createResourceGateway({ ...options,
        capabilities: { ...options.capabilities, hubRepositories: 1, hubAgentDefinitions: 1 },
        business: async (request, response, actor, lease) =>
            await handleRepositoryRequest(request, response, lease, repositories) || await handleAgentRequest(request, response, lease, agents) || await options.business?.(request, response, actor, lease) || false,
    });
    repositories = new RepositoryStore(gateway.resources.store);
    agents = new HubAgentStore(repositories);
    return { ...gateway, repositories, agents };
}
