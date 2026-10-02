import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Database } from 'bun:sqlite';
import { removeFileSmokeData } from './fixtures/native-file-smoke';
import { closeSmoke } from './fixtures/smoke-lifecycle';
import { freePort } from '../src/services';
import { HubClient } from '../src/hub/client';
import { HubResourceClient } from '../src/hub/resources/client';
import { hubConnectionPaths } from '../src/hub/resources/connection';
import { rm } from 'node:fs/promises';
import { STATE_SCHEMA_VERSION } from '../src/state';
import { HubPreparationClient } from '../src/hub/delegation/client';
import { ArtifactClient } from '../src/artifacts/client';

// Full diagnostic CLI, real center and two same-host Runners; no model execution.
const binary = resolve(process.argv[2] ?? 'dist/runweft'), hapiBinary = resolve(process.argv[3] ?? 'dist/hapi');
mkdirSync('.dev-smoke', { recursive: true }); const root = mkdtempSync(resolve('.dev-smoke/workspace-preparation-'));
const center = join(root, 'center'), sourceHome = join(root, 'source-runner'), targetHome = join(root, 'target-runner'), project = join(root, 'project');
const env = { ...process.env }; for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_')) delete env[key];
env.GIT_CONFIG_GLOBAL = '/dev/null'; env.GIT_CONFIG_NOSYSTEM = '1';
const evidence = { root, binary, hapiBinary, startedAt: new Date().toISOString(), finishedAt: '', success: false,
    preparations: [] as string[], checks: [] as string[], error: '', cleanupErrors: [] as string[] };
let fixture: Awaited<ReturnType<typeof compiledCenter>> | undefined;
let sourceRunner: Awaited<ReturnType<Awaited<ReturnType<typeof compiledCenter>>['addRunner']>>, targetRunner: typeof sourceRunner;
/** The diagnostic stays on compiled serve and CLI; only installation/exit ownership is shared here. */
async function compiledCenter() {
    const cleanups: Array<() => void | Promise<void>> = [], secrets = new Set<string>(), runnerHomes: string[] = [];
    const port = await freePort(), url = `http://127.0.0.1:${port}`, identityFile = join(root, 'identity.txt');
    let stopped = false;
    env.CODEX_HOME = join(root, 'codex-home'); env.CLAUDE_CONFIG_DIR = join(root, 'claude-home');
    mkdirSync(env.CODEX_HOME, { recursive: true }); mkdirSync(env.CLAUDE_CONFIG_DIR, { recursive: true });
    async function service(home: string, args: string[]) {
        const child = Bun.spawn([binary, '--home', home, '--json', ...args], { cwd: root, env, stdout: 'pipe', stderr: 'pipe' });
        const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        assert.equal(code, 0, `${args.join(' ')}: ${stderr}`); return JSON.parse(stdout);
    }
    secrets.add(identityFile); secrets.add(join(center, 'server/hapi/settings.json')); secrets.add(join(center, 'server/hapi/jwt-secret.json'));
    cleanups.push(async () => { assert(stopped, 'Service still running; secrets retained');
        for (const home of runnerHomes) assert.equal((await service(home, ['status'])).runner.running, false, 'Runner still running; secrets retained');
        await closeSmoke([...secrets].map(file => () => rm(file, { force: true }))); });
    cleanups.push(async () => { await service(center, ['stop']); const status = await service(center, ['status']);
        assert.equal(status.service.running, false); assert.equal(status.runner.running, false); stopped = true; });
    try {
        await service(center, ['init']); await service(center, ['config', 'set', 'server.port', String(port)]);
        await service(center, ['config', 'set', 'server.runner', 'false']); await service(center, ['config', 'set', 'hapi.executable', hapiBinary]); await service(center, ['start']);
        const response = await fetch(url + '/api/runweft/hub/identities', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Compiled diagnostic owner' }) });
        assert.equal(response.status, 201); const user = await response.json(), space = user.personalSpace.id;
        writeFileSync(identityFile, user.token, { mode: 0o600 });
        async function hubCli(args: string[], home = center) {
            return service(home, ['hub', '--url', url, '--identity-file', identityFile, '--space', space, ...args]);
        }
        const resources = new HubResourceClient({ url, identityFile, space });
        async function waitRunner(machineId: string) {
            await until(async () => { try { return (await resources.discover(machineId)).tools.length === 2; } catch { return false; } }, Boolean);
        }
        async function stopRunner(item: { home: string; machineId: string }) { await service(item.home, ['runner', 'stop']); assert.equal((await service(item.home, ['status'])).runner.running, false); }
        async function startRunner(item: { home: string; machineId: string }) { await service(item.home, ['runner', 'start']); await waitRunner(item.machineId); }
        const runners: { home: string; machineId: string }[] = [];
        async function addRunner() {
            const home = join(root, `runner-client-${runners.length}`);
            await service(home, ['init']); await service(home, ['config', 'set', 'hub.url', url]); await service(home, ['config', 'set', 'hapi.executable', hapiBinary]);
            const paths = hubConnectionPaths(home, url); secrets.add(paths.identityConnection);
            mkdirSync(dirname(paths.identityConnection), { recursive: true });
            writeFileSync(paths.identityConnection, JSON.stringify({ schemaVersion: 1, hub: url, ownerId: user.identity.id, spaceId: space, token: user.token, requestId: randomUUID(), createdAt: Date.now() }), { mode: 0o600 });
            const enrolled = await hubCli(['machine', 'enroll'], home); secrets.add(enrolled.credentialFile);
            secrets.add(join(paths.connection, 'hapi', 'settings.json'));
            const item = { home, machineId: enrolled.machineId }; runners.push(item); runnerHomes.push(home);
            cleanups.push(() => stopRunner(item));
            await hubCli(['machine', 'associate', item.machineId, space]); await startRunner(item); return item;
        }
        async function restart() {
            const running: typeof runners = [];
            for (const item of runners) if ((await service(item.home, ['status'])).runner.running) running.push(item);
            await service(center, ['stop']); await service(center, ['start']);
            for (const item of running) await waitRunner(item.machineId);
        }
        const paths = await service(center, ['paths']);
        return { url, user, space, identityFile, statePath: paths.state, cli: hubCli, addRunner, stopRunner, startRunner, restart,
            http: new HubClient({ url, identityFile, space }, 'hubAccess', 'hub_access_unavailable').http,
            candidate: { entry: 'compiled CLI + compiled serve + real HAPI/Runner', binary, hapiBinary,
                cliSha256: createHash('sha256').update(readFileSync(binary)).digest('hex'), hapiSha256: createHash('sha256').update(readFileSync(hapiBinary)).digest('hex') },
            close: async (success = false) => { await closeSmoke(cleanups); if (success) await removeFileSmokeData(root); } };
    } catch (error) { try { await closeSmoke(cleanups); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Compiled preparation setup failed'); } throw error; }
}
async function cli(home: string, args: string[], options: { cwd?: string; input?: string; code?: number } = {}) {
    const actualHome = home === sourceHome || home === center ? sourceRunner.home : home === targetHome ? targetRunner.home : home;
    const child = Bun.spawn([binary, '--home', actualHome, '--json', 'hub', '--url', fixture!.url,
        '--identity-file', fixture!.identityFile, '--space', fixture!.space, ...args], { cwd: options.cwd ?? project, env, stdout: 'pipe', stderr: 'pipe' });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    assert(!(stdout + stderr).includes(fixture!.user.token), 'Credential leaked');
    assert.equal(code, options.code ?? 0, `${args.join(' ')}: ${stderr}`);
    return JSON.parse(stdout || stderr.replace(/^\{"event":"workspace_request"[^\n]*\n/, ''));
}
function git(...args: string[]) { const result = spawnSync('git', ['-C', project, ...args], { env, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); }
const note = (message: string) => { evidence.checks.push(message); console.log(message); };
async function until<T>(read: () => Promise<T> | T, done: (value: T) => boolean): Promise<T> {
    const end = Date.now() + 180_000;
    while (Date.now() < end) { const item = await read(); if (done(item)) return item; await Bun.sleep(150); }
    throw new Error('Diagnostic not confirmed before observation deadline');
}

try {
    mkdirSync(project); git('init', '-q'); git('config', 'user.name', 'Preparation Smoke'); git('config', 'user.email', 'smoke@example.invalid'); git('config', 'commit.gpgsign', 'false');
    git('lfs', 'install', '--local'); writeFileSync(join(project, '.gitattributes'), '*.bin filter=lfs diff=lfs merge=lfs -text\n'); mkdirSync(join(project, 'app'));
    writeFileSync(join(project, 'app/note'), 'fixed baseline'); writeFileSync(join(project, '.gitignore'), 'deps/\n');
    for (let index = 0; index < 102; index++) writeFileSync(join(project, `asset-${index}.bin`), Buffer.from(`baseline:${index}\0`.repeat(100)));
    git('add', '.'); git('commit', '-qm', 'baseline'); const original = git('rev-parse', 'HEAD'); writeFileSync(join(project, 'dirty'), 'excluded');
    fixture = await compiledCenter(); Object.assign(evidence, { candidate: fixture.candidate });
    sourceRunner = await fixture.addRunner(); targetRunner = await fixture.addRunner();
    const runtime = (await fixture.cli(['runtime', 'register', 'codex', '--machine', targetRunner.machineId])).runtime;
    const repository = (await fixture.cli(['repository', 'create', 'Preparation project', '--request-id', randomUUID()])).repository;
    await fixture.cli(['repository', 'bind', repository.id, '--machine', sourceRunner.machineId, '--cwd', join(project, 'app')]);
    const definition = join(root, 'reviewer.json'); writeFileSync(definition, JSON.stringify({ name: 'Reviewer', repositoryId: repository.id, runtimeId: runtime.id }));
    const agent = (await fixture.cli(['agent', 'create', '--request-id', randomUUID(), '--file', definition])).agent;
    const hapi = fixture.http;
    const client = new HubPreparationClient({ url: fixture.url, home: sourceRunner.home, identityFile: fixture.identityFile, space: fixture.space, env }, join(project, 'app'));
    const requestId = randomUUID();
    const accepted = (await cli(sourceHome, ['workspace', 'prepare', '--agent', agent.id, '--base', 'HEAD', '--request-id', requestId], { cwd: join(project, 'app') })).preparation;
    evidence.preparations.push(accepted.id); assert.equal(accepted.origin.baseCommit, original); assert(accepted.origin.dirty);
    await fixture.restart();
    assert.equal((await cli(sourceHome, ['workspace', 'prepare', '--agent', agent.id, '--base', 'HEAD', '--request-id', requestId], { cwd: join(project, 'app') })).preparation.id, accepted.id);
    const ready = await until(() => client.inspect(accepted.id), item => { if (item.phase === 'failed') throw new Error(JSON.stringify(item.error)); return item.phase === 'ready' && item.cleanup.sourceReleased && item.cleanup.downloadsReleased; });
    assert.equal(ready.transfer.files, 103); assert.equal(ready.transfer.reusedBytes, 0); assert(ready.workspace);
    assert.equal(readFileSync(join(ready.workspace.cwd, 'note'), 'utf8'), 'fixed baseline'); assert(!existsSync(join(ready.workspace.checkout, 'dirty')));
    for (const index of [0, 101]) assert.deepEqual(readFileSync(join(ready.workspace.checkout, `asset-${index}.bin`)), readFileSync(join(project, `asset-${index}.bin`)));
    note('compiled CLI freezes a dirty source subdirectory and resumes the same accepted request after Hub restart; 103 real Git/LFS files use bounded batches and prepare correct binary worktree contents');
    const again = (await cli(sourceHome, ['workspace', 'prepare', '--agent', agent.id, '--base', 'HEAD', '--request-id', requestId], { cwd: join(project, 'app') })).preparation;
    assert.equal(again.id, accepted.id);
    const second = (await cli(sourceHome, ['workspace', 'prepare', '--agent', agent.id, '--base', 'HEAD'], { cwd: join(project, 'app') })).preparation;
    evidence.preparations.push(second.id); const secondReady = await until(() => client.inspect(second.id), item => item.phase === 'ready');
    assert.equal(secondReady.snapshot.id, ready.snapshot.id); assert.equal(secondReady.target.importId, ready.target.importId); assert.equal(secondReady.transfer.uploadBytes, 0);
    assert.notEqual(secondReady.workspace!.branch, ready.workspace.branch);
    writeFileSync(join(project, 'app/note'), 'second committed base'); git('add', 'app/note'); git('commit', '-qm', 'next baseline');
    const third = (await cli(sourceHome, ['workspace', 'prepare', '--agent', agent.id, '--base', 'HEAD'], { cwd: join(project, 'app') })).preparation;
    evidence.preparations.push(third.id); const thirdReady = await until(() => client.inspect(third.id), item => { if (item.phase === 'failed') throw new Error(JSON.stringify(item.error)); return item.phase === 'ready' && item.cleanup.sourceReleased && item.cleanup.downloadsReleased; });
    assert.notEqual(thirdReady.snapshot.id, ready.snapshot.id); assert(thirdReady.transfer.reusedBytes > 0); assert(thirdReady.transfer.uploadBytes < thirdReady.transfer.totalBytes);
    note('same request returns the original preparation; another consumer reuses snapshot/import, while another commit uploads only its new bundle and pins existing LFS objects');
    const db = new Database(fixture!.statePath, { readonly: true });
    try {
        assert.deepEqual(db.query('PRAGMA user_version').get(), { user_version: STATE_SCHEMA_VERSION });
        assert.equal((db.query('SELECT COUNT(*) AS n FROM repository_snapshots').get() as { n: number }).n, 2);
        assert.equal((db.query('SELECT COUNT(*) AS n FROM repository_lfs').get() as { n: number }).n, 102);
        for (const row of db.query('SELECT data FROM repository_snapshots').all() as { data: string }[]) {
            const record = JSON.parse(row.data); assert(record.batches.every((batch: { names: string[]; released: boolean }) => batch.names.length <= 100 && batch.released));
            assert(record.sourceReleased); assert(!existsSync(record.directory));
        }
    } finally { db.close(); }
    renameSync(project, `${project}-offline`); await fixture.stopRunner(sourceRunner);
    await fixture.restart();
    const inspector = (await cli(center, ['workspace', 'inspect', ready.id], { cwd: root })).preparation;
    assert.equal(inspector.phase, 'ready'); assert.equal((await cli(center, ['workspace', 'preparations', '--all'], { cwd: root })).preparations.length, 3);
    assert.equal((await hapi.request('/api/sessions')).sessions.length, 0);
    note('current state schema, cache/import receipts and pins survive Hub restart with source paths hidden and source Runner stopped; explicit Hub owner can inspect all diagnostics with its source Runner offline');
    const records = <T>(table: string): T[] => {
        const database = new Database(fixture!.statePath, { readonly: true });
        try { return (database.query(`SELECT data FROM ${table}`).all() as { data: string }[]).map(row => JSON.parse(row.data)); } finally { database.close(); }
    };
    const snapshots = records<any>('repository_snapshots'), oldSnapshot = snapshots.find(item => item.id === ready.snapshot.id);
    const imported = records<any>('repository_imports').find(item => item.id === ready.target.importId), cache = dirname(imported.source.commonDir);
    const lfs = oldSnapshot.files.find((file: any) => file.kind === 'lfs'), artifacts = new ArtifactClient(hapi);
    const release = async (id: string, discard = false) => (await cli(center, ['workspace', 'release', id, ...(discard ? ['--discard-ignored'] : [])], { cwd: root })).preparation;
    const released = (id: string) => until(() => client.inspect(id), item => { if (item.release?.status === 'failed') throw new Error(JSON.stringify(item.error)); return item.phase === 'released'; });
    writeFileSync(join(ready.workspace.cwd, 'note'), 'unrecovered diagnostic code'); await release(ready.id);
    const dirty = await until(() => client.inspect(ready.id), item => item.release?.status === 'failed');
    assert.equal(dirty.error!.code, 'workspace_unrecovered_changes'); assert.equal(readFileSync(join(ready.workspace.cwd, 'note'), 'utf8'), 'unrecovered diagnostic code');
    const actualHead = spawnSync('git', ['-C', ready.workspace.checkout, 'rev-parse', 'HEAD'], { env, encoding: 'utf8' }); assert.equal(actualHead.status, 0); assert.equal(actualHead.stdout.trim(), original);
    writeFileSync(join(ready.workspace.cwd, 'note'), 'fixed baseline'); mkdirSync(join(ready.workspace.checkout, 'deps')); writeFileSync(join(ready.workspace.checkout, 'deps/cache'), 'ignored');
    await release(ready.id); assert.equal((await until(() => client.inspect(ready.id), item => item.release?.status === 'failed')).error!.code, 'workspace_ignored_files');
    await release(ready.id, true); await fixture.restart();
    const firstReleased = await released(ready.id); assert.equal(firstReleased.consumerActive, false); assert.equal(firstReleased.snapshot.retention, 'retained');
    assert(!existsSync(ready.workspace.checkout)); assert(existsSync(secondReady.workspace!.checkout)); assert(existsSync(cache));
    assert.equal((await artifacts.refs(lfs.artifactId)).references.length, 2);
    note('actual release preserves dirty code without creating a checkpoint, requires explicit ignored-file discard, survives Hub restart and preserves the other consumer/worktree and both LFS recovery pins');
    await fixture.stopRunner(targetRunner); await release(second.id);
    const offline = await until(() => client.inspect(second.id), item => item.release?.status === 'unknown');
    assert.equal(offline.snapshot.retention, 'retained'); assert.equal((await artifacts.refs(lfs.artifactId)).references.length, 2);
    await fixture.startRunner(targetRunner); const secondReleased = await released(second.id);
    assert.equal(secondReleased.snapshot.retention, 'released'); assert(secondReleased.target.cache?.retained); assert(existsSync(cache));
    assert.equal((await artifacts.refs(lfs.artifactId)).references.length, 1); assert(existsSync(thirdReady.workspace!.checkout));
    await release(third.id); const thirdReleased = await released(third.id);
    assert.equal(thirdReleased.snapshot.retention, 'released'); assert.equal(thirdReleased.target.cache?.retained, false);
    assert(!existsSync(cache)); assert(!existsSync(thirdReady.workspace!.checkout)); assert.equal((await artifacts.refs(lfs.artifactId)).references.length, 0);
    assert.equal((await artifacts.show(lfs.artifactId)).state, 'available'); assert.equal((await release(third.id)).phase, 'released');
    assert.equal((await hapi.request('/api/sessions')).sessions.length, 0);
    note('offline target preserves recovery pins; after reconnecting, release keeps another snapshot\'s LFS references and cache, then the last release removes the owned cache and unpins without deleting center object bytes or historical receipts');
    await fixture.startRunner(sourceRunner);
    const localDefinition = join(root, 'local-reviewer.json'); writeFileSync(localDefinition, JSON.stringify({ name: 'Local reviewer', repositoryId: repository.id, runtimeId: (await fixture.cli(['runtime', 'register', 'codex', '--machine', sourceRunner.machineId])).runtime.id }));
    const localAgent = (await fixture.cli(['agent', 'create', '--request-id', randomUUID(), '--file', localDefinition])).agent;
    await fixture.cli(['repository', 'bind', repository.id, '--machine', sourceRunner.machineId, '--cwd', `${project}-offline`]);
    const rejected = (await cli(sourceHome, ['workspace', 'prepare', '--agent', localAgent.id, '--base', 'HEAD'], { cwd: `${project}-offline`, code: 1 }));
    assert.equal(rejected.error.code, 'local_workspace_task_required');
    assert.equal((await cli(sourceHome, ['workspace', 'preparations', '--all'], { cwd: root })).preparations.length, 3);
    note('actual current source-machine runtime rejects remote diagnostics, points to local worktree delegation and creates no extra preparation');
    evidence.success = true;
} catch (error) { evidence.error = error instanceof Error ? error.stack ?? error.message : String(error); process.exitCode = 1; }
finally {
    try { await fixture?.close(evidence.success); } catch (error) { evidence.cleanupErrors.push(...(error instanceof AggregateError ? error.errors.map(String) : [String(error)])); }
    if (evidence.cleanupErrors.length) { evidence.success = false; process.exitCode = 1; }
    evidence.finishedAt = new Date().toISOString(); writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(`Evidence: ${join(root, 'evidence.json')}`); if (evidence.error) console.error(evidence.error);
}
