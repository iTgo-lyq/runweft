import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { AccountStore } from './accounts/store';
import { openState } from '../state';
import { canAssign, HubError, hubForbidden, hubNotFound, hubUnauthorized, InvitationToken,
    type Identity, type Invitation, type Member, type Role, type Space } from './types';

const identityColumns = 'id, name, createdAt';
const invitationColumns = 'id, spaceId, createdBy, role, createdAt, expiresAt';
export const tokenDigest = (token: string) => createHash('sha256').update(token).digest('hex');
type InvitationRow = Invitation & { consumedBy: string | null; consumedAt: number | null; revokedAt: number | null };

/** Runweft identity and membership only; native execution and history remain in HAPI. */
export class HubStore {
    readonly db;
    readonly accounts: AccountStore;
    constructor(path: string) { this.db = openState(path); this.accounts = new AccountStore(this.db); }
    close() { this.db.close(); }

    authenticate(token: string): Identity {
        return this.accounts.authenticate(token).identity;
    }
    /** Revalidate the credential within the same snapshot/lock as the operation. */
    authorized<T>(token: string, write: boolean, action: (identity: Identity) => T): T {
        const operation = this.db.transaction(() => action(this.authenticate(token)));
        return write ? operation.immediate() : operation.deferred();
    }
    renameIdentity(userId: string, name: string): Identity {
        this.db.query('UPDATE hub_users SET name=? WHERE id=?').run(name, userId);
        return this.db.query(`SELECT ${identityColumns} FROM hub_users WHERE id=?`).get(userId) as Identity;
    }
    spaces(userId: string): Space[] {
        return this.db.query(`SELECT s.id, s.name, s.createdAt, m.role FROM hub_spaces s
            JOIN hub_memberships m ON m.spaceId=s.id WHERE m.userId=? ORDER BY s.createdAt, s.id`).all(userId) as Space[];
    }
    permissions(userId: string, spaceId: string) {
        const actor = this.space(userId, spaceId), members = this.members(userId, spaceId);
        const lastOwner = members.filter(member => member.role === 'owner').length === 1;
        return {
            rename: canAssign(actor.role, 'member'),
            inviteRoles: actor.role === 'owner' ? ['member', 'admin'] : actor.role === 'admin' ? ['member'] : [],
            manageInvitations: canAssign(actor.role, 'member'),
            leave: actor.role !== 'owner' || !lastOwner,
            members: Object.fromEntries(members.map(member => {
                const protectedOwner = member.role === 'owner' && lastOwner;
                return [member.userId, {
                    roles: canAssign(actor.role, member.role)
                        ? (['member', 'admin', 'owner'] as Role[]).filter(role => canAssign(actor.role, role) && (!protectedOwner || role === 'owner')) : [],
                    remove: !protectedOwner && (member.userId === userId || canAssign(actor.role, member.role)),
                }];
            })),
            invitations: canAssign(actor.role, 'member') ? Object.fromEntries(this.invitations(userId, spaceId)
                .map(invitation => [invitation.id, { revoke: canAssign(actor.role, invitation.role) }])) : {},
        };
    }
    space(userId: string, spaceId: string): Space {
        const space = this.db.query(`SELECT s.id, s.name, s.createdAt, m.role FROM hub_spaces s
            JOIN hub_memberships m ON m.spaceId=s.id WHERE m.userId=? AND s.id=?`).get(userId, spaceId) as Space | null;
        if (!space) throw hubNotFound();
        return space;
    }
    createSpace(userId: string, name: string): Space {
        return this.db.transaction(() => {
            const id = randomUUID(), now = Date.now();
            this.db.query('INSERT INTO hub_spaces (id, name, createdAt) VALUES (?, ?, ?)').run(id, name, now);
            this.db.query('INSERT INTO hub_memberships (spaceId, userId, role, joinedAt) VALUES (?, ?, ?, ?)').run(id, userId, 'owner', now);
            return this.space(userId, id);
        }).immediate();
    }
    renameSpace(userId: string, spaceId: string, name: string): Space {
        if (!canAssign(this.space(userId, spaceId).role, 'member')) throw hubForbidden();
        this.db.query('UPDATE hub_spaces SET name=? WHERE id=?').run(name, spaceId);
        return this.space(userId, spaceId);
    }
    members(userId: string, spaceId: string): Member[] {
        this.space(userId, spaceId);
        return this.db.query(`SELECT m.userId, u.name, m.role, m.joinedAt FROM hub_memberships m
            JOIN hub_users u ON u.id=m.userId WHERE m.spaceId=? ORDER BY m.joinedAt, m.userId`).all(spaceId) as Member[];
    }
    changeMember(userId: string, spaceId: string, targetId: string, role: Role | null) {
        return this.db.transaction(() => {
            const actor = this.space(userId, spaceId);
            const target = this.db.query('SELECT role FROM hub_memberships WHERE spaceId=? AND userId=?').get(spaceId, targetId) as { role: Role } | null;
            if (!target) throw hubNotFound();
            const leaving = targetId === userId && role === null;
            if (!leaving && (!canAssign(actor.role, target.role) || (role && !canAssign(actor.role, role)))) throw hubForbidden();
            if (target.role === 'owner' && role !== 'owner') {
                const owners = this.db.query("SELECT COUNT(*) AS count FROM hub_memberships WHERE spaceId=? AND role='owner'").get(spaceId) as { count: number };
                if (owners.count <= 1) throw new HubError(409, 'last_space_owner', '空间必须保留至少一位所有者。', '先将另一位成员设为所有者。');
            }
            if (role === null) {
                this.db.query('DELETE FROM hub_memberships WHERE spaceId=? AND userId=?').run(spaceId, targetId);
                this.db.query('DELETE FROM hub_checkouts WHERE spaceId=? AND ownerId=?').run(spaceId, targetId);
                this.db.query('DELETE FROM hub_agent_members WHERE agentId IN (SELECT id FROM hub_agents WHERE spaceId=? AND ownerId=?)').run(spaceId, targetId);
                this.db.query("UPDATE hub_agents SET accessMode='private', updatedAt=? WHERE spaceId=? AND ownerId=?").run(Date.now(), spaceId, targetId);
                this.db.query(`DELETE FROM hub_machine_spaces WHERE spaceId=? AND machineId IN
                    (SELECT id FROM hub_execution_objects WHERE kind='machine' AND ownerId=?)`).run(spaceId, targetId);
                this.db.query('UPDATE hub_execution_credentials SET revokedAt=COALESCE(revokedAt, ?) WHERE spaceId=? AND ownerId=?')
                    .run(Date.now(), spaceId, targetId);
                this.db.query('UPDATE hub_file_reservations SET cancelledAt=COALESCE(cancelledAt, ?) WHERE spaceId=? AND ownerId=?')
                    .run(Date.now(), spaceId, targetId);
                this.db.query(`DELETE FROM hub_execution_grants WHERE kind='artifact' AND objectId IN
                    (SELECT id FROM hub_execution_objects WHERE kind='artifact' AND spaceId=? AND
                        (ownerId=? OR hub_execution_grants.credentialId IN
                            (SELECT id FROM hub_execution_credentials WHERE ownerId=?)))`).run(spaceId, targetId, targetId);
                this.db.query('UPDATE hub_execution_intents SET cancelledAt=COALESCE(cancelledAt, ?) WHERE spaceId=? AND ownerId=?')
                    .run(Date.now(), spaceId, targetId);
            }
            else this.db.query('UPDATE hub_memberships SET role=? WHERE spaceId=? AND userId=?').run(role, spaceId, targetId);
            if (role !== target.role) this.db.query(`UPDATE hub_invitations SET revokedAt=?
                WHERE spaceId=? AND createdBy=? AND consumedAt IS NULL AND revokedAt IS NULL`).run(Date.now(), spaceId, targetId);
            return { userId: targetId, role };
        }).immediate();
    }
    invitations(userId: string, spaceId: string): Invitation[] {
        if (!canAssign(this.space(userId, spaceId).role, 'member')) throw hubForbidden();
        return this.db.query(`SELECT ${invitationColumns} FROM hub_invitations WHERE spaceId=?
            AND revokedAt IS NULL AND consumedAt IS NULL AND expiresAt>? ORDER BY createdAt, id`).all(spaceId, Date.now()) as Invitation[];
    }
    invite(userId: string, spaceId: string, role: 'admin' | 'member') {
        if (!canAssign(this.space(userId, spaceId).role, role)) throw hubForbidden();
        const now = Date.now(), token = `rw_inv_${randomBytes(32).toString('base64url')}`;
        const invitation: Invitation = { id: randomUUID(), spaceId, createdBy: userId, role, createdAt: now, expiresAt: now + 86_400_000 };
        this.db.query(`INSERT INTO hub_invitations (id, spaceId, tokenDigest, createdBy, role, createdAt, expiresAt)
            VALUES (?, ?, ?, ?, ?, ?, ?)`).run(invitation.id, spaceId, tokenDigest(token), userId, role, now, invitation.expiresAt);
        return { invitation, token };
    }
    revokeInvitation(userId: string, spaceId: string, id: string) {
        const actor = this.space(userId, spaceId);
        if (!canAssign(actor.role, 'member')) throw hubForbidden();
        const invitation = this.db.query('SELECT role FROM hub_invitations WHERE spaceId=? AND id=?').get(spaceId, id) as { role: Role } | null;
        if (!invitation) throw hubNotFound();
        if (!canAssign(actor.role, invitation.role)) throw hubForbidden();
        this.db.query('UPDATE hub_invitations SET revokedAt=COALESCE(revokedAt, ?) WHERE spaceId=? AND id=?').run(Date.now(), spaceId, id);
        return { revoked: true };
    }
    acceptInvitation(userId: string, token: string): Space {
        if (!InvitationToken.safeParse(token).success) throw new HubError(400, 'invalid_invitation', '邀请 token 格式无效。');
        return this.db.transaction(() => {
            const row = this.db.query(`SELECT ${invitationColumns}, consumedBy, consumedAt, revokedAt FROM hub_invitations WHERE tokenDigest=?`)
                .get(tokenDigest(token)) as InvitationRow | null;
            const unavailable = () => new HubError(410, 'invitation_unavailable', '邀请不存在、已过期、已撤销或已被使用。', '请空间管理者提供新的邀请。');
            if (!row) throw unavailable();
            const member = this.db.query('SELECT role FROM hub_memberships WHERE spaceId=? AND userId=?').get(row.spaceId, userId);
            if (row.consumedAt !== null) {
                if (row.consumedBy === userId && member) return this.space(userId, row.spaceId);
                throw unavailable();
            }
            if (row.revokedAt !== null || row.expiresAt <= Date.now()) throw unavailable();
            const issuer = this.db.query('SELECT role FROM hub_memberships WHERE spaceId=? AND userId=?').get(row.spaceId, row.createdBy) as { role: Role } | null;
            if (!issuer || !canAssign(issuer.role, row.role)) throw unavailable();
            if (member) throw new HubError(409, 'already_space_member', '你已是该空间成员，此邀请尚未使用。');
            const now = Date.now();
            const updated = this.db.query(`UPDATE hub_invitations SET consumedBy=?, consumedAt=? WHERE id=?
                AND consumedAt IS NULL AND revokedAt IS NULL AND expiresAt>?`).run(userId, now, row.id, now);
            if (updated.changes !== 1) throw unavailable();
            this.db.query('INSERT INTO hub_memberships (spaceId, userId, role, joinedAt) VALUES (?, ?, ?, ?)').run(row.spaceId, userId, row.role, now);
            return this.space(userId, row.spaceId);
        }).immediate();
    }
}
