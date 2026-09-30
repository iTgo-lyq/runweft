import type { IncomingMessage, ServerResponse } from 'node:http';
import { jwtVerify } from 'jose';
import { errorDetails } from './errors';
import { fetchJson, HapiRequestError } from './hapi';
import { jsonResponse } from './proxy';
import { ResourceStore } from './resources/store';
import { ResourceService } from './resources/service';
import { ResourceError } from './resources/types';
import { handleResourceRequest } from './resources/api';
import { TaskCoordinator } from './tasks/coordinator';
import { handleTaskRequest } from './tasks/api';
import { TaskError } from './tasks/types';
import { WorkspacePreparations } from './remote/service';
import { PreparationError } from './remote/types';
import { handlePreparationRequest } from './remote/api';
import { dashboard } from './dashboard/server';
import { handleHubRequest } from './hub/api';
import type { HubStore } from './hub/store';

export function createRunweftHandler(options: { key: Uint8Array; hapiUrl: string; statePath: string; health: () => object; tasks?: TaskCoordinator; preparations?: WorkspacePreparations; hub?: HubStore }) {
    return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
        if (dashboard(request, response)) return true;
        if (await handleHubRequest(request, response, options.hub)) return true;
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
        if (path.startsWith('/api/runweft/workspaces/')) {
            try {
                if (!options.preparations) throw new PreparationError(503, 'preparation_service_unavailable', '当前服务没有启用工作区准备；请更新并重启配套 Runweft。');
                await handlePreparationRequest(request, response, identity.ns, options.preparations);
            } catch (error) {
                if (!response.destroyed) jsonResponse(response, error instanceof PreparationError || error instanceof TaskError || error instanceof ResourceError || error instanceof HapiRequestError ? error.status : 500, { error: errorDetails(error) });
            }
            return true;
        }
        if (path.startsWith('/api/runweft/tasks/')) {
            try {
                if (!options.tasks) throw new TaskError(503, 'task_service_unavailable', '当前服务没有启用委派协调器。', '更新配套 Runweft 并重新启动服务。');
                await handleTaskRequest(request, response, identity.ns, options.tasks);
            } catch (error) {
                if (!response.destroyed) jsonResponse(response, error instanceof TaskError || error instanceof ResourceError || error instanceof HapiRequestError ? error.status : 500, { error: errorDetails(error) });
            }
            return true;
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
