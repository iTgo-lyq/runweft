import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Database } from 'bun:sqlite';
import { HubError, hubNotFound, hubUnauthorized, type Identity } from '../types';
import { accountUsername, hashAccountPassword, verifyAccountPassword } from './password';
import { activeUserCredential, createUserSecret, credentialLifetimeMs, publicUserCredential, userCredentialKind,
    type UserCredential, type UserCredentialKind } from './credentials';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
type Account = { userId: string; username: string; passwordHash: string; passwordChangedAt: number };
const badLogin = () => new HubError(401, 'account_login_invalid', '账号或密码不正确。');
const changed = () => new HubError(409, 'account_changed', '账号认证状态已改变，请重新登录。');

/** Shared account domain for browser and CLI. Secrets never appear in public projections. */
export class AccountStore {
    constructor(readonly db: Database) {}
    account(username: string) { return this.db.query('SELECT * FROM hub_accounts WHERE username=?').get(username) as Account | null; }
    private owner(userId: string) {
        const row = this.db.query('SELECT * FROM hub_accounts WHERE userId=?').get(userId) as Account | null;
        if (!row) throw hubUnauthorized(); return row;
    }
    private unchanged(account: Account) { if (this.owner(account.userId).passwordHash !== account.passwordHash) throw changed(); }
    issue(userId: string, kind: UserCredentialKind, label: string, tokenDigest?: string) {
        const secret = tokenDigest ? undefined : createUserSecret(kind), now = Date.now(), id = randomUUID();
        this.db.query(`INSERT INTO hub_user_credentials
            (id,userId,kind,tokenDigest,label,createdAt,lastUsedAt,expiresAt) VALUES (?,?,?,?,?,?,?,?)`)
            .run(id,userId,kind,tokenDigest ?? secret!.digest,label,now,now,now + credentialLifetimeMs[kind]);
        return { credential: publicUserCredential(this.credential(id)), ...(secret ? { token: secret.token } : {}) };
    }
    credential(id: string): UserCredential {
        const row = this.db.query('SELECT * FROM hub_user_credentials WHERE id=?').get(id) as UserCredential | null;
        if (!row || !activeUserCredential(row)) throw hubUnauthorized();
        if (Date.now() - row.lastUsedAt >= 30_000) {
            row.lastUsedAt = Date.now();
            this.db.query('UPDATE hub_user_credentials SET lastUsedAt=? WHERE id=?').run(row.lastUsedAt, row.id);
        }
        return row;
    }
    authenticate(token: string) {
        const kind = userCredentialKind(token);
        if (!kind) throw hubUnauthorized();
        const match = this.db.query('SELECT id FROM hub_user_credentials WHERE tokenDigest=? AND kind=?').get(digest(token),kind) as { id: string } | null;
        if (!match) throw hubUnauthorized();
        const credential = this.credential(match.id);
        const identity = this.db.query('SELECT id,name,createdAt FROM hub_users WHERE id=?').get(credential.userId) as Identity | null;
        if (!identity) throw hubUnauthorized();
        return { identity, credential };
    }
    /** Trusted prepared hash entry, shared by registration and isolated fixtures. */
    create(username: string, passwordHash: string, name = username) {
        return this.db.transaction(() => {
            if (this.account(username)) throw new HubError(409, 'account_username_taken', '这个用户名已被使用，请登录或选择其他用户名。');
            const now = Date.now(), identity: Identity = { id: randomUUID(), name, createdAt: now }, spaceId: string = randomUUID();
            this.db.query('INSERT INTO hub_users (id,name,createdAt) VALUES (?,?,?)').run(identity.id,name,now);
            this.db.query('INSERT INTO hub_accounts VALUES (?,?,?,?)').run(identity.id,username,passwordHash,now);
            const spaceName = name.slice(0,77) + '的空间';
            this.db.query('INSERT INTO hub_spaces VALUES (?,?,?)').run(spaceId,spaceName,now);
            this.db.query('INSERT INTO hub_memberships VALUES (?,?,?,?)').run(spaceId,identity.id,'owner',now);
            return { identity, personalSpace: { id: spaceId, name: spaceName, createdAt: now, role: 'owner' as const } };
        }).immediate();
    }
    async register(username: unknown, password: unknown) {
        const name = accountUsername(username), hash = await hashAccountPassword(password);
        return this.db.transaction(() => {
            const result = this.create(name,hash);
            return { ...result, ...this.issue(result.identity.id,'browser','浏览器'), username: name };
        }).immediate();
    }
    async verify(username: unknown, password: unknown): Promise<Account> {
        let name: string;
        try { name = accountUsername(username); } catch { name = ''; }
        const account = this.account(name);
        if (!await verifyAccountPassword(password,account?.passwordHash ?? null) || !account) throw badLogin();
        this.unchanged(account); return account;
    }
    async login(username: unknown, password: unknown) {
        const account = await this.verify(username,password);
        return this.db.transaction(() => {
            this.unchanged(account);
            const identity = this.db.query('SELECT id,name,createdAt FROM hub_users WHERE id=?').get(account.userId) as Identity;
            return { identity, username: account.username, ...this.issue(account.userId,'browser','浏览器') };
        }).immediate();
    }
    list(userId: string) {
        return (this.db.query('SELECT * FROM hub_user_credentials WHERE userId=? ORDER BY createdAt,id').all(userId) as UserCredential[])
            .map(row => ({ ...publicUserCredential(row), active: activeUserCredential(row) }));
    }
    revoke(userId: string, id: string) {
        const result = this.db.query('UPDATE hub_user_credentials SET revokedAt=COALESCE(revokedAt,?) WHERE userId=? AND id=?').run(Date.now(),userId,id);
        if (!result.changes) throw hubNotFound(); return { revoked: true };
    }
    revokeAll(userId: string) { this.db.query('UPDATE hub_user_credentials SET revokedAt=COALESCE(revokedAt,?) WHERE userId=?').run(Date.now(),userId); }
    async logoutAll(token: string, password: unknown) {
        const { identity } = this.authenticate(token), account = await this.verify(this.owner(identity.id).username,password);
        return this.db.transaction(() => { this.authenticate(token); this.unchanged(account); this.revokeAll(identity.id); return { revoked: true }; }).immediate();
    }
    async changePassword(token: string, previous: unknown, next: unknown) {
        const { identity } = this.authenticate(token), account = await this.verify(this.owner(identity.id).username,previous), hash = await hashAccountPassword(next);
        return this.db.transaction(() => {
            this.authenticate(token); this.unchanged(account);
            this.db.query('UPDATE hub_accounts SET passwordHash=?,passwordChangedAt=? WHERE userId=?').run(hash,Date.now(),identity.id);
            this.db.query('DELETE FROM hub_password_resets WHERE userId=?').run(identity.id);
            this.revokeAll(identity.id); return { changed: true };
        }).immediate();
    }
    resetCode(username: string) {
        const account = this.account(accountUsername(username)); if (!account) throw hubNotFound();
        const code = `rw_reset_${randomBytes(32).toString('base64url')}`, expiresAt = Date.now()+900_000;
        this.db.query(`INSERT INTO hub_password_resets VALUES (?,?,?,NULL)
            ON CONFLICT(userId) DO UPDATE SET tokenDigest=excluded.tokenDigest,expiresAt=excluded.expiresAt,consumedAt=NULL`)
            .run(account.userId,digest(code),expiresAt);
        return { code, expiresAt };
    }
    async recover(username: unknown, code: unknown, next: unknown) {
        const account = this.account(accountUsername(username));
        const check = () => {
            const row = this.db.query('SELECT tokenDigest,expiresAt,consumedAt FROM hub_password_resets WHERE userId=?').get(account?.userId ?? '') as
                { tokenDigest: string; expiresAt: number; consumedAt: number | null } | null;
            if (!account || typeof code !== 'string' || !row || row.tokenDigest !== digest(code) || row.consumedAt !== null || row.expiresAt <= Date.now()) {
                throw new HubError(410, 'password_reset_unavailable', '重置码无效、已过期或已使用，请联系 Hub 部署者。');
            }
        };
        check(); const hash = await hashAccountPassword(next);
        return this.db.transaction(() => {
            check();
            this.db.query('UPDATE hub_password_resets SET consumedAt=? WHERE userId=?').run(Date.now(),account!.userId);
            this.db.query('UPDATE hub_accounts SET passwordHash=?,passwordChangedAt=? WHERE userId=?').run(hash,Date.now(),account!.userId);
            this.revokeAll(account!.userId); return { changed: true };
        }).immediate();
    }
}
