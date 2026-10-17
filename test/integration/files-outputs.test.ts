import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { open, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { HapiHttp } from '../../src/hapi';
import { nativeFileSmoke } from './native-files';
import { ArtifactClient } from '../../src/artifacts/client';
import type { ArtifactTransfer, ArtifactTransferRequest, CaptureRequest, DeliverRequest } from '../../hapi/shared/src/artifactTransfers';
import pkg from '../../package.json';
import { afterEach, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { rmSync as removeRoot } from 'node:fs';
import { integrationBinaries } from './binaries';

let closeOwned: () => Promise<void> = async () => {};
afterEach(() => closeOwned());

test('files-outputs real integration', async () => {
    integrationBinaries();
    const binary = integrationBinaries().runweft.path, hapiBinary = integrationBinaries().hapi.path;
    const root = mkdtempSync(join(tmpdir(), 'runweft-outputs-machine-'));
    const cwd = join(root, 'project'); mkdirSync(cwd);
    const env = { ...process.env }; for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_')) delete env[key];
    const evidence = { root, binary, hapiRevision: pkg.hapi.revision, startedAt: new Date().toISOString(), finishedAt: '', success: false,
        checks: [] as string[], artifactIds: [] as string[], error: '', cleanupErrors: [] as string[] };
    let hapi: HapiHttp, machineId = '';
    let fixture: Awaited<ReturnType<typeof nativeFileSmoke>> | undefined, scope: Awaited<ReturnType<Awaited<ReturnType<typeof nativeFileSmoke>>['scoped']>>;
    const record = (message: string) => { evidence.checks.push(message); console.log(message); };
    async function transfer(body: ArtifactTransferRequest): Promise<ArtifactTransfer> {
        return (await scope.native.request(`/api/machines/${machineId}/artifacts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).operation;
    }
    async function terminal(id: string) {
        const deadline = Date.now() + 120_000;
        while (Date.now() < deadline) {
            const result = await transfer({ action: 'inspect', operationId: id });
            if (!['accepted', 'running'].includes(result.status)) return result;
            await Bun.sleep(100);
        }
        throw new Error(`Unconfirmed file operation: ${id}`);
    }

    let closing: Promise<void> | undefined;
    closeOwned = () => closing ??= (async () => {
        try { await fixture?.close(evidence.success); } catch (error) { evidence.cleanupErrors.push(...(error instanceof AggregateError ? error.errors.map(String) : [String(error)])); }
        if (evidence.cleanupErrors.length) { evidence.success = false;  }
        evidence.finishedAt = new Date().toISOString(); writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
        console.log(`Evidence: ${join(root, 'evidence.json')}`); if (evidence.error) console.error(evidence.error);

        if (evidence.cleanupErrors?.length) throw new AggregateError(evidence.cleanupErrors, 'Integration cleanup failed');
        if (evidence.success) removeRoot(root, { recursive: true, force: true });
    })();
    try {
        env.HAPI_ARTIFACT_MAX_FILE_BYTES = String(1024 * 1024);
        fixture = await nativeFileSmoke(root, [binary], hapiBinary, env); Object.assign(evidence, { candidate: fixture.candidate });
        const runner = await fixture.addRunner(); machineId = runner.machineId;
        scope = await fixture.scoped(machineId, cwd); hapi = fixture.http; const artifacts = new ArtifactClient(hapi);
        writeFileSync(join(cwd, '报告.txt'), 'ORIGINAL OUTPUT'); const large = await open(join(cwd, '大文件.bin'), 'w'); await large.truncate(72 * 1024 * 1024); await large.close();
        const capture: CaptureRequest = { action: 'capture', operationId: randomUUID(), cwd, files: ['报告.txt', '大文件.bin', '遗漏.txt'].map(name => ({ name, relativePath: name })) };
        assert.equal((await transfer(capture)).status, 'accepted'); const captured = await terminal(capture.operationId);
        assert.equal(captured.status, 'failed'); assert.deepEqual(captured.candidates?.map(file => file.status), ['captured', 'captured', 'failed']);
        const delivery: DeliverRequest = { action: 'deliver', operationId: randomUUID(), captureOperationId: capture.operationId,
            files: capture.files.slice(0, 2).map(file => ({ name: file.name, requestId: randomUUID(), reference: { reference: `smoke:${randomUUID()}`, purpose: 'output' } })) };
        await transfer(delivery); const partial = await terminal(delivery.operationId); assert.equal(partial.status, 'failed');
        assert.deepEqual(partial.deliveries?.map(file => file.status), ['available', 'failed']);
        const small = partial.deliveries![0]!; assert(small.status === 'available');
        assert.equal((await artifacts.show(small.artifact.id)).state, 'available'); await assert.rejects(() => artifacts.remove(small.artifact.id), { code: 'artifact_referenced' });
        await transfer({ action: 'release', operationId: capture.operationId, names: ['报告.txt'] });
        const retained = await transfer({ action: 'inspect', operationId: capture.operationId }); assert.equal(retained.retention, 'retained');
        assert(retained.candidates?.[0]?.status === 'captured'); assert.equal(retained.candidates[0].retention, 'released'); assert(!existsSync(retained.candidates[0].path));
        writeFileSync(join(cwd, '报告.txt'), 'CHANGED'); writeFileSync(join(cwd, '遗漏.txt'), 'LATE OUTPUT');
        assert.deepEqual((await transfer(capture)).candidates?.map(file => file.status), ['captured', 'captured', 'failed']);
        record('real capture reports missing files; small output remains downloadable and pinned when the large output exceeds the Hub limit');
        const collect: CaptureRequest = { action: 'capture', operationId: randomUUID(), cwd, files: [{ name: '遗漏.txt', relativePath: '遗漏.txt' }] };
        await transfer(collect); assert.equal((await terminal(collect.operationId)).status, 'succeeded');
        await rm(cwd, { recursive: true }); env.HAPI_ARTIFACT_MAX_FILE_BYTES = String(128 * 1024 * 1024); await fixture.restart();
        assert.equal((await transfer({ action: 'inspect', operationId: capture.operationId })).retention, 'retained');
        await transfer(delivery); const completed = await terminal(delivery.operationId); assert.equal(completed.status, 'succeeded', JSON.stringify(completed));
        for (const item of completed.deliveries!) {
            assert(item.status === 'available'); evidence.artifactIds.push(item.artifact.id);
            assert.equal((await artifacts.refs(item.artifact.id)).references.length, 1);
        }
        assert(completed.deliveries?.[0]?.status === 'available'); assert.equal(completed.deliveries[0].artifact.id, small.artifact.id);
        const late: DeliverRequest = { action: 'deliver', operationId: randomUUID(), captureOperationId: collect.operationId,
            files: [{ name: '遗漏.txt', requestId: randomUUID(), reference: { reference: `smoke:${randomUUID()}`, purpose: 'output' } }] };
        await transfer(late); assert.equal((await terminal(late.operationId)).status, 'succeeded');
        await transfer({ action: 'release', operationId: capture.operationId }); await transfer({ action: 'release', operationId: collect.operationId });
        assert.equal((await transfer({ action: 'inspect', operationId: capture.operationId })).retention, 'released');
        assert.equal((await hapi.request('/api/sessions')).sessions.length, 0);
        record('after Hub/Runner restart and source removal, identical delivery recovers the original small object and uploads the fixed 72 MiB candidate');
        await fixture.stopRunner(runner);
        for (const item of completed.deliveries!) {
            assert(item.status === 'available'); const output = join(root, `download-${item.name}`);
            await artifacts.download(item.artifact.id, output); const hash = createHash('sha256'); for await (const chunk of Bun.file(output).stream()) hash.update(chunk);
            assert.equal(hash.digest('hex'), item.artifact.sha256); if (item.name === '报告.txt') assert.equal(readFileSync(output, 'utf8'), 'ORIGINAL OUTPUT');
        }
        record('Runner stopped: published outputs download from the Hub with matching SHA-256; successful spool removed; no native sessions created');
        evidence.success = true;
    } catch (error) { evidence.error = error instanceof Error ? error.stack ?? error.message : String(error); throw error; }
    finally { await closeOwned(); }
}, 120000);
