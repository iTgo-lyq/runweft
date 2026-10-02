import { fixtureCleanup } from './fixture-cleanup';
import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { initializeConfig, loadConfig, setConfig, dataPaths } from '../src/config';
import { fixture } from './helpers';

const cleanupOwner = fixtureCleanup([]);
afterEach(() => cleanupOwner.close());

describe('configuration', () => {
    test('defaults do not write data; initialization preserves an existing annotated file', () => {
        const home = fixture('config defaults', cleanupOwner.resources);
        const defaults = loadConfig(home, {});
        expect(defaults.exists).toBe(false);
        expect(defaults.config.mode).toBe('local');
        const initialized = initializeConfig(home, {}, {});
        expect(initialized.created).toBe(true);
        const original = readFileSync(initialized.file, 'utf8') + '\n# keep this note\n';
        writeFileSync(initialized.file, original);
        expect(initializeConfig(home, { mode: 'hub', url: 'https://example.com' }, {}).created).toBe(false);
        expect(readFileSync(initialized.file, 'utf8')).toBe(original);
        expect(setConfig(initialized, 'server.port', '4321').config.server.port).toBe(4321);
        expect(readFileSync(initialized.file, 'utf8')).toContain('# keep this note');
    });

    test('sources match explicit home, config values and environment overrides', () => {
        const home = fixture('sources', cleanupOwner.resources);
        initializeConfig(home, {}, {});
        const c = loadConfig(home, { RUNWEFT_HOME: '/unused', RUNWEFT_PORT: '4210', RUNWEFT_MODE: 'hub', RUNWEFT_HUB_URL: 'https://hub.example/' });
        expect(c.home).toBe(home);
        expect(c.config.hub.url).toBe('https://hub.example');
        expect(c.sources.home).toBe('--home');
        expect(c.sources['server.port']).toBe('env:RUNWEFT_PORT');
        expect(c.sources['server.host']).toBe(join(home, 'config.yaml'));
        const paths = dataPaths(c);
        expect(paths.hapiClient).toContain('connections/hub.example-');
        expect(paths.hapiClient).not.toBe(dataPaths(loadConfig(home, {})).hapiClient);
        writeFileSync(join(home, 'config.yaml'), 'mode: hub\n');
        expect(loadConfig(home, { RUNWEFT_HUB_URL: 'http://localhost:4321' }).config.hub.url).toBe('http://localhost:4321');
    });

    test('invalid edits never replace working configuration', () => {
        const c = initializeConfig(fixture('invalid', cleanupOwner.resources), {}, {});
        const before = readFileSync(c.file, 'utf8');
        expect(() => setConfig(c, 'server.port', '-1')).toThrow('server.port');
        expect(() => setConfig(c, 'mode', 'hub')).toThrow('hub.url');
        expect(() => setConfig(c, 'server.prt', '1234')).toThrow('server');
        expect(readFileSync(c.file, 'utf8')).toBe(before);
    });

    test('rejects broken persisted config even when an override could hide it', () => {
        const home = fixture('malformed', cleanupOwner.resources);
        writeFileSync(join(home, 'config.yaml'), 'server:\n  port: wrong\n');
        expect(() => loadConfig(home, { RUNWEFT_PORT: '4000' })).toThrow('server.port');
        writeFileSync(join(home, 'config.yaml'), 'mode: local\nmode: hub\n');
        expect(() => loadConfig(home, {})).toThrow('YAML');
    });

    test('hub URLs cannot carry credentials, paths or query tokens', () => {
        const home = fixture('url', cleanupOwner.resources);
        for (const url of ['https://user:secret@hub.example', 'https://hub.example/path', 'https://hub.example?token=secret']) {
            expect(() => initializeConfig(home, { url }, {})).toThrow('hub.url');
        }
        expect(initializeConfig(home, { url: 'https://hub.example' }, {}).config.mode).toBe('hub');
    });

});
