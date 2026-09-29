import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { ArtifactClient } from '../src/artifacts/client';
import { randomUUID, createHash } from 'node:crypto';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { HapiClient } from '../src/hapi';
import { freePort } from '../src/services';
import type { RepositoryOperation } from '../hapi/shared/src/repositories';
import type { ArtifactTransfer } from '../hapi/shared/src/artifactTransfers';
import type { ManagedWorkspace, WorkspaceSource } from '../hapi/shared/src/workspaces';

// Real Hub and two Runner identities/data roots; source paths disappear before import.
const binary = resolve(process.argv[2] ?? 'dist/runweft'), hapiBinary = resolve(process.argv[3] ?? 'dist/hapi');
mkdirSync('.dev-smoke', { recursive: true }); const root = mkdtempSync(resolve('.dev-smoke/repository-result-export-'));
const center = join(root, 'center'), sourceHome = join(root, 'source-runner'), targetHome = join(root, 'target-runner');
const env = { ...process.env }; for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_')) delete env[key];
env.GIT_CONFIG_GLOBAL = '/dev/null'; env.GIT_CONFIG_NOSYSTEM = '1';
const evidence = { root, binary, hapiBinary, startedAt: new Date().toISOString(), finishedAt: '', success: false,
    sourceMachineId: '', targetMachineId: '', exportId: '', importId: '', resultExports: [] as RepositoryOperation[], environments: [] as string[], checks: [] as string[], error: '', cleanupErrors: [] as string[] };
let token: string | undefined, hapi: HapiClient, foreground: ChildProcess | undefined;
const homes: string[] = [];
function cli(home: string, args: string[], input?: string) {
    const result = spawnSync(binary, ['--home', home, '--json', ...args], { env, input, encoding: 'utf8', timeout: 45_000 });
    if (token) assert(!`${result.stdout}${result.stderr}`.includes(token), 'Credential leaked');
    assert.equal(result.status, 0, `${args.slice(0, 2).join(' ')}: ${result.stderr || result.error || result.signal}`); return JSON.parse(result.stdout);
}
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
    return hapi.request(`/api/machines/${machine}/${domain}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
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
    const port = await freePort(), url = `http://127.0.0.1:${port}`;
    cli(center, ['init']); homes.push(center); cli(center, ['config', 'set', 'server.port', String(port)]);
    cli(center, ['config', 'set', 'server.runner', 'false']); cli(center, ['config', 'set', 'hapi.executable', hapiBinary]);
    cli(center, ['config', 'set', 'server.publicUrl', url]); cli(center, ['start']);
    token = JSON.parse(readFileSync(join(center, 'server/hapi/settings.json'), 'utf8')).cliApiToken; assert(token); cli(center, ['stop']);
    const fd = openSync(join(root, 'hub.log'), 'a', 0o600);
    try { foreground = spawn(binary, ['--home', center, 'serve', '--public'], { env, stdio: ['ignore', fd, fd] }); } finally { closeSync(fd); }
    await until(async () => { if (foreground!.exitCode !== null) throw new Error('Hub exited'); return fetch(`${url}/api/runweft/health`).then(r => r.ok).catch(() => false); }, ready => ready);
    hapi = new HapiClient(url, token); assert.equal((await hapi.request('/api/machines')).machines.length, 0);
    for (const home of [sourceHome, targetHome]) {
        cli(home, ['init', '--url', url]); homes.push(home); cli(home, ['config', 'set', 'hapi.executable', hapiBinary]);
        cli(home, ['auth', 'login', '--token-stdin'], token); cli(home, ['start']);
        const machineId = cli(home, ['machine', 'register']).machine.id;
        if (home === sourceHome) evidence.sourceMachineId = machineId; else evidence.targetMachineId = machineId;
    }
    assert.notEqual(evidence.sourceMachineId, evidence.targetMachineId);
    const repo = init(join(root, 'source/project')), child = init(join(root, 'source/child'));
    git(child, 'lfs', 'install', '--local'); writeFileSync(join(child, '.gitattributes'), '*.bin filter=lfs diff=lfs merge=lfs -text\n');
    const content = Buffer.from('REMOTE BASELINE\0'.repeat(4096)), oid = createHash('sha256').update(content).digest('hex'); writeFileSync(join(child, 'asset.bin'), content); commit(child);
    git(repo, 'lfs', 'install', '--local'); writeFileSync(join(repo, '.gitattributes'), '*.bin filter=lfs diff=lfs merge=lfs -text\n');
    writeFileSync(join(repo, 'root.bin'), Buffer.from('initial root entity\0'));
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
    renameSync(join(root, 'source'), join(root, 'source-offline')); cli(sourceHome, ['stop']); assert(!existsSync(repo)); assert(!existsSync(exported.directory));
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
    writeFileSync(join(a.workspace.cwd, 'note'), 'retained checkpoint');
    writeFileSync(join(a.workspace.checkout, 'root.bin'), Buffer.from('new binary result\0'.repeat(2048))); const attemptId = randomUUID();
    await call(evidence.targetMachineId, 'workspaces', { action: 'finalize', environmentId: a.request.environmentId, preparationId: a.request.preparationId, roundId: a.request.roundId, attemptId });
    const sealed = await until(async () => (await call(evidence.targetMachineId, 'workspaces', { action: 'inspect', environmentId: a.request.environmentId })).workspace as ManagedWorkspace,
        item => !['accepted', 'running'].includes(item.operations[`finalize:${a.request.roundId}:${attemptId}`]!.status));
    assert(sealed.results[a.request.roundId], JSON.stringify(sealed.operations));
    assert.equal((await hapi.request('/api/machines')).machines.find((item: any) => item.id === evidence.targetMachineId).runnerState.capabilities.repositoryResults, 1);
    const resultRequest = { action: 'export-result', operationId: randomUUID(), environmentId: a.request.environmentId, roundId: a.request.roundId };
    let dropped = false;
    const proxy = createServer(async (incoming, outgoing) => {
        try {
            const chunks: Buffer[] = []; for await (const chunk of incoming) chunks.push(Buffer.from(chunk)); const body = Buffer.concat(chunks);
            const headers = new Headers(); for (const [key, value] of Object.entries(incoming.headers)) if (value && !['host', 'connection', 'content-length'].includes(key)) headers.set(key, Array.isArray(value) ? value.join(',') : value);
            const response = await fetch(url + incoming.url, { method: incoming.method, headers, body: body.length ? body : undefined });
            const bytes = Buffer.from(await response.arrayBuffer());
            if (incoming.url?.endsWith('/repositories') && body.length && JSON.parse(body.toString()).action === 'export-result' && response.ok) {
                dropped = true; outgoing.socket?.destroy(); outgoing.destroy(); return;
            }
            outgoing.writeHead(response.status, { 'content-type': response.headers.get('content-type') ?? 'application/json' }); outgoing.end(bytes);
        } catch { outgoing.writeHead(502); outgoing.end(); }
    });
    try {
        await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve)); const address = proxy.address(); assert(address && typeof address !== 'string');
        const losing = new HapiClient(`http://127.0.0.1:${address.port}`, token);
        await assert.rejects(() => losing.request(`/api/machines/${evidence.targetMachineId}/repositories`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(resultRequest) }), { code: 'connection_failed' }); assert(dropped);
    } finally { proxy.closeAllConnections(); await new Promise<void>(resolve => proxy.close(() => resolve())); }
    const first = await done<RepositoryOperation>(evidence.targetMachineId, 'repositories', resultRequest.operationId);
    assert.equal(first.status, 'succeeded', JSON.stringify(first.error)); assert.deepEqual(first.sealed!.result, sealed.results[a.request.roundId]); evidence.resultExports.push(first);
    const frozen = readFileSync(join(first.directory, first.snapshot!.repositories[0]!.file));
    cli(targetHome, ['restart']); assert.deepEqual((await call(evidence.targetMachineId, 'repositories', resultRequest)).operation, first);
    const resumed = await prepare(targetSource, sealed); assert.equal(readFileSync(join(resumed.workspace.cwd, 'note'), 'utf8'), 'retained checkpoint');
    writeFileSync(join(resumed.workspace.checkout, 'root.bin'), Buffer.from('partial second binary result\0'.repeat(1024))); rmSync(resumed.workspace.cwd, { recursive: true });
    const finishId = randomUUID(); await call(evidence.targetMachineId, 'workspaces', { action: 'finalize', environmentId: resumed.request.environmentId,
        preparationId: resumed.request.preparationId, roundId: resumed.request.roundId, attemptId: finishId, partial: true });
    const finished = await until(async () => (await call(evidence.targetMachineId, 'workspaces', { action: 'inspect', environmentId: resumed.request.environmentId })).workspace as ManagedWorkspace,
        item => !['accepted', 'running'].includes(item.operations[`finalize:${resumed.request.roundId}:${finishId}`]!.status));
    assert(finished.results[resumed.request.roundId], JSON.stringify(finished.operations));
    const secondRequest = { ...resultRequest, operationId: randomUUID(), roundId: resumed.request.roundId };
    await call(evidence.targetMachineId, 'repositories', secondRequest);
    const second = await done<RepositoryOperation>(evidence.targetMachineId, 'repositories', secondRequest.operationId);
    assert.equal(second.status, 'succeeded', JSON.stringify(second.error)); assert(second.sealed!.result.partial); evidence.resultExports.push(second);
    assert.equal(second.sealed!.result.startHead, first.sealed!.result.resultHead); assert.deepEqual(readFileSync(join(first.directory, first.snapshot!.repositories[0]!.file)), frozen);
    note('actual export-result HTTP response loss and Runner restart return one immutable receipt; the next partial round deletes its task cwd and exports from checkout root without changing the first result');
    const published: Array<{ operation: RepositoryOperation; transfer: ArtifactTransfer }> = [];
    for (const result of evidence.resultExports) {
        const captureId = randomUUID(), deliveryId = randomUUID();
        await call(evidence.targetMachineId, 'artifacts', { action: 'capture', operationId: captureId, cwd: result.directory,
            files: result.snapshot!.files.map(file => ({ name: file.name, relativePath: file.name })) });
        assert.equal((await done<ArtifactTransfer>(evidence.targetMachineId, 'artifacts', captureId)).status, 'succeeded');
        await call(evidence.targetMachineId, 'artifacts', { action: 'deliver', operationId: deliveryId, captureOperationId: captureId,
            files: result.snapshot!.files.map(file => ({ name: file.name, requestId: randomUUID(), reference: { reference: `result-probe:${result.request.operationId}`, purpose: 'recovery' } })) });
        const transfer = await done<ArtifactTransfer>(evidence.targetMachineId, 'artifacts', deliveryId); assert.equal(transfer.status, 'succeeded', JSON.stringify(transfer.error));
        published.push({ operation: result, transfer });
        await call(evidence.targetMachineId, 'artifacts', { action: 'release', operationId: captureId });
        assert.equal((await call(evidence.targetMachineId, 'repositories', { action: 'release', operationId: result.request.operationId })).operation.retention, 'released');
        assert(!existsSync(result.directory));
    }
    const refs = git(targetSource.commonDir, 'show-ref'); assert(refs.includes(first.sealed!.result.resultRef)); assert(refs.includes(second.sealed!.result.resultRef));
    assert.equal((await hapi.request('/api/sessions')).sessions.length, 0); cli(targetHome, ['stop']);
    const workspaceRoot = resolve(targetSource.commonDir, '../../..'); renameSync(workspaceRoot, `${workspaceRoot}-offline`);
    const artifacts = new ArtifactClient(hapi);
    for (const { operation: result, transfer } of published) {
        const directory = join(root, 'downloaded', result.request.operationId); mkdirSync(directory, { recursive: true });
        for (const file of transfer.deliveries!) {
            assert.equal(file.status, 'available'); if (file.status !== 'available') throw new Error('result not published');
            const path = join(directory, file.name), manifest = result.snapshot!.files.find(item => item.name === file.name)!;
            await artifacts.download(file.artifact.id, path); const bytes = readFileSync(path);
            assert.equal(bytes.length, manifest.size); assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.sha256);
        }
        for (const [index, repo] of result.snapshot!.repositories.entries()) {
            const independent = join(directory, `verify-${index}.git`); mkdirSync(independent); git(independent, 'init', '--bare', `--object-format=${repo.objectFormat}`);
            git(independent, 'bundle', 'verify', join(directory, repo.file)); git(independent, 'fetch', '--no-write-fetch-head', join(directory, repo.file), `${repo.bundleRef}:${repo.bundleRef}`);
            assert.equal(git(independent, 'rev-parse', repo.bundleRef), repo.commit); git(independent, 'fsck', '--full', '--no-reflogs', repo.commit);
            if (index === 0) { git(independent, 'merge-base', '--is-ancestor', result.sealed!.result.baseCommit, result.sealed!.result.startHead); git(independent, 'merge-base', '--is-ancestor', result.sealed!.result.startHead, result.sealed!.result.resultHead); }
        }
    }
    note('both source/target Runners are stopped and target Git storage hidden; center downloads restore each full root/module bundle and binary LFS with exact hashes and independent ancestry/fsck checks, without native sessions');
    evidence.success = true;
} catch (error) { evidence.error = error instanceof Error ? error.stack ?? error.message : String(error); process.exitCode = 1; }
finally {
    for (const home of [...homes].reverse()) { try { cli(home, ['stop']); } catch (error) { evidence.cleanupErrors.push(String(error)); } }
    if (foreground?.exitCode === null) { foreground.kill('SIGTERM'); await new Promise<void>(resolve => foreground!.once('exit', () => resolve())); }
    if (evidence.cleanupErrors.length) { evidence.success = false; process.exitCode = 1; }
    evidence.finishedAt = new Date().toISOString(); writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(`Evidence: ${join(root, 'evidence.json')}`); if (evidence.error) console.error(evidence.error);
}
