import { createTestIdentity } from '../identity-fixture';
import { expect } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { SignJWT } from 'jose';
import type { Machine } from '../../hapi/shared/src/schemas';
import { AccessStore } from '../../src/hub/access/store';
import { createResourceGateway } from '../../src/hub/resources/gateway';
import { createConfigurationGateway } from '../../src/hub/configuration/gateway';
import { HubResourceStore } from '../../src/hub/resources/store';
import { HubStore } from '../../src/hub/store';
import { fixture } from '../helpers';
import { resourceInspection } from './native-fixture';
import { fixtureCleanup } from '../fixture-cleanup';

export function setupHubResources(cleanups: (() => void | Promise<void>)[]) {
    const cleanup = fixtureCleanup(cleanups);
    try {
        const home = fixture('hub-resources'), path = join(home, 'state.sqlite');
        cleanup.resources.push(() => rmSync(home, { recursive: true, force: true }));
        const hub = new HubStore(path); cleanup.resources.push(() => hub.close());
        const access = new AccessStore(path); cleanup.resources.push(() => access.close());
        const other = new AccessStore(path); cleanup.resources.push(() => other.close());
        const a = createTestIdentity(hub, 'owner'), b = createTestIdentity(hub, 'member'), c = createTestIdentity(hub, 'unrelated');
        const invite = hub.invite(a.identity.id, a.personalSpace.id, 'admin'); hub.acceptInvitation(b.identity.id, invite.token);
        return { home, path, hub, access, other, a, b, c, store: new HubResourceStore(access), second: new HubResourceStore(other),
            actor: access.authenticate(a.token), member: access.authenticate(b.token), unrelated: access.authenticate(c.token) };
    } catch (error) {
        const errors = [error];
        for (const close of cleanup.resources.splice(0).reverse()) { try { close(); } catch (failure) { errors.push(failure); } }
        throw errors.length === 1 ? error : new AggregateError(errors, 'Hub resource fixture construction failed');
    }
}


export async function hubResourceFixture(cleanups: (() => void | Promise<void>)[], configuration = false) {
    const cleanup = fixtureCleanup(cleanups);
    try {
        const h = setupHubResources(cleanup.resources), key = randomBytes(32), machines: Machine[] = [], calls: string[] = [];
        const nativeToken = await new SignJWT({ uid: 1, ns: 'runweft' }).setProtectedHeader({ alg: 'HS256' }).sign(key);
        let inventoryHook: (() => void | Promise<void>) | undefined;
        let probeHook: ((machineId: string) => void | Promise<void>) | undefined;
        let probeFailure: { status: number; body: object } | undefined;
        const sessions = new Map<string, object>();
        const native = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
            const url = new URL(request.url);
            if (url.pathname === '/api/auth') return Response.json({ token: nativeToken });
            expect(request.headers.get('authorization')).toBe(`Bearer ${nativeToken}`); calls.push(`${request.method} ${url.pathname}`);
            if (url.pathname === '/health') return Response.json({ capabilities: { machineInventory: 1 } });
            if (url.pathname === '/api/machines') { await inventoryHook?.(); return Response.json({ machines }); }
            const probeMachine = machines.find(m => url.pathname === `/api/machines/${m.id}/agent-availability`);
            if (probeMachine) {
                expect(url.searchParams.get('details')).toBe('true'); await probeHook?.(probeMachine.id);
                if (probeFailure) return Response.json(probeFailure.body, { status: probeFailure.status });
                return Response.json({ agents: [resourceInspection('codex'), resourceInspection('claude')] });
            }
            const session = sessions.get(url.pathname.slice('/api/sessions/'.length));
            if (session && request.method === 'GET') return Response.json({ session });
            const machine = machines.find(m => url.pathname === `/api/machines/${m.id}`);
            if (machine && request.method === 'PATCH') {
                const { displayName } = await request.json() as { displayName: string }; machine.metadata!.displayName = displayName;
                return Response.json({ ok: true });
            }
            return Response.json({ error: 'unknown' }, { status: 404 });
        } });
        cleanup.resources.push(() => native.stop(true));
        const gateway = await (configuration ? createConfigurationGateway : createResourceGateway)({ host: '127.0.0.1', port: 0, target: native.url.origin, key, statePath: h.path, rootToken: 'fixture-root' });
        cleanup.resources.push(() => gateway.close());
        const url = `http://127.0.0.1:${(gateway.server.address() as { port: number }).port}`;
        const auth = async (identity: string, spaceId?: string) => (await gateway.authority.exchange(identity, spaceId)).token;
        async function request(path: string, token: string, method = 'GET', body?: unknown) {
            const response = await fetch(url + path, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
                ...(body ? { body: JSON.stringify(body) } : {}) });
            return { status: response.status, body: await response.json() as any };
        }
        return { ...h, gateway, url, auth, request, machines, calls, sessions, setInventoryHook(fn: typeof inventoryHook) { inventoryHook = fn; },
            setProbeHook(fn: typeof probeHook) { probeHook = fn; }, setProbeFailure(failure: typeof probeFailure) { probeFailure = failure; },
            connect(id: string) { machines.push({ id, namespace: 'runweft', seq: 1, createdAt: 1, updatedAt: 1, active: true, activeAt: 1,
                metadata: { host: '/private/host', platform: 'test', happyCliVersion: 'test' }, metadataVersion: 1, runnerState: { status: 'running' }, runnerStateVersion: 1 }); } };
    } catch (error) { return cleanup.failed(error); }
}
