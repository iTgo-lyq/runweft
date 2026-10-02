import { join } from 'node:path';
import { rmSync } from 'node:fs';

/** Close acquired resources in reverse order; one failure never skips the rest. */
export async function closeSmoke(resources: Array<() => void | Promise<void>>) {
    const errors: unknown[] = [];
    for (const close of resources.splice(0).reverse()) try { await close(); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, 'Smoke cleanup failed');
}
export async function removeSmokeSecrets(files: Iterable<string>, processes: Iterable<ReturnType<typeof Bun.spawn>>) {
    if ([...processes].some(child => child.exitCode === null && child.signalCode === null)) throw new Error('Secrets retained: a smoke process is still running');
    await closeSmoke([...files].map(file => () => rmSync(file, { force: true })));
}
export async function stopSmokeProcess(child: ReturnType<typeof Bun.spawn>) {
    if (child.exitCode !== null || child.signalCode !== null) {
        if (child.exitCode !== 0) throw new Error(`Smoke process exited unexpectedly (${child.exitCode})`);
        return;
    }
    child.kill('SIGTERM');
    const exited = await Promise.race([child.exited.then(() => true), Bun.sleep(5000).then(() => false)]);
    if (!exited) { child.kill('SIGKILL'); await child.exited; throw new Error('Smoke process required SIGKILL'); }
    if (child.exitCode !== 0 && child.signalCode !== 'SIGTERM') throw new Error(`Smoke process failed during shutdown (${child.exitCode}, ${child.signalCode})`);
}
/** Only private HAPI startup is shared; gateway policy and business checks stay with the caller. */
export async function startSmokeHapi(binary: string, root: string, env: NodeJS.ProcessEnv, port: number, token: string, processes?: Set<ReturnType<typeof Bun.spawn>>) {
    const home = join(root, 'hapi'), url = `http://127.0.0.1:${port}`;
    const child = Bun.spawn([binary, 'hub'], { env: { ...env, HAPI_HOME: home, DB_PATH: join(home, 'hapi.db'),
        HAPI_LISTEN_HOST: '127.0.0.1', HAPI_LISTEN_PORT: String(port), HAPI_PUBLIC_URL: url, CLI_API_TOKEN: token, TELEGRAM_BOT_TOKEN: '' },
        stdout: Bun.file(join(root, 'hapi-out.log')), stderr: Bun.file(join(root, 'hapi-err.log')) });
    processes?.add(child);
    try {
        const deadline = Date.now() + 30_000;
        while (Date.now() < deadline) {
            if (child.exitCode !== null) throw new Error(`HAPI startup exited (${child.exitCode})`);
            try { if ((await fetch(url + '/health', { signal: AbortSignal.timeout(500) })).ok) return child; } catch {}
            await Bun.sleep(100);
        }
        throw new Error('HAPI startup timed out');
    } catch (error) {
        try { await stopSmokeProcess(child); } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'HAPI startup and cleanup failed'); }
        finally { if (child.exitCode !== null || child.signalCode !== null) rmSync(join(home, 'settings.json'), { force: true }); }
        throw error;
    }
}
