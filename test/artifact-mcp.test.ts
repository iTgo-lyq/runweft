import { fixtureCleanup } from './fixture-cleanup';
import { randomUUID } from 'node:crypto';
import { atomicWrite } from '../src/config';
import { hubConnectionPaths } from '../src/hub/resources/connection';
import { afterEach, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Hono } from '../hapi/hub/node_modules/hono';
import { Store } from '../hapi/hub/src/store';
import { ArtifactService } from '../hapi/hub/src/artifacts/service';
import { createArtifactRoutes } from '../hapi/hub/src/web/routes/artifacts';
import { type WebAppEnv } from '../hapi/hub/src/web/middleware/auth';
import { ARTIFACT_DEFAULT_LIMITS } from '../hapi/shared/src/artifacts';
import { loadConfig } from '../src/config';
import { createMcpServer } from '../src/mcp/server';
import { recordClaudeCall } from '../src/mcp/claude-hook';
import { until } from './helpers';
import { hubWorkspaceFixture } from './hub-workspace-fixture';

const cleanupOwner = fixtureCleanup([]), cleanup = cleanupOwner.resources;
afterEach(() => cleanupOwner.close());
async function fixture(host: 'codex' | 'claude') {
    const owned = fixtureCleanup(cleanup);
    try {
        await mkdir('.dev-smoke/tests', { recursive: true });
        const root = await mkdtemp(resolve('.dev-smoke/tests/artifact-mcp-')); owned.resources.push(() => rm(root, { recursive: true, force: true }));
        const cwd = join(root, 'project'), outside = join(root, 'outside');
        for (const path of [cwd, outside]) await mkdir(path);
        const store = new Store(join(root, 'hapi.db'));
        owned.resources.push(() => store.close());
        const service = new ArtifactService(store.artifacts, join(root, 'artifacts'), ARTIFACT_DEFAULT_LIMITS);
        const faults = { loseUpload: false, stallDownload: false, started: false, writes: 0 };
        const h = await hubWorkspaceFixture(owned.resources, host, undefined, async (request, namespace) => {
            if (!new URL(request.url).pathname.startsWith('/api/artifacts')) return;
            const app = new Hono<WebAppEnv>(); app.use('*', async (c, next) => { c.set('namespace', namespace); await next(); });
            app.route('/api', createArtifactRoutes(service));
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
        });
        const home = h.home;
        await writeFile(join(home, 'config.yaml'), `mode: hub\nhub:\n  url: ${h.url}\n`);
        atomicWrite(hubConnectionPaths(home, h.url).identityConnection, JSON.stringify({ schemaVersion: 1, hub: h.url, ownerId: h.owner.identity.id, spaceId: h.space, token: h.owner.token, requestId: randomUUID(), createdAt: Date.now() }));
        const config = loadConfig(home, {});
        const server = createMcpServer({ client: host, cwd, config: () => config, hub: () => ({ url: h.url, home, env: {} }) }), client = new Client({ name: 'file-test', version: '1' });
        owned.resources.push(() => server.close(), () => client.close());
        const [left, right] = InMemoryTransport.createLinkedPair(); await server.connect(left); await client.connect(right);
        const call = async (name: string, args: Record<string, unknown>, callId = crypto.randomUUID(), signal?: AbortSignal) => {
            if (host === 'claude') recordClaudeCall(config, { hook_event_name: 'PreToolUse', tool_name: `mcp__runweft__${name}`, tool_use_id: callId, session_id: 'parent', cwd });
            const result = await client.callTool({ name, arguments: args, _meta: host === 'codex' ? { threadId: 'parent', sessionId: 'parent', callId } : { 'claudecode/toolUseId': callId } }, undefined, { signal });
            expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(result.structuredContent) }]);
            return result.structuredContent as Record<string, any>;
        };
        return { cwd, outside, client, faults, call };
    } catch (error) { return owned.failed(error); }
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
