import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { retainedWorktreeSmoke } from './fixtures/worktree-task-smoke';
import pkg from '../package.json';

// Every argument is a current worktree-tasks evidence file. Continue its existing identity/history.
const sources = process.argv.slice(2);
assert(sources.length, 'Pass evidence.json files produced by smoke-worktree-tasks.ts');
// Preflight every source before starting or mutating any fixture; reject duplicates and accepted third rounds.
const fixtures = sources.map(retainedWorktreeSmoke);
assert.equal(new Set(fixtures.map(fixture => fixture.prior.ownedRoot)).size, fixtures.length, 'Do not consume the same fixture twice');
mkdirSync('.dev-smoke', { recursive: true }); const root = mkdtempSync(resolve('.dev-smoke/worktree-lifecycle-'));
const evidence: any = { evidenceFormat: 'current-worktree-lifecycle-1', root, hapiRevision: pkg.hapi.revision, startedAt: new Date().toISOString(), success: false,
    cases: [], sources: [], cleanupErrors: [], hostPids: [], hapiSessionIds: [] };
const save = () => writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2), { mode: 0o600 });
console.log(`Evidence directory: ${root}`);
try {
    for (const [index, fixture] of fixtures.entries()) {
        const prior = fixture.prior, source = resolve(sources[index]), env = fixture.env;
        const sourceEvidence: any = { source, ownedRoot: prior.ownedRoot, invokedCLI: prior.invokedCLI, candidate: prior.candidate, handoff: prior.handoff,
            hostPids: [...prior.hostPids], hapiSessionIds: [...prior.hapiSessionIds], cleanupOwner: 'smoke-worktree-lifecycle final consumer' };
        evidence.sources.push(sourceEvidence); save();
        try {
        await fixture.start();
        for (const previous of prior.cases) {
            const cwd = previous.parentCwd, id = previous.taskId;
            const item: any = { flavor: previous.flavor, source, id, agentId: previous.agentId, repositoryId: previous.repositoryId, checks: [], approvals: [] }; evidence.cases.push(item);
            function cli(args: string[], expectedError?: string) {
                const result = fixture.run(prior.handoff.clientHome, args, { cwd });
                if (expectedError) { assert.notEqual(result.status, 0); assert((result.stdout + result.stderr).includes(expectedError)); return; }
                assert.equal(result.status, 0, `${args[0]}: ${result.stderr || result.error || result.signal}`); return JSON.parse(result.stdout);
            }
            function git(...args: string[]) {
                const result = spawnSync('git', ['-C', previous.project, ...args], { env, encoding: 'utf8', timeout: 20_000 });
                assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
            }
            function record(check: string) { item.checks.push(check); save(); console.log(`PASS ${previous.flavor}: ${check}`); }
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
                            } else throw new Error(`Unreviewed fixture permission: ${request.tool} (${taskId}/${detail.round_id}/${requestId})`);
                        }
                    }
                    await Bun.sleep(200);
                } while (Date.now() < deadline);
                throw new Error(`Fixture timed out: ${taskId}`);
            }
            {
                const old = cli(['task', 'show', id]); assert.equal(old.status, 'completed');
                const snapshot = { head: git('rev-parse', 'HEAD'), index: git('write-tree'), status: git('status', '--porcelain') };
                const common = git('rev-parse', '--path-format=absolute', '--git-common-dir'); appendFileSync(join(common, 'info/exclude'), '\ndeps/\n');
                const dep = join(old.cwd, 'deps/probe.txt'), marker = `DEPENDENCY_${crypto.randomUUID()}`;
                mkdirSync(join(old.cwd, 'deps'), { recursive: true }); writeFileSync(dep, marker);
                const memory = previous.memory; assert(memory && previous.rounds[1].report.text.includes(memory));
                const thirdAcceptance = cli(['task', 'send', id, '--message', '只读当前目录的 deps/probe.txt，在报告中原样返回其标记，以及此前要求记住的 MEMORY_ 开头标记，附 RETENTION_OK。不要修改文件、调用 MCP、委派或执行 Git 命令。']);
                item.thirdAcceptance = thirdAcceptance; save();
                const resumed = await until(id, detail => detail.round_id === thirdAcceptance.round_id && detail.status === 'completed', true); item.resumed = resumed; evidence.hostPids.push(resumed.host_pid); evidence.hapiSessionIds.push(resumed.session_id); save();
                assert.equal(resumed.native_session_id, previous.rounds[1].native_session_id); assert.equal(resumed.resume.outcome, 'resumed');
                assert(resumed.report.text.includes(memory) && resumed.report.text.includes(marker));
                assert.equal(resumed.git.start_head, old.git.result_head); assert.equal(resumed.git.result_head, old.git.result_head);
                assert.equal(resumed.git.file_count, 0); assert.equal(resumed.git.checkpoint, undefined);
                assert.equal(readFileSync(dep, 'utf8'), marker); assert.equal(git('rev-parse', 'HEAD'), snapshot.head);
                assert.equal(git('write-tree'), snapshot.index); assert.equal(git('status', '--porcelain'), snapshot.status);
                const alive = () => { try { process.kill(resumed.host_pid, 0); return true; } catch (error) { assert.equal((error as NodeJS.ErrnoException).code, 'ESRCH'); return false; } };
                const stopDeadline = Date.now() + 10_000; while (alive() && Date.now() < stopDeadline) await Bun.sleep(100);
                assert(!alive(), 'Execution wrapper remains live');
                record('service restart/native resume retain ignored dependencies and history; no changes create no commit');

                const hookDirectory = join(prior.root, `${previous.flavor}-lifecycle-hooks`); mkdirSync(hookDirectory);
                writeFileSync(join(hookDirectory, 'post-checkout'), '#!/bin/sh\nsleep 3\n', { mode: 0o755 });
                const savedHooks = spawnSync('git', ['-C', previous.project, 'config', '--get', 'core.hooksPath'], { env, encoding: 'utf8' });
                git('config', 'core.hooksPath', hookDirectory);
                let cancelled: any;
                try {
                    const accepted = cli(['task', 'spawn', previous.agentId, '--workspace-mode', 'worktree', '--message', '专用准备取消验收，此输入不应发送给模型。']);
                    item.preparationAcceptance = accepted; save();
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
                await fixture.restart();
                assert.equal(cli(['task', 'show', id]).git.removal.status, 'failed');
                cli(['task', 'workspace', 'remove', id, '--discard-ignored']);
                const removed = await until(id, detail => detail.git.retained === 'removed'); item.removed = removed;
                assert.equal(removed.report.text, resumed.report.text); assert(!existsSync(resumed.git.checkout));
                for (const detail of [previous.rounds[0], previous.rounds[1], resumed]) assert.equal(git('rev-parse', detail.git.result_ref), detail.git.result_head);
                cli(['task', 'send', id, '--message', 'Must refuse after explicit removal'], 'workspace_not_retained');
                assert.equal(cli(['task', 'workspace', 'remove', id]).environment.status, 'removed');
                cli(['task', 'workspace', 'remove', cancelled.agent_id]);
                await until(cancelled.agent_id, detail => detail.git.retained === 'removed');
                assert.equal(git('rev-parse', cancelled.git.result_ref), cancelled.git.result_head);
                assert.equal(cli(['task', 'list', '--all']).agents.find((task: any) => task.agent_id === id).git.retained, 'removed');
                record('ignored files block deletion; explicit discard removes checkout after restart and retains every report/result ref; future send is refused');
            }
        }
        } finally {
            for (const previous of prior.cases) if (previous.probeLog && existsSync(previous.probeLog)) try {
                for (const line of readFileSync(previous.probeLog, 'utf8').trim().split('\n').filter(Boolean)) try { sourceEvidence.hostPids.push(JSON.parse(line).pid); }
                catch { sourceEvidence.probeObservationIncomplete = true; evidence.cleanupErrors.push('Malformed owned project MCP observation: ' + previous.probeLog); }
            } catch { sourceEvidence.probeObservationIncomplete = true; evidence.cleanupErrors.push('Cannot read owned project MCP observations: ' + previous.probeLog); }
            sourceEvidence.hostPids.push(...evidence.cases.filter((item: any) => item.source === source && item.resumed).map((item: any) => item.resumed.host_pid));
            sourceEvidence.hapiSessionIds.push(...evidence.cases.filter((item: any) => item.source === source && item.resumed).map((item: any) => item.resumed.session_id));
            try { await fixture.close(sourceEvidence); } catch (error) { evidence.cleanupErrors.push(...(error instanceof AggregateError ? error.errors.map(String) : [String(error)])); }
            save();
        }
    }
    assert.equal(evidence.cases.length, fixtures.reduce((count, fixture) => count + fixture.prior.cases.length, 0));
    assert.deepEqual(evidence.cleanupErrors, []); evidence.success = true;
} catch (error) { evidence.error = error instanceof Error ? error.stack ?? error.message : String(error); process.exitCode = 1; }
finally {
    evidence.finishedAt = new Date().toISOString(); save();
    console.log(`Evidence: ${join(root, 'evidence.json')}`); if (evidence.error) console.error(evidence.error);
}
