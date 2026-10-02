import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { TaskOverview } from '../src/tasks/query';
import { collaborationPackage } from './fixtures/collaboration-package.mjs';

// Same installed candidate consumes only current collaboration remote Tasks; no model dispatch.
const binary = resolve(process.argv[2]!), hapiBinary = resolve(process.argv[3]!), fixtures = process.argv.slice(4).map(value => resolve(value));
assert(fixtures.length);
mkdirSync('.dev-smoke', { recursive: true }); const root = mkdtempSync(resolve('.dev-smoke/remote-package-'));
const evidence: any = { kind: 'remote-package-current', root, binary, hapiBinary, fixtures, success: false, cases: [], cleanupErrors: [] };
for (const file of fixtures) {
    let fixture: ReturnType<typeof collaborationPackage> | undefined, passed = false;
    try {
        assert(file.startsWith(resolve('.dev-smoke') + sep));
        fixture = collaborationPackage(file, binary, hapiBinary, 'remote-package');
        const previous = fixture.source; assert(previous.remote && previous.worktree && previous.cases.length > 0);
        const fetchRevisions: Record<string, number> = {};
        for (const item of previous.cases) assert(item.rounds.length === 2 && item.rounds.every((round: any) => round.view.status === 'completed' && round.view.stop === 'stopped'));
        const targets: string[] = [...new Set<string>(previous.cases.map((item: any) => item.targetHome))];
        const sources: string[] = [...new Set<string>(previous.cases.map((item: any) => item.clientHome))];
        for (const target of targets) assert.equal(fixture.cli(target, ['status']).runner.running, false, 'Executor Runner must remain stopped');
        await fixture.start(sources);
        fixture.cli(previous.serverHome, ['restart']);
        const readyUntil = Date.now() + 90_000;
        let sourceOnly = false;
        while (Date.now() < readyUntil) {
            const machines = fixture.cli(sources[0]!, ['machine', 'list']).machines.filter((machine: any) => machine.online);
            if (machines.length === sources.length && machines.every((machine: any) => previous.cases.some((item: any) => item.sourceMachineId === machine.id))) { sourceOnly = true; break; }
            await Bun.sleep(250);
        }
        assert(sourceOnly, 'Only actual source Runners should be online');
        for (const target of targets) assert.equal(fixture.cli(target, ['status']).runner.running, false);
        for (const item of previous.cases) {
            const source = item.clientHome, id = item.taskId, first = item.rounds[0].view, second = item.rounds[1].view;
            const overview = await fixture.api(`/api/runweft/tasks/overview?workspace=${encodeURIComponent(item.cwd)}`) as TaskOverview;
            const row = overview.items.find(row => row.id === id);
            assert(row, 'Installed overview must include retained native Task');
            assert(overview.items.every(row => row.id === id), 'Workspace/owner/space query included another fixture Task'); assert.equal(overview.inventory.available, true);
            assert.equal(row.round, 2); assert.equal(row.status, 'completed'); assert.equal(row.stop, 'stopped');
            assert.equal(row.parent.cwd, item.cwd); assert.equal(row.runtime.flavor, item.flavor); assert.equal(row.agent.id, item.agentId);
            assert.equal(row.workspace_mode, 'worktree'); assert.equal(row.cwd, first.cwd); assert.equal(row.machine.id, item.targetMachineId);
            assert.equal(row.machine.online, false); assert.equal(row.possibly_stale, false);
            assert.equal(row.code.status, 'available'); assert.equal(row.code.result_head, second.git.result_head);
            assert.equal(row.files.status, 'delivered'); assert.equal(row.session_id, second.session_id); assert(row.summary.length <= 1000);
            const digest = (path: string) => fixture!.hash(readFileSync(path)), protectedState = [digest(join(item.cwd, '.git/index')), digest(join(item.cwd, '.git/config'))];
            for (const [index, record] of item.rounds.entries()) {
                const round = record.view, shown = fixture.cli(source, ['task', 'show', id, '--round', record.roundId], item.cwd);
                const publicDetail = await fixture.api(`/api/runweft/tasks/details/${id}?roundId=${record.roundId}`);
                assert.equal(publicDetail.ownerId, previous.ownerId); assert.equal(publicDetail.spaceId, previous.spaceId);
                assert.equal(publicDetail.round_id, shown.round_id); assert.equal(publicDetail.session_id, shown.session_id); assert.equal(publicDetail.native_session_id, shown.native_session_id); assert.deepEqual(publicDetail.report, shown.report);
                assert.equal(shown.code.status, 'available'); assert.equal(shown.git.result_head, round.git.result_head); assert.deepEqual(shown.artifacts.manifest, round.artifacts.manifest);
                const output = shown.artifacts.manifest.items.find((value: any) => value.status === 'available'); assert(output);
                const destination = join(root, `${item.id}-${index + 1}-${randomUUID()}.txt`);
                fixture.cli(source, ['artifact', 'download', output.artifactId, '--output', destination], item.cwd);
                assert.equal(digest(destination), output.sha256); assert.equal(readFileSync(destination, 'utf8'), (index ? item.inputMarkers[1] : item.marker) + '\n');
            }
            const fetchRequestId = randomUUID();
            const accepted = fixture.cli(source, ['task', 'result', 'fetch', id, '--round', second.round_id, '--request-id', fetchRequestId], item.cwd);
            assert.equal(accepted.agent_id, id); assert.equal(accepted.round_id, second.round_id);
            const end = Date.now() + 120_000; let fetched = false;
            while (Date.now() < end) {
                const result: any = fixture.cli(source, ['task', 'result', 'show', id, '--round', accepted.round_id], item.cwd);
                assert.equal(result.agent_id, id); assert.equal(result.round_id, accepted.round_id);
                const matching = result.fetches.filter((fetch: any) => fetch.requestId === fetchRequestId); assert.equal(matching.length, 1);
                const operation = matching[0]; assert.equal(operation.roundId, accepted.round_id);
                if (operation.status === 'failed') throw new Error(JSON.stringify(operation.error));
                if (operation.status === 'available' && operation.released) {
                    assert.equal(result.code.status, 'available'); assert.equal(result.code.round_id, accepted.round_id);
                    assert.equal(result.code.result.resultHead, second.git.result_head);
                    assert(Number.isInteger(result.code_revision) && result.code_revision >= second.code_revision);
                    fetchRevisions[accepted.round_id] = result.code_revision; fetched = true; break;
                }
                await Bun.sleep(150);
            }
            assert(fetched); assert.deepEqual([digest(join(item.cwd, '.git/index')), digest(join(item.cwd, '.git/config'))], protectedState);
            assert(existsSync(first.cwd), 'Installing the package must retain executor checkout');
            evidence.cases.push({ fixture: file, taskId: id, resultHead: second.git.result_head, rounds: 2, executorOffline: true, ownerId: previous.ownerId, spaceId: previous.spaceId,
                dashboard: { status: row.status, phase: row.phase, stop: row.stop, sessionId: row.session_id, parent: row.parent, machineOnline: row.machine.online, code: row.code.status, files: row.files.status, summaryLength: row.summary.length } });
        }
        await fixture.verifyNoReplay(false, fetchRevisions);
        // Verification kept executor offline. Only now start it for normal explicit lifecycle termination.
        for (const target of targets) fixture.startRunner(target);
        for (const item of previous.cases) {
            const id = item.taskId, home = item.clientHome;
            fixture.cli(home, ['task', 'result', 'release', id, '--apply'], item.cwd); fixture.cli(home, ['task', 'artifacts', 'release', id, '--apply'], item.cwd);
            const deadline = Date.now() + 120_000; let released = false;
            while (Date.now() < deadline) {
                const details = item.rounds.map((round: any) => fixture!.cli(home, ['task', 'show', id, '--round', round.roundId], item.cwd));
                const result = fixture.cli(home, ['task', 'result', 'show', id], item.cwd);
                if (result.fetches.every((fetch: any) => fetch.released) && details.every((detail: any) => detail.code.retention.state === 'released' && detail.artifacts.retention.state === 'released' && detail.artifacts.pending.length === 0 && detail.input_files.download_retention === 'released')) { released = true; break; }
                await Bun.sleep(200);
            }
            assert(released, 'Remote releases did not finish');
            fixture.cli(home, ['task', 'workspace', 'remove', id, '--discard-ignored'], item.cwd);
            const end = Date.now() + 60_000; let removed = false;
            while (Date.now() < end) { const detail = fixture.cli(home, ['task', 'show', id], item.cwd); if (detail.environment.status === 'removed') { removed = true; break; } await Bun.sleep(200); }
            assert(removed, 'Remote workspace removal did not finish');
        }
        await fixture.verifyNoReplay(true); passed = true;
    } catch (error) { evidence.error = error instanceof Error ? error.message : String(error); process.exitCode = 1; }
    finally { if (fixture) evidence.cleanupErrors.push(...await fixture.close(passed, join(root, 'evidence.json'))); }
    if (!passed || evidence.cleanupErrors.length) break;
}
evidence.success = !evidence.error && !evidence.cleanupErrors.length;
if (!evidence.success) process.exitCode = 1;
if (evidence.success) for (const name of readdirSync(root)) if (!name.endsWith('.log')) try { rmSync(join(root, name), { recursive: true, force: true }); } catch (error) { evidence.cleanupErrors.push(String(error)); evidence.success = false; process.exitCode = 1; }
writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2), { mode: 0o600 }); console.log(`Installed remote-task evidence: ${join(root, 'evidence.json')}`);
if (evidence.error) console.error(evidence.error);
