import { dataPaths, targetUrl, type ResolvedConfig } from '../config';
import { hapiClient, readSettings, type HapiClient } from '../hapi';
import { RunweftError } from '../errors';
import { eligibility, type Discovery, type ExecutionTarget, type Flavor, type MachineView, type Problem, type RuntimeRegistration, type RuntimeView } from './types';

const base = '/api/runweft/resources';
type Scoped<T> = T & { namespace: string };

/** Client routing policy. A public Hub's own config may be local, so the server does not apply this restriction. */
export class ResourceClient {
    constructor(private readonly config: ResolvedConfig, private readonly hapi: Pick<HapiClient, 'request'> = hapiClient(config)) {}

    localMachineId(required = true): string | null {
        const value = readSettings(dataPaths(this.config).hapiClient).machineId;
        if (typeof value === 'string' && value) return value;
        if (!required) return null;
        throw new RunweftError('local_machine_missing', '当前连接尚无本机 Runner 身份。', '先运行 runweft start；登记命令不会自动启动服务。');
    }
    get connection() {
        return { mode: this.config.config.mode, url: targetUrl(this.config.config), localMachineId: this.localMachineId(false) };
    }
    private localProblem(machineId: string): Problem | null {
        if (this.config.config.mode !== 'local') return null;
        const own = this.localMachineId(false);
        if (!own) return { code: 'local_machine_missing', message: '当前连接尚无本机 Runner 身份。', hint: '先运行 runweft start。' };
        if (own !== machineId) return { code: 'local_target_required', message: 'local 模式只能选择当前连接的本机资源。', hint: '使用本机机器 ID；需要其他机器时显式切换到对应 Hub 连接。' };
        return null;
    }
    private selectMachine(id?: string) {
        const machineId = id ?? this.localMachineId()!;
        const problem = this.localProblem(machineId);
        if (problem) throw new RunweftError(problem.code, problem.message, problem.hint);
        return machineId;
    }
    private machinePolicy(machine: MachineView): MachineView {
        const problem = this.localProblem(machine.id);
        return problem ? { ...machine, eligibility: eligibility(problem) } : machine;
    }
    private runtimePolicy(runtime: RuntimeView): RuntimeView {
        const problem = this.localProblem(runtime.machineId);
        return { ...runtime, machine: runtime.machine ? this.machinePolicy(runtime.machine) : null,
            eligibility: problem ? eligibility(problem) : runtime.eligibility };
    }
    private async request<T>(path: string, method = 'GET', value?: unknown, signal?: AbortSignal): Promise<Scoped<T>> {
        return this.hapi.request(`${base}${path}`, { method, signal, ...(value === undefined ? {} : {
            headers: { 'content-type': 'application/json' }, body: JSON.stringify(value),
        }) });
    }
    async machines(all = false) {
        const result = await this.request<{ machines: MachineView[] }>('/machines');
        const own = this.localMachineId(false);
        return { ...result, machines: result.machines.filter(machine => all || machine.registered || machine.id === own).map(machine => this.machinePolicy(machine)) };
    }
    async machine(id?: string) {
        const result = await this.request<{ machine: MachineView }>(`/machines/${encodeURIComponent(id ?? this.localMachineId()!)}`);
        return { ...result, machine: this.machinePolicy(result.machine) };
    }
    async registerMachine(id?: string, name?: string) {
        return this.request<{ machine: MachineView }>('/machines', 'POST', { machineId: this.selectMachine(id), name });
    }
    async renameMachine(id: string, name: string) {
        return this.request<{ machine: MachineView }>(`/machines/${encodeURIComponent(this.selectMachine(id))}`, 'PATCH', { name });
    }
    async unregisterMachine(id: string) {
        return this.request<{ machine: MachineView; affectedRuntimeIds: string[]; existingExecutions: 'unchanged' }>(`/machines/${encodeURIComponent(this.selectMachine(id))}`, 'DELETE');
    }
    async discover(machineId?: string) {
        return this.request<Discovery>(`/machines/${encodeURIComponent(this.selectMachine(machineId))}/discover`);
    }
    async runtimes(all = false, signal?: AbortSignal) {
        const result = await this.request<{ runtimes: RuntimeView[] }>(`/runtimes?all=${all}`, 'GET', undefined, signal);
        return { ...result, runtimes: result.runtimes.map(runtime => this.runtimePolicy(runtime)) };
    }
    async runtime(id: string, check = false) {
        const result = await this.request<{ runtime: RuntimeView }>(`/runtimes/${encodeURIComponent(id)}${check ? '/check' : ''}`);
        return { ...result, runtime: this.runtimePolicy(result.runtime) };
    }
    async registerRuntime(flavor: Flavor, machineId?: string, name?: string) {
        return this.request<{ runtime: RuntimeView }>('/runtimes', 'POST', { machineId: this.selectMachine(machineId), flavor, name });
    }
    async renameRuntime(id: string, name: string) {
        this.selectMachine((await this.runtime(id)).runtime.machineId);
        return this.request<{ runtime: RuntimeRegistration }>(`/runtimes/${encodeURIComponent(id)}`, 'PATCH', { name });
    }
    async unregisterRuntime(id: string) {
        this.selectMachine((await this.runtime(id)).runtime.machineId);
        return this.request<{ runtime: RuntimeRegistration; existingExecutions: 'unchanged' }>(`/runtimes/${encodeURIComponent(id)}`, 'DELETE');
    }
    async resolveExecutionTarget(id: string, signal?: AbortSignal): Promise<ExecutionTarget> {
        const { target } = await this.request<{ target: ExecutionTarget }>(`/runtimes/${encodeURIComponent(id)}/resolve`, 'GET', undefined, signal);
        this.selectMachine(target.machineId);
        return Object.freeze(target);
    }
}
