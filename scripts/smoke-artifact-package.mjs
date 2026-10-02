import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { installedBinaries } from './fixtures/installed-binaries.mjs';

// Consume only this producer's current completed fixture; never dispatch model work.
const executable = resolve(process.argv[2]), sourceFile = resolve(process.argv[3]);
const source = JSON.parse(readFileSync(sourceFile, 'utf8')), binaries = installedBinaries(executable);
assert(source.kind === 'artifact-mcp-current' && source.success && source.cleanupErrors.length === 0 && source.cases.length > 0 && !source.consumed, 'Requires unconsumed completed current artifact MCP evidence');
for (const name of ['runweft', 'hapi']) assert.equal(binaries[name].sha256, source.candidate.binaries[name].sha256, 'Candidate differs from producer');
assert.equal(dirname(source.root), resolve('.dev-smoke')); assert(basename(source.root).startsWith('artifact-mcp-'));
assert.equal(sourceFile, join(source.root, 'evidence.json')); assert(source.cleanupOwner === 'artifact-package');
const root = mkdtempSync(resolve('.dev-smoke/artifact-package-'));
const evidence = { kind: 'artifact-package-current', executable, binaries, root, fixture: sourceFile, checks: [], success: false, cleanupErrors: [] };
const env = { ...process.env }, started = [], secrets = [], pids = new Set();
for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_') || key.startsWith('HAPI_') || ['CLI_API_TOKEN', 'DB_PATH', 'TELEGRAM_BOT_TOKEN'].includes(key)) delete env[key];
Object.assign(env, { CODEX_HOME: source.nativeHomes.codex, CLAUDE_CONFIG_DIR: source.nativeHomes.claude });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function history(directory) {
    const files = {};
    if (!existsSync(directory)) return files;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) Object.assign(files, history(path));
        else if (entry.isFile() && entry.name.endsWith('.jsonl')) files[path] = sha(readFileSync(path));
    }
    return files;
}
const beforeHistory = { ...history(source.nativeHomes.codex), ...history(source.nativeHomes.claude) };
assert(Object.keys(beforeHistory).length > 0, 'Requires retained real native history');
function cli(home, args, cwd = root) {
    const result = spawnSync(executable, ['--home', home, '--json', ...args], { cwd, env, encoding: 'utf8', timeout: 60_000 });
    for (const secret of secrets) assert(!(result.stdout + result.stderr).includes(secret), 'Credential leaked in CLI output');
    assert.equal(result.status, 0, `${args[0]}: ${result.stderr || result.error || result.signal}`);
    return JSON.parse(result.stdout);
}
async function until(fn, good, label) {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) { const value = fn(); if (good(value)) return value; await new Promise(resolve => setTimeout(resolve, 200)); }
    throw new Error('Timeout: ' + label);
}
const identity = JSON.parse(readFileSync(source.runners[0].paths.identityConnection, 'utf8')); secrets.push(identity.token);
for (const runner of source.runners) secrets.push(JSON.parse(readFileSync(runner.paths.machineConnection, 'utf8')).active.token);
let jwt;
async function api(path, method = 'GET') {
    if (!jwt) {
        const reply = await fetch(source.url + '/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accessToken: identity.token, spaceId: source.spaceId }), signal: AbortSignal.timeout(10_000) });
        assert(reply.ok); jwt = (await reply.json()).token; secrets.push(jwt);
    }
    const reply = await fetch(source.url + path, { method, headers: { authorization: `Bearer ${jwt}` }, signal: AbortSignal.timeout(45_000) });
    assert(reply.ok, `Session API ${reply.status}`); return reply.json();
}
try {
    cli(source.serverHome, ['config', 'set', 'hapi.executable', binaries.hapi.path]);
    started.push(source.serverHome); cli(source.serverHome, ['start']);
    for (const runner of source.runners) { cli(runner.clientHome, ['config', 'set', 'hapi.executable', binaries.hapi.path]); started.push(runner.clientHome); cli(runner.clientHome, ['runner', 'start']); }
    for (const runner of source.runners) await until(() => cli(runner.clientHome, ['machine', 'list']), value => value.machines.some(machine => machine.id === runner.machineId && machine.online), 'Runner online');
    const initialSessions = (await api('/api/sessions')).sessions; assert.deepEqual(initialSessions.map(session => session.id).sort(), source.sessionIds); assert(initialSessions.every(session => !session.active));
    for (const item of source.cases) {
        assert(item.success && item.rounds.length === 2);
        const home = item.clientHome;
        for (const [index, record] of item.rounds.entries()) {
            const original = record.view, current = cli(home, ['task', 'show', original.agent_id, '--round', record.roundId], item.cwd);
            assert.equal(current.status, 'completed'); assert.equal(current.completed_revision, original.completed_revision);
            assert.equal(current.session_id, original.session_id); assert.equal(current.native_session_id, original.native_session_id);
            assert.deepEqual(current.report, original.report); assert.deepEqual(current.artifacts.manifest, original.artifacts.manifest);
            assert.deepEqual(current.inputs, original.inputs); assert.deepEqual(current.rounds, original.rounds); assert.equal(current.stop, 'stopped'); assert.equal(current.finish, 'complete');
            const session = (await api(`/api/sessions/${current.session_id}`)).session;
            assert.equal(session.active, false); assert.equal(session.metadata.lifecycleState, 'archived');
            if (session.metadata.hostPid) pids.add(session.metadata.hostPid);
            // Both 成果.txt and collected 遗漏.txt are actual retained byte objects.
            for (const [fileIndex, file] of current.artifacts.manifest.items.entries()) {
                assert.equal(file.status, 'available');
                assert.equal(cli(home, ['artifact', 'show', file.artifactId]).sha256, file.sha256);
                const path = join(root, `${item.id}-${index}-${fileIndex}.txt`);
                cli(home, ['artifact', 'download', file.artifactId, '--output', path]);
                const bytes = readFileSync(path); assert.equal(bytes.toString(), item.markers[index]); assert.equal(sha(bytes), file.sha256);
            }
            if (item.workspaceMode === 'worktree') assert(existsSync(original.cwd));
        }
        evidence.checks.push(`${item.id}: retained reports/native sessions/manifests and actual output SHA/bytes survive installed restart without dispatch`);
    }
    assert.deepEqual({ ...history(source.nativeHomes.codex), ...history(source.nativeHomes.claude) }, beforeHistory, 'Native history changed during read-only package verification');
    evidence.nativeHistoryFiles = Object.keys(beforeHistory).length;
    for (const item of source.cases) {
        const home = item.clientHome, id = item.rounds[0].view.agent_id;
        cli(home, ['task', 'artifacts', 'release', id, '--apply'], item.cwd);
        if (item.workspaceMode === 'worktree') assert(!item.rounds[0].view.environment.remote, 'This matrix has only local worktree results');
        for (const round of item.rounds) await until(() => cli(home, ['task', 'show', id, '--round', round.roundId], item.cwd), current => current.artifacts.retention.state === 'released' && current.artifacts.pending.length === 0 && current.input_files.download_retention === 'released', 'artifact/result release');
        if (item.workspaceMode === 'worktree') {
            cli(home, ['task', 'workspace', 'remove', id, '--discard-ignored'], item.cwd);
            await until(() => cli(home, ['task', 'show', id], item.cwd), current => current.environment.status === 'removed', 'workspace removal');
            const git = (...args) => { const result = spawnSync('git', ['-C', item.cwd, ...args], { env, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); };
            assert.equal(git('rev-parse', 'HEAD'), item.baseline); assert.equal(git('status', '--porcelain'), '');
            for (const round of item.rounds) {
                const current = cli(home, ['task', 'show', id, '--round', round.roundId], item.cwd);
                assert.deepEqual(current.report, round.view.report);
                assert.deepEqual(current.rounds.map(({ artifacts_revision, ...execution }) => execution), round.view.rounds.map(({ artifacts_revision, ...execution }) => execution));
                for (const [index, actual] of current.rounds.entries()) assert((actual.artifacts_revision ?? 0) >= (round.view.rounds[index].artifacts_revision ?? 0), 'Artifact release revision regressed');
                assert.equal(git('rev-parse', round.view.git.result_ref), round.view.git.result_head);
                assert.equal(git('show', `${round.view.git.result_ref}:成果.txt`), item.markers[item.rounds.indexOf(round)]);
            }
        }
    }
    const finalSessions = (await api('/api/sessions')).sessions; assert.deepEqual(finalSessions.map(session => session.id).sort(), source.sessionIds); assert(finalSessions.every(session => !session.active));
    evidence.success = true;
} catch (error) { evidence.error = error instanceof Error ? error.message : String(error); process.exitCode = 1; }
finally {
    const attempt = async action => { try { await action(); } catch (error) { evidence.cleanupErrors.push(String(error)); } };
    let sessionsStopped = false;
    if (started.length) await attempt(async () => { const { sessions } = await api('/api/sessions'); for (const session of sessions) { if (session.metadata?.hostPid) pids.add(session.metadata.hostPid); if (session.active) { evidence.success = false; process.exitCode = 1; evidence.cleanupErrors.push('Unexpected active native session during read-only consumer'); await attempt(() => api(`/api/sessions/${session.id}/archive`, 'POST')); } } sessionsStopped = (await api('/api/sessions')).sessions.every(session => !session.active); });
    let stopped = true;
    for (const home of [...started].reverse()) { await attempt(() => cli(home, ['stop'])); let confirmed = false; await attempt(() => { const status = cli(home, ['status']); assert(!status.service.running && !status.runner.running); confirmed = true; }); stopped &&= confirmed; }
    let hostsStopped = true;
    for (const pid of pids) { try { process.kill(pid, 0); hostsStopped = false; evidence.cleanupErrors.push(`Process still alive: ${pid}`); } catch {} }
    if (sessionsStopped && stopped && hostsStopped) {
        for (const runner of source.runners) for (const file of [runner.paths.identityConnection, runner.paths.machineConnection, runner.paths.pendingConnection, join(runner.paths.hapiClient, 'settings.json')]) await attempt(() => rmSync(file, { force: true }));
        for (const file of [join(source.root, 'identity.txt'), join(source.serverHome, 'server/hapi/settings.json'), join(source.serverHome, 'server/hapi/jwt-secret.json')]) await attempt(() => rmSync(file, { force: true }));
    } else evidence.cleanupErrors.push('Shutdown uncertain; connection secrets retained');
    if (evidence.cleanupErrors.length) { evidence.success = false; process.exitCode = 1; }
    if (evidence.success) for (const directory of [source.root, root]) for (const name of readdirSync(directory)) if (name !== 'evidence.json' && !name.endsWith('.log')) await attempt(() => rmSync(join(directory, name), { recursive: true, force: true }));
    if (evidence.cleanupErrors.length) { evidence.success = false; process.exitCode = 1; }
    source.consumed = evidence.success; source.consumerEvidence = join(root, 'evidence.json');
    writeFileSync(sourceFile, JSON.stringify(source, null, 2), { mode: 0o600 });
    writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2), { mode: 0o600 });
    console.log(`Installed artifact evidence: ${join(root, 'evidence.json')}`);
}
