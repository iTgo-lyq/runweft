import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { codexMcpDefinition, replaceCodexMcp } from '../../src/mcp/toml';
import { watchNativeHost } from './native-host';
import { codexCatalog } from './codex-catalog';
import { until, type NativeFixture } from './native-fixture';
import { nativeHistory } from './native-history';

function values(value: any): any[] {
    if (typeof value === 'string') { try { return values(JSON.parse(value)); } catch { return []; } }
    if (!value || typeof value !== 'object') return [];
    if (value.accepted === true || value.agent_id || value.agents || value.error) return [value];
    return Object.values(value).flatMap(values);
}
export async function collaboration(f: NativeFixture, id: string) {
    const remote = id === 'N5', worktree = id !== 'N1', host = id === 'N4' ? 'claude' : 'codex', flavor = remote ? 'claude' : 'codex';
    const { root, env, project: cwd, home, cli } = f;
    const targetHome = join(root, 'target'), target = remote ? await f.addRunner(targetHome, flavor) : f.runner;
    const marker = `RESULT_${crypto.randomUUID()}`, memory = `MEMORY_${crypto.randomUUID()}`, context = `CONTEXT_${crypto.randomUUID()}`;
    const input = [`INPUT_${crypto.randomUUID()}`, `INPUT_${crypto.randomUUID()}`], probeLog = join(root, 'probe.jsonl');
    const nativeConfig = (...args: string[]) => assert.equal(spawnSync('codex', ['mcp', ...args], { env, stdio: 'pipe' }).status, 0);
    const configPath = join(env.CODEX_HOME!, 'config.toml'), prefsPath = join(env.CLAUDE_CONFIG_DIR!, '.claude.json');
    const probe = { command: process.execPath, args: [resolve('test/acceptance/mcp-probe.mjs')], env: { RUNWEFT_SMOKE_PROBE_LOG: probeLog } };
    nativeConfig('add', 'keep_probe', '--env', `RUNWEFT_SMOKE_PROBE_LOG=${probeLog}`, '--', probe.command, ...probe.args);
    const prefs = JSON.parse(readFileSync(prefsPath, 'utf8')); prefs.mcpServers = { keep_probe: { type: 'stdio', ...probe } }; writeFileSync(prefsPath, JSON.stringify(prefs));
    function git(...args: string[]) {
        const result = spawnSync('git', ['-C', cwd, ...args], { env, encoding: 'utf8', timeout: 20_000 }); assert.equal(result.status, 0, 'Fixture Git command failed'); return result.stdout.trim();
    }
    let baseline = '', parent: any, repositoryId = null;
    if (worktree) {
        git('init', '-q'); git('config', 'user.name', 'Acceptance'); git('config', 'user.email', 'acceptance@example.invalid'); git('config', 'commit.gpgsign', 'false');
        for (const name of ['AGENTS.md', 'CLAUDE.md']) writeFileSync(join(cwd, name), `Only edit requested files. Include ${context} in the final report.\n`);
        if (id === 'N4') {
            mkdirSync(join(cwd, '.agents/skills/context'), { recursive: true });
            writeFileSync(join(cwd, '.agents/skills/context/SKILL.md'), '---\nname: context\ndescription: Use when asked for context skill.\n---\nInclude SKILL_OK in the final report.\n');
            mkdirSync(join(cwd, '.codex'));
            writeFileSync(join(cwd, '.codex/config.toml'), `[mcp_servers.project_probe]\ncommand = ${JSON.stringify(probe.command)}\nargs = ${JSON.stringify(probe.args)}\n[mcp_servers.project_probe.env]\nRUNWEFT_SMOKE_PROBE_LOG = ${JSON.stringify(probeLog)}\n`);
        }
        git('add', '.'); git('commit', '-qm', 'baseline'); baseline = git('rev-parse', 'HEAD'); git('tag', 'acceptance-base');
        writeFileSync(join(cwd, 'parent.txt'), 'parent dirty state\n');
        if (remote) for (const [index, value] of input.entries()) writeFileSync(join(cwd, `input-${index}.txt`), value);
        parent = { head: git('rev-parse', 'HEAD'), index: git('write-tree'), status: git('status', '--porcelain') };
        repositoryId = cli(['repository', 'create', 'Native repository', '--request-id', crypto.randomUUID()]).repository.id;
        cli(['repository', 'bind', repositoryId, '--machine', f.runner.machineId]);
    }
    const agent = f.agent(flavor, { repositoryId }, target.runtimes[flavor].id);
    cli(['mcp', 'install', '--client', 'all']); assert(cli(['mcp', 'check', '--client', 'all']).ok);
    const patch = (entry: any) => ({ ...entry, env: { ...entry.env, GIT_CEILING_DIRECTORIES: root } });
    const config = readFileSync(configPath, 'utf8');
    writeFileSync(configPath, replaceCodexMcp(config, codexMcpDefinition(patch((Bun.TOML.parse(config) as any).mcp_servers.runweft)), true));
    const updated = JSON.parse(readFileSync(prefsPath, 'utf8')); updated.mcpServers.runweft = patch(updated.mcpServers.runweft); writeFileSync(prefsPath, JSON.stringify(updated));
    const proof = join(root, 'child-boundary.json');
    const boundary = id === 'N4' ? '' : `执行一次 ${process.execPath} ${resolve('test/acceptance/child-boundary.mjs')} ${f.binaries.runweft.path} ${home} ${agent.id} ${proof}；输出 CHILD_BOUNDARY_OK 后继续，不再检查证明文件。`;
    const firstMessage = `${boundary}调用一次 keep_probe.probe_report。${id === 'N4' ? '使用 context skill，调用一次 project_probe.probe_report。' : ''}在任务真实 cwd 写 result.txt，完整内容为 ${marker} 加换行。${remote ? '读取本轮 input.txt 附件，在报告中包含完整内容。' : ''}记住 ${memory}，仅保留在会话内，不写文件或持久记忆。不修改其他文件、不提交、不委派。最终报告 FIRST_DONE${worktree ? '及工程指令标记' : ''}。`;
    const nextMessage = `回忆上一轮要求记住的 MEMORY_ 标记，不读文件找记忆。${remote ? '读取本轮 input.txt 附件，将 round2.txt 写为附件全文加换行，报告附件内容。' : '不要调用工具或修改文件。'}不委派、不提交。最终报告 RESUME_DONE 及原记忆标记。`;
    const prompt = `这是专用 Runweft MCP 验收。只用 runweft MCP 工具，严格执行：\n1. list_agent_definitions，选 ID ${agent.id}。\n2. ${remote ? 'upload_artifact 上传 input-0.txt。' : ''}只调用一次 spawn_agent，agent_type=${agent.id}，workspace_mode=${worktree ? 'worktree' : 'shared'}${worktree ? '，base_ref=acceptance-base' : ''}${remote ? '，inputs=[{artifactId:上传ID,name:"input.txt"}]，outputs=[{name:"result.txt",relativePath:"result.txt"}]' : ''}，message 完整照抄 ${JSON.stringify(firstMessage)}。wait 到 completed 后 read_agent。若有权限请求，只批准本任务要求的专用文件/命令。\n3. ${remote ? 'upload_artifact 上传 input-1.txt。' : ''}只调用一次 send_input，mode=next${remote ? '，inputs=[{artifactId:新上传ID,name:"input.txt"}]，outputs=[{name:"round2.txt",relativePath:"round2.txt"}]' : ''}，message 完整照抄 ${JSON.stringify(nextMessage)}。wait 到 completed，再 read_agent。\n4. ${remote ? '调用 fetch_result 取回第二轮成果。' : ''}回复 DONE。不得修改任务定义，不执行额外轮次。`;
    const args = host === 'codex' ? ['exec', '--json', '--skip-git-repo-check', prompt]
        : ['-p', '--model', f.selections.claude.model, '--effort', f.selections.claude.reasoningEffort, '--output-format', 'stream-json', '--verbose', '--tools', '', '--allowedTools', 'mcp__runweft__*', '--max-turns', '40', prompt];
    const child = spawn(host === 'codex' ? 'codex' : f.models.nativeClaude!, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    assert(child.pid); f.pids.add(child.pid);
    const watch = watchNativeHost(child, remote ? 900_000 : 420_000), calls = new Map<string, any>();
    let buffer = '', nativeId = '', done = false, failure: Error | undefined, code: number | null = null, inventory: any;
    child.stdout.on('data', chunk => {
        buffer += chunk;
        let end;
        while ((end = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
            let event: any; try { event = JSON.parse(line); } catch { continue; }
            if (event.type === 'thread.started') nativeId = event.thread_id;
            if (event.type === 'system' && event.subtype === 'init') nativeId = event.session_id;
            if (event.item?.type === 'mcp_tool_call' && event.item.server === 'runweft') {
                const tool = event.item; watch.progress(tool.tool);
                calls.set(tool.id, { name: tool.tool, args: tool.arguments, results: values(tool.result) });
            }
            for (const block of event.message?.content ?? []) {
                if (block.type === 'tool_use' && block.name.startsWith('mcp__runweft__')) { const name = block.name.slice(14); watch.progress(name); calls.set(block.id, { name, args: block.input }); }
                if (block.type === 'tool_result' && calls.has(block.tool_use_id)) calls.get(block.tool_use_id).results = values(block.content);
            }
        }
    });
    const exited = new Promise<void>(resolve => { child.once('error', error => { failure = error; done = true; resolve(); }); child.once('exit', status => { code = status; done = true; resolve(); }); });
    try {
        while (!done) {
            await Promise.race([exited, Bun.sleep(750)]);
            const tasks = cli(['task', 'list']).agents; assert(tasks.length <= 1, 'Host created duplicate task');
            if (tasks.length) {
                const current = cli(['task', 'show', tasks[0].agent_id]);
                if (current.host_pid) f.pids.add(current.host_pid);
                assert(!['unknown', 'failed', 'needs_attention'].includes(current.status), 'Native task failed or became unknown');
                if (id === 'N1' && !inventory && current.phase === 'running' && current.native_session_id) {
                    try { const found = await codexCatalog(cli(['paths']).hapiClient, current.session_id, current.native_session_id, current.host_pid);
                        if (found.some(s => s.name === 'keep_probe' && s.tools.includes('probe_report'))) inventory = found;
                    } catch { /* Native catalog may not be ready at the first observation. */ }
                }
            }
        }
        if (failure) throw failure; watch.check(code);
        const all = [...calls.values()], spawned = all.filter(c => c.name === 'spawn_agent'), sends = all.filter(c => c.name === 'send_input');
        assert.equal(spawned.length, 1); assert.equal(sends.length, 1); assert.equal(sends[0].args.message, nextMessage);
        const accepted = spawned[0].results.find((v: any) => v.accepted); assert(accepted);
        const second = await f.complete(accepted.agent_id), first = cli(['task', 'show', accepted.agent_id, '--round', accepted.round_id]);
        assert.equal(second.rounds.length, 2); assert.equal(first.parent.nativeSessionId, nativeId); assert.equal(first.parent.host, host);
        assert.equal(first.status, 'completed'); assert.equal(first.stop, 'stopped'); assert.equal(first.finish, 'complete');
        assert(first.report.text.includes('FIRST_DONE')); assert(second.report.text.includes('RESUME_DONE')); assert(second.report.text.includes(memory));
        assert.equal(second.native_session_id, first.native_session_id); assert.equal(second.resume.outcome, 'resumed');
        assert.equal(readFileSync(join(first.cwd, 'result.txt'), 'utf8'), marker + '\n');
        assert(readFileSync(probeLog, 'utf8').includes(first.cwd));
        if (id !== 'N4') assert.deepEqual(JSON.parse(readFileSync(proof, 'utf8')), { sessionId: first.session_id, denied: true });
        if (id === 'N1') { assert(inventory?.some((s: any) => s.name === 'keep_probe')); assert(!inventory.some((s: any) => s.name === 'runweft' && s.tools.length)); }
        if (id === 'N5') {
            const snapshots = readFileSync(join(root, 'claude-init.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line)).filter(v => v.hapiSessionId === first.session_id);
            assert(snapshots.length >= 2); assert(snapshots.every(v => v.tools.includes('mcp__keep_probe__probe_report') && !v.tools.some((t: string) => t.startsWith('mcp__runweft__'))));
        }
        if (worktree) {
            assert.equal(first.git.base_commit, baseline); assert.equal(first.git.status, 'sealed'); assert.equal(second.git.status, 'sealed');
            assert.equal(second.git.start_head, first.git.result_head); assert(first.report.text.includes(context));
            if (id === 'N4') assert(first.report.text.includes('SKILL_OK'));
            assert.notEqual(first.cwd, cwd); assert(!existsSync(join(cwd, 'result.txt')));
            assert.deepEqual({ head: git('rev-parse', 'HEAD'), index: git('write-tree'), status: git('status', '--porcelain') }, parent);
            if (remote) {
                assert.notEqual(f.runner.machineId, target.machineId);
                for (const [index, detail] of [first, second].entries()) {
                    assert(detail.report.text.includes(input[index])); assert.equal(detail.artifacts.status, 'delivered');
                    const output = cli(['artifact', 'download', detail.artifacts.manifest.items[0].artifactId, '--output', join(root, `output-${index}.txt`)]);
                    assert.equal(readFileSync(output.path, 'utf8'), (index ? input[index] : marker) + '\n');
                }
                f.stopRunners(); await f.restart();
                
                cli(['task', 'result', 'fetch', second.agent_id, '--round', second.round_id]);
                const fetched = await until(() => cli(['task', 'result', 'show', second.agent_id, '--round', second.round_id]), value => {
                    const latest = value.fetches.at(-1); assert.notEqual(latest?.status, 'failed'); return latest?.status === 'available' && latest.released;
                }, 'result fetch after Hub/Runner restart');
                assert.equal(git('show', `${fetched.code.ref}:result.txt`), marker);
                const unchanged = cli(['task', 'show', second.agent_id]); assert.equal(unchanged.rounds.length, 2); assert.equal(unchanged.native_session_id, second.native_session_id); assert.deepEqual(unchanged.report, second.report);
            } else assert.equal(git('show', `${second.git.result_ref}:result.txt`), marker);
        }
        const history = id !== 'N4' ? await nativeHistory(f, second) : undefined;
        return { taskId: second.agent_id, rounds: 2, host, flavor, history, restarted: remote, calls: all.map(c => c.name), hostDiagnostics: watch.state };
    } finally { if (!done) { child.kill('SIGTERM'); const kill = setTimeout(() => child.kill('SIGKILL'), 10_000); try { await exited; } finally { clearTimeout(kill); } } watch.close(); }
}
