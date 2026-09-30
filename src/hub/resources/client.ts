import { HubClient, type HubConnectionOptions } from '../client';
import type { Discovery, Flavor } from '../../resources/types';
import type { CredentialInfo, Enrollment, MachineRecord, MachineView, PublicExecutionTarget, RuntimeRecord, RuntimeView } from './types';
export type { HubConnectionOptions } from '../client';
const part = (id: string) => encodeURIComponent(id);
export class HubResourceClient extends HubClient {
    constructor(options: HubConnectionOptions) { super(options, 'hubResources', 'hub_resources_unavailable'); }
    private resourceRequest<T>(path: string, method = 'GET', body?: object): Promise<T> {
        return this.request('/api/runweft/resources' + path, method, body);
    }
    enroll(value: { requestId: string; token: string; name?: string }) { return this.resourceRequest<Enrollment>('/machines/enroll', 'POST', value); }
    enrollment(requestId: string) { return this.resourceRequest<Enrollment>(`/machines/enrollments/${part(requestId)}`); }
    machines() { return this.resourceRequest<{ machines: MachineView[] }>('/machines'); }
    machine(id: string) { return this.resourceRequest<{ machine: MachineView }>(`/machines/${part(id)}`); }
    renameMachine(id: string, name: string) { return this.resourceRequest<{ machine: MachineView }>(`/machines/${part(id)}`, 'PATCH', { name }); }
    registerMachine(id: string, registered: boolean) { return this.resourceRequest<{ machine: MachineRecord }>(`/machines/${part(id)}${registered ? '/register' : ''}`, registered ? 'POST' : 'DELETE', {}); }
    credential(id: string) { return this.resourceRequest<{ credential: CredentialInfo }>(`/machines/${part(id)}/credential`); }
    replaceCredential(id: string, expectedCredentialId: string, token: string) { return this.resourceRequest<{ credential: CredentialInfo }>(`/machines/${part(id)}/credential`, 'PUT', { expectedCredentialId, token }); }
    revokeCredential(id: string) { return this.resourceRequest<{ credential: CredentialInfo }>(`/machines/${part(id)}/credential`, 'DELETE', {}); }
    associate(id: string, spaceId: string, attached: boolean) { return this.resourceRequest<{ machineId: string; spaceId: string; attached: boolean }>(`/machines/${part(id)}/spaces/${part(spaceId)}`, attached ? 'PUT' : 'DELETE', {}); }
    discover(id: string) { return this.resourceRequest<Omit<Discovery, 'machine'> & { machine: MachineView }>(`/machines/${part(id)}/discover`); }
    runtimes() { return this.resourceRequest<{ runtimes: RuntimeView[] }>('/runtimes'); }
    runtime(id: string, check = false) { return this.resourceRequest<{ runtime: RuntimeView }>(`/runtimes/${part(id)}${check ? '/check' : ''}`); }
    registerRuntime(machineId: string, flavor: Flavor, name?: string) { return this.resourceRequest<{ runtime: RuntimeView }>('/runtimes', 'POST', { machineId, flavor, name }); }
    renameRuntime(id: string, name: string) { return this.resourceRequest<{ runtime: RuntimeRecord }>(`/runtimes/${part(id)}`, 'PATCH', { name }); }
    unregisterRuntime(id: string) { return this.resourceRequest<{ runtime: RuntimeRecord }>(`/runtimes/${part(id)}`, 'DELETE', {}); }
    share(id: string, spaceId: string, shared: boolean) { return this.resourceRequest<{ runtimeId: string; spaceId: string; shared: boolean }>(`/runtimes/${part(id)}/spaces/${part(spaceId)}`, shared ? 'PUT' : 'DELETE', {}); }
    resolve(id: string) { return this.resourceRequest<{ target: PublicExecutionTarget }>(`/runtimes/${part(id)}/resolve`); }
    block(kind: 'machine' | 'runtime', id: string, spaceId: string, blocked: boolean) {
        return this.resourceRequest<{ spaceId: string; kind: string; id: string; blocked: boolean }>(`/spaces/${part(spaceId)}/blocks/${kind}/${part(id)}`, blocked ? 'PUT' : 'DELETE', {});
    }
}
