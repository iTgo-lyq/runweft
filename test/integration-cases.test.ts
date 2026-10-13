import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { integrationCases, integrationShards, runIntegrationCases } from '../scripts/fixtures/integration-cases';

const inputs = { binary: '/candidate/runweft', hapi: '/candidate/hapi', packages: '/candidate/packages', history: [] };

test('public workflow shards cover every required acceptance exactly once on the bound candidate', () => {
    const workflow = parse(readFileSync('.github/workflows/npm-publish.yml', 'utf8'));
    const rows = workflow.jobs.integration.strategy.matrix.include;
    const expected = {
        access: ['hub-access', 'hub-realtime', 'hub-resources', 'hub-configuration'],
        storage: ['artifacts', 'inputs', 'outputs', 'artifact-prune', 'repository-export', 'repository-import', 'result-fetch', 'result-tasks', 'workspace-preparation', 'delegation-native', 'delegation-preparation'],
        web: ['hub', 'hub-connect', 'hub-console'],
    };
    expect(rows).toHaveLength(6);
    for (const [group, ids] of Object.entries(expected)) {
        const full = integrationCases(group, inputs);
        expect(full.map(item => item.id)).toEqual(ids);
        const selected = rows.filter((row: any) => row.group === group).flatMap((row: any) => integrationCases(group, inputs, row.shard));
        expect(selected.map((item: any) => item.id).sort()).toEqual([...ids].sort());
        expect(selected.every((item: any) => item.command.includes(inputs.binary) || item.command.includes(inputs.hapi))).toBe(true);
    }
    const storage = integrationCases('storage', inputs);
    expect(storage.find(item => item.id === 'result-fetch')!.command.at(-1)).toBe('--fetch');
    expect(storage.find(item => item.id === 'result-tasks')!.command.at(-1)).toBe('--tasks');
    const selectedStep = workflow.jobs.integration.steps.find((step: any) => step.env?.INTEGRATION_GROUP);
    expect(selectedStep.env.RUNWEFT_SMOKE_SHARD).toBe('${{ matrix.shard }}');
    expect(selectedStep.env.CANDIDATE_BINARY).toBe('${{ steps.programs.outputs.binary }}');
});

test('invalid or empty shard selection cannot report success, and both package paths retain full suites', () => {
    for (const group of Object.keys(integrationShards)) {
        for (const shard of ['', '0/3', '4/3', '1/9', '1', 'all', '01/2']) expect(() => integrationCases(group, inputs, shard)).toThrow();
    }
    expect(() => integrationCases('unknown', inputs)).toThrow();
    expect(integrationCases('service-package', inputs).map(item => item.command)).toEqual([
        ['verify-packages.mjs', inputs.packages], ['smoke-install.mjs', inputs.packages],
    ]);
});

test('parallel package failure waits for sibling cleanup, records both failures and never passes', async () => {
    const cases = integrationCases('service-package', inputs), events: string[] = [];
    let release!: () => void;
    const finishing = new Promise<void>(resolve => { release = resolve; });
    const work = runIntegrationCases(cases, true, async item => {
        events.push(item.id);
        if (item.id === 'npm-launcher') { await finishing; events.push('cleanup'); }
        throw new Error(item.id);
    });
    let result: any; const settled = work.catch(error => { result = error; });
    await Bun.sleep(10);
    expect(events).toEqual(['standalone-package', 'npm-launcher']); expect(result).toBeUndefined();
    release(); await settled;
    expect(events.at(-1)).toBe('cleanup'); expect(result).toBeInstanceOf(AggregateError); expect(result.errors).toHaveLength(2);
});

test('serial fallback stops on failure and parallel mode refuses unbounded groups', async () => {
    const visited: string[] = [];
    await expect(runIntegrationCases(integrationCases('service-package', inputs), false, async item => {
        visited.push(item.id); throw new Error('failed');
    })).rejects.toThrow('failed');
    expect(visited).toEqual(['standalone-package']);
    await expect(runIntegrationCases(integrationCases('storage', inputs), true, async () => {})).rejects.toThrow('two independent');
});
