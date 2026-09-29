import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { HapiRequestError, fetchJson } from '../src/hapi';
import { dataPaths, loadConfig, atomicWrite } from '../src/config';
import { ResourceClient } from '../src/resources/client';
import { ResourceStore } from '../src/resources/store';
import type { RuntimeView } from '../src/resources/types';
import type { Machine } from '../hapi/shared/src/schemas';
import { resourceFixture, resourcePrefix as prefix, resourceWrite as write, resourceInspection as inspection } from './resources-fixture';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const harness = () => resourceFixture(cleanups);

describe('central resource registry', () => {
    test('auth precedes storage; each native request forwards the caller JWT and namespace', async () => {
        const h = await harness();
        const rejected = await fetch(`${h.url}${prefix}/machines`, write({ machineId: 'own' }));
        expect(rejected.status).toBe(401);
        expect(existsSync(h.statePath)).toBe(false);
        const invalid = await fetch(`${h.url}${prefix}/machines`, { headers: { authorization: 'Bearer invalid' } });
        expect(invalid.status).toBe(401);
        expect(existsSync(h.statePath)).toBe(false);
        const runtime = await h.register();
        expect(runtime.modelAuthentication).toBe('not_checked');
        expect(runtime.execution).toBe('not_checked');
        expect((await h.beta.request(`${prefix}/machines`)).machines.map((machine: Machine) => machine.id)).toEqual(['beta-machine']);
        await expect(h.beta.request(`${prefix}/machines`, write({ machineId: 'own' }))).rejects.toMatchObject({ status: 404, code: 'machine_unknown' });
        await expect(h.beta.request(`${prefix}/machines/own`, write({ name: 'stolen' }, 'PATCH'))).rejects.toMatchObject({ code: 'machine_unknown' });
        await expect(h.beta.request(`${prefix}/machines/own`, { method: 'DELETE' })).rejects.toMatchObject({ code: 'machine_unknown' });
        await expect(h.beta.request(`${prefix}/runtimes/${runtime.id}`)).rejects.toMatchObject({ status: 404, code: 'runtime_unknown' });
        await expect(h.beta.request(`${prefix}/runtimes/${runtime.id}`, write({ name: 'changed' }, 'PATCH'))).rejects.toMatchObject({ code: 'runtime_unknown' });
        await expect(h.beta.request(`${prefix}/runtimes/${runtime.id}`, { method: 'DELETE' })).rejects.toMatchObject({ code: 'runtime_unknown' });
        expect((await h.alpha.request(`${prefix}/runtimes/${runtime.id}`)).runtime.name).toBe('codex');
        for (const call of h.calls) expect(call.authorization).toBe(`Bearer ${h.tokens.get(call.namespace)}`);
        expect(statSync(h.statePath).mode & 0o777).toBe(0o600);
    });

    test('discovery is read-only; concurrent registration, rename, cancellation and restore retain identity', async () => {
        const h = await harness();
        const discovered = await h.alpha.request(`${prefix}/machines/own/discover`);
        expect(discovered.tools).toHaveLength(2);
        expect(discovered.machine.registered).toBe(false);
        expect((await h.alpha.request(`${prefix}/runtimes?all=true`)).runtimes).toEqual([]);
        await expect(h.alpha.request(`${prefix}/runtimes`, write({ machineId: 'own', flavor: 'codex' }))).rejects.toMatchObject({ code: 'machine_unregistered' });
        await h.alpha.request(`${prefix}/machines`, write({ machineId: 'own', name: 'Workstation' }));
        const repeated = await Promise.all(Array.from({ length: 16 }, () => h.alpha.request(`${prefix}/runtimes`, write({ machineId: 'own', flavor: 'codex' }))));
        const id = repeated[0].runtime.id;
        expect(new Set(repeated.map(result => result.runtime.id)).size).toBe(1);
        const claude = await h.register('own', 'claude');
        expect(claude.id).not.toBe(id);
        await h.alpha.request(`${prefix}/runtimes/${id}`, write({ name: 'Reviewer' }, 'PATCH'));
        await expect(h.alpha.request(`${prefix}/runtimes/${id}`, write({ name: 'Retarget', machineId: 'remote' }, 'PATCH'))).rejects.toMatchObject({ status: 400, code: 'invalid_resource_request' });
        await expect(h.alpha.request(`${prefix}/runtimes/${id}`, write({ name: 'Retarget', flavor: 'claude' }, 'PATCH'))).rejects.toMatchObject({ status: 400 });
        const target = (await h.alpha.request(`${prefix}/runtimes/${id}/resolve`)).target;
        expect(target).toMatchObject({ runtimeId: id, machineId: 'own', flavor: 'codex' });
        const cancelled = await h.alpha.request(`${prefix}/machines/own`, { method: 'DELETE' });
        expect(cancelled.affectedRuntimeIds.sort()).toEqual([id, claude.id].sort());
        expect(cancelled.existingExecutions).toBe('unchanged');
        await expect(h.alpha.request(`${prefix}/runtimes/${id}/resolve`)).rejects.toMatchObject({ code: 'machine_unregistered' });
        expect((await h.alpha.request(`${prefix}/runtimes/${id}`)).runtime.registered).toBe(true);
        await h.alpha.request(`${prefix}/machines`, write({ machineId: 'own' }));
        expect((await h.alpha.request(`${prefix}/runtimes/${id}/resolve`)).target.runtimeId).toBe(id);
        await h.alpha.request(`${prefix}/runtimes/${id}`, { method: 'DELETE' });
        await expect(h.alpha.request(`${prefix}/runtimes/${id}/resolve`)).rejects.toMatchObject({ code: 'runtime_unregistered' });
        expect((await h.alpha.request(`${prefix}/runtimes`)).runtimes.map((r: RuntimeView) => r.id)).toEqual([claude.id]);
        expect((await h.alpha.request(`${prefix}/runtimes?all=true`)).runtimes).toHaveLength(2);
        const restored = await h.register();
        expect(restored).toMatchObject({ id, name: 'Reviewer', machineId: 'own', flavor: 'codex', registered: true });
        expect(restored.machine?.name).toBe('Workstation');
        expect(target).toMatchObject({ runtimeId: id, machineId: 'own', flavor: 'codex' });
        expect(h.calls.filter(call => call.method !== 'GET').map(call => call.path)).toEqual(['/api/machines/own']);
    });

    test('offline details are historical and failures never resolve to another target', async () => {
        const h = await harness();
        const runtime = await h.register();
        const oldInspection = runtime.inspection;
        h.machines.find(machine => machine.id === 'own')!.active = false;
        const offline = (await h.alpha.request(`${prefix}/runtimes/${runtime.id}`)).runtime;
        expect(offline.inspectionCurrent).toBe(false);
        expect(offline.inspection).toEqual(oldInspection);
        expect(offline.eligibility.reason.code).toBe('machine_offline');
        await expect(h.alpha.request(`${prefix}/runtimes/${runtime.id}/resolve`)).rejects.toMatchObject({ code: 'machine_offline' });
        const known = await h.alpha.request(`${prefix}/machines`, write({ machineId: 'offline' }));
        expect(known.machine).toMatchObject({ registered: true, online: false });
        await expect(h.alpha.request(`${prefix}/runtimes`, write({ machineId: 'offline', flavor: 'codex' }))).rejects.toMatchObject({ code: 'machine_offline' });
        h.machines.find(machine => machine.id === 'own')!.active = true;
        h.failures.set('own', { status: 500, body: { error: 'RPC failed' } });
        const failed = (await h.alpha.request(`${prefix}/runtimes/${runtime.id}`)).runtime;
        expect(failed.inspectionCurrent).toBe(false);
        expect(failed.inspection).toEqual(oldInspection);
        await expect(h.alpha.request(`${prefix}/runtimes/${runtime.id}/resolve`)).rejects.toMatchObject({ code: 'runtime_probe_failed', hint: expect.stringContaining('日志') });
        h.failures.set('own', { status: 409, body: { code: 'runner_upgrade_required', error: 'old runner' } });
        await expect(h.alpha.request(`${prefix}/runtimes/${runtime.id}/resolve`)).rejects.toMatchObject({ code: 'runner_upgrade_required' });
        h.failures.clear();
        h.machines.splice(h.machines.findIndex(machine => machine.id === 'own'), 1);
        await expect(h.alpha.request(`${prefix}/runtimes/${runtime.id}/resolve`)).rejects.toMatchObject({ code: 'machine_unknown' });
        await expect(h.alpha.request(`${prefix}/runtimes/missing/resolve`)).rejects.toMatchObject({ code: 'runtime_unknown' });
    });

    test('fresh inspection checks both native preflight and actual command; unknown version alone is allowed', async () => {
        const h = await harness();
        const runtime = await h.register();
        const native = h.inspections.get('own')![0];
        native.details = { checkedAt: Date.now() + 1, executable: null, version: null, versionStatus: 'not_found' };
        // HAPI's legacy override can pass preflight while the shared launcher has no Codex.
        await expect(h.alpha.request(`${prefix}/runtimes/${runtime.id}/resolve`)).rejects.toMatchObject({ code: 'runtime_command_missing' });
        native.details = inspection('codex', 'failed').details;
        native.available = false; native.reason = 'invalid_configuration';
        await expect(h.alpha.request(`${prefix}/runtimes/${runtime.id}/resolve`)).rejects.toMatchObject({ code: 'runtime_invalid_configuration' });
        native.available = true; delete native.reason;
        const target = (await h.alpha.request(`${prefix}/runtimes/${runtime.id}/resolve`)).target;
        expect(target.inspection.details).toMatchObject({ version: null, versionStatus: 'failed' });
        native.details.versionStatus = 'timeout';
        expect((await h.register()).id).toBe(runtime.id);
        h.inspections.get('own')!.pop();
        await expect(h.alpha.request(`${prefix}/runtimes/${runtime.id}/resolve`)).rejects.toMatchObject({ code: 'runtime_probe_failed' });
        h.setInventorySupported(false);
        await expect(h.alpha.request(`${prefix}/machines`)).rejects.toMatchObject({ code: 'resource_capability_missing' });
    });

    test('list probes each machine once and contains one-machine failures without hiding successful peers', async () => {
        const h = await harness();
        await h.register('own'); await h.register('own', 'claude'); await h.register('remote');
        h.failures.set('remote', { status: 500, body: { error: 'RPC failed' } });
        const before = h.calls.length;
        const { runtimes } = await h.alpha.request(`${prefix}/runtimes`);
        expect(runtimes.filter((runtime: RuntimeView) => runtime.eligibility.eligible)).toHaveLength(2);
        expect(runtimes.find((runtime: RuntimeView) => runtime.machineId === 'remote').eligibility.reason.code).toBe('runtime_probe_failed');
        expect(h.calls.slice(before).filter(call => call.path.endsWith('agent-availability'))).toHaveLength(2);
        h.failures.set('remote', { status: 403, body: { error: 'access denied' } });
        await expect(h.alpha.request(`${prefix}/runtimes`)).rejects.toMatchObject({ status: 403, code: 'authentication_failed' });
    });

    test('machine cancellation during an in-flight probe prevents registration and target resolution', async () => {
        const h = await harness();
        const runtime = await h.register();
        for (const action of ['register', 'resolve']) {
            await h.alpha.request(`${prefix}/machines`, write({ machineId: 'own' }));
            let entered!: () => void, release!: () => void;
            const ready = new Promise<void>(resolve => { entered = resolve; });
            const gate = new Promise<void>(resolve => { release = resolve; });
            h.hooks.set('own', async () => { entered(); await gate; });
            const pending = action === 'register' ? h.alpha.request(`${prefix}/runtimes`, write({ machineId: 'own', flavor: 'claude' }))
                : h.alpha.request(`${prefix}/runtimes/${runtime.id}/resolve`);
            const outcome = pending.then(value => ({ value }), error => ({ error }));
            await ready;
            await h.alpha.request(`${prefix}/machines/own`, { method: 'DELETE' });
            release();
            expect(await outcome).toMatchObject({ error: { code: 'machine_unregistered' } });
            h.hooks.clear();
        }
        const store = new ResourceStore(h.statePath);
        try { expect(store.runtimes('alpha', true)).toHaveLength(1); } finally { store.close(); }
    });

    test('client local routing is independent of center role and Hub clients have no authority copy', async () => {
        const h = await harness();
        const remote = await h.register('remote');
        const home = join(h.home, 'client');
        const localConfig = loadConfig(home, {});
        atomicWrite(join(dataPaths(localConfig).hapiClient, 'settings.json'), JSON.stringify({ machineId: 'own' }));
        const local = new ResourceClient(localConfig, h.alpha);
        await expect(local.registerMachine('remote')).rejects.toMatchObject({ code: 'local_target_required' });
        await expect(local.resolveExecutionTarget(remote.id)).rejects.toMatchObject({ code: 'local_target_required' });
        expect((await local.runtime(remote.id)).runtime.eligibility.reason?.code).toBe('local_target_required');
        expect((await local.machines()).machines.map(machine => machine.id).sort()).toEqual(['own', 'remote']);
        expect((await local.machines(true)).machines).toHaveLength(3);
        const hubConfig = loadConfig(home, { RUNWEFT_MODE: 'hub', RUNWEFT_HUB_URL: h.url });
        const hub = new ResourceClient(hubConfig, h.alpha);
        await expect(hub.registerMachine()).rejects.toMatchObject({ code: 'local_machine_missing' });
        const target = await hub.resolveExecutionTarget(remote.id);
        expect(target.machineId).toBe('remote');
        expect(Object.isFrozen(target)).toBe(true);
        expect(existsSync(dataPaths(hubConfig).state)).toBe(false);
        expect(dataPaths(localConfig).hapiClient).not.toBe(dataPaths(hubConfig).hapiClient);
        const other = await harness();
        await expect(new ResourceClient(loadConfig(home, { RUNWEFT_MODE: 'hub', RUNWEFT_HUB_URL: other.url }), other.alpha)
            .resolveExecutionTarget(remote.id)).rejects.toMatchObject({ code: 'runtime_unknown' });
    });

    test('runtime cancellation during resolution is observed after the probe', async () => {
        const h = await harness();
        const runtime = await h.register();
        let entered!: () => void, release!: () => void;
        const ready = new Promise<void>(resolve => { entered = resolve; });
        const gate = new Promise<void>(resolve => { release = resolve; });
        h.hooks.set('own', async () => { entered(); await gate; });
        const outcome = h.alpha.request(`${prefix}/runtimes/${runtime.id}/resolve`).then(value => ({ value }), error => ({ error }));
        await ready;
        await h.alpha.request(`${prefix}/runtimes/${runtime.id}`, { method: 'DELETE' });
        release();
        expect(await outcome).toMatchObject({ error: { code: 'runtime_unregistered' } });
    });

    test('persisted schema, flags, inspections and IDs survive reopen; newer schemas are not overwritten', async () => {
        const h = await harness();
        const runtime = await h.register();
        // Every real API call above closes its SQLite connection before the next response is consumed.
        const store = new ResourceStore(h.statePath);
        try {
            expect(store.runtime('alpha', runtime.id)).toMatchObject({ id: runtime.id, inspection: runtime.inspection });
            expect(store.runtime('beta', runtime.id)).toBeNull();
            store.unregisterRuntime('beta', runtime.id);
            expect(store.runtime('alpha', runtime.id)?.registered).toBe(true);
            const older = structuredClone(runtime.inspection!);
            older.details.checkedAt = 0; older.details.version = 'old';
            store.saveInspection('alpha', 'own', older);
            expect(store.runtime('alpha', runtime.id)?.inspection).toEqual(runtime.inspection);
        } finally { store.close(); }
        const db = new Database(h.statePath);
        expect(db.query('PRAGMA user_version').get()).toEqual({ user_version: 5 });
        expect(db.query('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
        db.exec('PRAGMA user_version=6'); db.close();
        expect(() => new ResourceStore(h.statePath)).toThrow('数据版本');
        const later = new Database(h.statePath);
        try { expect(later.query('PRAGMA user_version').get()).toEqual({ user_version: 6 }); } finally { later.close(); }
    });

    test('structured and native errors retain code, message, hint and status without mutation replay', async () => {
        const h = await harness();
        let error: unknown;
        try { await h.alpha.request(`${prefix}/runtimes`, write({ machineId: 'own', flavor: 'unsupported' })); } catch (caught) { error = caught; }
        expect(error).toBeInstanceOf(HapiRequestError);
        expect(error).toMatchObject({ code: 'invalid_resource_request', status: 400, message: '资源参数无效。', hint: expect.stringContaining('不能') });
        expect(h.calls).toHaveLength(0);
        const raw = await fetch(`${h.url}${prefix}/runtimes`, { method: 'POST', headers: { authorization: `Bearer ${h.tokens.get('alpha')}` }, body: '{bad' });
        expect(raw.status).toBe(400);
        const oversized = await fetch(`${h.url}${prefix}/runtimes`, { method: 'POST', headers: { authorization: `Bearer ${h.tokens.get('alpha')}` }, body: JSON.stringify({ name: 'a'.repeat(20_000) }) });
        expect(oversized.status).toBe(413);
        await expect(fetchJson(`${h.url}/api/machines/missing`, { headers: { authorization: `Bearer ${h.tokens.get('alpha')}` } })).rejects.toMatchObject({ status: 404, message: 'not found' });
    });
});
