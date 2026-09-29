import { expect } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { SignJWT, jwtVerify } from 'jose';
import { createRunweftHandler } from '../src/api';
import { createGateway } from '../src/proxy';
import { HapiClient } from '../src/hapi';
import { dataPaths, loadConfig } from '../src/config';
import type { Flavor, Inspection, RuntimeView } from '../src/resources/types';
import type { Machine } from '../hapi/shared/src/schemas';
import { fixture } from './helpers';
import { TaskCoordinator } from '../src/tasks/coordinator';
import { WorkspacePreparations } from '../src/remote/service';

export const resourcePrefix = '/api/runweft/resources';
export const resourceWrite = (value: unknown, method = 'POST'): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
export function resourceInspection(agent: Flavor, versionStatus: Inspection['details']['versionStatus'] = 'detected'): Inspection {
    return { agent, available: true, details: { checkedAt: Date.now(), executable: `/test/bin/${agent}`, version: versionStatus === 'detected' ? '1.2.3' : null, versionStatus } };
}
function machine(id: string, namespace = 'alpha', active = true): Machine {
    return { id, namespace, seq: 1, createdAt: 1, updatedAt: 2, active, activeAt: 2,
        metadata: { host: id, platform: 'test', happyCliVersion: 'test' }, metadataVersion: 1,
        runnerState: { status: 'running', capabilities: { agentAvailabilityDetails: true } }, runnerStateVersion: 1 };
}

export async function resourceFixture(cleanups: (() => Promise<void> | void)[], extra?: {
    capabilities?: object; preparations?: boolean; fetch: (request: Request, namespace: string) => Promise<Response | undefined> | Response | undefined;
}) {
    const home = fixture('resources');
    cleanups.push(() => rmSync(home, { recursive: true, force: true }));
    const key = randomBytes(32);
    const tokens = new Map<string, string>();
    for (const ns of ['alpha', 'beta']) tokens.set(ns, await new SignJWT({ uid: ns === 'alpha' ? 1 : 2, ns }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(key));
    const machines = [machine('own'), machine('remote'), machine('offline', 'alpha', false), machine('beta-machine', 'beta')];
    const inspections = new Map(machines.map(machine => [machine.id, [resourceInspection('codex'), resourceInspection('claude')]]));
    const failures = new Map<string, { status: number; body: object }>();
    const calls: { path: string; method: string; namespace: string; authorization: string }[] = [];
    const hooks = new Map<string, () => Promise<void>>();
    let inventorySupported = true;
    const native = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === '/api/auth') {
            const { accessToken } = await request.json() as { accessToken: string };
            const ns = accessToken.replace('test-', '');
            return tokens.has(ns) ? Response.json({ token: tokens.get(ns) }) : Response.json({ error: 'unauthorized' }, { status: 401 });
        }
        const authorization = request.headers.get('authorization') ?? '';
        let namespace: string;
        try { namespace = (await jwtVerify(authorization.slice(7), key)).payload.ns as string; }
        catch { return Response.json({ error: 'unauthorized' }, { status: 401 }); }
        calls.push({ path: url.pathname, method: request.method, namespace, authorization });
        if (url.pathname === '/health') return Response.json({ capabilities: { machineInventory: inventorySupported ? 1 : undefined, ...extra?.capabilities } });
        const custom = await extra?.fetch(request, namespace);
        if (custom) return custom;
        if (url.pathname === '/api/machines') {
            expect(url.searchParams.get('includeOffline')).toBe('true');
            return Response.json({ machines: machines.filter(machine => machine.namespace === namespace) });
        }
        const parts = url.pathname.split('/');
        const target = machines.find(machine => machine.id === parts[3] && machine.namespace === namespace);
        if (!target) return Response.json({ error: 'not found' }, { status: 404 });
        if (request.method === 'PATCH' && parts.length === 4) {
            const body = await request.json() as { displayName: string };
            target.metadata!.displayName = body.displayName;
            return Response.json({ ok: true });
        }
        if (parts[4] === 'agent-availability') {
            expect(url.searchParams.get('details')).toBe('true');
            await hooks.get(target.id)?.();
            const failure = failures.get(target.id);
            if (failure) return Response.json(failure.body, { status: failure.status });
            return Response.json({ agents: inspections.get(target.id) });
        }
        return Response.json({ error: 'unexpected native action' }, { status: 500 });
    } });
    cleanups.push(() => native.stop(true));
    const config = loadConfig(home, {});
    const statePath = dataPaths(config).state;
    const clientFor = (namespace: string) => new HapiClient(native.url.origin, `test-${namespace}`);
    let preparations = extra?.preparations ? new WorkspacePreparations(statePath, clientFor, 10) : undefined;
    if (preparations) cleanups.push(() => preparations?.close());
    let tasks = extra ? new TaskCoordinator(statePath, clientFor, 20, preparations?.baselines) : undefined;
    if (tasks) cleanups.push(() => tasks?.close());
    const gateway = await createGateway({ host: '127.0.0.1', port: 0, target: native.url.origin,
        handle: createRunweftHandler({ key, hapiUrl: native.url.origin, statePath, get tasks() { return tasks; }, get preparations() { return preparations; },
            health: () => ({ service: 'runweft', role: 'hub-server', ready: true, protocolVersion: 1 }) }),
    });
    cleanups.push(() => gateway.close());
    const address = gateway.server.address() as { port: number };
    const url = `http://127.0.0.1:${address.port}`;
    const alpha = new HapiClient(url, 'test-alpha'), beta = new HapiClient(url, 'test-beta');
    const register = async (machineId = 'own', flavor: Flavor = 'codex', client = alpha): Promise<RuntimeView> => {
        await client.request(`${resourcePrefix}/machines`, resourceWrite({ machineId }));
        return (await client.request(`${resourcePrefix}/runtimes`, resourceWrite({ machineId, flavor }))).runtime;
    };
    return { home, config, statePath, url, alpha, beta, machines, inspections, calls, tokens, failures, hooks, register, get tasks() { return tasks; }, nativeUrl: native.url.origin,
        get preparations() { return preparations; },
        async restartPreparations() { await tasks?.close(); await preparations!.close(); preparations = new WorkspacePreparations(statePath, clientFor, 10); tasks = new TaskCoordinator(statePath, clientFor, 20, preparations.baselines); preparations.start(); },
        setInventorySupported(value: boolean) { inventorySupported = value; } };
}
