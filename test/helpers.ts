import type { Cleanup } from './fixture-cleanup';
import { afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const unscoped: Cleanup[] = [];
afterAll(async () => { for (const close of unscoped.splice(0).reverse()) await close(); });

export function fixture(name: string, cleanups?: Cleanup[]): string {
    const directory = mkdtempSync(join(tmpdir(), `runweft-${name}-`));
    (cleanups ?? unscoped).push(() => rmSync(directory, { recursive: true, force: true }));
    return directory;
}

export async function until<T>(read: () => Promise<T> | T, check: (value: T) => boolean, timeoutMs = 5000): Promise<T> {
    const until = Date.now() + timeoutMs;
    do { const value = await read(); if (check(value)) return value; await Bun.sleep(20); } while (Date.now() < until);
    throw new Error('Test condition timed out');
}
