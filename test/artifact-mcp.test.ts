import { afterEach, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { SignJWT } from 'jose';
import { Hono } from '../hapi/hub/node_modules/hono';
import { Store } from '../hapi/hub/src/store';
import { ArtifactService } from '../hapi/hub/src/artifacts/service';
import { createArtifactRoutes } from '../hapi/hub/src/web/routes/artifacts';
import { createAuthMiddleware, type WebAppEnv } from '../hapi/hub/src/web/middleware/auth';
import { ARTIFACT_DEFAULT_LIMITS } from '../hapi/shared/src/artifacts';
import { loadConfig } from '../src/config';
import { createMcpServer } from '../src/mcp/server';
import { recordClaudeCall } from '../src/mcp/claude-hook';
import { until } from './tasks-fixture';

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function fixture(host: 'codex' | 'claude') {
    await mkdir('.dev-smoke/tests', { recursive: true });
    const root = await mkdtemp(resolve('.dev-smoke/tests/artifact-mcp-')), cwd = join(root, 'project'), outside = join(root, 'outside'), home = join(root, 'home');
    for (const path of [cwd, outside, home]) await mkdir(path);
    const store = new Store(join(root, 'hapi.db'));
    cleanup.push(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
    const service = new ArtifactService(store.artifacts, join(root, 'artifacts'), ARTIFACT_DEFAULT_LIMITS);
    const secret = new TextEncoder().encode('mcp-artifact-test-only');
    const token = await new SignJWT({ uid: 1, ns: 'default' }).setProtectedHeader({ alg: 'HS256' }).sign(secret);
    const app = new Hono<WebAppEnv>();
    app.post('/api/auth', c => c.json({ token })); app.use('/api/*', createAuthMiddleware(secret)); app.route('/api', createArtifactRoutes(service));
    const faults = { loseUpload: false, stallDownload: false, started: false, writes: 0 };
    const http = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
        if (faults.stallDownload && request.method === 'GET' && request.url.endsWith('/content')) {
            faults.started = true;
            return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); } }));
        }
        const result = await app.fetch(request);
        if (request.method === 'PUT' && request.url.endsWith('/content')) {
            faults.writes++;
            if (faults.loseUpload) { faults.loseUpload = false; return new Response('lost response', { status: 502 }); }
        }
        return result;
    } });
    cleanup.push(() => http.stop(true));
    await writeFile(join(home, 'config.yaml'), `mode: hub\nhub:\n  url: ${http.url.origin}\n  tokenEnv: ARTIFACT_MCP_TOKEN\n`);
    const config = loadConfig(home, { ARTIFACT_MCP_TOKEN: 'test-only', GIT_CEILING_DIRECTORIES: root });
    const server = createMcpServer({ client: host, cwd, config: () => config }), client = new Client({ name: 'file-test', version: '1' });
    const [left, right] = InMemoryTransport.createLinkedPair(); await server.connect(left); await client.connect(right);
    cleanup.push(async () => { await client.close(); await server.close(); });
    const call = async (name: string, args: Record<string, unknown>, callId = crypto.randomUUID(), signal?: AbortSignal) => {
        if (host === 'claude') recordClaudeCall(config, { hook_event_name: 'PreToolUse', tool_name: `mcp__runweft__${name}`, tool_use_id: callId, session_id: 'parent', cwd });
        const result = await client.callTool({ name, arguments: args, _meta: host === 'codex' ? { threadId: 'parent', sessionId: 'parent', callId } : { 'claudecode/toolUseId': callId } }, undefined, { signal });
        expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(result.structuredContent) }]);
        return result.structuredContent as Record<string, any>;
    };
    return { cwd, outside, client, faults, call };
}

test('both host identities transfer only workspace files, preserve request identity and publish no bytes to context', async () => {
    for (const host of ['codex', 'claude'] as const) {
        const h = await fixture(host), bytes = Buffer.from('PRIVATE_FILE_BODY\0二进制内容');
        await writeFile(join(h.cwd, '材料.txt'), bytes);
        const args = { path: '材料.txt' }, callId = crypto.randomUUID();
        const first = await h.call('upload_artifact', args, callId);
        expect(first.artifact.state).toBe('available'); expect(JSON.stringify(first)).not.toContain('PRIVATE_FILE_BODY');
        expect(await h.call('upload_artifact', args, callId)).toEqual(first); expect(h.faults.writes).toBe(1);
        expect((await h.call('read_artifact', { request_id: first.request_id })).artifact).toEqual(first.artifact);
        expect((await h.call('read_artifact', { id: first.artifact.id })).artifact).toEqual(first.artifact);
        expect((await h.call('read_artifact', {})).error.code).toBe('invalid_tool_arguments');
        expect((await h.call('read_artifact', { id: first.artifact.id, request_id: first.request_id })).error.code).toBe('invalid_tool_arguments');
        const destination = { id: first.artifact.id, path: 'new/下载.txt' };
        expect((await h.call('download_artifact', destination)).path).toBe(join(h.cwd, 'new/下载.txt'));
        expect(await readFile(join(h.cwd, 'new/下载.txt'))).toEqual(bytes);
        expect((await h.call('download_artifact', destination)).error.code).toBe('artifact_destination_exists');
        expect((await h.call('download_artifact', { ...destination, overwrite: true })).artifact.id).toBe(first.artifact.id);
        await writeFile(join(h.outside, 'secret.txt'), 'OUTSIDE');
        await symlink(h.outside, join(h.cwd, 'escape'));
        await symlink(join(h.outside, 'secret.txt'), join(h.cwd, 'secret-link'));
        for (const path of ['../outside/secret.txt', join(h.outside, 'secret.txt'), 'escape/secret.txt', 'secret-link']) {
            expect((await h.call('upload_artifact', { path })).error.code).toBe('artifact_path_outside_workspace');
            expect((await h.call('download_artifact', { ...destination, path, overwrite: true })).error.code).toBe('artifact_path_outside_workspace');
        }
        expect((await h.call('download_artifact', { ...destination, path: 'escape/new/path.txt' })).error.code).toBe('artifact_path_outside_workspace');
        expect(await readFile(join(h.outside, 'secret.txt'), 'utf8')).toBe('OUTSIDE');
        expect(h.faults.writes).toBe(1);
        expect((await h.call('upload_artifact', { path: '.' })).error.code).toBe('artifact_not_file');
        await symlink(join(h.cwd, '材料.txt'), join(h.cwd, 'alias.txt'));
        expect((await h.call('upload_artifact', { path: 'alias.txt' })).artifact.filename).toBe('alias.txt');
    }
});

test('lost MCP upload response recovers the original object; cancelled download leaves no target or partial file', async () => {
    const h = await fixture('codex'), request_id = crypto.randomUUID();
    await writeFile(join(h.cwd, 'input.txt'), 'original bytes'); h.faults.loseUpload = true;
    expect((await h.call('upload_artifact', { path: 'input.txt', request_id })).error).toBeDefined();
    const recovered = await h.call('read_artifact', { request_id }); expect(recovered.artifact.state).toBe('available');
    expect((await h.call('upload_artifact', { path: 'input.txt', request_id })).artifact.id).toBe(recovered.artifact.id);
    expect(h.faults.writes).toBe(1);
    h.faults.stallDownload = true;
    const abort = new AbortController(), pending = h.call('download_artifact', { id: recovered.artifact.id, path: 'cancelled.txt' }, crypto.randomUUID(), abort.signal).catch(error => error);
    await until(() => h.faults.started, Boolean); abort.abort(); await pending;
    await until(() => readdir(h.cwd), files => !files.some(file => file.endsWith('.runweft-part')));
    expect(await readdir(h.cwd)).toEqual(['input.txt']); expect(h.faults.writes).toBe(1);
});
