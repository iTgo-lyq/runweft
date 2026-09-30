import { contentVersion } from '../../agents/definitions';
import { agentLaunchOptions, type AgentLaunchOptions } from '../../agents/launch';
import type { AuthorizationLease as RequestLease } from '../access/transport';
import type { HubResourceService } from '../resources/service';
import type { PublicExecutionTarget } from '../resources/types';
import { AgentSelectionStore, type SelectedAgent } from './selections';

export type ResolvedHubAgent = Omit<SelectedAgent, 'runtimeId' | 'request' | 'selectionHash'> & { target: PublicExecutionTarget; launchOptions: AgentLaunchOptions;
    resolvedVersion: string; modelAuthentication: 'not_checked'; modelCompatibility: 'not_checked'; execution: 'not_checked' };
export class HubAgentResolver {
    constructor(readonly selections: AgentSelectionStore, readonly resources: HubResourceService) {}
    async resolve(lease: RequestLease, input: unknown): Promise<ResolvedHubAgent> {
        const selected = this.selections.select(lease.actor, input);
        lease.add(() => { this.selections.validateSelection(lease.actor, selected); });
        const target = await this.resources.resolve(lease, selected.runtimeId); lease.check();
        const { runtimeId, request, selectionHash, ...agent } = selected;
        const launchOptions = agentLaunchOptions(agent.definition, target.flavor);
        // Probe timestamps are observations, not part of configuration identity.
        const resolvedVersion = contentVersion({ selectionHash, machineId: target.machineId, flavor: target.flavor });
        return structuredClone({ ...agent, target, launchOptions, resolvedVersion,
            modelAuthentication: 'not_checked', modelCompatibility: 'not_checked', execution: 'not_checked' });
    }
}
