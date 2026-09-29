import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { HapiClient } from '../src/hapi';
import pkg from '../package.json';

// Continue completed dedicated fixtures; never discover or mutate a user's tasks.
const sources = process.argv.slice(2);
assert(sources.length, 'Pass evidence.json files produced by smoke-worktree-tasks.ts');
const executable = resolve('dist/runweft');
mkdirSync('.dev-smoke', { recursive: true });
const root = mkdtempSync(resolve('.dev-smoke/worktree-lifecycle-'));
const evidence: any = { root, executable, hapiRevision: pkg.hapi.revision, startedAt: new Date().toISOString(), success: false, cases: [], cleanupErrors: [] };
console.log(`Evidence directory: ${root}`);
try {
    for (const source of sources) {
        const prior = JSON.parse(readFileSync(source, 'utf8'));
        assert(resolve(prior.root).startsWith(resolve('.dev-smoke/worktree-tasks-')), 'Only dedicated worktree task fixtures are allowed');
        for (const previous of prior.cases.filter((item: any) => item.second?.status === 'completed')) {
            const home = join(prior.root, 'runweft'), cwd = join(previous.project, 'app'), id = previous.accepted.agent_id;
            const env: NodeJS.ProcessEnv = { ...process.env };
            for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_')) delete env[key];
            delete env.HAPI_SESSION_ID; delete env.HAPI_CODEX_APP_SERVER_BIN;
            Object.assign(env, { CODEX_HOME: join(prior.root, 'codex'), CLAUDE_CONFIG_DIR: join(prior.root, 'claude'),
                HAPI_CLAUDE_PATH: Bun.which('iclaude') ?? Bun.which('claude'), GIT_CEILING_DIRECTORIES: prior.root });
            const item: any = { flavor: previous.flavor, source, id, checks: [], approvals: [] }; evidence.cases.push(item);
            const token = JSON.parse(readFileSync(join(home, 'server/hapi/settings.json'), 'utf8')).cliApiToken;
            let hapi: HapiClient | undefined, started = false;
            function cli(args: string[], expectedError?: string) {
                const result = spawnSync(executable, ['--home', home, '--json', ...args], { cwd, env, encoding: 'utf8', timeout: 60_000 });
                assert(!`${result.stdout}${result.stderr}`.includes(token), 'Credential in CLI output');
                if (expectedError) {
                    assert.notEqual(result.status, 0); assert(`${result.stdout}${result.stderr}`.includes(expectedError)); return;
                }
                assert.equal(result.status, 0, `${args[0]}: ${result.stderr || result.error || result.signal}`);
                return JSON.parse(result.stdout);
            }
            function git(...args: string[]) {
                const result = spawnSync('git', ['-C', previous.project, ...args], { env, encoding: 'utf8', timeout: 20_000 });
                assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
            }
            function record(check: string) { item.checks.push(check); console.log(`PASS ${previous.flavor}: ${check}`); }
            async function until(taskId: string, condition: (detail: any) => boolean, model = false) {
                const deadline = Date.now() + 240_000, approvals = new Set<string>();
                do {
                    const detail = cli(['task', 'show', taskId]); item.lastObserved = detail;
                    if (condition(detail)) return detail;
                    if (model && ['failed', 'interrupted', 'unknown'].includes(detail.status)) throw new Error(JSON.stringify(detail.attention));
                    if (model && detail.status === 'needs_attention') {
                        if (detail.attention?.code !== 'permission_required') throw new Error(JSON.stringify(detail.attention));
                        for (const [requestId, request] of Object.entries(detail.permissions) as [string, any][]) {
                            if (approvals.has(requestId)) continue;
                            const argumentsText = JSON.stringify(request.arguments);
                            if (argumentsText.includes('deps/probe.txt') || (request.tool === 'Bash' && /^git (?:status(?: --short| --porcelain)?|diff --stat)$/.test(request.arguments?.command ?? ''))) {
                                cli(['task', 'permission', taskId, '--round', detail.round_id, '--request', requestId, '--decision', 'approved']);
                                approvals.add(requestId);
                                item.approvals.push({ round: detail.round_id, requestId, tool: request.tool });
                            } else if (item.pendingPermission !== requestId) {
                                item.pendingPermission = requestId; console.log(`Fixture permission needs review: ${taskId}/${detail.round_id}/${requestId}`);
                            }
                        }
                    }
                    await Bun.sleep(200);
                } while (Date.now() < deadline);
                throw new Error(`Fixture timed out: ${taskId}`);
            }
            try {
                const service = cli(['start']); started = true; hapi = new HapiClient(service.url, token);
                const old = cli(['task', 'show', id]); assert.equal(old.status, 'completed');
                const snapshot = { head: git('rev-parse', 'HEAD'), index: git('write-tree'), status: git('status', '--porcelain') };
                const common = git('rev-parse', '--path-format=absolute', '--git-common-dir'); appendFileSync(join(common, 'info/exclude'), '\ndeps/\n');
                const dep = join(old.cwd, 'deps/probe.txt'), marker = `DEPENDENCY_${crypto.randomUUID()}`;
                mkdirSync(join(old.cwd, 'deps'), { recursive: true }); writeFileSync(dep, marker);
                const memory = previous.second.report.text.match(/MEMORY_[a-f0-9-]+/)?.[0]; assert(memory);
                cli(['task', 'send', id, '--message', '只读当前目录的 deps/probe.txt，在报告中原样返回其标记，以及此前要求记住的 MEMORY_ 开头标记，附 RETENTION_OK。不要修改文件、调用 MCP、委派或执行 Git 命令。']);
                const resumed = await until(id, detail => detail.status === 'completed', true); item.resumed = resumed;
                assert.equal(resumed.native_session_id, previous.second.native_session_id); assert.equal(resumed.resume.outcome, 'resumed');
                assert(resumed.report.text.includes(memory) && resumed.report.text.includes(marker));
                assert.equal(resumed.git.start_head, old.git.result_head); assert.equal(resumed.git.result_head, old.git.result_head);
                assert.equal(resumed.git.file_count, 0); assert.equal(resumed.git.checkpoint, undefined);
                assert.equal(readFileSync(dep, 'utf8'), marker); assert.equal(git('rev-parse', 'HEAD'), snapshot.head);
                assert.equal(git('write-tree'), snapshot.index); assert.equal(git('status', '--porcelain'), snapshot.status);
                const alive = () => { try { process.kill(resumed.host_pid, 0); return true; } catch (error) { assert.equal((error as NodeJS.ErrnoException).code, 'ESRCH'); return false; } };
                const stopDeadline = Date.now() + 10_000; while (alive() && Date.now() < stopDeadline) await Bun.sleep(100);
                assert(!alive(), 'Execution wrapper remains live');
                record('service restart/native resume retain ignored dependencies and history; no changes create no commit');

                const hookDirectory = join(root, `${previous.flavor}-hooks`); mkdirSync(hookDirectory);
                writeFileSync(join(hookDirectory, 'post-checkout'), '#!/bin/sh\nsleep 3\n', { mode: 0o755 });
                const savedHooks = spawnSync('git', ['-C', previous.project, 'config', '--get', 'core.hooksPath'], { env, encoding: 'utf8' });
                git('config', 'core.hooksPath', hookDirectory);
                let cancelled: any;
                try {
                    const accepted = cli(['task', 'spawn', previous.flavor, '--workspace-mode', 'worktree', '--message', '专用准备取消验收，此输入不应发送给模型。']);
                    await until(accepted.agent_id, detail => detail.phase === 'preparing');
                    writeFileSync(join(previous.project, 'parent-later.txt'), `PARENT_${crypto.randomUUID()}\n`);
                    git('add', 'parent-later.txt'); git('commit', '-qm', 'fixture parent advances after task acceptance');
                    cli(['task', 'interrupt', accepted.agent_id, '--round', accepted.round_id]);
                    cancelled = await until(accepted.agent_id, detail => detail.status === 'interrupted'); item.cancelled = cancelled;
                    assert.equal(cancelled.execution_not_started, true); assert.equal(cancelled.session_id, undefined);
                    assert.equal(cancelled.git.status, 'sealed'); assert.equal(cancelled.git.partial, true); assert.equal(cancelled.git.file_count, 0);
                    assert.equal(cancelled.git.base_commit, snapshot.head); assert.equal(cancelled.git.result_head, snapshot.head);
                    assert.notEqual(cancelled.cwd, resumed.cwd); assert(!existsSync(join(cancelled.git.checkout, 'parent-later.txt')));
                } finally {
                    if (savedHooks.status === 0) git('config', 'core.hooksPath', savedHooks.stdout.trim());
                    else git('config', '--unset', 'core.hooksPath');
                }
                record('two tasks own separate worktrees; cancellation during preparation starts no model and keeps the accepted base despite parent advancement');

                cli(['task', 'workspace', 'remove', id]);
                const refused = await until(id, detail => detail.git.removal?.status === 'failed'); item.removalRefusal = refused.git.removal;
                assert.equal(refused.git.removal.error.code, 'workspace_ignored_files'); assert.equal(refused.git.retained, 'retained'); assert(existsSync(dep));
                cli(['restart']);
                assert.equal(cli(['task', 'show', id]).git.removal.status, 'failed');
                cli(['task', 'workspace', 'remove', id, '--discard-ignored']);
                const removed = await until(id, detail => detail.git.retained === 'removed'); item.removed = removed;
                assert.equal(removed.report.text, resumed.report.text); assert(!existsSync(resumed.git.checkout));
                for (const detail of [previous.first, previous.second, resumed]) assert.equal(git('rev-parse', detail.git.result_ref), detail.git.result_head);
                cli(['task', 'send', id, '--message', 'Must refuse after explicit removal'], 'workspace_not_retained');
                assert.equal(cli(['task', 'workspace', 'remove', id]).environment.status, 'removed');
                cli(['task', 'workspace', 'remove', cancelled.agent_id]);
                await until(cancelled.agent_id, detail => detail.git.retained === 'removed');
                assert.equal(git('rev-parse', cancelled.git.result_ref), cancelled.git.result_head);
                assert.equal(cli(['task', 'list', '--all']).agents.find((task: any) => task.agent_id === id).git.retained, 'removed');
                record('ignored files block deletion; explicit discard removes checkout after restart and retains every report/result ref; future send is refused');
            } finally {
                if (hapi) try { for (const session of (await hapi.request('/api/sessions')).sessions) if (session.active) {
                    await hapi.request(`/api/sessions/${session.id}/archive`, { method: 'POST', signal: AbortSignal.timeout(45_000) });
                } } catch (error) { evidence.cleanupErrors.push(String(error)); }
                if (started) try { cli(['stop']); } catch (error) { evidence.cleanupErrors.push(String(error)); }
            }
        }
    }
    assert(evidence.cases.length); assert.deepEqual(evidence.cleanupErrors, []); evidence.success = true;
} catch (error) { evidence.error = String(error); process.exitCode = 1; }
finally {
    evidence.finishedAt = new Date().toISOString(); writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(`Evidence: ${join(root, 'evidence.json')}`); if (evidence.error) console.error(evidence.error);
}
