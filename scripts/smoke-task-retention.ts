import { validateState } from '../src/state';
import assert from 'node:assert/strict';
import { Database } from 'bun:sqlite';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { HubClient } from '../src/hub/client';
import { taskCaptureReceipt } from './fixtures/task-capture-receipt';
import { closeSmoke } from './fixtures/smoke-lifecycle';
import { installedBinaries } from './fixtures/installed-binaries.mjs';
import { hubConnectionPaths } from '../src/hub/resources/connection';
import { loadConfig } from '../src/config';
import { removeFileSmokeData } from './fixtures/native-file-smoke';
import pkg from '../package.json';

// Consumes a completed dedicated output-smoke fixture. Starts no new native task.
// Assert release preserves current Git/worktree/history; then the sole final consumer reclaims this disposable fixture.
const source = resolve(process.argv[2] ?? '');
assert(source.startsWith(resolve('.dev-smoke/task-outputs-')) && source.endsWith('/evidence.json'), 'Pass a dedicated task-outputs evidence.json');
const previous = JSON.parse(readFileSync(source, 'utf8'));
assert(previous.evidenceFormat === 'current-task-outputs-1' && previous.success && previous.cleanupErrors.length === 0 && previous.cases.length === 8, 'Require a completed eight-round native fixture');
const fixture = dirname(source), handoff = previous.handoff, home: string = handoff.clientHome, serverHome: string = handoff.serverHome, binary = resolve(process.argv[3] ?? previous.candidate.cliBinary);
assert(home.startsWith(fixture + '/') && serverHome.startsWith(fixture + '/') && handoff.runnerNativeHome.startsWith(fixture + '/'));
const binaries = installedBinaries(binary); assert.equal(binaries.runweft.sha256, previous.candidate.hashes.cli); assert.equal(binaries.hapi.sha256, previous.candidate.hashes.hapi);
validateState(handoff.serverPaths.state);
assert.equal(new Set(previous.cases.map((c: any) => `${c.agent}/${c.mode}/${c.round}`)).size, 8);
assert.equal(new Set(previous.cases.map((c: any) => c.taskId)).size, 4);
await mkdir('.dev-smoke', { recursive: true }); const root = await mkdtemp(resolve('.dev-smoke/task-retention-'));
const env: NodeJS.ProcessEnv = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_') || key.startsWith('HAPI_') || ['CLI_API_TOKEN', 'DB_PATH', 'TELEGRAM_BOT_TOKEN'].includes(key)) delete env[key];
Object.assign(env, { CODEX_HOME: join(fixture, 'codex-home'), CLAUDE_CONFIG_DIR: join(fixture, 'claude-home'), GIT_CEILING_DIRECTORIES: fixture });
const connection = hubConnectionPaths(home, handoff.url), credentialValues = new Set<string>([JSON.parse(readFileSync(connection.identityConnection, 'utf8')).token, JSON.parse(readFileSync(connection.machineConnection, 'utf8')).active.token]);
let originalLimit: number | undefined;
const evidence = { root, source, binary, hapiRevision: pkg.hapi.revision, startedAt: new Date().toISOString(), finishedAt: '', success: false,
    checks: [] as string[], cases: [] as Record<string, unknown>[], cleanupErrors: [] as string[], error: '' };
async function cli(args: string[], cwd = fixture, expected = 0, selectedHome = home) {
    const child = Bun.spawn([binary, '--home', selectedHome, '--json', ...args], { env, cwd, stdout: 'pipe', stderr: 'pipe' });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    for (const secret of credentialValues) assert(!(stdout + stderr).includes(secret), 'Credential leaked');
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
    const config = loadConfig(serverHome, env); originalLimit = config.config.server.artifacts.maxFileMiB;
    await cli(['config', 'set', 'hapi.executable', binaries.hapi.path], fixture, 0, serverHome);
    await cli(['config', 'set', 'server.artifacts.maxFileMiB', '1'], fixture, 0, serverHome); await cli(['start'], fixture, 0, serverHome);
    await cli(['runner', 'start']);
    await until(async () => { try { return (await cli(['machine', 'discover', handoff.machineId])).value; } catch { return null; } }, value => value?.tools.length === 2, 'actual restored Runner RPC');
    const paths = (await cli(['paths'], fixture, 0, serverHome)).value;
    assert.equal(paths.state, handoff.serverPaths.state); assert.equal(paths.hapiServer, handoff.serverPaths.hapiServer);
    const hapi = new HubClient({ url: handoff.url, home, env, space: handoff.spaceId }, 'hubAccess', 'unavailable').http;
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
    const selected = before.find(({ item }) => item.agent === 'codex' && item.mode === 'shared' && item.round === 0)!, taskId = selected.item.taskId, roundId = selected.item.roundId, cwd = selected.view.parent.cwd;
    const originalManifest = selected.view.artifacts.manifest;
    const protectedId = originalManifest.items.find((item: any) => item.status === 'available').artifactId;
    const reference = 'retention-smoke:external-recovery';
    await hapi.request(`/api/artifacts/${protectedId}/references/${reference}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reference, purpose: 'recovery' }) });
    await cli(['task', 'artifacts', 'collect', taskId, '--round', roundId, '--path', 'discard-me.txt=large.txt', '--request-id', randomUUID()], cwd);
    const incomplete = await until(async () => (await cli(['task', 'show', taskId, '--round', roundId], cwd)).value,
        value => value.artifacts.manifest.version === originalManifest.version + 1 && !value.artifacts.pending.length, 'fixed candidate rejected by configured file limit');
    const pending = incomplete.artifacts.manifest.items.find((item: any) => item.name === 'discard-me.txt');
    assert.equal(pending.status, 'failed'); assert(pending.captureOperationId); assert.equal(incomplete.status, 'completed');
    const { candidate, receipt } = taskCaptureReceipt(fixture, handoff.runnerNativeHome, incomplete.cwd, pending);
    assert.equal(candidate.retention, 'retained'); assert.equal(receipt.retention, 'retained'); assert(existsSync(candidate.path));
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
        evidence.cases.push({ history: { completedRevision: view.completed_revision, reportSha256: createHash('sha256').update(view.report.text).digest('hex'), git: view.git, manifestsBefore: history.get(item.roundId), manifestsAfter: (await cli(['task', 'artifacts', 'show', item.taskId, '--round', item.roundId])).value.manifests }, taskId: item.taskId, roundId: item.roundId, retention: expected, nativeSessionId: after.native_session_id });
    }
    const released = taskCaptureReceipt(fixture, handoff.runnerNativeHome, incomplete.cwd, pending);
    assert.equal(released.candidate.retention, 'released'); assert.equal(existsSync(candidate.path), false);
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
    await cli(['restart'], fixture, 0, serverHome);
    await until(async () => { try { return (await cli(['machine', 'discover', handoff.machineId])).value; } catch { return null; } }, value => value?.tools.length === 2, 'Runner reconnect after restart');
    assert.equal((await cli(['artifact', 'show', removedId])).value.state, 'deleted');
    assert.equal((await cli(['task', 'show', taskId, '--round', roundId])).value.artifacts.retention.state, 'discarded');
    assert((await cli(['task', 'artifacts', 'retry', taskId, '--round', roundId], cwd, 1)).stderr.includes('artifact_retention_released'));
    assert.equal(count(paths.state, 'delegation_inputs'), inputCount);
    record('released objects delete and free quota; release state and immutable history survive service restart');
    evidence.success = true;
} catch (error) { evidence.error = error instanceof Error ? error.message : String(error); process.exitCode = 1; }
finally {
    let stopped = true;
    try { await cli(['runner', 'stop']); } catch (error) { stopped = false; evidence.cleanupErrors.push(String(error)); }
    try { await cli(['stop'], fixture, 0, serverHome); } catch (error) { stopped = false; evidence.cleanupErrors.push(String(error)); }
    if (originalLimit !== undefined) try { await cli(['config', 'set', 'server.artifacts.maxFileMiB', String(originalLimit)], fixture, 0, serverHome); } catch (error) { evidence.cleanupErrors.push(String(error)); }
    try { assert.equal((await cli(['status'])).value.runner.running, false); assert.equal((await cli(['status'], fixture, 0, serverHome)).value.service.running, false); }
    catch (error) { stopped = false; evidence.cleanupErrors.push(String(error)); }
    if (stopped) try {
        await closeSmoke([handoff.identityFile, connection.identityConnection, connection.machineConnection, join(handoff.runnerNativeHome, 'settings.json'), join(handoff.serverPaths.hapiServer, 'settings.json'), join(handoff.serverPaths.hapiServer, 'jwt-secret.json')]
            .map(path => () => rmSync(path, { force: true })));
    } catch (error) { evidence.cleanupErrors.push(String(error)); }
    if (evidence.success && stopped && !evidence.cleanupErrors.length) try { await removeFileSmokeData(fixture); } catch (error) { evidence.cleanupErrors.push(String(error)); }
    if (evidence.cleanupErrors.length) { evidence.success = false; process.exitCode = 1; }
    evidence.finishedAt = new Date().toISOString(); await writeFile(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(`Evidence: ${join(root, 'evidence.json')}`); if (evidence.error) console.error(evidence.error);
}
