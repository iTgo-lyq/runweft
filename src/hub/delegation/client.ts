import { dirname } from 'node:path';
import type { ArtifactOutput } from '../../../hapi/shared/src/artifactTransfers';
import { configPath, type ResolvedConfig } from '../../config';
import { RunweftError, errorDetails } from '../../errors';
import { hostDirectory, type HostIdentity } from '../../mcp/identity';
import type { HapiHttp } from '../../hapi';
import type { TaskCoordinator } from '../../tasks/coordinator';
import { parseTask, type Acceptance, type ArtifactInput, type Parent, type SendIntent } from '../../tasks/types';
import type { PreparationView } from '../../remote/types';
import { HubClient, type HubConnectionOptions } from '../client';
import { HubAgentClient } from '../agents/client';
import { HubRepositoryClient } from '../repositories/client';
import { observeRepository } from '../repositories/observation';
import { readMachineConnection } from '../resources/connection';
import { HubPreparation, HubSpawn } from './types';

export function hubOptions(config: ResolvedConfig): HubConnectionOptions {
    const url = config.config.hub.url;
    if (!url) throw new RunweftError('hub_connection_required', '委派前需要显式连接 Hub。', '设置 hub.url，并使用 hub connect begin/complete 连接身份与空间；本机 Hub 也需要明确地址。');
    return { url, home: config.home, env: config.env };
}
export function hubParent(options: HubConnectionOptions, cwd: string, host?: HostIdentity): Parent {
    const directory = hostDirectory(host?.cwd ?? cwd), home = dirname(configPath(options.home, options.env));
    const machine = readMachineConnection(home, options.url);
    if (!machine?.machineId) throw new RunweftError('machine_enrollment_required', '此 Hub 尚未登记本机。', '先执行 hub machine enroll，再启动 Runner；登记机器不会自动创建 runtime 或 Agent。');
    return host ? { kind: 'mcp', host: host.host, nativeSessionId: host.nativeSessionId, machineId: machine.machineId, cwd: directory, hapiSessionId: host.hapiSessionId }
        : { kind: 'cli', machineId: machine.machineId, cwd: directory, hapiSessionId: (options.env ?? process.env).HAPI_SESSION_ID || undefined };
}

export class HubTaskClient {
    readonly parent: Parent;
    private readonly hapi: HapiHttp;
    readonly connection: HubClient;
    constructor(readonly options: HubConnectionOptions, cwd: string, host?: HostIdentity) {
        const connection = new HubClient(options, 'hubDelegation', 'hub_delegation_unavailable');
        this.parent = hubParent(options, cwd, host); this.hapi = connection.http; this.connection = connection;
    }
    private request(path: string, value: object, signal?: AbortSignal) {
        return this.hapi.request(`/api/runweft/tasks/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ parent: this.parent, ...value }), signal });
    }
    async list(all = false, signal?: AbortSignal): Promise<ReturnType<TaskCoordinator['list']>> { return this.request('list', { all }, signal); }
    async send(id: string, message: string, requestId: string, options: { mode?: SendIntent['mode']; roundId?: string; inputs?: ArtifactInput[]; outputs?: ArtifactOutput[] } = {}, signal?: AbortSignal): Promise<Acceptance> {
        const { namespace: _, ...accepted } = await this.request('send', { requestId, intent: { id, message, mode: options.mode ?? 'next', roundId: options.roundId, ...(options.inputs?.length ? { inputs: options.inputs } : {}), ...(options.outputs?.length ? { outputs: options.outputs } : {}) } }, signal);
        return accepted;
    }
    async result(id: string, roundId?: string, signal?: AbortSignal): Promise<ReturnType<TaskCoordinator['result']>> {
        return this.request('result/show', { id, roundId }, signal);
    }
    async resultAction(id: string, roundId: string | undefined, requestId: string, action: 'fetch' | 'retry', signal?: AbortSignal): Promise<Awaited<ReturnType<TaskCoordinator['resultAction']>>> {
        return this.request(`result/${action}`, { id, roundId, requestId }, signal);
    }
    async releaseResults(id: string, options: { roundId?: string; apply?: boolean; discardPending?: boolean } = {}, signal?: AbortSignal): Promise<Awaited<ReturnType<TaskCoordinator['releaseResults']>>> {
        return this.request('result/release', { id, ...options }, signal);
    }
    async artifactAction(id: string, roundId: string, requestId: string, action: 'retry' | 'collect', files?: ArtifactOutput[], signal?: AbortSignal): Promise<Awaited<ReturnType<TaskCoordinator['artifactAction']>>> {
        return this.request('artifacts/action', { id, roundId, requestId, action, ...(action === 'collect' ? { files } : {}) }, signal);
    }
    async artifacts(id: string, roundId: string, signal?: AbortSignal): Promise<ReturnType<TaskCoordinator['artifactManifests']>> {
        return this.request('artifacts/show', { id, roundId }, signal);
    }
    async releaseArtifacts(id: string, options: { roundId?: string; apply?: boolean; discardPending?: boolean } = {}, signal?: AbortSignal): Promise<Awaited<ReturnType<TaskCoordinator['releaseArtifacts']>>> {
        return this.request('artifacts/release', { id, ...options }, signal);
    }
    async interrupt(id: string, roundId: string, signal?: AbortSignal): Promise<Awaited<ReturnType<TaskCoordinator['interrupt']>>> {
        return this.request('interrupt', { id, roundId }, signal);
    }
    async retryFinish(id: string, roundId: string, signal?: AbortSignal): Promise<Awaited<ReturnType<TaskCoordinator['retryFinish']>>> {
        return this.request('retry-finish', { id, roundId }, signal);
    }
    async removeWorkspace(id: string, discardIgnored = false, signal?: AbortSignal): Promise<Awaited<ReturnType<TaskCoordinator['removeWorkspace']>>> {
        return this.request('workspace/remove', { id, discardIgnored }, signal);
    }
    async permission(id: string, roundId: string, requestId: string, decision: 'approved' | 'denied' | 'abort', answers?: Record<string, string[]> | Record<string, { answers: string[] }>, signal?: AbortSignal) {
        return this.request('permission', { id, roundId, requestId, decision, answers }, signal);
    }
    async read(id: string, options: { roundId?: string; offset?: number; limit?: number } = {}, signal?: AbortSignal): Promise<ReturnType<TaskCoordinator['read']>> {
        return this.request('read', { id, ...options }, signal);
    }
    async wait(ids: string[], timeoutMs = 30_000, afterRevision?: Record<string, number>, signal?: AbortSignal): Promise<Awaited<ReturnType<TaskCoordinator['wait']>>> {
        const timeout = AbortSignal.timeout(timeoutMs + 15_000);
        return this.request('wait', { ids, timeoutMs, afterRevision }, signal ? AbortSignal.any([signal, timeout]) : timeout);
    }
    async context(signal?: AbortSignal): Promise<{ canDelegate: true }> { return this.request('context', {}, signal); }
    async spawn(agentType: string | undefined, message: string, requestId: string, workspaceMode = 'shared', signal?: AbortSignal,
        baseRef?: string, inputs?: ArtifactInput[], outputs?: ArtifactOutput[], selection: { runtimeId?: string; remote?: string } = {}): Promise<Acceptance> {
        signal?.throwIfAborted();
        const input = parseTask(HubSpawn, { parent: this.parent, requestId,
            intent: { agentId: !agentType || agentType === 'default' ? undefined : agentType, ...selection,
                observation: observeRepository(this.parent.cwd), message, workspaceMode, baseRef, inputs: inputs?.length ? inputs : undefined, outputs: outputs?.length ? outputs : undefined } });
        const previous = await this.request('lookup', { requestId, intent: input.intent }, signal);
        if (previous.accepted) return previous.accepted;
        const { namespace: _, ...accepted } = await this.request('spawn', { requestId, intent: input.intent }, signal); return accepted;
    }
    async definitions(signal?: AbortSignal) {
        const observation = observeRepository(this.parent.cwd);
        const repository = await new HubRepositoryClient(this.options).match(this.parent.machineId, observation, undefined, signal);
        if (repository.status !== 'matched' && repository.status !== 'non_git') throw new RunweftError(`repository_${repository.status}`, '当前工作区尚未明确关联 Hub 仓库。', repository.hint);
        const hubRepositoryId = repository.status === 'matched' ? repository.repository.id : null;
        const client = new HubAgentClient(this.options), catalog = await client.list(signal);
        const agents = await Promise.all(catalog.agents.filter(agent => agent.view === 'definition' && (agent.repositoryId === null || agent.repositoryId === hubRepositoryId)).map(async agent => {
            try { const { resolution } = await client.resolve({ agentId: agent.id, hubRepositoryId }, signal); return { ...agent, target: resolution.target, selection: resolution.selection, error: null }; }
            catch (error) { signal?.throwIfAborted(); return { ...agent, target: null, selection: null, error: errorDetails(error) }; }
        }));
        return { connection: await this.connection.connection(signal), repository, agents, modelAuthentication: 'not_checked', execution: 'not_checked' };
    }
}

export class HubPreparationClient {
    readonly parent: Parent;
    private readonly connection: HubClient;
    constructor(options: HubConnectionOptions, cwd: string) {
        this.connection = new HubClient(options, 'hubWorkspacePreparations', 'hub_preparations_unavailable');
        this.parent = hubParent(options, cwd);
    }
    private request(action: string, value: object) {
        return this.connection.http.request(`/api/runweft/workspaces/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ parent: this.parent, ...value }) });
    }
    async prepare(agent: string | undefined, baseRef: string, requestId: string, selection: { runtimeId?: string; remote?: string } = {}): Promise<PreparationView> {
        const input = parseTask(HubPreparation, { parent: this.parent, requestId, intent: { agentId: !agent || agent === 'default' ? undefined : agent,
            ...selection, observation: observeRepository(this.parent.cwd), baseRef } });
        const prior = await this.request('lookup', { requestId, intent: input.intent }); if (prior.preparation) return prior.preparation;
        return (await this.request('prepare', { requestId, intent: input.intent })).preparation;
    }
    async list(all = false): Promise<PreparationView[]> { return (await this.request('list', { all })).preparations; }
    async inspect(id: string): Promise<PreparationView> { return (await this.request('inspect', { id })).preparation; }
    async release(id: string, discardIgnored = false): Promise<PreparationView> { return (await this.request('release', { id, discardIgnored })).preparation; }
}
