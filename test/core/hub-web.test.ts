import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { HubApiError, hubFetch } from '../../src/hub/web/api/http';
import { identityApi, spaceApi } from '../../src/hub/web/api/hub';
import { patchHash, readHash } from '../../src/hub/web/route';

// The Hub page runs in a browser; these tests give it the few globals it reads and record what it sends.
type Call = { url: string; method: string; authorization?: string; body?: any };
const original = { location: globalThis.location, history: globalThis.history, sessionStorage: globalThis.sessionStorage, fetch: globalThis.fetch };
let calls: Call[];
let answer: (call: Call) => Response | Promise<Response>;

function setGlobal(name: string, value: unknown) {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}
function browser(origin = 'http://127.0.0.1:3000', hash = '') {
    const url = new URL(origin + '/hub' + hash);
    const location = { protocol: url.protocol, hostname: url.hostname, pathname: url.pathname, hash: url.hash };
    setGlobal('location', location);
    setGlobal('history', { replaceState(_state: unknown, _title: string, next: string) { location.hash = new URL(next, origin).hash; } });
    const store = new Map<string, string>();
    setGlobal('sessionStorage', { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value), removeItem: (key: string) => void store.delete(key) });
    return { location, store };
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
    calls = [];
    answer = () => json(200, {});
    setGlobal('fetch', async (input: string, init: RequestInit = {}) => {
        const headers = (init.headers ?? {}) as Record<string, string>;
        const call = { url: input, method: init.method ?? 'GET', authorization: headers.authorization, body: init.body ? JSON.parse(String(init.body)) : undefined };
        calls.push(call);
        return answer(call);
    });
});
afterEach(() => { for (const [name, value] of Object.entries(original)) setGlobal(name, value); });

describe('Hub page hash routing', () => {
    test('reads the CLI contracts and ignores unknown entries', () => {
        expect(readHash('#space=s1&task=t1&round=r2')).toEqual({ view: undefined, space: 's1', task: 't1', round: 'r2', connect: undefined, nativeExpired: false });
        expect(readHash('#connect=req-1')).toMatchObject({ connect: 'req-1', nativeExpired: false });
        expect(readHash('#native-expired').nativeExpired).toBe(true);
        expect(readHash('#view=machines').view).toBe('machines');
        expect(readHash('#view=../admin').view).toBeUndefined();
    });

    test('patches keys in place without leaving empty values behind', () => {
        const { location } = browser('http://127.0.0.1:3000', '#space=s1&task=t1&round=r2&native-expired');
        patchHash({ view: 'agents', task: null, round: null, 'native-expired': null });
        expect(location.hash).toBe('#space=s1&view=agents');
        patchHash({ space: null, view: null });
        expect(location.hash).toBe('');
    });
});

describe('Hub page requests', () => {
    test('refuse to send passwords from a remote plaintext origin', async () => {
        browser('http://hub.example');
        const error = await hubFetch('/sessions', { body: { username: 'a', password: 'b' } }).catch(failure => failure);
        expect(error).toBeInstanceOf(HubApiError);
        expect(error.code).toBe('account_https_required');
        expect(calls).toHaveLength(0);
    });

    test('a lost write is unconfirmed, a lost read is unreachable, and an invalid session expires', async () => {
        browser();
        answer = () => { throw new TypeError('network down'); };
        expect((await hubFetch('/spaces', { body: { name: 'x' } }).catch(error => error)).kind).toBe('unknown');
        expect((await hubFetch('/spaces').catch(error => error)).kind).toBe('unreachable');
        answer = () => json(401, { error: { code: 'user_session_invalid', message: '登录已失效' } });
        expect((await hubFetch('/identity', { token: 'rw_web_x' }).catch(error => error)).kind).toBe('expired');
        answer = () => json(403, { error: { code: 'space_forbidden', message: '没有权限', hint: '请联系所有者' } });
        expect(await hubFetch('/identity').catch(error => error)).toMatchObject({ kind: 'error', status: 403, message: '没有权限', hint: '请联系所有者' });
    });
});

describe('Hub page space context', () => {
    test('switching context during credential acquisition prevents the old write from being sent', async () => {
        browser();
        let current = true;
        answer = () => { current = false; return json(200, { token: 'old-space-jwt' }); };
        const api = spaceApi({ token: 'rw_web_account', userId: 'u1', spaceId: 's1' }, () => current);
        expect((await api.request('/resources/machines/m/credential', undefined, 'DELETE').catch(error => error)).message).toContain('已变化');
        expect(calls.map(call => call.url)).toEqual(['/api/auth']);
    });

    test('late account and resource failures cannot expire a newer context', async () => {
        browser();
        for (const kind of ['identity', 'resource']) {
            let current = true;
            answer = call => {
                if (call.url === '/api/auth') return json(200, { token: 'jwt' });
                current = false;
                return json(401, { error: { code: 'user_session_invalid', message: '登录已失效' } });
            };
            const operation = kind === 'identity'
                ? identityApi('old-account', () => current).rename('old name')
                : spaceApi({ token: 'old-account', userId: 'u1', spaceId: 's1' }, () => current).request('/tasks/overview');
            const failure = await operation.catch(error => error);
            expect(failure.kind).not.toBe('expired');
            expect(failure.message).toContain('已变化');
        }
    });
    test('caches one short credential per space and keeps the account token out of resource requests', async () => {
        browser();
        let issued = 0;
        answer = call => call.url === '/api/auth' ? json(200, { token: `jwt-${++issued}-${call.body.spaceId ?? 'global'}` }) : json(200, { ok: true });
        const api = spaceApi({ token: 'rw_web_account', userId: 'u1', spaceId: 's1' }, () => true);
        await api.request('/tasks/overview'); await api.request('/agents'); await api.request('/machines', undefined, 'GET', true);
        expect(calls.filter(call => call.url === '/api/auth').map(call => call.body)).toEqual([{ accessToken: 'rw_web_account', spaceId: 's1' }, { accessToken: 'rw_web_account' }]);
        const resources = calls.filter(call => call.url.startsWith('/api/runweft/'));
        expect(resources.map(call => call.authorization)).toEqual(['Bearer jwt-1-s1', 'Bearer jwt-1-s1', 'Bearer jwt-2-global']);
    });

    test('a space-scoped 401 signs out only when the account itself is no longer signed in', async () => {
        browser();
        let account = 200;
        answer = call => {
            if (call.url === '/api/auth') return json(401, { error: { code: 'user_session_invalid', message: '登录已失效' } });
            if (call.url === '/api/runweft/hub/identity') return account === 200 ? json(200, { identity: { id: 'u1' } }) : json(401, { error: { code: 'user_session_invalid', message: '登录已失效' } });
            return json(200, {});
        };
        const api = spaceApi({ token: 'rw_web_account', userId: 'u1', spaceId: 'left-space' }, () => true);
        expect(await api.request('/tasks/overview').catch(error => error)).toMatchObject({ kind: 'error', code: 'hub_space_access_lost' });
        account = 401;
        expect((await api.request('/tasks/overview').catch(error => error)).kind).toBe('expired');
    });

    test('answers that arrive after the identity or space changed are dropped', async () => {
        browser();
        let current = true;
        answer = call => {
            if (call.url === '/api/auth') return json(200, { token: 'jwt' });
            current = false; // the user switched space while this request was in flight
            return json(200, { tasks: ['from the old space'] });
        };
        const api = spaceApi({ token: 'rw_web_account', userId: 'u1', spaceId: 's1' }, () => current);
        expect((await api.request('/tasks/overview').catch(error => error)).message).toContain('已变化');
        const before = calls.length;
        expect((await api.request('/tasks/overview').catch(error => error)).message).toContain('已变化');
        expect(calls.length).toBe(before);
    });

    test('an unanswered creation keeps its receipt and a changed form never creates a second object', async () => {
        const { store } = browser();
        const key = 'runweft.create:u1:s1:/agents';
        answer = call => {
            if (call.url === '/api/auth') return json(200, { token: 'jwt' });
            if (call.url.includes('/requests/')) return json(404, { error: { message: '未找到' } });
            throw new TypeError('connection reset');
        };
        const api = spaceApi({ token: 'rw_web_account', userId: 'u1', spaceId: 's1' }, () => true);
        const lost = await api.create('/agents', { name: 'reviewer' }, async () => true).catch(error => error);
        expect(lost.kind).toBe('unknown');
        const receipt = JSON.parse(store.get(key)!);
        expect(lost.message).toContain(receipt.requestId);

        const prompts: string[] = [];
        const changed = await api.create('/agents', { name: 'renamed' }, async message => { prompts.push(message); return false; }).catch(error => error);
        expect(changed.message).toBe('请核对列表后重新提交。');
        expect(prompts[0]).toContain('表单也已改变');
        expect(JSON.parse(store.get(key)!).requestId).toBe(receipt.requestId);
        expect(calls.filter(call => call.url === '/api/runweft/agents' && call.method === 'POST')).toHaveLength(1);

        answer = call => {
            if (call.url === '/api/auth') return json(200, { token: 'jwt' });
            if (call.url.includes('/requests/')) return json(200, { agent: { id: 'a1' } });
            return json(500, {});
        };
        expect(await api.create<{ agent: { id: string } }>('/agents', { name: 'reviewer' }, async () => true)).toEqual({ agent: { id: 'a1' } });
        expect(store.has(key)).toBe(false);
    });

    test('a creation the Hub refuses drops its receipt, so the corrected form is a new request', async () => {
        const { store } = browser();
        const key = 'runweft.create:u1:s1:/repositories', sent: string[] = [];
        answer = call => {
            if (call.url === '/api/auth') return json(200, { token: 'jwt' });
            sent.push(call.body.requestId);
            return sent.length === 1 ? json(409, { error: { code: 'repository_name_taken', message: '仓库名称已被使用' } }) : json(200, { repository: { id: 'r1' } });
        };
        const api = spaceApi({ token: 'rw_web_account', userId: 'u1', spaceId: 's1' }, () => true);
        expect((await api.create('/repositories', { name: 'taken' }, async () => true).catch(error => error)).status).toBe(409);
        expect(store.has(key)).toBe(false);
        expect(await api.create<{ repository: { id: string } }>('/repositories', { name: 'free' }, async () => true)).toEqual({ repository: { id: 'r1' } });
        expect(sent[0]).not.toBe(sent[1]);
    });
});
