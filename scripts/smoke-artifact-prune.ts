import assert from 'node:assert/strict';
import { Database } from 'bun:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { HapiClient } from '../src/hapi';
import { freePort } from '../src/services';
import type { Artifact } from '../hapi/shared/src/artifacts';

const binary = resolve(process.argv[2] ?? 'dist/runweft'), hapiBinary = resolve(process.argv[3] ?? 'dist/hapi');
await mkdir('.dev-smoke', { recursive: true });
const root = await mkdtemp(resolve('.dev-smoke/artifact-prune-')), home = join(root, 'local'), remote = join(root, 'hub-client');
const evidence = { root, binary, startedAt: new Date().toISOString(), finishedAt: '', success: false, checks: [] as string[], cleanupErrors: [] as string[], error: '' };
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_')) delete env[key];
let token = '', proxy: ReturnType<typeof Bun.serve> | undefined;
async function cli(selectedHome: string, args: string[], expected = 0) {
    const child = Bun.spawn([binary, '--home', selectedHome, '--json', ...args], { env, stdout: 'pipe', stderr: 'pipe' });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (token) assert(!`${stdout}${stderr}`.includes(token), 'Credential leaked');
    assert.equal(code, expected, `${args.slice(0, 2).join(' ')}: ${stderr}`);
    return { value: stdout.trim() ? JSON.parse(stdout) : null, stderr };
}
const record = (value: string) => { evidence.checks.push(value); console.log(value); };
try {
    const port = await freePort(), url = `http://127.0.0.1:${port}`;
    await cli(home, ['init']); await cli(home, ['config', 'set', 'server.port', String(port)]);
    await cli(home, ['config', 'set', 'hapi.executable', hapiBinary]); await cli(home, ['config', 'set', 'server.runner', 'false']);
    await cli(home, ['config', 'set', 'server.artifacts.unreferencedDays', '1']);
    await cli(home, ['config', 'set', 'server.artifacts.pendingHours', '1']); await cli(home, ['start']);
    const paths = (await cli(home, ['paths'])).value;
    token = JSON.parse(await readFile(join(paths.hapiServer, 'settings.json'), 'utf8')).cliApiToken; assert(token);
    const hapi = new HapiClient(url, token);
    let losePruneResponse = false;
    proxy = Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(request) {
        const input = new URL(request.url);
        const response = await fetch(new Request(`${url}${input.pathname}${input.search}`, request));
        if (losePruneResponse && input.pathname === '/api/artifacts/prune' && request.method === 'POST') {
            losePruneResponse = false; await response.arrayBuffer();
            return new Response('Injected lost cleanup response', { status: 502 });
        }
        const headers = new Headers(response.headers);
        // fetch already decodes compressed upstream responses; do not describe decoded bytes as gzip.
        headers.delete('content-encoding'); headers.delete('content-length');
        return new Response(response.body, { status: response.status, headers });
    } });
    await cli(remote, ['init', '--mode', 'hub', '--url', `http://127.0.0.1:${proxy.port}`]);
    await cli(remote, ['config', 'set', 'hub.tokenEnv', 'ARTIFACT_PRUNE_SMOKE_TOKEN']); env.ARTIFACT_PRUNE_SMOKE_TOKEN = token;
    await cli(remote, ['config', 'set', 'server.artifacts.unreferencedDays', '99']);
    const source = join(root, 'report.txt'); await writeFile(source, 'retained file bytes');
    const pinned: Artifact[] = [], expiring: Artifact[] = [];
    for (const purpose of ['input', 'output', 'recovery', 'external', null, null]) {
        const file = (await cli(home, ['artifact', 'upload', source])).value as Artifact;
        if (purpose) {
            const reference = `smoke:${purpose}`;
            await hapi.request(`/api/artifacts/${file.id}/references/${reference}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reference, purpose }) });
            pinned.push(file);
        } else expiring.push(file);
    }
    const pending = (await hapi.request('/api/artifacts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        requestId: randomUUID(), filename: 'pending.txt', size: 7, sha256: createHash('sha256').update('pending').digest('hex'),
    }) })).artifact as Artifact;
    expiring.push(pending);
    await cli(home, ['stop']);
    // Test data only: age isolated objects while their owning service is stopped.
    const db = new Database(join(paths.hapiServer, 'hapi.db'));
    db.query('UPDATE artifacts SET created_at=?,published_at=CASE WHEN published_at IS NULL THEN NULL ELSE ? END')
        .run(Date.now() - 2 * 86400000, Date.now() - 2 * 86400000); db.close();
    await cli(home, ['start']);
    const recent = (await cli(home, ['artifact', 'upload', source])).value as Artifact;
    const preview = (await cli(home, ['artifact', 'prune'])).value;
    assert.equal(preview.applied, false); assert.deepEqual(preview.candidates.map((file: Artifact) => file.id).sort(), expiring.map(file => file.id).sort());
    assert.equal(preview.deleted.length, 0);
    assert.deepEqual((await cli(remote, ['artifact', 'prune'])).value.candidates, preview.candidates);
    const limits = (await cli(remote, ['artifact', 'limits'])).value;
    assert.equal(limits.limits.unreferencedDays, 1); assert.equal(limits.usage.referencedCount, 4);
    assert.equal(limits.usage.referencedBytes, pinned.reduce((sum, file) => sum + file.size, 0));
    const doctor = (await cli(home, ['doctor'])).value;
    const storage = doctor.checks.find((check: any) => check.name === 'artifacts');
    assert(storage.ok); assert.equal(storage.detail.hostedStorage, paths.artifacts); assert.equal(storage.detail.localTransfers, paths.artifactTransfers);
    record('compiled local/Hub preview agrees after real service restart; server policy and doctor usage/paths are authoritative');
    losePruneResponse = true;
    assert((await cli(remote, ['artifact', 'prune', '--apply', '--limit', '1'], 1)).stderr.includes('502'));
    const first = [...expiring].sort((left, right) => left.id.localeCompare(right.id))[0]!;
    assert.equal((await cli(home, ['artifact', 'lookup', first.requestId])).value.state, 'deleted');
    record('real HTTP proxy loses cleanup response after deletion; original request lookup confirms the tombstone');
    let cursor: string | null | undefined;
    do {
        const result = (await cli(remote, ['artifact', 'prune', '--apply', '--limit', '1', ...(cursor ? ['--after', cursor] : [])])).value;
        assert.equal(result.failures.length, 0); cursor = result.nextCursor;
    } while (cursor);
    for (const file of expiring) assert.equal((await cli(home, ['artifact', 'show', file.id])).value.state, 'deleted');
    for (const file of pinned) {
        assert.equal((await cli(home, ['artifact', 'show', file.id])).value.state, 'available');
        assert.equal((await cli(home, ['artifact', 'refs', file.id])).value.references.length, 1);
    }
    assert.equal((await cli(home, ['artifact', 'show', recent.id])).value.state, 'available');
    const final = (await cli(home, ['artifact', 'limits'])).value;
    assert.equal(final.usedBytes, pinned.reduce((sum, file) => sum + file.size, recent.size));
    await cli(home, ['restart']);
    assert.equal((await cli(remote, ['artifact', 'prune', '--apply'])).value.deleted.length, 0);
    const download = join(root, 'protected-download.txt');
    await cli(remote, ['artifact', 'download', pinned[0]!.id, '--output', download]);
    assert.equal(await readFile(download, 'utf8'), 'retained file bytes');
    const other = new HapiClient(url, `${token}:other`);
    assert.equal((await other.request('/api/artifacts/prune', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).candidates.length, 0);
    assert.equal((await hapi.request('/api/sessions')).sessions.length, 0);
    record('apply pagination frees quota, preserves input/output/recovery/external pins and recent files; tombstones survive restart; zero agents');
    evidence.success = true;
} catch (error) { evidence.error = error instanceof Error ? error.message : String(error); process.exitCode = 1; }
finally {
    try { await cli(home, ['stop']); } catch (error) { evidence.cleanupErrors.push(String(error)); }
    try { await proxy?.stop(true); } catch (error) { evidence.cleanupErrors.push(String(error)); }
    if (evidence.cleanupErrors.length) { evidence.success = false; process.exitCode = 1; }
    evidence.finishedAt = new Date().toISOString(); await writeFile(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(`Evidence: ${join(root, 'evidence.json')}`); if (evidence.error) console.error(evidence.error);
}
