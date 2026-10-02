import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { HapiHttp } from '../src/hapi';
import { nativeFileSmoke } from './fixtures/native-file-smoke';
import { closeSmoke } from './fixtures/smoke-lifecycle';
import { ArtifactClient } from '../src/artifacts/client';
import type { RepositoryFile, RepositoryOperation, RepositorySnapshot } from '../hapi/shared/src/repositories';
import type { ArtifactTransfer } from '../hapi/shared/src/artifactTransfers';

// A real Hub/Runner and HTTP response loss. No native agent or global configuration changes.
const binary = resolve(process.argv[2] ?? 'dist/runweft'), hapiBinary = resolve(process.argv[3] ?? 'dist/hapi');
mkdirSync('.dev-smoke', { recursive: true }); const root = mkdtempSync(resolve('.dev-smoke/repository-export-'));
const env = { ...process.env }; for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_')) delete env[key];
const evidence = { root, binary, hapiBinary, startedAt: new Date().toISOString(), finishedAt: '', success: false,
    operationId: randomUUID(), proxyRequests: [] as { path: string; action: string; status: number }[], checks: [] as string[], artifactIds: [] as string[], error: '', cleanupErrors: [] as string[] };
let hapi: HapiHttp | undefined, machineId = '', proxy: ReturnType<typeof createServer> | undefined;
let fixture: Awaited<ReturnType<typeof nativeFileSmoke>> | undefined, scope: Awaited<ReturnType<Awaited<ReturnType<typeof nativeFileSmoke>>['scoped']>>;
function git(cwd: string, ...args: string[]) {
    const result = spawnSync('git', ['-C', cwd, ...args], { env: { ...env, GIT_LFS_SKIP_SMUDGE: '1' }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
}
const note = (message: string) => { evidence.checks.push(message); console.log(message); };
async function call(domain: string, body: unknown, client = scope.native) {
    return await client.request(`/api/machines/${machineId}/${domain}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
async function done<T extends { status: string }>(domain: string, operationId: string): Promise<T> {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
        const item = (await call(domain, { action: 'inspect', operationId })).operation as T;
        if (!['accepted', 'running'].includes(item.status)) return item;
        await Bun.sleep(100);
    }
    throw new Error(`Operation still unconfirmed: ${domain}/${operationId}`);
}
try {
    fixture = await nativeFileSmoke(root, [binary], hapiBinary, env); Object.assign(evidence, { candidate: fixture.candidate });
    const runner = await fixture.addRunner(); machineId = runner.machineId; hapi = fixture.http; const artifacts = new ArtifactClient(hapi);
    scope = await fixture.scoped(machineId);
    const repo = join(root, 'project'); mkdirSync(repo); git(repo, 'init', '-q'); git(repo, 'lfs', 'install', '--local');
    git(repo, 'config', 'user.name', 'Export Smoke'); git(repo, 'config', 'user.email', 'smoke@example.invalid'); git(repo, 'config', 'commit.gpgsign', 'false');
    writeFileSync(join(repo, '.gitattributes'), '*.bin filter=lfs diff=lfs merge=lfs -text\n');
    const content = Buffer.from('BASELINE BINARY\0'.repeat(4096)); writeFileSync(join(repo, 'asset.bin'), content); writeFileSync(join(repo, 'note'), 'BASELINE');
    git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'baseline');
    const { source } = await call('workspaces', { action: 'resolve', cwd: repo, baseRef: 'HEAD' });
    writeFileSync(join(repo, 'note'), 'later commit'); git(repo, 'commit', '-am', 'move branch'); writeFileSync(join(repo, 'untracked'), 'EXCLUDED');
    const refs = git(repo, 'show-ref'), index = readFileSync(join(repo, '.git/index')), config = readFileSync(join(repo, '.git/config'));
    let dropped = false;
    proxy = createServer(async (request, response) => {
        try {
            const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk)); const body = Buffer.concat(chunks);
            const headers = new Headers(); for (const [name, value] of Object.entries(request.headers)) if (value && !['host', 'connection', 'content-length'].includes(name)) headers.set(name, Array.isArray(value) ? value.join(',') : value);
            const upstream = await fetch(fixture!.nativeUrl + request.url, { method: request.method, headers, body: body.length ? body : undefined });
            const bytes = Buffer.from(await upstream.arrayBuffer());
            evidence.proxyRequests.push({ path: request.url ?? '', action: body.length ? JSON.parse(body.toString()).action ?? 'auth' : '', status: upstream.status });
            if (request.url?.endsWith('/repositories') && body.length && JSON.parse(body.toString()).action === 'export' && upstream.ok) { dropped = true; response.socket?.destroy(); response.destroy(); return; }
            response.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' }); response.end(bytes);
        } catch { response.writeHead(502); response.end(); }
    });
    await new Promise<void>(resolve => proxy!.listen(0, '127.0.0.1', resolve)); const address = proxy.address(); assert(address && typeof address !== 'string');
    const losing = fixture.losingNative(scope.native, `http://127.0.0.1:${address.port}`), request = { action: 'export', operationId: evidence.operationId, source };
    await assert.rejects(() => call('repositories', request, losing), { code: 'connection_failed' }); assert(dropped);
    const exported = await done<RepositoryOperation>('repositories', evidence.operationId); assert.equal(exported.status, 'succeeded', JSON.stringify(exported.error)); assert(exported.snapshot);
    assert.equal(exported.snapshot.baseCommit, source.baseCommit); assert.equal(git(repo, 'show-ref'), refs); assert.deepEqual(readFileSync(join(repo, '.git/index')), index); assert.deepEqual(readFileSync(join(repo, '.git/config')), config);
    await fixture.restart(); assert.deepEqual((await call('repositories', request)).operation, exported);
    note('actual HTTP response loss recovers the same fixed export after Hub/Runner restart; source branch/index/config remain unchanged');
    const captureId = randomUUID(); await call('artifacts', { action: 'capture', operationId: captureId, cwd: exported.directory, files: exported.snapshot.files.map(file => ({ name: file.name, relativePath: file.name })) });
    assert.equal((await done<ArtifactTransfer>('artifacts', captureId)).status, 'succeeded');
    const deliveryId = randomUUID(); await call('artifacts', { action: 'deliver', operationId: deliveryId, captureOperationId: captureId,
        files: exported.snapshot.files.map(file => ({ name: file.name, requestId: randomUUID(), reference: { reference: `repository-probe:${evidence.operationId}`, purpose: 'recovery' } })) });
    const delivered = await done<ArtifactTransfer>('artifacts', deliveryId); assert.equal(delivered.status, 'succeeded', JSON.stringify(delivered.error));
    await call('artifacts', { action: 'release', operationId: captureId });
    assert.equal((await call('repositories', { action: 'release', operationId: evidence.operationId })).operation.retention, 'released'); assert(!existsSync(exported.directory));
    renameSync(repo, `${repo}-offline`); const verify = join(root, 'verify.git'); mkdirSync(verify); git(verify, 'init', '--bare');
    for (const file of delivered.deliveries ?? []) {
        assert.equal(file.status, 'available'); if (file.status !== 'available') continue;
        evidence.artifactIds.push(file.artifact.id); const path = join(root, file.name); await artifacts.download(file.artifact.id, path);
        const manifest: RepositoryFile | undefined = exported.snapshot.files.find(item => item.name === file.name); assert(manifest); assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'), manifest.sha256);
        if (manifest.kind === 'bundle') { const item: RepositorySnapshot['repositories'][number] = exported.snapshot.repositories.find(item => item.file === file.name)!; git(verify, 'fetch', path, `${item.bundleRef}:${item.bundleRef}`); assert.equal(git(verify, 'rev-parse', item.bundleRef), source.baseCommit); git(verify, 'fsck', '--full', '--no-reflogs', source.baseCommit); }
        else assert.deepEqual(readFileSync(path), content);
    }
    assert.equal((await hapi.request('/api/sessions')).sessions.length, 0);
    note('existing capture/deliver publishes bundle and LFS recovery objects; source/export/spool removal does not prevent independent center download and Git import');
    evidence.success = true;
} catch (error) { evidence.error = error instanceof Error ? error.stack ?? error.message : String(error); process.exitCode = 1; }
finally {
    try { await closeSmoke([() => fixture?.close(evidence.success), async () => { if (proxy) { proxy.closeAllConnections(); await new Promise<void>(resolve => proxy!.close(() => resolve())); } }]); }
    catch (error) { evidence.cleanupErrors.push(...(error instanceof AggregateError ? error.errors.map(String) : [String(error)])); }
    if (evidence.cleanupErrors.length) { evidence.success = false; process.exitCode = 1; }
    evidence.finishedAt = new Date().toISOString(); writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(`Evidence: ${join(root, 'evidence.json')}`); if (evidence.error) console.error(evidence.error);
}
