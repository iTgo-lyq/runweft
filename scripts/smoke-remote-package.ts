import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { HapiClient } from '../src/hapi';
import { loadConfig, targetUrl } from '../src/config';
import { TaskClient } from '../src/tasks/client';
import { TaskStore } from '../src/tasks/store';
import type { TaskOverview } from '../src/tasks/query';

// The installed product handles persistence and Git; Bun runs only this no-model acceptance harness.
const binary = resolve(process.argv[2]!), hapiBinary = resolve(process.argv[3]!), fixtures = process.argv.slice(4).map(value => resolve(value));
assert(fixtures.length);
mkdirSync('.dev-smoke', { recursive: true }); const root = mkdtempSync(resolve('.dev-smoke/remote-package-'));
const evidence: any = { root, binary, hapiBinary, fixtures, success: false, cases: [], cleanupErrors: [] };
for (const file of fixtures) {
    assert(file.startsWith(resolve('.dev-smoke') + sep), 'Only private acceptance fixtures can be restarted');
    const previous = JSON.parse(readFileSync(file, 'utf8')); assert(previous.success && previous.remote);
    const center = join(previous.root, 'local'), source = join(previous.root, 'hub'), env: NodeJS.ProcessEnv = { ...process.env,
        CODEX_HOME: join(previous.root, 'codex'), CLAUDE_CONFIG_DIR: join(previous.root, 'claude'), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
    for (const name of Object.keys(env)) if (name.startsWith('RUNWEFT_')) delete env[name]; delete env.HAPI_SESSION_ID;
    const token = JSON.parse(readFileSync(join(center, 'server/hapi/settings.json'), 'utf8')).cliApiToken;
    const cli = (home: string, args: string[], cwd = previous.root) => {
        const value = spawnSync(binary, ['--home', home, '--json', ...args], { cwd, env, encoding: 'utf8', timeout: 60_000 });
        assert(!`${value.stdout}${value.stderr}`.includes(token)); assert.equal(value.status, 0, value.stderr || String(value.error)); return JSON.parse(value.stdout);
    };
    const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
    const started: string[] = [];
    try {
        const store = new TaskStore(join(center, 'server/runweft/state.sqlite'));
        try { for (const item of previous.cases) assert(store.require('default', item.first.agent_id).rounds.every(round => round.phase === 'finished' && round.stop === 'stopped')); }
        finally { store.close(); }
        for (const home of [center, source]) { cli(home, ['config', 'set', 'hapi.executable', hapiBinary]); cli(home, ['start']); started.push(home); }
        const hapi = new HapiClient(targetUrl(loadConfig(source, env).config), token);
        const sessions = (await hapi.request('/api/sessions')).sessions.map((session: any) => session.id).sort();
        const target = join(previous.root, 'target-runner');
        assert.equal(cli(target, ['status']).runner, false, 'Executor Runner must remain stopped');
        const sourcePaths = cli(source, ['paths']);
        const sourceId = JSON.parse(readFileSync(join(sourcePaths.hapiClient, 'settings.json'), 'utf8')).machineId;
        cli(center, ['stop']); cli(center, ['start']);
        // Hub restores persisted heartbeats before its normal offline timeout elapses.
        const readyUntil = Date.now() + 90_000;
        let sourceOnly = false;
        while (Date.now() < readyUntil) {
            const machines = (await hapi.request('/api/machines')).machines.filter((machine: any) => machine.active);
            if (machines.length === 1 && machines[0].id === sourceId) { sourceOnly = true; break; }
            await Bun.sleep(250);
        }
        assert(sourceOnly, 'Only source Runner should be online');
        for (const item of previous.cases) {
            const client = new TaskClient(loadConfig(source, env), item.cwd), id = item.first.agent_id;
            const overview = await hapi.request(`/api/runweft/tasks/overview?workspace=${encodeURIComponent(item.cwd)}`) as TaskOverview & { namespace: string };
            const row = overview.items.find(row => row.id === id);
            assert(row, 'Installed dashboard must include the retained native task');
            assert.equal(overview.namespace, 'default'); assert.equal(overview.inventory.available, true);
            assert.equal(row.round, 2); assert.equal(row.status, 'completed'); assert.equal(row.stop, 'stopped');
            assert.equal(row.parent.cwd, item.cwd); assert.equal(row.runtime.flavor, item.flavor);
            assert.equal(row.workspace_mode, 'worktree'); assert.equal(row.cwd, item.first.cwd);
            assert.equal(row.machine.online, false); assert.equal(row.possibly_stale, false);
            assert.equal(row.code.status, 'available'); assert.equal(row.code.result_head, item.second.git.result_head);
            assert.equal(row.files.status, 'delivered'); assert(row.session_id); assert(row.summary.length <= 1000);
            const protectedState = [digest(join(item.cwd, '.git/index')), digest(join(item.cwd, '.git/config'))];
            for (const [index, round] of [item.first, item.second].entries()) {
                const shown = cli(source, ['task', 'show', id, '--round', round.round_id], item.cwd);
                assert.equal(shown.code.status, 'available'); assert.equal(shown.git.result_head, round.git.result_head);
                const output = shown.artifacts.manifest.items.find((value: any) => value.status === 'available'); assert(output);
                const destination = join(root, `${item.id}-${index + 1}-${randomUUID()}.txt`);
                cli(source, ['artifact', 'download', output.artifactId, '--output', destination], item.cwd); assert.equal(digest(destination), output.sha256);
            }
            const accepted = cli(source, ['task', 'result', 'fetch', id, '--request-id', randomUUID()], item.cwd);
            const end = Date.now() + 120_000;
            let fetched = false;
            while (Date.now() < end) {
                const result = await client.result(id, accepted.round_id), operation = result.fetches.at(-1)!;
                if (operation.status === 'failed') throw new Error(JSON.stringify(operation.error));
                if (operation.status === 'available' && operation.released) { fetched = true; break; }
                await Bun.sleep(150);
            }
            assert(fetched); assert.deepEqual([digest(join(item.cwd, '.git/index')), digest(join(item.cwd, '.git/config'))], protectedState);
            assert(existsSync(item.first.cwd), 'Installing the package must retain executor worktrees');
            evidence.cases.push({ fixture: file, taskId: id, resultHead: item.second.git.result_head, rounds: 2, executorOffline: true,
                dashboard: { namespace: overview.namespace, status: row.status, phase: row.phase, stop: row.stop, sessionId: row.session_id,
                    parent: row.parent, machineOnline: row.machine.online, code: row.code.status, files: row.files.status, summaryLength: row.summary.length } });
        }
        assert.deepEqual((await hapi.request('/api/sessions')).sessions.map((session: any) => session.id).sort(), sessions);
    } catch (error) { evidence.error = error instanceof Error ? error.stack : String(error); process.exitCode = 1; }
    finally { for (const home of started.reverse()) try { cli(home, ['stop']); } catch (error) { evidence.cleanupErrors.push(String(error)); } }
    if (evidence.error || evidence.cleanupErrors.length) break;
}
evidence.success = !evidence.error && !evidence.cleanupErrors.length;
if (!evidence.success) process.exitCode = 1;
writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2)); console.log(`Installed remote-task evidence: ${join(root, 'evidence.json')}`);
if (evidence.error) console.error(evidence.error);
