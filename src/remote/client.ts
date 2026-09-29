import type { ResolvedConfig } from '../config';
import { AgentClient } from '../agents/client';
import { hapiClient, type HapiClient } from '../hapi';
import { hostDirectory } from '../mcp/identity';
import { ResourceClient } from '../resources/client';
import type { Parent } from '../tasks/types';
import type { WorkspacePreparations } from './service';
import { PreparationIntentSchema, parsePreparation } from './types';

export type PreparationView = ReturnType<WorkspacePreparations['inspect']>;
export class PreparationClient {
    readonly parent: Parent;
    constructor(private readonly config: ResolvedConfig, cwd: string, private readonly hapi: HapiClient = hapiClient(config)) {
        this.parent = { kind: 'cli', machineId: new ResourceClient(config, hapi).localMachineId(false) ?? 'operator-without-runner',
            cwd: hostDirectory(cwd), hapiSessionId: config.env.HAPI_SESSION_ID || undefined };
    }
    private request(path: string, value: object) {
        return this.hapi.request(`/api/runweft/workspaces/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ parent: this.parent, ...value }) });
    }
    async prepare(agentName: string, baseRef: string, requestId: string): Promise<PreparationView> {
        new ResourceClient(this.config, this.hapi).localMachineId();
        const intent = parsePreparation(PreparationIntentSchema, { agent: agentName, baseRef });
        const previous = await this.request('lookup', { requestId, intent }); if (previous.preparation) return previous.preparation;
        const selected = await new AgentClient(this.config, this.parent.cwd, this.hapi).resolve(agentName);
        const agent = { id: selected.id, definitionVersion: selected.definitionVersion, runtimeId: selected.target.runtimeId,
            machineId: selected.target.machineId, flavor: selected.target.flavor, namespace: selected.connection.namespace };
        return (await this.request('prepare', { requestId, intent, agent })).preparation;
    }
    async list(all = false): Promise<PreparationView[]> { return (await this.request('list', { all })).preparations; }
    async inspect(id: string): Promise<PreparationView> { return (await this.request('inspect', { id })).preparation; }
    async release(id: string, discardIgnored = false): Promise<PreparationView> { return (await this.request('release', { id, discardIgnored })).preparation; }
}
