import { AgentClient } from '../agents/client';
import type { ResolvedConfig } from '../config';
import { RunweftError } from '../errors';
import { hapiClient, type HapiClient } from '../hapi';
import { hostDirectory, type HostIdentity } from '../mcp/identity';
import { ResourceClient } from '../resources/client';
import type { TaskCoordinator } from './coordinator';
import { SpawnIntentSchema, parseTask, type Acceptance, type Parent } from './types';

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
    async spawn(agentType: string, message: string, requestId: string, workspaceMode = 'shared', signal?: AbortSignal): Promise<Acceptance> {
        if (workspaceMode !== 'shared') throw new RunweftError('capability_unavailable', '当前只支持本机 shared 工作区模式。');
        const intent = parseTask(SpawnIntentSchema, { agentType, message, workspaceMode });
        const previous = await this.request('lookup', { requestId, intent }, signal);
        if (previous.accepted) return previous.accepted;
        const resolved = await new AgentClient(this.config, this.parent.cwd, this.hapi).resolve(agentType);
        if (resolved.target.machineId !== this.parent.machineId) throw new RunweftError('shared_target_required', '共享目录任务只能使用发起机的 runtime。');
        const agent = { id: resolved.id, definition: resolved.definition, source: resolved.source, definitionVersion: resolved.definitionVersion,
            resolvedVersion: resolved.resolvedVersion, runtimeId: resolved.target.runtimeId, machineId: resolved.target.machineId,
            flavor: resolved.target.flavor, namespace: resolved.connection.namespace };
        const { namespace: _, ...accepted } = await this.request('spawn', { requestId, intent, agent }, signal);
        return accepted;
    }
    async list(all = false, signal?: AbortSignal): Promise<ReturnType<TaskCoordinator['list']>> { return this.request('list', { all }, signal); }
    async read(id: string, options: { roundId?: string; offset?: number; limit?: number } = {}, signal?: AbortSignal): Promise<ReturnType<TaskCoordinator['read']>> {
        return this.request('read', { id, ...options }, signal);
    }
    async wait(ids: string[], timeoutMs = 30_000, afterRevision?: Record<string, number>, signal?: AbortSignal): Promise<Awaited<ReturnType<TaskCoordinator['wait']>>> {
        const timeout = AbortSignal.timeout(timeoutMs + 15_000);
        return this.request('wait', { ids, timeoutMs, afterRevision }, signal ? AbortSignal.any([signal, timeout]) : timeout);
    }
}
