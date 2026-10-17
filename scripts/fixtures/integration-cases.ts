import assert from 'node:assert/strict';

export const integrationShards = { access: 2, storage: 3, web: 1, 'service-package': 1 } as const;
export type IntegrationGroup = keyof typeof integrationShards;
export type IntegrationCase = { id: string; shard: number; command: string[] };
type Inputs = { binary: string; hapi: string; packages: string; history: string[] };

// Each case keeps its own fixture lifecycle. Weights come from the same-candidate timing in the Change.
export function integrationCases(group: string, inputs: Inputs, shard?: string): IntegrationCase[] {
    assert(Object.hasOwn(integrationShards, group), `Unknown integration group: ${group}`);
    const { binary, hapi, packages, history } = inputs;
    const c = (id: string, shard: number, ...command: string[]): IntegrationCase => ({ id, shard, command });
    const groups: Record<IntegrationGroup, IntegrationCase[]> = {
        access: [
            c('hub-access', 1, 'smoke-hub-access.ts', hapi),
            c('hub-realtime', 2, 'smoke-hub-realtime.ts', hapi),
            c('hub-resources', 1, 'smoke-hub-resources.ts', hapi, binary),
            c('hub-configuration', 2, '../test/integration/hub-configuration.test.ts', binary),
        ],
        storage: [
            c('artifacts', 3, 'smoke-artifacts.ts', binary, hapi),
            c('inputs', 3, 'smoke-inputs.ts', binary, hapi),
            c('outputs', 3, 'smoke-outputs.ts', binary, hapi),
            c('artifact-prune', 3, 'smoke-artifact-prune.ts', binary, hapi),
            c('repository-export', 2, 'smoke-repository-export.ts', binary, hapi),
            c('repository-import', 3, 'smoke-repository-import.ts', binary, hapi),
            c('result-fetch', 2, 'smoke-result-export.ts', binary, hapi, '--fetch'),
            c('result-tasks', 2, 'smoke-result-export.ts', binary, hapi, '--tasks'),
            c('workspace-preparation', 1, 'smoke-workspace-preparation.ts', binary, hapi),
            c('delegation-native', 3, 'smoke-hub-delegation-native.ts', hapi),
            c('delegation-preparation', 1, 'smoke-hub-delegation-preparation.ts', hapi),
        ],
        web: [
            c('hub', 1, 'smoke-hub.ts', binary, hapi),
            c('hub-connect', 1, 'smoke-hub-connect.ts', binary),
            c('hub-console', 1, 'smoke-hub-console.ts', binary, ...history),
        ],
        'service-package': [
            c('standalone-package', 1, 'verify-packages.mjs', packages),
            c('npm-launcher', 1, 'smoke-install.mjs', packages),
        ],
    };
    const cases = groups[group as IntegrationGroup];
    if (shard === undefined) return cases;
    const count = integrationShards[group as IntegrationGroup];
    assert(new RegExp(`^[1-${count}]/${count}$`).test(shard), `Invalid ${group} shard: ${shard}`);
    const selected = cases.filter(item => item.shard === Number(shard.split('/')[0]));
    assert(selected.length, 'An empty shard cannot pass validation');
    return selected;
}

export async function runIntegrationCases(cases: IntegrationCase[], parallel: boolean, run: (item: IntegrationCase) => Promise<void>) {
    if (!parallel) { for (const item of cases) await run(item); return; }
    assert(cases.length <= 2, 'Only the two independent package checks run concurrently in one runner');
    // Do not return early on failure: siblings must finish their own cleanup and report their results.
    const results = await Promise.allSettled(cases.map(async item => run(item)));
    const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
    if (failures.length) throw new AggregateError(failures, 'Integration failed; inspect case evidence before targeted reruns');
}
