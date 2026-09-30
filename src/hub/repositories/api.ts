import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { jsonResponse } from '../../proxy';
import { HubError, hubNotFound } from '../types';
import { pathParts, readJson, type RequestLease } from '../access/transport';
import type { RepositoryStore } from './store';

export async function handleRepositoryRequest(request: IncomingMessage, response: ServerResponse, lease: RequestLease, store: RepositoryStore) {
    const { parts, url } = pathParts(request), method = request.method ?? 'GET';
    if (parts.slice(0, 2).join('/') !== 'api/runweft' || !['repositories', 'checkouts'].includes(parts[2])) return false;
    const invalid = () => new HubError(400, 'repository_input_invalid', '仓库请求参数无效。');
    if (url.search) throw invalid();
    const [, , kind, id, section] = parts, actor = lease.actor;
    const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ? await readJson(request, 65_536, lease.signal) : {};
    const empty = () => { if (!z.object({}).strict().safeParse(body).success) throw invalid(); };
    lease.check(); store.context(actor); let result: unknown;
    if (kind === 'repositories') {
        if (parts.length === 3 && method === 'GET') result = { repositories: store.list(actor) };
        else if (parts.length === 3 && method === 'POST') result = { repository: store.create(actor, body) };
        else if (id === 'requests' && parts.length === 5 && method === 'GET') result = { repository: store.receipt(actor, section) };
        else if (parts.length === 4 && method === 'GET') result = { repository: store.repository(actor, id) };
        else if (parts.length === 4 && method === 'PATCH') result = { repository: store.rename(actor, id, body) };
        else if (parts.length === 4 && method === 'DELETE') { empty(); result = { repository: store.register(actor, id, false) }; }
        else if (section === 'register' && parts.length === 5 && method === 'POST') { empty(); result = { repository: store.register(actor, id, true) }; }
        else if (section === 'aliases' && parts.length === 5 && ['PUT', 'DELETE'].includes(method)) result = { repository: store.alias(actor, id, body, method === 'PUT') };
        else throw hubNotFound();
    } else {
        if (parts.length !== 3) throw hubNotFound();
        if (method === 'GET') result = { checkouts: store.checkouts(actor) };
        else if (method === 'POST') result = store.match(actor, body);
        else if (method === 'PUT') result = { checkout: store.bind(actor, body) };
        else if (method === 'DELETE') result = store.unbind(actor, body);
        else throw hubNotFound();
    }
    lease.check(); jsonResponse(response, 200, result); return true;
}
