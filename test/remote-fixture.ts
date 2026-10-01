import { fixtureCleanup } from './fixture-cleanup';
import { remoteNativeFixture } from './remote-native-fixture';
import { hubWorkspaceFixture } from './hub-workspace-fixture';
import { resourceInspection } from './native-fixture';
import type { Flavor } from '../src/resources/types';
import type { PreparationView } from '../src/remote/client';

export async function remoteFixture(cleanups: (() => Promise<void> | void)[], assetCount = 2, flavor: Flavor = 'codex', changed = false) {
    const cleanup = fixtureCleanup(cleanups);
    try {
        const git = remoteNativeFixture(assetCount, changed);
        const native = git.handler;
        // Separate handlers only by actual native domain; both share one fake's receipts/state.
        const h = await hubWorkspaceFixture(cleanup.resources, flavor, async (request, namespace) => (await native(request, namespace))!, native);
        const sourceMachineId = h.machineId, targetMachineId = h.machine();
        const runtime = h.gateway.resources.store.registerRuntime(h.actor, { machineId: targetMachineId, flavor }, resourceInspection(flavor));
        const agent = h.gateway.agents.update(h.actor, h.agent.id, { expectedVersion: 1, definition: { ...h.definition, runtimeId: runtime.id } });
        git.connect({ sourceMachineId, targetMachineId, root: h.cwd, url: () => h.url, machineToken: id => h.machineConnections.get(id)!.token });
        const originalPayload = h.payload;
        const payload = () => { const value = originalPayload(); return { ...value, intent: { ...value.intent, workspaceMode: 'worktree', baseRef: 'HEAD' } }; };
        async function prepare(action: string, value: object) {
            const result = await h.request(action, value, undefined, 'workspaces');
            if (result.status !== 200) throw Object.assign(new Error(result.body.error?.message), result.body.error, { status: result.status });
            return result.body;
        }
        return Object.assign(h, git, { nativeFaults: h.faults, runtime, agent, sourceMachineId, targetMachineId, payload, prepare,
            preparationPayload() { const value = payload(); return { parent: { ...value.parent }, requestId: value.requestId, intent: { agentId: agent.id, observation: structuredClone(value.intent.observation), baseRef: 'HEAD' } }; },
            async inspect(id: string): Promise<PreparationView> { return (await prepare('inspect', { parent: h.parent, id })).preparation; } });
    } catch (error) { return cleanup.failed(error); }
}
