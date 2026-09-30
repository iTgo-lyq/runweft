import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { RenameInput, invalidInput, ResourceError } from '../../resources/types';
import { AccessStore } from '../access/store';
import { fingerprint } from '../access/transport';
import type { Principal } from '../access/types';
import { tokenDigest } from '../store';
import { hubNotFound } from '../types';
import { EnrollmentInput, ReplacementInput, replacedCredential, resourceForbidden,
    type CredentialInfo, type Enrollment, type MachineRecord } from './types';

type MachineRow = Omit<MachineRecord, 'registered'> & { registered: number; requestId: string; fingerprint: string;
    enrollmentCredentialId: string; currentCredentialId: string };
type CredentialRow = Omit<CredentialInfo, 'status'> & { tokenDigest: string };
const machineColumns = 'm.*, o.ownerId';
const machineJoin = "hub_resource_machines m JOIN hub_execution_objects o ON o.kind='machine' AND o.id=m.machineId";

/** Uses the execution ledger's connection so membership, ownership and writes share one transaction. */
export class HubResourceStore {
    readonly db;
    constructor(readonly access: AccessStore) { this.db = access.db; }

    user(actor: Principal) {
        const current = this.access.refresh(actor);
        if (current.kind !== 'user') throw resourceForbidden();
        return current;
    }
    private transaction<T>(actor: Principal, action: (current: Principal) => T): T {
        return this.db.transaction(() => action(this.user(actor))).immediate();
    }
    private row(id: string): MachineRow | null {
        return this.db.query(`SELECT ${machineColumns} FROM ${machineJoin} WHERE m.machineId=?`).get(id) as MachineRow | null;
    }
    private owned(actor: Principal, id: string): MachineRow {
        const current = this.user(actor), row = this.row(id);
        if (!row || row.ownerId !== current.ownerId) throw hubNotFound();
        this.access.require(current, 'machine', id);
        return row;
    }
    private view(row: MachineRow): MachineRecord {
        return { machineId: row.machineId, ownerId: row.ownerId, name: row.name, registered: !!row.registered,
            createdAt: row.createdAt, updatedAt: row.updatedAt };
    }
    machine(actor: Principal, id: string) { return this.view(this.owned(actor, id)); }
    machines(actor: Principal): MachineRecord[] {
        const current = this.user(actor);
        return (this.db.query(`SELECT ${machineColumns} FROM ${machineJoin} WHERE o.ownerId=? AND o.retiredAt IS NULL ORDER BY m.createdAt, m.machineId`)
            .all(current.ownerId) as MachineRow[]).map(row => this.view(row));
    }
    private credentialRow(id: string): CredentialRow {
        return this.db.query('SELECT id, tokenDigest, createdAt, revokedAt FROM hub_execution_credentials WHERE id=?').get(id) as CredentialRow;
    }
    private credentialInfo(row: MachineRow): CredentialInfo {
        const credential = this.credentialRow(row.currentCredentialId);
        return { id: credential.id, createdAt: credential.createdAt, revokedAt: credential.revokedAt,
            status: credential.revokedAt === null ? 'active' : 'revoked' };
    }
    private enrollmentInfo(row: MachineRow): Enrollment {
        const credential = this.credentialInfo(row);
        return { machineId: row.machineId, requestId: row.requestId, credential,
            originalCredentialCurrent: row.enrollmentCredentialId === credential.id && credential.status === 'active' };
    }
    enrollment(actor: Principal, requestId: string): Enrollment {
        if (!z.uuid().safeParse(requestId).success) throw invalidInput();
        const current = this.user(actor);
        const row = this.db.query(`SELECT ${machineColumns} FROM ${machineJoin} WHERE o.ownerId=? AND m.requestId=?`)
            .get(current.ownerId, requestId) as MachineRow | null;
        if (!row) throw hubNotFound();
        return this.enrollmentInfo(row);
    }
    enroll(actor: Principal, input: unknown): Enrollment {
        const parsed = EnrollmentInput.safeParse(input);
        if (!parsed.success) throw invalidInput('接入需要预先保存的随机机器凭据和 UUID requestId，不能指定机器 ID 或所有者。');
        const value = parsed.data, hash = fingerprint({ tokenDigest: tokenDigest(value.token), name: value.name ?? null });
        return this.transaction(actor, current => {
            const prior = this.db.query(`SELECT ${machineColumns} FROM ${machineJoin} WHERE o.ownerId=? AND m.requestId=?`)
                .get(current.ownerId, value.requestId) as MachineRow | null;
            if (prior) {
                if (prior.fingerprint !== hash) throw new ResourceError(409, 'machine_enrollment_conflict', '原接入请求已使用不同参数。', '使用原 requestId 和已保存的凭据查询，不要自动重新创建机器。');
                const result = this.enrollmentInfo(prior);
                if (!result.originalCredentialCurrent) throw replacedCredential();
                return result;
            }
            const machineId = randomUUID(), now = Date.now();
            this.access.bind({ kind: 'machine', id: machineId, ownerId: current.ownerId });
            const credential = this.access.issueMachine(machineId, value.token);
            this.db.query(`INSERT INTO hub_resource_machines (machineId, requestId, fingerprint, enrollmentCredentialId,
                currentCredentialId, name, registered, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`)
                .run(machineId, value.requestId, hash, credential.id, credential.id, value.name ?? null, now, now);
            return this.enrollmentInfo(this.row(machineId)!);
        });
    }
    credential(actor: Principal, id: string) { return this.credentialInfo(this.owned(actor, id)); }
    replaceCredential(actor: Principal, id: string, input: unknown): CredentialInfo {
        const parsed = ReplacementInput.safeParse(input);
        if (!parsed.success) throw invalidInput('凭据替换需要当前凭据 ID 和预先保存的新随机机器凭据。');
        return this.transaction(actor, current => {
            const row = this.owned(current, id), prior = this.credentialRow(row.currentCredentialId);
            const digest = tokenDigest(parsed.data.token);
            // Only the *current live* token may confirm a lost response. A revoked token never revives itself.
            if (prior.tokenDigest === digest) {
                if (prior.revokedAt !== null) throw replacedCredential();
                return this.credentialInfo(row);
            }
            if (row.currentCredentialId !== parsed.data.expectedCredentialId) throw replacedCredential();
            const next = this.access.issueMachine(id, parsed.data.token);
            const now = Date.now();
            this.db.query("UPDATE hub_execution_credentials SET revokedAt=COALESCE(revokedAt, ?) WHERE kind='machine' AND machineId=? AND id<>?")
                .run(now, id, next.id);
            this.db.query('UPDATE hub_resource_machines SET currentCredentialId=?, updatedAt=? WHERE machineId=?').run(next.id, now, id);
            return this.credentialInfo(this.row(id)!);
        });
    }
    revokeCredential(actor: Principal, id: string): CredentialInfo {
        return this.transaction(actor, current => {
            const row = this.owned(current, id);
            this.db.query("UPDATE hub_execution_credentials SET revokedAt=COALESCE(revokedAt, ?) WHERE kind='machine' AND machineId=?")
                .run(Date.now(), id);
            return this.credentialInfo(row);
        });
    }
    register(actor: Principal, id: string, registered: boolean) {
        return this.transaction(actor, current => {
            this.owned(current, id);
            this.db.query('UPDATE hub_resource_machines SET registered=?, updatedAt=? WHERE machineId=?').run(Number(registered), Date.now(), id);
            return this.machine(current, id);
        });
    }
    rename(actor: Principal, id: string, input: unknown) {
        const parsed = RenameInput.safeParse(input); if (!parsed.success) throw invalidInput();
        return this.transaction(actor, current => {
            this.owned(current, id);
            this.db.query('UPDATE hub_resource_machines SET name=?, updatedAt=? WHERE machineId=?').run(parsed.data.name, Date.now(), id);
            return this.machine(current, id);
        });
    }
    spaces(actor: Principal, id: string): string[] {
        this.owned(actor, id);
        return (this.db.query('SELECT spaceId FROM hub_machine_spaces WHERE machineId=? ORDER BY spaceId').all(id) as { spaceId: string }[]).map(r => r.spaceId);
    }
    associate(actor: Principal, id: string, spaceId: string, attached: boolean) {
        if (!z.uuid().safeParse(spaceId).success) throw invalidInput();
        return this.transaction(actor, current => {
            this.owned(current, id);
            if (!this.access.member(current.ownerId, spaceId)) throw hubNotFound();
            if (attached) this.db.query('INSERT OR IGNORE INTO hub_machine_spaces (machineId, spaceId, createdAt) VALUES (?, ?, ?)').run(id, spaceId, Date.now());
            else this.db.query('DELETE FROM hub_machine_spaces WHERE machineId=? AND spaceId=?').run(id, spaceId);
            return { machineId: id, spaceId, attached };
        });
    }
}
