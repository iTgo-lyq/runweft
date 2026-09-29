import type { ArtifactOutput } from '../../hapi/shared/src/artifactTransfers';
import { AgentClient } from '../agents/client';
import type { ResolvedConfig } from '../config';
import { RunweftError } from '../errors';
import { hapiClient, type HapiClient } from '../hapi';
import { hostDirectory, type HostIdentity } from '../mcp/identity';
import { ResourceClient } from '../resources/client';
import type { TaskCoordinator } from './coordinator';
import { SpawnIntentSchema, parseTask, type Acceptance, type ArtifactInput, type Parent, type SendIntent } from './types';

export class TaskClient {
    readonly parent: Parent;
    constructor(private readonly config: ResolvedConfig, cwd: string, host?: HostIdentity, private readonly hapi: HapiClient = hapiClient(config)) {
        const directory = hostDirectory(host?.cwd ?? cwd);
        const machineId = new ResourceClient(config, hapi).localMachineId()!;
        this.parent = host ? { kind: 'mcp', host: host.host, nativeSessionId: host.nativeSessionId, machineId, cwd: directory, hapiSessionId: host.hapiSessionId }
            : { kind: 'cli', machineId, cwd: directory, hapiSessionId: config.env.HAPI_SESSION_ID || undefined };
    }
    private request(path: string, value: object, signal?: AbortSignal) {
        return this.hapi.request(`/api/runweft/tasks/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ parent: this.parent, ...value }), signal });
    }
    async spawn(agentType: string, message: string, requestId: string, workspaceMode = 'shared', signal?: AbortSignal, baseRef?: string, inputs?: ArtifactInput[], outputs?: ArtifactOutput[]): Promise<Acceptance> {
        if (!['shared', 'worktree'].includes(workspaceMode)) throw new RunweftError('capability_unavailable', '当前支持 shared 和本机 worktree 模式；远端模式尚未交付。');
        const intent = parseTask(SpawnIntentSchema, { agentType, message, workspaceMode, ...(inputs?.length ? { inputs } : {}), ...(outputs?.length ? { outputs } : {}), ...(baseRef === undefined ? {} : { baseRef }) });
        const previous = await this.request('lookup', { requestId, intent }, signal);
        if (previous.accepted) return previous.accepted;
        const resolved = await new AgentClient(this.config, this.parent.cwd, this.hapi).resolve(agentType, undefined, signal);
        if (resolved.target.machineId !== this.parent.machineId) throw new RunweftError(workspaceMode === 'shared' ? 'shared_target_required' : 'remote_workspace_unavailable', '当前任务只能使用发起机的 runtime；跨机准备与结果回收尚未交付。');
        const agent = { id: resolved.id, definition: resolved.definition, source: resolved.source, definitionVersion: resolved.definitionVersion,
            resolvedVersion: resolved.resolvedVersion, runtimeId: resolved.target.runtimeId, machineId: resolved.target.machineId,
            flavor: resolved.target.flavor, namespace: resolved.connection.namespace };
        const { namespace: _, ...accepted } = await this.request('spawn', { requestId, intent, agent }, signal);
        return accepted;
    }
    async list(all = false, signal?: AbortSignal): Promise<ReturnType<TaskCoordinator['list']>> { return this.request('list', { all }, signal); }
    async send(id: string, message: string, requestId: string, options: { mode?: SendIntent['mode']; roundId?: string; inputs?: ArtifactInput[]; outputs?: ArtifactOutput[] } = {}, signal?: AbortSignal): Promise<Acceptance> {
        const { namespace: _, ...accepted } = await this.request('send', { requestId, intent: { id, message, mode: options.mode ?? 'next', roundId: options.roundId, ...(options.inputs?.length ? { inputs: options.inputs } : {}), ...(options.outputs?.length ? { outputs: options.outputs } : {}) } }, signal);
        return accepted;
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
}
