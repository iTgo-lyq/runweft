import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { smokeConsole } from './fixtures/hub-console-smoke';

const sources = process.argv.slice(4);
assert(sources.length, 'Supply completed current native MCP evidence files');
await smokeConsole({ binary: resolve(process.argv[2] ?? 'dist/runweft'), hapiBinary: resolve(process.argv[3] ?? 'dist/hapi'), sourceFixtures: sources });
