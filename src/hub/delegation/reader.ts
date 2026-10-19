import { dirname } from 'node:path';
import { MessagesQuerySchema } from '../../../hapi/shared/src/apiTypes';
import { configPath } from '../../config';
import { RunweftError } from '../../errors';
import { hostDirectory } from '../../mcp/identity';
import { parseTask } from '../../tasks/types';
import type { TaskCoordinator } from '../../tasks/coordinator';
import type { TaskOverview } from '../../tasks/query';
import { HubClient, type HubConnectionOptions } from '../client';
import { readMachineConnection } from '../resources/connection';

export type TaskListOptions = { all?: boolean; workspace?: string; parent?: string; status?: string; page?: string; limit?: string };
/** Human/Agent CLI diagnostics use saved user-space authority without inventing an execution parent. */
export class HubTaskReader {
    readonly connection: HubClient;
    constructor(readonly options: HubConnectionOptions, readonly cwd: string) {
        this.connection = new HubClient(options, 'hubDelegation', 'hub_delegation_unavailable');
    }
    private request(action: string, value: object, signal?: AbortSignal): Promise<any> {
        const hapiSessionId = (this.options.env ?? process.env).HAPI_SESSION_ID || undefined;
        return this.connection.http.request(`/api/runweft/tasks/query/${action}`, { method: 'POST',
            headers: { 'content-type': 'application/json' }, body: JSON.stringify({ context: { hapiSessionId }, ...value }), signal });
    }
    async list(options: TaskListOptions = {}, signal?: AbortSignal): Promise<TaskOverview & { scope: { kind: 'all' } | { kind: 'local'; machineId: string; cwd: string } }> {
        const { all, ...query } = options;
        const machine = all ? undefined : readMachineConnection(dirname(configPath(this.options.home, this.options.env)), this.connection.url);
        if (!all && !machine?.machineId) throw new RunweftError('task_local_scope_unavailable', '未登记机器，无法限定当前机器与目录。', '使用 task list --all 查询当前身份和空间的任务；查询无需登记机器。');
        return this.request('list', { query, scope: all ? { kind: 'all' } : { kind: 'local', machineId: machine!.machineId, cwd: hostDirectory(this.cwd) } }, signal);
    }
    async read(id: string, options: { roundId?: string; offset?: number; limit?: number } = {}, signal?: AbortSignal): Promise<ReturnType<TaskCoordinator['read']>> {
        return this.request('read', { id, ...options }, signal);
    }
    async result(id: string, roundId?: string, signal?: AbortSignal): Promise<ReturnType<TaskCoordinator['result']>> {
        return this.request('result', { id, roundId }, signal);
    }
    async artifacts(id: string, roundId: string, signal?: AbortSignal): Promise<ReturnType<TaskCoordinator['artifactManifests']>> {
        return this.request('artifacts', { id, roundId }, signal);
    }
    async wait(ids: string[], timeoutMs = 30_000, afterRevision?: Record<string, number>, signal?: AbortSignal): Promise<Awaited<ReturnType<TaskCoordinator['wait']>>> {
        const timeout = AbortSignal.timeout(timeoutMs + 15_000);
        return this.request('wait', { ids, timeoutMs, afterRevision }, signal ? AbortSignal.any([signal, timeout]) : timeout);
    }
    async messages(id: string, options: { roundId?: string; limit?: number; beforeAt?: number; beforeSeq?: number } = {}, signal?: AbortSignal) {
        const { roundId, ...input } = options, query = parseTask(MessagesQuerySchema, { limit: 50, ...input });
        const task = await this.read(id, { roundId, limit: 1 }, signal);
        if (!task.session_id) throw new RunweftError('task_session_unavailable', '指定轮次尚无原生会话记录。', '使用 task show 查看已记录事实；不会为查询启动或恢复执行。');
        const params = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
        const value = await this.connection.http.request(`/api/sessions/${encodeURIComponent(task.session_id)}/messages?${params}`, { signal });
        return { agent_id: id, round_id: task.round_id, session_id: task.session_id,
            history_scope: 'native_session', hint: '原生会话可能被多个业务轮次复用，消息历史不等同于单轮报告。', ...value };
    }
}
