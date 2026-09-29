import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { jsonResponse } from '../proxy';
import { ParentSchema } from '../tasks/types';
import { PreparationError, parsePreparation } from './types';
import type { WorkspacePreparations } from './service';

export async function handlePreparationRequest(request: IncomingMessage, response: ServerResponse, namespace: string, service: WorkspacePreparations) {
    if (request.method !== 'POST') throw new PreparationError(405, 'method_not_allowed', '工作区准备接口需要 POST。');
    const chunks: Buffer[] = []; let bytes = 0;
    for await (const chunk of request) { const buffer = Buffer.from(chunk); bytes += buffer.length; if (bytes <= 1_048_576) chunks.push(buffer); }
    if (bytes > 1_048_576) throw new PreparationError(413, 'preparation_request_too_large', '工作区请求超过 1 MiB。');
    let value: unknown;
    try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new PreparationError(400, 'invalid_preparation_request', '工作区请求必须是 JSON 对象。'); }
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    let result: object;
    if (path === '/api/runweft/workspaces/prepare') result = { preparation: await service.accept(namespace, value) };
    else if (path === '/api/runweft/workspaces/lookup') result = { preparation: service.lookup(namespace, value) };
    else if (path === '/api/runweft/workspaces/list') {
        const input = parsePreparation(z.strictObject({ parent: ParentSchema, all: z.boolean().default(false) }), value);
        result = { preparations: service.list(namespace, input.parent, input.all) };
    } else if (path === '/api/runweft/workspaces/inspect') {
        const input = parsePreparation(z.strictObject({ parent: ParentSchema, id: z.uuid() }), value);
        result = { preparation: service.inspect(namespace, input.parent, input.id) };
    } else if (path === '/api/runweft/workspaces/release') {
        const input = parsePreparation(z.strictObject({ parent: ParentSchema, id: z.uuid(), discardIgnored: z.boolean().default(false) }), value);
        result = { preparation: await service.release(namespace, input.parent, input.id, input.discardIgnored) };
    } else throw new PreparationError(404, 'not_found', '没有此工作区准备接口。');
    if (!response.destroyed) jsonResponse(response, 200, { namespace, ...result });
}
