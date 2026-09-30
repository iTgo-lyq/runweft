import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { freePort } from '../src/services';
import { HapiClient } from '../src/hapi';
import pkg from '../package.json';
import { Database } from 'bun:sqlite';
import { configureSmokeCodexModel } from './fixtures/codex-model';

// Real missing-history acceptance. Every writable native home is a dedicated copy.
const executable = resolve(process.argv[2] ?? 'dist/runweft'), hapiExecutable = resolve(process.argv[3] ?? 'dist/hapi');
const previous = process.argv[4] ? JSON.parse(readFileSync(resolve(process.argv[4]), 'utf8')) : undefined;
mkdirSync('.dev-smoke', { recursive: true });
const root = previous?.root ?? mkdtempSync(resolve('.dev-smoke/reconstruction-'));
chmodSync(root, 0o700);
const home = join(root, 'runweft'), project = join(root, 'project');
mkdirSync(project, { mode: 0o700, recursive: true });
const env: NodeJS.ProcessEnv = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_')) delete env[key];
delete env.HAPI_CODEX_APP_SERVER_BIN; delete env.HAPI_SESSION_ID;
const claude = process.env.RUNWEFT_SMOKE_CLAUDE || Bun.which('iclaude') || Bun.which('claude');
assert(claude && Bun.which('codex'), 'Both authenticated native clients are required');
Object.assign(env, { HAPI_CLAUDE_PATH: claude, GIT_CEILING_DIRECTORIES: root });
const sourceCodex = process.env.CODEX_HOME ?? join(homedir(), '.codex');
const sourceClaude = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
function copy(source: string, target: string) {
    if (!existsSync(source)) return;
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    copyFileSync(source, target); chmodSync(target, 0o600);
}
function use(stage: string) {
    env.CODEX_HOME = join(root, stage, 'codex'); env.CLAUDE_CONFIG_DIR = join(root, stage, 'claude');
}
for (const stage of previous ? [] : ['original', 'empty-history']) {
    use(stage);
    for (const file of ['config.toml', 'auth.json']) copy(join(sourceCodex, file), join(env.CODEX_HOME!, file));
    configureSmokeCodexModel(join(env.CODEX_HOME!, 'config.toml'));
    copy(process.env.CLAUDE_CONFIG_DIR ? join(sourceClaude, '.claude.json') : join(homedir(), '.claude.json'), join(env.CLAUDE_CONFIG_DIR!, '.claude.json'));
    for (const file of ['settings.json', '.credentials.json']) copy(join(sourceClaude, file), join(env.CLAUDE_CONFIG_DIR!, file));
    const codexConfig = Bun.TOML.parse(readFileSync(join(env.CODEX_HOME!, 'config.toml'), 'utf8')) as any;
    for (const name of Object.keys(codexConfig.mcp_servers ?? {})) {
        assert.equal(spawnSync('codex', ['mcp', 'remove', name], { env, stdio: 'pipe' }).status, 0);
    }
    const preferences = join(env.CLAUDE_CONFIG_DIR!, '.claude.json');
    const config = existsSync(preferences) ? JSON.parse(readFileSync(preferences, 'utf8')) : {};
    config.mcpServers = {}; mkdirSync(dirname(preferences), { recursive: true, mode: 0o700 });
    writeFileSync(preferences, JSON.stringify(config), { mode: 0o600 });
}
use('original');
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const evidence: any = previous ?? { root, executable, hapiExecutable, hapiRevision: pkg.hapi.revision,
    codexModel: configureSmokeCodexModel(join(root, 'original/codex/config.toml')),
    binaries: { runweft: hash(executable), hapi: hash(hapiExecutable) }, startedAt: new Date().toISOString(),
    success: false, cases: [], checks: [], cleanupErrors: [] };
if (previous) {
    assert.equal(evidence.success, false); assert.deepEqual(evidence.cleanupErrors, []);
    assert.deepEqual(evidence.binaries, { runweft: hash(executable), hapi: hash(hapiExecutable) }, 'Continuation requires the same product binaries');
    assert(evidence.cases.every((item: any) => item.first?.status === 'completed' && item.first.stop === 'stopped' && !item.accepted));
    evidence.attempts ??= []; evidence.attempts.push({ finishedAt: evidence.finishedAt, error: evidence.error });
    delete evidence.error; delete evidence.finishedAt;
}
let started = false, token: string | undefined, hapi: HapiClient | undefined;
function save() { writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2), { mode: 0o600 }); }
function record(check: string) { evidence.checks.push(check); save(); console.log(`PASS ${check}`); }
function alive(pid: number) { try { process.kill(pid, 0); return true; } catch (error: any) { assert.equal(error.code, 'ESRCH'); return false; } }
function cli(args: string[]) {
    const result = spawnSync(executable, ['--home', home, '--json', ...args], { cwd: project, env, encoding: 'utf8', timeout: 65_000 });
    if (token) assert(!`${result.stdout}${result.stderr}`.includes(token), 'Credential leaked into CLI output');
    assert.equal(result.status, 0, `${args[0]} failed: ${result.stderr || result.error || result.signal}`);
    return JSON.parse(result.stdout);
}
async function complete(id: string) {
    let current: any;
    const deadline = Date.now() + 240_000;
    do {
        current = cli(['task', 'show', id]);
        if (['completed', 'failed', 'interrupted'].includes(current.status)) break;
        assert(!['unknown', 'needs_attention'].includes(current.status), `Execution needs attention: ${JSON.stringify(current.attention)}`);
        await Bun.sleep(500);
    } while (Date.now() < deadline);
    assert.equal(current.status, 'completed', `Round did not complete: ${current.status}`);
    assert.equal(current.stop, 'stopped'); assert.equal(current.finish, 'complete');
    assert.equal(current.inputs.length, 1); assert.equal(current.inputs[0].observation.phase, 'completed');
    assert.equal(current.inputs[0].observation.source, 'native');
    assert.equal(typeof current.host_pid, 'number');
    const stopDeadline = Date.now() + 10_000;
    while (alive(current.host_pid) && Date.now() < stopDeadline) await Bun.sleep(100);
    assert(!alive(current.host_pid), 'Native process did not exit');
    const native = (await hapi!.request(`/api/sessions/${current.session_id}`)).session;
    assert.equal(native.active, false); assert.equal(native.metadata.lifecycleState, 'archived');
    assert.deepEqual(native.metadata.disabledMcpServers, ['runweft']);
    assert.equal(native.metadata.path, project);
    return current;
}
function files(directory: string): string[] {
    if (!existsSync(directory)) return [];
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(directory, entry.name)) : entry.isFile() ? [join(directory, entry.name)] : []);
}
function history(flavor: string, id: string) {
    const directories = flavor === 'codex' ? ['original/codex/sessions', 'original/codex/archived_sessions'] : ['original/claude/projects'];
    const found = directories.flatMap(directory => files(join(root, directory))).filter(path => path.endsWith(`${id}.jsonl`));
    assert.equal(found.length, 1, `${flavor} original transcript must exist`);
    return { path: found[0]!, sha256: hash(found[0]!) };
}
console.log(`Evidence directory: ${root}`); save();
try {
    if (previous) assert.equal(cli(['status']).running, false, 'Acceptance continuation requires the existing service to be stopped');
    else {
        cli(['init']); cli(['config', 'set', 'server.port', String(await freePort())]);
        cli(['config', 'set', 'hapi.executable', hapiExecutable]);
    }
    const service = cli(['start']); started = true;
    token = JSON.parse(readFileSync(join(home, 'server/hapi/settings.json'), 'utf8')).cliApiToken; assert(token);
    hapi = new HapiClient(service.url, token); cli(['machine', 'register']);
    evidence.machineId = JSON.parse(readFileSync(join(home, 'connections/local/hapi/settings.json'), 'utf8')).machineId;
    for (const flavor of ['codex', 'claude']) {
        const retained = evidence.cases.find((item: any) => item.flavor === flavor);
        if (retained) {
            const current = cli(['task', 'show', retained.agentId]);
            assert.equal(current.round_id, retained.first.round_id); assert.equal(current.status, 'completed');
            assert.equal(current.stop, 'stopped'); assert(!alive(current.host_pid));
            retained.originalHistory = history(flavor, retained.first.native_session_id);
            const database = new Database(join(home, 'server/runweft/state.sqlite'), { readonly: true });
            try {
                const row: any = database.query('SELECT data FROM delegation_rounds WHERE id=?').get(current.round_id);
                retained.marker = JSON.parse(row.data).message.match(/RECONSTRUCTION_MEMORY_[a-f0-9-]+/)?.[0]; assert(retained.marker);
            } finally { database.close(); }
            record(`${flavor}: retained completed first round verified from native archive without model replay`);
            continue;
        }
        const runtime = cli(['runtime', 'register', flavor]).runtime;
        cli(['agent', 'init', flavor, '--runtime', runtime.id]);
        const marker = `RECONSTRUCTION_MEMORY_${crypto.randomUUID()}`;
        const first = cli(['task', 'spawn', flavor, '--message', `这是专用验证任务。记住 ${marker}，不要写入任何文件。不调用工具、不委派。只回复 FIRST_ROUND_OK，不要在回复中输出记忆标记。`]);
        const item: any = { flavor, runtime: { id: runtime.id, version: runtime.inspection.details.version }, agentId: first.agent_id };
        evidence.cases.push(item); save();
        item.first = await complete(first.agent_id);
        assert(item.first.report.text.includes('FIRST_ROUND_OK')); assert(!item.first.report.text.includes(marker));
        item.originalHistory = history(flavor, item.first.native_session_id);
        // Marker is only in the prior business input, not the next input or old report.
        item.marker = marker;
        record(`${flavor}: first native round completes and exits; original transcript is retained`);
    }
    cli(['stop']); started = false; hapi = undefined;
    use('empty-history');
    assert(!existsSync(join(env.CODEX_HOME!, 'sessions')));
    assert(!existsSync(join(env.CLAUDE_CONFIG_DIR!, 'projects')));
    const service2 = cli(['start']); started = true; hapi = new HapiClient(service2.url, token);
    assert.equal(JSON.parse(readFileSync(join(home, 'connections/local/hapi/settings.json'), 'utf8')).machineId, evidence.machineId);
    const before = (await hapi.request('/api/sessions')).sessions;
    assert.equal(before.length, 2); assert(before.every((session: any) => !session.active));
    record('same machine/runtime/business data restarted against empty native histories; original histories preserved');
    for (const item of evidence.cases) {
        const roundMarker = `CURRENT_ROUND_${crypto.randomUUID()}`;
        item.accepted = cli(['task', 'send', item.agentId, '--message', `这是本轮新任务：从提供的历史中找出上一轮要求记住的 RECONSTRUCTION_MEMORY_ 标记，原样回复它和 ${roundMarker}。不要执行旧任务；不调用任何工具、不读写文件、不委派。`]);
        save(); item.second = await complete(item.agentId);
        assert.equal(item.second.resume.outcome, 'missing');
        assert.equal(item.second.resume.previousSessionId, item.first.session_id);
        assert.equal(item.second.resume.previousNativeSessionId, item.first.native_session_id);
        assert.equal(item.second.reconstruction.reason, 'native_session_missing');
        assert.deepEqual(item.second.reconstruction.source_round_ids, [item.first.round_id]);
        assert.notEqual(item.second.native_session_id, item.first.native_session_id);
        assert.notEqual(item.second.session_id, item.first.session_id);
        assert.equal(item.second.cwd, item.first.cwd);
        assert(item.second.report.text.includes(item.marker)); assert(item.second.report.text.includes(roundMarker));
        assert.equal(item.second.inputs.length, 1);
        const old = cli(['task', 'show', item.agentId, '--round', item.first.round_id]);
        assert.equal(old.report.text, item.first.report.text);
        assert.equal(hash(item.originalHistory.path), item.originalHistory.sha256);
        record(`${item.flavor}: genuine missing session triggers bounded business reconstruction, exactly one new input, new native ID, correct memory and process exit`);
    }
    const after = (await hapi.request('/api/sessions')).sessions;
    assert.equal(after.length, 4); assert(after.every((session: any) => !session.active));
    assert.deepEqual(readdirSync(project), []);
    record('four archived sessions for four business rounds; unchanged shared cwd and original transcripts');
    const state = new Database(join(home, 'server/runweft/state.sqlite'), { readonly: true });
    try {
        for (const item of evidence.cases) {
            const transcript = files(join(root, 'empty-history', item.flavor)).filter(path => path.endsWith(`${item.second.native_session_id}.jsonl`));
            assert.equal(transcript.length, 1);
            const row: any = state.query('SELECT data FROM delegation_rounds WHERE id=?').get(item.second.round_id);
            const round = JSON.parse(row.data), marker = round.message.match(/CURRENT_ROUND_[a-f0-9-]+/)?.[0];
            assert(marker); assert(!round.message.includes(item.marker), 'The new business input must not supply the remembered marker');
            const events = readFileSync(transcript[0]!, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
            const users = events.filter(event => item.flavor === 'codex'
                ? event.type === 'response_item' && event.payload?.type === 'message' && event.payload.role === 'user'
                : event.type === 'user' && event.message?.role === 'user');
            const matches = users.filter(event => JSON.stringify(event).includes(marker));
            assert.equal(matches.length, 1, 'Exactly one current-round input must reach the native transcript');
            assert(JSON.stringify(matches[0]).includes(item.marker), 'Reconstructed history must reach the native input');
            assert.equal(hash(item.originalHistory.path), item.originalHistory.sha256);
            item.nativeInputAudit = { transcript: transcript[0], currentRoundInputs: matches.length, reconstructedMemoryIncluded: true, originalHistoryUnchanged: true };
        }
    } finally { state.close(); }
    evidence.nativeInputAudit = { passed: true, checkedAt: new Date().toISOString() };
    record('native transcripts prove exactly one new input with reconstructed memory; original histories remain byte-identical');
    evidence.success = true;
} catch (error) { evidence.error = String(error); process.exitCode = 1; }
finally {
    if (hapi) try { for (const session of (await hapi.request('/api/sessions')).sessions) if (session.active) {
        await hapi.request(`/api/sessions/${session.id}/archive`, { method: 'POST', signal: AbortSignal.timeout(45_000) });
    } } catch (error) { evidence.cleanupErrors.push(String(error)); }
    if (started) try { cli(['stop']); } catch (error) { evidence.cleanupErrors.push(String(error)); }
    if (evidence.cleanupErrors.length) { evidence.success = false; process.exitCode = 1; }
    evidence.finishedAt = new Date().toISOString(); save(); console.log(`Evidence: ${join(root, 'evidence.json')}`);
    if (evidence.error) console.error(evidence.error);
}
