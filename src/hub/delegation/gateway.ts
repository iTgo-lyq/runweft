import { createConfigurationGateway } from '../configuration/gateway';
import { HubDelegationService } from './service';
import { handleDelegationRequest } from './api';

/** Composed and independently testable before the default CLI/service cutover. */
export async function createDelegationGateway(options: Parameters<typeof createConfigurationGateway>[0] & { pollMs?: number }) {
    let delegation: HubDelegationService;
    const gateway = await createConfigurationGateway({ ...options,
        capabilities: { ...options.capabilities, hubDelegation: 1, hubWorkspacePreparations: 1 },
        executionPolicy: (owner, space, machine, flavor, binding) => { delegation.execution(binding); options.executionPolicy?.(owner, space, machine, flavor, binding); },
        sessionPolicy: (binding, method, suffix) => { delegation.sessionPolicy(binding, method, suffix); options.sessionPolicy?.(binding, method, suffix); },
        business: async (request, response, actor, lease) => await handleDelegationRequest(request, response, lease, delegation)
            || await options.business?.(request, response, actor, lease) || false,
    });
    delegation = new HubDelegationService(options.statePath, gateway, options.pollMs);
    delegation.start();
    return { ...gateway, delegation, async close() { await delegation.close(); await gateway.close(); } };
}
