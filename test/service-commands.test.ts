import { compiledCli } from './compiled-cli';
import { fixtureCleanup } from './fixture-cleanup';
import { afterEach, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from './helpers';
import { requireRunweft } from '../src/services';
import { browserAddress } from '../src/service-commands';

const cleanupOwner = fixtureCleanup([]), cleanups = cleanupOwner.resources;
afterEach(() => cleanupOwner.close());

test('HAPI passthrough preserves argv, exit status and signals without a shell', async () => {
    const root = fixture('hapi-passthrough', cleanups);
    const executable = join(root, 'hapi');
    const ready = join(root, 'ready');
    writeFileSync(executable, `#!/usr/bin/env node
import fs from 'node:fs';
if (process.argv[2] === 'wait') {
  fs.writeFileSync(${JSON.stringify(ready)}, String(process.pid));
  setInterval(() => {}, 1000);
} else {
  console.log(JSON.stringify({args: process.argv.slice(2), home: process.env.HAPI_HOME}));
  process.exit(23);
}
`);
    chmodSync(executable, 0o755);
    const env = { ...process.env, RUNWEFT_HAPI_EXECUTABLE: executable };
    const binary = await compiledCli(), args = ['--home', root, 'hapi'];
    const input = ['--native-flag', 'a b', '$(must-not-run)', "'literal'"];
    const result = Bun.spawn([binary, ...args, ...input], { env, stdout: 'pipe', stderr: 'pipe' });
    const stdout = await new Response(result.stdout).text();
    const stderr = await new Response(result.stderr).text();
    expect(stderr).toBe('');
    expect(await result.exited).toBe(23);
    const output = JSON.parse(stdout);
    expect(output.args).toEqual(input);
    expect(output.home).toBe(join(root, 'connections/unconnected/hapi'));
    const child = spawn(binary, [...args, 'wait'], { env, stdio: 'ignore' });
    const ended = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
    try {
        const deadline = Date.now() + 5000;
        while (!existsSync(ready) && Date.now() < deadline) await Bun.sleep(20);
        expect(existsSync(ready)).toBe(true);
        child.kill('SIGTERM');
        expect((await ended).signal).toBe('SIGTERM');
        const nativePid = Number(readFileSync(ready, 'utf8'));
        expect(() => process.kill(nativePid, 0)).toThrow();
    } finally { child.kill('SIGKILL'); await ended; }
}, 10_000);

test('a plain HAPI or unrelated Hub produces an actionable deployment diagnosis', async () => {
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => Response.json({ error: 'Unauthorized' }, { status: 401 }) });
    try {
        await expect(requireRunweft(`http://127.0.0.1:${server.port}`)).rejects.toMatchObject({ code: 'runweft_unavailable' });
    } finally { await server.stop(true); }
});

test('open uses public Hub entry and never puts a credential in browser arguments', async () => {
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => Response.json({ service: 'runweft', protocolVersion: 1 }) });
    cleanups.push(() => server.stop(true));
    const address = await browserAddress(server.url.origin);
    expect(address).toEqual({ url: server.url.origin + '/hub', publicUrl: server.url.origin + '/hub' });
    expect((await browserAddress(server.url.origin, true)).url).toBe(server.url.origin + '/');
    const root = fixture('dashboard-open', cleanups), captured = join(root, 'browser-url');
    const command = join(root, process.platform === 'darwin' ? 'open' : 'xdg-open');
    writeFileSync(command, '#!/usr/bin/env node\nimport { writeFileSync } from "node:fs"; writeFileSync(process.env.DASHBOARD_OPEN_CAPTURE, process.argv[2]);\n'); chmodSync(command, 0o755);
    const run = Bun.spawn([await compiledCli(), '--home', root, '--json', 'open'], {
        env: { ...process.env, PATH: `${root}:${process.env.PATH}`, RUNWEFT_MODE: 'hub', RUNWEFT_HUB_URL: server.url.origin, RUNWEFT_HUB_TOKEN: 'legacy-secret', DASHBOARD_OPEN_CAPTURE: captured }, stdout: 'pipe', stderr: 'pipe',
    });
    const stdout = await new Response(run.stdout).text(), stderr = await new Response(run.stderr).text();
    expect(await run.exited).toBe(0); expect(stderr).toBe('');
    expect(JSON.parse(stdout)).toEqual({ opened: true, url: server.url.origin + '/hub' });
    expect(readFileSync(captured, 'utf8')).toBe(server.url.origin + '/hub');
});
