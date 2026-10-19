import { saveTestConnection, fixtureCredential } from '../identity-fixture';
import assert from 'node:assert/strict';
import { Database } from 'bun:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { HubClient } from '../../src/hub/client';
import { removeFileSmokeData } from './native-files';
import { closeSmoke } from '../lifecycle';
import { freePort } from '../../src/services';
import type { Artifact } from '../../hapi/shared/src/artifacts';
import { afterEach, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { rmSync as removeRoot } from 'node:fs';
import { integrationBinaries } from './binaries';

let closeOwned: () => Promise<void> = async () => {};
afterEach(() => closeOwned());

test('files-prune real integration', async () => {
    integrationBinaries();
    const binary = integrationBinaries().runweft.path, hapiBinary = integrationBinaries().hapi.path;
    const root = await mkdtemp(join(tmpdir(), 'runweft-artifact-prune-')), home = join(root, 'local'), remote = join(root, 'hub-client');
    const evidence = { root, binary, startedAt: new Date().toISOString(), finishedAt: '', success: false, checks: [] as string[], cleanupErrors: [] as string[], error: '' };
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_')) delete env[key];
    let remoteUrl = ''; let token = '', url = '', identityFile = '', spaceId = ''; const secrets: string[] = [];
    let proxy: ReturnType<typeof Bun.serve> | undefined;
    async function cli(selectedHome: string, args: string[], expected = 0) {
        if (args[0] === 'artifact') await saveTestConnection(selectedHome, selectedHome === home ? url : remoteUrl, fixtureCredential(identityFile).token, spaceId);
        const child = Bun.spawn([binary, '--home', selectedHome, '--json', ...(args[0] === 'artifact' ? ['hub', '--url', selectedHome === home ? url : remoteUrl, '--space', spaceId] : []), ...args], { env, stdout: 'pipe', stderr: 'pipe' });
        const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        for (const secret of secrets) assert(!`${stdout}${stderr}`.includes(secret), 'Credential leaked');
        assert.equal(code, expected, `${args.slice(0, 2).join(' ')}: ${stderr}`);
        return { value: stdout.trim() ? JSON.parse(stdout) : null, stderr };
    }
    const record = (value: string) => { evidence.checks.push(value); console.log(value); };

    let closing: Promise<void> | undefined;
    closeOwned = () => closing ??= (async () => {
        let serviceStopped = false;
        try {
            await closeSmoke([
                async () => { assert(serviceStopped, 'Service still running; secrets retained');
                    await closeSmoke([identityFile, join(root, 'other-identity.txt'), join(home, 'server/hapi/settings.json'), join(home, 'server/hapi/jwt-secret.json')]
                        .filter(Boolean).map(file => () => rm(file, { force: true }))); },
                async () => { await cli(home, ['stop']); const status = (await cli(home, ['status'])).value;
                    assert.equal(status.service.running, false); assert.equal(status.runner.running, false); serviceStopped = true; },
                async () => { await proxy?.stop(true); },
            ]);
            if (evidence.success) await removeFileSmokeData(root);
        } catch (error) { evidence.cleanupErrors.push(...(error instanceof AggregateError ? error.errors.map(String) : [String(error)])); }
        if (evidence.cleanupErrors.length) { evidence.success = false;  }
        evidence.finishedAt = new Date().toISOString(); await writeFile(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
        console.log(`Evidence: ${join(root, 'evidence.json')}`); if (evidence.error) console.error(evidence.error);

        if (evidence.cleanupErrors?.length) throw new AggregateError(evidence.cleanupErrors, 'Integration cleanup failed');
        if (evidence.success) removeRoot(root, { recursive: true, force: true });
    })();
    try {
        const port = await freePort(); url = `http://127.0.0.1:${port}`;
        await cli(home, ['init']); await cli(home, ['config', 'set', 'server.port', String(port)]);
        await cli(home, ['config', 'set', 'hapi.executable', hapiBinary]); await cli(home, ['config', 'set', 'server.runner', 'false']);
        await cli(home, ['config', 'set', 'server.artifacts.unreferencedDays', '1']);
        await cli(home, ['config', 'set', 'server.artifacts.pendingHours', '1']); await cli(home, ['start']);
        const paths = (await cli(home, ['paths'])).value;
        const user = await (await fetch(url + '/api/runweft/hub/accounts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'fixture-'+crypto.randomUUID().slice(0,12), password: 'a synthetic integration passphrase' }) })).json();
        token = user.token; secrets.push(token); spaceId = user.personalSpace.id; identityFile = join(root, 'identity.txt'); await writeFile(identityFile, token, { mode: 0o600 });
        const hapi = new HubClient({ url, credential: fixtureCredential(identityFile), space: spaceId }, 'hubAccess', 'hub_access_unavailable').http;
        let losePruneResponse = false;
        proxy = Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(request) {
            const input = new URL(request.url);
            const response = await fetch(new Request(`${url}${input.pathname}${input.search}`, request));
            if (losePruneResponse && input.pathname === '/api/artifacts/prune' && request.method === 'POST') {
                losePruneResponse = false; await response.arrayBuffer();
                return new Response('Injected lost cleanup response', { status: 502 });
            }
            const headers = new Headers(response.headers);
            // fetch already decodes compressed upstream responses; do not describe decoded bytes as gzip.
            headers.delete('content-encoding'); headers.delete('content-length');
            return new Response(response.body, { status: response.status, headers });
        } });
        remoteUrl = `http://127.0.0.1:${proxy.port}`;
        await cli(remote, ['init']); await cli(remote, ['config', 'set', 'server.artifacts.unreferencedDays', '99']);
        const source = join(root, 'report.txt'); await writeFile(source, 'retained file bytes');
        const pinned: Artifact[] = [], expiring: Artifact[] = [];
        for (const purpose of ['input', 'output', 'recovery', 'external', null, null]) {
            const file = (await cli(home, ['artifact', 'upload', source])).value as Artifact;
            if (purpose) {
                const reference = `smoke:${purpose}`;
                await hapi.request(`/api/artifacts/${file.id}/references/${reference}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reference, purpose }) });
                pinned.push(file);
            } else expiring.push(file);
        }
        const pending = (await hapi.request('/api/artifacts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
            requestId: randomUUID(), filename: 'pending.txt', size: 7, sha256: createHash('sha256').update('pending').digest('hex'),
        }) })).artifact as Artifact;
        expiring.push(pending);
        await cli(home, ['stop']);
        // Test data only: age isolated objects while their owning service is stopped.
        const db = new Database(join(paths.hapiServer, 'hapi.db'));
        db.query('UPDATE artifacts SET created_at=?,published_at=CASE WHEN published_at IS NULL THEN NULL ELSE ? END')
            .run(Date.now() - 2 * 86400000, Date.now() - 2 * 86400000); db.close();
        await cli(home, ['start']);
        const recent = (await cli(home, ['artifact', 'upload', source])).value as Artifact;
        const preview = (await cli(home, ['artifact', 'prune'])).value;
        assert.equal(preview.applied, false); assert.deepEqual(preview.candidates.map((file: Artifact) => file.id).sort(), expiring.map(file => file.id).sort());
        assert.equal(preview.deleted.length, 0);
        assert.deepEqual((await cli(remote, ['artifact', 'prune'])).value.candidates, preview.candidates);
        const limits = (await cli(remote, ['artifact', 'limits'])).value;
        assert.equal(limits.limits.unreferencedDays, 1); assert.equal(limits.usage.referencedCount, 4);
        assert.equal(limits.usage.referencedBytes, pinned.reduce((sum, file) => sum + file.size, 0));
        const currentPaths = (await cli(home, ['paths'])).value;
        assert.equal(currentPaths.artifacts, paths.artifacts); assert.equal(currentPaths.hapiServer, paths.hapiServer);
        record('compiled local/Hub preview agrees after real service restart; server policy, current paths and file usage are authoritative');
        losePruneResponse = true;
        assert((await cli(remote, ['artifact', 'prune', '--apply', '--limit', '1'], 1)).stderr.includes('502'));
        const first = [...expiring].sort((left, right) => left.id.localeCompare(right.id))[0]!;
        assert.equal((await cli(home, ['artifact', 'lookup', first.requestId])).value.state, 'deleted');
        record('real HTTP proxy loses cleanup response after deletion; original request lookup confirms the tombstone');
        let cursor: string | null | undefined;
        do {
            const result = (await cli(remote, ['artifact', 'prune', '--apply', '--limit', '1', ...(cursor ? ['--after', cursor] : [])])).value;
            assert.equal(result.failures.length, 0); cursor = result.nextCursor;
        } while (cursor);
        for (const file of expiring) assert.equal((await cli(home, ['artifact', 'show', file.id])).value.state, 'deleted');
        for (const file of pinned) {
            assert.equal((await cli(home, ['artifact', 'show', file.id])).value.state, 'available');
            assert.equal((await cli(home, ['artifact', 'refs', file.id])).value.references.length, 1);
        }
        assert.equal((await cli(home, ['artifact', 'show', recent.id])).value.state, 'available');
        const final = (await cli(home, ['artifact', 'limits'])).value;
        assert.equal(final.usedBytes, pinned.reduce((sum, file) => sum + file.size, recent.size));
        await cli(home, ['restart']);
        assert.equal((await cli(remote, ['artifact', 'prune', '--apply'])).value.deleted.length, 0);
        const download = join(root, 'protected-download.txt');
        await cli(remote, ['artifact', 'download', pinned[0]!.id, '--output', download]);
        assert.equal(await readFile(download, 'utf8'), 'retained file bytes');
        const otherUser = await (await fetch(url + '/api/runweft/hub/accounts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'fixture-'+crypto.randomUUID().slice(0,12), password: 'a synthetic integration passphrase' }) })).json();
        secrets.push(otherUser.token); const otherFile = join(root, 'other-identity.txt'); await writeFile(otherFile, otherUser.token, { mode: 0o600 });
        const other = new HubClient({ url, credential: fixtureCredential(otherFile), space: otherUser.personalSpace.id }, 'hubAccess', 'hub_access_unavailable').http;
        assert.equal((await other.request('/api/artifacts/prune', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).candidates.length, 0);
        assert.equal((await hapi.request('/api/sessions')).sessions.length, 0);
        record('apply pagination frees quota, preserves input/output/recovery/external pins and recent files; tombstones survive restart; zero agents');
        Object.assign(evidence, { candidate: { entry: 'compiled', cliSha256: createHash('sha256').update(await readFile(binary)).digest('hex'), hapiSha256: createHash('sha256').update(await readFile(hapiBinary)).digest('hex') } });
        evidence.success = true;
    } catch (error) { evidence.error = error instanceof Error ? error.message : String(error); throw error; }
    finally { await closeOwned(); }
}, 120000);
