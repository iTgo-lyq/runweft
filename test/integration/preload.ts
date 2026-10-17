import { afterAll } from 'bun:test';
import { closeCompiledCli } from './compiled-cli';

// The preload hook runs once after the suite; file-level hooks would remove shared output early.
afterAll(closeCompiledCli);
