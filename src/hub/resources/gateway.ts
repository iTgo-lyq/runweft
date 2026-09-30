import { createAccessGateway, type AccessGatewayOptions } from '../access/http';
import { handleResourceRequest } from './api';
import { HubResourceService } from './service';
import { HubResourceStore } from './store';

/** Composable Hub domain entry; the default service moves here in the delegation migration. */
export async function createResourceGateway(options: Omit<AccessGatewayOptions, 'health'>) {
    let resources: HubResourceService;
    const gateway = await createAccessGateway({ ...options,
        health: () => ({ service: 'runweft', ready: true, protocolVersion: 1, capabilities: { hubIdentity: 1, hubAccess: 1, hubResources: 1 } }),
        business: async (request, response, actor, lease) =>
            await handleResourceRequest(request, response, lease, resources) || await options.business?.(request, response, actor, lease) || false,
    });
    resources = new HubResourceService(new HubResourceStore(gateway.store), gateway.native);
    return { ...gateway, resources };
}
