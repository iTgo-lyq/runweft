import { fixtureCleanup } from './fixture-cleanup';
import { createRunweftHandler } from '../src/api';
import { createGateway } from '../src/proxy';
import { HapiClient } from '../src/hapi';
import { dataPaths, loadConfig } from '../src/config';
import type { Flavor, RuntimeView } from '../src/resources/types';
import { nativeFixture } from './native-fixture';
export { resourceInspection } from './native-fixture';
import { TaskCoordinator } from '../src/tasks/coordinator';
import { WorkspacePreparations } from '../src/remote/service';

export const resourcePrefix = '/api/runweft/resources';
export const resourceWrite = (value: unknown, method = 'POST'): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });

export async function resourceFixture(cleanups: (() => Promise<void> | void)[], extra?: {
    capabilities?: object; preparations?: boolean; fetch: (request: Request, namespace: string) => Promise<Response | undefined> | Response | undefined;
}, nativeState?: Awaited<ReturnType<typeof nativeFixture>>) {
    const cleanup = fixtureCleanup(cleanups);
    try {
        nativeState ??= await nativeFixture(cleanup.resources, extra);
        const { home, key, native, machines, inspections, failures, calls, tokens, hooks } = nativeState;
        const config = loadConfig(home, {});
        const statePath = dataPaths(config).state;
        const clientFor = (namespace: string) => new HapiClient(native.url.origin, `test-${namespace}`);
        let preparations = extra?.preparations ? new WorkspacePreparations(statePath, clientFor, 10) : undefined;
        if (preparations) cleanup.resources.push(() => preparations?.close());
        let tasks = extra ? new TaskCoordinator(statePath, clientFor, 20, preparations?.baselines) : undefined;
        if (tasks) cleanup.resources.push(() => tasks?.close());
        const gateway = await createGateway({ host: '127.0.0.1', port: 0, target: native.url.origin,
            handle: createRunweftHandler({ key, hapiUrl: native.url.origin, statePath, get tasks() { return tasks; }, get preparations() { return preparations; },
                health: () => ({ service: 'runweft', role: 'hub-server', ready: true, protocolVersion: 1 }) }),
        });
        cleanup.resources.push(() => gateway.close());
        const address = gateway.server.address() as { port: number };
        const url = `http://127.0.0.1:${address.port}`;
        const alpha = new HapiClient(url, 'test-alpha'), beta = new HapiClient(url, 'test-beta');
        const register = async (machineId = 'own', flavor: Flavor = 'codex', client = alpha): Promise<RuntimeView> => {
            await client.request(`${resourcePrefix}/machines`, resourceWrite({ machineId }));
            return (await client.request(`${resourcePrefix}/runtimes`, resourceWrite({ machineId, flavor }))).runtime;
        };
        return { home, config, statePath, url, alpha, beta, machines, inspections, calls, tokens, failures, hooks, register, key, get tasks() { return tasks; }, nativeUrl: native.url.origin,
            get preparations() { return preparations; },
            async restartPreparations() { await tasks?.close(); await preparations!.close(); preparations = new WorkspacePreparations(statePath, clientFor, 10); tasks = new TaskCoordinator(statePath, clientFor, 20, preparations.baselines); preparations.start(); },
            setInventorySupported: nativeState.setInventorySupported };
    } catch (error) { return cleanup.failed(error); }
}
