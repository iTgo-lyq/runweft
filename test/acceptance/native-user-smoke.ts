import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { join } from 'node:path';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { atomicWrite } from '../../src/config';
import { freePort } from '../../src/services';
import { HubClient } from '../../src/hub/client';
import { hubConnectionPaths } from '../../src/hub/resources/connection';
import { installedBinaries } from '../../scripts/installed-binaries.mjs';
import pkg from '../../package.json';
import { closeSmoke } from '../../test/lifecycle';
import { removeFileSmokeData } from '../../test/integration/native-files';

/** Compiled center and separate personal Runner homes; public Hub authorization only. */
export async function nativeUserSmoke(root: string, binary: string, env: NodeJS.ProcessEnv, hapiBinary?: string) {
    const server = join(root, 'center'), binaries = installedBinaries(binary), resources: Array<() => void | Promise<void>> = [];
    if (hapiBinary) binaries.hapi = { path: hapiBinary, sha256: createHash('sha256').update(readFileSync(hapiBinary)).digest('hex') };
    const credentialValues = new Set<string>();
    const secrets = new Set<string>(), homes: string[] = [];
    let stopped = false;
    const registered = new Map<string, { id: string; flavors: Array<'codex' | 'claude'> }>();
    function run(home: string, args: string[], options: { cwd?: string; timeout?: number } = {}) {
        const result = spawnSync(binary, ['--home', home, '--json', ...args], { env, cwd: options.cwd, encoding: 'utf8', timeout: options.timeout ?? 60_000 });
        for (const secret of credentialValues) assert(!(result.stdout + result.stderr).includes(secret), 'Credential leaked in CLI output');
        return result;
    }
    function cli(home: string, args: string[], options: { cwd?: string; timeout?: number } = {}) {
        const result = run(home, args, options);
        assert.equal(result.status, 0, `${args[0]} ${args[1] ?? ''} failed (exit ${result.status}, signal ${result.signal})`); return JSON.parse(result.stdout);
    }
    resources.push(async () => {
        if (!stopped || homes.some(home => cli(home, ['status']).runner?.running)) throw new Error('Secrets retained: center or Runner still running');
        await closeSmoke([...secrets].map(path => () => rmSync(path, { force: true })));
    });
    try {
        cli(server, ['init']); cli(server, ['config', 'set', 'server.runner', 'false']);
        cli(server, ['config', 'set', 'server.port', String(await freePort())]); cli(server, ['config', 'set', 'hapi.executable', binaries.hapi.path]);
        secrets.add(join(server, 'server/hapi/settings.json')); secrets.add(join(server, 'server/hapi/jwt-secret.json'));
        resources.push(() => { cli(server, ['stop']); const status = cli(server, ['status']); assert(!status.service.running && !status.runner.running); stopped = true; });
        cli(server, ['start']); const status = cli(server, ['status']); assert.equal(status.hapiRevision, pkg.hapi.revision, 'Compiled candidate HAPI pin differs from this source'); const url = status.url;
        const response = await fetch(url + '/api/runweft/hub/identities', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Native execution smoke' }) });
        assert.equal(response.status, 201); const user = await response.json() as any, space = user.personalSpace.id; credentialValues.add(user.token);
        const identityFile = join(root, 'identity.txt'); secrets.add(identityFile); writeFileSync(identityFile, user.token, { mode: 0o600 });
        async function runner(home: string, flavors: Array<'codex' | 'claude'> = ['codex', 'claude']) {
            const paths = hubConnectionPaths(home, url); homes.push(home);
            cli(home, ['init', '--url', url]);
            if (home === server) cli(home, ['config', 'set', 'hub.url', url]);
            cli(home, ['config', 'set', 'hapi.executable', binaries.hapi.path]);
            secrets.add(paths.identityConnection);
            atomicWrite(paths.identityConnection, JSON.stringify({ schemaVersion: 1, hub: url, ownerId: user.identity.id, spaceId: space, token: user.token, requestId: randomUUID(), createdAt: Date.now() }));
            const enrollment = cli(home, ['machine', 'enroll']); secrets.add(enrollment.credentialFile); credentialValues.add(JSON.parse(readFileSync(enrollment.credentialFile, 'utf8')).active.token); secrets.add(join(paths.connection, 'hapi/settings.json'));
            cli(home, ['machine', 'associate', enrollment.machineId, space]);
            resources.push(() => { cli(home, ['runner', 'stop']); assert.equal(cli(home, ['status']).runner.running, false); });
            cli(home, ['runner', 'start']);
            registered.set(home, { id: enrollment.machineId, flavors }); await ready(home, enrollment.machineId, flavors);
            const runtimes = Object.fromEntries(flavors.map(flavor => [flavor, cli(home, ['runtime', 'register', flavor, '--machine', enrollment.machineId]).runtime]));
            return { runtimes, machineId: enrollment.machineId, hapiHome: join(paths.connection, 'hapi'), http: new HubClient({ url, home, env, space }, 'hubAccess', 'unavailable').http };
        }
        async function ready(home: string, machineId: string, flavors: Array<'codex' | 'claude'>) {
            const deadline = Date.now() + 40_000;
            while (Date.now() < deadline) {
                try { const discovered = cli(home, ['machine', 'discover', machineId]); if (flavors.every(flavor => discovered.tools.some((tool: any) => tool.flavor === flavor))) return; } catch (error) { if (Date.now() >= deadline) throw error; }
                await Bun.sleep(150);
            }
            throw new Error('Runner actual discovery RPC timed out');
        }
        return { server, url, user, space, identityFile, run, cli, runner, binaries,
            async restart() { cli(server, ['restart']); for (const [home, item] of registered) { cli(home, ['runner', 'start']); await ready(home, item.id, item.flavors); } },
            proxyHttp: (url: string) => new HubClient({ url, identityFile, space }, 'hubAccess', 'unavailable').http,
            candidate: { entry: 'compiled CLI + compiled serve + real HAPI/Runner', invokedCLI: binary, binaries,
                hashes: { cli: binaries.runweft.sha256, hapi: binaries.hapi.sha256 } },
            async close(success: boolean) { await closeSmoke(resources); if (success) await removeFileSmokeData(root); } };
    } catch (error) { try { await closeSmoke(resources); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Native user smoke setup failed'); } throw error; }
}
