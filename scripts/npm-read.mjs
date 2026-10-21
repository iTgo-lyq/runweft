import assert from 'node:assert/strict';

const networkCodes = new Set(['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT', 'EAI_AGAIN',
    'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']);

function transient(error, signal) {
    if (error instanceof AggregateError) return error.errors.length > 0 && error.errors.every(item => transient(item, signal));
    if (error.cause instanceof AggregateError) return transient(error.cause, signal);
    return error.retryable || signal.aborted && ['AbortError', 'TimeoutError'].includes(error.name)
        || networkCodes.has(error.cause?.code ?? error.code);
}

export function publicReadError(status, retryAfter, now = Date.now()) {
    const error = new Error('Public npm HTTP ' + status);
    error.retryable = [404, 408, 429].includes(status) || status >= 500 && status <= 599;
    if (retryAfter != null) {
        const seconds = /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - now;
        if (Number.isFinite(seconds)) error.retryAfterMs = Math.max(0, seconds);
    }
    return error;
}

// One deadline covers headers, response bodies, retries and all files in a download job.
export function publicReadBudget({ timeoutMs = 600_000, requestTimeoutMs = 120_000,
    now = Date.now, pause = ms => new Promise(done => setTimeout(done, ms)), record = () => {} } = {}) {
    assert(Number.isFinite(timeoutMs) && timeoutMs > 0, 'Public npm read budget must be positive');
    const started = now(), deadline = started + timeoutMs;
    return async function read(name, operation) {
        let attempt = 0;
        while (true) {
            const remaining = deadline - now();
            assert(remaining > 0, 'Public npm read budget exhausted; retry verification, never reupload');
            const signal = AbortSignal.timeout(Math.max(1, Math.floor(Math.min(requestTimeoutMs, remaining))));
            attempt++;
            try {
                const result = await operation(signal);
                assert(now() < deadline, 'Public npm read budget exhausted; retry verification, never reupload');
                record({ name, attempt, elapsedMs: now() - started, success: true });
                return result;
            } catch (error) {
                const retryable = transient(error, signal);
                record({ name, attempt, elapsedMs: now() - started, success: false, retryable: Boolean(retryable) });
                if (!retryable) throw error;
                const wait = Math.max([2000, 5000, 10000, 20000][Math.min(attempt - 1, 3)], error.retryAfterMs ?? 0);
                assert(wait < deadline - now(), 'Public npm read budget exhausted; retry verification, never reupload');
                await pause(wait);
            }
        }
    };
}

export async function publicResponse(request, url, signal) {
    const response = await request(url, { redirect: 'error', headers: { 'cache-control': 'no-cache' }, signal });
    if (response.status !== 200) {
        const error = publicReadError(response.status, response.headers.get('retry-after'));
        // Cleanup must not replace a known HTTP failure with a retryable socket error.
        try { await response.body?.cancel(); } catch { /* Preserve the HTTP status. */ }
        throw error;
    }
    return response;
}
