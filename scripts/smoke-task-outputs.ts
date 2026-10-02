import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { HapiHttp } from '../src/hapi';
import type { SessionResponse } from '../hapi/shared/src/apiTypes';
import { taskSmoke } from './fixtures/task-smoke';
import { taskCaptureReceipt } from './fixtures/task-capture-receipt';
import pkg from '../package.json';

// Compiled CLI + real models in dedicated homes and repositories. Never part of ordinary unit tests.
const binary = resolve(process.argv[2] ?? 'dist/runweft');
mkdirSync('.dev-smoke', { recursive: true }); const root = mkdtempSync(resolve('.dev-smoke/task-outputs-'));
const env: NodeJS.ProcessEnv = { ...process.env }; for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_') || key.startsWith('HAPI_') || ['CLI_API_TOKEN', 'DB_PATH'].includes(key)) delete env[key];
env.GIT_CEILING_DIRECTORIES = root;
const evidence = { root, binary, hapiRevision: pkg.hapi.revision, startedAt: new Date().toISOString(), finishedAt: '', success: false,
    checks: [] as string[], cases: [] as Record<string, any>[], error: '', cleanupErrors: [] as string[] };
let fixture: Awaited<ReturnType<typeof taskSmoke>> | undefined, hapi: HapiHttp | undefined;
function cli(args: string[], cwd = root, expected = 0) {
    const result = fixture!.run(fixture!.home, args, { cwd, timeout: 60_000 });
    assert.equal(result.status, expected, `${args.slice(0, 2).join(' ')}: ${result.stderr || result.error || result.signal}`);
    return { value: result.stdout.trim() ? JSON.parse(result.stdout) : null, stderr: result.stderr };
}
function git(cwd: string, ...args: string[]) {
    const result = spawnSync('git', ['-C', cwd, ...args], { env, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
}
const record = (message: string) => { evidence.checks.push(message); console.log(message); };
async function completed(id: string, roundId: string, cwd: string, item: Record<string, any>) {
    const deadline = Date.now() + 180_000;
    do {
        cli(['task', 'wait', id, '--timeout', '1000'], cwd);
        const result = cli(['task', 'show', id, '--round', roundId], cwd).value; item.lastObserved = result;
        if (result.status === 'completed' && !result.artifacts.pending.length) return result;
        if (result.attention?.code === 'permission_required') {
            for (const [requestId, permission] of Object.entries(result.permissions) as [string, any][]) {
                if (item.approvals?.some((entry: { requestId: string }) => entry.requestId === requestId)) continue;
                const argumentsText = JSON.stringify(permission.arguments);
                if (!/成果.txt|large.txt|extra.txt|材料|AGENTS.md|CLAUDE.md/.test(argumentsText)) throw new Error(`Unreviewed fixture permission: ${permission.tool}`);
                cli(['task', 'permission', id, '--round', roundId, '--request', requestId, '--decision', 'approved'], cwd);
                (item.approvals ??= []).push({ requestId, tool: permission.tool });
            }
        } else if (!['running', 'completed'].includes(result.status)) throw new Error(JSON.stringify({ status: result.status, attention: result.attention }));
    } while (Date.now() < deadline);
    throw new Error(`Task output timeout: ${id}/${roundId}`);
}
async function fileVersion(id: string, roundId: string, version: number, cwd: string) {
    const deadline = Date.now() + 60_000;
    do {
        const value = cli(['task', 'show', id, '--round', roundId], cwd).value;
        if (value.artifacts.manifest?.version === version && !value.artifacts.pending.length) return value;
        await Bun.sleep(100);
    } while (Date.now() < deadline);
    throw new Error(`File version timeout: ${id}/${roundId}/${version}`);
}
try {
    fixture = await taskSmoke(root, binary, env); hapi = fixture.runner.http;
    Object.assign(evidence, { evidenceFormat: 'current-task-outputs-1', candidate: { ...fixture.candidate, cliBinary: binary, hapiBinary: fixture.binaries.hapi.path },
        handoff: { serverHome: fixture.server, clientHome: fixture.home, url: fixture.url, ownerId: fixture.user.identity.id, spaceId: fixture.space,
            serverPaths: fixture.cli(fixture.server, ['paths']), runnerNativeHome: fixture.runner.hapiHome, machineId: fixture.runner.machineId,
            identityFile: fixture.identityFile, cleanupOwner: 'smoke-task-retention final consumer' } });
    for (const agent of ['codex', 'claude'] as const) {
        for (const mode of ['shared', 'worktree'] as const) {
            fixture.cli(fixture.server, ['config', 'set', 'server.artifacts.maxFileMiB', '1']); await fixture.restart();
            const project = join(root, `${agent}-${mode}`); mkdirSync(project); const projectMarker = `PROJECT_${randomUUID()}`;
            for (const name of ['AGENTS.md', 'CLAUDE.md']) writeFileSync(join(project, name), `这是专用文件交付验收工程。最终报告包含工程标记 ${projectMarker}。只处理请求中的文件，不安装依赖，不委派。\n`);
            git(project, 'init', '-q'); git(project, 'config', 'user.name', 'Output Task Smoke'); git(project, 'config', 'user.email', 'smoke@example.invalid'); git(project, 'config', 'commit.gpgsign', 'false'); git(project, 'add', '.'); git(project, 'commit', '-qm', 'fixture');
            const repositoryId: string = await fixture.bind(project), agentType: string = fixture.agent(agent, { repositoryId }).id;
            const before = git(project, 'rev-parse', 'HEAD'); let id = '', nativeSessionId = '';
            let originalManifest: any, originalItem: any;
            for (let round = 0; round < 2; round++) {
                const marker = `FILE_${randomUUID()}`, inputPath = join(root, `材料 ${agent}-${mode}-${round}.txt`); writeFileSync(inputPath, marker);
                const object = cli(['artifact', 'upload', inputPath], project).value, requestId = randomUUID();
                const message = '读取本轮输入文件，将文件中的完整标记写入工作目录的 成果.txt，只写这个标记，不加换行。'
                    + (round ? '这是第二轮，覆盖 成果.txt；不要改动其他文件。' : '再生成 large.txt，内容为这个标记加 2097152 个 X；再生成 extra.txt，内容也是这个标记。不要生成 遗漏.txt，这是故意保留的缺失项。可以用 Python 写文件，不要把大文件内容打印到终端。')
                    + '最终报告包含输入标记和工程指令标记。不要安装依赖，不要委派。';
                const args: string[] = round === 0 ? ['task', 'spawn', agentType, '--workspace-mode', mode] : ['task', 'send', id];
                args.push('--message', message, '--input', object.id, '--output', '成果.txt', '--request-id', requestId);
                if (!round) args.push('--output', 'large.txt', '--output', '遗漏.txt');
                const accepted: any = cli(args, project).value; id = accepted.agent_id; assert.deepEqual(cli(args, project).value, accepted);
                const item: Record<string, any> = { agent, agentId: agentType, project, mode, round, requestId, taskId: id, roundId: accepted.round_id };
                evidence.cases.push(item); const done = await completed(id, accepted.round_id, project, item);
                assert(done.report.text.includes(marker)); assert(done.report.text.includes(projectMarker));
                assert.equal(done.stop, 'stopped'); assert.equal(done.finish, 'complete'); fixture.ownedPids.add(done.host_pid);
                if (round) assert.equal(done.native_session_id, nativeSessionId); else nativeSessionId = done.native_session_id;
                const session: SessionResponse['session'] = (await hapi.request(`/api/sessions/${done.session_id}`)).session; assert(session.metadata);
                assert.equal(session.active, false); assert.deepEqual(session.metadata.disabledMcpServers, ['runweft']);
                if (mode === 'worktree') { assert.equal(done.git.status, 'sealed'); assert.equal(git(project, 'status', '--porcelain'), ''); assert.equal(git(project, 'rev-parse', 'HEAD'), before); }
                let manifest = done.artifacts.manifest;
                const small = manifest.items.find((entry: any) => entry.name === '成果.txt'); assert.equal(small.status, 'available');
                const destination = join(root, `${agent}-${mode}-${round}-result.txt`);
                cli(['artifact', 'download', small.artifactId, '--output', destination], project); assert.equal(readFileSync(destination, 'utf8'), marker);
                if (!round) {
                    assert.equal(manifest.status, 'incomplete'); assert.equal(manifest.items.find((entry: any) => entry.name === 'large.txt').status, 'failed');
                    assert.equal(manifest.items.find((entry: any) => entry.name === '遗漏.txt').error.code, 'artifact_output_missing');
                    originalManifest = manifest; originalItem = small;
                    fixture.cli(fixture.server, ['config', 'set', 'server.artifacts.maxFileMiB', '128']); await fixture.restart();
                    const retryArgs = ['task', 'artifacts', 'retry', id, '--round', done.round_id, '--request-id', randomUUID()];
                    const retry = cli(retryArgs, project).value; assert.deepEqual(cli(retryArgs, project).value, retry);
                    const retried = await fileVersion(id, done.round_id, 2, project); assert.equal(retried.completed_revision, done.completed_revision);
                    const large = retried.artifacts.manifest.items.find((entry: any) => entry.name === 'large.txt'); assert.equal(large.status, 'available'); assert(large.size > 2 * 1024 * 1024);
                    const collectArgs = ['task', 'artifacts', 'collect', id, '--round', done.round_id, '--path', '遗漏.txt=extra.txt', '--request-id', randomUUID()];
                    const collect = cli(collectArgs, project).value; assert.deepEqual(cli(collectArgs, project).value, collect);
                    const collected = await fileVersion(id, done.round_id, 3, project); manifest = collected.artifacts.manifest;
                    assert.equal(manifest.status, 'delivered'); assert.equal(collected.completed_revision, done.completed_revision);
                    assert.equal(collected.session_id, done.session_id); assert.equal(collected.native_session_id, done.native_session_id);
                    const waiting = cli(['task', 'wait', id, '--timeout', '0', '--after-revision', JSON.stringify({ [id]: retried.artifacts_revision })], project).value;
                    assert.equal(waiting.timed_out, false); assert.equal(waiting.agents[0].revision, collected.artifacts_revision);
                    const old = cli(['task', 'artifacts', 'show', id, '--round', done.round_id, '--version', '1'], project).value;
                    assert.deepEqual(old.manifests, [originalManifest]);
                    for (const output of manifest.items) {
                        assert(cli(['artifact', 'remove', output.artifactId], project, 1).stderr.includes('artifact_referenced'));
                        const target = join(root, `${agent}-${mode}-full-${output.name}`); cli(['artifact', 'download', output.artifactId, '--output', target], project);
                        assert.equal(readFileSync(target, 'utf8').slice(0, marker.length), marker);
                        const { receipt, candidate } = taskCaptureReceipt(root, fixture.runner.hapiHome, done.cwd, output);
                        assert.equal(receipt.retention, 'released'); assert.equal(candidate.retention, 'released'); assert(!existsSync(candidate.path));
                    }
                    item.versions = [1, 2, 3];
                } else {
                    assert.equal(manifest.status, 'delivered'); const oldPath = join(root, `${agent}-${mode}-old-round.txt`);
                    cli(['artifact', 'download', originalItem.artifactId, '--output', oldPath], project);
                    assert.notEqual(readFileSync(oldPath, 'utf8'), marker); assert.equal(small.artifactId === originalItem.artifactId, false);
                }
                item.nativeSessionId = nativeSessionId; item.sessionId = done.session_id; item.pid = done.host_pid; delete item.lastObserved;
                record(`${agent}/${mode} round ${round + 1}: actual output download, project context, ${round ? 'same native resume and prior bytes preserved' : 'partial delivery, fixed-candidate retry, collect versions and spool release'} verified`);
            }
        }
    }
    evidence.success = true;
} catch (error) { evidence.error = error instanceof Error ? error.stack ?? error.message : String(error); process.exitCode = 1; }
finally {
    // The sole retention consumer owns persistent center/Runner data and connection credentials.
    try { await fixture?.close(false, evidence.success); } catch (error) { evidence.cleanupErrors.push(...(error instanceof AggregateError ? error.errors.map(String) : [String(error)])); }
    if (evidence.cleanupErrors.length) { evidence.success = false; process.exitCode = 1; }
    evidence.finishedAt = new Date().toISOString(); writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(`Evidence: ${join(root, 'evidence.json')}`); if (evidence.error) console.error(evidence.error);
}
