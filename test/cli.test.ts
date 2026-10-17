import { fixtureCleanup } from './fixture-cleanup';
import { afterEach, expect, test } from 'bun:test';
import { compiledCli } from './compiled-cli';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from './helpers';

const cleanupOwner = fixtureCleanup([]);
afterEach(() => cleanupOwner.close());

function cli(binary: string, home: string, ...args: string[]) {
    return spawnSync(binary, ['--home', home, '--json', ...args], {
        encoding: 'utf8', env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('RUNWEFT_'))),
    });
}

test('CLI produces machine-readable success and actionable failure without secret values', async () => {
    const binary = await compiledCli();
    const home = fixture('cli', cleanupOwner.resources);
    const init = cli(binary, home, 'init');
    expect(init.status).toBe(0);
    expect(JSON.parse(init.stdout).created).toBe(true);
    const show = cli(binary, home, 'config', 'show');
    expect(JSON.parse(show.stdout).config.mode).toBe('local');
    const invalid = cli(binary, home, 'config', 'set', 'hub.url', 'https://user:secret@hub.example');
    expect(invalid.status).toBe(1);
    expect(JSON.parse(invalid.stderr).error.code).toBe('invalid_config');
    expect(invalid.stderr).not.toContain('secret');
    expect(cli(binary, home, 'task', 'spawn').status).not.toBe(0);
    writeFileSync(join(home, 'config.yaml'), 'server: [invalid');
    expect(JSON.parse(cli(binary, home, 'config', 'path').stdout).path).toBe(join(home, 'config.yaml'));
});
