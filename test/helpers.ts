import type { Cleanup } from './fixture-cleanup';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';

export function fixture(name: string, cleanups?: Cleanup[]): string {
    const root = resolve('.dev-smoke/tests');
    mkdirSync(root, { recursive: true });
    const directory = mkdtempSync(join(root, `${name}-`));
    cleanups?.push(() => rmSync(directory, { recursive: true, force: true }));
    return directory;
}

export async function until<T>(read: () => Promise<T> | T, check: (value: T) => boolean, timeoutMs = 5000): Promise<T> {
    const until = Date.now() + timeoutMs;
    do { const value = await read(); if (check(value)) return value; await Bun.sleep(20); } while (Date.now() < until);
    throw new Error('Test condition timed out');
}
