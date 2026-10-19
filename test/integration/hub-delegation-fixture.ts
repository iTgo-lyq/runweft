import { createTestIdentity } from '../identity-fixture';
import { randomBytes, randomUUID } from 'node:crypto';
import { taskNativeFixture } from './task-native-fixture';
import { fixtureCleanup } from '../fixture-cleanup';
import { dataPaths, loadConfig } from '../../src/config';
import { resourceInspection } from './native-fixture';
import { createDelegationGateway } from '../../src/hub/delegation/gateway';
import { HubStore } from '../../src/hub/store';
import type { NativeFixtureOptions } from './native-fixture';
import type { Flavor } from '../../src/resources/types';

export async function hubDelegationFixture(cleanups: (() => void | Promise<void>)[], flavor: Flavor = 'codex', workspaceApi?: (request: Request, namespace: string) => Promise<Response>, nativeOptions: NativeFixtureOptions = {}, pollMs = 10) {
    const cleanup = fixtureCleanup(cleanups);
    try {
        const h = await taskNativeFixture(cleanup.resources, flavor, workspaceApi, undefined, { ...nativeOptions, namespaces: ['runweft'] });
        const config = loadConfig(h.home, {}), statePath = dataPaths(config).state;
        const hub = new HubStore(statePath); cleanup.resources.push(() => hub.close());
        const owner = createTestIdentity(hub, 'delegator'), other = createTestIdentity(hub, 'machine owner');
        hub.acceptInvitation(other.identity.id, hub.invite(owner.identity.id, owner.personalSpace.id, 'admin').token);
        let gateway = await createDelegationGateway({ host: '127.0.0.1', port: 0, target: h.nativeUrl, rootToken: 'test-', key: h.key, statePath: statePath, pollMs });
        cleanup.resources.push(() => gateway.close());
        const space = owner.personalSpace.id, actor = gateway.store.authenticate(owner.token, space), outsider = gateway.store.authenticate(other.token, space);
        const machineConnections = new Map<string, { token: string; requestId: string; credentialId: string }>();
        const machine = (who = actor) => {
            const requestId = randomUUID(), token = `rw_mc_${randomBytes(32).toString('base64url')}`;
            const { machineId, credential } = gateway.resources.store.enroll(who, { requestId, token });
            machineConnections.set(machineId, { requestId, token, credentialId: credential.id });
            gateway.resources.store.associate(who, machineId, space, true);
            const value = structuredClone(h.machines[0]); value.id = machineId; value.namespace = 'runweft';
            value.runnerState!.capabilities = { ...value.runnerState!.capabilities, mcpToolFilter: true, managedWorkspaces: 1, artifactTransfers: 1, artifactOutputs: 1, repositoryExport: 1, repositoryImport: 1, repositoryResults: 1 };
            h.machines.push(value); h.inspections.set(machineId, [resourceInspection('codex'), resourceInspection('claude')]); return machineId;
        };
        const machineId = machine(), runtime = gateway.resources.store.registerRuntime(actor, { machineId, flavor }, resourceInspection(flavor));
        const definition = { name: 'Central reviewer', instructions: 'version one', runtimeId: runtime.id, flavor };
        const agent = gateway.agents.create(actor, { requestId: randomUUID(), definition });
        const parent = { kind: 'cli' as const, machineId, cwd: h.cwd };
        const payload = () => ({ parent, requestId: randomUUID(), intent: { agentId: agent.id, observation: { kind: 'non_git', cwd: h.cwd }, message: 'Review', workspaceMode: 'shared' } });
        const token = async (identity = owner.token, spaceId = space) => (await gateway.authority.exchange(identity, spaceId)).token;
        const currentUrl = () => `http://127.0.0.1:${(gateway.server.address() as { port: number }).port}`;
        let jwt = await token();
        async function request(action: string, body?: object, auth = jwt, domain = 'tasks') {
            const response = await fetch(`${currentUrl()}/api/runweft/${domain}/${action}`, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${auth}`, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
            return { status: response.status, body: await response.json() as any };
        }
        async function post(action: string, body: object = {}) {
            const result = await request(action, { parent, ...body });
            if (result.status !== 200) throw Object.assign(new Error(result.body.error?.message), result.body.error, { status: result.status });
            return result.body;
        }
        return { ...h, config, statePath, namespace: gateway.delegation.scopes.ensure(actor), get url() { return currentUrl(); }, hub, get gateway() { return gateway; }, owner, other, actor, outsider, space, machine, machineId, machineConnections, runtime, agent, definition, parent, payload, token, request, post,
            async restart() {
                await gateway.close();
                gateway = await createDelegationGateway({ host: '127.0.0.1', port: 0, target: h.nativeUrl, rootToken: 'test-', key: h.key, statePath, pollMs });
            },
            async use(identity: string, spaceId = space) { jwt = await token(identity, spaceId); } };
    } catch (error) { return cleanup.failed(error); }
}
