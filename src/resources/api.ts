import type { IncomingMessage, ServerResponse } from 'node:http';
import { jsonResponse } from '../proxy';
import { ResourceService } from './service';
import { ResourceError, invalidInput } from './types';

async function body(request: IncomingMessage) {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
        const buffer = Buffer.from(chunk);
        size += buffer.length;
        if (size <= 16_384) chunks.push(buffer);
    }
    if (size > 16_384) throw new ResourceError(413, 'resource_request_too_large', '资源登记请求过大。');
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw invalidInput('资源请求必须是 JSON 对象。'); }
}

export async function handleResourceRequest(request: IncomingMessage, response: ServerResponse, service: ResourceService) {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const parts = url.pathname.slice('/api/runweft/resources/'.length).split('/');
    let id: string | undefined;
    try { id = parts[1] ? decodeURIComponent(parts[1]) : undefined; }
    catch { throw invalidInput('资源 ID 编码无效。'); }
    const [kind, , action] = parts;
    const method = request.method;
    let result: unknown;
    if (parts.length <= 2 && !id && kind === 'machines' && method === 'GET') {
        result = { machines: await service.machines() };
    } else if (parts.length <= 2 && !id && kind === 'machines' && method === 'POST') {
        result = { machine: await service.registerMachine(await body(request)) };
    } else if (parts.length === 2 && id && kind === 'machines' && method === 'GET') {
        result = { machine: await service.machine(id) };
    } else if (parts.length === 2 && id && kind === 'machines' && method === 'PATCH') {
        result = { machine: await service.renameMachine(id, await body(request)) };
    } else if (parts.length === 2 && id && kind === 'machines' && method === 'DELETE') {
        result = await service.unregisterMachine(id);
    } else if (parts.length === 3 && id && kind === 'machines' && action === 'discover' && method === 'GET') {
        result = await service.discover(id);
    } else if (parts.length <= 2 && !id && kind === 'runtimes' && method === 'GET') {
        if (url.searchParams.has('all') && !['true', 'false'].includes(url.searchParams.get('all')!)) throw invalidInput('all 参数必须是 true 或 false。');
        result = { runtimes: await service.runtimes(url.searchParams.get('all') === 'true') };
    } else if (parts.length <= 2 && !id && kind === 'runtimes' && method === 'POST') {
        result = { runtime: await service.registerRuntime(await body(request)) };
    } else if (parts.length === 2 && id && kind === 'runtimes' && method === 'GET') {
        result = { runtime: await service.runtime(id) };
    } else if (parts.length === 2 && id && kind === 'runtimes' && method === 'PATCH') {
        result = { runtime: service.renameRuntime(id, await body(request)) };
    } else if (parts.length === 2 && id && kind === 'runtimes' && method === 'DELETE') {
        result = service.unregisterRuntime(id);
    } else if (parts.length === 3 && id && kind === 'runtimes' && action === 'check' && method === 'GET') {
        result = { runtime: await service.runtime(id) };
    } else if (parts.length === 3 && id && kind === 'runtimes' && action === 'resolve' && method === 'GET') {
        result = { target: await service.resolveExecutionTarget(id) };
    } else {
        throw new ResourceError(404, 'not_found', '没有此资源接口。');
    }
    jsonResponse(response, 200, { namespace: service.namespace, ...result as object });
}
