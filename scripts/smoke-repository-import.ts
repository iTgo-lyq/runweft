import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { HapiHttp } from '../src/hapi';
import { nativeFileSmoke } from './fixtures/native-file-smoke';
import type { RepositoryOperation } from '../hapi/shared/src/repositories';
import type { ArtifactTransfer } from '../hapi/shared/src/artifactTransfers';
import type { ManagedWorkspace, WorkspaceSource } from '../hapi/shared/src/workspaces';

// Real Hub and two Runner identities/data roots; source paths disappear before import.
const binary = resolve(process.argv[2] ?? 'dist/runweft'), hapiBinary = resolve(process.argv[3] ?? 'dist/hapi');
mkdirSync('.dev-smoke', { recursive: true }); const root = mkdtempSync(resolve('.dev-smoke/repository-import-'));
const env = { ...process.env }; for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_')) delete env[key];
env.GIT_CONFIG_GLOBAL = '/dev/null'; env.GIT_CONFIG_NOSYSTEM = '1';
const evidence = { root, binary, hapiBinary, startedAt: new Date().toISOString(), finishedAt: '', success: false,
    sourceMachineId: '', targetMachineId: '', exportId: '', importId: '', environments: [] as string[], checks: [] as string[], error: '', cleanupErrors: [] as string[] };
let hapi: HapiHttp;
let fixture: Awaited<ReturnType<typeof nativeFileSmoke>> | undefined, sourceScope: Awaited<ReturnType<Awaited<ReturnType<typeof nativeFileSmoke>>['scoped']>>, targetScope: typeof sourceScope;
function git(cwd: string, ...args: string[]) {
    const result = spawnSync('git', ['-C', cwd, ...args], { env: { ...env, GIT_LFS_SKIP_SMUDGE: '1' }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
}
function init(path: string) {
    mkdirSync(path, { recursive: true }); git(path, 'init', '-q'); git(path, 'config', 'user.name', 'Import Smoke');
    git(path, 'config', 'user.email', 'smoke@example.invalid'); git(path, 'config', 'commit.gpgsign', 'false'); return path;
}
function commit(path: string) { git(path, 'add', '.'); git(path, 'commit', '-qm', 'baseline'); }
const note = (message: string) => { evidence.checks.push(message); console.log(message); };
async function call(machine: string, domain: string, body: unknown) {
    return (machine === evidence.sourceMachineId ? sourceScope : targetScope).native.request(`/api/machines/${machine}/${domain}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
async function until<T>(read: () => Promise<T>, complete: (value: T) => boolean): Promise<T> {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) { const item = await read(); if (complete(item)) return item; await Bun.sleep(100); }
    throw new Error('Operation not confirmed before observation deadline');
}
async function done<T extends { status: string }>(machine: string, domain: string, operationId: string): Promise<T> {
    return until(async () => (await call(machine, domain, { action: 'inspect', operationId })).operation as T, item => !['accepted', 'running'].includes(item.status));
}
async function prepare(source: WorkspaceSource, prior?: ManagedWorkspace) {
    const environmentId = prior?.environmentId ?? randomUUID(), preparationId = randomUUID(), roundId = randomUUID();
    const expectedHead = prior ? Object.values(prior.results).at(-1)!.resultHead : source.baseCommit;
    const request = { action: 'prepare', environmentId, preparationId, roundId, source, expectedHead };
    await call(evidence.targetMachineId, 'workspaces', request);
    const workspace = await until(async () => (await call(evidence.targetMachineId, 'workspaces', { action: 'inspect', environmentId })).workspace as ManagedWorkspace,
        item => !['accepted', 'running'].includes(item.operations[`prepare:${preparationId}`]!.status));
    assert.equal(workspace.operations[`prepare:${preparationId}`]!.status, 'succeeded', JSON.stringify(workspace.operations));
    if (!evidence.environments.includes(environmentId)) evidence.environments.push(environmentId);
    return { workspace, request };
}
try {
    fixture = await nativeFileSmoke(root, [binary], hapiBinary, env); Object.assign(evidence, { candidate: fixture.candidate });
    const sourceRunner = await fixture.addRunner(), targetRunner = await fixture.addRunner();
    evidence.sourceMachineId = sourceRunner.machineId; evidence.targetMachineId = targetRunner.machineId; hapi = fixture.http;
    sourceScope = await fixture.scoped(sourceRunner.machineId); targetScope = await fixture.scoped(targetRunner.machineId);
    assert.notEqual(evidence.sourceMachineId, evidence.targetMachineId);
    const repo = init(join(root, 'source/project')), child = init(join(root, 'source/child'));
    git(child, 'lfs', 'install', '--local'); writeFileSync(join(child, '.gitattributes'), '*.bin filter=lfs diff=lfs merge=lfs -text\n');
    const content = Buffer.from('REMOTE BASELINE\0'.repeat(4096)), oid = createHash('sha256').update(content).digest('hex'); writeFileSync(join(child, 'asset.bin'), content); commit(child);
    mkdirSync(join(repo, 'app')); writeFileSync(join(repo, 'app/note'), 'baseline'); commit(repo);
    git(repo, '-c', 'protocol.file.allow=always', 'submodule', 'add', child, 'vendor/module'); commit(repo);
    const module = join(repo, 'vendor/module'), common = git(module, 'rev-parse', '--path-format=absolute', '--git-common-dir');
    const lfsObject = join(common, 'lfs/objects', oid.slice(0, 2), oid.slice(2, 4), oid); mkdirSync(dirname(lfsObject), { recursive: true }); writeFileSync(lfsObject, content);
    const { source } = await call(evidence.sourceMachineId, 'workspaces', { action: 'resolve', cwd: join(repo, 'app'), baseRef: 'HEAD' });
    evidence.exportId = randomUUID(); await call(evidence.sourceMachineId, 'repositories', { action: 'export', operationId: evidence.exportId, source });
    const exported = await done<RepositoryOperation>(evidence.sourceMachineId, 'repositories', evidence.exportId);
    assert.equal(exported.status, 'succeeded', JSON.stringify(exported.error)); assert(exported.snapshot);
    const captureId = randomUUID(), deliveryId = randomUUID();
    await call(evidence.sourceMachineId, 'artifacts', { action: 'capture', operationId: captureId, cwd: exported.directory, files: exported.snapshot.files.map(file => ({ name: file.name, relativePath: file.name })) });
    assert.equal((await done<ArtifactTransfer>(evidence.sourceMachineId, 'artifacts', captureId)).status, 'succeeded');
    await call(evidence.sourceMachineId, 'artifacts', { action: 'deliver', operationId: deliveryId, captureOperationId: captureId,
        files: exported.snapshot.files.map(file => ({ name: file.name, requestId: randomUUID(), reference: { reference: `import-probe:${evidence.exportId}`, purpose: 'recovery' } })) });
    const delivered = await done<ArtifactTransfer>(evidence.sourceMachineId, 'artifacts', deliveryId); assert.equal(delivered.status, 'succeeded', JSON.stringify(delivered.error));
    await call(evidence.sourceMachineId, 'artifacts', { action: 'release', operationId: captureId });
    await call(evidence.sourceMachineId, 'repositories', { action: 'release', operationId: evidence.exportId });
    renameSync(join(root, 'source'), join(root, 'source-offline')); await fixture.stopRunner(sourceRunner); assert(!existsSync(repo)); assert(!existsSync(exported.directory));
    note('Hub without a Runner retains published Git/LFS objects; source paths, export candidates and capture spool are gone and source Runner is stopped');
    const materializeId = randomUUID();
    await call(evidence.targetMachineId, 'artifacts', { action: 'materialize', operationId: materializeId, files: delivered.deliveries!.map(file => {
        assert.equal(file.status, 'available'); if (file.status !== 'available') throw new Error('not delivered');
        return { artifactId: file.artifact.id, name: file.name, size: file.artifact.size, sha256: file.artifact.sha256 };
    }) });
    const materialized = await done<ArtifactTransfer>(evidence.targetMachineId, 'artifacts', materializeId); assert.equal(materialized.status, 'succeeded', JSON.stringify(materialized.error));
    evidence.importId = randomUUID(); const request = { action: 'import', operationId: evidence.importId, snapshot: exported.snapshot, files: materialized.files.map(file => ({ name: file.name, path: file.path })) };
    await call(evidence.targetMachineId, 'repositories', request);
    const imported = await done<RepositoryOperation>(evidence.targetMachineId, 'repositories', evidence.importId); assert.equal(imported.status, 'succeeded', JSON.stringify(imported.error)); assert(imported.imported);
    await call(evidence.targetMachineId, 'artifacts', { action: 'release', operationId: materializeId });
    assert(materialized.files.every(file => !existsSync(file.path))); assert(!existsSync(imported.directory));
    const targetSource = { ...imported.imported.source, relativePath: source.relativePath };
    const [a, b] = await Promise.all([prepare(targetSource), prepare(targetSource)]);
    assert.notEqual(a.workspace.branch, b.workspace.branch); assert.equal(a.workspace.source.commonDir, b.workspace.source.commonDir);
    for (const value of [a, b]) { assert.equal(readFileSync(join(value.workspace.cwd, 'note'), 'utf8'), 'baseline'); assert.deepEqual(readFileSync(join(value.workspace.checkout, 'vendor/module/asset.bin')), content); }
    note('real target RPC imports materialized bytes into one owned cache and prepares two independent worktrees with exact cwd, gitlinks and binary LFS');
    writeFileSync(join(a.workspace.cwd, 'note'), 'retained checkpoint'); const attemptId = randomUUID();
    await call(evidence.targetMachineId, 'workspaces', { action: 'finalize', environmentId: a.request.environmentId, preparationId: a.request.preparationId, roundId: a.request.roundId, attemptId });
    const sealed = await until(async () => (await call(evidence.targetMachineId, 'workspaces', { action: 'inspect', environmentId: a.request.environmentId })).workspace as ManagedWorkspace,
        item => !['accepted', 'running'].includes(item.operations[`finalize:${a.request.roundId}:${attemptId}`]!.status));
    assert(sealed.results[a.request.roundId], JSON.stringify(sealed.operations)); await fixture.stopRunner(targetRunner); await fixture.startRunner(targetRunner);
    assert.deepEqual((await call(evidence.targetMachineId, 'repositories', request)).operation, imported);
    const resumed = await prepare(targetSource, sealed); assert.equal(readFileSync(join(resumed.workspace.cwd, 'note'), 'utf8'), 'retained checkpoint');
    assert.equal(resumed.workspace.preparations[resumed.request.preparationId]!.startHead, sealed.results[a.request.roundId]!.resultHead);
    const finishId = randomUUID(), removeId = randomUUID();
    await call(evidence.targetMachineId, 'workspaces', { action: 'finalize', environmentId: b.request.environmentId, preparationId: b.request.preparationId, roundId: b.request.roundId, attemptId: finishId });
    const finishedB = await until(async () => (await call(evidence.targetMachineId, 'workspaces', { action: 'inspect', environmentId: b.request.environmentId })).workspace as ManagedWorkspace,
        item => !['accepted', 'running'].includes(item.operations[`finalize:${b.request.roundId}:${finishId}`]!.status));
    assert(finishedB.results[b.request.roundId], JSON.stringify(finishedB.operations));
    await call(evidence.targetMachineId, 'workspaces', { action: 'remove', environmentId: b.request.environmentId, attemptId: removeId, expectedHead: targetSource.baseCommit });
    const removed = await until(async () => (await call(evidence.targetMachineId, 'workspaces', { action: 'inspect', environmentId: b.request.environmentId })).workspace as ManagedWorkspace,
        item => !['accepted', 'running'].includes(item.operations[`remove:${removeId}`]!.status));
    assert.equal(removed.status, 'removed', JSON.stringify(removed.operations)); assert(!existsSync(b.workspace.checkout));
    assert.equal(readFileSync(join(resumed.workspace.cwd, 'note'), 'utf8'), 'retained checkpoint');
    assert.equal(git(targetSource.commonDir, 'rev-parse', targetSource.baseRef), targetSource.baseCommit);
    assert.equal((await hapi.request('/api/sessions')).sessions.length, 0);
    note('target restart returns the original import without input files; finalize/prepare retains the previous result, removing the other worktree preserves cache refs, and no native sessions were started');
    evidence.success = true;
} catch (error) { evidence.error = error instanceof Error ? error.stack ?? error.message : String(error); process.exitCode = 1; }
finally {
    try { await fixture?.close(evidence.success); } catch (error) { evidence.cleanupErrors.push(...(error instanceof AggregateError ? error.errors.map(String) : [String(error)])); }
    if (evidence.cleanupErrors.length) { evidence.success = false; process.exitCode = 1; }
    evidence.finishedAt = new Date().toISOString(); writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(`Evidence: ${join(root, 'evidence.json')}`); if (evidence.error) console.error(evidence.error);
}
