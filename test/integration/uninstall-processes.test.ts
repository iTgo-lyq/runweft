import { expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fixture } from '../helpers';

test('macOS exit between process state and start-time probes is stopped, while an unverified live process is refused', async () => {
    const root = fixture('uninstall-exit-race'), tools = join(root, 'tools');
    mkdirSync(tools);
    // Replay a valid command/state snapshot followed by an empty lstart response.
    // Use a subprocess so the macOS probe branch and PATH cannot affect other tests.
    writeFileSync(join(tools, 'ps'), `#!/bin/sh
case "$*" in
  *command=*) printf 'fixture process\\n' ;;
  *state=*) printf 'S\\n' ;;
  *lstart=*) exit 1 ;;
  *) exit 2 ;;
esac
`, { mode: 0o700 });
    const program = `
        import { stopManagedProcesses } from ${JSON.stringify(resolve('src/uninstall/processes.ts'))};
        const child = Bun.spawn([process.execPath, '-e', ''], { stdout: 'ignore', stderr: 'ignore' });
        await child.exited;
        Object.defineProperty(process, 'platform', { value: 'darwin' });
        await stopManagedProcesses([{ kind: 'mcp', pid: child.pid, marker: 'fixture' }]);
        try {
            await stopManagedProcesses([{ kind: 'mcp', pid: process.pid, marker: 'fixture' }]);
            throw new Error('Unverified live process was accepted');
        } catch (error) {
            if (error.code !== 'uninstall_process_unknown') throw error;
        }
    `;
    const child = Bun.spawn([process.execPath, '-e', program], {
        env: { ...process.env, PATH: tools }, stdout: 'pipe', stderr: 'pipe',
    });
    const [exit, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect({ exit, stderr }).toEqual({ exit: 0, stderr: '' });
});
