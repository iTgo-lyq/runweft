import { fixtureCleanup } from './fixture-cleanup';
import { taskNativeFixture } from './task-native-fixture';
import { resourceFixture, resourceWrite } from './resources-fixture';
import type { AgentSnapshot, Parent, SpawnIntent } from '../src/tasks/types';
import type { Flavor } from '../src/resources/types';

export async function taskFixture(cleanups: (() => Promise<void> | void)[], flavor: Flavor = 'codex', workspaceApi?: (request: Request, namespace: string) => Promise<Response>, filesApi?: (request: Request, namespace: string) => Promise<Response | undefined>) {
    const cleanup = fixtureCleanup(cleanups);
    try {
        const fake = await taskNativeFixture(cleanup.resources, flavor, workspaceApi, filesApi);
        const h = await resourceFixture(cleanup.resources, { fetch: () => undefined }, { ...fake, calls: fake.nativeCalls });
        const runtime = await h.register('own', flavor);
        const cwd = fake.cwd;
        const parent: Parent = { kind: 'cli', machineId: 'own', cwd };
        const agent: AgentSnapshot = { id: 'review', definition: { schemaVersion: 1, name: 'Review', description: '', instructions: '', runtime: null, flavor: null, model: null, reasoningEffort: null },
            source: { scope: 'global', path: '/definition.yaml', key: 'global/review', linkTarget: null }, definitionVersion: 'initial', resolvedVersion: 'initial',
            runtimeId: runtime.id, machineId: 'own', flavor, namespace: 'alpha' };
        const intent: SpawnIntent = { agentType: 'review', message: 'Review the task', workspaceMode: 'shared' };
        const payload = () => ({ parent, requestId: crypto.randomUUID(), intent, agent });
        const post = (action: string, value: object = {}) => h.alpha.request(`/api/runweft/tasks/${action}`, resourceWrite({ parent, ...value }));
        h.tasks!.start();
        return { ...h, runtime, cwd, parent, agent, intent, payload, post,
            sessions: fake.sessions, receipts: fake.receipts, calls: fake.calls, faults: fake.faults, onInput: fake.onInput, complete: fake.complete,
        };
    } catch (error) { return cleanup.failed(error); }
}

export { until } from './helpers';
