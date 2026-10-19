import { afterEach, beforeAll, expect, test } from 'bun:test';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { IdentityConnection } from '../../src/hub/connect/client';
import { HubClient } from '../../src/hub/client';
import { compiledCli } from './compiled-cli';
import { fixtureCleanup } from '../fixture-cleanup';
import { hubResourceFixture } from './hub-resources-fixture';

const cleanup = fixtureCleanup([]);
afterEach(() => cleanup.close());
let binary: string;
beforeAll(async () => { binary = await compiledCli(); }, 30_000);

test('compiled space CLI manages membership and file invitations and repairs a removed default without moving existing contexts', async () => {
    const h = await hubResourceFixture(cleanup.resources);
    const aHome = join(h.home, 'a-cli'), bHome = join(h.home, 'b-cli');
    for (const [home, identity] of [[aHome, h.a], [bHome, h.c]] as const) {
        const connection = new IdentityConnection(home, h.url), begin = await connection.begin();
        expect((await h.request(`/api/runweft/connect/${begin.requestId}/confirm`, identity.token, 'POST', { spaceId: identity.personalSpace.id })).status).toBe(200);
        await connection.complete();
    }
    const env = { ...process.env }; delete env.RUNWEFT_IDENTITY_TOKEN;
    const cli = async (home: string, args: string[], ok = true) => {
        const child = Bun.spawn([binary, '--home', home, '--json', ...args], { env, stdout: 'pipe', stderr: 'pipe' });
        const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        expect(exit).toBe(ok ? 0 : 1);
        return { value: JSON.parse(ok ? stdout : stderr), text: stdout + stderr };
    };
    const record = (home: string) => JSON.parse(readFileSync(new IdentityConnection(home, h.url).paths.identityConnection, 'utf8'));
    const created = (await cli(aHome, ['space', 'create', 'CLI collaboration'])).value.space;
    expect(record(aHome).spaceId).toBe(h.a.personalSpace.id);
    expect((await cli(aHome, ['--space', created.id, 'hub', '--url', h.url, 'space', 'show'])).value.space.id).toBe(created.id);
    expect((await cli(aHome, ['--space', created.id, 'hub', '--url', h.url, '--space', h.a.personalSpace.id, 'space', 'show'])).value.space.id).toBe(h.a.personalSpace.id);
    const crossSpaceFile = join(h.home, 'root-space.txt');
    const rootSpaceInvite = (await cli(aHome, ['--space', created.id, 'hub', '--url', h.url, 'space', 'invitation', 'create', '--output', crossSpaceFile])).value.invitation;
    expect(rootSpaceInvite.spaceId).toBe(created.id); expect(record(aHome).spaceId).toBe(h.a.personalSpace.id);
    await cli(aHome, ['--space', created.id, 'hub', '--url', h.url, 'space', 'invitation', 'revoke', rootSpaceInvite.id]);
    await cli(aHome, ['space', 'rename', created.id, 'Shared team']);
    await cli(aHome, ['space', 'use', created.id]);
    expect(record(aHome).spaceId).toBe(created.id);
    const fixed = new HubClient({ url: h.url, home: aHome }, 'hubIdentity', 'unavailable');
    const invitation = join(h.home, 'invite.txt');
    const receipt = await cli(aHome, ['space', 'invitation', 'create', '--output', invitation]);
    const secret = readFileSync(invitation, 'utf8').trim();
    expect(statSync(invitation).mode & 0o777).toBe(0o600); expect(receipt.text).not.toContain(secret);
    const count = h.hub.invitations(h.a.identity.id, created.id).length;
    await cli(aHome, ['space', 'invitation', 'create', '--output', invitation], false);
    expect(h.hub.invitations(h.a.identity.id, created.id)).toHaveLength(count);
    await cli(bHome, ['space', 'invitation', 'accept', '--file', invitation]);
    await cli(bHome, ['space', 'invitation', 'accept', '--file', invitation]); // Idempotent receipt recovery.
    expect(record(bHome).spaceId).toBe(h.c.personalSpace.id);
    await cli(bHome, ['space', 'use', created.id]);
    expect((await cli(bHome, ['space', 'show'])).value.space.name).toBe('Shared team');
    expect((await cli(bHome, ['space', 'rename', created.id, 'forbidden'], false)).value.error.code).toBe('space_action_forbidden');
    expect((await cli(aHome, ['space', 'leave'], false)).value.error.code).toBe('last_space_owner');
    await cli(aHome, ['space', 'member', 'set-role', h.c.identity.id, 'admin']);
    expect((await cli(aHome, ['space', 'member', 'list'])).value.members.find((x: any) => x.userId === h.c.identity.id).role).toBe('admin');
    expect((await cli(aHome, ['space', 'permissions'])).value.permissions).toBeDefined();
    const pending = join(h.home, 'revoked-invite.txt');
    const revocable = (await cli(aHome, ['space', 'invitation', 'create', '--output', pending])).value.invitation;
    await cli(aHome, ['space', 'invitation', 'revoke', revocable.id]);
    expect((await cli(aHome, ['space', 'invitation', 'list'])).value.invitations).toHaveLength(0);
    await cli(aHome, ['space', 'member', 'remove', h.c.identity.id]);
    expect(record(bHome).spaceId).toBe(created.id); // Removal does not rewrite the local default.
    expect((await cli(bHome, ['space', 'list'])).value.spaces.map((x: any) => x.id)).not.toContain(created.id);
    await cli(bHome, ['space', 'use', h.c.personalSpace.id]);
    await cli(aHome, ['--space', h.a.personalSpace.id, 'space', 'show']);
    expect(record(aHome).spaceId).toBe(created.id);
    await cli(aHome, ['space', 'use', h.a.personalSpace.id]);
    expect(fixed.spaceId).toBe(created.id); // Previously constructed consumers retain their space.
    expect(record(aHome).spaceId).toBe(h.a.personalSpace.id);
    expect(existsSync(new IdentityConnection(aHome, h.url).paths.machineConnection)).toBe(false);
    expect((await cli(aHome, ['hub', '--url', h.url, 'space', 'list'])).value.spaces).toHaveLength(2);
}, 30_000);
