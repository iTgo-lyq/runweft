import { saveTestConnection, fixtureCredential } from '../identity-fixture';
import { createTestIdentity } from '../identity-fixture';
import { hubConnectionPaths } from '../../src/hub/resources/connection';
import { afterAll, test } from 'bun:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicWrite } from '../../src/config';
import { freePort } from '../../src/services';
import { createConfigurationGateway } from '../../src/hub/configuration/gateway';
import { HubResourceClient } from '../../src/hub/resources/client';
import { HubStore } from '../../src/hub/store';
import { preflightBinaries } from '../preflight';
import { closeSmoke, removeSmokeSecrets, startSmokeHapi, stopSmokeProcess } from '../lifecycle';

// Hooks also run when Bun times out the test; a finally block alone is insufficient.
const resources: Array<() => void | Promise<void>> = [];
afterAll(() => closeSmoke(resources));

test('CLI resolves a saved Agent through the gateway and real Runner; revoked runtime cannot resolve', async () => {
    assert(process.env.RUNWEFT_TEST_BIN, 'Real integration requires --bin (RUNWEFT_TEST_BIN)');
    const binaries = preflightBinaries(process.env.RUNWEFT_TEST_BIN);
    const root = mkdtempSync(join(tmpdir(), 'runweft-configuration-'));
    const processes = new Set<ReturnType<typeof Bun.spawn>>(), secretFiles = new Set<string>();
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith('HAPI_') || key.startsWith('RUNWEFT_') || ['CLI_API_TOKEN', 'DB_PATH', 'TELEGRAM_BOT_TOKEN'].includes(key)) delete env[key];
    env.HOME = join(root, 'home'); env.CODEX_HOME = join(root, 'codex'); env.CLAUDE_CONFIG_DIR = join(root, 'claude');
    for (const dir of [env.HOME, env.CODEX_HOME, env.CLAUDE_CONFIG_DIR]) mkdirSync(dir, { mode: 0o700 });
    resources.push(async () => {
        await removeSmokeSecrets(secretFiles, processes);
        rmSync(root, { recursive: true, force: true });
    });
    const port = await freePort(), rootToken = randomBytes(32).toString('base64url');
    const hapi = await startSmokeHapi(binaries.hapi.path, root, env, port, rootToken, processes);
    resources.push(() => stopSmokeProcess(hapi));
    const statePath = join(root, 'state.sqlite');
    const gateway = await createConfigurationGateway({ host: '127.0.0.1', port: 0, target: `http://127.0.0.1:${port}`, rootToken, key: randomBytes(32), statePath });
    resources.push(() => gateway.close());
    const store = new HubStore(statePath); resources.push(() => store.close());
    const base = `http://127.0.0.1:${(gateway.server.address() as { port: number }).port}`;
    const owner = createTestIdentity(store, 'owner'), space = owner.personalSpace.id, identityFile = join(root, 'identity');
    atomicWrite(identityFile, `Runweft Hub: ${base}\n身份 ID: ${owner.identity.id}\n${owner.token}\n`);
    secretFiles.add(identityFile);
    const secrets = [rootToken, owner.token];
    async function cli(args: string[], expected = 0, identity = identityFile) {
        await saveTestConnection(join(root, 'client'), base, fixtureCredential(identity).token, space);
        const child = Bun.spawn([binaries.runweft.path, '--home', join(root, 'client'), '--json', 'hub', '--url', base,
            '--space', space, ...args], { env, stdout: 'pipe', stderr: 'pipe' });
        processes.add(child); resources.push(async () => { if (child.exitCode === null && child.signalCode === null) await stopSmokeProcess(child); });
        const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        for (const secret of secrets) assert(!(stdout + stderr).includes(secret), 'Credential appeared in CLI output');
        assert.equal(exit, expected, `${args[0]} ${args[1]}: ${stderr}`);
        return JSON.parse(stdout || stderr);
    }
    const enrolled = await cli(['machine', 'enroll', '--name', 'Configuration Runner']);
    const record = JSON.parse(readFileSync(enrolled.credentialFile, 'utf8'));
    secretFiles.add(enrolled.credentialFile); secrets.push(record.active.token);
    await cli(['machine', 'associate', enrolled.machineId, space]);
    const runnerHome = join(root, 'runner');
    atomicWrite(join(runnerHome, 'settings.json'), JSON.stringify({ machineId: record.machineId, cliApiToken: record.active.token }));
    secretFiles.add(join(runnerHome, 'settings.json'));
    const runner = Bun.spawn([binaries.hapi.path, 'runner', 'start-sync'], { env: { ...env, HAPI_HOME: runnerHome, HAPI_API_URL: base,
        CLI_API_TOKEN: record.active.token, HAPI_DISABLE_VERSION_HANDOFF: '1' },
        stdout: Bun.file(join(root, 'runner-out.log')), stderr: Bun.file(join(root, 'runner-err.log')) });
    processes.add(runner); resources.push(() => stopSmokeProcess(runner));
    const client = new HubResourceClient({ url: base, credential: fixtureCredential(identityFile), space });
    const deadline = Date.now() + 30_000;
    while (true) {
        assert.equal(runner.exitCode, null, 'Runner exited before discovery');
        try { await client.discover(enrolled.machineId); break; } catch (error) { if (Date.now() >= deadline) throw error; }
        await Bun.sleep(100);
    }
    const runtime = (await cli(['runtime', 'register', 'codex', '--machine', enrolled.machineId])).runtime;
    assert.equal(runtime.versionStatus, 'detected');
    const repository = (await cli(['repository', 'create', 'Project', '--request-id', randomUUID()])).repository;
    const definition = join(root, 'agent.json');
    writeFileSync(definition, JSON.stringify({ name: 'Builder', repositoryId: repository.id, runtimeId: runtime.id, flavor: 'codex', model: 'custom-codex', reasoningEffort: 'high' }));
    const agent = (await cli(['agent', 'create', '--request-id', randomUUID(), '--file', definition])).agent;
    await cli(['agent', 'select', agent.id, '--repository', repository.id]);
    const resolved = (await cli(['agent', 'resolve', '--repository', repository.id])).resolution;
    assert.equal(resolved.agentId, agent.id); assert.equal(resolved.target.machineId, enrolled.machineId);
    assert.deepEqual(resolved.launchOptions, { agent: 'codex', model: 'custom-codex', modelReasoningEffort: 'high', disabledMcpServers: ['runweft'] });
    await cli(['runtime', 'unregister', runtime.id]);
    assert.equal((await cli(['agent', 'resolve', '--repository', repository.id], 1)).error.code, 'runtime_unregistered');
    const saved = hubConnectionPaths(join(root, 'client'), base).identityConnection;
    const record = JSON.parse(readFileSync(saved, 'utf8')); record.token = 'rw_cli_' + 'x'.repeat(43);
    atomicWrite(saved, JSON.stringify(record));
    assert.equal((await cli(['agent', 'list'], 1)).error.code, 'user_session_invalid');
    assert.equal((gateway.store.db.query('SELECT COUNT(*) AS n FROM delegation_tasks').get() as { n: number }).n, 0);
    await closeSmoke(resources);
}, 120_000);
