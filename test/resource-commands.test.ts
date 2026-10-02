import { fixtureCleanup } from './fixture-cleanup';
import { afterEach, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { fixture } from './helpers';

const cleanupOwner = fixtureCleanup([]);
afterEach(() => cleanupOwner.close());

test('default resource commands require explicit Hub connection and never read local Agent YAML', async () => {
    for (const group of ['machine', 'runtime', 'agent', 'repository']) {
        const home = fixture('central-resource-cli', cleanupOwner.resources);
        const child = Bun.spawn([process.execPath, resolve('src/cli.ts'), '--home', home, '--json', group, 'list'], {
            env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('RUNWEFT_'))), stdout: 'pipe', stderr: 'pipe',
        });
        expect(await child.exited).toBe(1);
        expect(JSON.parse(await new Response(child.stderr).text()).error.code).toBe('hub_connection_required');
        expect(await new Response(child.stdout).text()).toBe('');
    }
});
