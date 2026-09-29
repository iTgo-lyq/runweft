import { expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadConfig } from '../src/config';
import { HapiClient } from '../src/hapi';
import { recordClaudeCall, consumeClaudeCall, CLAUDE_CALL_TTL_MS } from '../src/mcp/claude-hook';
import { resolveHostIdentity } from '../src/mcp/identity';
import { createMcpServer, type McpTool } from '../src/mcp/server';
import { z } from 'zod';
import { fixture } from './helpers';

function setup() {
    const root = fixture('mcp');
    const cwd = join(root, 'workspace'); mkdirSync(cwd);
    return { root, cwd, c: loadConfig(join(root, 'home'), {}) };
}
const meta = (threadId: string) => ({ threadId, sessionId: 'root', callId: `call-${threadId}` });
const toolNames = ['runweft_status', 'list_agent_definitions', 'spawn_agent', 'list_agents', 'read_agent', 'wait', 'send_input', 'interrupt_agent', 'retry_finish', 'respond_to_permission'];
const hook = (call: string, session: string, cwd: string) => ({ hook_event_name: 'PreToolUse', tool_name: 'mcp__runweft__runweft_status',
    tool_use_id: call, session_id: session, cwd, tool_input: { secret: 'do-not-store' }, transcript_path: '/private/history.jsonl' });

test('Codex cross-checks per-call identity without equating a fork to its root', () => {
    const { c, cwd } = setup();
    const nested = { session_id: 'root', thread_id: 'fork' };
    for (const value of [nested, JSON.stringify(nested)]) {
        expect(resolveHostIdentity('codex', { ...meta('fork'), 'x-codex-turn-metadata': value }, cwd, c))
            .toMatchObject({ nativeSessionId: 'fork', currentThreadId: 'fork', rootSessionId: 'root', cwd });
    }
    for (const value of [undefined, {}, { ...meta('a'), 'x-codex-turn-metadata': '{bad' }, { ...meta('a'), 'x-codex-turn-metadata': { thread_id: 'b' } }]) {
        expect(() => resolveHostIdentity('codex', value, cwd, c)).toThrow();
    }
    expect(existsSync(c.home)).toBe(false);
});

test('Claude joins exact calls in one cwd, switches after clear/resume, and consumes records once', () => {
    const { c, cwd } = setup();
    c.env.CLAUDE_CODE_SESSION_ID = 'stale-startup-id';
    for (const [call, session] of [['a', 'first'], ['b', 'concurrent'], ['c', 'after-clear'], ['d', 'resumed']]) {
        recordClaudeCall(c, hook(call!, session!, cwd));
    }
    for (const [call, session] of [['b', 'concurrent'], ['c', 'after-clear'], ['a', 'first'], ['d', 'resumed']]) {
        expect(resolveHostIdentity('claude', { 'claudecode/toolUseId': call }, cwd, c)).toMatchObject({ nativeSessionId: session, cwd });
    }
    expect(() => resolveHostIdentity('claude', { 'claudecode/toolUseId': 'a' }, cwd, c)).toThrow('hook');
    recordClaudeCall(c, hook('collision', 'one', cwd));
    expect(() => recordClaudeCall(c, hook('collision', 'two', cwd))).toThrow('另一个');
    expect(consumeClaudeCall(c, 'collision').sessionId).toBe('one');
    recordClaudeCall(c, { ...hook('native-child', 'root', cwd), agent_id: 'native-agent' });
    expect(resolveHostIdentity('claude', { 'claudecode/toolUseId': 'native-child' }, cwd, c).nativeAgentId).toBe('native-agent');
});

test('Claude persists only identity and tolerates approval delay but expires abandoned calls', () => {
    const { c, cwd } = setup();
    const now = Date.now();
    recordClaudeCall(c, hook('approval', 'session', cwd), now);
    expect(consumeClaudeCall(c, 'approval', now + CLAUDE_CALL_TTL_MS - 1).sessionId).toBe('session');
    recordClaudeCall(c, hook('abandoned', 'session', cwd), now);
    expect(() => consumeClaudeCall(c, 'abandoned', now + CLAUDE_CALL_TTL_MS + 1)).toThrow('hook');
    const db = new Database(join(c.home, 'client.sqlite'));
    try {
        const columns = db.query('PRAGMA table_info(claude_mcp_calls)').all() as { name: string }[];
        expect(columns.map(c => c.name)).toEqual(['callId', 'sessionId', 'cwd', 'agentId', 'createdAt']);
    } finally { db.close(); }
    expect(readFileSync(join(c.home, 'client.sqlite')).includes(Buffer.from('do-not-store'))).toBe(false);
});

async function linked(tools?: McpTool[]) {
    const { c, cwd } = setup();
    let configReads = 0;
    const server = createMcpServer({ client: 'codex', cwd, config: () => { configReads++; return c; }, tools });
    const client = new Client({ name: 'test', version: '1' });
    const [left, right] = InMemoryTransport.createLinkedPair();
    await server.connect(left); await client.connect(right);
    return { c, cwd, server, client, configReads: () => configReads };
}

test('discovery is static and side-effect-free; tool responses carry identity and connection failure', async () => {
    const x = await linked();
    try {
        expect((await x.client.listTools()).tools.map(t => t.name)).toEqual(toolNames);
        expect(x.configReads()).toBe(0); expect(existsSync(x.c.home)).toBe(false);
        const missing = await x.client.callTool({ name: 'runweft_status', arguments: {} });
        expect(missing).toMatchObject({ isError: true, structuredContent: { error: { code: 'host_identity_missing' } } });
        expect(existsSync(x.c.home)).toBe(false);
        const invalid = await x.client.callTool({ name: 'runweft_status', arguments: { sessionId: 'spoof' }, _meta: meta('a') });
        expect(invalid.isError).toBe(true);
        // A closed port provides a real connection failure without starting a service.
        const port = Bun.serve({ port: 0, fetch: () => new Response() });
        x.c.config.server.port = port.port!; await port.stop(true);
        const response = await x.client.callTool({ name: 'runweft_status', arguments: {}, _meta: meta('a') });
        expect(response).toMatchObject({ structuredContent: { identity: { nativeSessionId: 'a', cwd: x.cwd }, connection: { connected: false }, backgroundWake: false } });
        expect(existsSync(join(x.c.home, 'client.sqlite'))).toBe(true);
        expect(existsSync(join(x.c.home, 'server'))).toBe(false);
    } finally { await x.client.close(); await x.server.close(); }
});

test('request cancellation and disconnect reach waiting handlers without executing control actions', async () => {
    for (const mode of ['cancel', 'disconnect', 'timeout']) {
        let entered!: () => void, aborted!: () => void;
        const enteredPromise = new Promise<void>(r => { entered = r; });
        const abortedPromise = new Promise<void>(r => { aborted = r; });
        const tools: McpTool[] = [{ name: 'test_wait', description: 'test only', input: z.strictObject({}), timeoutMs: mode === 'timeout' ? 30 : undefined,
            async run(_args, { signal }) {
                entered();
                await new Promise<void>(resolve => signal.addEventListener('abort', () => { aborted(); resolve(); }, { once: true }));
                return { waited: true };
            } }];
        const x = await linked(tools);
        try {
            const controller = new AbortController();
            const pending = x.client.callTool({ name: 'test_wait', _meta: meta(mode) }, undefined, { signal: controller.signal }).catch(e => e);
            await enteredPromise;
            if (mode === 'cancel') controller.abort();
            if (mode === 'disconnect') await x.client.close();
            await abortedPromise;
            const response = await pending;
            if (mode === 'timeout') expect(response).toMatchObject({ isError: true, structuredContent: { error: { code: 'tool_timeout' } } });
        } finally { await x.client.close(); await x.server.close(); }
    }
});

test('stdio CLI uses protocol-only stdout and closes on EOF without touching the data home', async () => {
    const { c, cwd } = setup();
    const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('src/cli.ts'), '--home', c.home, 'mcp', 'serve', '--client', 'codex'], cwd, stderr: 'pipe' });
    let stderr = ''; transport.stderr?.on('data', chunk => { stderr += chunk; });
    const client = new Client({ name: 'stdio-test', version: '1' });
    await client.connect(transport);
    const pid = transport.pid!;
    expect((await client.listTools()).tools.map(t => t.name)).toEqual(toolNames);
    await client.close();
    expect(existsSync(c.home)).toBe(false);
    expect(stderr).toBe('');
    expect(() => process.kill(pid, 0)).toThrow();
});

test('cancelled service authentication does not continue to an execution request', async () => {
    let entered!: () => void;
    const authStarted = new Promise<void>(resolve => { entered = resolve; });
    const paths: string[] = [];
    const server = Bun.serve({ port: 0, async fetch(request) {
        paths.push(new URL(request.url).pathname); entered();
        return new Promise<Response>(resolve => request.signal.addEventListener('abort', () => resolve(new Response()), { once: true }));
    } });
    const controller = new AbortController();
    const client = new HapiClient(`http://127.0.0.1:${server.port}`, 'test-token');
    try {
        const pending = client.request('/api/sessions', { signal: controller.signal });
        await authStarted;
        const reason = new Error('caller cancelled'); controller.abort(reason);
        await expect(pending).rejects.toBe(reason);
        expect(paths).toEqual(['/api/auth']);
    } finally { await server.stop(true); }
});
