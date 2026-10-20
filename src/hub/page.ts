import type { IncomingMessage, ServerResponse } from 'node:http';
import html from './page.html' with { type: 'text' };
import nativeBrowser from './native-page' with { type: 'text' };
import { HUB_CSP } from './csp';
import { hubWebAssets } from './web/assets' with { type: 'macro' };

// The Hub front end is built at bundle time and embedded; the native page helper stays a small standalone script.
const web = hubWebAssets();
const assets = new Map<string, { type: string; content: () => string }>([
    ['/hub/app.js', { type: 'text/javascript', content: () => web.js }],
    ['/hub/app.css', { type: 'text/css', content: () => web.css }],
    ['/hub/native.js', { type: 'text/javascript', content: nativeScript }],
]);
let native: string | undefined;
function nativeScript() {
    if (native === undefined) {
        const source = (nativeBrowser as unknown as string).replace(/^export default '';\r?\n/, '');
        native = `(() => {\n${new Bun.Transpiler({ loader: 'ts', target: 'browser' }).transformSync(source)}\n})();`;
    }
    return native;
}

export function hubPage(request: IncomingMessage, response: ServerResponse): boolean {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (path !== '/hub' && !path.startsWith('/hub/')) return false;
    response.setHeader('cache-control', 'no-store'); response.setHeader('referrer-policy', 'no-referrer');
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('content-security-policy', HUB_CSP);
    if (!['GET', 'HEAD'].includes(request.method ?? '')) { response.writeHead(405, { allow: 'GET, HEAD' }); response.end(); return true; }
    let content: string, type: string;
    const asset = assets.get(path);
    if (asset) { content = asset.content(); type = asset.type; }
    else if (path === '/hub' || path === '/hub/') { content = html as unknown as string; type = 'text/html'; }
    else { response.writeHead(404); response.end(); return true; }
    response.writeHead(200, { 'content-type': `${type}; charset=utf-8` });
    response.end(request.method === 'HEAD' ? undefined : content); return true;
}
