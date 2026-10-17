import assert from 'node:assert/strict';
import { preflightBinaries } from '../preflight';
let binaries: ReturnType<typeof preflightBinaries> | undefined;
export function integrationBinaries() {
    assert(process.env.RUNWEFT_TEST_BIN, 'Real integration requires --bin; compile CLI and its paired HAPI first');
    return binaries ??= preflightBinaries(process.env.RUNWEFT_TEST_BIN);
}
