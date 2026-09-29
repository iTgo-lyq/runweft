import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, open, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { HapiClient } from '../src/hapi';

// Real installed-format binaries and dedicated service homes; no model/session is started.
const binary = resolve(process.argv[2] ?? 'dist/runweft'), hapiBinary = resolve(process.argv[3] ?? 'dist/hapi');
await mkdir('.dev-smoke', { recursive: true });
const root = await mkdtemp(resolve('.dev-smoke/artifact-cli-')), home = join(root, 'local'), hubHome = join(root, 'hub-client');
const evidence = { root, binary, hapiBinary, startedAt: new Date().toISOString(), finishedAt: '', success: false,
    checks: [] as string[], cases: [] as Record<string, unknown>[], cleanupErrors: [] as string[], error: '' };
const env: NodeJS.ProcessEnv = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_')) delete env[key];
let token: string | undefined;
async function cli(selectedHome: string, args: string[], expected = 0) {
    const child = Bun.spawn([binary, '--home', selectedHome, '--json', ...args], { env, stdout: 'pipe', stderr: 'pipe' });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (token) assert(!`${stdout}${stderr}`.includes(token), 'Credential leaked');
    assert.equal(code, expected, `${args.slice(0, 2).join(' ')}: ${stderr}`);
    return { value: stdout.trim() ? JSON.parse(stdout) : null, stderr };
}
async function until<T>(read: () => Promise<T>, accept: (value: T) => boolean, label: string) {
    const deadline = Date.now() + 15_000;
    do { const value = await read(); if (accept(value)) return value; await Bun.sleep(50); } while (Date.now() < deadline);
    throw new Error(`Timed out: ${label}`);
}
const record = (message: string) => { evidence.checks.push(message); console.log(message); };
const socket = createServer(); await new Promise<void>(resolve => socket.listen(0, '127.0.0.1', resolve));
const port = (socket.address() as { port: number }).port; await new Promise<void>(resolve => socket.close(() => resolve()));
try {
    await cli(home, ['init']); await cli(home, ['config', 'set', 'server.port', String(port)]);
    await cli(home, ['config', 'set', 'hapi.executable', hapiBinary]);
    await cli(home, ['config', 'set', 'server.runner', 'false']);
    await cli(home, ['config', 'set', 'server.artifacts.maxFileMiB', '128']);
    await cli(home, ['config', 'set', 'server.artifacts.namespaceQuotaGiB', '1']);
    await cli(home, ['start']);
    const paths = (await cli(home, ['paths'])).value;
    token = JSON.parse(await readFile(join(paths.hapiServer, 'settings.json'), 'utf8')).cliApiToken; assert(token);
    const hapi = new HapiClient(`http://127.0.0.1:${port}`, token);
    assert.equal((await hapi.request('/health')).capabilities.artifacts, 1);
    assert.equal((await hapi.request('/api/sessions')).sessions.length, 0);
    assert.equal((await hapi.request('/api/machines')).machines.length, 0);
    await cli(hubHome, ['init', '--mode', 'hub', '--url', `http://127.0.0.1:${port}`]);
    await cli(hubHome, ['config', 'set', 'hub.tokenEnv', 'ARTIFACT_SMOKE_TOKEN']); env.ARTIFACT_SMOKE_TOKEN = token;
    await cli(hubHome, ['config', 'set', 'server.artifacts.maxFileMiB', '1']);
    const source = join(root, '材料 large.bin'), size = 72 * 1024 * 1024;
    const sourceFile = await open(source, 'w'); await sourceFile.truncate(size); await sourceFile.close();
    const hash = createHash('sha256'), block = Buffer.alloc(256 * 1024);
    for (let offset = 0; offset < size; offset += block.length) hash.update(block);
    const sha256 = hash.digest('hex');
    for (const [mode, selectedHome] of [['local', home], ['hub', hubHome]] as const) {
        const limits = (await cli(selectedHome, ['artifact', 'limits'])).value;
        assert.equal(limits.limits.maxFileBytes, 128 * 1024 * 1024);
        const requestId = randomUUID(), file = (await cli(selectedHome, ['artifact', 'upload', source, '--request-id', requestId])).value;
        assert.equal(file.state, 'available'); assert.equal(file.size, size); assert.equal(file.sha256, sha256);
        assert.equal((await cli(selectedHome, ['artifact', 'lookup', requestId])).value.id, file.id);
        const downloaded = (await cli(selectedHome, ['artifact', 'download', file.id, '--output', join(root, `${mode}.bin`)])).value;
        assert.equal(downloaded.artifact.sha256, sha256); assert.equal((await stat(downloaded.path)).size, size);
        const bytes = await open(downloaded.path, 'r'); const verified = createHash('sha256');
        try { let position = 0; while (true) { const { bytesRead } = await bytes.read(block, 0, block.length, position); if (!bytesRead) break; position += bytesRead; verified.update(block.subarray(0, bytesRead)); } }
        finally { await bytes.close(); }
        assert.equal(verified.digest('hex'), sha256);
        evidence.cases.push({ mode, artifactId: file.id, requestId, size, sha256 });
        record(`${mode}: 72 MiB compiled CLI upload/download through gateway, no agent or Runner, correct hash and server limits`);
    }
    const data = 'abcdef', requestId = randomUUID(), digest = createHash('sha256').update(data).digest('hex');
    const body = { requestId, filename: 'partial.txt', mimeType: 'application/octet-stream', size: data.length, sha256: digest };
    const object = (await hapi.request('/api/artifacts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).artifact;
    const abort = new AbortController();
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(Buffer.from('abc')); } });
    const interrupted = hapi.response(`/api/artifacts/${object.id}/content`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream', 'content-length': '6' }, body: stream, signal: abort.signal })
        .then(() => 'unexpected response', () => 'interrupted');
    const partialPath = join(paths.artifacts, createHash('sha256').update('default').digest('hex'), `${object.id}.part`);
    await until(() => stat(partialPath).then(value => value.size, () => 0), value => value === 3, 'partial bytes actually reached Hub');
    abort.abort(); assert.equal(await interrupted, 'interrupted');
    await until(() => hapi.request(`/api/artifacts/${object.id}`), value => !!value.artifact.error, 'Hub records disconnected upload');
    await writeFile(join(root, 'partial.txt'), data);
    assert.equal((await cli(home, ['artifact', 'upload', join(root, 'partial.txt'), '--request-id', requestId])).value.id, object.id);
    record('real upload disconnect after 3 bytes: same reservation and request ID recover without a replacement');
    const reference = 'smoke:retained', refPath = `/api/artifacts/${object.id}/references/${encodeURIComponent(reference)}`;
    await hapi.request(refPath, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reference, purpose: 'input' }) });
    assert((await cli(home, ['artifact', 'remove', object.id], 1)).stderr.includes('artifact_referenced'));
    await hapi.request(refPath, { method: 'DELETE' });
    assert.equal((await cli(home, ['artifact', 'remove', object.id])).value.state, 'deleted');
    const other = new HapiClient(`http://127.0.0.1:${port}`, `${token}:other`);
    await assert.rejects(() => other.request(`/api/artifacts/${evidence.cases[0]!.artifactId}`), { status: 404 });
    const runnerRead = await fetch(`http://127.0.0.1:${port}/cli/artifacts/${evidence.cases[0]!.artifactId}`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(runnerRead.status, 200); assert.equal((await runnerRead.json() as any).artifact.sha256, sha256);
    record('actual JWT/CLI token routes, namespace rejection, retention protection and deletion tombstone');
    const slowBlock = Buffer.alloc(64 * 1024, 83), slowHash = createHash('sha256');
    for (let index = 0; index < 12; index++) slowHash.update(slowBlock);
    const slow = (await hapi.request('/api/artifacts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        requestId: randomUUID(), filename: 'slow.bin', size: 12 * slowBlock.length, sha256: slowHash.digest('hex'),
    }) })).artifact;
    let slowChunks = 0; const started = Date.now();
    const slowResponse = await hapi.response(`/api/artifacts/${slow.id}/content`, { method: 'PUT',
        headers: { 'content-type': 'application/octet-stream', 'content-length': String(slow.size) }, signal: new AbortController().signal,
        body: new ReadableStream<Uint8Array>({ async pull(controller) {
            if (slowChunks === 12) return controller.close();
            await Bun.sleep(1100); slowChunks++; controller.enqueue(slowBlock);
        } }),
    });
    assert.equal((await slowResponse.json()).artifact.state, 'available'); assert(Date.now() - started > 10_000);
    evidence.cases.push({ mode: 'slow-stream', artifactId: slow.id, elapsedMs: Date.now() - started, size: slow.size });
    record('continuously progressing binary upload exceeds the ordinary 10-second JSON deadline');
    await cli(home, ['restart']);
    assert.equal((await cli(hubHome, ['artifact', 'show', String(evidence.cases[0]!.artifactId)])).value.state, 'available');
    assert.equal((await hapi.request('/api/sessions')).sessions.length, 0);
    record('files survive real service restart; no native session was created');
    evidence.success = true;
} catch (error) { evidence.error = error instanceof Error ? error.message : String(error); process.exitCode = 1; }
finally {
    try { await cli(home, ['stop']); } catch (error) { evidence.cleanupErrors.push(String(error)); }
    if (evidence.cleanupErrors.length) { evidence.success = false; process.exitCode = 1; }
    evidence.finishedAt = new Date().toISOString(); await writeFile(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(`Evidence: ${join(root, 'evidence.json')}`); if (evidence.error) console.error(evidence.error);
}
