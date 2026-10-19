import { tmpdir } from 'node:os';
import { compiledCli } from './compiled-cli';
import { atomicWrite } from '../../src/config';
import { hubConnectionPaths } from '../../src/hub/resources/connection';
import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Hono } from '../../hapi/hub/node_modules/hono';
import { SignJWT } from 'jose';
import { ARTIFACT_DEFAULT_LIMITS } from '../../hapi/shared/src/artifacts';
import { Store } from '../../hapi/hub/src/store';
import { ArtifactService } from '../../hapi/hub/src/artifacts/service';
import { createArtifactRoutes } from '../../hapi/hub/src/web/routes/artifacts';
import { createAuthMiddleware, type WebAppEnv } from '../../hapi/hub/src/web/middleware/auth';
import { ArtifactClient } from '../../src/artifacts/client';
import { HapiClient } from '../../src/hapi';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });
async function fixture() {
    const base = tmpdir(); await mkdir(base, { recursive: true });
    const root = await mkdtemp(join(base, 'artifact-client-')), home = join(root, 'home');
    await mkdir(home);
    const store = new Store(join(root, 'hapi.db'));
    const service = new ArtifactService(store.artifacts, join(root, 'artifacts'), { ...ARTIFACT_DEFAULT_LIMITS, maxFileBytes: 1024 * 1024 });
    const secret = new TextEncoder().encode('artifact-client-test-signing-only');
    const owner = randomUUID(), space = randomUUID(), identityToken = 'rw_cli_' + 'a'.repeat(43);
    const token = await new SignJWT({ uid: 1, ns: 'default', kind: 'user', sub: owner, space }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(secret);
    const app = new Hono<WebAppEnv>();
    app.get('/api/runweft/health', c => c.json({ service: 'runweft', capabilities: { hubAccess: 1 } }));
    app.get('/api/runweft/hub/identity', c => c.json({ identity: { id: owner, name: 'fixture', createdAt: 1 } }));
    app.post('/api/auth', async c => ['test-access', identityToken].includes((await c.req.json()).accessToken) ? c.json({ token }) : c.json({ error: 'Invalid token' }, 401));
    app.use('/api/*', createAuthMiddleware(secret)); app.route('/api', createArtifactRoutes(service));
    let loseUploadResponse = false, uploads = 0;
    const server = Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(request) {
        const response = await app.fetch(request);
        if (request.method === 'PUT' && request.url.endsWith('/content')) {
            uploads++;
            if (loseUploadResponse) { loseUploadResponse = false; return new Response('proxy response lost', { status: 502 }); }
        }
        return response;
    } });
    const url = `http://127.0.0.1:${server.port}`;
    await writeFile(join(home, 'config.yaml'), `mode: hub\nhub:\n  url: ${url}\n`);
    atomicWrite(hubConnectionPaths(home, url).identityConnection, JSON.stringify({ schemaVersion: 2, hub: url, ownerId: owner, spaceId: space, token: identityToken, requestId: randomUUID(), createdAt: Date.now() }));
    const env: NodeJS.ProcessEnv = { ...process.env, ARTIFACT_TEST_TOKEN: 'test-access' };
    for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_')) delete env[key];
    const binary = await compiledCli();
    async function cli(args: string[], code = 0) {
        const process = Bun.spawn([binary, '--home', home, '--json', 'artifact', ...args], { env, stdout: 'pipe', stderr: 'pipe' });
        const [status, stdout, stderr] = await Promise.all([process.exited, new Response(process.stdout).text(), new Response(process.stderr).text()]);
        expect(status).toBe(code); expect(stdout + stderr).not.toContain('test-access');
        return { value: stdout.trim() ? JSON.parse(stdout) : null, stderr };
    }
    cleanup.push(async () => { await server.stop(true); store.close(); await rm(root, { recursive: true, force: true }); });
    return { root, home, service, cli, client: new ArtifactClient(new HapiClient(url, 'test-access')),
        loseResponse: () => { loseUploadResponse = true; }, uploads: () => uploads };
}
describe('artifact client and CLI', () => {
    test('publishes, queries and downloads through HTTP; protects existing files and references', async () => {
        const { root, cli, service } = await fixture();
        const source = join(root, '需求 brief.txt'), target = join(root, 'download.txt'), requestId = randomUUID();
        await writeFile(source, '原始材料\0binary');
        const uploaded = (await cli(['upload', source, '--request-id', requestId])).value;
        expect(uploaded.state).toBe('available'); expect(uploaded.filename).toBe('需求 brief.txt');
        expect((await cli(['lookup', requestId])).value.id).toBe(uploaded.id);
        expect((await cli(['upload', source, '--request-id', requestId])).value.id).toBe(uploaded.id);
        expect((await cli(['list'])).value.artifacts).toHaveLength(1);
        expect((await cli(['limits'])).value.usedBytes).toBe(uploaded.size);
        await cli(['download', uploaded.id, '--output', target]);
        expect(await readFile(target, 'utf8')).toBe('原始材料\0binary');
        await writeFile(target, 'keep');
        expect((await cli(['download', uploaded.id, '--output', target], 1)).stderr).toContain('artifact_destination_exists');
        expect(await readFile(target, 'utf8')).toBe('keep');
        await cli(['download', uploaded.id, '--output', target, '--overwrite']);
        expect(await readFile(target, 'utf8')).toBe('原始材料\0binary');
        service.store.pin('default', uploaded.id, { reference: 'round:test', purpose: 'input' });
        expect((await cli(['refs', uploaded.id])).value.references[0].reference).toBe('round:test');
        expect((await cli(['remove', uploaded.id], 1)).stderr).toContain('artifact_referenced');
        service.store.unpin('default', uploaded.id, 'round:test');
        expect((await cli(['remove', uploaded.id])).value.state).toBe('deleted');
        expect((await cli(['lookup', requestId])).value.state).toBe('deleted');
    }, 20_000);
    test('CLI prune defaults to preview, obeys Hub policy, and returns tombstones with honest usage', async () => {
        const { root, cli, client, service } = await fixture();
        const source = join(root, 'result.txt'); await writeFile(source, 'retained result');
        const unreferenced = await client.upload(source, randomUUID());
        const protectedFile = await client.upload(source, randomUUID());
        await client.pin(protectedFile.id, 'external:recovery', 'recovery');
        const db = new Database(join(root, 'hapi.db'));
        db.query('UPDATE artifacts SET published_at=?').run(Date.now() - 8 * 86400000); db.close();
        const preview = (await cli(['prune'])).value;
        expect(preview.applied).toBe(false); expect(preview.candidates.map((file: any) => file.id)).toEqual([unreferenced.id]);
        expect((await client.show(unreferenced.id)).state).toBe('available');
        expect((await cli(['limits'])).value.usage).toMatchObject({ referencedCount: 1, referencedBytes: protectedFile.size });
        const applied = (await cli(['prune', '--apply'])).value;
        expect(applied.deleted[0].state).toBe('deleted'); expect(applied.usedBytes).toBe(protectedFile.size);
        expect((await cli(['lookup', unreferenced.requestId])).value.state).toBe('deleted');
        expect((await cli(['prune', '--apply'])).value.deleted).toEqual([]);
        expect((await cli(['prune', '--limit', '0'], 1)).stderr).toContain('invalid_artifact_request');
        expect(service.store.references('default', protectedFile.id)).toHaveLength(1);
    });
    test('does not replay a published upload when its response fails; same ID recovers the original file', async () => {
        const { root, client, loseResponse, uploads } = await fixture();
        const source = join(root, 'report.txt'), requestId = randomUUID(); await writeFile(source, 'captured bytes');
        loseResponse();
        await expect(client.upload(source, requestId)).rejects.toMatchObject({ status: 502 });
        expect(uploads()).toBe(1);
        const recorded = await client.lookup(requestId); expect(recorded.state).toBe('available');
        expect((await client.upload(source, requestId)).id).toBe(recorded.id); expect(uploads()).toBe(1);
        await writeFile(source, 'changed');
        await expect(client.upload(source, requestId)).rejects.toMatchObject({ code: 'artifact_request_conflict' });
        expect(uploads()).toBe(1);
    });
});
