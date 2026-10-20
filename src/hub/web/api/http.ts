// One fetch path for the Hub page: HTTPS outside local development, bounded time, and errors that say what to do next.
export type HubErrorKind = 'expired' | 'unknown' | 'unreachable' | 'error';

export class HubApiError extends Error {
    constructor(readonly kind: HubErrorKind, message: string, readonly hint = '', readonly status = 0, readonly code?: string) { super(message); }
}

const localHost = (host: string) => ['localhost', '[::1]'].includes(host) || /^127\.\d+\.\d+\.\d+$/.test(host);

export type RequestOptions = { method?: string; body?: unknown; token?: string; base?: string; signal?: AbortSignal };

export async function hubFetch<T = any>(path: string, { method, body, token = '', base = '/api/runweft/hub', signal }: RequestOptions = {}): Promise<T> {
    const verb = method ?? (body === undefined ? 'GET' : 'POST');
    if (location.protocol !== 'https:' && !localHost(location.hostname)) {
        throw new HubApiError('error', '请通过 HTTPS 打开此 Hub，再登录或授权账号。', '仅本机开发地址允许 HTTP。', 0, 'account_https_required');
    }
    let response: Response;
    try {
        response = await fetch(base + path, {
            method: verb, credentials: 'omit', redirect: 'error',
            headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
        });
    } catch (error) {
        if (signal?.aborted) throw error;
        // A write that never got an answer may still have happened; never present it as safe to resend.
        if (verb !== 'GET') throw new HubApiError('unknown', '无法确认操作结果', '写操作的结果可能尚未确认。请先刷新核对，不要重复提交。');
        throw new HubApiError('unreachable', '无法连接 Hub', '检查网络或 Hub 服务后重试。');
    }
    const data = await response.json().catch(() => ({})) as { error?: { message?: string; hint?: string; code?: string } };
    if (!response.ok) {
        const message = data.error?.message ?? '请求未能完成。', hint = data.error?.hint ?? '', code = data.error?.code;
        throw new HubApiError(response.status === 401 && code === 'user_session_invalid' ? 'expired' : 'error', message, hint, response.status, code);
    }
    return data as T;
}
