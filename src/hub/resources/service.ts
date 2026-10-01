import type { Machine } from '../../../hapi/shared/src/schemas';
import { HapiRequestError } from '../../hapi';
import { nativeMachines, nativeInspections } from '../../resources/native';
import { RenameInput, ResourceError, invalidInput, eligibility, inspectionProblem, rejectProblem, type Inspection, type Problem } from '../../resources/types';
import { NativeTransport, type AuthorizationLease as RequestLease } from '../access/transport';
import { HAPI_EXECUTION_NAMESPACE, type Principal } from '../access/types';
import { HubResourceStore } from './store';
import { RuntimeInput, type MachineView, type MachineRecord, type RuntimeRecord, type RuntimeView, type PublicExecutionTarget, type Observation } from './types';

type Probe = { inspections: Inspection[]; problem: null } | { inspections: null; problem: Problem };
function observation(inspection: Inspection | null): Observation {
    return { version: inspection?.details.version ?? null, versionStatus: inspection?.details.versionStatus ?? null,
        checkedAt: inspection?.details.checkedAt ?? null, toolFound: inspection ? !!inspection.details.executable : null };
}

export class HubResourceService {
    constructor(readonly store: HubResourceStore, readonly native: NativeTransport) {}
    private async inventory(signal: AbortSignal) {
        try { return await nativeMachines((path, options) => this.native.json(path, options), HAPI_EXECUTION_NAMESPACE, signal); }
        catch (error) {
            if (error instanceof HapiRequestError) throw new ResourceError(502, 'machine_inventory_failed', '暂时无法读取 HAPI 机器库存。', '请 Hub 维护者检查原生服务连接。');
            throw error;
        }
    }
    private machineView(actor: Principal, record: MachineRecord, native?: Machine): MachineView {
        const owner = record.ownerId === actor.ownerId;
        // Nonowners get a whitelist; never use hostname as the display-name fallback.
        return { machineId: record.machineId, ownerId: record.ownerId, registered: record.registered,
            createdAt: record.createdAt, updatedAt: record.updatedAt, id: record.machineId, name: record.name ?? native?.metadata?.displayName ?? record.machineId,
            online: native?.active ?? false, connection: !native ? 'pending' : native.active ? 'online' : 'offline',
            lastActiveAt: native?.activeAt ?? null,
            blockedInSpace: this.store.blocked(actor.spaceId, 'machine', record.machineId),
            ...(owner ? { host: native?.metadata?.host ?? null, platform: native?.metadata?.platform ?? null, spaceIds: this.store.spaces(actor, record.machineId) } : {}),
            permissions: { manage: owner, associate: owner, govern: this.store.governs(actor.ownerId, record.machineId, actor.spaceId) } };
    }
    async machines(lease: RequestLease, signal = lease.signal): Promise<MachineView[]> {
        if (!this.store.machines(lease.actor).length) return [];
        const inventory = await this.inventory(signal); lease.check();
        return this.store.machines(lease.actor).map(record => this.machineView(lease.actor, record, inventory.find(m => m.id === record.machineId)));
    }
    async machine(lease: RequestLease, id: string): Promise<MachineView> {
        lease.add(() => { this.store.machine(lease.actor, id); });
        const inventory = await this.inventory(lease.signal); lease.check();
        return this.machineView(lease.actor, this.store.machine(lease.actor, id), inventory.find(m => m.id === id));
    }
    async renameMachine(lease: RequestLease, id: string, input: unknown): Promise<MachineView> {
        const parsed = RenameInput.safeParse(input); if (!parsed.success) throw invalidInput();
        lease.add(() => { this.store.ownMachine(lease.actor, id); });
        const before = await this.machine(lease, id);
        if (before.connection === 'pending') throw new ResourceError(409, 'machine_not_connected', '机器尚未首次连接，无法修改原生机器名称。', '先使用已保存的机器凭据启动 Runner，再修改名称。');
        lease.check();
        await this.native.write(`/api/machines/${encodeURIComponent(id)}`, { displayName: parsed.data.name }, lease.signal, 'PATCH');
        lease.check(); this.store.rename(lease.actor, id, parsed.data);
        return this.machine(lease, id);
    }
    private requireOnline(native: Machine | undefined) {
        if (!native?.active) throw new ResourceError(409, 'machine_offline', '目标机器未在线，无法检查原生工具。', '先连接该 Hub 并启动目标 Runner，再重新检查。');
    }
    private async probe(lease: RequestLease, machineId: string, guard: () => void): Promise<Probe> {
        const removeGuard = lease.add(guard);
        try {
            const inspections = await nativeInspections((path, init) => this.native.json(path, init), machineId, lease.signal);
            lease.check(); guard(); this.store.saveInspections(lease.actor, machineId, inspections, guard);
            return { inspections, problem: null };
        } catch (error) {
            lease.check(); guard();
            if (error instanceof HapiRequestError) return { inspections: null, problem: { code: 'runtime_probe_failed', message: '暂时无法读取原生工具详情。', hint: '请 Hub 维护者检查原生服务连接。' } };
            if (!(error instanceof ResourceError)) throw error;
            return { inspections: null, problem: { code: error.code, message: error.message, hint: error.hint } };
        } finally { removeGuard(); }
    }
    async discover(lease: RequestLease, id: string) {
        const guard = () => { this.store.ownMachine(lease.actor, id); };
        lease.add(guard); const machine = await this.machine(lease, id);
        if (!machine.online) this.requireOnline(undefined);
        const probe = await this.probe(lease, id, guard);
        if (probe.problem) rejectProblem(probe.problem);
        return { machine, tools: probe.inspections.map(inspection => ({ flavor: inspection.agent, inspection,
            toolFound: !!inspection.details.executable, problem: inspectionProblem(inspection), modelAuthentication: 'not_checked', execution: 'not_checked' })) };
    }
    private probeAllowed(actor: Principal, runtime: RuntimeRecord): boolean {
        // An owner's global inventory can inspect their own installations without claiming an execution space.
        return runtime.ownerId === actor.ownerId && actor.spaceId === null || this.store.usable(actor.ownerId, actor.spaceId, runtime.id).eligible;
    }
    private runtimeView(actor: Principal, row: RuntimeRecord, native?: Machine, probe?: Probe): RuntimeView {
        const owner = row.ownerId === actor.ownerId, policy = this.store.usable(actor.ownerId, actor.spaceId, row.id);
        const inspection = probe?.inspections?.find(i => i.agent === row.flavor) ?? row.inspection;
        const current = !!probe?.inspections;
        const reason = policy.reason ?? (!native?.active ? { code: 'machine_offline', message: '目标机器未在线。' }
            : probe?.problem ?? (current && inspection ? inspectionProblem(inspection) : { code: 'runtime_not_checked', message: '尚未取得当前工具详情。' }));
        return { id: row.id, machineId: row.machineId, ownerId: row.ownerId, name: row.name, flavor: row.flavor,
            registered: row.registered, createdAt: row.createdAt, updatedAt: row.updatedAt, ...observation(inspection),
            ...(owner ? { inspection, shareSpaceIds: this.store.shares(actor, row.id) } : {}),
            inspectionCurrent: current, online: native?.active ?? false, eligibility: eligibility(reason), shared: this.store.shared(row.id, actor.spaceId),
            blockedInSpace: this.store.blocked(actor.spaceId, 'runtime', row.id), machineBlockedInSpace: this.store.blocked(actor.spaceId, 'machine', row.machineId),
            permissions: { manage: owner, share: owner, use: policy.eligible, govern: this.store.governs(actor.ownerId, row.machineId, actor.spaceId) },
            modelAuthentication: 'not_checked', execution: 'not_checked' };
    }
    async runtimes(lease: RequestLease): Promise<RuntimeView[]> {
        const initial = this.store.runtimes(lease.actor); if (!initial.length) return [];
        const machines = await this.inventory(lease.signal); lease.check();
        const records = this.store.runtimes(lease.actor), probes = new Map<string, Probe>();
        for (const machine of machines.filter(m => m.active)) {
            const permitted = () => this.store.runtimes(lease.actor).filter(r => r.machineId === machine.id && this.probeAllowed(lease.actor, r));
            if (!permitted().length) continue;
            const guard = () => { if (!permitted().length) throw new ResourceError(409, 'runtime_access_changed', '工具探测期间资源权限已变更，请刷新列表。'); };
            probes.set(machine.id, await this.probe(lease, machine.id, guard));
        }
        lease.check();
        return this.store.runtimes(lease.actor).map(r => this.runtimeView(lease.actor, r, machines.find(m => m.id === r.machineId),
            this.probeAllowed(lease.actor, r) ? probes.get(r.machineId) : undefined));
    }
    async runtime(lease: RequestLease, id: string, check = false): Promise<RuntimeView> {
        lease.add(() => { this.store.runtime(lease.actor, id); });
        const machines = await this.inventory(lease.signal); lease.check();
        const runtime = this.store.runtime(lease.actor, id), machine = machines.find(m => m.id === runtime.machineId);
        let probe: Probe | undefined;
        if (check && !this.probeAllowed(lease.actor, runtime)) this.store.requireUsable(lease.actor.ownerId, lease.actor.spaceId, id);
        if (machine?.active && this.probeAllowed(lease.actor, runtime)) {
            const guard = () => {
                const row = this.store.runtime(lease.actor, id);
                if (!this.probeAllowed(lease.actor, row)) this.store.requireUsable(lease.actor.ownerId, lease.actor.spaceId, id);
            };
            probe = await this.probe(lease, runtime.machineId, guard);
        }
        return this.runtimeView(lease.actor, this.store.runtime(lease.actor, id), machine, probe);
    }
    async registerRuntime(lease: RequestLease, input: unknown): Promise<RuntimeView> {
        const parsed = RuntimeInput.safeParse(input); if (!parsed.success) throw invalidInput();
        const { machineId, flavor } = parsed.data;
        const prior = this.store.runtimes(lease.actor).find(r => r.machineId === machineId && r.flavor === flavor) ?? null;
        const guard = () => {
            if (!this.store.ownMachine(lease.actor, machineId).registered) throw new ResourceError(409, 'machine_unregistered', '目标机器已取消登记。');
        };
        lease.add(guard); const machines = await this.inventory(lease.signal); lease.check();
        const machine = machines.find(m => m.id === machineId); this.requireOnline(machine);
        const probe = await this.probe(lease, machineId, guard); if (probe.problem) rejectProblem(probe.problem);
        const inspection = probe.inspections.find(i => i.agent === flavor)!;
        const problem = inspectionProblem(inspection); if (problem) rejectProblem(problem);
        const row = this.store.registerRuntime(lease.actor, parsed.data, inspection, prior);
        return this.runtimeView(lease.actor, row, machine, probe);
    }
    async resolve(lease: RequestLease, id: string): Promise<PublicExecutionTarget> {
        lease.add(() => { this.store.runtime(lease.actor, id); this.store.requireUsable(lease.actor.ownerId, lease.actor.spaceId, id); });
        const view = await this.runtime(lease, id, true); lease.check();
        if (view.eligibility.reason) rejectProblem(view.eligibility.reason);
        return { runtimeId: view.id, machineId: view.machineId, flavor: view.flavor, ownerId: view.ownerId, spaceId: lease.actor.spaceId!, shared: view.shared,
            version: view.version, versionStatus: view.versionStatus, checkedAt: view.checkedAt, toolFound: view.toolFound };
    }
}
