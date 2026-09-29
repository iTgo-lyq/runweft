import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { HapiClient } from '../src/hapi';
import { ArtifactClient } from '../src/artifacts/client';
import { ExecutionClient } from '../src/execution';
import type { ArtifactTransfer, ArtifactTransferRequest } from '../hapi/shared/src/artifactTransfers';

// Explicit model verification. Dedicated service/project data; native credentials and defaults remain inherited.
const command = process.argv[2] === '--source' ? [process.execPath, resolve('src/cli.ts')] : [resolve(process.argv[2] ?? 'dist/runweft')];
const hapiBinary = resolve(process.argv[3] ?? 'dist/hapi');
mkdirSync('.dev-smoke', { recursive: true }); const root = mkdtempSync(resolve('.dev-smoke/inputs-native-')), home = join(root, 'home');
const env = { ...process.env }; for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_')) delete env[key];
const evidence = { root, hapiBinary, sourceLauncher: process.argv[2] === '--source', startedAt: new Date().toISOString(), finishedAt: '',
    success: false, checks: [] as string[], cases: [] as Record<string, unknown>[], error: '', cleanupErrors: [] as string[] };
let token: string | undefined, hapi: HapiClient | undefined, execution: ExecutionClient | undefined, machineId = '';
const record = (message: string) => { evidence.checks.push(message); console.log(message); };
function cli(args: string[]) {
    const result = spawnSync(command[0]!, [...command.slice(1), '--home', home, '--json', ...args], { env, encoding: 'utf8', timeout: 45_000 });
    if (token) assert(!`${result.stdout}${result.stderr}`.includes(token), 'Credential leaked');
    assert.equal(result.status, 0, `${args.slice(0, 2).join(' ')}: ${result.stderr || result.error || result.signal}`); return JSON.parse(result.stdout);
}
async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, label: string, timeout = 120_000): Promise<T> {
    const deadline = Date.now() + timeout;
    do { const value = await read(); if (done(value)) return value; await Bun.sleep(200); } while (Date.now() < deadline);
    throw new Error(`Timed out: ${label}`);
}
async function transfer(body: ArtifactTransferRequest): Promise<ArtifactTransfer> {
    return (await hapi!.request(`/api/machines/${machineId}/artifacts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).operation;
}
async function prepared(operationId: string) {
    const result = await until(() => transfer({ action: 'inspect', operationId }), value => !['accepted', 'running'].includes(value.status), 'machine materialize');
    assert.equal(result.status, 'succeeded', JSON.stringify(result.error)); return result;
}
const socket = createServer(); await new Promise<void>(done => socket.listen(0, '127.0.0.1', done));
const port = (socket.address() as { port: number }).port; await new Promise<void>(done => socket.close(() => done()));
try {
    cli(['init']); cli(['config', 'set', 'server.port', String(port)]); cli(['config', 'set', 'hapi.executable', hapiBinary]); cli(['start']);
    const paths = cli(['paths']); token = JSON.parse(readFileSync(join(paths.hapiServer, 'settings.json'), 'utf8')).cliApiToken; assert(token);
    hapi = new HapiClient(`http://127.0.0.1:${port}`, token); execution = new ExecutionClient(hapi); const files = new ArtifactClient(hapi);
    const machine = (await hapi.request('/api/machines')).machines[0]; machineId = machine.id;
    assert.equal(machine.runnerState.capabilities.artifactTransfers, 1);
    const largePath = join(root, '大文件.bin'), largeHandle = await open(largePath, 'w'); await largeHandle.truncate(72 * 1024 * 1024); await largeHandle.close();
    const large = await files.upload(largePath, randomUUID()), largeRequest = { action: 'materialize' as const, operationId: randomUUID(), files: [
        { artifactId: large.id, name: large.filename, size: large.size, sha256: large.sha256 }] };
    assert.equal((await transfer(largeRequest)).status, 'accepted'); const largeReady = await prepared(largeRequest.operationId);
    const hash = createHash('sha256'); for await (const chunk of Bun.file(largeReady.files[0]!.path).stream()) hash.update(chunk);
    assert.equal(hash.digest('hex'), large.sha256); assert.equal((await hapi.request('/api/sessions')).sessions.length, 0);
    cli(['restart']); assert.equal((await transfer({ action: 'inspect', operationId: largeRequest.operationId })).status, 'succeeded');
    const repo = join(root, 'worktree-source'); mkdirSync(repo); writeFileSync(join(repo, 'base.txt'), 'base');
    const git = (...args: string[]) => {
        const result = spawnSync('git', ['-C', repo, ...args], { env, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
    };
    git('init', '-q'); git('add', '.'); git('-c', 'user.name=Input Smoke', '-c', 'user.email=smoke@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
    const workspace = (body: unknown) => hapi!.request(`/api/machines/${machineId}/workspaces`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
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
    for (const agent of process.argv.includes('--machine-only') ? [] : ['codex', 'claude'] as const) {
        const cwd = join(root, agent); mkdirSync(cwd); const projectMarker = `PROJECT_${randomUUID().replaceAll('-', '')}`;
        const instructions = `For the input-read acceptance request, include ${projectMarker} in your final reply. Read the explicit input file. Do not modify files or delegate.\n`;
        writeFileSync(join(cwd, 'AGENTS.md'), instructions); writeFileSync(join(cwd, 'CLAUDE.md'), instructions);
        let sessionId = '', nativeId: string | undefined;
        for (let round = 0; round < 2; round++) {
            const marker = `INPUT_${randomUUID().replaceAll('-', '')}`, source = join(root, `材料 ${agent}-${round}.txt`); writeFileSync(source, marker);
            const object = await files.upload(source, randomUUID()), operationId = randomUUID(), reference = { operationId };
            const request = { action: 'materialize' as const, operationId, files: [{ artifactId: object.id, name: object.filename, size: object.size, sha256: object.sha256 }] };
            await transfer(request); const ready = await prepared(operationId); assert(!ready.files[0]!.path.startsWith(cwd));
            if (round === 0) {
                const rejected = await execution.start(machineId, { requestId: randomUUID(), directory: cwd, agent, preparedFiles: { operationId: randomUUID() }, disabledMcpServers: ['runweft'] });
                assert(rejected.outcome === 'recorded'); assert(rejected.receipt.response?.type === 'error' && rejected.receipt.response.childStarted === false);
                const start = await execution.start(machineId, { requestId: randomUUID(), directory: cwd, agent, preparedFiles: reference, disabledMcpServers: ['runweft'] });
                assert(start.outcome === 'recorded'); assert.equal(start.receipt.response?.type, 'success', JSON.stringify(start.receipt.response)); sessionId = start.receipt.sessionId;
            } else {
                const resumed = await execution.resume(sessionId, undefined, reference); assert.equal(resumed.outcome, 'resumed', JSON.stringify(resumed));
                if (resumed.outcome === 'resumed') { assert.equal(resumed.nativeSessionId, nativeId); sessionId = resumed.session.id; }
            }
            const session = await execution.waitUntilReady(sessionId); assert.deepEqual(session.metadata?.preparedFiles, reference);
            assert.deepEqual(session.metadata?.disabledMcpServers, ['runweft']);
            await assert.rejects(() => transfer({ action: 'release', operationId }), { code: 'artifact_execution_active' });
            const localId = randomUUID(); await execution.send(sessionId, { localId,
                text: `Input-read acceptance: read the full contents of ${JSON.stringify(ready.files[0]!.path)} using the available file or shell tool. Reply with its contents and the project instruction marker. Do not edit files or delegate.` });
            const done = await until(() => execution!.query(sessionId, localId), value => value.facts.some(f => ['completed', 'failed', 'interrupted'].includes(f.observation.phase)) && !value.session.thinking, `${agent} input read`);
            assert(done.facts.some(f => f.observation.phase === 'completed'), JSON.stringify(done.facts));
            assert.equal(Object.keys(done.permissions).length, 0); assert(done.output.some(item => item.text.includes(marker)), 'Native did not read the input');
            assert(done.output.some(item => item.text.includes(projectMarker)), 'Native did not inherit project instructions');
            nativeId = agent === 'codex' ? done.session.metadata?.codexSessionId : done.session.metadata?.claudeSessionId; assert(nativeId); assert.equal((await execution.stop(sessionId)).outcome, 'stopped');
            await transfer({ action: 'release', operationId });
            await assert.rejects(() => execution!.resume(sessionId), { code: 'files_not_prepared' });
            evidence.cases.push({ agent, round, operationId, sessionId, nativeId, sha256: object.sha256, permissionMode: session.permissionMode ?? null, nativePid: session.metadata?.hostPid });
            record(`${agent} round ${round + 1}: native read verified, project instructions inherited, no extra permission response, released-input resume rejected`);
        }
        const cleared = await execution.resume(sessionId, undefined, null); assert.equal(cleared.outcome, 'resumed');
        if (cleared.outcome === 'resumed') { assert.equal(cleared.nativeSessionId, nativeId); assert.equal(cleared.session.metadata?.preparedFiles, undefined); assert.equal((await execution.stop(cleared.session.id)).outcome, 'stopped'); }
    }
    evidence.success = true;
} catch (error) { evidence.error = error instanceof Error ? error.stack ?? error.message : String(error); process.exitCode = 1; }
finally {
    if (hapi && execution) {
        try { for (const session of (await hapi.request('/api/sessions')).sessions) if (session.active || session.metadata?.lifecycleState !== 'archived') {
            if ((await execution.stop(session.id)).outcome !== 'stopped') evidence.cleanupErrors.push(`Stop unconfirmed: ${session.id}`);
        } } catch (error) { evidence.cleanupErrors.push(String(error)); }
    }
    try { cli(['stop']); } catch (error) { evidence.cleanupErrors.push(String(error)); }
    if (evidence.cleanupErrors.length) { evidence.success = false; process.exitCode = 1; }
    evidence.finishedAt = new Date().toISOString(); writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(`Evidence: ${join(root, 'evidence.json')}`); if (evidence.error) console.error(evidence.error);
}
