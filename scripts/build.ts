import { copyFileSync, chmodSync, mkdirSync, renameSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { loadConfig } from '../src/config';
import { hapiExecutable } from '../src/hapi';

const result = await Bun.build({ entrypoints: ['src/cli.ts'], compile: { outfile: 'dist/runweft', autoloadDotenv: false } });
if (!result.success) throw new Error(`Build failed: ${result.logs.join('\n')}`);
mkdirSync('dist', { recursive: true });
const hapi = hapiExecutable(loadConfig(resolve('.dev-smoke/build-home'), {}));
if (resolve(hapi) !== resolve('dist/hapi')) {
    const temporary = `dist/hapi.${randomUUID()}.tmp`;
    copyFileSync(hapi, temporary);
    chmodSync(temporary, 0o755);
    renameSync(temporary, 'dist/hapi');
}
console.log('Built dist/runweft and bundled HAPI');
