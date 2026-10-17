import { fixtureCleanup } from '../fixture-cleanup';
import { expect } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { SignJWT, jwtVerify } from 'jose';
import type { Flavor, Inspection } from '../../src/resources/types';
import type { Machine } from '../../hapi/shared/src/schemas';
import { fixture } from '../helpers';
export function resourceInspection(agent: Flavor, versionStatus: Inspection['details']['versionStatus'] = 'detected'): Inspection {
    return { agent, available: true, details: { checkedAt: Date.now(), executable: `/test/bin/${agent}`, version: versionStatus === 'detected' ? '1.2.3' : null, versionStatus } };
}
function machine(id: string, namespace = 'alpha', active = true): Machine {
    return { id, namespace, seq: 1, createdAt: 1, updatedAt: 2, active, activeAt: 2,
        metadata: { host: id, platform: 'test', happyCliVersion: 'test' }, metadataVersion: 1,
        runnerState: { status: 'running', capabilities: { agentAvailabilityDetails: true } }, runnerStateVersion: 1 };
}

export type NativeFixtureOptions = {
    home?: string; namespaces?: string[]; machines?: Machine[]; capabilities?: object;
    fetch?: (request: Request, namespace: string) => Promise<Response | undefined> | Response | undefined;
};
export async function nativeFixture(cleanups: (() => Promise<void> | void)[], options: NativeFixtureOptions = {}) {
    const cleanup = fixtureCleanup(cleanups);
    try {
        const home = options.home ?? fixture('native');
        if (!options.home) cleanup.resources.push(() => rmSync(home, { recursive: true, force: true }));
        const key = randomBytes(32);
        const tokens = new Map<string, string>();
        for (const ns of options.namespaces ?? ['alpha', 'beta']) tokens.set(ns, await new SignJWT({ uid: ns === 'alpha' ? 1 : 2, ns }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(key));
        const machines = options.machines ?? [machine('own'), machine('remote'), machine('offline', 'alpha', false), machine('beta-machine', 'beta')];
        const inspections = new Map(machines.map(machine => [machine.id, [resourceInspection('codex'), resourceInspection('claude')]]));
        const failures = new Map<string, { status: number; body: object }>();
        const calls: { path: string; method: string; namespace: string; authorization: string }[] = [];
        const hooks = new Map<string, () => Promise<void>>();
        let inventorySupported = true;
        const native = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
            const url = new URL(request.url);
            if (url.pathname === '/api/auth') {
                const { accessToken } = await request.json() as { accessToken: string };
                const ns = accessToken.replace('test-', '').replace(/^:/, '');
                // NativeTransport uses the HAPI root:namespace exchange for owner-scoped byte storage.
                if (accessToken.startsWith('test-:') && ns && !tokens.has(ns)) tokens.set(ns, await new SignJWT({ uid: 1, ns }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(key));
                return tokens.has(ns) ? Response.json({ token: tokens.get(ns) }) : Response.json({ error: 'unauthorized' }, { status: 401 });
            }
            const authorization = request.headers.get('authorization') ?? '';
            let namespace: string;
            try { namespace = (await jwtVerify(authorization.slice(7), key)).payload.ns as string; }
            catch { return Response.json({ error: 'unauthorized' }, { status: 401 }); }
            calls.push({ path: url.pathname, method: request.method, namespace, authorization });
            if (url.pathname === '/health') return Response.json({ capabilities: { machineInventory: inventorySupported ? 1 : undefined, ...options.capabilities } });
            const custom = await options.fetch?.(request, namespace);
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
        cleanup.resources.push(() => native.stop(true));
        return { home, key, native, nativeUrl: native.url.origin, machines, inspections, failures, calls, tokens, hooks,
            setInventorySupported(value: boolean) { inventorySupported = value; } };
    } catch (error) { return cleanup.failed(error); }
}
