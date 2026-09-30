import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { installedBinaries } from './fixtures/installed-binaries.mjs';

assert(process.argv[2] && process.argv[3], 'Supply compatible Hub baseline and candidate platform binaries');
const previous = resolve(process.argv[2]), candidate = resolve(process.argv[3]);
mkdirSync('.dev-smoke', { recursive: true });
const root = mkdtempSync(resolve('.dev-smoke/hub-upgrade-')), home = join(root, 'home');
const evidence = { root, previous: installedBinaries(previous), candidate: installedBinaries(candidate),
    scope: 'fresh dedicated Hub schema-18 data; no legacy root import or rollback', checks: [], success: false, cleanupErrors: [] };
assert.equal(evidence.previous.hapi.sha256, evidence.candidate.hapi.sha256);
const env = { ...process.env, CODEX_HOME: join(root, 'codex'), CLAUDE_CONFIG_DIR: join(root, 'claude') };
for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_') || key.startsWith('HAPI_') || ['DB_PATH', 'CLI_API_TOKEN', 'TELEGRAM_BOT_TOKEN'].includes(key)) delete env[key];
const secrets = [];
function cli(binary, args, expected = 0) {
    const result = spawnSync(binary, ['--home', home, '--json', ...args], { cwd: root, env, encoding: 'utf8', timeout: 65_000 });
    for (const secret of secrets) assert(!(result.stdout + result.stderr).includes(secret));
    assert.equal(result.status, expected, result.stderr || String(result.error));
    return JSON.parse(result.stdout);
}
function version(binary) {
    const result = spawnSync(binary, ['--version'], { env, encoding: 'utf8' }); assert.equal(result.status, 0); return result.stdout.trim();
}
const oldVersion = version(previous), newVersion = version(candidate);
const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`, port = server.address().port;
await new Promise(resolve => server.close(resolve));
try {
    cli(previous, ['init']); cli(previous, ['config', 'set', 'server.port', String(port)]); cli(previous, ['start']);
    const response = await fetch(url + '/api/runweft/hub/identities', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'upgrade owner' }) });
    assert.equal(response.status, 201); const user = await response.json(); secrets.push(user.token);
    cli(previous, ['config', 'set', 'hub.url', url]); const paths = cli(previous, ['paths']);
    mkdirSync(dirname(paths.identityConnection), { recursive: true, mode: 0o700 });
    writeFileSync(paths.identityConnection, JSON.stringify({ schemaVersion: 1, hub: url, ownerId: user.identity.id, spaceId: user.personalSpace.id,
        token: user.token, requestId: randomUUID(), createdAt: Date.now() }), { mode: 0o600 });
    const machine = cli(previous, ['machine', 'enroll']); cli(previous, ['machine', 'associate', machine.machineId, user.personalSpace.id]);
    cli(previous, ['runner', 'start']);
    const input = join(root, 'input.txt'); writeFileSync(input, 'UPGRADE_ARTIFACT_BYTES');
    const artifact = cli(previous, ['artifact', 'upload', input]);
    const repository = cli(previous, ['repository', 'create', 'Upgrade repository', '--request-id', randomUUID()]).repository;
    const definition = join(root, 'definition.json'); writeFileSync(definition, JSON.stringify({ name: 'Upgrade Agent', instructions: 'PRESERVE_DEFINITION', repositoryId: repository.id }));
    const agent = cli(previous, ['agent', 'create', '--file', definition, '--request-id', randomUUID()]).agent;
    const identity = readFileSync(paths.identityConnection), credentials = readFileSync(paths.machineConnection);
    mkdirSync(paths.taskWorkspaces, { recursive: true }); writeFileSync(join(paths.taskWorkspaces, 'keep.txt'), 'UPGRADE_WORKTREE');
    const observed = cli(candidate, ['status']);
    assert.equal(observed.version, oldVersion); assert.equal(observed.installedVersion, newVersion);
    assert.equal(observed.restartRequired, oldVersion !== newVersion);
    assert.equal(cli(candidate, ['doctor'], oldVersion === newVersion ? 0 : 1).ok, oldVersion === newVersion);
    evidence.checks.push('candidate diagnoses actual running baseline version without changing its identity or data');
    cli(previous, ['stop']); cli(candidate, ['start']); cli(candidate, ['runner', 'start']);
    assert.equal(cli(candidate, ['status']).version, newVersion); assert(cli(candidate, ['doctor']).ok);
    assert.deepEqual(readFileSync(paths.identityConnection), identity); assert.deepEqual(readFileSync(paths.machineConnection), credentials);
    assert.equal(cli(candidate, ['hub', 'identity']).identity.id, user.identity.id);
    assert.equal(cli(candidate, ['machine', 'enroll']).machineId, machine.machineId);
    assert.equal(cli(candidate, ['agent', 'show', agent.id]).agent.definition.instructions, 'PRESERVE_DEFINITION');
    assert.equal(cli(candidate, ['repository', 'show', repository.id]).repository.id, repository.id);
    const downloaded = join(root, 'downloaded.txt'); cli(candidate, ['artifact', 'download', artifact.id, '--output', downloaded]);
    assert.equal(readFileSync(downloaded, 'utf8'), 'UPGRADE_ARTIFACT_BYTES');
    assert.equal(readFileSync(join(paths.taskWorkspaces, 'keep.txt'), 'utf8'), 'UPGRADE_WORKTREE');
    evidence.versions = { previous: oldVersion, candidate: newVersion };
    evidence.checks.push('stopped upgrade preserves identity, machine, central Agent/repository, private artifact and retained workspace');
    evidence.success = true;
} catch (error) { evidence.error = error.message; throw error; }
finally {
    if (existsSync(join(home, 'config.yaml'))) try { cli(candidate, ['stop']); } catch (error) { evidence.cleanupErrors.push(error.message); }
    if (evidence.cleanupErrors.length) { evidence.success = false; process.exitCode = 1; }
    writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(`Evidence: ${join(root, 'evidence.json')}`);
}
