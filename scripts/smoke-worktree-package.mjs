import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { collaborationPackage } from './fixtures/collaboration-package.mjs';

// Each argument is one explicitly selected completed current worktree case.
const executable = resolve(process.argv[2]), fixtures = process.argv.slice(3);
assert(fixtures.length, 'Pass completed worktree MCP evidence files');
const root = mkdtempSync(resolve('.dev-smoke/worktree-package-'));
const evidence = { kind: 'worktree-package-current', executable, root, cases: [], success: false, cleanupErrors: [] };
for (const file of fixtures) {
    let fixture, passed = false;
    try {
        fixture = collaborationPackage(file, executable, undefined, 'worktree-package');
        const previous = fixture.source; assert(previous.worktree && !previous.remote && previous.cases.length === 1 && previous.selected === previous.cases[0].id, 'Requires exactly one selected local worktree case');
        const item = previous.cases[0], home = item.clientHome, final = item.rounds.find(round => round.roundId === item.finalRoundId).view;
        assert(existsSync(item.rounds[0].view.cwd), 'Fixture checkout is already absent');
        const cli = (directory, args, allowedExit = 0) => fixture.cli(directory, args, item.cwd, allowedExit);
        const git = (...args) => { const result = spawnSync('git', ['-C', item.cwd, ...args], { env: fixture.env, encoding: 'utf8', timeout: 15_000 }); assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); };
        const source = () => ({ head: git('rev-parse', 'HEAD'), index: git('write-tree'), status: git('status', '--porcelain') });
        const storage = () => cli(home, ['doctor']).checks.find(check => check.name === 'task_workspaces');
        const result = { id: item.id, fixture: resolve(file) }; evidence.cases.push(result);
        await fixture.start(previous.runners.map(runner => runner.clientHome));
        const before = cli(home, ['task', 'show', item.taskId]); assert.equal(before.status, 'completed'); assert.equal(before.git.retained, 'retained'); assert.deepEqual(before.report, final.report);
        const paths = cli(home, ['paths']), initialStorage = storage(), initialSource = source();
        assert.equal(paths.taskWorkspaces, join(paths.hapiClient, 'workspaces/environments'));
        assert(initialStorage.ok); assert.equal(initialStorage.detail.checkoutCount, 1); assert.equal(initialStorage.detail.root, paths.taskWorkspaces); assert.equal(initialStorage.detail.scope, 'current_connection_on_this_machine');
        result.before = { git: before.git, storage: initialStorage, source: initialSource };
        cli(home, ['task', 'workspace', 'remove', item.taskId]);
        let after; const deadline = Date.now() + 30_000;
        do { after = cli(home, ['task', 'show', item.taskId]); if (after.git.retained === 'removed') break; assert(!after.git.removal?.error); await new Promise(resolve => setTimeout(resolve, 250)); } while (Date.now() < deadline);
        assert.equal(after.git.retained, 'removed'); assert(!existsSync(before.cwd)); assert.deepEqual(after.report, before.report); assert.equal(after.status, 'completed'); assert.deepEqual(after.rounds, final.rounds);
        for (const round of item.rounds) { assert.equal(git('rev-parse', round.view.git.result_ref), round.view.git.result_head); const current = cli(home, ['task', 'show', item.taskId, '--round', round.roundId]); assert.deepEqual(current.report, round.view.report); }
        assert.deepEqual(source(), initialSource); const finalStorage = storage(); assert(finalStorage.ok); assert.equal(finalStorage.detail.checkoutCount, 0);
        result.after = { git: after.git, storage: finalStorage };
        await fixture.verifyNoReplay();
        // Stop before running the existing offline diagnostic checks; close later still owns secrets.
        assert.deepEqual(await fixture.quiesce(), []);
        const offline = cli(home, ['doctor'], 1); assert.equal(offline.checks.find(check => check.name === 'task_workspaces').detail.checkoutCount, 0);
        for (const directory of [...previous.runners.map(runner => runner.clientHome), previous.serverHome]) { const status = cli(directory, ['status']); assert.equal(status.service.running, false); assert.equal(status.runner.running, false); }
        passed = true; result.success = true;
        console.log(`PASS installed ${item.id}: stored reports/native history, checkout cleanup, surviving Git refs and directory counts`);
    } catch (error) { evidence.error = error instanceof Error ? error.message : String(error); process.exitCode = 1; }
    finally { if (fixture) evidence.cleanupErrors.push(...await fixture.close(passed, join(root, 'evidence.json'))); }
    if (!passed || evidence.cleanupErrors.length) break;
}
evidence.success = !evidence.error && !evidence.cleanupErrors.length;
if (!evidence.success) process.exitCode = 1;
writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2), { mode: 0o600 });
console.log(`Evidence: ${join(root, 'evidence.json')}`);
