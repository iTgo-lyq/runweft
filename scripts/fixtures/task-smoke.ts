import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { nativeUserSmoke } from './native-user-smoke';
import { modelHomes } from './model-homes';
import { removeFileSmokeData } from './native-file-smoke';

/** Only compiled Task setup and ownership; task waits/permissions/assertions stay in each smoke. */
export async function taskSmoke(root: string, binary: string, env: NodeJS.ProcessEnv, flavors: Array<'codex' | 'claude'> = ['codex', 'claude']) {
    const models = modelHomes(root, env, flavors.includes('claude'));
    let center: Awaited<ReturnType<typeof nativeUserSmoke>> | undefined;
    try {
        const config = join(env.CODEX_HOME!, 'config.toml');
        if (existsSync(config)) for (const name of Object.keys((Bun.TOML.parse(readFileSync(config, 'utf8')) as any).mcp_servers ?? {}))
            assert.equal(spawnSync('codex', ['mcp', 'remove', name], { env, stdio: 'pipe' }).status, 0);
        const prefsPath = join(env.CLAUDE_CONFIG_DIR!, '.claude.json'), prefs = existsSync(prefsPath) ? JSON.parse(readFileSync(prefsPath, 'utf8')) : {};
        prefs.mcpServers = {}; writeFileSync(prefsPath, JSON.stringify(prefs), { mode: 0o600 });
        center = await nativeUserSmoke(root, binary, env);
        const home = join(root, 'client'), runner = await center.runner(home, flavors), ownedPids = new Set<number>();
        async function bind(project: string) {
            const repository = center!.cli(home, ['repository', 'create', 'Task smoke repository', '--request-id', randomUUID()], { cwd: project }).repository;
            center!.cli(home, ['repository', 'bind', repository.id, '--machine', runner.machineId], { cwd: project }); return repository.id;
        }
        function agent(flavor: 'codex' | 'claude', definition: Record<string, unknown> = {}) {
            const path = join(root, `agent-${randomUUID()}.json`);
            writeFileSync(path, JSON.stringify({ name: `Task smoke ${flavor}`, runtimeId: runner.runtimes[flavor].id, ...definition }));
            return center!.cli(home, ['agent', 'create', '--request-id', randomUUID(), '--file', path]).agent;
        }
        return { ...center, candidate: { ...center.candidate, kind: 'real compiled Task coordinator + public Task API + real native models' }, home, runner, models, ownedPids, bind, agent,
            async close(success: boolean, handoff = false) {
                const errors: unknown[] = []; let safe = true;
                try {
                    for (const session of (await runner.http.request('/api/sessions')).sessions) {
                        if (session.metadata?.hostPid) ownedPids.add(session.metadata.hostPid);
                        if (session.active) try { await runner.http.request(`/api/sessions/${session.id}/archive`, { method: 'POST', signal: AbortSignal.timeout(45_000) }); }
                        catch (error) { safe = false; errors.push(error); }
                    }
                } catch (error) { safe = false; errors.push(error); }
                try { await center!.close(false, handoff); } catch (error) { safe = false; errors.push(error); }
                try { await models.waitHosts(ownedPids); } catch (error) { safe = false; errors.push(error); }
                try { models.verify(); } catch (error) { errors.push(error); }
                if (safe) try { await models.remove(); } catch (error) { errors.push(error); }
                if (success && !handoff && !errors.length) try { await removeFileSmokeData(root); } catch (error) { errors.push(error); }
                if (errors.length) throw new AggregateError(errors, 'Task smoke cleanup failed');
            } };
    } catch (error) {
        const errors = [error]; let safe = !!center;
        if (center) try { await center.close(false); } catch (cleanup) { safe = false; errors.push(cleanup); }
        if (safe) try { await models.remove(); } catch (cleanup) { errors.push(cleanup); }
        if (errors.length > 1) throw new AggregateError(errors, 'Task smoke setup failed'); throw error;
    }
}
