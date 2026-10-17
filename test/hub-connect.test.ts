import { compiledCli } from './compiled-cli';
import { fixtureCleanup } from './fixture-cleanup';
import { loadConfig } from '../src/config';
import { afterEach, beforeAll, expect, test } from 'bun:test';
import { constants, createPublicKey, publicEncrypt, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWrite } from '../src/config';
import { HubClient } from '../src/hub/client';
import { IdentityConnection } from '../src/hub/connect/client';
import { connectionOrigin } from '../src/hub/connect/types';
import { MachineConnection } from '../src/hub/resources/connection';
import { HubResourceClient } from '../src/hub/resources/client';
import { hubResourceFixture } from './hub-resources-fixture';

const cleanupOwner = fixtureCleanup([]), cleanups = cleanupOwner.resources;
afterEach(() => cleanupOwner.close());
let executable: string;
beforeAll(async () => { executable = await compiledCli(); }, 30_000);
type Hub = Awaited<ReturnType<typeof hubResourceFixture>>;
const pending = (c: IdentityConnection) => JSON.parse(readFileSync(c.paths.pendingConnection, 'utf8'));
const identity = (c: IdentityConnection) => JSON.parse(readFileSync(c.paths.identityConnection, 'utf8'));
function encrypt(publicKey: string, token: string) {
    const key = createPublicKey({ key: Buffer.from(publicKey, 'base64url'), format: 'der', type: 'spki' });
    return publicEncrypt({ key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(token)).toString('base64url');
}
async function confirm(h: Hub, c: IdentityConnection, user = h.a, spaceId = user.personalSpace.id, plaintext = user.token) {
    const request = pending(c), ciphertext = encrypt(request.publicKey, plaintext);
    const result = await h.request(`/api/runweft/connect/${request.requestId}/confirm`, user.token, 'POST', { spaceId, ciphertext });
    expect(result.status).toBe(200); return ciphertext;
}
async function cli(home: string, url: string, args: string[]) {
    const env = { ...process.env }; delete env.RUNWEFT_IDENTITY_TOKEN;
    const child = Bun.spawn([executable, '--home', home, '--json', 'hub', '--url', url, ...args], { env, stdout: 'pipe', stderr: 'pipe' });
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    return { exit, stdout, stderr, result: stdout.trim() ? JSON.parse(stdout) : undefined, error: stderr.trim() ? JSON.parse(stderr).error : undefined };
}

test('compiled CLI begins once, confirms encrypted identity and space, saves 0600 files and uses connection without printing credentials', async () => {
    const h = await hubResourceFixture(cleanups), home = join(h.home, 'client'), c = new IdentityConnection(home, h.url);
    const [a, b] = await Promise.all([cli(home, h.url, ['connect', 'begin', '--name', 'my agent']), cli(home, h.url, ['connect', 'begin', '--name', 'my agent'])]);
    expect(a.exit).toBe(0); expect(b.exit).toBe(0); expect(a.result).toEqual(b.result);
    const request = pending(c);
    expect(a.result.confirmationUrl).toBe(`${h.url}/hub#connect=${request.requestId}`);
    expect((await cli(home, h.url, ['connect', 'complete'])).result.status).toBe('pending');
    const ciphertext = await confirm(h, c);
    const stored = h.access.db.query('SELECT * FROM hub_connection_requests').get() as any;
    expect(stored.ciphertext).toBe(ciphertext); expect(stored.pollingDigest).not.toBe(request.secret);
    for (const secret of [request.secret, request.privateKey, h.a.token]) expect(JSON.stringify(stored)).not.toContain(secret);
    const [done, concurrent] = await Promise.all([cli(home, h.url, ['connect', 'complete']), cli(home, h.url, ['connect', 'complete'])]);
    expect(done.exit).toBe(0); expect(concurrent.exit).toBe(0);
    expect(done.result.status).toBe('connected'); expect(done.result.ownerId).toBe(h.a.identity.id); expect(done.result.spaceId).toBe(h.a.personalSpace.id);
    expect(identity(c).token).toBe(h.a.token); expect(statSync(c.paths.identityConnection).mode & 0o777).toBe(0o600);
    expect(existsSync(c.paths.pendingConnection)).toBe(false);
    expect((await cli(home, h.url, ['connect', 'complete'])).result.status).toBe('connected');
    const status = await cli(home, h.url, ['connect', 'status']); expect(status.result.connected).toBe(true);
    expect((await cli(home, h.url, ['identity'])).result.identity.id).toBe(h.a.identity.id);
    expect((await cli(home, h.url, ['machine', 'list'])).exit).toBe(0);
    expect((await cli(home, h.url, ['paths'])).result.identityConnection).toBe(c.paths.identityConnection);
    for (const result of [a, b, done, concurrent, status]) for (const secret of [h.a.token, request.secret, request.privateKey, ciphertext]) {
        expect(result.stdout + result.stderr).not.toContain(secret);
    }
    const poll = await h.request(`/api/runweft/connect/${request.requestId}/poll`, request.secret, 'POST');
    expect(poll.body.status).toBe('consumed'); expect(poll.body.ciphertext).toBeUndefined();
    expect((h.access.db.query('SELECT ciphertext FROM hub_connection_requests').get() as any).ciphertext).toBeNull();
    expect(loadConfig(home, {}).config.hub.url).toBe(h.url);
    expect(loadConfig(home, {}).config.mode).toBe('local');
    expect(readFileSync(join(home, 'config.yaml'), 'utf8')).not.toContain(h.a.token);
    const restored = new HubClient({ url: h.url, home, env: {} }, 'hubAccess', 'unavailable');
    expect(await restored.connection()).toEqual({ hub: h.url, ownerId: h.a.identity.id, spaceId: h.a.personalSpace.id });
    const explicit = new HubClient({ url: h.url, home, env: { RUNWEFT_IDENTITY_TOKEN: h.c.token } }, 'hubAccess', 'unavailable');
    expect(explicit.spaceId).toBeNull(); expect((await explicit.identity()).id).toBe(h.c.identity.id);
    expect(() => new HubClient({ url: 'https://different.invalid', home, env: {} }, 'hubAccess', 'unavailable')).toThrow('尚未连接');
}, 20_000);

test('lost acknowledgement is retried from the saved identity; later identity changes cannot be overwritten by a stale response', async () => {
    const h = await hubResourceFixture(cleanups), c = new IdentityConnection(join(h.home, 'client'), h.url);
    await c.begin(); const original = pending(c); await confirm(h, c);
    const originalFetch = globalThis.fetch;
    let dropped = false;
    globalThis.fetch = (async (input: any, init: any) => {
        const result = await originalFetch(input, init);
        if (String(input).endsWith('/acknowledge') && !dropped) { dropped = true; throw new Error('lost ack'); }
        return result;
    }) as typeof fetch;
    try { await expect(c.complete()).rejects.toMatchObject({ code: 'connection_failed' }); }
    finally { globalThis.fetch = originalFetch; }
    expect(identity(c).requestId).toBe(original.requestId); expect(pending(c).requestId).toBe(original.requestId);
    expect((await new IdentityConnection(c.paths.home, h.url).complete()).status).toBe('connected');
    expect(existsSync(c.paths.pendingConnection)).toBe(false);
    await c.begin(); await confirm(h, c);
    const replaced = { ...identity(c), requestId: randomUUID(), token: h.c.token, ownerId: h.c.identity.id, spaceId: h.c.personalSpace.id };
    atomicWrite(c.paths.identityConnection, JSON.stringify(replaced));
    await expect(c.complete()).rejects.toMatchObject({ code: 'hub_connection_changed' });
    expect(identity(c)).toEqual(replaced);
    await c.cancel(); expect(identity(c)).toEqual(replaced);
});

test('server rejects secret-less polling, replacement confirmations, query secrets, expired requests and stale identity or membership', async () => {
    const h = await hubResourceFixture(cleanups), c = new IdentityConnection(join(h.home, 'client'), h.url);
    const begin = await c.begin(); const request = pending(c);
    expect(statSync(c.paths.pendingConnection).mode & 0o777).toBe(0o600);
    const show = await fetch(`${h.url}/api/runweft/connect/${begin.requestId}`);
    expect(show.headers.get('cache-control')).toBe('no-store');
    const metadata = await show.json() as any;
    expect(metadata.ciphertext).toBeUndefined(); expect(metadata.ownerId).toBeUndefined(); expect(metadata.pollingDigest).toBeUndefined();
    const path = `/api/runweft/connect/${begin.requestId}`;
    expect((await h.request(path + '/poll', begin.requestId, 'POST')).status).toBe(400);
    expect((await h.request(path + '/poll', `rw_cp_${randomBytes(32).toString('base64url')}`, 'POST')).status).toBe(404);
    expect((await h.request(path + '/poll?token=' + request.secret, '', 'POST')).status).toBe(400);
    const ciphertext = await confirm(h, c);
    expect((await h.request(path + '/confirm', h.a.token, 'POST', { spaceId: h.a.personalSpace.id, ciphertext })).status).toBe(200);
    expect((await h.request(path + '/confirm', h.b.token, 'POST', { spaceId: h.a.personalSpace.id, ciphertext })).status).toBe(409);
    h.hub.rotate(h.a.identity, h.a.token, `rw_id_${randomBytes(32).toString('base64url')}`);
    await expect(c.complete()).rejects.toMatchObject({ code: 'connection_authorization_changed' }); expect(existsSync(c.paths.identityConnection)).toBe(false);
    await c.cancel();
    await c.begin(); await confirm(h, c, h.b, h.a.personalSpace.id);
    h.hub.changeMember(h.a.identity.id, h.a.personalSpace.id, h.b.identity.id, null);
    await expect(c.complete()).rejects.toMatchObject({ code: 'connection_authorization_changed' });
    await c.cancel();
    const expires = await c.begin();
    h.access.db.query('UPDATE hub_connection_requests SET expiresAt=? WHERE id=?').run(Date.now() - 1, expires.requestId);
    await expect(c.complete()).rejects.toMatchObject({ code: 'connection_request_expired' });
    await c.cancel(); expect(existsSync(c.paths.pendingConnection)).toBe(false);
    expect((await h.request(`/api/runweft/connect/${expires.requestId}`, '')).status).toBe(410);
});

test('ciphertext must decrypt to the confirmed identity; existing machine ownership and origin remain independent', async () => {
    const h = await hubResourceFixture(cleanups), c = new IdentityConnection(join(h.home, 'client'), h.url);
    await c.begin(); await confirm(h, c, h.a, h.a.personalSpace.id, h.b.token);
    await expect(c.complete()).rejects.toMatchObject({ code: 'hub_connection_response_invalid' });
    expect(existsSync(c.paths.identityConnection)).toBe(false); await c.cancel();
    await c.begin(); const p = pending(c);
    expect((await h.request(`/api/runweft/connect/${p.requestId}/confirm`, h.a.token, 'POST', { spaceId: h.a.personalSpace.id, ciphertext: randomBytes(256).toString('base64url') })).status).toBe(200);
    await expect(c.complete()).rejects.toMatchObject({ code: 'hub_connect_decryption_failed' }); await c.cancel();
    const machine = new MachineConnection(c.paths.home, new HubResourceClient({ url: h.url, env: { RUNWEFT_IDENTITY_TOKEN: h.a.token } }));
    await machine.enroll(); const machineText = readFileSync(c.paths.machineConnection, 'utf8');
    await c.begin(); await confirm(h, c, h.b);
    await expect(c.complete()).rejects.toMatchObject({ code: 'machine_connection_owner_mismatch' });
    expect(readFileSync(c.paths.machineConnection, 'utf8')).toBe(machineText); expect(existsSync(c.paths.identityConnection)).toBe(false);
    await c.cancel(); await c.begin(); await confirm(h, c); expect((await c.complete()).status).toBe('connected');
    const saved = identity(c); saved.hub = 'https://another.invalid'; writeFileSync(c.paths.identityConnection, JSON.stringify(saved));
    expect(() => new HubClient({ url: h.url, home: c.paths.home, env: {} }, 'hubAccess', 'unavailable')).toThrow('身份连接记录无效');
});

test('secure origin validation accepts normalized loopback and HTTPS only', () => {
    for (const url of ['http://localhost:8000', 'http://127.0.0.1:8000', 'http://127.0.0.2', 'http://[::1]:8000', 'https://hub.example']) expect(connectionOrigin.safeParse(url).success).toBe(true);
    for (const url of ['http://127.evil.example', 'http://192.168.0.1', 'http://hub.example', 'https://hub.example/path', 'https://user:secret@hub.example']) expect(connectionOrigin.safeParse(url).success).toBe(false);
});
