import { resolve } from 'node:path';
import { smokeConsole } from './fixtures/hub-console-smoke';

await smokeConsole({ binary: resolve(process.argv[2] ?? 'dist/runweft') });
