import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { jsonResponse } from '../proxy';
import { TaskCoordinator } from './coordinator';
import { ParentSchema, TaskError, parseTask } from './types';

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
const ListSchema = z.strictObject({ parent: ParentSchema, all: z.boolean().default(false) });
const ReadSchema = z.strictObject({ parent: ParentSchema, id: z.uuid(), roundId: z.uuid().optional(),
    offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(64_000).optional() });
const WaitSchema = z.strictObject({ parent: ParentSchema, ids: z.array(z.uuid()).min(1).max(8), timeoutMs: z.number().int().min(0).max(540_000).default(30_000),
    afterRevision: z.record(z.uuid(), z.number().int().min(0)).optional() });

export async function handleTaskRequest(request: IncomingMessage, response: ServerResponse, namespace: string, coordinator: TaskCoordinator) {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (request.method !== 'POST') throw new TaskError(405, 'method_not_allowed', '此任务接口需要 POST。');
    const value = await body(request);
    let result: unknown;
    if (path === '/api/runweft/tasks/spawn') {
        if (value?.intent?.workspaceMode && !['shared', 'worktree'].includes(value.intent.workspaceMode)) throw new TaskError(409, 'capability_unavailable', '当前支持 shared 和本机 worktree 模式；远端模式尚未交付。');
        result = await coordinator.accept(namespace, value);
    } else if (path === '/api/runweft/tasks/lookup') result = { accepted: coordinator.lookup(namespace, value) };
    else if (path === '/api/runweft/tasks/send') result = await coordinator.send(namespace, value);
    else if (path === '/api/runweft/tasks/interrupt') result = await coordinator.interrupt(namespace, value);
    else if (path === '/api/runweft/tasks/retry-finish') result = await coordinator.retryFinish(namespace, value);
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
