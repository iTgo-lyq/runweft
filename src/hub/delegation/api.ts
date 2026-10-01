import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { jsonResponse } from '../../proxy';
import { ListSchema, ReadSchema, WaitSchema } from '../../tasks/api';
import { ParentSchema, InterruptSchema, parseTask, TaskError } from '../../tasks/types';
import { OverviewQuerySchema, taskOverview } from '../../tasks/query';
import { detail } from '../../tasks/views';
import { readJson, type RequestLease } from '../access/transport';
import { HubDelegationService } from './service';
import type { TaskInventory } from '../../tasks/query';

const Inspect = z.object({ parent: ParentSchema, id: z.uuid() }).strict();
const Release = Inspect.extend({ discardIgnored: z.boolean().default(false) });
export async function handleDelegationRequest(request: IncomingMessage, response: ServerResponse, lease: RequestLease, service: HubDelegationService) {
    const url = new URL(request.url ?? '/', 'http://hub.invalid');
    const match = /^\/api\/runweft\/(tasks|workspaces)\/(.+)$/.exec(url.pathname);
    if (!match) return false;
    const [, domain, action] = match, namespace = service.scope(lease), coordinator = service.coordinator;
    let result: unknown;
    if (domain === 'tasks' && action === 'overview') {
        if (request.method !== 'GET') throw new TaskError(405, 'method_not_allowed', '总览接口只接受 GET。');
        if (new Set(url.searchParams.keys()).size !== [...url.searchParams].length) throw new TaskError(400, 'invalid_task_request', '总览筛选参数不能重复。');
        const query = parseTask(OverviewQuerySchema, Object.fromEntries(url.searchParams));
        // History remains readable when an Agent is no longer shared. Inventory never widens task scope.
        let inventory: TaskInventory;
        try { inventory = { machines: await service.config.resources.machines(lease, AbortSignal.any([lease.signal, AbortSignal.timeout(3000)])), error: null }; }
        catch { lease.check(); inventory = { machines: [], error: { code: 'inventory_unavailable', message: '机器状态暂不可用，以下保留已记录的任务事实。' } }; }
        result = taskOverview(coordinator.store.listNamespace(namespace), service.config.resources.store.runtimes(lease.actor), inventory, query);
    } else if (domain === 'tasks' && action.startsWith('details/')) {
        if (request.method !== 'GET') throw new TaskError(405, 'method_not_allowed', '任务详情只接受 GET。');
        if (new Set(url.searchParams.keys()).size !== [...url.searchParams].length) throw new TaskError(400, 'invalid_task_request', '详情参数不能重复。');
        const id = parseTask(z.uuid(), action.slice('details/'.length));
        const options = parseTask(z.object({ roundId: z.uuid().optional(),
            offset: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(0)).optional(),
            limit: z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(64_000)).optional(),
        }).strict(), Object.fromEntries(url.searchParams));
        const bundle = coordinator.store.require(namespace, id);
        const view = detail(bundle, options);
        if (!view) throw new TaskError(404, 'round_unknown', '此任务中没有指定轮次。');
        result = { ...view, ownerId: bundle.task.hub!.ownerId, spaceId: bundle.task.hub!.spaceId,
            hubRepositoryId: bundle.task.hub!.hubRepositoryId, actions: { read: true, native: !!view.session_id, manageViaAgent: true } };
    } else {
        if (request.method !== 'POST') throw new TaskError(405, 'method_not_allowed', '此接口需要 POST。');
        const value = await readJson(request, 1_048_576, lease.signal); lease.check();
        const parent = parseTask(ParentSchema, value.parent);
        coordinator.store.assertCanDelegate(namespace, parent);
        if (domain === 'workspaces') {
            if (action === 'prepare' || action === 'lookup') result = { preparation: await service.prepare(lease, value, action === 'lookup') };
            else if (action === 'list') { const input = parseTask(ListSchema, value); result = { preparations: service.preparations.list(namespace, parent, input.all) }; }
            else if (action === 'inspect') { const input = parseTask(Inspect, value); result = { preparation: service.preparations.inspect(namespace, parent, input.id) }; }
            else if (action === 'release') { const input = parseTask(Release, value); result = { preparation: await service.preparations.release(namespace, parent, input.id, input.discardIgnored) }; }
            else throw new TaskError(404, 'not_found', '没有此工作区准备接口。');
        } else if (action === 'context') { parseTask(z.object({ parent: ParentSchema }).strict(), value); result = { canDelegate: true }; }
        else if (action === 'spawn') result = await service.spawn(lease, value);
        else if (action === 'lookup') result = { accepted: service.lookup(lease, value) };
        else if (action === 'send') result = await service.send(lease, value);
        else if (action === 'list') { const input = parseTask(ListSchema, value); result = coordinator.list(namespace, parent, input.all); }
        else if (action === 'read') { const input = parseTask(ReadSchema, value); result = coordinator.read(namespace, parent, input.id, input); }
        else if (action === 'wait') {
            const input = parseTask(WaitSchema, value);
            result = await coordinator.wait(namespace, parent, input.ids, input.timeoutMs, input.afterRevision, lease.signal);
        } else if (action === 'artifacts/show') {
            const input = parseTask(InterruptSchema, value); result = coordinator.artifactManifests(namespace, parent, input.id, input.roundId);
        } else {
            const id = parseTask(z.uuid(), value.id), bundle = coordinator.store.require(namespace, id, parent);
            if (!['interrupt', 'result/show'].includes(action)) {
                const round = bundle.rounds.find(r => r.id === value.roundId) ?? bundle.rounds.at(-1)!;
                lease.add(() => service.check(bundle.task, round));
                if (action === 'result/fetch') service.parent(lease, parent);
            }
            switch (action) {
                case 'interrupt': result = await coordinator.interrupt(namespace, value); break;
                case 'retry-finish': result = await coordinator.retryFinish(namespace, value); break;
                case 'result/show': result = coordinator.result(namespace, value); break;
                case 'result/fetch': result = await coordinator.resultAction(namespace, 'fetch', value); break;
                case 'result/retry': result = await coordinator.resultAction(namespace, 'retry', value); break;
                case 'result/release': result = await coordinator.releaseResults(namespace, value); break;
                case 'artifacts/action': result = await coordinator.artifactAction(namespace, value); break;
                case 'artifacts/release': result = await coordinator.releaseArtifacts(namespace, value); break;
                case 'workspace/remove': result = await coordinator.removeWorkspace(namespace, value); break;
                case 'permission': result = await coordinator.permission(namespace, value); break;
                default: throw new TaskError(404, 'not_found', '没有此任务接口。');
            }
        }
    }
    lease.check(); if (!response.destroyed) jsonResponse(response, 200, { namespace, ...result as object });
    return true;
}
