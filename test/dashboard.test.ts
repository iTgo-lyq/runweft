import { afterEach, expect, test } from 'bun:test';
import { resourceFixture } from './resources-fixture';
import { DashboardClient, LatestRead, LoginRequired, codeText, consumeUrlToken, filesText, hapiLink, stopText, tokenKey } from '../src/dashboard/app';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
function storage() {
    const values = new Map<string, string>();
    return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
const empty = { namespace: 'alpha', items: [], total: 0, page: 1, pages: 1, limit: 50, inventory: { available: true, error: null }, generated_at: 1 };

test('dashboard embeds public static files with CSP, while task data requires authentication', async () => {
    const h = await resourceFixture(cleanups, { fetch: () => undefined });
    const page = await fetch(h.url + '/runweft/');
    expect(page.status).toBe(200); expect(page.headers.get('content-type')).toContain('text/html');
    expect(page.headers.get('referrer-policy')).toBe('no-referrer');
    expect(page.headers.get('cache-control')).toBe('no-store');
    expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'self'");
    expect(page.headers.get('content-security-policy')).toContain("script-src 'self'");
    const html = await page.text();
    expect(html).toContain('协作总览'); expect(html).toContain('src="/runweft/app.js"');
    expect((await fetch(h.url + '/runweft')).status).toBe(200);
    expect((await fetch(h.url + '/runweft/', { method: 'HEAD' })).headers.get('content-type')).toContain('text/html');
    expect((await fetch(h.url + '/runweft/', { method: 'POST' })).status).toBe(405);
    const css = await fetch(h.url + '/runweft/style.css'); expect(css.headers.get('content-type')).toContain('text/css');
    expect(await css.text()).toContain('@media(max-width:760px)');
    const script = await fetch(h.url + '/runweft/app.js'); expect(script.headers.get('content-type')).toContain('text/javascript');
    const source = await script.text();
    // Loading the exact HTTP script in a non-DOM environment proves the embedded TypeScript was removed.
    const module = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
    expect(module.tokenKey(h.url)).toBe(tokenKey(h.url));
    expect((await fetch(h.url + '/api/runweft/tasks/overview')).status).toBe(401);
    expect((await h.alpha.request('/api/runweft/tasks/overview')).items).toEqual([]);
    expect((await fetch(h.url + '/runweft/not-a-file')).status).not.toBe(200);
});

test('URL token is immediately removed; HAPI links pin this origin without carrying credentials', () => {
    let replaced = '';
    expect(consumeUrlToken({ href: 'https://hub.test/runweft/?token=private&keep=1#tasks' }, { replaceState: (_data, _unused, url) => { replaced = String(url); } })).toBe('private');
    expect(replaced).toBe('/runweft/?keep=1#tasks');
    const link = new URL(hapiLink('https://hub.test', '/sessions/' + encodeURIComponent('id/with?input')));
    expect(link.origin).toBe('https://hub.test'); expect(link.searchParams.get('hub')).toBe('https://hub.test'); expect(link.searchParams.has('token')).toBe(false);
    expect(link.pathname).toBe('/sessions/id%2Fwith%3Finput');
});

test('browser login shares HAPI access token only after success; expired JWT authenticates and retries once', async () => {
    const saved = storage(); saved.setItem(tokenKey('https://other.test'), 'other-private');
    let auths = 0, reads = 0;
    const requests: { input: string; authorization: string | null }[] = [];
    const client = new DashboardClient('https://hub.test', saved, async (input, init) => {
        requests.push({ input, authorization: new Headers(init?.headers).get('authorization') });
        if (input === '/api/auth') { auths++; expect(JSON.parse(String(init!.body))).toEqual({ accessToken: 'private' }); return Response.json({ token: `jwt-${auths}` }); }
        return ++reads === 1 ? new Response('', { status: 401 }) : Response.json(empty);
    });
    expect(client.remembered()).toBe('');
    await client.login('private');
    expect(client.remembered()).toBe('private');
    expect(saved.values.get(tokenKey('https://other.test'))).toBe('other-private');
    expect(await client.overview(new URLSearchParams('workspace=%2Frepo'))).toEqual(empty);
    expect(auths).toBe(2); expect(reads).toBe(2);
    expect(requests.filter(req => req.input !== '/api/auth').map(req => req.authorization)).toEqual(['Bearer jwt-1', 'Bearer jwt-2']);
    expect([...saved.values.values()].some(value => value.startsWith('jwt'))).toBe(false);
    expect(requests.every(req => req.input.startsWith('/') && !req.input.includes('private'))).toBe(true);
});

test('authentication failure never loops, overwrites remembered login, or exposes rejected tokens', async () => {
    const saved = storage(); saved.setItem(tokenKey('https://hub.test'), 'valid-old');
    const rejecting = new DashboardClient('https://hub.test', saved, async () => new Response('sensitive server output', { status: 401 }));
    await expect(rejecting.login('invalid-new')).rejects.toBeInstanceOf(LoginRequired);
    expect(rejecting.remembered()).toBe('valid-old');
    let auths = 0, reads = 0;
    const expired = new DashboardClient('https://hub.test', saved, async input => {
        if (input === '/api/auth') { auths++; return Response.json({ token: 'jwt' }); }
        reads++; return new Response('', { status: 401 });
    });
    await expired.login('valid-old');
    await expect(expired.overview(new URLSearchParams())).rejects.toBeInstanceOf(LoginRequired);
    expect(auths).toBe(2); expect(reads).toBe(2); expect(expired.remembered()).toBe('valid-old');
});

test('new filter reads supersede old responses and failures even when the transport ignores cancellation', async () => {
    const reads = new LatestRead(), values: string[] = [], errors: unknown[] = [];
    let finish!: (value: string) => void, aborted = false;
    const first = reads.run(signal => { signal.addEventListener('abort', () => { aborted = true; }); return new Promise<string>(resolve => { finish = resolve; }); }, value => values.push(value), error => errors.push(error));
    await reads.run(async () => 'new', value => values.push(value), error => errors.push(error));
    finish('old'); await first;
    expect(aborted).toBe(true); expect(values).toEqual(['new']); expect(reads.busy).toBe(false); expect(errors).toEqual([]);
    let reject!: (error: Error) => void;
    const pending = reads.run(() => new Promise<string>((_resolve, fail) => { reject = fail; }), value => values.push(value), error => errors.push(error));
    reads.cancel(); reject(new Error('cancelled filter')); await pending;
    expect(values).toEqual(['new']); expect(errors).toEqual([]);
});

test('labels distinguish retained sessions, uncertain starts, delivery failures and released files', () => {
    expect(stopText({ stop: 'not_started', execution_not_started: false })).toBe('尚未确认进程结束');
    expect(stopText({ stop: 'not_started', execution_not_started: true })).toBe('已确认未启动');
    expect(stopText({ stop: 'stopped', execution_not_started: false })).toBe('进程已结束');
    expect(codeText({ status: 'not_applicable', sealing_status: null, ref: null, result_head: null, storage: null, error: null, next: null })).toBe('不适用');
    expect(filesText({ status: 'none', retention: 'retained', pending: 0, count: 0, available: 0, error: null })).toBe('未声明');
    expect(filesText({ status: 'delivered', retention: 'released', pending: 0, count: 1, available: 1, error: null })).toBe('已释放');
});
