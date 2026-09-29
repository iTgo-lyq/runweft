import { createServer, ServerResponse, type IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import httpProxy from 'http-proxy';
import { errorDetails } from './errors';

export function jsonResponse(response: ServerResponse, status: number, body: unknown) {
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    response.end(JSON.stringify(body));
}

export async function createGateway(options: {
    host: string; port: number; target: string;
    handle: (request: IncomingMessage, response: ServerResponse) => Promise<boolean>;
}) {
    const proxy = httpProxy.createProxyServer({ target: options.target, ws: true });
    // Bun's node:http adapter can stall an upgrade on a previously used HTTP
    // socket. Keep HTTP responses separate from WebSocket connections; SSE
    // remains streamed until its response ends.
    proxy.on('proxyRes', response => { response.headers.connection = 'close'; });
    const sockets = new Set<Socket>();
    proxy.on('error', (_error, _request, response) => {
        if (response instanceof ServerResponse && !response.headersSent) {
            jsonResponse(response, 502, { error: { code: 'hapi_unavailable', message: 'HAPI 服务不可用，请运行 runweft doctor。' } });
        } else response.destroy();
    });
    const server = createServer((request, response) => {
        response.setHeader('connection', 'close');
        void options.handle(request, response).then(handled => {
            if (!handled) proxy.web(request, response);
        }).catch(error => {
            if (!response.headersSent) jsonResponse(response, 500, { error: errorDetails(error) });
            else response.destroy();
        });
    });
    // Uploads may take minutes on a remote link. The file endpoints enforce
    // idle timeouts; Node's total request timer must not cut a progressing stream.
    server.requestTimeout = 0;
    server.on('upgrade', (request, socket, head) => proxy.ws(request, socket, head));
    server.on('connection', socket => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
    });
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(options.port, options.host, resolve);
    });
    return {
        server,
        async close() {
            proxy.close();
            for (const socket of sockets) socket.destroy();
            await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        },
    };
}
