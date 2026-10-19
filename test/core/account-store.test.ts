import { afterEach, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { decodeJwt } from 'jose';
import { HubStore } from '../../src/hub/store';
import { AccessStore } from '../../src/hub/access/store';
import { AccessAuthority } from '../../src/hub/access/auth';
import { fixture } from '../helpers';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
function setup() {
    const home = fixture('account-store'), path = join(home,'state.sqlite');
    const hub = new HubStore(path), access = new AccessStore(path), authority = new AccessAuthority(access,randomBytes(32));
    cleanups.push(() => { access.close(); hub.close(); rmSync(home,{recursive:true,force:true}); });
    return { hub, access, authority, accounts: hub.accounts };
}
const password = 'an isolated account passphrase';

test('account registration and password login share one stable identity and initial space', async () => {
    const {hub,accounts} = setup(), first = await accounts.register(' Alice ',password);
    await expect(accounts.register('alice',password)).rejects.toMatchObject({code:'account_username_taken'});
    const second = await accounts.login('ALICE',password);
    expect(second.identity.id).toBe(first.identity.id);
    expect(second.token).not.toBe(first.token);
    expect(hub.spaces(second.identity.id)).toEqual([first.personalSpace]);
    expect(hub.db.query('SELECT COUNT(*) AS count FROM hub_users').get()).toEqual({count:1});
    expect((hub.db.query('SELECT * FROM hub_accounts').get() as any).passwordHash).not.toContain(password);
    for(const name of ['missing','alice','??']) await expect(accounts.login(name,'a wrong account passphrase')).rejects.toMatchObject({code:'account_login_invalid'});
});

test('one environment logout revokes its JWT while other browser and CLI credentials remain valid', async () => {
    const {accounts,authority} = setup(), first = await accounts.register('alice',password), second = await accounts.login('alice',password);
    const cli = accounts.issue(first.identity.id,'cli','测试终端');
    const jwt = (await authority.exchange(first.token!,first.personalSpace.id)).token;
    accounts.revoke(first.identity.id,first.credential.id);
    await expect(authority.verify(jwt)).rejects.toMatchObject({status:401});
    expect(accounts.authenticate(second.token!).identity.id).toBe(first.identity.id);
    expect(accounts.authenticate(cli.token!).credential.kind).toBe('cli');
    expect(JSON.stringify(accounts.list(first.identity.id))).not.toContain(cli.token!);
    expect(JSON.stringify(accounts.list(first.identity.id))).not.toContain('tokenDigest');
});

test('changing password revokes all credentials but trusted background ownership survives until membership removal', async () => {
    const {hub,accounts,access} = setup(), owner = await accounts.register('owner',password), member = await accounts.register('member',password);
    const invite = hub.invite(owner.identity.id,owner.personalSpace.id,'member'); hub.acceptInvitation(member.identity.id,invite.token);
    const service = access.serviceUser(member.identity.id,owner.personalSpace.id), cli = accounts.issue(member.identity.id,'cli','已授权未保存');
    await accounts.changePassword(member.token!,password,'the changed account passphrase');
    expect(() => accounts.authenticate(member.token!)).toThrow();
    expect(() => accounts.authenticate(cli.token!)).toThrow();
    expect(access.refresh(service).ownerId).toBe(member.identity.id);
    expect(() => access.refresh({...service})).toThrow(); // An untrusted serialized copy is not an internal subject.
    expect((await accounts.login('member','the changed account passphrase')).identity.id).toBe(member.identity.id);
    hub.changeMember(owner.identity.id,owner.personalSpace.id,member.identity.id,null);
    expect(() => access.refresh(service)).toThrow();
});

test('browser idle and credential absolute expiry are checked on JWT use and JWT lifetime cannot exceed the credential', async () => {
    const {hub,accounts,authority} = setup(), first = await accounts.register('alice',password);
    hub.db.query('UPDATE hub_user_credentials SET expiresAt=? WHERE id=?').run(Date.now()+20_000,first.credential.id);
    const jwt = (await authority.exchange(first.token!,first.personalSpace.id)).token;
    expect(decodeJwt(jwt).exp!*1000).toBeLessThanOrEqual(Date.now()+20_000);
    hub.db.query('UPDATE hub_user_credentials SET lastUsedAt=? WHERE id=?').run(Date.now()-2*3_600_000,first.credential.id);
    await expect(authority.verify(jwt)).rejects.toMatchObject({status:401});
    expect(() => accounts.authenticate(first.token!)).toThrow();
});

test('reset codes replace the previous code, consume once and revoke every existing user environment', async () => {
    const {accounts} = setup(), first = await accounts.register('alice',password), cli = accounts.issue(first.identity.id,'cli','终端');
    const old = accounts.resetCode('alice'), current = accounts.resetCode('alice');
    await expect(accounts.recover('alice',old.code,'a recovered account passphrase')).rejects.toMatchObject({code:'password_reset_unavailable'});
    await accounts.recover('alice',current.code,'a recovered account passphrase');
    await expect(accounts.recover('alice',current.code,'another recovered passphrase')).rejects.toMatchObject({code:'password_reset_unavailable'});
    expect(() => accounts.authenticate(first.token!)).toThrow();
    expect(() => accounts.authenticate(cli.token!)).toThrow();
    expect((await accounts.login('alice','a recovered account passphrase')).identity.id).toBe(first.identity.id);
});
