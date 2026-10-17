import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';

/** Native-host diagnostics contain codes and timing, never raw provider output. */
export function watchNativeHost(child: ChildProcess, timeoutMs: number, graceMs = 10_000) {
    const state = { startedAt: Date.now(), timeoutMs, timedOut: false, lastProgressAt: Date.now(), lastTool: '', errors: [] as string[] };
    let tail = '';
    const stderr = (chunk: Buffer) => {
        // Match only known error codes; neither arbitrary stderr nor prompts become evidence.
        tail = (tail + chunk.toString()).slice(-4096);
        for (const code of ['serverOverloaded', 'rate_limit_exceeded', 'authentication_failed', 'insufficient_quota', 'ECONNREFUSED']) {
            if (tail.includes(code) && !state.errors.includes(code)) state.errors.push(code);
        }
    };
    child.stderr?.on('data', stderr);
    const soft = setTimeout(() => { state.timedOut = true; child.kill('SIGTERM'); }, timeoutMs);
    const hard = setTimeout(() => child.kill('SIGKILL'), timeoutMs + graceMs);
    return { state,
        progress(tool: string) { state.lastProgressAt = Date.now(); if (/^[a-z_]{1,64}$/.test(tool)) state.lastTool = tool; },
        check(code: number | null) {
            assert(!state.timedOut, `host_timeout: exceeded ${timeoutMs}ms; last tool ${state.lastTool || 'none'}`);
            assert.equal(code, 0, `host_failed: exit=${code}; codes=${state.errors.join(',') || 'unknown'}`);
        },
        close() { clearTimeout(soft); clearTimeout(hard); child.stderr?.off('data', stderr); tail = ''; },
    };
}
