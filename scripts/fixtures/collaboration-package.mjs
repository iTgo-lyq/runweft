import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { assertCandidateBinaries } from './installed-binaries.mjs';

/** Only this family's current handoff and installed no-model lifecycle; business checks stay in consumers. */
export function collaborationPackage(file, binary, explicitHapi, expectedOwner) {
    file = resolve(file); binary = resolve(binary);
    const source = JSON.parse(readFileSync(file, 'utf8')), binaries = assertCandidateBinaries(binary, source.candidate.binaries, explicitHapi);
    assert(source.kind === 'collaboration-current' && source.success && source.handoff && source.cleanupErrors.length === 0 && !source.consumed, 'Requires live, unconsumed current collaboration handoff');
    assert.equal(source.cleanupOwner, expectedOwner);
    assert.equal(file, join(source.evidenceDir, 'evidence.json'));
    assert.equal(dirname(source.evidenceDir), resolve('.dev-smoke'));
    assert.equal(dirname(source.ownedRoot), tmpdir()); assert(basename(source.ownedRoot).startsWith('rw-collab-'));
    assert.equal(source.root, join(source.ownedRoot, '.dev-smoke')); assert(existsSync(source.root));
    const hash = bytes => createHash('sha256').update(bytes).digest('hex');
    const hapi = explicitHapi ? resolve(explicitHapi) : binaries.hapi.path;
    // Inspect only a private copy before any start or configuration write.
    const checkRoot = mkdtempSync(join(tmpdir(), 'runweft-handoff-check-')), copy = join(checkRoot, 'state.sqlite');
    let db;
    try {
        copyFileSync(source.serverPaths.state, copy);
        try { copyFileSync(source.serverPaths.state + '-wal', copy + '-wal'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        db = new DatabaseSync(copy, { readOnly: true });
        assert.equal(db.prepare('PRAGMA user_version').get().user_version, 19, 'Requires current state format; source remains untouched');
        assert.equal(db.prepare('SELECT COUNT(*) AS count FROM delegation_tasks').get().count, source.cases.length);
        for (const item of source.cases) {
            const task = JSON.parse(db.prepare('SELECT data FROM delegation_tasks WHERE id=?').get(item.taskId).data);
            assert.equal(task.hub.ownerId, source.ownerId); assert.equal(task.hub.spaceId, source.spaceId); assert.equal(task.target.machineId, item.targetMachineId);
            const rounds = db.prepare('SELECT id,data FROM delegation_rounds WHERE taskId=? ORDER BY ordinal').all(item.taskId);
            assert.deepEqual(rounds.map(round => round.id), item.rounds.map(round => round.roundId));
            for (const [index, record] of rounds.entries()) {
                const round = JSON.parse(record.data), saved = item.rounds[index].view;
                assert.equal(round.phase, 'finished'); assert.equal(round.stop, 'stopped'); assert.equal(round.finish, 'complete');
                assert.equal(round.sessionId, saved.session_id); assert.equal(round.nativeSessionId, saved.native_session_id);
                const inputs = db.prepare('SELECT id FROM delegation_inputs WHERE roundId=? ORDER BY rowid').all(round.id);
                assert.deepEqual(inputs.map(input => input.id), saved.inputs.map(input => input.id));
            }
        }
    } finally { try { db?.close(); } finally { rmSync(checkRoot, { recursive: true, force: true }); } }
    const env = { ...process.env, CODEX_HOME: source.nativeHomes.codex, CLAUDE_CONFIG_DIR: source.nativeHomes.claude };
    for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_') || key.startsWith('HAPI_') || ['CLI_API_TOKEN', 'DB_PATH', 'TELEGRAM_BOT_TOKEN'].includes(key)) delete env[key];
    if (source.remote) Object.assign(env, { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' });
    const secrets = [], pids = new Set(source.hostPids), started = [];
    for (const runner of source.runners) {
        secrets.push(JSON.parse(readFileSync(runner.paths.machineConnection, 'utf8')).active.token);
        const identity = JSON.parse(readFileSync(runner.paths.identityConnection, 'utf8')); secrets.push(identity.token);
        assert.equal(identity.ownerId, source.ownerId); assert.equal(identity.spaceId, source.spaceId);
    }
    const identity = JSON.parse(readFileSync(source.runners[0].paths.identityConnection, 'utf8'));
    let jwt;
    function cli(home, args, cwd = source.root, allowedExit = 0) {
        const result = spawnSync(binary, ['--home', home, '--json', ...args], { cwd, env, encoding: 'utf8', timeout: 60_000 });
        for (const secret of secrets) assert(!(result.stdout + result.stderr).includes(secret), 'Credential leaked in CLI output');
        assert.equal(result.status, allowedExit, `${args[0]}: ${result.stderr || result.error || result.signal}`); return JSON.parse(result.stdout);
    }
    async function api(path, method = 'GET') {
        if (!jwt) { const response = await fetch(source.url + '/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accessToken: identity.token, spaceId: source.spaceId }), signal: AbortSignal.timeout(10_000) }); assert(response.ok); jwt = (await response.json()).token; const claims = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()); assert.equal(claims.sub, source.ownerId); assert.equal(claims.space, source.spaceId); secrets.push(jwt); }
        const response = await fetch(source.url + path, { method, headers: { authorization: `Bearer ${jwt}` }, signal: AbortSignal.timeout(45_000) }); assert(response.ok, `Owner session API failed (${response.status})`); return response.json();
    }
    function history(directory) {
        const files = {};
        if (!existsSync(directory)) return files;
        for (const entry of readdirSync(directory, { withFileTypes: true })) { const path = join(directory, entry.name); if (entry.isDirectory()) Object.assign(files, history(path)); else if (entry.isFile() && entry.name.endsWith('.jsonl')) files[path] = hash(readFileSync(path)); }
        return files;
    }
    const histories = () => ({ ...history(source.nativeHomes.codex), ...history(source.nativeHomes.claude) }), before = histories();
    assert(Object.keys(before).length, 'Requires real retained native histories');
    async function start(runnerHomes) {
        cli(source.serverHome, ['config', 'set', 'hapi.executable', hapi]); started.push(source.serverHome); cli(source.serverHome, ['start']);
        for (const home of runnerHomes) { cli(home, ['config', 'set', 'hapi.executable', hapi]); started.push(home); cli(home, ['runner', 'start']); }
        await verifyNoReplay();
    }
    async function verifyNoReplay(released = false, fetchRevisions = {}) {
        const sessions = (await api('/api/sessions')).sessions;
        assert.deepEqual(sessions.map(session => session.id).sort(), source.sessionIds); assert(sessions.every(session => !session.active));
        assert.deepEqual(histories(), before, 'Read-only installed continuation changed native histories');
        for (const item of source.cases) for (const round of item.rounds) {
            const current = cli(item.clientHome, ['task', 'show', item.taskId, '--round', round.roundId], item.cwd);
            assert.deepEqual(current.inputs, round.view.inputs);
            if (released) {
                const execution = ({ code_revision, artifacts_revision, ...fields }) => fields;
                assert.deepEqual(current.rounds.map(execution), round.view.rounds.map(execution));
                for (const [index, actual] of current.rounds.entries()) for (const key of ['code_revision', 'artifacts_revision']) assert((actual[key] ?? 0) >= (round.view.rounds[index][key] ?? 0), 'Release revision regressed');
            } else {
                const expected = round.view.rounds.map(record => Object.hasOwn(fetchRevisions, record.id) ? { ...record, code_revision: fetchRevisions[record.id] } : record);
                assert.deepEqual(current.rounds, expected);
                assert.equal(current.code_revision, Object.hasOwn(fetchRevisions, round.roundId) ? fetchRevisions[round.roundId] : round.view.code_revision);
            }
            assert.equal(current.completed_revision, round.view.completed_revision); assert.equal(current.status, 'completed'); assert.equal(current.stop, 'stopped'); assert.equal(current.finish, 'complete');
            assert.equal(current.session_id, round.view.session_id); assert.equal(current.native_session_id, round.view.native_session_id); assert.deepEqual(current.report, round.view.report);
        }
    }
    const shutdownErrors = []; let quiesced = false, shutdownSafe = false;
    async function quiesce() {
        if (quiesced) return shutdownErrors;
        let sessionsStopped = false, stopped = true;
        const attempt = async action => { try { await action(); } catch (error) { shutdownErrors.push(String(error)); } };
        if (started.length) await attempt(async () => {
            const sessions = (await api('/api/sessions')).sessions;
            for (const session of sessions) { if (session.metadata?.hostPid) pids.add(session.metadata.hostPid); if (session.active) { shutdownErrors.push('Unexpected active session during no-model consumer'); await attempt(() => api(`/api/sessions/${session.id}/archive`, 'POST')); } }
            sessionsStopped = (await api('/api/sessions')).sessions.every(session => !session.active);
        });
        for (const home of [...started].reverse()) { await attempt(() => cli(home, ['stop'])); let confirmed = false; await attempt(() => { const status = cli(home, ['status']); assert(!status.service.running && !status.runner.running); confirmed = true; }); stopped &&= confirmed; }
        const deadline = Date.now() + 10_000;
        const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
        while ([...pids].some(alive) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
        const live = [...pids].filter(alive); for (const pid of live) shutdownErrors.push(`Process still alive: ${pid}`);
        shutdownSafe = sessionsStopped && stopped && !live.length; quiesced = true;
        return shutdownErrors;
    }
    function startRunner(home) { cli(home, ['config', 'set', 'hapi.executable', hapi]); started.push(home); cli(home, ['runner', 'start']); }
    async function close(success, consumerEvidence) {
        await quiesce(); const errors = [...shutdownErrors];
        const attempt = async action => { try { await action(); } catch (error) { errors.push(String(error)); } };
        if (shutdownSafe) {
            for (const runner of source.runners) for (const path of [runner.paths.identityConnection, runner.paths.machineConnection, runner.paths.pendingConnection, join(runner.paths.hapiClient, 'settings.json')]) await attempt(() => rmSync(path, { force: true }));
            for (const path of [join(source.root, 'identity.txt'), join(source.serverHome, 'server/hapi/settings.json'), join(source.serverHome, 'server/hapi/jwt-secret.json')]) await attempt(() => rmSync(path, { force: true }));
        } else errors.push('Shutdown uncertain; private connection secrets retained');
        if (success && !errors.length) await attempt(() => rmSync(source.ownedRoot, { recursive: true, force: true }));
        source.consumed = success && !errors.length; source.consumerEvidence = consumerEvidence;
        writeFileSync(file, JSON.stringify(source, null, 2), { mode: 0o600 });
        return errors;
    }
    return { source, binaries, hapi, env, cli, api, hash, start, startRunner, verifyNoReplay, quiesce, close };
}
