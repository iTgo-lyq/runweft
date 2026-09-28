import { mkdtempSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

export function fixture(name: string): string {
    const root = resolve('.dev-smoke/tests');
    mkdirSync(root, { recursive: true });
    return mkdtempSync(join(root, `${name}-`));
}
