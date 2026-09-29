import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// Continue explicitly selected, completed model fixtures with the installed CLI; no model is restarted.
const executable = resolve(process.argv[2]);
const fixtures = process.argv.slice(3);
assert(fixtures.length, 'Pass completed worktree MCP evidence files');
const root = mkdtempSync(resolve('.dev-smoke/worktree-package-'));
const evidence = { executable, cases: [], success: false, cleanupErrors: [] };
try {
    for (const file of fixtures) {
        const previous = JSON.parse(readFileSync(file, 'utf8'));
        assert(previous.success && previous.worktree && previous.cases.length === 1);
        const item = previous.cases[0], local = join(previous.root, 'local');
        const home = join(previous.root, item.mode);
        assert(existsSync(item.first.cwd), 'Fixture checkout is already absent; do not replay this cleanup');
        const env = { ...process.env, CODEX_HOME: join(previous.root, 'codex'), CLAUDE_CONFIG_DIR: join(previous.root, 'claude') };
        for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_') || key === 'HAPI_SESSION_ID') delete env[key];
        const cli = (directory, args, allowedExit = 0) => {
            const result = spawnSync(executable, ['--home', directory, '--json', ...args], { cwd: item.cwd, env, encoding: 'utf8', timeout: 45_000 });
            assert.equal(result.status, allowedExit, `${args.join(' ')}: ${result.stderr || result.error}`);
            return JSON.parse(result.stdout);
        };
        const git = (...args) => {
            const result = spawnSync('git', ['-C', item.cwd, ...args], { env, encoding: 'utf8', timeout: 15_000 });
            assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
        };
        const source = () => ({ head: git('rev-parse', 'HEAD'), index: git('write-tree'), status: git('status', '--porcelain') });
        const storage = () => cli(home, ['doctor']).checks.find(check => check.name === 'task_workspaces');
        const result = { id: item.id, fixture: resolve(file) }; evidence.cases.push(result);
        const started = [];
        try {
            cli(local, ['start']); started.push(local);
            if (home !== local) { cli(home, ['start']); started.push(home); }
            const before = cli(home, ['task', 'show', item.final.agent_id]);
            assert.equal(before.status, 'completed'); assert.equal(before.git.retained, 'retained');
            assert.equal(before.report.text, item.final.report.text);
            const paths = cli(home, ['paths']), initialStorage = storage(), initialSource = source();
            assert.equal(paths.taskWorkspaces, join(paths.hapiClient, 'workspaces/environments'));
            assert(initialStorage.ok); assert.equal(initialStorage.detail.checkoutCount, 1);
            result.before = { git: before.git, storage: initialStorage, source: initialSource };
            cli(home, ['task', 'workspace', 'remove', before.agent_id]);
            let after;
            const deadline = Date.now() + 30_000;
            do {
                after = cli(home, ['task', 'show', before.agent_id]);
                if (after.git.retained === 'removed') break;
                assert(!after.git.removal?.error, JSON.stringify(after.git.removal?.error));
                await new Promise(resolve => setTimeout(resolve, 250));
            } while (Date.now() < deadline);
            assert.equal(after.git.retained, 'removed'); assert(!existsSync(before.cwd));
            assert.equal(after.report.text, before.report.text); assert.equal(after.status, 'completed');
            assert.equal(after.rounds.length, item.final.rounds.length);
            for (const round of [item.first, item.second, item.final]) assert.equal(git('rev-parse', round.git.result_ref), round.git.result_head);
            assert.deepEqual(source(), initialSource);
            const finalStorage = storage(); assert(finalStorage.ok); assert.equal(finalStorage.detail.checkoutCount, 0);
            result.after = { git: after.git, storage: finalStorage }; result.success = true;
            console.log(`PASS installed ${item.id}: stored report, retained checkout, explicit cleanup, surviving Git refs and directory count`);
        } finally {
            for (const directory of started.reverse()) try { cli(directory, ['stop']); }
            catch (error) { evidence.cleanupErrors.push(String(error)); }
        }
        // Offline diagnostics still locate/count the retained metadata without starting services.
        const offline = cli(home, ['doctor'], 1);
        assert.equal(offline.checks.find(check => check.name === 'task_workspaces').detail.checkoutCount, 0);
        assert.equal(cli(home, ['status']).running, false);
    }
    assert.equal(evidence.cleanupErrors.length, 0); evidence.success = true;
} finally {
    writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(`Installed workspace evidence: ${join(root, 'evidence.json')}`);
}
