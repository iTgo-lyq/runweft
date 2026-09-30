import type { IncomingMessage, ServerResponse } from 'node:http';
import html from './page.html' with { type: 'text' };
import css from './style.css' with { type: 'text' };
import browser from './app' with { type: 'text' };

let javascript: string | undefined;
export function hubPage(request: IncomingMessage, response: ServerResponse): boolean {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (path !== '/hub' && !path.startsWith('/hub/')) return false;
    response.setHeader('cache-control', 'no-store'); response.setHeader('referrer-policy', 'no-referrer');
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('content-security-policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'");
    if (!['GET', 'HEAD'].includes(request.method ?? '')) { response.writeHead(405, { allow: 'GET, HEAD' }); response.end(); return true; }
    let content: string, type: string;
    if (path === '/hub/app.js') {
        javascript ??= new Bun.Transpiler({ loader: 'ts', target: 'browser' }).transformSync(browser as unknown as string);
        content = javascript; type = 'text/javascript';
    } else if (path === '/hub/style.css') { content = css; type = 'text/css'; }
    else if (path === '/hub' || path === '/hub/') { content = html as unknown as string; type = 'text/html'; }
    else { response.writeHead(404); response.end(); return true; }
    response.writeHead(200, { 'content-type': `${type}; charset=utf-8` });
    response.end(request.method === 'HEAD' ? undefined : content); return true;
}
