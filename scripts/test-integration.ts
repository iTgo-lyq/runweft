import { resolve } from 'node:path';

const args = process.argv.slice(2);
const separator = args.indexOf('--');
const options = separator < 0 ? [] : args.splice(0, separator + 1).slice(0, -1);
let binary: string | undefined;
if (options.length) {
    if (options.length !== 2 || options[0] !== '--bin') throw new Error('Usage: test:integration [--bin CLI] -- [files and Bun test flags]');
    binary = resolve(options[1]);
}
if (args.includes('--pass-with-no-tests')) throw new Error('An empty integration selection cannot pass');
// Bun owns discovery, filtering, timing and sharding. No second case registry.
const hasFile = args.some(arg => /(?:\.test\.ts$|^(?:\.\/)?test\/integration(?:\/|$))/.test(arg));
const child = Bun.spawn([process.execPath, 'test', '--preload', './test/integration/preload.ts', '--timeout', '120000',
    ...(!hasFile ? ['./test/integration'] : []), ...args], {
    env: { ...process.env, ...(binary ? { RUNWEFT_TEST_BIN: binary } : {}) }, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit',
});
process.exitCode = await child.exited;
