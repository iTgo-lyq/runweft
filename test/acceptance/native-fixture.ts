import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { modelHomes } from './model-homes';
import { nativeUserSmoke } from './native-user-smoke';

export type Flavor = 'codex' | 'claude';
export function alive(pid: number) {
    try { if (process.platform === 'linux' && /\) Z /.test(readFileSync(`/proc/${pid}/stat`, 'utf8'))) return false; process.kill(pid, 0); return true; } catch { return false; }
}
export async function until<T>(read: () => T | Promise<T>, check: (value: T) => boolean, label: string, duration = 240_000): Promise<T> {
    const end = Date.now() + duration;
    do { const value = await read(); if (check(value)) return value; await Bun.sleep(300); } while (Date.now() < end);
    throw new Error(`Timed out: ${label}`);
}
export async function nativeFixture(root: string, binary: string, env: NodeJS.ProcessEnv, flavors: Flavor[], local = false) {
    const models = modelHomes(root, env, flavors.includes('claude'));
    const pids = new Set<number>(), runners: string[] = [];
    let center: Awaited<ReturnType<typeof nativeUserSmoke>> | undefined;
    try {
        env.GIT_CEILING_DIRECTORIES = root;
        const config = join(env.CODEX_HOME!, 'config.toml');
        if (existsSync(config)) for (const name of Object.keys((Bun.TOML.parse(readFileSync(config, 'utf8')) as any).mcp_servers ?? {}))
            assert.equal(spawnSync('codex', ['mcp', 'remove', name], { env, stdio: 'pipe' }).status, 0);
        const prefs = join(env.CLAUDE_CONFIG_DIR!, '.claude.json'), value = existsSync(prefs) ? JSON.parse(readFileSync(prefs, 'utf8')) : {};
        value.mcpServers = {}; writeFileSync(prefs, JSON.stringify(value), { mode: 0o600 });
        if (flavors.includes('claude')) {
            const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
            const wrapper = join(root, 'claude-observer');
            writeFileSync(wrapper, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(resolve('test/acceptance/claude-observer.mjs'))} "$@"\n`, { mode: 0o700 });
            Object.assign(env, { HAPI_CLAUDE_PATH: wrapper, RUNWEFT_SMOKE_CLAUDE: models.nativeClaude, RUNWEFT_SMOKE_CLAUDE_LOG: join(root, 'claude-init.jsonl') });
        }
        center = await nativeUserSmoke(root, binary, env);
        const home = local ? center.server : join(root, 'client');
        const runner = await center.runner(home, flavors); runners.push(home);
        const project = join(root, 'project'); mkdirSync(project);
        const cli = (args: string[], cwd = project) => center!.cli(home, args, { cwd, timeout: 65_000 });
        const selections = { codex: models.codexModel, claude: models.claudeModel };
        for (const flavor of flavors) assert(selections[flavor].model && selections[flavor].reasoningEffort, `Set RUNWEFT_NATIVE_${flavor.toUpperCase()}_MODEL and _EFFORT, or configure both in the native settings`);
        async function complete(id: string) {
            const result = await until(() => cli(['task', 'show', id]), value => {
                if (['unknown', 'needs_attention', 'failed'].includes(value.status)) throw new Error(`Task ${value.status}`);
                return ['completed', 'interrupted'].includes(value.status);
            }, 'native round');
            assert.equal(result.stop, 'stopped'); assert.equal(result.finish, 'complete');
            assert.equal(typeof result.host_pid, 'number'); pids.add(result.host_pid);
            await until(() => alive(result.host_pid), value => !value, 'native process exit', 10_000);
            const native = (await runner.http.request(`/api/sessions/${result.session_id}`)).session;
            assert.equal(native.active, false); assert.equal(native.metadata.lifecycleState, 'archived');
            return result;
        }
        return { ...center, root, env, home, project, models, selections, runner, pids, cli, complete,
            async addRunner(target: string, flavor: Flavor) { const added = await center!.runner(target, [flavor]); runners.push(target); return added; },
            stopRunners() { for (const home of runners) { center!.cli(home, ['runner', 'stop']); assert.equal(center!.cli(home, ['status']).runner.running, false); } },
            agent(flavor: Flavor, definition = {}, runtimeId = runner.runtimes[flavor].id) {
                const path = join(root, `agent-${crypto.randomUUID()}.json`);
                writeFileSync(path, JSON.stringify({ name: `Native ${flavor}`, runtimeId, ...selections[flavor], ...definition }));
                return cli(['agent', 'create', '--request-id', crypto.randomUUID(), '--file', path]).agent;
            },
            async close() {
                const errors: unknown[] = []; let safe = true;
                try {
                    for (const session of (await runner.http.request('/api/sessions')).sessions) {
                        if (session.metadata?.hostPid) pids.add(session.metadata.hostPid);
                        if (session.active) await runner.http.request(`/api/sessions/${session.id}/archive`, { method: 'POST', signal: AbortSignal.timeout(45_000) });
                    }
                } catch (error) { safe = false; errors.push(error); }
                try { await center!.close(false); } catch (error) { safe = false; errors.push(error); }
                try { await models.waitHosts(pids); } catch (error) { safe = false; errors.push(error); }
                if (safe) try { await models.remove(); for (const home of runners) rmSync(join(home, 'backups/mcp'), { recursive: true, force: true }); } catch (error) { errors.push(error); }
                if (errors.length) throw new AggregateError(errors, 'Native fixture cleanup failed; inspect retained private root');
            } };
    } catch (error) {
        const errors = [error]; let safe = !(error instanceof AggregateError);
        if (center) try { await center.close(false); } catch (error) { safe = false; errors.push(error); }
        if (safe) try { await models.remove(); for (const home of runners) rmSync(join(home, 'backups/mcp'), { recursive: true, force: true }); } catch (error) { errors.push(error); }
        if (errors.length > 1) throw new AggregateError(errors, 'Native fixture setup failed'); throw error;
    }
}
export type NativeFixture = Awaited<ReturnType<typeof nativeFixture>>;
