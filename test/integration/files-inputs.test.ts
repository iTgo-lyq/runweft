import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { nativeFileSmoke } from './native-files';
import { ArtifactClient } from '../../src/artifacts/client';
import type { ArtifactTransfer, ArtifactTransferRequest } from '../../hapi/shared/src/artifactTransfers';
import { afterEach, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { rmSync as removeRoot } from 'node:fs';
import { integrationBinaries } from './binaries';

let closeOwned: () => Promise<void> = async () => {};
afterEach(() => closeOwned());

test('files-inputs real integration', async () => {
    integrationBinaries();
    const command = [integrationBinaries().runweft.path];
    const hapiBinary = integrationBinaries().hapi.path;
    const root = mkdtempSync(join(tmpdir(), 'runweft-inputs-'));
    const env = { ...process.env }; for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_')) delete env[key];
    const evidence = { root, hapiBinary, startedAt: new Date().toISOString(), finishedAt: '',
        success: false, checks: [] as string[], error: '', cleanupErrors: [] as string[] };
    let machineId = '';
    let fixture: Awaited<ReturnType<typeof nativeFileSmoke>> | undefined, scope: Awaited<ReturnType<Awaited<ReturnType<typeof nativeFileSmoke>>['scoped']>>;
    const record = (message: string) => { evidence.checks.push(message); console.log(message); };
    async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, label: string, timeout = 120_000): Promise<T> {
        const deadline = Date.now() + timeout;
        do { const value = await read(); if (done(value)) return value; await Bun.sleep(200); } while (Date.now() < deadline);
        throw new Error(`Timed out: ${label}`);
    }
    async function transfer(body: ArtifactTransferRequest): Promise<ArtifactTransfer> {
        return (await scope.native.request(`/api/machines/${machineId}/artifacts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).operation;
    }
    async function prepared(operationId: string) {
        const result = await until(() => transfer({ action: 'inspect', operationId }), value => !['accepted', 'running'].includes(value.status), 'machine materialize');
        assert.equal(result.status, 'succeeded', JSON.stringify(result.error)); return result;
    }

    let closing: Promise<void> | undefined;
    closeOwned = () => closing ??= (async () => {
        try { await fixture?.close(false); } catch (error) { evidence.cleanupErrors.push(String(error)); }
        if (evidence.success && !evidence.cleanupErrors.length) try { await (await import('./native-files')).removeFileSmokeData(root); } catch (error) { evidence.cleanupErrors.push(String(error)); }
        if (evidence.cleanupErrors.length) { evidence.success = false;  }
        evidence.finishedAt = new Date().toISOString(); writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
        console.log(`Evidence: ${join(root, 'evidence.json')}`); if (evidence.error) console.error(evidence.error);

        if (evidence.cleanupErrors?.length) throw new AggregateError(evidence.cleanupErrors, 'Integration cleanup failed');
        if (evidence.success) removeRoot(root, { recursive: true, force: true });
    })();
    try {
        fixture = await nativeFileSmoke(root, command, hapiBinary, env); Object.assign(evidence, { candidate: fixture.candidate });
        const runner = await fixture.addRunner(); machineId = runner.machineId;
        scope = await fixture.scoped(machineId); const hapi = fixture.http, files = new ArtifactClient(hapi);
        assert.equal((await hapi.request('/api/machines')).machines.find((m: any) => m.id === machineId).runnerState.capabilities.artifactTransfers, 1);
        const largePath = join(root, '大文件.bin'), largeHandle = await open(largePath, 'w'); await largeHandle.truncate(72 * 1024 * 1024); await largeHandle.close();
        const large = await files.upload(largePath, randomUUID()), largeRequest = { action: 'materialize' as const, operationId: randomUUID(), files: [
            { artifactId: large.id, name: large.filename, size: large.size, sha256: large.sha256 }] };
        assert.equal((await transfer(largeRequest)).status, 'accepted'); const largeReady = await prepared(largeRequest.operationId);
        const hash = createHash('sha256'); for await (const chunk of Bun.file(largeReady.files[0]!.path).stream()) hash.update(chunk);
        assert.equal(hash.digest('hex'), large.sha256); assert.equal((await hapi.request('/api/sessions')).sessions.length, 0);
        await fixture.restart(); assert.equal((await transfer({ action: 'inspect', operationId: largeRequest.operationId })).status, 'succeeded');
        const repo = join(root, 'worktree-source'); mkdirSync(repo); writeFileSync(join(repo, 'base.txt'), 'base');
        const git = (...args: string[]) => {
            const result = spawnSync('git', ['-C', repo, ...args], { env, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
        };
        git('init', '-q'); git('add', '.'); git('-c', 'user.name=Input Smoke', '-c', 'user.email=smoke@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
        const workspace = (body: unknown) => scope.native.request(`/api/machines/${machineId}/workspaces`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        const { source: gitSource } = await workspace({ action: 'resolve', cwd: repo, baseRef: 'HEAD' });
        const input = largeReady.files[0]!, name = '中文 大文件.bin', preparation = { action: 'prepare', environmentId: randomUUID(), preparationId: randomUUID(), roundId: randomUUID(),
            source: gitSource, expectedHead: gitSource.baseCommit, inputs: [{ name, path: input.path, size: input.size, sha256: input.sha256 }] };
        await workspace(preparation);
        const readyWorkspace = (await until(() => workspace({ action: 'inspect', environmentId: preparation.environmentId }), value =>
            !['accepted', 'running'].includes(value.workspace.operations[`prepare:${preparation.preparationId}`].status), 'worktree inputs')).workspace;
        assert.equal(readyWorkspace.operations[`prepare:${preparation.preparationId}`].status, 'succeeded');
        const copied = readyWorkspace.preparations[preparation.preparationId].inputs[0]; assert.equal(copied.name, name);
        await transfer({ action: 'release', operationId: largeRequest.operationId }); assert(!existsSync(largeReady.files[0]!.path));
        const copiedHash = createHash('sha256'); for await (const chunk of Bun.file(copied.path).stream()) copiedHash.update(chunk);
        assert.equal(copiedHash.digest('hex'), large.sha256); assert.equal(git('status', '--porcelain'), '');
        const finishId = randomUUID(); await workspace({ action: 'finalize', environmentId: preparation.environmentId, preparationId: preparation.preparationId,
            roundId: preparation.roundId, attemptId: finishId, partial: true });
        const sealed = (await until(() => workspace({ action: 'inspect', environmentId: preparation.environmentId }), value =>
            !['accepted', 'running'].includes(value.workspace.operations[`finalize:${preparation.roundId}:${finishId}`].status), 'unused worktree seal')).workspace;
        assert.equal(sealed.operations[`finalize:${preparation.roundId}:${finishId}`].status, 'succeeded');
        await workspace({ action: 'remove', environmentId: preparation.environmentId, attemptId: randomUUID(), expectedHead: gitSource.baseCommit });
        await until(() => workspace({ action: 'inspect', environmentId: preparation.environmentId }), value => value.workspace.status === 'removed', 'fixture worktree cleanup');
        record('worktree prepare retains its verified Unicode/space input after the intermediate download is released');
        record('72 MiB download through actual machine RPC/HTTP; receipt survives Runner/Hub restart; explicit release without sessions');
        evidence.success = true;
    } catch (error) { evidence.error = error instanceof Error ? error.stack ?? error.message : String(error); throw error; }
    finally { await closeOwned(); }
}, 120000);
