import { z } from 'zod';
import { MachineSchema, type Machine } from '../../hapi/shared/src/schemas';
import { AgentAvailabilityResponseSchema } from '../../hapi/shared/src/apiTypes';
import { errorDetails } from '../errors';
import { HapiRequestError } from '../hapi';
import { ResourceStore } from './store';
import { ResourceError, InspectionSchema, FlavorSchema, MachineRegistrationInput, RuntimeRegistrationInput, RenameInput,
    flavors, eligibility, machineProblem, inspectionProblem, invalidInput, rejectProblem,
    type HapiRequester, type Inspection, type Problem, type MachineView, type RuntimeRegistration, type RuntimeView,
    type Discovery, type ExecutionTarget } from './types';

const InventorySchema = z.object({ machines: z.array(MachineSchema) });
type Probe = { inspections: Inspection[]; problem: null } | { inspections: null; problem: Problem };

/** Scope comes from the authenticated caller, never the server's local/hub configuration. */
export class ResourceService {
    constructor(private readonly store: ResourceStore, readonly namespace: string, private readonly hapi: HapiRequester) {}

    private machineView(machine: Machine): MachineView {
        const registration = this.store.machine(this.namespace, machine.id);
        const view: MachineView = { id: machine.id, name: machine.metadata?.displayName || machine.metadata?.host || machine.id,
            host: machine.metadata?.host ?? null, platform: machine.metadata?.platform ?? null,
            online: machine.active, lastActiveAt: machine.activeAt, registered: registration?.registered ?? false,
            registration, eligibility: eligibility(null) };
        view.eligibility = eligibility(machineProblem(view));
        return view;
    }
    async machines(): Promise<MachineView[]> {
        const health = await this.hapi('/health');
        if (health?.capabilities?.machineInventory !== 1) throw new ResourceError(409, 'resource_capability_missing', 'HAPI 不支持完整机器库存。', '更新配套 Runweft Hub。');
        const result = InventorySchema.safeParse(await this.hapi('/api/machines?includeOffline=true'));
        if (!result.success || result.data.machines.some(machine => machine.namespace !== this.namespace)) {
            throw new ResourceError(502, 'invalid_hapi_response', 'HAPI 返回的机器库存或作用域无效。', '运行 runweft doctor 检查配套版本。');
        }
        return result.data.machines.map(machine => this.machineView(machine));
    }
    async machine(id: string): Promise<MachineView> {
        const machine = (await this.machines()).find(machine => machine.id === id);
        if (!machine) rejectProblem(machineProblem(null)!);
        return machine;
    }
    private refreshRegistration(machine: MachineView | null) {
        if (!machine) return null;
        const registration = this.store.machine(this.namespace, machine.id);
        const view = { ...machine, registration, registered: registration?.registered ?? false };
        view.eligibility = eligibility(machineProblem(view));
        return view;
    }
    async registerMachine(input: unknown) {
        const parsed = MachineRegistrationInput.safeParse(input);
        if (!parsed.success) throw invalidInput();
        const { machineId, name } = parsed.data;
        let machine = await this.machine(machineId);
        if (name !== undefined) machine = await this.renameMachine(machineId, { name });
        this.store.registerMachine(this.namespace, machineId);
        return this.refreshRegistration(machine)!;
    }
    async renameMachine(id: string, input: unknown) {
        const parsed = RenameInput.safeParse(input);
        if (!parsed.success) throw invalidInput();
        await this.machine(id);
        await this.hapi(`/api/machines/${encodeURIComponent(id)}`, {
            method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: parsed.data.name }),
        });
        return this.machine(id);
    }
    async unregisterMachine(id: string) {
        const machine = await this.machine(id);
        const affectedRuntimeIds = this.store.unregisterMachine(this.namespace, id);
        return { machine: this.refreshRegistration(machine)!, affectedRuntimeIds, existingExecutions: 'unchanged' as const };
    }
    private async inspect(machine: MachineView): Promise<Inspection[]> {
        if (!machine.online) rejectProblem({ code: 'machine_offline', message: '目标机器离线，无法探测工具。', hint: '在目标机器运行 runweft start。' });
        let inspections: Inspection[];
        try {
            const raw = await this.hapi(`/api/machines/${encodeURIComponent(machine.id)}/agent-availability?details=true`);
            const parsed = AgentAvailabilityResponseSchema.safeParse(raw);
            if (!parsed.success) throw new Error('invalid availability response');
            inspections = flavors.map(flavor => {
                const entries = parsed.data.agents.filter(entry => entry.agent === flavor);
                if (entries.length !== 1) throw new Error('missing or repeated runtime detail');
                return InspectionSchema.parse(entries[0]);
            });
        } catch (error) {
            if (error instanceof HapiRequestError) {
                if ([401, 403].includes(error.status)) throw error;
                if (error.code === 'runner_upgrade_required') throw new ResourceError(409, error.code, '目标 Runner 不支持原生工具详情。', '在目标机器更新 Runweft 并运行 runweft restart。');
                if (error.code === 'machine_offline') throw new ResourceError(409, error.code, '目标机器已离线。', '在目标机器运行 runweft start。');
            }
            throw new ResourceError(502, 'runtime_probe_failed', '无法取得目标 Runner 的原生工具详情。', '检查目标机器连接和 Runner 日志，再运行 runweft runtime check；未启动或重发任务。');
        }
        for (const inspection of inspections) this.store.saveInspection(this.namespace, machine.id, inspection);
        return inspections;
    }
    async discover(machineId: string): Promise<Discovery> {
        const machine = await this.machine(machineId);
        const inspections = await this.inspect(machine);
        return { machine: this.refreshRegistration(machine)!, tools: inspections.map(inspection => ({
            flavor: inspection.agent, inspection, toolFound: Boolean(inspection.details.executable),
            problem: inspectionProblem(inspection), modelAuthentication: 'not_checked', execution: 'not_checked',
        })) };
    }
    private requireRuntime(id: string) {
        const runtime = this.store.runtime(this.namespace, id);
        if (!runtime) throw new ResourceError(404, 'runtime_unknown', '当前连接中找不到此 runtime ID。', '运行 runweft runtime list --all；切换 Hub 不会迁移资源，请显式重新选择引用。');
        return runtime;
    }
    private runtimeView(runtime: RuntimeRegistration, machine: MachineView | null, probe?: Probe): RuntimeView {
        const inspection = probe?.inspections?.find(entry => entry.agent === runtime.flavor) ?? runtime.inspection;
        const current = Boolean(probe?.inspections);
        const reason = !runtime.registered
            ? { code: 'runtime_unregistered', message: '此 runtime 已取消登记。', hint: `运行 runweft runtime register ${runtime.flavor} --machine ${runtime.machineId} 恢复同一 ID。` }
            : machineProblem(machine) ?? probe?.problem ?? (current && inspection ? inspectionProblem(inspection)
                : { code: 'runtime_not_checked', message: '尚未取得当前工具详情。', hint: `运行 runweft runtime check ${runtime.id}。` });
        return { ...runtime, inspection, machine, inspectionCurrent: current, eligibility: eligibility(reason),
            modelAuthentication: 'not_checked', execution: 'not_checked' };
    }
    private async probe(machine: MachineView): Promise<Probe> {
        try { return { inspections: await this.inspect(machine), problem: null }; }
        catch (error) {
            if (!(error instanceof ResourceError)) throw error;
            return { inspections: null, problem: errorDetails(error) };
        }
    }
    async runtimes(all = false): Promise<RuntimeView[]> {
        const records = this.store.runtimes(this.namespace, all);
        if (!records.length) return [];
        const machines = await this.machines();
        const targetIds = new Set(records.map(runtime => runtime.machineId));
        const targets = machines.filter(machine => targetIds.has(machine.id) && machine.online);
        const results = await Promise.allSettled(targets.map(machine => this.probe(machine)));
        const probes = new Map<string, Probe>();
        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            if (result.status === 'rejected') throw result.reason;
            probes.set(targets[i].id, result.value);
        }
        // Read flags again after probes, so cancellation during a probe isn't reported as eligible.
        return records.map(record => this.runtimeView(this.requireRuntime(record.id),
            this.refreshRegistration(machines.find(machine => machine.id === record.machineId) ?? null), probes.get(record.machineId)))
            .filter(runtime => all || runtime.registered);
    }
    async runtime(id: string): Promise<RuntimeView> {
        const runtime = this.requireRuntime(id);
        const machine = (await this.machines()).find(machine => machine.id === runtime.machineId) ?? null;
        const probe = machine?.online ? await this.probe(machine) : undefined;
        return this.runtimeView(this.requireRuntime(id), this.refreshRegistration(machine), probe);
    }
    async registerRuntime(input: unknown): Promise<RuntimeView> {
        const parsed = RuntimeRegistrationInput.safeParse(input);
        if (!parsed.success) throw invalidInput();
        const { machineId, flavor, name } = parsed.data;
        const machine = await this.machine(machineId);
        const problem = machineProblem(machine);
        if (problem) rejectProblem(problem);
        const inspections = await this.inspect(machine);
        const inspection = inspections.find(entry => entry.agent === flavor)!;
        const unavailable = inspectionProblem(inspection);
        if (unavailable) rejectProblem(unavailable);
        const runtime = this.store.registerRuntime(this.namespace, machineId, flavor, name, inspection);
        return this.runtimeView(runtime, this.refreshRegistration(machine), { inspections, problem: null });
    }
    renameRuntime(id: string, input: unknown) {
        const parsed = RenameInput.safeParse(input);
        if (!parsed.success) throw invalidInput();
        this.requireRuntime(id);
        this.store.renameRuntime(this.namespace, id, parsed.data.name);
        return this.requireRuntime(id);
    }
    unregisterRuntime(id: string) {
        this.requireRuntime(id);
        this.store.unregisterRuntime(this.namespace, id);
        return { runtime: this.requireRuntime(id), existingExecutions: 'unchanged' as const };
    }
    async resolveExecutionTarget(id: string): Promise<ExecutionTarget> {
        const view = await this.runtime(id);
        if (view.eligibility.reason) rejectProblem(view.eligibility.reason);
        return Object.freeze({ runtimeId: view.id, machineId: view.machineId,
            flavor: FlavorSchema.parse(view.flavor), inspection: structuredClone(view.inspection!) });
    }
}
