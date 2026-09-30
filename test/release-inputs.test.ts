import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from './helpers';
import { assertFrozenCandidate } from '../scripts/fixtures/release-inputs.mjs';

test('release freeze rejects dirty, tracked and untracked package changes but allows acceptance records', () => {
    const root = fixture('release-inputs');
    function git(...args: string[]) {
        const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
        expect(result.status).toBe(0);
        return result.stdout.trim();
    }
    git('init', '-q'); git('config', 'user.name', 'smoke'); git('config', 'user.email', 'smoke@example.invalid');
    git('config', 'commit.gpgsign', 'false');
    mkdirSync(join(root, 'src')); writeFileSync(join(root, 'src/entry.ts'), 'export {};\n');
    git('add', '.'); git('commit', '-qm', 'candidate');
    const source = { revision: git('rev-parse', 'HEAD'), dirty: false };
    expect(() => assertFrozenCandidate({ source }, root)).not.toThrow();
    expect(() => assertFrozenCandidate({ source: { ...source, dirty: true } }, root)).toThrow('clean source');
    writeFileSync(join(root, 'acceptance.md'), 'validation');
    expect(() => assertFrozenCandidate({ source }, root)).not.toThrow();
    writeFileSync(join(root, 'src/entry.ts'), 'export const changed = true;\n');
    expect(() => assertFrozenCandidate({ source }, root)).toThrow('inputs changed');
    git('checkout', '--', 'src/entry.ts');
    writeFileSync(join(root, 'src/new.ts'), 'export {};\n');
    expect(() => assertFrozenCandidate({ source }, root)).toThrow('Untracked package');
});
