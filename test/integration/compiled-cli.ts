import { chmodSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fixture } from '../helpers';

let build: Promise<string> | undefined, root: string | undefined;
/** One immutable CLI per test process; failed builds remain failed for all consumers. */
export function compiledCli(): Promise<string> {
    if (process.env.RUNWEFT_TEST_BIN) return Promise.resolve(resolve(process.env.RUNWEFT_TEST_BIN));
    return build ??= (async () => {
        root = fixture('compiled-cli');
        const executable = join(root, 'runweft');
        const child = Bun.spawn([process.execPath, 'build', resolve('src/cli.ts'), '--compile', '--outfile', executable], { stdout: 'pipe', stderr: 'pipe' });
        const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        if (exit !== 0) throw new Error(`CLI build failed (${exit}): ${stderr || stdout}`);
        chmodSync(executable, 0o500);
        return executable;
    })();
}
export function closeCompiledCli() { if (root) rmSync(root, { recursive: true, force: true }); }
