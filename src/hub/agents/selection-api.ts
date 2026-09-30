import type { IncomingMessage, ServerResponse } from 'node:http';
import { jsonResponse } from '../../proxy';
import { hubNotFound } from '../types';
import { pathParts, readJson, type RequestLease } from '../access/transport';
import { agentInvalid } from './types';
import type { HubAgentResolver } from './resolver';

export async function handleAgentSelectionRequest(request: IncomingMessage, response: ServerResponse, lease: RequestLease, resolver: HubAgentResolver) {
    const { parts, url } = pathParts(request), method = request.method ?? 'GET';
    if (parts.slice(0, 2).join('/') !== 'api/runweft' || !['agent-selections', 'agent-resolution'].includes(parts[2])) return false;
    if (url.search || parts.length !== 3) throw agentInvalid();
    const body = ['POST', 'PUT', 'DELETE'].includes(method) ? await readJson(request, 16_384, lease.signal) : {};
    lease.check(); let result: unknown;
    if (parts[2] === 'agent-resolution') {
        if (method !== 'POST') throw hubNotFound(); result = { resolution: await resolver.resolve(lease, body) };
    } else {
        if (method === 'GET') result = { selections: resolver.selections.list(lease.actor) };
        else if (method === 'PUT') result = { selection: resolver.selections.set(lease.actor, body) };
        else if (method === 'DELETE') result = resolver.selections.remove(lease.actor, body);
        else throw hubNotFound();
    }
    lease.check(); jsonResponse(response, 200, result); return true;
}
