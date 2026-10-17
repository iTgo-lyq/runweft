import { fixtureCleanup } from '../fixture-cleanup';
import { execFileSync } from 'node:child_process';
import { hubDelegationFixture } from './hub-delegation-fixture';
import { observeRepository } from '../../src/hub/repositories/observation';
import type { Flavor } from '../../src/resources/types';

/** Current center setup, with an actual local Git observation for workspace RPC tests. */
export async function hubWorkspaceFixture(cleanups: (() => void | Promise<void>)[], flavor: Flavor = 'codex',
    workspaceApi?: (request: Request, namespace: string) => Promise<Response>,
    filesApi?: (request: Request, namespace: string) => Promise<Response | undefined>) {
    const cleanup = fixtureCleanup(cleanups);
    try {
        const h = await hubDelegationFixture(cleanup.resources, flavor, workspaceApi, { fetch: filesApi });
        if (workspaceApi) {
            for (const args of [['init'], ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '--allow-empty', '-m', 'baseline']])
                execFileSync('git', args, { cwd: h.cwd, stdio: 'ignore' });
            const observation = observeRepository(h.cwd);
            const repository = h.gateway.repositories.create(h.actor, { requestId: crypto.randomUUID(), name: 'Fixture repository', aliases: [] });
            h.gateway.repositories.bind(h.actor, { machineId: h.machineId, observation, repositoryId: repository.id });
            const payload = h.payload;
            h.payload = () => { const value = payload(); return { ...value, intent: { ...value.intent, observation } }; };
        }
        return h;
    } catch (error) { return cleanup.failed(error); }
}
