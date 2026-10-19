import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { ReadSchema, WaitSchema, parseTask, TaskError, type TaskBundle } from '../../tasks/types';
import { OverviewQuerySchema, taskOverview, type OverviewQuery, type TaskInventory } from '../../tasks/query';
import type { RequestLease } from '../access/transport';
import type { HubDelegationService } from './service';

const context = z.object({ hapiSessionId: z.string().min(1).max(512).optional() }).strict();
const read = ReadSchema.omit({ parent: true }).extend({ context });
const wait = WaitSchema.omit({ parent: true }).extend({ context });
const result = read.omit({ offset: true, limit: true });
const artifacts = result.extend({ roundId: z.uuid() });
const list = z.object({ context, query: OverviewQuerySchema, scope: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('all') }).strict(),
    z.object({ kind: z.literal('local'), machineId: z.string().min(1).max(512), cwd: z.string().max(4096).refine(isAbsolute) }).strict(),
]) }).strict();

export async function taskList(service: HubDelegationService, lease: RequestLease, bundles: TaskBundle[], query: OverviewQuery) {
    let inventory: TaskInventory;
    try { inventory = { machines: await service.config.resources.machines(lease, AbortSignal.any([lease.signal, AbortSignal.timeout(3000)])), error: null }; }
    catch { lease.check(); inventory = { machines: [], error: { code: 'inventory_unavailable', message: '机器状态暂不可用，以下保留已记录的任务事实。' } }; }
    return taskOverview(bundles, service.config.resources.store.runtimes(lease.actor), inventory, query);
}

/** User-space reads have no execution parent and cannot start, resume or release work. */
export async function taskQuery(action: string, value: unknown, namespace: string, service: HubDelegationService, lease: RequestLease) {
    const coordinator = service.coordinator;
    const guard = (input: { context: z.infer<typeof context> }) => coordinator.store.assertReadContext(namespace, input.context.hapiSessionId);
    switch (action) {
        case 'list': {
            const input = parseTask(list, value); guard(input);
            const bundles = coordinator.store.listNamespace(namespace).filter(({ task }) => input.scope.kind === 'all'
                || task.parent.machineId === input.scope.machineId && task.parent.cwd === input.scope.cwd);
            return { ...await taskList(service, lease, bundles, input.query), scope: input.scope };
        }
        case 'read': { const input = parseTask(read, value); guard(input); return coordinator.read(namespace, undefined, input.id, input); }
        case 'wait': { const input = parseTask(wait, value); guard(input); return coordinator.wait(namespace, undefined, input.ids, input.timeoutMs, input.afterRevision, lease.signal); }
        case 'result': { const input = parseTask(result, value); guard(input); return coordinator.resultView(namespace, input.id, input.roundId); }
        case 'artifacts': { const input = parseTask(artifacts, value); guard(input); return coordinator.artifactManifests(namespace, undefined, input.id, input.roundId); }
        default: throw new TaskError(404, 'not_found', '没有此只读任务查询接口。');
    }
}
