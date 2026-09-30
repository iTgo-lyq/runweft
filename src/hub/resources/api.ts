import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { jsonResponse } from '../../proxy';
import { invalidInput } from '../../resources/types';
import { hubNotFound } from '../types';
import { pathParts, readJson, type RequestLease } from '../access/transport';
import { HubResourceService } from './service';

const empty = z.object({}).strict();
export async function handleResourceRequest(request: IncomingMessage, response: ServerResponse, lease: RequestLease, service: HubResourceService) {
    const { parts, url } = pathParts(request), method = request.method ?? 'GET';
    if (parts.slice(0, 3).join('/') !== 'api/runweft/resources') return false;
    if (url.search) throw invalidInput();
    const [, , , kind, id, section, target] = parts, { actor } = lease, { store } = service;
    const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ? await readJson(request, 16_384, lease.signal) : {};
    const requireEmpty = () => { if (!empty.safeParse(body).success) throw invalidInput(); };
    lease.check(); let result: unknown;
    if (kind === 'machines') {
        if (parts.length === 4 && method === 'GET') result = { machines: await service.machines(lease) };
        else if (id === 'enroll' && parts.length === 5 && method === 'POST') result = store.enroll(actor, body);
        else if (id === 'enrollments' && parts.length === 6 && method === 'GET') result = store.enrollment(actor, section);
        else if (parts.length === 5 && method === 'GET') result = { machine: await service.machine(lease, id) };
        else if (parts.length === 5 && method === 'PATCH') result = { machine: await service.renameMachine(lease, id, body) };
        else if (parts.length === 5 && method === 'DELETE') { requireEmpty(); result = { machine: store.register(actor, id, false), existingExecutions: 'unchanged' }; }
        else if (section === 'register' && parts.length === 6 && method === 'POST') { requireEmpty(); result = { machine: store.register(actor, id, true) }; }
        else if (section === 'credential' && parts.length === 6) {
            if (method === 'GET') result = { credential: store.credential(actor, id) };
            else if (method === 'PUT') result = { credential: store.replaceCredential(actor, id, body) };
            else if (method === 'DELETE') { requireEmpty(); result = { credential: store.revokeCredential(actor, id) }; }
            else throw hubNotFound();
        } else if (section === 'spaces' && parts.length === 7 && ['PUT', 'DELETE'].includes(method)) {
            requireEmpty(); result = store.associate(actor, id, target, method === 'PUT');
        } else throw hubNotFound();
    } else throw hubNotFound();
    lease.check(); jsonResponse(response, 200, result); return true;
}
