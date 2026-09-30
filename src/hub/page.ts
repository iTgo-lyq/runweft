import type { IncomingMessage, ServerResponse } from 'node:http';
import html from './page.html' with { type: 'text' };
import css from './style.css' with { type: 'text' };
import browser from './app' with { type: 'text' };
import nativeBrowser from './native-page' with { type: 'text' };
import consoleBrowser from './console' with { type: 'text' };
import resourcesBrowser from './resources-page' with { type: 'text' };
import agentsBrowser from './agents-page' with { type: 'text' };
import repositoriesBrowser from './repositories-page' with { type: 'text' };
import selectionsBrowser from './selections-page' with { type: 'text' };
import tasksBrowser from './tasks-page' with { type: 'text' };

const scripts: Record<string, string> = { '/hub/app.js': browser as unknown as string, '/hub/native.js': nativeBrowser as unknown as string,
    '/hub/console.js': consoleBrowser as unknown as string, '/hub/resources-page.js': resourcesBrowser as unknown as string,
    '/hub/agents-page.js': agentsBrowser as unknown as string, '/hub/repositories-page.js': repositoriesBrowser as unknown as string,
    '/hub/selections-page.js': selectionsBrowser as unknown as string, '/hub/tasks-page.js': tasksBrowser as unknown as string };
const compiled = new Map<string, string>();
export function hubPage(request: IncomingMessage, response: ServerResponse): boolean {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (path !== '/hub' && !path.startsWith('/hub/')) return false;
    response.setHeader('cache-control', 'no-store'); response.setHeader('referrer-policy', 'no-referrer');
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('content-security-policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'");
    if (!['GET', 'HEAD'].includes(request.method ?? '')) { response.writeHead(405, { allow: 'GET, HEAD' }); response.end(); return true; }
    let content: string, type: string;
    if (Object.hasOwn(scripts, path)) {
        if (!compiled.has(path)) {
            const source = path === '/hub/native.js' ? scripts[path].replace(/^export default '';\r?\n/, '') : scripts[path];
            const javascript = new Bun.Transpiler({ loader: 'ts', target: 'browser' }).transformSync(source);
            compiled.set(path, path === '/hub/native.js' ? `(() => {\n${javascript}\n})();` : javascript);
        }
        content = compiled.get(path)!; type = 'text/javascript';
    } else if (path === '/hub/style.css') { content = css; type = 'text/css'; }
    else if (path === '/hub' || path === '/hub/') { content = html as unknown as string; type = 'text/html'; }
    else { response.writeHead(404); response.end(); return true; }
    response.writeHead(200, { 'content-type': `${type}; charset=utf-8` });
    response.end(request.method === 'HEAD' ? undefined : content); return true;
}
