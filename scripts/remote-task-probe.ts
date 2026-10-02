import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ArtifactClient } from '../src/artifacts/client';
import { HubTaskClient } from '../src/hub/delegation/client';
import { nativeUserSmoke } from './fixtures/native-user-smoke';
import type { HapiHttp } from '../src/hapi';
import type { TaskCoordinator } from '../src/tasks/coordinator';
import { codexCatalog } from './fixtures/codex-catalog';

type Detail = ReturnType<TaskCoordinator['read']>;
export async function remoteTaskProbe(p: { root: string; center: string; sourceHome: string; targetHome: string; project: string; target: string;
    hapi: HapiHttp; env: NodeJS.ProcessEnv; base: string; selected?: string; context: string; skill: string; memory: string;
    claudeLog: string; probeLog: string; pids: Set<number>; cases: any[]; note: (message: string) => void;
    fixture: Awaited<ReturnType<typeof nativeUserSmoke>>; targetRunner: Awaited<ReturnType<Awaited<ReturnType<typeof nativeUserSmoke>>['runner']>>;
    cli: (home: string, args: string[], cwd?: string, input?: string) => any; git: (cwd: string, ...args: string[]) => string }) {
    const { cli, git } = p, cwd = join(p.project, 'app');
    const client = new HubTaskClient({ url: p.fixture.url, home: p.sourceHome, env: p.env }, cwd), artifacts = new ArtifactClient(p.hapi);
    const lines = (path: string): any[] => existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
    const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
    const until = async <T>(read: () => Promise<T>, done: (item: T) => boolean, label: string, ms = 300_000): Promise<T> => {
        const deadline = Date.now() + ms;
        while (Date.now() < deadline) { const value = await read(); if (done(value)) return value; await Bun.sleep(200); }
        throw new Error(`Observation deadline: ${label}`);
    };
    const flavors = (['codex', 'claude'] as const).filter(flavor => !p.selected || flavor === p.selected);
    const tasks: { id: string; flavor: string; last: Detail }[] = [];
    for (const flavor of flavors) {
        const runtime = p.targetRunner.runtimes[flavor];
        const repository = cli(p.sourceHome, ['repository', 'create', `Remote ${flavor}`, '--request-id', randomUUID()]).repository;
        cli(p.sourceHome, ['repository', 'bind', repository.id, '--machine', client.parent.machineId, '--cwd', cwd]);
        const definition = join(p.root, `task-agent-${flavor}.json`); writeFileSync(definition, JSON.stringify({ name: `Remote ${flavor}`, repositoryId: repository.id, runtimeId: runtime.id }));
        const agent = cli(p.sourceHome, ['agent', 'create', '--request-id', randomUUID(), '--file', definition]).agent;
        let id = '', previous: Detail | undefined;
        const result: any = { flavor, agentId: agent.id, repositoryId: repository.id, parentCwd: cwd, rounds: [] }; p.cases.push(result);
        for (let index = 0; index < 2; index++) {
            const marker = `${flavor.toUpperCase()}_ROUND_${index + 1}_${randomUUID()}`, inputFile = join(p.root, `input-${flavor}-${index}.txt`);
            writeFileSync(inputFile, marker); const input = await artifacts.upload(inputFile, randomUUID());
            const message = `这是已授权的 remote-probe 工程验收。使用工程 remote-probe skill，调用 keep_probe 的 probe_report。读取本轮输入附件并报告其完整内容；报告 pwd 和 app/note 的基线内容（当前 cwd 中的 note）。${index ? '复述上一轮 MEMORY_ 开头的完整记忆标记，不从文件读取。' : `记住并报告 ${p.memory}，不要把它写到文件中。`}
在当前工作目录写入 ${flavor}.txt，内容仅为附件完整内容和换行。再写 ${flavor}.bin，字节为附件文本重复 1024 次（不含换行，UTF-8）。允许 Python 或原生文件工具；不运行 Git 写命令，不提交、不修改其他文件。收尾由 HAPI 自动封存。
最后简短报告完整输入标记、记忆标记、当前 cwd、note 内容和两个生成文件名；从本工程 AGENTS.md/CLAUDE.md 指令与 remote-probe skill 原样报告 PROJECT_ 和 SKILL_ 开头的完整标记，不能只写“工程标记/skill标记”或省略 UUID。若需核对，仅读取 ../AGENTS.md、../CLAUDE.md 和工程 remote-probe skill。不要再次委派。`;
            const requestId = randomUUID();
            const accepted = index ? cli(p.sourceHome, ['task', 'send', id, '--message', message, '--input', `input.txt=${input.id}`, '--output', `${flavor}.txt`, '--request-id', requestId], cwd)
                : cli(p.sourceHome, ['task', 'spawn', agent.id, '--message', message, '--workspace-mode', 'worktree', '--base', p.base, '--input', `input.txt=${input.id}`, '--output', `${flavor}.txt`, '--request-id', requestId], cwd);
            id = accepted.agent_id; result.id = id;
            if (!index && flavor === flavors[0]) {
                writeFileSync(join(cwd, 'note'), 'parent branch advanced'); git(p.project, 'add', 'app/note'); git(p.project, 'commit', '-qm', 'move parent after acceptance');
                assert.notEqual(git(p.project, 'rev-parse', 'HEAD'), p.base);
            }
            const approved = new Set<string>();
            const read = async () => {
                const value = await client.read(id, { roundId: accepted.round_id, limit: 64_000 });
                for (const [permissionId, permission] of Object.entries(value.permissions ?? {})) if (!approved.has(permissionId)) {
                    assert(['Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'Skill', 'Bash', 'mcp__keep_probe__probe_report', 'keep_probe', 'exec_command', 'shell_command'].includes(permission.tool), `Unexpected fixture permission tool: ${permission.tool}`);
                    approved.add(permissionId); await client.permission(id, value.round_id, permissionId, 'approved');
                }
                if (value.phase === 'failed' || value.status === 'unknown') throw new Error(JSON.stringify({ stage: value.phase, attention: value.attention }));
                return value;
            };
            const running = await until(read, value => value.phase === 'running', `${flavor} round ${index + 1} start`);
            assert(running.environment.mode === 'worktree' && running.environment.remote);
            assert.equal(running.environment.remote.origin.baseCommit, p.base); assert.equal(running.environment.source.machineId, p.target);
            assert.equal(running.cwd, join(running.environment.checkout!, 'app')); assert.notEqual(running.cwd, cwd);
            assert.equal(readFileSync(join(running.cwd, 'note'), 'utf8'), 'committed baseline');
            const session = (await p.hapi.request(`/api/sessions/${running.session_id}`)).session;
            assert.deepEqual(session.metadata.disabledMcpServers, ['runweft']); assert.equal(session.metadata.path, running.cwd);
            const pid = running.host_pid ?? session.metadata.hostPid; assert(pid); p.pids.add(pid);
            if (previous) { assert.equal(running.session_id, previous.session_id); assert.equal(running.native_session_id, previous.native_session_id); assert.equal(running.cwd, previous.cwd); }
            if (flavor === 'codex') {
                const inventory = await until(() => codexCatalog(p.targetRunner.hapiHome, running.session_id!, running.native_session_id!, pid),
                    rows => rows.some(row => row.name === 'keep_probe' && row.tools.includes('probe_report')), 'Codex tool inventory');
                assert(!inventory.some(row => row.name === 'runweft' && row.tools.length));
            }
            // Each failure is injected only into this owned fixture, then repaired through the public retry-finish API.
            const checkout = running.environment.checkout!;
            let repair: () => void;
            if (flavor === 'claude' && index === 0) {
                const hooks = join(p.root, 'failing-hooks'); mkdirSync(hooks, { recursive: true });
                writeFileSync(join(hooks, 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o700 }); git(checkout, 'config', 'core.hooksPath', hooks);
                repair = () => { git(checkout, 'config', '--unset', 'core.hooksPath'); };
            } else if (index === 1 && flavor === 'codex') {
                const signer = join(p.root, 'failing-signer'); writeFileSync(signer, '#!/bin/sh\nexit 1\n', { mode: 0o700 });
                git(checkout, 'config', 'commit.gpgsign', 'true'); git(checkout, 'config', 'gpg.program', signer);
                repair = () => { git(checkout, 'config', 'commit.gpgsign', 'false'); git(checkout, 'config', '--unset', 'gpg.program'); };
            } else {
                const lock = git(checkout, 'rev-parse', '--path-format=absolute', '--git-path', 'index.lock');
                assert(!existsSync(lock)); writeFileSync(lock, 'owned test lock'); repair = () => rmSync(lock);
            }
            let held: Detail;
            try {
                held = await until(read, value => value.phase === 'finishing' && value.git !== 'not_applicable' && value.git.status === 'needs_attention', `${flavor} deliberate seal failure`);
                assert.equal(held.stop, 'stopped'); assert(held.native_status.every(item => item.phase === 'completed'));
                assert(!alive(pid)); assert.equal(held.code.status, 'pending');
            } finally { repair(); }
            await client.retryFinish(id, accepted.round_id);
            const done = await until(read, value => value.phase === 'finished' && value.code.status === 'available' && !value.code.cleanup_error && value.artifacts.status === 'delivered' && !value.artifacts.pending.length, `${flavor} recovered finish`);
            assert.equal(done.code.status, 'available'); assert.equal(done.artifacts.status, 'delivered'); assert.equal(done.stop, 'stopped'); assert(!alive(pid));
            assert(done.git !== 'not_applicable' && done.git.result_head && done.git.result_head !== done.git.start_head);
            for (const expected of [marker, p.context, p.skill, p.memory, running.cwd, 'committed baseline']) assert(done.report.text.includes(expected), `${flavor} missing report marker ${expected}`);
            assert.equal(readFileSync(join(running.cwd, `${flavor}.txt`), 'utf8').trim(), marker);
            assert.deepEqual(readFileSync(join(running.cwd, `${flavor}.bin`)), Buffer.from(marker.repeat(1024)));
            const delivered = done.artifacts.manifest!.items.find(item => item.name === `${flavor}.txt`)!; assert(delivered.artifactId);
            const outputPath = join(p.root, `delivered-${flavor}-${index}.txt`); await artifacts.download(delivered.artifactId, outputPath); assert.equal(readFileSync(outputPath, 'utf8').trim(), marker);
            assert(lines(p.probeLog).some(event => event.event === 'call' && event.cwd === running.cwd));
            if (flavor === 'claude') {
                const native = lines(p.claudeLog).filter(event => event.nativeSessionId === done.native_session_id);
                assert(native.length); assert(native.every(event => !event.tools.some((name: string) => name.startsWith('mcp__runweft__'))));
                assert(native.some(event => event.tools.includes('Agent') || event.tools.includes('Task')));
            }
            result.rounds.push({ roundId: done.round_id, sessionId: done.session_id, nativeId: done.native_session_id, pid, input: input.id, output: delivered.artifactId,
                resultHead: done.git.result_head, error: held!.git !== 'not_applicable' ? held!.git.error?.code : null, manifest: (await client.result(id, done.round_id)).manifests[0] });
            previous = done;
            p.note(`${flavor} remote task round ${index + 1}: automatic Git/input preparation, inherited skill and other MCP, native session reuse, stopped process, repaired seal failure and code/file publication`);
        }
        tasks.push({ id, flavor, last: previous! });
    }
    cli(p.targetHome, ['runner', 'stop']);
    writeFileSync(join(p.project, 'dirty-untracked'), 'preserve');
    const indexBefore = readFileSync(join(p.project, '.git/index')), configBefore = readFileSync(join(p.project, '.git/config'));
    for (const task of tasks) {
        const accepted = cli(p.sourceHome, ['task', 'result', 'fetch', task.id, '--request-id', randomUUID()], cwd);
        const result = await until(() => client.result(task.id, accepted.round_id), value => {
            if (value.fetches.at(-1)?.status === 'failed') throw new Error(JSON.stringify(value.fetches.at(-1)?.error));
            return value.fetches.at(-1)?.status === 'available' && !!value.fetches.at(-1)?.released;
        }, `${task.flavor} offline fetch`);
        assert.deepEqual(readFileSync(join(p.project, '.git/index')), indexBefore); assert.deepEqual(readFileSync(join(p.project, '.git/config')), configBefore);
        task.last.code.ref = result.code.ref; assert(result.code.ref);
    }
    for (const task of tasks) { git(p.project, 'merge', '--no-edit', task.last.code.ref!); git(p.project, 'lfs', 'checkout'); assert.equal(readFileSync(join(cwd, `${task.flavor}.txt`), 'utf8').trim(), resultMarker(task.last)); }
    assert.equal(readFileSync(join(p.project, 'dirty-untracked'), 'utf8'), 'preserve');
    p.note('both runtime tasks fetch through public CLI with target Runner stopped; original index/config stay unchanged and explicit merges recover both final code/LFS results');
}
function resultMarker(task: Detail) {
    const match = task.report.text.match(/(?:CODEX|CLAUDE)_ROUND_2_[a-f0-9-]{36}/); assert(match); return match[0];
}
