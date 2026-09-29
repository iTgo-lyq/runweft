import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { open, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { freePort } from '../src/services';
import { HapiClient } from '../src/hapi';
import { ArtifactClient } from '../src/artifacts/client';
import type { ArtifactTransfer, ArtifactTransferRequest, CaptureRequest, DeliverRequest } from '../hapi/shared/src/artifactTransfers';
import pkg from '../package.json';

// Real compiled Hub and independent Runner. No native agent or user configuration is touched.
const binary = resolve(process.argv[2] ?? 'dist/runweft'), hapiBinary = resolve(process.argv[3] ?? 'dist/hapi');
mkdirSync('.dev-smoke', { recursive: true }); const root = mkdtempSync(resolve('.dev-smoke/outputs-machine-'));
const home = join(root, 'hub'), runnerHome = join(root, 'runner'), cwd = join(root, 'project'); mkdirSync(cwd);
const env = { ...process.env }; for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_')) delete env[key];
const evidence = { root, binary, hapiRevision: pkg.hapi.revision, startedAt: new Date().toISOString(), finishedAt: '', success: false,
    checks: [] as string[], artifactIds: [] as string[], error: '', cleanupErrors: [] as string[] };
let token: string | undefined, hapi: HapiClient, machineId = '';
function cli(selectedHome: string, args: string[]) {
    const result = spawnSync(binary, ['--home', selectedHome, '--json', ...args], { env, encoding: 'utf8', timeout: 45_000 });
    if (token) assert(!`${result.stdout}${result.stderr}`.includes(token), 'Credential leaked');
    assert.equal(result.status, 0, `${args.slice(0, 2).join(' ')}: ${result.stderr || result.error || result.signal}`);
    return JSON.parse(result.stdout);
}
const record = (message: string) => { evidence.checks.push(message); console.log(message); };
async function transfer(body: ArtifactTransferRequest): Promise<ArtifactTransfer> {
    return (await hapi.request(`/api/machines/${machineId}/artifacts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).operation;
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
try {
    cli(home, ['init']); cli(home, ['config', 'set', 'server.port', String(await freePort())]); cli(home, ['config', 'set', 'hapi.executable', hapiBinary]);
    cli(home, ['config', 'set', 'server.runner', 'false']); cli(home, ['config', 'set', 'server.artifacts.maxFileMiB', '1']);
    const start = cli(home, ['start']); token = JSON.parse(readFileSync(join(home, 'server/hapi/settings.json'), 'utf8')).cliApiToken; assert(token);
    hapi = new HapiClient(start.url, token); const artifacts = new ArtifactClient(hapi);
    cli(runnerHome, ['init', '--mode', 'hub', '--url', start.url]); cli(runnerHome, ['config', 'set', 'hapi.executable', hapiBinary]);
    cli(runnerHome, ['config', 'set', 'hub.tokenEnv', 'OUTPUT_SMOKE_TOKEN']); env.OUTPUT_SMOKE_TOKEN = token; cli(runnerHome, ['start']);
    const machine = (await hapi.request('/api/machines')).machines[0]; machineId = machine.id; assert.equal(machine.runnerState.capabilities.artifactOutputs, 1);
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
    await rm(cwd, { recursive: true }); cli(runnerHome, ['stop']); cli(home, ['config', 'set', 'server.artifacts.maxFileMiB', '128']); cli(home, ['restart']); cli(runnerHome, ['start']);
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
    cli(runnerHome, ['stop']);
    for (const item of completed.deliveries!) {
        assert(item.status === 'available'); const output = join(root, `download-${item.name}`);
        await artifacts.download(item.artifact.id, output); const hash = createHash('sha256'); for await (const chunk of Bun.file(output).stream()) hash.update(chunk);
        assert.equal(hash.digest('hex'), item.artifact.sha256); if (item.name === '报告.txt') assert.equal(readFileSync(output, 'utf8'), 'ORIGINAL OUTPUT');
    }
    record('Runner stopped: published outputs download from the Hub with matching SHA-256; successful spool removed; no native sessions created');
    evidence.success = true;
} catch (error) { evidence.error = error instanceof Error ? error.stack ?? error.message : String(error); process.exitCode = 1; }
finally {
    for (const selectedHome of [runnerHome, home]) try { cli(selectedHome, ['stop']); } catch (error) { evidence.cleanupErrors.push(String(error)); }
    if (evidence.cleanupErrors.length) { evidence.success = false; process.exitCode = 1; }
    evidence.finishedAt = new Date().toISOString(); writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(`Evidence: ${join(root, 'evidence.json')}`); if (evidence.error) console.error(evidence.error);
}
