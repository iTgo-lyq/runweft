import { resolve } from 'node:path';
import { installedBinaries } from './fixtures/installed-binaries.mjs';
import { smokeHubResources } from './smoke-hub-resources';

// Preserve this entry's CLI positional argument and use its exact paired HAPI.
const binary = resolve(process.argv[2] ?? 'dist/runweft');
await smokeHubResources(installedBinaries(binary).hapi.path, binary);
