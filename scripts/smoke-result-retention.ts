import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { HapiClient } from '../src/hapi';
import { ArtifactClient } from '../src/artifacts/client';
import { loadConfig, targetUrl } from '../src/config';
import { TaskStore } from '../src/tasks/store';
import { TaskClient } from '../src/tasks/client';
import { resultReference } from '../src/tasks/result-types';

// Reuse a completed, private two-runtime native fixture; never dispatch or resume a model.
const fixture = resolve(process.argv[2] ?? ''), smokeRoot = resolve('.dev-smoke');
assert(fixture.startsWith(smokeRoot + sep), 'Provide an existing private .dev-smoke/remote-tasks-native-* fixture');
const original = JSON.parse(readFileSync(join(fixture, 'evidence.json'), 'utf8'));
assert(original.success && original.cases.length === 2 && original.cases.every((item: any) => item.id && item.rounds.length === 2));
const binary = resolve(process.argv[3] ?? 'dist/runweft'), hapiBinary = resolve(process.argv[4] ?? 'dist/hapi');
mkdirSync(smokeRoot, { recursive: true }); const root = mkdtempSync(join(smokeRoot, 'result-retention-'));
const { center, sourceHome, targetHome } = original as { center: string; sourceHome: string; targetHome: string };
const project = join(fixture, 'source/project'), cwd = join(project, 'app');
const env: NodeJS.ProcessEnv = { ...process.env, CODEX_HOME: join(fixture, 'codex'), CLAUDE_CONFIG_DIR: join(fixture, 'claude'), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_')) delete env[key];
delete env.HAPI_SESSION_ID;
const evidence: any = { root, fixture, binary, hapiBinary, startedAt: new Date().toISOString(), success: false, checks: [], cleanupErrors: [] };
const homes: string[] = []; let hub: ChildProcess | undefined;
const token = JSON.parse(readFileSync(join(center, 'server/hapi/settings.json'), 'utf8')).cliApiToken;
const cli = (home: string, args: string[], directory = cwd) => {
    const result = spawnSync(binary, ['--home', home, '--json', ...args], { env, cwd: directory, encoding: 'utf8', timeout: 60_000 });
    assert(!`${result.stdout}${result.stderr}`.includes(token), 'Credential leaked');
    assert.equal(result.status, 0, result.stderr || String(result.error)); return JSON.parse(result.stdout);
};
const git = (...args: string[]) => { const result = spawnSync('git', ['-C', project, ...args], { env, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); };
const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const until = async <T>(read: () => Promise<T>, done: (value: T) => boolean, label: string) => {
    const end = Date.now() + 120_000;
    while (Date.now() < end) { const value = await read(); if (done(value)) return value; await Bun.sleep(150); }
    throw new Error(`Observation deadline: ${label}`);
};
const note = (value: string) => { evidence.checks.push(value); console.log(value); };
try {
    const store = new TaskStore(join(center, 'server/runweft/state.sqlite'));
    try { for (const item of original.cases) assert(store.require('default', item.id).rounds.every(round => round.phase === 'finished' && round.stop === 'stopped')); }
    finally { store.close(); }
    for (const home of [center, sourceHome, targetHome]) cli(home, ['config', 'set', 'hapi.executable', hapiBinary]);
    const url = targetUrl(loadConfig(sourceHome, env).config), hapi = new HapiClient(url, token), artifacts = new ArtifactClient(hapi);
    const fd = openSync(join(root, 'hub.log'), 'a', 0o600);
    try { hub = spawn(binary, ['--home', center, 'serve', '--public'], { env, cwd: root, stdio: ['ignore', fd, fd] }); } finally { closeSync(fd); }
    homes.push(center);
    await until(async () => { if (hub!.exitCode !== null) throw new Error('Hub exited'); return fetch(`${url}/api/runweft/health`).then(response => response.ok).catch(() => false); }, Boolean, 'Hub');
    for (const home of [sourceHome, targetHome]) { cli(home, ['start']); homes.push(home); }
    const sessions = (await hapi.request('/api/sessions')).sessions.map((session: any) => session.id).sort();
    const client = new TaskClient(loadConfig(sourceHome, env), cwd), tasks = await Promise.all(original.cases.map((item: any) => client.read(item.id)));
    const [a, b] = tasks, aFirst = original.cases[0].rounds[0].roundId;
    assert(a.environment.mode === 'worktree' && b.environment.mode === 'worktree');
    const common = a.environment.source.commonDir; assert.equal(common, b.environment.source.commonDir); assert(existsSync(common));
    const originalRefs = git('for-each-ref', '--format=%(refname) %(objectname)', 'refs/hapi/results');
    const preview = cli(sourceHome, ['task', 'result', 'release', a.agent_id, '--round', aFirst]);
    assert(!preview.applied && preview.can_release); assert(preview.rounds[0].references.some((item: any) => !item.done));
    assert.equal((await client.result(a.agent_id, aFirst)).code.status, 'available');
    cli(sourceHome, ['task', 'result', 'release', a.agent_id, '--round', aFirst, '--apply']);
    const released = await until(() => client.result(a.agent_id, aFirst), value => value.code.status === 'released', 'first result release');
    assert.equal(released.manifests.length, 1);
    const latest = await client.result(a.agent_id);
    for (const file of latest.manifests[0]!.baseline.files) assert((await artifacts.refs(file.artifactId)).references.some(ref => ref.reference === resultReference(a.agent_id, a.round_id)));
    note('public CLI previews without unpinning; applying one round preserves immutable history, other rounds and shared baseline/LFS references');
    for (const [index, task] of tasks.entries()) {
        cli(sourceHome, ['task', 'workspace', 'remove', task.agent_id, '--discard-ignored']);
        const removed = await until(() => client.read(task.agent_id), value => value.environment.mode === 'worktree' && value.environment.remote?.release?.state === 'released', 'worktree and baseline release');
        assert(removed.environment.mode === 'worktree'); assert.equal(removed.environment.status, 'removed'); assert(!existsSync(task.environment.checkout!));
        if (index === 0) { assert(existsSync(common)); assert(existsSync(b.environment.checkout!)); }
    }
    assert(!existsSync(common));
    cli(targetHome, ['stop']);
    note('two completed native tasks release precise executor refs and independent consumers; shared cache survives the first removal and disappears after the last, with no model call');
    const protectedFiles = [digest(join(project, '.git/index')), digest(join(project, '.git/config'))];
    for (const task of tasks) {
        const accepted = cli(sourceHome, ['task', 'result', 'fetch', task.agent_id, '--request-id', randomUUID()]);
        await until(() => client.result(task.agent_id, accepted.round_id), value => {
            const fetch = value.fetches.at(-1); if (fetch?.status === 'failed') throw new Error(JSON.stringify(fetch.error));
            return fetch?.status === 'available' && fetch.released;
        }, 'fetch after cache removal');
    }
    assert.deepEqual([digest(join(project, '.git/index')), digest(join(project, '.git/config'))], protectedFiles);
    assert.equal(git('for-each-ref', '--format=%(refname) %(objectname)', 'refs/hapi/results'), originalRefs);
    note('executor cache and worktrees are physically gone and target Runner is stopped; public fetch still restores both final results while preserving main refs/index/config');
    for (const task of tasks) {
        cli(sourceHome, ['task', 'result', 'release', task.agent_id, '--apply']);
        for (const round of original.cases.find((item: any) => item.id === task.agent_id).rounds) {
            const result = await until(() => client.result(task.agent_id, round.roundId), value => value.code.status === 'released', 'remaining result release');
            for (const manifest of result.manifests) for (const file of [...manifest.baseline.files, ...manifest.output.files]) {
                assert(!(await artifacts.refs(file.artifactId)).references.some(ref => ref.reference === manifest.reference));
            }
        }
    }
    assert.equal(git('for-each-ref', '--format=%(refname) %(objectname)', 'refs/hapi/results'), originalRefs);
    assert.deepEqual((await hapi.request('/api/sessions')).sessions.map((session: any) => session.id).sort(), sessions);
    evidence.sessions = sessions; evidence.tasks = await Promise.all(tasks.map(task => client.read(task.agent_id)));
    evidence.success = true;
    note('remaining center recovery pins release independently; imported main-repository refs and native session identities remain unchanged');
} catch (error) { evidence.error = error instanceof Error ? error.stack : String(error); process.exitCode = 1; }
finally {
    for (const home of [...homes].reverse()) try { cli(home, ['stop']); } catch (error) { evidence.cleanupErrors.push(String(error)); }
    if (hub?.exitCode === null) { hub.kill('SIGTERM'); await new Promise<void>(done => hub!.once('exit', () => done())); }
    if (evidence.cleanupErrors.length) { evidence.success = false; process.exitCode = 1; }
    evidence.finishedAt = new Date().toISOString(); writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(`Evidence: ${join(root, 'evidence.json')}`); if (evidence.error) console.error(evidence.error);
}
