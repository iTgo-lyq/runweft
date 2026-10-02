import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createIdentityToken } from '../../src/hub/store';
import { closeSmoke } from './smoke-lifecycle';

/** Compiled stdio/auth transport only; no native tools, model credentials or fake Hub authorization. */
export async function probeMcpProtocol(binary: string, root: string) {
    mkdirSync(root, { recursive: true });
    const home = join(root, 'client'), token = createIdentityToken(), paths: string[] = [], errors: unknown[] = [];
    let started!: () => void, aborted!: () => void;
    let waiting = new Promise<void>(resolve => { started = resolve; }), cancelled = new Promise<void>(resolve => { aborted = resolve; });
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
        const path = new URL(request.url).pathname; paths.push(path);
        if (path === '/api/runweft/health') return Response.json({ service: 'runweft', protocolVersion: 1, ready: true, capabilities: { hubAccess: 1, hubDelegation: 1 } });
        assert.equal(path, '/api/auth'); started();
        return new Promise<Response>(resolve => request.signal.addEventListener('abort', () => { aborted(); resolve(new Response()); }, { once: true }));
    } });
    const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => typeof value === 'string' && !key.startsWith('RUNWEFT_') && !key.startsWith('HAPI_'))) as Record<string, string>;
    Object.assign(env, { RUNWEFT_IDENTITY_TOKEN: token, CODEX_HOME: join(root, 'codex'), CLAUDE_CONFIG_DIR: join(root, 'claude') });
    const args = ['--home', home, 'hub', '--url', server.url.origin, '--space', randomUUID(), 'mcp', 'serve', '--client', 'codex'];
    const transport = new StdioClientTransport({ command: binary, args, env, stderr: 'pipe' });
    let stderr = ''; transport.stderr?.on('data', chunk => { stderr += chunk; });
    const client = new Client({ name: 'runweft-protocol-probe', version: '1' }); client.onerror = error => { errors.push(error); };
    const resources: Array<() => void | Promise<void>> = [() => server.stop(true), () => client.close()];
    const bounded = <T>(promise: Promise<T>, label: string, ms = 5000) => Promise.race([promise, Bun.sleep(ms).then(() => { throw new Error(label); })]);
    try {
        await client.connect(transport);
        const catalog = await client.listTools(); assert.equal(catalog.tools.length, 17); assert(catalog.tools.some(tool => tool.name === 'runweft_status'));
        const controller = new AbortController();
        const call = client.callTool({ name: 'runweft_status', _meta: { threadId: 'protocol-thread', sessionId: 'protocol-session', callId: 'cancel' } }, undefined, { signal: controller.signal }).catch(() => null);
        await bounded(waiting, 'Authentication never started'); controller.abort(); await call;
        await bounded(cancelled, 'Cancellation did not abort HTTP');
        assert.deepEqual(paths, ['/api/runweft/health', '/api/auth']); assert.equal(errors.length, 0);
        await client.close(); resources.pop();
        waiting = new Promise<void>(resolve => { started = resolve; }); cancelled = new Promise<void>(resolve => { aborted = resolve; });
        const child = spawn(binary, args, { env, stdio: ['pipe', 'pipe', 'pipe'] }); let stdout = '';
        child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
        resources.push(async () => {
            if (child.exitCode === null && child.signalCode === null) {
                child.kill('SIGKILL'); await bounded(exited, 'EOF probe process did not exit after cleanup');
                throw new Error('EOF probe required forced cleanup');
            }
            await exited;
        });
        const exited = new Promise<number | null>((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
        const send = (value: object) => child.stdin.write(JSON.stringify(value) + '\n');
        send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'eof-probe', version: '1' } } });
        send({ jsonrpc: '2.0', method: 'notifications/initialized' });
        send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'runweft_status', _meta: { threadId: 'protocol-thread', sessionId: 'protocol-session', callId: 'eof' } } });
        await bounded(waiting, 'EOF auth never started'); child.stdin.end();
        assert.equal(await bounded(exited, 'MCP did not exit on EOF'), 0);
        await bounded(cancelled, 'EOF did not abort HTTP');
        for (const line of stdout.split('\n').filter(Boolean)) assert.equal(JSON.parse(line).jsonrpc, '2.0');
        assert(stdout.trim()); assert(!stdout.includes(token)); assert(!stderr.includes(token));
        assert.deepEqual(paths, ['/api/runweft/health', '/api/auth', '/api/runweft/health', '/api/auth']);
        assert(!existsSync(home), 'Protocol probe must not create a data home');
        return { noHomeWrite: true, catalog: catalog.tools.map(tool => tool.name), cancellation: true, eof: true, stdoutProtocolOnly: true, paths };
    } finally { await closeSmoke(resources); }
}
