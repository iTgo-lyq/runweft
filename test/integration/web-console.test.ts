import { afterEach, test } from 'bun:test';
import { smokeConsole } from './console';
import { integrationBinaries } from './binaries';
let close = async () => {};
afterEach(() => close());
test('browser configuration and task history', async () => {
    await smokeConsole({ binary: integrationBinaries().runweft.path, own: fn => { close = fn; } });
}, 120000);
