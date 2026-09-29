import type { IncomingMessage, ServerResponse } from 'node:http';
import { jwtVerify } from 'jose';
import { errorDetails } from './errors';
import { fetchJson, HapiRequestError } from './hapi';
import { jsonResponse } from './proxy';
import { ResourceStore } from './resources/store';
import { ResourceService } from './resources/service';
import { ResourceError } from './resources/types';
import { handleResourceRequest } from './resources/api';

export function createRunweftHandler(options: { key: Uint8Array; hapiUrl: string; statePath: string; health: () => object }) {
    return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
        const path = new URL(request.url ?? '/', 'http://localhost').pathname;
        if (path === '/api/runweft/health' && request.method === 'GET') {
            jsonResponse(response, 200, options.health()); return true;
        }
        if (!path.startsWith('/api/runweft/')) return false;
        let identity;
        const authorization = request.headers.authorization;
        try {
            if (!authorization?.startsWith('Bearer ')) throw new Error('no bearer');
            identity = (await jwtVerify(authorization.slice(7), options.key, { algorithms: ['HS256'] })).payload;
            if (typeof identity.uid !== 'number' || typeof identity.ns !== 'string') throw new Error('invalid claims');
        } catch {
            jsonResponse(response, 401, { error: { code: 'authentication_failed', message: '需要有效的 HAPI 登录。' } }); return true;
        }
        if (path === '/api/runweft/identity' && request.method === 'GET') {
            jsonResponse(response, 200, { userId: identity.uid, namespace: identity.ns }); return true;
        }
        if (path.startsWith('/api/runweft/resources/')) {
            const abort = new AbortController();
            const onClose = () => abort.abort();
            response.once('close', onClose);
            let store: ResourceStore | undefined;
            try {
                store = new ResourceStore(options.statePath);
                const service = new ResourceService(store, identity.ns, (resourcePath, init = {}) => fetchJson(`${options.hapiUrl}${resourcePath}`, {
                    ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), authorization: authorization! },
                    signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10_000)]),
                }));
                await handleResourceRequest(request, response, service);
            } catch (error) {
                if (!response.destroyed) jsonResponse(response, error instanceof ResourceError || error instanceof HapiRequestError ? error.status : 500, { error: errorDetails(error) });
            } finally {
                response.off('close', onClose);
                store?.close();
            }
            return true;
        }
        jsonResponse(response, 404, { error: { code: 'not_found', message: '没有此 Runweft 接口。' } }); return true;
    };
}
