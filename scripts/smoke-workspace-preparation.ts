import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Database } from 'bun:sqlite';
import { HapiClient } from '../src/hapi';
import { freePort } from '../src/services';
import { PreparationClient } from '../src/remote/client';
import { loadConfig } from '../src/config';

// Full diagnostic CLI, real center and two same-host Runners; no model execution.
const binary = resolve(process.argv[2] ?? 'dist/runweft'), hapiBinary = resolve(process.argv[3] ?? 'dist/hapi');
mkdirSync('.dev-smoke', { recursive: true }); const root = mkdtempSync(resolve('.dev-smoke/workspace-preparation-'));
const center = join(root, 'center'), sourceHome = join(root, 'source-runner'), targetHome = join(root, 'target-runner'), project = join(root, 'project');
const env = { ...process.env }; for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_')) delete env[key];
env.GIT_CONFIG_GLOBAL = '/dev/null'; env.GIT_CONFIG_NOSYSTEM = '1';
const evidence = { root, binary, hapiBinary, startedAt: new Date().toISOString(), finishedAt: '', success: false,
    preparations: [] as string[], checks: [] as string[], error: '', cleanupErrors: [] as string[] };
const homes: string[] = [];
let token: string | undefined, foreground: ChildProcess | undefined, url = '';
function cli(home: string, args: string[], options: { cwd?: string; input?: string; code?: number } = {}) {
    const result = spawnSync(binary, ['--home', home, '--json', ...args], { cwd: options.cwd ?? project, env, input: options.input, encoding: 'utf8', timeout: 45_000 });
    if (token) assert(!`${result.stdout}${result.stderr}`.includes(token), 'Credential leaked');
    assert.equal(result.status, options.code ?? 0, `${args.slice(0, 2).join(' ')}: ${result.stderr || result.error || result.signal}`);
    return JSON.parse(result.stdout || result.stderr.replace(/^\{"event":"workspace_request"[^\n]*\n/, ''));
}
function git(...args: string[]) { const result = spawnSync('git', ['-C', project, ...args], { env, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); }
const note = (message: string) => { evidence.checks.push(message); console.log(message); };
async function until<T>(read: () => Promise<T> | T, done: (value: T) => boolean): Promise<T> {
    const end = Date.now() + 180_000;
    while (Date.now() < end) { const item = await read(); if (done(item)) return item; await Bun.sleep(150); }
    throw new Error('Diagnostic not confirmed before observation deadline');
}
async function startHub() {
    const fd = openSync(join(root, 'hub.log'), 'a', 0o600);
    try { foreground = spawn(binary, ['--home', center, 'serve', '--public'], { cwd: root, env, stdio: ['ignore', fd, fd] }); } finally { closeSync(fd); }
    await until(async () => { if (foreground!.exitCode !== null) throw new Error('Hub exited'); return fetch(`${url}/api/runweft/health`).then(r => r.ok).catch(() => false); }, ready => ready);
}
try {
    mkdirSync(project); git('init', '-q'); git('config', 'user.name', 'Preparation Smoke'); git('config', 'user.email', 'smoke@example.invalid'); git('config', 'commit.gpgsign', 'false');
    git('lfs', 'install', '--local'); writeFileSync(join(project, '.gitattributes'), '*.bin filter=lfs diff=lfs merge=lfs -text\n'); mkdirSync(join(project, 'app'));
    writeFileSync(join(project, 'app/note'), 'fixed baseline');
    for (let index = 0; index < 102; index++) writeFileSync(join(project, `asset-${index}.bin`), Buffer.from(`baseline:${index}\0`.repeat(100)));
    git('add', '.'); git('commit', '-qm', 'baseline'); const original = git('rev-parse', 'HEAD'); writeFileSync(join(project, 'dirty'), 'excluded');
    const port = await freePort(); url = `http://127.0.0.1:${port}`;
    cli(center, ['init']); homes.push(center); cli(center, ['config', 'set', 'server.port', String(port)]); cli(center, ['config', 'set', 'server.runner', 'false']);
    cli(center, ['config', 'set', 'hapi.executable', hapiBinary]); cli(center, ['config', 'set', 'server.publicUrl', url]); cli(center, ['start']);
    token = JSON.parse(readFileSync(join(center, 'server/hapi/settings.json'), 'utf8')).cliApiToken; assert(token); cli(center, ['stop']); await startHub();
    const hapi = new HapiClient(url, token); assert.equal((await hapi.request('/api/machines')).machines.length, 0);
    for (const home of [sourceHome, targetHome]) {
        cli(home, ['init', '--url', url]); homes.push(home); cli(home, ['config', 'set', 'hapi.executable', hapiBinary]); cli(home, ['auth', 'login', '--token-stdin'], { input: token });
        cli(home, ['start']); cli(home, ['machine', 'register']);
    }
    const runtime = cli(targetHome, ['runtime', 'register', 'codex']).runtime;
    cli(sourceHome, ['agent', 'init', 'reviewer', '--runtime', runtime.id]);
    const client = new PreparationClient(loadConfig(sourceHome, env), join(project, 'app'));
    const requestId = randomUUID();
    const accepted = cli(sourceHome, ['workspace', 'prepare', '--agent', 'reviewer', '--base', 'HEAD', '--request-id', requestId], { cwd: join(project, 'app') }).preparation;
    evidence.preparations.push(accepted.id); assert.equal(accepted.origin.baseCommit, original); assert(accepted.origin.dirty);
    cli(center, ['stop']); await startHub();
    assert.equal(cli(sourceHome, ['workspace', 'prepare', '--agent', 'reviewer', '--base', 'HEAD', '--request-id', requestId], { cwd: join(project, 'app') }).preparation.id, accepted.id);
    const ready = await until(() => client.inspect(accepted.id), item => { if (item.phase === 'failed') throw new Error(JSON.stringify(item.error)); return item.phase === 'ready' && item.cleanup.sourceReleased && item.cleanup.downloadsReleased; });
    assert.equal(ready.transfer.files, 103); assert.equal(ready.transfer.reusedBytes, 0); assert(ready.workspace);
    assert.equal(readFileSync(join(ready.workspace.cwd, 'note'), 'utf8'), 'fixed baseline'); assert(!existsSync(join(ready.workspace.checkout, 'dirty')));
    for (const index of [0, 101]) assert.deepEqual(readFileSync(join(ready.workspace.checkout, `asset-${index}.bin`)), readFileSync(join(project, `asset-${index}.bin`)));
    note('compiled CLI freezes a dirty source subdirectory and resumes the same accepted request after Hub restart; 103 real Git/LFS files use bounded batches and prepare correct binary worktree contents');
    const again = cli(sourceHome, ['workspace', 'prepare', '--agent', 'reviewer', '--base', 'HEAD', '--request-id', requestId], { cwd: join(project, 'app') }).preparation;
    assert.equal(again.id, accepted.id);
    const second = cli(sourceHome, ['workspace', 'prepare', '--agent', 'reviewer', '--base', 'HEAD'], { cwd: join(project, 'app') }).preparation;
    evidence.preparations.push(second.id); const secondReady = await until(() => client.inspect(second.id), item => item.phase === 'ready');
    assert.equal(secondReady.snapshot.id, ready.snapshot.id); assert.equal(secondReady.target.importId, ready.target.importId); assert.equal(secondReady.transfer.uploadBytes, 0);
    assert.notEqual(secondReady.workspace!.branch, ready.workspace.branch);
    writeFileSync(join(project, 'app/note'), 'second committed base'); git('add', 'app/note'); git('commit', '-qm', 'next baseline');
    const third = cli(sourceHome, ['workspace', 'prepare', '--agent', 'reviewer', '--base', 'HEAD'], { cwd: join(project, 'app') }).preparation;
    evidence.preparations.push(third.id); const thirdReady = await until(() => client.inspect(third.id), item => { if (item.phase === 'failed') throw new Error(JSON.stringify(item.error)); return item.phase === 'ready' && item.cleanup.sourceReleased && item.cleanup.downloadsReleased; });
    assert.notEqual(thirdReady.snapshot.id, ready.snapshot.id); assert(thirdReady.transfer.reusedBytes > 0); assert(thirdReady.transfer.uploadBytes < thirdReady.transfer.totalBytes);
    note('same request returns the original preparation; another consumer reuses snapshot/import, while another commit uploads only its new bundle and pins existing LFS objects');
    const db = new Database(join(center, 'server/runweft/state.sqlite'), { readonly: true });
    try {
        assert.deepEqual(db.query('PRAGMA user_version').get(), { user_version: 5 });
        assert.equal((db.query('SELECT COUNT(*) AS n FROM repository_snapshots').get() as { n: number }).n, 2);
        assert.equal((db.query('SELECT COUNT(*) AS n FROM repository_lfs').get() as { n: number }).n, 102);
        for (const row of db.query('SELECT data FROM repository_snapshots').all() as { data: string }[]) {
            const record = JSON.parse(row.data); assert(record.batches.every((batch: { names: string[]; released: boolean }) => batch.names.length <= 100 && batch.released));
            assert(record.sourceReleased); assert(!existsSync(record.directory));
        }
    } finally { db.close(); }
    renameSync(project, `${project}-offline`); cli(sourceHome, ['stop'], { cwd: root });
    cli(center, ['stop'], { cwd: root }); await startHub();
    const inspector = cli(center, ['workspace', 'inspect', ready.id], { cwd: root }).preparation;
    assert.equal(inspector.phase, 'ready'); assert.equal(cli(center, ['workspace', 'preparations', '--all'], { cwd: root }).preparations.length, 3);
    assert.equal((await hapi.request('/api/sessions')).sessions.length, 0);
    note('state v5, cache/import receipts and pins survive Hub restart with source paths hidden and source Runner stopped; Hub operator without local Runner can inspect all diagnostics');
    const local = join(root, 'local'); cli(local, ['init'], { cwd: root }); homes.push(local);
    cli(local, ['config', 'set', 'server.port', String(await freePort())], { cwd: root }); cli(local, ['config', 'set', 'hapi.executable', hapiBinary], { cwd: root }); cli(local, ['start'], { cwd: root });
    cli(local, ['machine', 'register'], { cwd: root }); const localRuntime = cli(local, ['runtime', 'register', 'codex'], { cwd: root }).runtime;
    cli(local, ['agent', 'init', 'local-reviewer', '--runtime', localRuntime.id], { cwd: root });
    const rejected = cli(local, ['workspace', 'prepare', '--agent', 'local-reviewer', '--base', 'HEAD'], { cwd: `${project}-offline`, code: 1 });
    assert.equal(rejected.error.code, 'local_workspace_task_required');
    assert.equal(cli(local, ['workspace', 'preparations', '--all'], { cwd: root }).preparations.length, 0);
    note('actual local mode rejects remote diagnostics for its own runtime, points to local worktree delegation and creates no preparation');
    evidence.success = true;
} catch (error) { evidence.error = error instanceof Error ? error.stack ?? error.message : String(error); process.exitCode = 1; }
finally {
    for (const home of [...homes].reverse()) { try { cli(home, ['stop'], { cwd: root }); } catch (error) { evidence.cleanupErrors.push(String(error)); } }
    if (foreground?.exitCode === null) { foreground.kill('SIGTERM'); await new Promise<void>(resolve => foreground!.once('exit', () => resolve())); }
    if (evidence.cleanupErrors.length) { evidence.success = false; process.exitCode = 1; }
    evidence.finishedAt = new Date().toISOString(); writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(`Evidence: ${join(root, 'evidence.json')}`); if (evidence.error) console.error(evidence.error);
}
