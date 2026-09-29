import assert from 'node:assert/strict';
import { Database } from 'bun:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { HapiClient } from '../src/hapi';
import { loadConfig, targetUrl } from '../src/config';
import pkg from '../package.json';

// Consumes a completed dedicated output-smoke fixture. Starts no new native task.
// The source evidence and Git worktrees remain; this test explicitly releases their file references.
const source = resolve(process.argv[2] ?? '');
assert(source.startsWith(resolve('.dev-smoke/task-outputs-')) && source.endsWith('/evidence.json'), 'Pass a dedicated task-outputs evidence.json');
const previous = JSON.parse(readFileSync(source, 'utf8'));
assert(previous.success && previous.cleanupErrors.length === 0 && previous.cases.length === 8, 'Require a completed eight-round native fixture');
const fixture = dirname(source), home = join(fixture, 'home'), binary = resolve(process.argv[3] ?? 'dist/runweft');
await mkdir('.dev-smoke', { recursive: true }); const root = await mkdtemp(resolve('.dev-smoke/task-retention-'));
const env: NodeJS.ProcessEnv = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_')) delete env[key];
Object.assign(env, { CODEX_HOME: join(fixture, 'codex-home'), CLAUDE_CONFIG_DIR: join(fixture, 'claude-home'), GIT_CEILING_DIRECTORIES: fixture });
let token = '', originalLimit: number | undefined;
const evidence = { root, source, binary, hapiRevision: pkg.hapi.revision, startedAt: new Date().toISOString(), finishedAt: '', success: false,
    checks: [] as string[], cases: [] as Record<string, unknown>[], cleanupErrors: [] as string[], error: '' };
async function cli(args: string[], cwd = fixture, expected = 0) {
    const child = Bun.spawn([binary, '--home', home, '--json', ...args], { env, cwd, stdout: 'pipe', stderr: 'pipe' });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (token) assert(!`${stdout}${stderr}`.includes(token), 'Credential leaked');
    assert.equal(code, expected, `${args.slice(0, 3).join(' ')}: ${stderr}`);
    return { value: stdout.trim() ? JSON.parse(stdout) : null, stderr };
}
async function until(read: () => Promise<any>, accepted: (value: any) => boolean, label: string) {
    const deadline = Date.now() + 60_000;
    do { const value = await read(); if (accepted(value)) return value; await Bun.sleep(100); } while (Date.now() < deadline);
    throw new Error(`Timed out: ${label}`);
}
function count(path: string, table: string) {
    assert(['sessions', 'delegation_inputs'].includes(table));
    const db = new Database(path, { readonly: true });
    try { return (db.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n; } finally { db.close(); }
}
const record = (message: string) => { evidence.checks.push(message); console.log(message); };
try {
    const config = loadConfig(home, env); originalLimit = config.config.server.artifacts.maxFileMiB;
    await cli(['config', 'set', 'hapi.executable', resolve('dist/hapi')]);
    await cli(['config', 'set', 'server.artifacts.maxFileMiB', '1']); await cli(['start']);
    const paths = (await cli(['paths'])).value;
    token = JSON.parse(readFileSync(join(paths.hapiServer, 'settings.json'), 'utf8')).cliApiToken; assert(token);
    const hapi = new HapiClient(targetUrl(config.config), token);
    const nativeCount = count(join(paths.hapiServer, 'hapi.db'), 'sessions'), inputCount = count(paths.state, 'delegation_inputs');
    const before = [];
    for (const item of previous.cases) {
        const view = await until(async () => (await cli(['task', 'show', item.taskId, '--round', item.roundId])).value,
            value => value.input_files.download_retention === 'released', 'automatic input cleanup');
        assert.equal(view.artifacts.retention.state, 'retained', 'This fixture has already been released; do not blindly replay cleanup');
        assert.equal(existsSync(view.input_files.paths[0].path), item.mode === 'worktree');
        assert.equal((await cli(['artifact', 'show', view.input_files.files[0].artifactId])).value.state, 'available');
        const session = (await hapi.request(`/api/sessions/${item.sessionId}`)).session;
        assert.equal(session.active, false); assert.deepEqual(session.metadata.disabledMcpServers, ['runweft']);
        before.push({ item, view });
    }
    record('eight existing Codex/Claude rounds: stopped shared input copies reclaimed, worktree inputs retained, central inputs pinned');
    const selected = before[0]!, taskId = selected.item.taskId, roundId = selected.item.roundId, cwd = selected.view.parent.cwd;
    const originalManifest = selected.view.artifacts.manifest;
    const protectedId = originalManifest.items.find((item: any) => item.status === 'available').artifactId;
    const reference = 'retention-smoke:external-recovery';
    await hapi.request(`/api/artifacts/${protectedId}/references/${reference}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reference, purpose: 'recovery' }) });
    await cli(['task', 'artifacts', 'collect', taskId, '--round', roundId, '--path', 'discard-me.txt=large.txt', '--request-id', randomUUID()], cwd);
    const incomplete = await until(async () => (await cli(['task', 'show', taskId, '--round', roundId], cwd)).value,
        value => value.artifacts.manifest.version === originalManifest.version + 1 && !value.artifacts.pending.length, 'fixed candidate rejected by configured file limit');
    const pending = incomplete.artifacts.manifest.items.find((item: any) => item.name === 'discard-me.txt');
    assert.equal(pending.status, 'failed'); assert(pending.captureOperationId); assert.equal(incomplete.status, 'completed');
    const operation = (await hapi.request(`/api/machines/${incomplete.machine_id}/artifacts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'inspect', operationId: pending.captureOperationId }) })).operation;
    const candidate = operation.candidates.find((file: any) => file.name === 'discard-me.txt'); assert(existsSync(candidate.path));
    const preview = (await cli(['task', 'artifacts', 'release', taskId], cwd)).value;
    assert.equal(preview.applied, false); assert.equal(preview.can_release, false);
    assert((await cli(['task', 'artifacts', 'release', taskId, '--apply'], cwd, 1)).stderr.includes('artifact_undelivered_candidates'));
    assert(existsSync(candidate.path));
    const history = new Map<string, unknown>(), objects = new Set<string>();
    for (const { item, view } of before) {
        const manifests = (await cli(['task', 'artifacts', 'show', item.taskId, '--round', item.roundId], view.parent.cwd)).value.manifests;
        history.set(item.roundId, manifests);
        for (const manifest of manifests) for (const file of manifest.items) if (file.artifactId) objects.add(file.artifactId);
        for (const file of view.input_files.files) objects.add(file.artifactId);
    }
    await cli(['task', 'artifacts', 'release', taskId, '--discard-pending', '--apply'], cwd);
    for (const id of new Set<string>(before.map(value => value.item.taskId))) {
        if (id !== taskId) await cli(['task', 'artifacts', 'release', id, '--apply']);
    }
    for (const { item, view } of before) {
        const expected = item.roundId === roundId ? 'discarded' : 'released';
        const after = await until(async () => (await cli(['task', 'show', item.taskId, '--round', item.roundId])).value,
            value => value.artifacts.retention.state === expected, 'release acknowledgement');
        assert.equal(after.completed_revision, view.completed_revision); assert.equal(after.native_session_id, view.native_session_id);
        assert.equal(after.report.text, view.report.text); assert.deepEqual(after.git, view.git);
        assert.deepEqual((await cli(['task', 'artifacts', 'show', item.taskId, '--round', item.roundId])).value.manifests, history.get(item.roundId));
        if (item.mode === 'worktree') assert(existsSync(view.git.checkout));
        evidence.cases.push({ taskId: item.taskId, roundId: item.roundId, retention: expected, nativeSessionId: after.native_session_id });
    }
    assert.equal(existsSync(candidate.path), false);
    for (const id of objects) {
        const refs = (await cli(['artifact', 'refs', id])).value.references;
        assert.equal(refs.length, id === protectedId ? 1 : 0);
        if (id === protectedId) assert.equal(refs[0].purpose, 'recovery');
    }
    assert.equal(count(join(paths.hapiServer, 'hapi.db'), 'sessions'), nativeCount);
    assert.equal(count(paths.state, 'delegation_inputs'), inputCount);
    record('explicit discard removes only confirmed failed spool; all historical round pins released, external recovery pin and Git/worktrees unchanged; zero native replay');
    const removedId = [...objects].find(id => id !== protectedId)!;
    const usage = (await cli(['artifact', 'limits'])).value.usedBytes;
    const removed = (await cli(['artifact', 'remove', removedId])).value;
    assert.equal((await cli(['artifact', 'limits'])).value.usedBytes, usage - removed.size);
    assert((await cli(['artifact', 'remove', protectedId], fixture, 1)).stderr.includes('artifact_referenced'));
    await cli(['restart']);
    assert.equal((await cli(['artifact', 'show', removedId])).value.state, 'deleted');
    assert.equal((await cli(['task', 'show', taskId, '--round', roundId])).value.artifacts.retention.state, 'discarded');
    assert((await cli(['task', 'artifacts', 'retry', taskId, '--round', roundId], cwd, 1)).stderr.includes('artifact_retention_released'));
    assert.equal(count(paths.state, 'delegation_inputs'), inputCount);
    record('released objects delete and free quota; release state and immutable history survive service restart');
    evidence.success = true;
} catch (error) { evidence.error = error instanceof Error ? error.message : String(error); process.exitCode = 1; }
finally {
    try { await cli(['stop']); } catch (error) { evidence.cleanupErrors.push(String(error)); }
    if (originalLimit !== undefined) try { await cli(['config', 'set', 'server.artifacts.maxFileMiB', String(originalLimit)]); } catch (error) { evidence.cleanupErrors.push(String(error)); }
    if (evidence.cleanupErrors.length) { evidence.success = false; process.exitCode = 1; }
    evidence.finishedAt = new Date().toISOString(); await writeFile(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(`Evidence: ${join(root, 'evidence.json')}`); if (evidence.error) console.error(evidence.error);
}
