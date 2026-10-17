import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { freePort } from '../../src/services';
import { HubStore } from '../../src/hub/store';
import { HubClient } from '../../src/hub/client';
import { createDelegationGateway } from '../../src/hub/delegation/gateway';
import type { Task, Round } from '../../src/tasks/types';
import { NativeTransport } from '../../src/hub/access/transport';
import { DelegationNativeClient } from '../../src/hub/delegation/native';
import { agentSnapshot } from '../../src/hub/delegation/context';
import { HubResourceClient } from '../../src/hub/resources/client';
import { closeSmoke, removeSmokeSecrets, startSmokeHapi, stopSmokeProcess } from '../lifecycle';
import { appendFixtureRound } from './fixture-round';

/** Dedicated low-level file/Git smoke: current domain records, real policy and Runner; no model scan. */
export async function nativeFileSmoke(root: string, command: string[], hapiBinary: string, env: NodeJS.ProcessEnv) {
    env.CODEX_HOME = join(root, 'codex-home'); env.CLAUDE_CONFIG_DIR = join(root, 'claude-home');
    for (const home of [env.CODEX_HOME, env.CLAUDE_CONFIG_DIR]) mkdirSync(home, { recursive: true, mode: 0o700 });
    const resources: Array<() => void | Promise<void>> = [], processes = new Set<ReturnType<typeof Bun.spawn>>();
    const files = new Set<string>([join(root, 'hapi/settings.json'), join(root, 'hapi/jwt-secret.json')]), secrets: string[] = [];
    resources.push(() => removeSmokeSecrets(files, processes));
    const rootToken = randomBytes(32).toString('base64url'), key = randomBytes(32); secrets.push(rootToken);
    const port = await freePort(), target = `http://127.0.0.1:${port}`, statePath = join(root, 'state.sqlite');
    let gateway: Awaited<ReturnType<typeof createDelegationGateway>>, identities: HubStore;
    let nativeProcess: ReturnType<typeof Bun.spawn>;
    let url = '', gatewayPort = 0;
    const runners: { home: string; credentialFile: string; machineId: string; child?: ReturnType<typeof Bun.spawn> }[] = [];
    try {
        nativeProcess = await startSmokeHapi(hapiBinary, root, env, port, rootToken, processes);
        resources.push(() => stopSmokeProcess(nativeProcess));
        resources.push(() => gateway?.close());
        async function openGateway(scan = false) {
            gateway = await createDelegationGateway({ host: '127.0.0.1', port: gatewayPort, target, statePath, rootToken, key });
            // Explicitly quiesce the model dispatcher before accepting low-level domain seeds.
            if (!scan) await gateway.delegation.coordinator.close();
            gatewayPort = (gateway.server.address() as { port: number }).port; url = `http://127.0.0.1:${gatewayPort}`;
        }
        await openGateway();
        identities = new HubStore(statePath); resources.push(() => identities.close());
        const user = identities.createIdentity('Native file smoke owner'), identityFile = join(root, 'identity.txt');
        files.add(identityFile); writeFileSync(identityFile, user.token, { mode: 0o600 }); secrets.push(user.token);
        const space = user.personalSpace.id, home = join(root, 'client');
        async function cli(args: string[], selectedHome = home, expected = 0) {
            const child = Bun.spawn([...command, '--home', selectedHome, '--json', 'hub', '--url', url,
                '--identity-file', identityFile, '--space', space, ...args], { env, stdout: 'pipe', stderr: 'pipe' });
            const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
            for (const secret of secrets) assert(!(stdout + stderr).includes(secret), 'Credential leaked');
            assert.equal(code, expected, `${args.join(' ')}: ${stderr}`); return JSON.parse(stdout || stderr);
        }
        async function startRunner(item: typeof runners[number]) {
            const record = JSON.parse(readFileSync(item.credentialFile, 'utf8')), runnerHome = join(item.credentialFile, '..', 'hapi');
            files.add(join(runnerHome, 'settings.json')); mkdirSync(runnerHome, { recursive: true });
            writeFileSync(join(runnerHome, 'settings.json'), JSON.stringify({ machineId: record.machineId, cliApiToken: record.active.token }), { mode: 0o600 });
            item.child = Bun.spawn([hapiBinary, 'runner', 'start-sync'], { env: { ...env, HAPI_HOME: runnerHome,
                HAPI_API_URL: url, CLI_API_TOKEN: record.active.token, HAPI_DISABLE_VERSION_HANDOFF: '1' },
                stdout: Bun.file(join(root, `runner-${runners.indexOf(item)}-out.log`)), stderr: Bun.file(join(root, `runner-${runners.indexOf(item)}-err.log`)) });
            processes.add(item.child); await waitRunner(item);
        }
        async function waitRunner(item: typeof runners[number]) {
            const client = new HubResourceClient({ url, identityFile, space });
            const deadline = Date.now() + 30_000;
            while (Date.now() < deadline) {
                assert.equal(item.child!.exitCode, null, 'Runner exited');
                try { const discovery = await client.discover(item.machineId); if (discovery.tools.length === 2) return; } catch {}
                await Bun.sleep(100);
            }
            throw new Error('Runner RPC discovery timeout');
        }
        async function stopRunner(item: typeof runners[number]) { if (item.child) { await stopSmokeProcess(item.child); item.child = undefined; } }
        async function addRunner() {
            const selectedHome = join(root, `runner-client-${runners.length}`), enrollment = await cli(['machine', 'enroll'], selectedHome);
            files.add(enrollment.credentialFile);
            secrets.push(JSON.parse(readFileSync(enrollment.credentialFile, 'utf8')).active.token);
            const item = { home: selectedHome, credentialFile: enrollment.credentialFile, machineId: enrollment.machineId, child: undefined as ReturnType<typeof Bun.spawn> | undefined };
            runners.push(item); resources.push(() => stopRunner(item));
            await cli(['machine', 'associate', item.machineId, space]); await startRunner(item); return item;
        }
        async function scoped(machineId: string, cwd = root, flavor: 'codex' | 'claude' = 'codex'): Promise<{ task: Task; round: Round; nextRound: () => void; readonly native: DelegationNativeClient }> {
            const runtime = (await cli(['runtime', 'register', flavor, '--machine', machineId])).runtime;
            const definition = join(root, `agent-${randomUUID()}.json`); writeFileSync(definition, JSON.stringify({ name: 'File RPC probe', runtimeId: runtime.id }));
            const agent = (await cli(['agent', 'create', '--request-id', randomUUID(), '--file', definition])).agent;
            const resolved = (await cli(['agent', 'resolve', '--agent', agent.id])).resolution;
            const actor = gateway.store.authenticate(user.token, space), namespace = gateway.delegation.scopes.ensure(actor);
            const snapshot = agentSnapshot(namespace, resolved), store = gateway.delegation.coordinator.store;
            const accepted = store.accept(namespace, { kind: 'cli', machineId, cwd }, randomUUID(),
                { agentType: agent.id, message: 'Low-level file RPC fixture; no model dispatch', workspaceMode: 'shared' }, snapshot, resolved.target);
            const { task, rounds, inputs } = store.require(namespace, accepted.agent_id), round = rounds[0];
            round.phase = 'finished'; round.stop = 'not_started'; round.finish = 'complete'; round.executionAbsent = true; round.completedAt = Date.now();
            store.save(task, round, inputs);
            function nextRound() {
                const next = appendFixtureRound(store, task, snapshot, { stop: 'not_started', executionAbsent: true });
                Object.assign(task, next.task); Object.assign(round, next.round);
            }
            return { task, round, nextRound, get native() { return gateway.delegation.taskClient(task, round); } };
        }
        async function restart(scan = false) {
            const running = runners.filter(item => item.child);
            for (const item of running) await stopRunner(item);
            await gateway.close(); await stopSmokeProcess(nativeProcess);
            nativeProcess = await startSmokeHapi(hapiBinary, root, env, port, rootToken, processes);
            await openGateway(scan); for (const item of running) await startRunner(item);
        }
        return { get gateway() { return gateway; }, get url() { return url; }, nativeUrl: target,
            losingNative: (client: DelegationNativeClient, proxyUrl: string) => new DelegationNativeClient(gateway.resources.store, new NativeTransport(proxyUrl, rootToken), client.scope), user, space, identityFile, home, statePath, runners,
            http: new HubClient({ url, identityFile, space }, 'hubAccess', 'hub_access_unavailable').http, cli, addRunner, scoped, startRunner, stopRunner, restart,
            async reopenGateway(scan = false) { await gateway.close(); await openGateway(scan); for (const item of runners.filter(item => item.child)) await waitRunner(item); },
            candidate: { cli: command, entry: command.length === 1 ? 'compiled CLI + source gateway' : 'source CLI + source gateway', bun: Bun.version, revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), hapiBinary, hashes: { cli: createHash('sha256').update(readFileSync(command.at(-1)!)).digest('hex'), hapi: createHash('sha256').update(readFileSync(hapiBinary)).digest('hex') },
                kind: 'current domain seeds; real Hub authorization/Git/RPC/bytes; no Task coordinator end-to-end' },
            close: async (success = false) => { await closeSmoke(resources); if (success) await removeFileSmokeData(root); } };
    } catch (error) { try { await closeSmoke(resources); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Native file smoke setup failed'); } throw error; }
}

/** Only this invocation's disposable file/Git fixture; compact evidence and process logs remain. */
export async function removeFileSmokeData(root: string) {
    await closeSmoke(readdirSync(root).filter(name => name !== 'evidence.json' && !name.endsWith('.log'))
        .map(name => () => rm(join(root, name), { recursive: true, force: true })));
}
