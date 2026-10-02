import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from 'bun:sqlite';
import type { HapiHttp } from '../src/hapi';
import { HubClient } from '../src/hub/client';
import { hubConnectionPaths } from '../src/hub/resources/connection';
import { observeRepository } from '../src/hub/repositories/observation';
import { modelHomes } from './fixtures/model-homes';
import { nativeUserSmoke } from './fixtures/native-user-smoke';
import { nonGitSmokeProject } from './fixtures/non-git-smoke-project';
import { installedBinaries } from './fixtures/installed-binaries.mjs';
import { closeSmoke } from './fixtures/smoke-lifecycle';
import { removeFileSmokeData } from './fixtures/native-file-smoke';
import pkg from '../package.json';

// Compiled Task execution against empty native histories, never a format migration.
const invokedCLI = resolve(process.argv[2] ?? 'dist/runweft'), executable = installedBinaries(invokedCLI).runweft.path;
const hapiExecutable = realpathSync(resolve(process.argv[3] ?? installedBinaries(executable).hapi.path));
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const candidate = { cliBinary: executable, hapiBinary: hapiExecutable, hapiRevision: pkg.hapi.revision,
    hashes: { cli: hash(executable), hapi: hash(hapiExecutable) }, entry: 'compiled center/CLI + real HAPI/Runner + native histories' };
const previousFile = process.argv[4] ? realpathSync(resolve(process.argv[4])) : undefined;
const previous = previousFile ? JSON.parse(readFileSync(previousFile, 'utf8')) : undefined;
const failBeforeNext = process.env.RUNWEFT_SMOKE_RECONSTRUCTION_FAIL_BEFORE_NEXT === '1';
const env: NodeJS.ProcessEnv = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_') || key.startsWith('HAPI_') || ['CLI_API_TOKEN', 'DB_PATH', 'TELEGRAM_BOT_TOKEN'].includes(key)) delete env[key];
type Flavor = 'codex' | 'claude';
const selectedRuntime = process.env.RUNWEFT_SMOKE_RUNTIME;
assert(!selectedRuntime || ['codex', 'claude'].includes(selectedRuntime));
const flavors = (['codex', 'claude'] as Flavor[]).filter(flavor => !selectedRuntime || selectedRuntime === flavor);
const credentials = new Set<string>(), pids = new Set<number>(), sessionIds = new Set<string>();
let center: Awaited<ReturnType<typeof nativeUserSmoke>> | undefined, hapi: HapiHttp | undefined;
let constructorCleanupUncertain = false;
let nonGit: ReturnType<typeof nonGitSmokeProject> | undefined;
const models: ReturnType<typeof modelHomes>[] = [];

function alive(pid: number) { try { process.kill(pid, 0); return true; } catch (error: any) { assert.equal(error.code, 'ESRCH'); return false; } }
function files(directory: string): string[] {
    if (!existsSync(directory)) return [];
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(directory, entry.name)) : entry.isFile() ? [join(directory, entry.name)] : []);
}
function inside(root: string, path: string) {
    assert(realpathSync(path).startsWith(realpathSync(root) + '/'), 'Fixture path must remain inside its owned root');
}
function copiedState<T>(path: string, read: (db: Database) => T): T {
    const temporary = mkdtempSync(resolve('.dev-smoke/reconstruction-state-'));
    try {
        const copy = join(temporary, 'state.sqlite'); copyFileSync(path, copy);
        if (existsSync(path + '-wal')) copyFileSync(path + '-wal', copy + '-wal');
        const db = new Database(copy, { readonly: true });
        try { return read(db); } finally { db.close(); }
    } finally { rmSync(temporary, { recursive: true, force: true }); }
}
function validateFirst(db: Database, item: any, handoff: any, project: string) {
    assert(flavors.includes(item.flavor) && item.rounds.length === 1 && !item.secondAcceptance, 'Continuation cannot replay an accepted second round');
    const first = item.rounds[0];
    assert.equal(first.status, 'completed'); assert.equal(first.stop, 'stopped'); assert.equal(first.finish, 'complete');
    assert(!alive(first.host_pid), 'Continuation requires exited native hosts');
    const taskRow = db.query('SELECT data FROM delegation_tasks WHERE id=?').get(item.taskId) as any;
    assert(taskRow, 'Retained Task is missing');
    const task = JSON.parse(taskRow.data);
    assert.equal(task.version, 2); assert.equal(task.id, item.taskId); assert.equal(task.agent.id, item.agentId);
    assert.equal(task.parent.cwd, project); assert.equal(task.parent.machineId, handoff.machineId);
    assert.equal(task.hub.ownerId, handoff.ownerId); assert.equal(task.hub.spaceId, handoff.spaceId);
    assert.equal(task.target.runtimeId, item.runtime.id); assert.equal(task.target.machineId, handoff.machineId);
    const rows = db.query('SELECT data FROM delegation_rounds WHERE taskId=? ORDER BY ordinal').all(item.taskId) as any[];
    assert.equal(rows.length, 1, 'A second round was already accepted; do not send again');
    const round = JSON.parse(rows[0].data);
    assert.equal(round.id, first.round_id); assert.equal(round.phase, 'finished'); assert.equal(round.stop, 'stopped'); assert.equal(round.finish, 'complete');
    assert.equal(round.report, first.report.text); assert.equal(round.agent.hub.actorId, handoff.ownerId);
    assert.equal(round.sessionId, first.session_id); assert.equal(round.nativeSessionId, first.native_session_id);
    assert(round.message.includes(item.marker)); assert(!first.report.text.includes(item.marker), 'First report must not contain the memory marker in any field');
    assert.equal(hash(item.originalHistory.path), item.originalHistory.sha256);
}
function raw(home: string, args: string[], project: string) {
    const result = spawnSync(invokedCLI, ['--home', home, '--json', ...args], { cwd: project, env, encoding: 'utf8', timeout: 65_000 });
    for (const secret of credentials) assert(!(result.stdout + result.stderr).includes(secret), 'Credential leaked into CLI output');
    assert.equal(result.status, 0, args[0] + ' failed: ' + (result.stderr || result.error || result.signal));
    return JSON.parse(result.stdout);
}

// All retained-source checks precede chmod, stage changes or starting its service.
if (previous) {
    assert.equal(previous.evidenceFormat, 'current-reconstruction-1');
    assert(Array.isArray(previous.cases) && previous.cases.every((item: any) => !item.secondAcceptance && item.rounds?.length === 1), 'A second round was already accepted; do not send again');
    assert.equal(previous.success, false); assert.deepEqual(previous.cleanupErrors, []);
    assert.equal(previous.continuationReady, true, 'Only the explicit pre-second-round failure window may continue');
    assert.deepEqual(previous.candidate, candidate, 'Continuation requires the same CLI and HAPI candidates');
    assert.equal(realpathSync(previous.root), previous.root);
    assert(previous.root.startsWith(resolve('.dev-smoke/reconstruction-')));
    assert.equal(previousFile, join(previous.root, 'evidence.json'));
    const handoff = previous.handoff;
    assert.equal(handoff.serverHome, join(previous.root, 'center')); assert.equal(handoff.clientHome, join(previous.root, 'client'));
    assert.equal(handoff.statePath, join(handoff.serverHome, 'server/runweft/state.sqlite'));
    assert.equal(previous.project, join(previous.nonGitRoot, '.dev-smoke/project'));
    assert(realpathSync(previous.nonGitRoot).startsWith(join(realpathSync(tmpdir()), 'runweft-non-git-')));
    inside(previous.nonGitRoot, previous.project); assert.equal(observeRepository(previous.project).kind, 'non_git');
    assert.deepEqual(readdirSync(previous.project), []);
    for (const stage of ['original', 'empty-history']) for (const flavor of ['codex', 'claude'] as const) {
        assert.equal(previous.stageHomes[stage][flavor], join(previous.root, stage, flavor + '-home'));
        inside(previous.root, previous.stageHomes[stage][flavor]);
    }
    assert(!existsSync(join(previous.stageHomes['empty-history'].codex, 'sessions')));
    assert(!existsSync(join(previous.stageHomes['empty-history'].claude, 'projects')));
    assert(previous.cases.length > 0 && previous.cases.length <= 2);
    assert.equal(new Set(previous.cases.map((item: any) => item.flavor)).size, previous.cases.length);
    for (const item of previous.cases) inside(previous.stageHomes.original[item.flavor], item.originalHistory.path);
    const connection = hubConnectionPaths(handoff.clientHome, handoff.url);
    assert.equal(handoff.runnerNativeHome, join(connection.connection, 'hapi'));
    assert.equal(handoff.identityFile, join(previous.root, 'identity.txt'));
    const identity = JSON.parse(readFileSync(connection.identityConnection, 'utf8')), machine = JSON.parse(readFileSync(connection.machineConnection, 'utf8'));
    assert.equal(identity.ownerId, handoff.ownerId); assert.equal(identity.spaceId, handoff.spaceId); assert.equal(machine.machineId, handoff.machineId);
    credentials.add(identity.token); credentials.add(machine.active.token);
    env.CODEX_HOME = previous.stageHomes.original.codex; env.CLAUDE_CONFIG_DIR = previous.stageHomes.original.claude;
    env.HAPI_CLAUDE_PATH = previous.nativeClaude;
    assert.equal(raw(handoff.serverHome, ['status'], previous.project).service.running, false);
    assert.equal(raw(handoff.clientHome, ['status'], previous.project).runner.running, false);
    copiedState(handoff.statePath, db => {
        assert.equal((db.query('SELECT COUNT(*) AS count FROM delegation_tasks').get() as any).count, previous.cases.length);
        for (const item of previous.cases) validateFirst(db, item, handoff, previous.project);
    });
    for (const source of previous.sourceConfigurations) assert.equal(hash(source.path), source.sha256, 'Source model configuration changed');
}
mkdirSync('.dev-smoke', { recursive: true });
const root: string = previous?.root ?? mkdtempSync(resolve('.dev-smoke/reconstruction-'));
const evidence: any = previous ?? { evidenceFormat: 'current-reconstruction-1', root, candidate, startedAt: new Date().toISOString(),
    success: false, continuationReady: false, cleanupOwner: 'smoke-reconstruction final invocation', cases: [], checks: [], cleanupErrors: [] };
evidence.invokedCLI = invokedCLI;
for (const item of evidence.cases) for (const round of item.rounds) { pids.add(round.host_pid); sessionIds.add(round.session_id); }
if (previous) {
    evidence.attempts ??= []; evidence.attempts.push({ finishedAt: evidence.finishedAt, error: evidence.error });
    delete evidence.error; delete evidence.finishedAt; evidence.continuationReady = false;
}
function save() { writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2), { mode: 0o600 }); }
function record(check: string) { evidence.checks.push(check); save(); console.log('PASS ' + check); }
function use(stage: 'original' | 'empty-history') {
    env.CODEX_HOME = evidence.stageHomes[stage].codex; env.CLAUDE_CONFIG_DIR = evidence.stageHomes[stage].claude;
    env.HAPI_CLAUDE_PATH = evidence.nativeClaude;
}
function cli(args: string[], home = evidence.handoff.clientHome) { return raw(home, args, evidence.project); }
async function ready() {
    const deadline = Date.now() + 40_000;
    while (Date.now() < deadline) {
        const list = cli(['machine', 'list']).machines;
        if (list.some((machine: any) => machine.id === evidence.handoff.machineId && machine.online)) {
            const discovered = cli(['machine', 'discover', evidence.handoff.machineId]);
            if (flavors.every(flavor => discovered.tools.some((tool: any) => tool.flavor === flavor))) return;
        }
        await Bun.sleep(200);
    }
    throw new Error('Existing Runner discovery timed out');
}
async function complete(id: string) {
    let current: any;
    const deadline = Date.now() + 240_000;
    do {
        current = cli(['task', 'show', id]);
        if (['completed', 'failed', 'interrupted'].includes(current.status)) break;
        assert(!['unknown', 'needs_attention'].includes(current.status), 'Execution needs attention: ' + JSON.stringify(current.attention));
        await Bun.sleep(500);
    } while (Date.now() < deadline);
    assert.equal(current.status, 'completed'); assert.equal(current.stop, 'stopped'); assert.equal(current.finish, 'complete');
    assert.equal(current.inputs.length, 1); assert.equal(current.inputs[0].observation.phase, 'completed');
    assert.equal(current.inputs[0].observation.source, 'native'); sessionIds.add(current.session_id); assert.equal(typeof current.host_pid, 'number'); pids.add(current.host_pid);
    const deadlineStop = Date.now() + 10_000;
    while (alive(current.host_pid) && Date.now() < deadlineStop) await Bun.sleep(100);
    assert(!alive(current.host_pid), 'Native process did not exit');
    const native = (await hapi!.request('/api/sessions/' + current.session_id)).session;
    assert.equal(native.active, false); assert.equal(native.metadata.lifecycleState, 'archived');
    assert.deepEqual(native.metadata.disabledMcpServers, ['runweft']); assert.equal(native.metadata.path, evidence.project);
    return current;
}
function history(stage: 'original' | 'empty-history', flavor: Flavor, id: string) {
    const directories = flavor === 'codex' ? ['sessions', 'archived_sessions'] : ['projects'];
    const found = directories.flatMap(directory => files(join(evidence.stageHomes[stage][flavor], directory))).filter(path => path.endsWith(id + '.jsonl'));
    assert.equal(found.length, 1, flavor + ' native transcript must exist');
    return { path: found[0]!, sha256: hash(found[0]!) };
}
function businessRound(roundId: string) {
    return copiedState(evidence.handoff.statePath, db => {
        const row = db.query('SELECT data FROM delegation_rounds WHERE id=?').get(roundId) as any; assert(row); return JSON.parse(row.data);
    });
}
console.log('Evidence directory: ' + root);
try {
    chmodSync(root, 0o700);
    if (!previous) {
        nonGit = nonGitSmokeProject(); evidence.nonGitRoot = nonGit.root; evidence.project = nonGit.project;
        evidence.sourceConfigurations = [
            ...['config.toml', 'auth.json'].map(name => join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), name)),
            process.env.CLAUDE_CONFIG_DIR ? join(process.env.CLAUDE_CONFIG_DIR, '.claude.json') : join(homedir(), '.claude.json'),
            ...['settings.json', '.credentials.json'].map(name => join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), name)),
        ].filter(existsSync).map(path => ({ path, sha256: hash(path) }));
        evidence.stageHomes = {};
        for (const stage of ['original', 'empty-history'] as const) {
            const stageEnv = { ...env }, model = modelHomes(join(root, stage), stageEnv); models.push(model);
            evidence.stageHomes[stage] = { codex: stageEnv.CODEX_HOME, claude: stageEnv.CLAUDE_CONFIG_DIR };
            evidence.nativeClaude = model.nativeClaude; evidence.codexModel = model.codexModel;
            const config = join(stageEnv.CODEX_HOME!, 'config.toml');
            if (existsSync(config)) for (const name of Object.keys((Bun.TOML.parse(readFileSync(config, 'utf8')) as any).mcp_servers ?? {}))
                assert.equal(spawnSync('codex', ['mcp', 'remove', name], { env: stageEnv, stdio: 'pipe' }).status, 0);
            const prefs = join(stageEnv.CLAUDE_CONFIG_DIR!, '.claude.json'), value = existsSync(prefs) ? JSON.parse(readFileSync(prefs, 'utf8')) : {};
            value.mcpServers = {}; writeFileSync(prefs, JSON.stringify(value), { mode: 0o600 });
        }
        assert(Bun.which('codex')); use('original');
        try { center = await nativeUserSmoke(root, executable, env, hapiExecutable); }
        catch (error) { constructorCleanupUncertain = error instanceof AggregateError; throw error; }
        const home = join(root, 'client'), runner = await center.runner(home);
        credentials.add(center.user.token);
        evidence.handoff = { serverHome: center.server, clientHome: home, url: center.url, ownerId: center.user.identity.id,
            spaceId: center.space, machineId: runner.machineId, runnerNativeHome: runner.hapiHome,
            statePath: center.cli(center.server, ['paths']).state, identityFile: center.identityFile };
        credentials.add(JSON.parse(readFileSync(hubConnectionPaths(home, center.url).machineConnection, 'utf8')).active.token);
        hapi = runner.http; evidence.runtimes = {};
        for (const flavor of flavors) {
            const runtime = runner.runtimes[flavor], definition = join(root, flavor + '-agent.json');
            writeFileSync(definition, JSON.stringify({ name: 'Reconstruction ' + flavor, repositoryId: null, runtimeId: runtime.id }));
            const agent = cli(['agent', 'create', '--request-id', randomUUID(), '--file', definition]);
            evidence.runtimes[flavor] = { runtime: { id: runtime.id, flavor, version: runtime.inspection?.details?.version }, agentId: agent.agent.id };
        }
    } else {
        use('original'); cli(['start'], evidence.handoff.serverHome); cli(['runner', 'start']); await ready();
        hapi = new HubClient({ url: evidence.handoff.url, home: evidence.handoff.clientHome, env, space: evidence.handoff.spaceId }, 'hubAccess', 'unavailable').http;
    }
    save();
    for (const flavor of flavors) {
        const retained = evidence.cases.find((item: any) => item.flavor === flavor);
        if (retained) {
            const current = await complete(retained.taskId);
            assert.equal(current.round_id, retained.rounds[0].round_id); assert.deepEqual(current.report, retained.rounds[0].report);
            assert.deepEqual(history('original', flavor, current.native_session_id), retained.originalHistory);
            record(flavor + ': retained first round and native history verified without model replay');
            continue;
        }
        const marker = 'RECONSTRUCTION_MEMORY_' + randomUUID(), target = evidence.runtimes[flavor];
        const accepted = cli(['task', 'spawn', target.agentId, '--request-id', randomUUID(), '--message',
            '这是专用验证任务。记住 ' + marker + '，不要写入任何文件。不调用工具、不委派。只回复 FIRST_ROUND_OK。记忆标记不得出现在回复正文或任何结构化报告字段中，包括 summary、changes、tests、remaining；summary 只写 FIRST_ROUND_OK，其他字段保持为空，不复述任务要求。']);
        const item: any = { flavor, ...target, taskId: accepted.agent_id, firstAcceptance: accepted, rounds: [], marker };
        evidence.cases.push(item); save();
        const first = await complete(item.taskId); item.rounds.push(first); save();
        assert(first.report.text.includes('FIRST_ROUND_OK')); assert(!first.report.text.includes(marker), 'First report must not contain the memory marker in any field');
        item.originalHistory = history('original', flavor, first.native_session_id);
        assert(businessRound(first.round_id).message.includes(marker));
        record(flavor + ': first native round exits; memory is only in the business input and original transcript');
    }
    if (failBeforeNext) throw new Error('reconstruction_smoke_before_next: intentional failure before any second-round acceptance');
    cli(['runner', 'stop']); cli(['stop'], evidence.handoff.serverHome); hapi = undefined;
    use('empty-history');
    assert(!existsSync(join(env.CODEX_HOME!, 'sessions'))); assert(!existsSync(join(env.CLAUDE_CONFIG_DIR!, 'projects')));
    cli(['start'], evidence.handoff.serverHome); cli(['runner', 'start']); await ready();
    hapi = new HubClient({ url: evidence.handoff.url, home: evidence.handoff.clientHome, env, space: evidence.handoff.spaceId }, 'hubAccess', 'unavailable').http;
    assert.equal(JSON.parse(readFileSync(hubConnectionPaths(evidence.handoff.clientHome, evidence.handoff.url).machineConnection, 'utf8')).machineId, evidence.handoff.machineId);
    const before = (await hapi.request('/api/sessions')).sessions;
    assert.deepEqual(before.map((session: any) => session.id).sort(), evidence.cases.map((item: any) => item.rounds[0].session_id).sort()); assert(before.every((session: any) => !session.active && session.metadata.lifecycleState === 'archived'));
    record('same Hub, machine, runtime and Tasks restart against empty native histories');
    for (const item of evidence.cases) {
        const first = item.rounds[0], roundMarker = 'CURRENT_ROUND_' + randomUUID(); item.currentRoundMarker = roundMarker;
        item.secondAcceptance = cli(['task', 'send', item.taskId, '--request-id', randomUUID(), '--message',
            '这是本轮新任务：从提供的历史中找出上一轮要求记住的 RECONSTRUCTION_MEMORY_ 标记，原样回复它和 ' + roundMarker + '。不要执行旧任务；不调用任何工具、不读写文件、不委派。']);
        save();
        const second = await complete(item.taskId); item.rounds.push(second); save();
        assert.equal(second.resume.outcome, 'missing'); assert.equal(second.resume.previousSessionId, first.session_id);
        assert.equal(second.resume.previousNativeSessionId, first.native_session_id);
        assert.equal(second.reconstruction.reason, 'native_session_missing'); assert.deepEqual(second.reconstruction.source_round_ids, [first.round_id]);
        assert.notEqual(second.native_session_id, first.native_session_id); assert.notEqual(second.session_id, first.session_id);
        assert.equal(second.cwd, first.cwd); assert(second.report.text.includes(item.marker)); assert(second.report.text.includes(roundMarker));
        const old = cli(['task', 'show', item.taskId, '--round', first.round_id]);
        assert.deepEqual(old.report, first.report); assert.equal(hash(item.originalHistory.path), item.originalHistory.sha256);
        record(item.flavor + ': missing native history reconstructs one new input, new session and old business memory');
    }
    const after = (await hapi.request('/api/sessions')).sessions;
    assert.deepEqual(after.map((session: any) => session.id).sort(), evidence.cases.flatMap((item: any) => item.rounds.map((round: any) => round.session_id)).sort()); assert(after.every((session: any) => !session.active && session.metadata.lifecycleState === 'archived'));
    assert.deepEqual(readdirSync(evidence.project), []);
    record(`${after.length} archived native sessions match the selected business rounds, with an unchanged empty shared project`);
    for (const item of evidence.cases) {
        const second = item.rounds[1], transcript = history('empty-history', item.flavor, second.native_session_id);
        const round = businessRound(second.round_id); assert(round.message.includes(item.currentRoundMarker)); assert(!round.message.includes(item.marker));
        const events = readFileSync(transcript.path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
        const users = events.filter(event => item.flavor === 'codex'
            ? event.type === 'response_item' && event.payload?.type === 'message' && event.payload.role === 'user'
            : event.type === 'user' && event.message?.role === 'user');
        const matches = users.filter(event => JSON.stringify(event).includes(item.currentRoundMarker));
        assert.equal(matches.length, 1, 'Exactly one current-round user input must reach the native transcript');
        assert(JSON.stringify(matches[0]).includes(item.marker), 'Native input must include reconstructed prior memory');
        assert.equal(hash(item.originalHistory.path), item.originalHistory.sha256);
        item.nativeInputAudit = { transcript, currentRoundInputs: 1, reconstructedMemoryIncluded: true, originalHistoryUnchanged: true };
    }
    evidence.nativeInputAudit = { passed: true, checkedAt: new Date().toISOString() };
    record('actual native JSONL contains exactly one current-round input with memory; original history SHA is unchanged');
    evidence.success = true;
} catch (error) { evidence.error = String(error); process.exitCode = 1; }
finally {
    let shutdownSafe = !constructorCleanupUncertain;
    if (hapi) {
        let sessions: any[] = [];
        try { sessions = (await hapi.request('/api/sessions')).sessions; }
        catch (error) { shutdownSafe = false; evidence.cleanupErrors.push(String(error)); }
        for (const session of sessions) {
            sessionIds.add(session.id);
            if (session.metadata?.hostPid) pids.add(session.metadata.hostPid);
            if (session.active) try { await hapi.request('/api/sessions/' + session.id + '/archive', { method: 'POST', signal: AbortSignal.timeout(45_000) }); }
            catch (error) { shutdownSafe = false; evidence.cleanupErrors.push(String(error)); }
        }
    }
    if (evidence.handoff) {
        for (const [home, args] of [[evidence.handoff.clientHome, ['runner', 'stop']], [evidence.handoff.serverHome, ['stop']]] as const)
            try { cli([...args], home); } catch (error) { shutdownSafe = false; evidence.cleanupErrors.push(String(error)); }
        for (const [home, kind] of [[evidence.handoff.clientHome, 'runner'], [evidence.handoff.serverHome, 'service']] as const)
            try { assert.equal(cli(['status'], home)[kind].running, false); }
            catch (error) { shutdownSafe = false; evidence.cleanupErrors.push(String(error)); }
    }
    try {
        const deadline = Date.now() + 10_000;
        while ([...pids].some(alive) && Date.now() < deadline) await Bun.sleep(100);
        assert(![...pids].some(alive), 'Native host is still running');
    } catch (error) { shutdownSafe = false; evidence.cleanupErrors.push(String(error)); }
    for (const model of models) try { model.verify(); } catch (error) { evidence.cleanupErrors.push(String(error)); }
    for (const source of evidence.sourceConfigurations ?? []) try { assert.equal(hash(source.path), source.sha256, 'Source model configuration changed'); }
    catch (error) { evidence.cleanupErrors.push(String(error)); }
    // Preserve only the current, completed-first/no-second window, never accepted work for replay.
    let retain = false;
    if (shutdownSafe && !evidence.success && !evidence.cleanupErrors.length && evidence.handoff && evidence.cases.length) try {
        copiedState(evidence.handoff.statePath, db => {
            assert.equal((db.query('SELECT COUNT(*) AS count FROM delegation_tasks').get() as any).count, evidence.cases.length);
            for (const item of evidence.cases) validateFirst(db, item, evidence.handoff, evidence.project);
        });
        assert(!existsSync(join(evidence.stageHomes['empty-history'].codex, 'sessions')));
        assert(!existsSync(join(evidence.stageHomes['empty-history'].claude, 'projects')));
        retain = true;
    } catch { /* The failure is outside the explicitly resumable window. */ }
    evidence.continuationReady = retain;
    evidence.cleanupOwner = retain ? 'smoke-reconstruction authorized continuation of this current failed evidence' : 'smoke-reconstruction final invocation';
    if (center) try { await center.close(false, retain || !shutdownSafe); }
    catch (error) { if (!evidence.handoff) shutdownSafe = false; evidence.cleanupErrors.push(String(error)); }
    if (shutdownSafe && !retain) {
        const secrets: string[] = [];
        if (evidence.handoff) {
            const paths = hubConnectionPaths(evidence.handoff.clientHome, evidence.handoff.url);
            secrets.push(paths.identityConnection, paths.machineConnection, evidence.handoff.identityFile,
                join(evidence.handoff.runnerNativeHome, 'settings.json'),
                join(evidence.handoff.serverHome, 'server/hapi/settings.json'), join(evidence.handoff.serverHome, 'server/hapi/jwt-secret.json'));
        }
        for (const stage of ['original', 'empty-history']) for (const flavor of ['codex', 'claude'] as const) {
            const home = evidence.stageHomes?.[stage]?.[flavor]; if (!home) continue;
            for (const name of flavor === 'codex' ? ['config.toml', 'auth.json'] : ['.claude.json', 'settings.json', '.credentials.json']) secrets.push(join(home, name));
        }
        try { await closeSmoke([...models.map(model => () => model.remove()), ...secrets.map(path => () => rmSync(path, { force: true }))]); }
        catch (error) { evidence.cleanupErrors.push(String(error)); }
        if (evidence.success && !evidence.cleanupErrors.length) try {
            if (nonGit) nonGit.close(); else rmSync(evidence.nonGitRoot, { recursive: true, force: true });
            await removeFileSmokeData(root); evidence.disposableDataRemoved = true;
        } catch (error) { evidence.cleanupErrors.push(String(error)); }
        else try { if (nonGit) nonGit.close(); else if (evidence.nonGitRoot) rmSync(evidence.nonGitRoot, { recursive: true, force: true }); }
        catch (error) { evidence.cleanupErrors.push(String(error)); }
    }
    evidence.hostPids = [...pids]; evidence.hapiSessionIds = [...sessionIds];
    if (evidence.cleanupErrors.length) { evidence.success = false; evidence.continuationReady = false; process.exitCode = 1; }
    evidence.finishedAt = new Date().toISOString(); save(); console.log('Evidence: ' + join(root, 'evidence.json'));
    if (evidence.error) console.error(evidence.error);
}
