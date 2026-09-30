import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { Database } from 'bun:sqlite';
import { dataPaths, loadConfig, targetUrl } from '../src/config';
import { HapiClient } from '../src/hapi';

// Uses only a stopped, completed .dev-smoke fixture. Absolute Git/worktree paths stay fixed:
// preserve the original, test a working copy at its original path, then put the original back.
const [oldBinary, oldHapi, newBinary, newHapi, evidenceFile] = process.argv.slice(2).map(value => resolve(value));
assert(oldBinary && oldHapi && newBinary && newHapi && evidenceFile, 'Supply old/new CLI and HAPI binaries plus completed remote fixture evidence');
const fixture = JSON.parse(readFileSync(evidenceFile, 'utf8'));
const fixtureRoot = resolve(fixture.root);
assert(fixtureRoot.startsWith(resolve('.dev-smoke') + sep) && evidenceFile === join(fixtureRoot, 'evidence.json'));
assert(fixture.success && fixture.remote && fixture.cases.length > 0 && !fixture.cleanupErrors.length);
const root = mkdtempSync(resolve('.dev-smoke/upgrade-'));
const original = join(root, 'original'), backup = join(root, 'backup-0.1.0');
const center = join(fixtureRoot, 'local'), client = join(fixtureRoot, 'hub');
const env: NodeJS.ProcessEnv = { ...process.env, CODEX_HOME: join(fixtureRoot, 'codex'), CLAUDE_CONFIG_DIR: join(fixtureRoot, 'claude') };
for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_')) delete env[key];
delete env.HAPI_SESSION_ID;
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
assert.equal(hash(oldHapi), hash(newHapi), 'This acceptance covers the unchanged pinned HAPI build');
const evidence: any = { root, fixture: evidenceFile, scope: 'working copy of dedicated fixture at the same absolute paths; original restored afterward',
    binaries: { old: hash(oldBinary), new: hash(newBinary), oldHapi: hash(oldHapi), newHapi: hash(newHapi) }, checks: [], success: false, cleanupErrors: [] };
let moved = false, token: string | undefined;
const started: string[] = [];
function cli(binary: string, home: string, args: string[], expected = 0, cwd = fixtureRoot) {
    const result = spawnSync(binary, ['--home', home, '--json', ...args], { cwd, env, encoding: 'utf8', timeout: 65_000 });
    if (token) assert(!`${result.stdout}${result.stderr}`.includes(token));
    assert.equal(result.status, expected, `${args[0]}: ${result.stderr || result.error || result.signal}`);
    return JSON.parse(result.stdout);
}
function record(name: string) { evidence.checks.push(name); console.log(`PASS ${name}`); }
function alive(pid: number) { try { process.kill(pid, 0); return true; } catch (error: any) { assert.equal(error.code, 'ESRCH'); return false; } }
function fingerprint(directory: string) {
    const digest = createHash('sha256'); let count = 0;
    function walk(path: string, key: string) {
        for (const name of readdirSync(path).sort()) {
            const file = join(path, name), relative = `${key}/${name}`, stat = lstatSync(file);
            if (stat.isSocket() || stat.isFIFO()) continue;
            digest.update(`${relative}\0${stat.mode}\0`); count++;
            if (stat.isSymbolicLink()) digest.update(readlinkSync(file));
            else if (stat.isDirectory()) walk(file, relative);
            else if (stat.isFile()) digest.update(hash(file));
        }
    }
    walk(directory, ''); return { sha256: digest.digest('hex'), entries: count };
}
function copy(source: string, target: string) {
    cpSync(source, target, { recursive: true, preserveTimestamps: true,
        filter: path => { const stat = lstatSync(path); return !stat.isSocket() && !stat.isFIFO(); } });
}
function git(cwd: string, ...args: string[]) {
    const result = spawnSync('git', ['-C', cwd, ...args], { env, encoding: 'utf8', timeout: 10_000 });
    assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
}
function readonlyState() { return new Database(join(center, 'server/runweft/state.sqlite'), { readonly: true }); }
function assertFinished() {
    const db = readonlyState();
    try {
        assert.equal((db.query('PRAGMA user_version').get() as any).user_version, 6);
        const rows = db.query('SELECT data FROM delegation_rounds').all() as { data: string }[];
        assert(rows.length);
        for (const row of rows) { const round = JSON.parse(row.data); assert.equal(round.phase, 'finished'); assert.equal(round.stop, 'stopped'); }
    } finally { db.close(); }
}
async function start(binary: string, hapi: string) {
    for (const home of [center, client]) {
        cli(binary, home, ['config', 'set', 'hapi.executable', hapi]);
        // Register before start so failure cleanup still closes a partially started service.
        started.push(home); cli(binary, home, ['start']);
    }
    assert.equal(cli(binary, center, ['doctor']).ok, true);
}
function stop(binary: string) {
    while (started.length) { const home = started.at(-1)!; cli(binary, home, ['stop']); started.pop(); }
}
function identity() {
    const settings = JSON.parse(readFileSync(join(dataPaths(loadConfig(client, env)).hapiClient, 'settings.json'), 'utf8'));
    const server = JSON.parse(readFileSync(join(center, 'server/hapi/settings.json'), 'utf8'));
    return { machineId: settings.machineId, tokenHash: createHash('sha256').update(server.cliApiToken).digest('hex'),
        jwtHash: hash(join(center, 'server/hapi/jwt-secret.json')), ownerHash: hash(join(center, 'server/hapi/owner-id.json')) };
}
async function snapshot(binary: string) {
    const hapi = new HapiClient(targetUrl(loadConfig(client, env).config), token!);
    const tasks = fixture.cases.flatMap((item: any) => [item.first, item.second].map((round: any) => {
        const current = cli(binary, client, ['task', 'show', round.agent_id, '--round', round.round_id], 0, item.cwd);
        assert.equal(current.status, 'completed'); assert.equal(current.stop, 'stopped');
        assert.equal(current.session_id, round.session_id); assert.equal(current.native_session_id, round.native_session_id);
        assert.equal(current.report.text, round.report.text);
        return { id: current.agent_id, roundId: current.round_id, revision: current.completed_revision,
            report: current.report.text, sessionId: current.session_id, nativeId: current.native_session_id,
            artifacts: current.artifacts.manifest, code: { status: current.code.status, head: current.git.result_head, ref: current.code.ref } };
    }));
    return { identity: identity(), tasks, sessions: (await hapi.request('/api/sessions')).sessions.map((s: any) => ({ id: s.id, active: s.active })).sort((a: any, b: any) => a.id.localeCompare(b.id)),
        refs: fixture.cases.map((item: any) => ({ cwd: item.cwd, refs: git(item.cwd, 'show-ref'), head: git(item.cwd, 'rev-parse', 'HEAD'),
            index: hash(join(item.cwd, '.git/index')), config: hash(join(item.cwd, '.git/config')), retainedWorktree: existsSync(item.first.cwd) })),
        runtimes: cli(binary, client, ['runtime', 'list', '--all']).runtimes.map((r: any) => ({ id: r.id, machineId: r.machineId, flavor: r.flavor, registered: r.registered })).sort((a: any, b: any) => a.id.localeCompare(b.id)),
        bindings: cli(binary, client, ['workspace', 'list']).workspaces };
}
function download(binary: string, id: string, expectedHash: string, tag: string) {
    const output = join(root, `${tag}-${id}.bin`);
    cli(binary, client, ['artifact', 'download', id, '--output', output]); assert.equal(hash(output), expectedHash);
}
try {
    for (const home of [center, client, join(fixtureRoot, 'target-runner')]) {
        for (const file of [join(home, 'server/process.json'), join(dataPaths(loadConfig(home, env)).hapiClient, 'runner.state.json')]) {
            if (existsSync(file)) { const state = JSON.parse(readFileSync(file, 'utf8')); assert(!state.pid || !alive(state.pid), 'Fixture must be stopped'); }
        }
    }
    assertFinished();
    const url = targetUrl(loadConfig(center, env).config);
    let occupied = false; try { await fetch(url, { signal: AbortSignal.timeout(500) }); occupied = true; } catch { /* stopped fixture */ }
    assert(!occupied, 'Original fixture port is occupied; do not move its data');
    evidence.originalFingerprint = fingerprint(fixtureRoot);
    renameSync(fixtureRoot, original); moved = true; copy(original, fixtureRoot);
    token = JSON.parse(readFileSync(join(center, 'server/hapi/settings.json'), 'utf8')).cliApiToken;
    await start(oldBinary, oldHapi);
    assert.equal(cli(oldBinary, center, ['status']).version, '0.1.0');
    cli(oldBinary, client, ['workspace', 'bind', fixture.cases[0].cwd]);
    cli(oldBinary, client, ['agent', 'init', 'upgrade-old']);
    const oldFile = join(fixtureRoot, 'upgrade-old.txt'); writeFileSync(oldFile, `old-${randomUUID()}\n`);
    const oldArtifact = cli(oldBinary, client, ['artifact', 'upload', oldFile]);
    const before = await snapshot(oldBinary); evidence.before = before;
    const mismatch = cli(newBinary, center, ['status']);
    assert.equal(mismatch.version, '0.1.0'); assert.equal(mismatch.installedVersion, '1.0.0'); assert.equal(mismatch.restartRequired, true);
    const mismatchDoctor = cli(newBinary, center, ['doctor'], 1);
    assert.equal(mismatchDoctor.checks.find((c: any) => c.name === 'runweft').ok, false);
    evidence.versionMismatch = mismatch;
    stop(oldBinary); copy(fixtureRoot, backup); evidence.backupFingerprint = fingerprint(backup);
    record('0.1.0 writes real data; 1.0.0 diagnoses the running old service; stopped full backup includes Git/worktree and native data');

    await start(newBinary, newHapi);
    assert.equal(cli(newBinary, center, ['status']).version, '1.0.0');
    assert.equal(cli(newBinary, center, ['status']).restartRequired, false);
    assert.deepEqual(await snapshot(newBinary), before); assertFinished();
    for (const item of fixture.cases) for (const round of [item.first, item.second]) {
        const file = round.artifacts.manifest.items.find((f: any) => f.artifactId); assert(file);
        download(newBinary, file.artifactId, file.sha256, `upgraded-${round.round_id}`);
    }
    download(newBinary, oldArtifact.id, hash(oldFile), 'upgraded-old');
    assert.equal(cli(newBinary, client, ['agent', 'show', 'upgrade-old']).agent.id, 'upgrade-old');
    cli(newBinary, client, ['agent', 'init', 'upgrade-new']);
    const newFile = join(fixtureRoot, 'upgrade-new.txt'); writeFileSync(newFile, `new-${randomUUID()}\n`);
    const newArtifact = cli(newBinary, client, ['artifact', 'upload', newFile]);
    evidence.artifacts = { old: { id: oldArtifact.id, sha256: hash(oldFile) }, new: { id: newArtifact.id, sha256: hash(newFile) } };
    stop(newBinary);
    record('1.0.0 preserves identities, reports, native sessions, attachments, refs and worktrees; new artifacts and definitions are written');

    await start(oldBinary, oldHapi);
    assert.deepEqual(await snapshot(oldBinary), before); assertFinished();
    download(oldBinary, oldArtifact.id, evidence.artifacts.old.sha256, 'rollback-old');
    download(oldBinary, newArtifact.id, evidence.artifacts.new.sha256, 'rollback-new');
    assert.equal(cli(oldBinary, client, ['agent', 'show', 'upgrade-new']).agent.id, 'upgrade-new');
    stop(oldBinary);
    record('schema v6 rollback to 0.1.0 reads old native tasks and new 1.0.0 artifacts/definitions without deleting data');

    renameSync(fixtureRoot, join(root, 'upgraded-data')); copy(backup, fixtureRoot);
    assert.deepEqual(fingerprint(fixtureRoot), evidence.backupFingerprint);
    await start(newBinary, newHapi);
    assert.deepEqual(await snapshot(newBinary), before);
    download(newBinary, oldArtifact.id, evidence.artifacts.old.sha256, 'restored-old');
    const afterRestore = cli(newBinary, client, ['artifact', 'list']).artifacts;
    assert(afterRestore.some((a: any) => a.id === oldArtifact.id)); assert(!afterRestore.some((a: any) => a.id === newArtifact.id));
    assert(!existsSync(join(client, 'agents/upgrade-new.yaml')));
    stop(newBinary);
    record('stopped backup restores at original absolute paths; database and bytes agree and post-backup writes are absent');
    evidence.success = true;
} catch (error) { evidence.error = String(error); process.exitCode = 1; }
finally {
    if (started.length) try { stop(newBinary); } catch (error) { evidence.cleanupErrors.push(String(error)); }
    if (moved && !started.length) {
        try {
            if (existsSync(fixtureRoot)) renameSync(fixtureRoot, join(root, 'restored-working-data'));
            renameSync(original, fixtureRoot);
            assert.deepEqual(fingerprint(fixtureRoot), evidence.originalFingerprint);
            evidence.originalRestored = true;
        } catch (error) { evidence.cleanupErrors.push(String(error)); }
    }
    if (evidence.cleanupErrors.length) { evidence.success = false; process.exitCode = 1; }
    writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2), { mode: 0o600 });
    console.log(`Upgrade evidence: ${join(root, 'evidence.json')}`);
    if (evidence.error) console.error(evidence.error);
}
