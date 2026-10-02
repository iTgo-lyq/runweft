import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from 'bun:sqlite';
import { HubClient } from '../../src/hub/client';
import { hubConnectionPaths } from '../../src/hub/resources/connection';
import { modelHomes } from './model-homes';
import { nativeUserSmoke } from './native-user-smoke';
import { installedBinaries } from './installed-binaries.mjs';
import pkg from '../../package.json';

export type WorktreeFlavor = 'codex' | 'claude';
export const fileHash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
export function worktreeEnv() {
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_') || key.startsWith('HAPI_') || ['CLI_API_TOKEN', 'DB_PATH', 'TELEGRAM_BOT_TOKEN'].includes(key)) delete env[key];
    return env;
}
export function hostAlive(pid: number) {
    try { process.kill(pid, 0); return true; } catch (error: any) { assert.equal(error.code, 'ESRCH'); return false; }
}
function sourceConfigurations(claude: boolean) {
    const codex = process.env.CODEX_HOME ?? join(homedir(), '.codex'), nativeClaude = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
    return [join(codex, 'config.toml'), join(codex, 'auth.json'), ...(claude ? [process.env.CLAUDE_CONFIG_DIR ? join(nativeClaude, '.claude.json') : join(homedir(), '.claude.json'), join(nativeClaude, 'settings.json'), join(nativeClaude, '.credentials.json')] : [])]
        .filter(existsSync).map(path => ({ path, sha256: fileHash(path) }));
}
function verifySources(prior: any) { for (const file of prior.sourceConfigurations) assert.equal(fileHash(file.path), file.sha256, 'Source model configuration changed'); }

// This handoff is only for worktree-tasks -> lifecycle. Models/history remain owned by the final consumer.
export async function freshWorktreeSmoke(binary: string, env: NodeJS.ProcessEnv, flavors: WorktreeFlavor[]) {
    const ownedRoot = mkdtempSync(join(tmpdir(), 'runweft-worktree-')), root = join(ownedRoot, '.dev-smoke'); mkdirSync(root);
    const sources = sourceConfigurations(flavors.includes('claude'));
    let models: ReturnType<typeof modelHomes>;
    try { models = modelHomes(root, env, flavors.includes('claude')); } catch (error) { rmSync(ownedRoot, { recursive: true, force: true }); throw error; }
    let center: Awaited<ReturnType<typeof nativeUserSmoke>> | undefined, constructorUncertain = false;
    try {
        const config = join(env.CODEX_HOME!, 'config.toml');
        if (existsSync(config)) for (const name of Object.keys((Bun.TOML.parse(readFileSync(config, 'utf8')) as any).mcp_servers ?? {})) assert.equal(spawnSync('codex', ['mcp', 'remove', name], { env, stdio: 'pipe' }).status, 0);
        const prefsPath = join(env.CLAUDE_CONFIG_DIR!, '.claude.json'), prefs = existsSync(prefsPath) ? JSON.parse(readFileSync(prefsPath, 'utf8')) : {};
        prefs.mcpServers = {}; writeFileSync(prefsPath, JSON.stringify(prefs), { mode: 0o600 });
        try { center = await nativeUserSmoke(root, binary, env); } catch (error) { constructorUncertain = error instanceof AggregateError; throw error; }
        const clientHome = join(root, 'client'), runner = await center.runner(clientHome, flavors);
        const binaries = installedBinaries(binary), candidate = { cliBinary: binaries.runweft.path, hapiBinary: binaries.hapi.path,
            hashes: { cli: binaries.runweft.sha256, hapi: binaries.hapi.sha256 }, hapiRevision: pkg.hapi.revision, entry: 'compiled center/CLI + real HAPI/Runner + native worktree Tasks' };
        const handoff = { serverHome: center.server, clientHome, url: center.url, ownerId: center.user.identity.id, spaceId: center.space,
            machineId: runner.machineId, runnerNativeHome: runner.hapiHome, identityFile: center.identityFile,
            serverPaths: center.cli(center.server, ['paths']), statePath: join(center.server, 'server/runweft/state.sqlite'),
            modelHomes: { codex: env.CODEX_HOME, claude: env.CLAUDE_CONFIG_DIR }, nativeClaude: models.nativeClaude,
            runtimes: runner.runtimes, cleanupOwner: 'smoke-worktree-lifecycle final consumer' };
        async function bind(project: string) {
            const repository = center!.cli(clientHome, ['repository', 'create', 'Worktree smoke repository', '--request-id', randomUUID()], { cwd: project }).repository;
            center!.cli(clientHome, ['repository', 'bind', repository.id, '--machine', runner.machineId], { cwd: project }); return repository.id;
        }
        function agent(flavor: WorktreeFlavor, repositoryId: string) {
            const path = join(root, `agent-${randomUUID()}.json`); writeFileSync(path, JSON.stringify({ name: `Worktree smoke ${flavor}`, runtimeId: runner.runtimes[flavor].id, repositoryId }));
            return center!.cli(clientHome, ['agent', 'create', '--file', path, '--request-id', randomUUID()]).agent;
        }
        return { ...center, root, ownedRoot, home: clientHome, runner, candidate, handoff, sourceConfigurations: sources, env, bind, agent,
            async close(evidence: any, preserve: boolean) {
                const errors: unknown[] = [];
                try { await stopWorktreeSmoke(evidence, env, runner.http, () => center!.close(false, true)); } catch (error) { errors.push(error); }
                try { models.verify(); } catch (error) { errors.push(error); }
                if (evidence.shutdownConfirmed && (!preserve || errors.length)) try { rmSync(ownedRoot, { recursive: true, force: true }); evidence.ownedDataRemoved = true; } catch (error) { errors.push(error); }
                if (errors.length) throw new AggregateError(errors, 'Worktree producer cleanup failed');
            } };
    } catch (error) {
        const errors = [error]; let safe = !constructorUncertain;
        if (center) try { await center.close(false); } catch (cleanup) { safe = false; errors.push(cleanup); }
        if (safe) try { await models.remove(); rmSync(ownedRoot, { recursive: true, force: true }); } catch (cleanup) { errors.push(cleanup); }
        if (!safe || errors.length > 1) throw new AggregateError(errors, `Worktree smoke construction failed; ownedRoot=${ownedRoot}; cleanupOwner=worktree smoke operator; shutdownConfirmed=${safe}`); throw error;
    }
}

export function retainedWorktreeSmoke(source: string) {
    const sourceFile = realpathSync(resolve(source)), prior = JSON.parse(readFileSync(sourceFile, 'utf8'));
    assert.equal(prior.evidenceFormat, 'current-worktree-tasks-1'); assert.equal(prior.success, true); assert.deepEqual(prior.cleanupErrors, []);
    assert.equal(prior.handoff.cleanupOwner, 'smoke-worktree-lifecycle final consumer');
    assert.equal(sourceFile, join(prior.evidenceDir, 'evidence.json'));
    assert(prior.evidenceDir.startsWith(resolve('.dev-smoke/worktree-tasks-')));
    assert.equal(realpathSync(prior.ownedRoot), prior.ownedRoot); assert(prior.ownedRoot.startsWith(join(realpathSync(tmpdir()), 'runweft-worktree-')));
    assert.equal(prior.root, join(prior.ownedRoot, '.dev-smoke')); assert.equal(realpathSync(prior.root), prior.root);
    const binaries = installedBinaries(prior.invokedCLI);
    assert.equal(prior.candidate.cliBinary, binaries.runweft.path); assert.equal(prior.candidate.hapiBinary, binaries.hapi.path);
    assert.deepEqual(prior.candidate.hashes, { cli: binaries.runweft.sha256, hapi: binaries.hapi.sha256 }); assert.equal(prior.candidate.hapiRevision, pkg.hapi.revision);
    const handoff = prior.handoff; assert.equal(handoff.serverHome, join(prior.root, 'center')); assert.equal(handoff.clientHome, join(prior.root, 'client'));
    assert.equal(handoff.statePath, join(handoff.serverHome, 'server/runweft/state.sqlite'));
    assert.equal(handoff.modelHomes.codex, join(prior.root, 'codex-home')); assert.equal(handoff.modelHomes.claude, join(prior.root, 'claude-home'));
    const connection = hubConnectionPaths(handoff.clientHome, handoff.url), identity = JSON.parse(readFileSync(connection.identityConnection, 'utf8')), machine = JSON.parse(readFileSync(connection.machineConnection, 'utf8'));
    assert.equal(identity.ownerId, handoff.ownerId); assert.equal(identity.spaceId, handoff.spaceId); assert.equal(machine.machineId, handoff.machineId);
    assert.equal(handoff.runnerNativeHome, join(connection.connection, 'hapi')); assert.equal(handoff.identityFile, join(prior.root, 'identity.txt'));
    assert(prior.cases.length >= 1 && prior.cases.length <= 2); assert.equal(new Set(prior.cases.map((item: any) => item.flavor)).size, prior.cases.length);
    const env = worktreeEnv(); Object.assign(env, { CODEX_HOME: handoff.modelHomes.codex, CLAUDE_CONFIG_DIR: handoff.modelHomes.claude, HAPI_CLAUDE_PATH: handoff.nativeClaude });
    const credentials = [identity.token, machine.active.token];
    function run(home: string, args: string[], options: { cwd?: string; timeout?: number } = {}) {
        const result = spawnSync(prior.invokedCLI, ['--home', home, '--json', ...args], { env, cwd: options.cwd ?? prior.root, timeout: options.timeout ?? 60_000, encoding: 'utf8' });
        for (const token of credentials) assert(!(result.stdout + result.stderr).includes(token), 'Credential leaked in CLI output'); return result;
    }
    function cli(home: string, args: string[], options?: { cwd?: string; timeout?: number }) {
        const result = run(home, args, options); assert.equal(result.status, 0, `${args[0]}: ${result.stderr || result.error || result.signal}`); return JSON.parse(result.stdout);
    }
    assert.equal(cli(handoff.serverHome, ['status']).service.running, false); assert.equal(cli(handoff.clientHome, ['status']).runner.running, false);
    verifySources(prior);
    // Read a private copy: readonly SQLite can still need a writable WAL sidecar.
    const copyRoot = mkdtempSync(resolve('.dev-smoke/worktree-state-'));
    try {
        const copy = join(copyRoot, 'state.sqlite'); copyFileSync(handoff.statePath, copy); if (existsSync(handoff.statePath + '-wal')) copyFileSync(handoff.statePath + '-wal', copy + '-wal');
        const db = new Database(copy, { readonly: true });
        try {
            assert.equal((db.query('SELECT COUNT(*) AS count FROM delegation_tasks').get() as any).count, prior.cases.length);
            for (const item of prior.cases) {
                assert(['codex', 'claude'].includes(item.flavor)); assert.equal(item.project, join(prior.root, item.flavor + '-project')); assert.equal(item.parentCwd, join(item.project, 'app'));
                assert.equal(item.rounds.length, 2, 'Lifecycle cannot replay an already accepted third round');
                const task = JSON.parse((db.query('SELECT data FROM delegation_tasks WHERE id=?').get(item.taskId) as any).data);
                assert.equal(task.version, 2); assert.equal(task.id, item.taskId); assert.equal(task.agent.id, item.agentId); assert.equal(task.parent.cwd, item.parentCwd);
                assert.equal(task.hub.ownerId, handoff.ownerId); assert.equal(task.hub.spaceId, handoff.spaceId); assert.equal(task.hub.hubRepositoryId, item.repositoryId); assert.equal(task.target.machineId, handoff.machineId); assert.equal(task.parent.machineId, handoff.machineId); assert.equal(task.target.runtimeId, handoff.runtimes[item.flavor].id);
                const rounds = db.query('SELECT data FROM delegation_rounds WHERE taskId=? ORDER BY ordinal').all(item.taskId) as any[]; assert.equal(rounds.length, 2, 'Lifecycle cannot replay an already accepted third round');
                for (let index = 0; index < 2; index++) {
                    const row = JSON.parse(rounds[index].data), view = item.rounds[index]; assert.equal(view.status, 'completed'); assert.equal(view.stop, 'stopped'); assert.equal(view.finish, 'complete'); assert(!hostAlive(view.host_pid));
                    assert.equal(row.id, view.round_id); assert.equal(row.phase, 'finished'); assert.equal(row.report, view.report.text); assert.equal(row.agent.hub.actorId, handoff.ownerId);
                    assert.equal(row.nativeSessionId, view.native_session_id); assert.equal(row.sessionId, view.session_id);
                }
                assert(existsSync(item.rounds[1].git.checkout), 'Retained worktree is missing');
            }
        } finally { db.close(); }
    } finally { rmSync(copyRoot, { recursive: true, force: true }); }
    const http = new HubClient({ url: handoff.url, home: handoff.clientHome, space: handoff.spaceId, env }, 'hubAccess', 'unavailable').http;
    async function ready() {
        const deadline = Date.now() + 40_000;
        do {
            try { const discovered = cli(handoff.clientHome, ['machine', 'discover', handoff.machineId]); if (prior.cases.every((item: any) => discovered.tools.some((tool: any) => tool.flavor === item.flavor))) return; } catch { /* Runner is starting. */ }
            await Bun.sleep(150);
        } while (Date.now() < deadline);
        throw new Error('Retained Runner discovery timed out');
    }
    return { prior, env, run, cli, http,
        async start() { cli(handoff.serverHome, ['start']); cli(handoff.clientHome, ['runner', 'start']); await ready(); },
        async restart() { cli(handoff.serverHome, ['restart']); await ready(); },
        async close(evidence: any) {
            const errors: unknown[] = [];
            try { await stopWorktreeSmoke(evidence, env, http); } catch (error) { errors.push(error); }
            try { verifySources(prior); } catch (error) { errors.push(error); }
            if (evidence.shutdownConfirmed) try { rmSync(prior.ownedRoot, { recursive: true, force: true }); evidence.ownedDataRemoved = true; } catch (error) { errors.push(error); }
            if (errors.length) throw new AggregateError(errors, 'Worktree consumer cleanup failed');
        } };
}
async function stopWorktreeSmoke(evidence: any, env: NodeJS.ProcessEnv, http: any, closeCenter?: () => Promise<void>) {
    let safe = !evidence.probeObservationIncomplete;
    const errors: unknown[] = [], pids = new Set<number>(evidence.hostPids ?? []), ids = new Set<string>(evidence.hapiSessionIds ?? []);
    if (!safe) errors.push(new Error('Project MCP observations incomplete; owned secrets retained'));
    try {
        for (const session of (await http.request('/api/sessions')).sessions) {
            ids.add(session.id); if (session.metadata?.hostPid) pids.add(session.metadata.hostPid);
            if (session.active) try { await http.request(`/api/sessions/${session.id}/archive`, { method: 'POST', signal: AbortSignal.timeout(45_000) }); } catch (error) { errors.push(error); }
        }
    } catch (error) { safe = false; errors.push(error); }
    const connection = hubConnectionPaths(evidence.handoff.clientHome, evidence.handoff.url), tokens: string[] = [];
    for (const [path, value] of [[connection.identityConnection, 'identity'], [connection.machineConnection, 'machine']]) try {
        if (existsSync(path)) { const record = JSON.parse(readFileSync(path, 'utf8')); tokens.push(value === 'identity' ? record.token : record.active.token); }
    } catch { errors.push(new Error('Cannot read owned connection for credential output check: ' + path)); }
    const raw = (home: string, args: string[]) => { const result = spawnSync(evidence.invokedCLI, ['--home', home, '--json', ...args], { env, encoding: 'utf8', timeout: 60_000 }); for (const token of tokens) assert(!(result.stdout + result.stderr).includes(token), 'Credential leaked in CLI output'); assert.equal(result.status, 0, result.stderr || String(result.error)); return JSON.parse(result.stdout); };
    // Both stop/status pairs and PID verification run even if another operation fails.
    for (const [home, kind] of [[evidence.handoff.clientHome, 'runner'], [evidence.handoff.serverHome, 'service']]) {
        try { raw(home, kind === 'runner' ? ['runner', 'stop'] : ['stop']); } catch (error) { errors.push(error); }
        try { const status = raw(home, ['status']); assert.equal(status[kind].running, false); if (kind === 'service') assert.equal(status.runner.running, false); } catch (error) { safe = false; errors.push(error); }
    }
    const deadline = Date.now() + 10_000; while ([...pids].some(hostAlive) && Date.now() < deadline) await Bun.sleep(100);
    if ([...pids].some(hostAlive)) { safe = false; errors.push(new Error('Native wrapper remains alive; owned secrets retained')); }
    if (closeCenter) try { await closeCenter(); } catch (error) { errors.push(error); }
    evidence.hostPids = [...pids]; evidence.hapiSessionIds = [...ids]; evidence.shutdownConfirmed = safe;
    if (errors.length) throw new AggregateError(errors, 'Worktree smoke shutdown failed');
}
