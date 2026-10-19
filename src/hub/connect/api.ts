import type { IncomingMessage, ServerResponse } from 'node:http';
import { jsonResponse } from '../../proxy';
import { pathParts, readJson, inputError } from '../access/transport';
import { hubNotFound } from '../types';
import { limitPassword } from '../api';
import { ConnectionRequestStore } from './store';

export async function handleConnectionRequest(request: IncomingMessage, response: ServerResponse, store: ConnectionRequestStore) {
    const { url, parts } = pathParts(request);
    if (parts.slice(0, 3).join('/') !== 'api/runweft/connect') return false;
    if (url.search) throw inputError();
    const method = request.method, id = parts[3], action = parts[4];
    const secret = request.headers.authorization?.startsWith('Bearer ') ? request.headers.authorization.slice(7) : '';
    let result: unknown;
    if (parts.length === 3 && method === 'POST') result = store.begin(await readJson(request, 4096));
    else if (parts.length === 4 && method === 'GET') result = store.show(id);
    else if (parts.length === 5 && method === 'POST' && action === 'confirm') result = store.confirm(id, secret, await readJson(request, 2048),request.headers.origin);
    else if (parts.length === 5 && method === 'POST' && action === 'password') { const body=await readJson(request,2048);limitPassword(request,body);result = await store.password(id,secret,body); }
    else if (parts.length === 5 && method === 'POST' && ['poll', 'cancel'].includes(action)) {
        result = store.poll(id, secret, action as 'poll' | 'cancel');
    } else throw hubNotFound();
    jsonResponse(response, 200, result); return true;
}
