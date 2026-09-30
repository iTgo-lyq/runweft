import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { jsonResponse } from '../../proxy';
import { hubNotFound } from '../types';
import { pathParts, readJson, type RequestLease } from '../access/transport';
import { agentInvalid } from './types';
import type { HubAgentStore } from './store';

export async function handleAgentRequest(request: IncomingMessage, response: ServerResponse, lease: RequestLease, store: HubAgentStore) {
    const { parts, url } = pathParts(request), method = request.method ?? 'GET';
    if (parts.slice(0, 3).join('/') !== 'api/runweft/agents') return false;
    if (url.search) throw agentInvalid();
    const [, , , id, section] = parts, actor = lease.actor;
    const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ? await readJson(request, 65_536, lease.signal) : {};
    const empty = () => { if (!z.object({}).strict().safeParse(body).success) throw agentInvalid(); };
    lease.check(); store.repositories.context(actor); let result: unknown;
    if (parts.length === 3 && method === 'GET') result = { agents: store.list(actor) };
    else if (parts.length === 3 && method === 'POST') result = { agent: store.create(actor, body) };
    else if (id === 'requests' && parts.length === 5 && method === 'GET') result = { agent: store.receipt(actor, section) };
    else if (parts.length === 4 && method === 'GET') result = { agent: store.agent(actor, id) };
    else if (parts.length === 4 && method === 'PATCH') result = { agent: store.update(actor, id, body) };
    else if (parts.length === 4 && method === 'DELETE') { empty(); result = { agent: store.register(actor, id, false) }; }
    else if (section === 'register' && parts.length === 5 && method === 'POST') { empty(); result = { agent: store.register(actor, id, true) }; }
    else if (section === 'access' && parts.length === 5 && method === 'PUT') result = { agent: store.access(actor, id, body) };
    else if (section === 'block' && parts.length === 5 && ['PUT', 'DELETE'].includes(method)) { empty(); result = { agent: store.block(actor, id, method === 'PUT') }; }
    else if (section === 'versions' && parts.length === 5 && method === 'GET') result = { versions: store.versions(actor, id) };
    else throw hubNotFound();
    lease.check(); jsonResponse(response, 200, result); return true;
}
