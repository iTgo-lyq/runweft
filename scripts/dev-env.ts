import assert from 'node:assert/strict';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { Database } from 'bun:sqlite';
import { installCandidate, isolatedEnvironment } from './candidate.mjs';
import { installedBinaries } from './installed-binaries.mjs';
import { freePort } from '../src/services';
import { validateState } from '../src/state';
import { currentRound, recordJSON } from '../src/tasks/records';
import { assertNoInstalledProcesses, assertNoOtherInstalledProcesses, inspectManagedProcesses } from '../src/uninstall/processes';

const { positionals, values } = parseArgs({ args: process.argv.slice(2), allowPositionals: true, options: {
    bin: { type: 'string' }, candidate: { type: 'string' }, runner: { type: 'boolean' }, dir: { type: 'string' },
} });
const action = positionals[0];
assert(positionals.length === 1 && ['start', 'stop'].includes(action!), 'Usage: dev:env start --bin CLI|--candidate directory [--runner] | stop --dir owned-directory');
const marker = 'environment.json', kind = 'runweft-development-environment';
function command(cli: string, root: string, env: NodeJS.ProcessEnv, args: string[]) {
    const child = spawnSync(cli, ['--home', join(root, 'data'), '--json', ...args], { cwd: root, env, encoding: 'utf8', timeout: 65000 });
    assert.equal(child.status, 0, `${args.slice(0, 2).join(' ')}: ${child.stderr || child.error?.message}`);
    return JSON.parse(child.stdout);
}
async function stop(directory: string) {
    const root = resolve(directory);
    if (!existsSync(root)) return { directory: root, stopped: true, alreadyAbsent: true };
    assert(lstatSync(root).isDirectory() && !lstatSync(root).isSymbolicLink(), 'Environment directory must be an owned ordinary directory');
    assert.equal(realpathSync(root), root, 'Use the canonical directory returned by start');
    const record = JSON.parse(readFileSync(join(root, marker), 'utf8'));
    assert.equal(record.kind, kind); assert.equal(record.directory, root);
    assert(basename(root).startsWith('runweft-env-'), 'Not a development environment directory');
    const binaries = installedBinaries(record.cli);
    assert.deepEqual(binaries, record.binaries, 'Owned program paths or hashes changed; environment retained');
    for (const binary of Object.values(binaries)) assert(binary.path.startsWith(root + sep), 'Program outside environment');
    const home = join(root, 'data'), connections = join(home, 'connections');
    const installation = { kind: 'standalone' as const, root, executable: binaries.runweft.path, hapi: binaries.hapi.path, dataHome: home, links: [] };
    const roots = existsSync(connections) ? readdirSync(connections).map(name => join(connections, name)) : [];
    const processes = await inspectManagedProcesses(home, roots, installation);
    assertNoOtherInstalledProcesses(installation, processes);
    assert(!processes.some(process => process.sessions?.length || process.kind === 'mcp'),
        'Active sessions or MCP clients remain; finish them explicitly before stop. Environment retained.');
    const state = join(home, 'server/runweft/state.sqlite');
    if (existsSync(state)) {
        validateState(state);
        const db = new Database(state, { readonly: true });
        try {
            for (const row of db.query('SELECT data FROM delegation_rounds').all() as { data: string }[]) {
                const round = currentRound(recordJSON(row.data));
                assert(['finished', 'failed'].includes(round.phase) && (round.stop === 'stopped' || round.executionAbsent),
                    `Task round ${round.id} is active or its execution is unknown; environment retained`);
            }
        } finally { db.close(); }
    }
    const env = isolatedEnvironment(root);
    if (existsSync(join(home, 'config.yaml'))) {
        command(record.cli, root, env, ['stop']);
        const status = command(record.cli, root, env, ['status']);
        assert(!status.service.running && !status.runner.running, 'Service stop is unconfirmed; environment retained');
    }
    assertNoInstalledProcesses(installation);
    rmSync(root, { recursive: true });
    return { directory: root, stopped: true };
}
async function start() {
    assert(Boolean(values.bin) !== Boolean(values.candidate), 'Provide exactly one of --bin and --candidate');
    assert(!values.dir, 'start allocates its own private directory');
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'runweft-env-')));
    let registered = false;
    try {
        let cli: string, env: NodeJS.ProcessEnv, source: unknown;
        if (values.candidate) {
            const installed = await installCandidate(values.candidate, root);
            ({ cli, env } = installed); source = { candidate: installed.directory, source: installed.index.source, hapi: installed.index.hapi };
        } else {
            const supplied = installedBinaries(resolve(values.bin!));
            mkdirSync(join(root, 'bin')); cli = join(root, 'bin/runweft');
            for (const [name, binary] of Object.entries(supplied)) copyFileSync(binary.path, join(root, 'bin', name));
            env = isolatedEnvironment(root); source = { supplied };
        }
        const binaries = installedBinaries(cli);
        for (const binary of Object.values(binaries)) {
            const check = spawnSync(binary.path, ['--version'], { env, encoding: 'utf8', timeout: 10000 });
            assert.equal(check.status, 0, 'Prepared program cannot start');
        }
        writeFileSync(join(root, marker), JSON.stringify({ kind, directory: root, cli, binaries, source }, null, 2), { mode: 0o600 });
        registered = true;
        const run = (args: string[]) => command(cli, root, env, args);
        run(['init']);
        const url = `http://127.0.0.1:${await freePort()}`;
        run(['config', 'set', 'server.port', new URL(url).port]); run(['config', 'set', 'hub.url', url]);
        assert(run(['start']).service.running);
        const response = await fetch(url + '/api/runweft/hub/identities', { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'Development' }), signal: AbortSignal.timeout(10000) });
        assert(response.ok, 'Identity setup failed'); const identity: any = await response.json();
        const paths = run(['paths']); mkdirSync(dirname(paths.identityConnection), { recursive: true });
        writeFileSync(paths.identityConnection, JSON.stringify({ schemaVersion: 1, hub: url, ownerId: identity.identity.id,
            spaceId: identity.personalSpace.id, token: identity.token, requestId: randomUUID(), createdAt: Date.now() }), { mode: 0o600 });
        if (values.runner) {
            const machine = run(['machine', 'enroll']); run(['machine', 'associate', machine.machineId, identity.personalSpace.id]);
            assert(run(['runner', 'start']).online);
        }
        return { directory: root, url: url + '/hub', cli, home: join(root, 'data'),
            identityFile: paths.identityConnection, nativeHome: env.HOME, runner: Boolean(values.runner),
            stop: ['bun', 'run', 'dev:env', 'stop', '--dir', root] };
    } catch (error) {
        try { if (registered) await stop(root); else rmSync(root, { recursive: true, force: true }); }
        catch (cleanup) { throw new AggregateError([error, cleanup], `Setup failed; environment retained at ${root}`); }
        throw error;
    }
}
if (action === 'stop') {
    assert(values.dir && !values.bin && !values.candidate && !values.runner, 'stop requires only --dir');
    console.log(JSON.stringify(await stop(values.dir), null, 2));
} else console.log(JSON.stringify(await start(), null, 2));
