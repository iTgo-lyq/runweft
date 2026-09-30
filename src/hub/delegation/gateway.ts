import { createConfigurationGateway } from '../configuration/gateway';
import { HubDelegationService } from './service';
import { handleDelegationRequest } from './api';
import { HubError } from '../types';

/** Composed and independently testable before the default CLI/service cutover. */
export async function createDelegationGateway(options: Parameters<typeof createConfigurationGateway>[0] & { pollMs?: number }) {
    let delegation!: HubDelegationService;
    let ready = false;
    const gateway = await createConfigurationGateway({ ...options,
        capabilities: { ...options.capabilities, hubDelegation: 1, hubWorkspacePreparations: 1 },
        executionPolicy: (owner, space, machine, flavor, binding) => { delegation.execution(binding); options.executionPolicy?.(owner, space, machine, flavor, binding); },
        sessionPolicy: (binding, method, suffix) => { delegation.sessionPolicy(binding, method, suffix); options.sessionPolicy?.(binding, method, suffix); },
        business: async (request, response, actor, lease) => {
            if (!ready) throw new HubError(503, 'delegation_starting', '委派服务正在恢复，请稍后查询。');
            return await handleDelegationRequest(request, response, lease, delegation)
                || await options.business?.(request, response, actor, lease) || false;
        },
    });
    try {
        delegation = new HubDelegationService(options.statePath, gateway, options.pollMs);
        const pending = await delegation.coordinator.reconcileFileIntents();
        for (const item of pending) console.error(`Runweft 附件清理待重试：${item.requestId} (${item.code})；授权或连接恢复后重启 Hub。`);
        delegation.start(); ready = true;
    } catch (error) { await delegation?.close(); await gateway.close(); throw error; }
    return { ...gateway, delegation, async close() { await delegation.close(); await gateway.close(); } };
}
