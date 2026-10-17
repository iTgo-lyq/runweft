import { fixtureCleanup } from '../fixture-cleanup';
import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { initializeConfig, setConfig } from '../../src/config';
import { fixture } from '../helpers';

const cleanupOwner = fixtureCleanup([]);
afterEach(() => cleanupOwner.close());

describe('configuration', () => {
    test('invalid edits never replace working configuration', () => {
        const c = initializeConfig(fixture('invalid', cleanupOwner.resources), {}, {});
        const before = readFileSync(c.file, 'utf8');
        expect(() => setConfig(c, 'server.port', '-1')).toThrow('server.port');
        expect(() => setConfig(c, 'mode', 'hub')).toThrow('hub.url');
        expect(() => setConfig(c, 'server.prt', '1234')).toThrow('server');
        expect(readFileSync(c.file, 'utf8')).toBe(before);
    });

    test('hub URLs cannot carry credentials, paths or query tokens', () => {
        const home = fixture('url', cleanupOwner.resources);
        for (const url of ['https://user:secret@hub.example', 'https://hub.example/path', 'https://hub.example?token=secret']) {
            expect(() => initializeConfig(home, { url }, {})).toThrow('hub.url');
        }
        expect(initializeConfig(home, { url: 'https://hub.example' }, {}).config.mode).toBe('hub');
    });

});
