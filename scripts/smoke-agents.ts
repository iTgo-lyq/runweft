import { resolve } from 'node:path';
import { installedBinaries } from './fixtures/installed-binaries.mjs';
import { smokeHubConfiguration } from './smoke-hub-configuration';

// Preserve this entry's CLI positional argument and use its exact paired HAPI.
const binary = resolve(process.argv[2] ?? 'dist/runweft');
await smokeHubConfiguration(installedBinaries(binary).hapi.path, binary);
