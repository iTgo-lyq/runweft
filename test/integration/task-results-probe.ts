import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { RepositoryOperation } from '../../hapi/shared/src/repositories';
import type { ArtifactTransfer } from '../../hapi/shared/src/artifactTransfers';
import type { ManagedWorkspace, WorkspaceSource } from '../../hapi/shared/src/workspaces';
import type { HapiHttp } from '../../src/hapi';
import { nativeFileSmoke } from './native-files';
import { HubTaskClient } from '../../src/hub/delegation/client';
import { loadConfig } from '../../src/config';
import { ArtifactClient } from '../../src/artifacts/client';
import { BaselineStore } from '../../src/remote/store';
import { recoveryReference } from '../../src/remote/types';
import { pendingCode } from '../../src/tasks/results';
import type { AgentSnapshot, Parent } from '../../src/tasks/types';
import { taskTools } from '../../src/mcp/tasks';
import type { TaskCoordinator } from '../../src/tasks/coordinator';

/** No-model probe: only actual HAPI prepare/finalize receipts enter the task result coordinator. */
export async function taskResultsProbe(p: { root: string; center: string; sourceHome: string; targetHome: string; repo: string; binary: string;
    env: NodeJS.ProcessEnv; agent: AgentSnapshot; hapi: HapiHttp; fixture: Awaited<ReturnType<typeof nativeFileSmoke>>; sourceRunner: Awaited<ReturnType<Awaited<ReturnType<typeof nativeFileSmoke>>['addRunner']>>; targetRunner: Awaited<ReturnType<Awaited<ReturnType<typeof nativeFileSmoke>>['addRunner']>>; source: WorkspaceSource; targetSource: WorkspaceSource; imported: RepositoryOperation;
    exported: RepositoryOperation; delivered: ArtifactTransfer; restartHub: () => Promise<void>; editTasks: <T>(edit: () => T) => Promise<T>; note: (message: string) => void }) {
    const { hapi, source, targetSource, repo } = p;
    const credentials = [p.fixture.user.token, ...[p.sourceRunner, p.targetRunner].map(runner => JSON.parse(readFileSync(runner.credentialFile, 'utf8')).active.token)];
    const cli = async (home: string, args: string[], cwd = p.root) => {
        const child = Bun.spawn([p.binary, '--home', home, '--json', 'hub', '--url', p.fixture.url, '--identity-file', p.fixture.identityFile, '--space', p.fixture.space, ...args], { cwd, env: p.env, stdout: 'pipe', stderr: 'pipe' });
        const [status, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        for (const credential of credentials) assert(!(stdout + stderr).includes(credential), 'Credential leaked in compiled CLI output');
        assert.equal(status, 0, stderr); return JSON.parse(stdout);
    };
    const git = (...args: string[]) => { const r = spawnSync('git', ['-C', repo, ...args], { env: p.env, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
    let activeTask: any, activeRound: any;
    const call = (body: object) => p.fixture.gateway.delegation.taskClient(activeTask, activeRound).request(`/api/machines/${targetSource.machineId}/workspaces`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const until = async <T>(read: () => Promise<T>, done: (value: T) => boolean) => {
        const deadline = Date.now() + 120_000;
        while (Date.now() < deadline) { const item = await read(); if (done(item)) return item; await Bun.sleep(150); }
        throw new Error('Task result probe did not finish');
    };
    const state = p.fixture.statePath, baselines = new BaselineStore(state);
    const tasks = () => p.fixture.gateway.delegation.coordinator.store;
    try {
        // These are the exported and published input facts from this invocation’s actual exported input.
        const agent = p.agent, namespace = agent.namespace;
        assert(agent.hub, 'Current resolved snapshot required');
        const baseline = baselines.createSnapshot(namespace, source), artifacts = new ArtifactClient(hapi);
        baseline.exportId = p.exported.request.operationId; baseline.exportAttempted = true; baseline.sourceReleased = true;
        baseline.phase = 'available'; baseline.stage = 'publish'; baseline.manifest = p.exported.snapshot;
        baseline.files = p.exported.snapshot!.files.map(file => {
            const delivered = p.delivered.deliveries!.find(item => item.name === file.name)!; assert.equal(delivered.status, 'available');
            if (delivered.status !== 'available') throw new Error('Input not delivered');
            return { ...file, artifactId: delivered.artifact.id, requestId: delivered.artifact.requestId, reused: false, pinned: true };
        });
        for (const file of baseline.files) {
            await artifacts.pin(file.artifactId!, recoveryReference(baseline.id), 'recovery');
            if (file.kind === 'lfs') baselines.rememberLfs(namespace, file.sha256, file.size, file.artifactId!);
        }
        baselines.saveSnapshot(baseline);
        const parent: Parent = { kind: 'mcp', host: 'codex', nativeSessionId: randomUUID(), machineId: source.machineId, cwd: repo };
        let { bundle, round } = await p.editTasks(() => {
        const accepted = tasks().accept(namespace, parent, randomUUID(), { workspaceMode: 'worktree', baseRef: source.baseCommit, agentType: agent.id, message: 'No-model actual sealing fixture' }, agent, agent.hub.target, targetSource);
        const bundle = tasks().require(namespace, accepted.agent_id), round = bundle.rounds[0]!;
        const consumer = baselines.consume(baseline, targetSource.machineId, source, 'task', bundle.task.id);
        const imported = baselines.imported(consumer.importId); imported.operationId = p.imported.request.operationId; imported.attempted = true;
        imported.phase = 'available'; imported.source = targetSource; baselines.saveImport(imported);
        assert.equal(bundle.task.environment.mode, 'worktree'); if (bundle.task.environment.mode !== 'worktree') throw new Error('worktree required');
        bundle.task.environment.machineId = targetSource.machineId;
        bundle.task.environment.remote = { origin: source, snapshotId: baseline.id, consumerId: consumer.id };
        // The dispatcher is quiesced while inserting the terminal no-model fixture; the gateway remains running.
        round.phase = 'finished'; round.finish = 'complete'; round.stop = 'stopped'; round.executionAbsent = true;
        round.git = { status: 'not_prepared', attempted: false }; tasks().save(bundle.task, round, []);
            return { bundle, round };
        });
        const rounds: string[] = [];
        for (let index = 0; index < 2; index++) {
            if (index) await p.editTasks(() => {
                const next = tasks().append(namespace, parent, randomUUID(), { id: bundle.task.id, mode: 'next', message: 'Unchanged result round' }, agent);
                bundle = tasks().require(namespace, bundle.task.id); round = bundle.rounds.find(item => item.id === next.round_id)!;
                round.phase = 'finished'; round.finish = 'complete'; round.stop = 'stopped'; round.executionAbsent = true;
                round.git = { status: 'not_prepared', attempted: false }; tasks().save(bundle.task, round, []);
            });
            activeTask = bundle.task; activeRound = round;
            assert.equal(round.preparation.mode, 'worktree'); if (round.preparation.mode !== 'worktree') throw new Error('worktree required');
            const environment = bundle.task.environment; if (environment.mode !== 'worktree') throw new Error('worktree required');
            const prior = bundle.rounds.filter(item => item.ordinal < round.ordinal && item.git?.result).at(-1)?.git?.result;
            await call({ action: 'prepare', environmentId: environment.environmentId, preparationId: round.preparation.preparationId,
                roundId: round.id, source: targetSource, expectedHead: prior?.resultHead ?? source.baseCommit });
            const prepared = await until(async () => (await call({ action: 'inspect', environmentId: environment.environmentId })).workspace as ManagedWorkspace,
                value => !['accepted', 'running'].includes(value.operations[`prepare:${round.preparation.mode === 'worktree' ? round.preparation.preparationId : ''}`]!.status));
            assert(prepared.preparations[round.preparation.preparationId], JSON.stringify(prepared.operations));
            if (!index) { writeFileSync(join(prepared.cwd, 'note'), 'Runweft result delivered'); writeFileSync(join(prepared.checkout, 'root.bin'), Buffer.from('TASK RESULT\0'.repeat(4096))); }
            const attemptId = randomUUID();
            await call({ action: 'finalize', environmentId: environment.environmentId, preparationId: round.preparation.preparationId, roundId: round.id, attemptId });
            const sealed = await until(async () => (await call({ action: 'inspect', environmentId: environment.environmentId })).workspace as ManagedWorkspace,
                value => !['accepted', 'running'].includes(value.operations[`finalize:${round.id}:${attemptId}`]!.status));
            assert(sealed.results[round.id], JSON.stringify(sealed.operations));
            environment.checkout = sealed.checkout; environment.cwd = sealed.cwd; environment.branch = sealed.branch;
            round.preparation.status = 'ready'; round.preparation.startHead = sealed.preparations[round.preparation.preparationId]!.startHead;
            round.git = { status: 'sealed', attempted: true, attemptId, result: sealed.results[round.id] }; round.code = pendingCode();
            tasks().save(bundle.task, round, []); rounds.push(round.id);
            await p.fixture.reopenGateway(true);
            const result: ReturnType<TaskCoordinator['result']> = await until<ReturnType<TaskCoordinator['result']>>((): Promise<ReturnType<TaskCoordinator['result']>> => hapi.request('/api/runweft/tasks/result/show', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ parent, id: bundle.task.id, roundId: round.id }) }),
                value => { if (value.code.status === 'needs_attention') throw new Error(JSON.stringify(value.code)); return value.code.status === 'available' && !value.code.cleanup_error && !!tasks().require(namespace, bundle.task.id).rounds.find(item => item.id === round.id)!.code?.sourceReleased; });
            assert(result.code_revision); assert.equal(result.manifests.length, 1);
            const manifest = result.manifests[0]; assert.equal(manifest.result.resultHead, sealed.results[round.id]!.resultHead);
            const module = manifest.output.snapshot.repositories.find((item: any) => item.path !== '');
            assert(module); const moduleFile = manifest.output.files.find((item: any) => item.name === module.file);
            const inputModule = baseline.manifest!.repositories.find(item => item.path === module.path)!;
            assert(moduleFile); assert.equal(moduleFile.artifactId, baseline.files.find(item => item.name === inputModule.file)!.artifactId);
            if (index) { assert(result.code.bytes); assert.equal(result.code.bytes.uploaded, 0); assert.equal(manifest.verified.kind, 'result'); }
            bundle = tasks().require(namespace, bundle.task.id);
        }
        p.note('actual HAPI prepare/finalize facts drive center TaskResults for two rounds; unchanged HEAD, module bundle and LFS reuse durable objects with independent result pins; no model starts');
        await p.fixture.stopRunner(p.targetRunner); const targetRoot = resolve(targetSource.commonDir, '../../..'); renameSync(targetRoot, `${targetRoot}-offline`); await p.restartHub();
        renameSync(join(p.root, 'source-offline'), join(p.root, 'source')); await p.fixture.startRunner(p.sourceRunner);
        git('checkout', '--detach', source.baseCommit); for (const ref of git('for-each-ref', '--format=%(refname)', 'refs/heads').split('\n').filter(Boolean)) git('update-ref', '-d', ref);
        writeFileSync(join(repo, 'app/note'), 'parent dirty stays'); writeFileSync(join(repo, 'untracked'), 'parent untracked');
        const protectedBefore = [readFileSync(join(repo, '.git/index')), readFileSync(join(repo, '.git/config')), readFileSync(join(repo, 'app/note'))];
        const config = loadConfig(p.sourceHome, p.env), identity = { host: 'codex' as const, nativeSessionId: parent.nativeSessionId, cwd: repo, callId: 'actual-fetch' };
        const options = { url: p.fixture.url, identityFile: p.fixture.identityFile, space: p.fixture.space, home: p.sourceRunner.home, env: p.env };
        const client = new HubTaskClient(options, repo, identity), requestId = randomUUID();
        const pending = await cli(p.sourceHome, ['task', 'result', 'fetch', bundle.task.id, '--round', rounds[0]!, '--request-id', requestId], repo);
        assert.equal(pending.round_id, rounds[0]);
        assert.equal((await cli(p.sourceHome, ['task', 'result', 'fetch', bundle.task.id, '--round', rounds[0]!, '--request-id', requestId], repo)).result_operation_id, pending.result_operation_id);
        await until(() => client.result(bundle.task.id, rounds[0]), value => { const fetch = value.fetches.at(-1); if (fetch?.status === 'failed') throw new Error(JSON.stringify(fetch.error)); return fetch?.status === 'available' && fetch.released; });
        const mcp = taskTools().find(tool => tool.name === 'fetch_result')!;
        const mcpResult = await mcp.run({ id: bundle.task.id, round_id: rounds[1], request_id: randomUUID() }, { config, identity, hub: options, workspace: { path: repo }, signal: new AbortController().signal });
        assert.equal(mcpResult.round_id, rounds[1]); assert(!('manifests' in mcpResult)); assert(!('fetches' in mcpResult));
        const final = await until(() => client.result(bundle.task.id, rounds[1]), value => { const fetch = value.fetches.at(-1); if (fetch?.status === 'failed') throw new Error(JSON.stringify(fetch.error)); return fetch?.status === 'available' && fetch.released; });
        assert.deepEqual([readFileSync(join(repo, '.git/index')), readFileSync(join(repo, '.git/config')), readFileSync(join(repo, 'app/note'))], protectedBefore);
        assert(existsSync(join(repo, 'untracked'))); const ref = final.fetches.at(-1)!.fetched!.ref; assert.equal(git('rev-parse', ref), final.code.result!.resultHead);
        git('restore', 'app/note'); git('merge', '--ff-only', ref); git('lfs', 'checkout');
        assert.equal(readFileSync(join(repo, 'app/note'), 'utf8'), 'Runweft result delivered'); assert.deepEqual(readFileSync(join(repo, 'root.bin')), Buffer.from('TASK RESULT\0'.repeat(4096)));
        assert.equal((await hapi.request('/api/sessions')).sessions.length, 0);
        writeFileSync(join(p.root, 'task-results.json'), JSON.stringify({ taskId: bundle.task.id, agentId: agent.id, namespace, rounds, codeManifests: bundle.rounds.map(r => r.code?.manifest), first: pending.result_operation_id, final, sessions: 0 }, null, 2));
        p.note('compiled CLI and MCP tool fetch both fixed rounds from restarted center with executor and target Git directories offline; no branch refs required, parent index/config/dirty files preserved, explicit merge restores code and LFS');
    } finally { baselines.close(); }
}
