import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { jsonResponse } from '../proxy';
import { TaskCoordinator } from './coordinator';
import { ParentSchema, InterruptSchema, TaskError, parseTask } from './types';
import { OverviewQuerySchema } from './query';

async function body(request: IncomingMessage) {
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of request) {
        const buffer = Buffer.from(chunk); size += buffer.length;
        if (size <= 1_048_576) chunks.push(buffer);
    }
    if (size > 1_048_576) throw new TaskError(413, 'task_request_too_large', '任务请求超过 1 MiB。', '缩小任务描述；源码通过工作目录提供。');
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new TaskError(400, 'invalid_task_request', '任务请求必须是 JSON 对象。'); }
}
export const ListSchema = z.strictObject({ parent: ParentSchema, all: z.boolean().default(false) });
export const ReadSchema = z.strictObject({ parent: ParentSchema, id: z.uuid(), roundId: z.uuid().optional(),
    offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(64_000).optional() });
export const WaitSchema = z.strictObject({ parent: ParentSchema, ids: z.array(z.uuid()).min(1).max(8), timeoutMs: z.number().int().min(0).max(540_000).default(30_000),
    afterRevision: z.record(z.uuid(), z.number().int().min(0)).optional() });

export async function handleTaskRequest(request: IncomingMessage, response: ServerResponse, namespace: string, coordinator: TaskCoordinator) {
    const url = new URL(request.url ?? '/', 'http://localhost'), path = url.pathname;
    if (path === '/api/runweft/tasks/overview') {
        if (request.method !== 'GET') throw new TaskError(405, 'method_not_allowed', '总览接口只接受 GET。');
        if (new Set(url.searchParams.keys()).size !== [...url.searchParams].length) throw new TaskError(400, 'invalid_task_request', '总览筛选参数不能重复。');
        const query = parseTask(OverviewQuerySchema, Object.fromEntries(url.searchParams));
        const result = await coordinator.overview(namespace, query);
        if (!response.destroyed) jsonResponse(response, 200, { namespace, ...result });
        return;
    }
    if (request.method !== 'POST') throw new TaskError(405, 'method_not_allowed', '此任务接口需要 POST。');
    const value = await body(request);
    let result: unknown;
    if (path === '/api/runweft/tasks/spawn') {
        if (value?.intent?.workspaceMode && !['shared', 'worktree'].includes(value.intent.workspaceMode)) throw new TaskError(409, 'capability_unavailable', '支持本机 shared 和本机/远端 worktree 模式。');
        result = await coordinator.accept(namespace, value);
    } else if (path === '/api/runweft/tasks/lookup') result = { accepted: coordinator.lookup(namespace, value) };
    else if (path === '/api/runweft/tasks/send') result = await coordinator.send(namespace, value);
    else if (path === '/api/runweft/tasks/interrupt') result = await coordinator.interrupt(namespace, value);
    else if (path === '/api/runweft/tasks/retry-finish') result = await coordinator.retryFinish(namespace, value);
    else if (path === '/api/runweft/tasks/result/show') result = coordinator.result(namespace, value);
    else if (path === '/api/runweft/tasks/result/fetch') result = await coordinator.resultAction(namespace, 'fetch', value);
    else if (path === '/api/runweft/tasks/result/retry') result = await coordinator.resultAction(namespace, 'retry', value);
    else if (path === '/api/runweft/tasks/result/release') result = await coordinator.releaseResults(namespace, value);
    else if (path === '/api/runweft/tasks/artifacts/action') result = await coordinator.artifactAction(namespace, value);
    else if (path === '/api/runweft/tasks/artifacts/release') result = await coordinator.releaseArtifacts(namespace, value);
    else if (path === '/api/runweft/tasks/artifacts/show') {
        const input = parseTask(InterruptSchema, value); result = coordinator.artifactManifests(namespace, input.parent, input.id, input.roundId);
    }
    else if (path === '/api/runweft/tasks/workspace/remove') result = await coordinator.removeWorkspace(namespace, value);
    else if (path === '/api/runweft/tasks/permission') result = await coordinator.permission(namespace, value);
    else if (path === '/api/runweft/tasks/list') {
        const input = parseTask(ListSchema, value); result = coordinator.list(namespace, input.parent, input.all);
    } else if (path === '/api/runweft/tasks/read') {
        const input = parseTask(ReadSchema, value); result = coordinator.read(namespace, input.parent, input.id, input);
    } else if (path === '/api/runweft/tasks/wait') {
        const input = parseTask(WaitSchema, value);
        const abort = new AbortController(); const onClose = () => abort.abort();
        response.once('close', onClose);
        try { result = await coordinator.wait(namespace, input.parent, input.ids, input.timeoutMs, input.afterRevision, abort.signal); }
        finally { response.off('close', onClose); }
    } else throw new TaskError(404, 'not_found', '没有此任务接口。');
    if (!response.destroyed) jsonResponse(response, 200, { namespace, ...result as object });
}
