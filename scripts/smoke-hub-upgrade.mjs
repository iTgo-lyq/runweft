import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { installedBinaries } from './fixtures/installed-binaries.mjs';

assert(process.argv[2] && process.argv[3], 'Supply schema-18 Hub baseline and current candidate platform binaries');
const previous = resolve(process.argv[2]), candidate = resolve(process.argv[3]);
mkdirSync('.dev-smoke', { recursive: true });
const root = mkdtempSync(resolve('.dev-smoke/hub-upgrade-'));
const evidence = { root, previous: installedBinaries(previous), candidate: installedBinaries(candidate),
    scope: 'schema-18 no-write refusal; fresh current-format same-candidate restart', checks: [], success: false, cleanupErrors: [] };
assert.equal(evidence.previous.hapi.sha256, evidence.candidate.hapi.sha256);
const env = { ...process.env, CODEX_HOME: join(root, 'codex'), CLAUDE_CONFIG_DIR: join(root, 'claude') };
for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_') || key.startsWith('HAPI_') || ['DB_PATH', 'CLI_API_TOKEN', 'TELEGRAM_BOT_TOKEN'].includes(key)) delete env[key];
const secrets = [], running = new Map();
function cli(binary, home, args, expected = 0) {
    const result = spawnSync(binary, ['--home', home, '--json', ...args], { cwd: root, env, encoding: 'utf8', timeout: 65_000 });
    for (const secret of secrets) assert(!(result.stdout + result.stderr).includes(secret));
    assert.equal(result.status, expected, result.stderr || String(result.error));
    return JSON.parse(result.stdout.trim() || result.stderr);
}
function files(root) {
    return readdirSync(root).sort().map(name => { const path = join(root, name), stat = statSync(path);
        return [name, stat.mode, stat.isDirectory() ? files(path) : createHash('sha256').update(readFileSync(path)).digest('hex')]; });
}
async function seed(binary, name) {
    const home = join(root, name), server = createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port, url = `http://127.0.0.1:${port}`;
    await new Promise(resolve => server.close(resolve));
    cli(binary, home, ['init']); cli(binary, home, ['config', 'set', 'server.port', String(port)]);
    running.set(home, binary); cli(binary, home, ['start']);
    const response = await fetch(url + '/api/runweft/hub/identities', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'format acceptance owner' }) });
    assert.equal(response.status, 201); const user = await response.json(); secrets.push(user.token);
    cli(binary, home, ['config', 'set', 'hub.url', url]); const paths = cli(binary, home, ['paths']);
    mkdirSync(dirname(paths.identityConnection), { recursive: true, mode: 0o700 });
    writeFileSync(paths.identityConnection, JSON.stringify({ schemaVersion: 1, hub: url, ownerId: user.identity.id, spaceId: user.personalSpace.id,
        token: user.token, requestId: randomUUID(), createdAt: Date.now() }), { mode: 0o600 });
    const machine = cli(binary, home, ['machine', 'enroll']); cli(binary, home, ['machine', 'associate', machine.machineId, user.personalSpace.id]);
    cli(binary, home, ['runner', 'start']);
    const input = join(root, 'input.txt'); writeFileSync(input, 'CURRENT_ARTIFACT_BYTES');
    const artifact = cli(binary, home, ['artifact', 'upload', input]);
    const repository = cli(binary, home, ['repository', 'create', 'Current repository', '--request-id', randomUUID()]).repository;
    const definition = join(root, 'definition.json'); writeFileSync(definition, JSON.stringify({ name: 'Current Agent', instructions: 'PRESERVE_DEFINITION', repositoryId: repository.id }));
    const agent = cli(binary, home, ['agent', 'create', '--file', definition, '--request-id', randomUUID()]).agent;
    const identity = readFileSync(paths.identityConnection), credentials = readFileSync(paths.machineConnection);
    mkdirSync(paths.taskWorkspaces, { recursive: true }); writeFileSync(join(paths.taskWorkspaces, 'keep.txt'), 'CURRENT_WORKTREE');
    return { home, paths, user, machine, artifact, repository, agent, identity, credentials };
}
function stop(binary, home) { cli(binary, home, ['stop']); running.delete(home); }
try {
    const old = await seed(previous, 'baseline-home');
    const observed = cli(candidate, old.home, ['status']);
    assert.equal(typeof observed.restartRequired, 'boolean');
    evidence.checks.push('candidate reads actual running baseline status');
    stop(previous, old.home);
    assert.equal(readFileSync(old.paths.state).readUInt32BE(60), 18, 'the baseline must actually use schema 18');
    const before = files(old.home);
    for (const action of ['start', 'serve', 'restart']) {
        const rejected = cli(candidate, old.home, [action], 1);
        assert.equal(rejected.error.code, 'state_format_unsupported'); assert.deepEqual(files(old.home), before);
    }
    evidence.checks.push('candidate start/serve/restart refuse actual baseline schema 18 without changing any home bytes, modes or files');
    const current = await seed(candidate, 'current-home');
    stop(candidate, current.home);
    assert.equal(readFileSync(current.paths.state).readUInt32BE(60), 19);
    running.set(current.home, candidate); cli(candidate, current.home, ['start']); cli(candidate, current.home, ['runner', 'start']);
    assert(cli(candidate, current.home, ['doctor']).ok);
    assert.deepEqual(readFileSync(current.paths.identityConnection), current.identity); assert.deepEqual(readFileSync(current.paths.machineConnection), current.credentials);
    assert.equal(cli(candidate, current.home, ['hub', 'identity']).identity.id, current.user.identity.id);
    assert.equal(cli(candidate, current.home, ['machine', 'enroll']).machineId, current.machine.machineId);
    assert.equal(cli(candidate, current.home, ['agent', 'show', current.agent.id]).agent.definition.instructions, 'PRESERVE_DEFINITION');
    assert.equal(cli(candidate, current.home, ['repository', 'show', current.repository.id]).repository.id, current.repository.id);
    const downloaded = join(root, 'downloaded.txt'); cli(candidate, current.home, ['artifact', 'download', current.artifact.id, '--output', downloaded]);
    assert.equal(readFileSync(downloaded, 'utf8'), 'CURRENT_ARTIFACT_BYTES');
    assert.equal(readFileSync(join(current.paths.taskWorkspaces, 'keep.txt'), 'utf8'), 'CURRENT_WORKTREE');
    evidence.checks.push('same candidate restarts fresh schema 19, preserving identity, machine, Agent, repository, artifact bytes and retained workspace');
    evidence.success = true;
} catch (error) { evidence.error = error.message; throw error; }
finally {
    for (const [home, binary] of running) try { stop(binary, home); } catch (error) { evidence.cleanupErrors.push(error.message); }
    if (evidence.cleanupErrors.length) { evidence.success = false; process.exitCode = 1; }
    else for (const name of ['baseline-home', 'current-home', 'codex', 'claude']) rmSync(join(root, name), { recursive: true, force: true });
    writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(`Evidence: ${join(root, 'evidence.json')}`);
}
