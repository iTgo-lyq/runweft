import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { HapiHttp } from '../src/hapi';
import { nativeFileSmoke } from './fixtures/native-file-smoke';
import { modelHomes } from './fixtures/model-homes';
import { ExecutionClient } from '../src/execution';
import type { ManagedWorkspace, WorkspaceRequest } from '../hapi/shared/src/workspaces';

// Explicit native acceptance in a dedicated home/repository. Never part of credential-free unit tests.
const command = process.argv[2] === '--source' ? [process.execPath, resolve('src/cli.ts')] : [resolve(process.argv[2] ?? 'dist/runweft')];
const hapiBinary = resolve(process.argv[3] ?? 'dist/hapi');
const parent = resolve('.dev-smoke'); mkdirSync(parent, { recursive: true });
const root = mkdtempSync(join(parent, 'workspace-http-'));
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_')) delete env[key];
const evidence = { root, hapiBinary, sourceLauncher: process.argv[2] === '--source', startedAt: new Date().toISOString(),
    finishedAt: '', success: false, checks: [] as string[], cases: [] as Record<string, unknown>[], error: '', cleanupErrors: [] as string[] };
let hapi: HapiHttp | undefined, execution: ExecutionClient | undefined;
const ownedModelPids = new Set<number>();
const record = (value: string) => { evidence.checks.push(value); console.log(value); };
function git(path: string, ...args: string[]) {
    const result = spawnSync('git', ['-C', path, ...args], { encoding: 'utf8', env, timeout: 20_000 });
    assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
}
async function until<T>(read: () => Promise<T>, accept: (value: T) => boolean, label: string, timeout = 90_000) {
    const end = Date.now() + timeout;
    do { const value = await read(); if (accept(value)) return value; await Bun.sleep(150); } while (Date.now() < end);
    throw new Error(`Timed out: ${label}`);
}
let machineId = '';
const workspace = async (body: WorkspaceRequest): Promise<any> => scope.native.request(`/api/machines/${machineId}/workspaces`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
async function completed(id: string, operationId: string): Promise<ManagedWorkspace> {
    const response = await until(() => workspace({ action: 'inspect', environmentId: id }), value => {
        const state = value.workspace.operations[operationId]?.status; return state && !['accepted', 'running'].includes(state);
    }, operationId);
    assert.equal(response.workspace.operations[operationId].status, 'succeeded', JSON.stringify(response.workspace.operations[operationId].error));
    return response.workspace;
}
let fixture: Awaited<ReturnType<typeof nativeFileSmoke>> | undefined;
let scope: Awaited<ReturnType<Awaited<ReturnType<typeof nativeFileSmoke>>['scoped']>>;
let models: ReturnType<typeof modelHomes> | undefined;
try {
    models = modelHomes(root, env);
    fixture = await nativeFileSmoke(root, command, hapiBinary, env);
    Object.assign(evidence, { candidate: fixture.candidate, kind: 'current domain seeds + real private policy/HAPI/Runner/models; not Task end-to-end' });
    const runner = await fixture.addRunner(); machineId = runner.machineId; hapi = fixture.http;
    assert.equal((await hapi.request('/api/machines')).machines.find((m: any) => m.id === machineId).runnerState.capabilities.managedWorkspaces, 1);
    for (const agent of ['codex', 'claude'] as const) {
        const repo = join(root, agent); mkdirSync(repo); git(repo, 'init', '-q'); git(repo, 'config', 'user.name', 'Workspace Smoke');
        git(repo, 'config', 'user.email', 'smoke@example.invalid'); git(repo, 'config', 'commit.gpgsign', 'false');
        mkdirSync(join(repo, 'app')); writeFileSync(join(repo, 'app/base.txt'), 'base\n');
        writeFileSync(join(repo, 'AGENTS.md'), 'This is a dedicated acceptance fixture. Only perform the explicit request. Do not delegate.\n');
        writeFileSync(join(repo, 'CLAUDE.md'), 'This is a dedicated acceptance fixture. Only perform the explicit request. Do not delegate.\n');
        git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'fixture');
        writeFileSync(join(repo, 'app/base.txt'), 'parent-only dirty state\n'); const before = git(repo, 'status', '--porcelain'), index = git(repo, 'write-tree');
        scope = await fixture.scoped(machineId, repo, agent); execution = new ExecutionClient({ request: (path, options) => scope.native.request(path, options), response: (path, options) => scope.native.response(path, options) });
        const { source } = await workspace({ action: 'resolve', cwd: join(repo, 'app'), baseRef: 'HEAD' });
        const prepare = { action: 'prepare' as const, environmentId: crypto.randomUUID(), preparationId: crypto.randomUUID(), roundId: crypto.randomUUID(), source, expectedHead: source.baseCommit, inputs: [] };
        const accepted = await workspace(prepare); assert.equal(accepted.operation.status, 'accepted');
        const ready = await completed(prepare.environmentId, `prepare:${prepare.preparationId}`);
        assert.equal(readFileSync(join(ready.cwd, 'base.txt'), 'utf8'), 'base\n');
        const reference = { environmentId: prepare.environmentId, preparationId: prepare.preparationId };
        const launch = { requestId: crypto.randomUUID(), directory: ready.cwd, agent, startingMode: 'remote' as const, preparedWorkspace: reference, disabledMcpServers: ['runweft'] };
        const invalid = await execution.start(machineId, { ...launch, requestId: crypto.randomUUID(),
            preparedWorkspace: { ...reference, preparationId: crypto.randomUUID() } });
        assert(invalid.outcome === 'recorded'); assert.deepEqual(invalid.receipt.response && 'childStarted' in invalid.receipt.response && invalid.receipt.response.childStarted, false);
        const start = await execution.start(machineId, launch); assert(start.outcome === 'recorded'); assert.equal(start.receipt.response?.type, 'success', JSON.stringify(start.receipt.response));
        const id: string = start.receipt.sessionId;
        const session = await execution.waitUntilReady(id); if (session.metadata?.hostPid) ownedModelPids.add(session.metadata.hostPid);
        assert.deepEqual(session.metadata?.preparedWorkspace, reference);
        const localId = crypto.randomUUID(); await execution.send(id, { localId, text: `Only reply WORKSPACE_${agent}. Do not use tools, edit files, or delegate.` });
        const done = await until(() => execution!.query(id, localId), value => value.facts.some(f => f.observation.phase === 'completed') && !value.session.thinking, `${agent} completion`);
        assert(done.output.some(output => output.text.includes(`WORKSPACE_${agent}`)));
        assert.equal((await execution.stop(id)).outcome, 'stopped');
        // The test operator writes a fixture after native stop; this checks programmatic checkpointing, not model editing.
        writeFileSync(join(ready.cwd, 'result.txt'), `sealed ${agent}\n`);
        const finish = { action: 'finalize' as const, environmentId: prepare.environmentId, preparationId: prepare.preparationId, roundId: prepare.roundId,
            sessionId: id, attemptId: crypto.randomUUID(), partial: false };
        await workspace(finish); const sealed = await completed(prepare.environmentId, `finalize:${prepare.roundId}:${finish.attemptId}`);
        assert.equal(git(repo, 'show', `${sealed.results[prepare.roundId]!.resultRef}:app/result.txt`), `sealed ${agent}`);
        await assert.rejects(() => execution!.resume(id), { code: 'workspace_not_prepared' });
        const next = { ...prepare, preparationId: crypto.randomUUID(), roundId: crypto.randomUUID(), expectedHead: sealed.results[prepare.roundId]!.resultHead };
        await workspace(next); await completed(prepare.environmentId, `prepare:${next.preparationId}`);
        // Lost retained checkout must never become an empty recreated directory, with the Runner's default directory-creation behavior.
        await rm(ready.checkout, { recursive: true });
        const missing = await execution.start(machineId, { ...launch, requestId: crypto.randomUUID(),
            preparedWorkspace: { ...reference, preparationId: next.preparationId } });
        assert(missing.outcome === 'recorded'); assert(missing.receipt.response?.type === 'error' && missing.receipt.response.childStarted === false);
        assert.equal(existsSync(ready.checkout), false); assert.equal(git(repo, 'status', '--porcelain'), before); assert.equal(git(repo, 'write-tree'), index);
        evidence.cases.push({ agent, sessionId: id, nativeSessionId: agent === 'codex' ? done.session.metadata?.codexSessionId : done.session.metadata?.claudeSessionId, nativeHostPid: session.metadata?.hostPid, environmentId: prepare.environmentId, result: sealed.results[prepare.roundId], rejectedResume: 'workspace_not_prepared' });
        record(`${agent}: compiled CLI + source Hub policy/RPC/Runner prepare, invalid proof, native launch/stop, checkpoint, expired resume and missing-checkout rejection`);
    }
    models.verify(); Object.assign(evidence, { sourceModelConfigurationUnchanged: true, ownedNativeHostPids: [...ownedModelPids] }); evidence.success = true;
} catch (error) { evidence.error = error instanceof Error ? error.message : String(error); process.exitCode = 1; }
finally {
    const modelPids = new Set(ownedModelPids);
    let modelShutdownConfirmed = true;
    if (hapi && execution) {
        try { for (const session of (await hapi.request('/api/sessions')).sessions) {
            if (session.metadata?.hostPid) modelPids.add(session.metadata.hostPid);
            try { if (session.active || session.metadata?.lifecycleState !== 'archived') {
                const result = await execution.stop(session.id); if (result.outcome !== 'stopped') { modelShutdownConfirmed = false; evidence.cleanupErrors.push(`Stop unconfirmed: ${session.id}`); }
            } } catch (error) { modelShutdownConfirmed = false; evidence.cleanupErrors.push(String(error)); }
        } } catch (error) { modelShutdownConfirmed = false; evidence.cleanupErrors.push(String(error)); }
    }
    try { await fixture?.close(false); } catch (error) { modelShutdownConfirmed = false; evidence.cleanupErrors.push(String(error)); }
    try { await models?.waitHosts(modelPids); } catch (error) { modelShutdownConfirmed = false; evidence.cleanupErrors.push(String(error)); }
    if (modelShutdownConfirmed) try { await models?.remove(); } catch (error) { evidence.cleanupErrors.push(String(error)); }
    if (evidence.success && !evidence.cleanupErrors.length) try { await (await import('./fixtures/native-file-smoke')).removeFileSmokeData(root); } catch (error) { evidence.cleanupErrors.push(String(error)); }
    if (evidence.cleanupErrors.length) { evidence.success = false; process.exitCode = 1; }
    evidence.finishedAt = new Date().toISOString(); writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(`Evidence: ${join(root, 'evidence.json')}`); if (evidence.error) console.error(evidence.error);
}
