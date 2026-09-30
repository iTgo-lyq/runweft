import type { Machine } from '../../../hapi/shared/src/schemas';
import { nativeMachines } from '../../resources/native';
import { RenameInput, ResourceError, invalidInput } from '../../resources/types';
import { NativeTransport, type RequestLease } from '../access/transport';
import { HAPI_EXECUTION_NAMESPACE, type Principal } from '../access/types';
import { HubResourceStore } from './store';
import type { MachineView, MachineRecord } from './types';

export class HubResourceService {
    constructor(readonly store: HubResourceStore, readonly native: NativeTransport) {}
    private inventory(signal: AbortSignal) { return nativeMachines((path, options) => this.native.json(path, options), HAPI_EXECUTION_NAMESPACE, signal); }
    private machineView(actor: Principal, record: MachineRecord, native?: Machine): MachineView {
        return { ...record, id: record.machineId, name: record.name ?? native?.metadata?.displayName ?? record.machineId,
            online: native?.active ?? false, connection: !native ? 'pending' : native.active ? 'online' : 'offline',
            lastActiveAt: native?.activeAt ?? null, host: native?.metadata?.host ?? null, platform: native?.metadata?.platform ?? null,
            spaceIds: this.store.spaces(actor, record.machineId), permissions: { manage: true, associate: true } };
    }
    async machines(lease: RequestLease): Promise<MachineView[]> {
        if (!this.store.machines(lease.actor).length) return [];
        const inventory = await this.inventory(lease.signal); lease.check();
        return this.store.machines(lease.actor).map(record => this.machineView(lease.actor, record, inventory.find(m => m.id === record.machineId)));
    }
    async machine(lease: RequestLease, id: string): Promise<MachineView> {
        lease.add(() => { this.store.machine(lease.actor, id); });
        const inventory = await this.inventory(lease.signal); lease.check();
        return this.machineView(lease.actor, this.store.machine(lease.actor, id), inventory.find(m => m.id === id));
    }
    async renameMachine(lease: RequestLease, id: string, input: unknown): Promise<MachineView> {
        const parsed = RenameInput.safeParse(input); if (!parsed.success) throw invalidInput();
        const before = await this.machine(lease, id);
        if (before.connection === 'pending') throw new ResourceError(409, 'machine_not_connected', '机器尚未首次连接，无法修改原生机器名称。', '先使用已保存的机器凭据启动 Runner，再修改名称。');
        lease.check();
        await this.native.write(`/api/machines/${encodeURIComponent(id)}`, { displayName: parsed.data.name }, lease.signal, 'PATCH');
        lease.check(); this.store.rename(lease.actor, id, parsed.data);
        return this.machine(lease, id);
    }
}
