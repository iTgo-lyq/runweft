import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { RenameInput, invalidInput, ResourceError, eligibility, type Inspection, type Eligibility } from '../../resources/types';
import { AccessStore } from '../access/store';
import { fingerprint } from '../access/transport';
import type { Principal } from '../access/types';
import { tokenDigest } from '../store';
import { hubForbidden, hubNotFound, type Role } from '../types';
import { EnrollmentInput, ReplacementInput, replacedCredential, resourceForbidden,
    type CredentialInfo, type Enrollment, type MachineRecord, type RuntimeRecord, RuntimeInput } from './types';

type MachineRow = Omit<MachineRecord, 'registered'> & { registered: number; requestId: string; fingerprint: string;
    enrollmentCredentialId: string; currentCredentialId: string };
type CredentialRow = Omit<CredentialInfo, 'status'> & { tokenDigest: string };
type RuntimeRow = Omit<RuntimeRecord, 'registered' | 'inspection'> & { registered: number; inspection: string | null };
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
        if (!row) throw hubNotFound();
        if (row.ownerId !== current.ownerId) {
            if (this.machineVisible(current.ownerId, current.spaceId, row)) throw resourceForbidden();
            throw hubNotFound();
        }
        this.access.require(current, 'machine', id);
        return row;
    }
    private view(row: MachineRow): MachineRecord {
        return { machineId: row.machineId, ownerId: row.ownerId, name: row.name, registered: !!row.registered,
            createdAt: row.createdAt, updatedAt: row.updatedAt };
    }
    ownMachine(actor: Principal, id: string) { return this.view(this.owned(actor, id)); }
    role(userId: string, spaceId: string | null): Role | null {
        if (!spaceId) return null;
        return (this.db.query('SELECT role FROM hub_memberships WHERE userId=? AND spaceId=?').get(userId, spaceId) as { role: Role } | null)?.role ?? null;
    }
    associated(machineId: string, spaceId: string | null): boolean {
        const machine = this.row(machineId);
        return !!spaceId && !!machine && this.access.member(machine.ownerId, spaceId)
            && !!this.db.query('SELECT 1 FROM hub_machine_spaces WHERE machineId=? AND spaceId=?').get(machineId, spaceId);
    }
    governs(userId: string, machineId: string, spaceId: string | null): boolean {
        return ['owner', 'admin'].includes(this.role(userId, spaceId) ?? '') && this.associated(machineId, spaceId);
    }
    private machineVisible(userId: string, spaceId: string | null, row: MachineRow): boolean {
        if (row.ownerId === userId) return true;
        if (!this.role(userId, spaceId) || !this.associated(row.machineId, spaceId)) return false;
        return this.governs(userId, row.machineId, spaceId)
            || !!this.db.query('SELECT 1 FROM hub_runtime_shares WHERE machineId=? AND spaceId=?').get(row.machineId, spaceId);
    }
    machine(actor: Principal, id: string): MachineRecord {
        const current = this.user(actor), row = this.row(id);
        if (!row || this.access.object('machine', id)?.retiredAt !== null || !this.machineVisible(current.ownerId, current.spaceId, row)) throw hubNotFound();
        return this.view(row);
    }
    machines(actor: Principal): MachineRecord[] {
        const current = this.user(actor);
        return (this.db.query(`SELECT ${machineColumns} FROM ${machineJoin} WHERE o.retiredAt IS NULL ORDER BY m.createdAt, m.machineId`)
            .all() as MachineRow[]).filter(row => this.machineVisible(current.ownerId, current.spaceId, row)).map(row => this.view(row));
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

    private runtimeRow(id: string): RuntimeRecord | null {
        const row = this.db.query(`SELECT r.*, o.ownerId FROM hub_resource_runtimes r JOIN hub_execution_objects o
            ON o.kind='machine' AND o.id=r.machineId AND o.retiredAt IS NULL WHERE r.id=?`).get(id) as RuntimeRow | null;
        return row ? { ...row, registered: !!row.registered, inspection: row.inspection ? JSON.parse(row.inspection) : null } : null;
    }
    shared(id: string, spaceId: string | null): boolean {
        return !!spaceId && !!this.db.query('SELECT 1 FROM hub_runtime_shares WHERE runtimeId=? AND spaceId=?').get(id, spaceId);
    }
    private runtimeVisible(userId: string, spaceId: string | null, row: RuntimeRecord): boolean {
        return row.ownerId === userId || !!this.role(userId, spaceId) && this.associated(row.machineId, spaceId)
            && (this.shared(row.id, spaceId) || this.governs(userId, row.machineId, spaceId));
    }
    runtime(actor: Principal, id: string): RuntimeRecord {
        const current = this.user(actor), row = this.runtimeRow(id);
        if (!row || !this.runtimeVisible(current.ownerId, current.spaceId, row)) throw hubNotFound();
        return row;
    }
    runtimes(actor: Principal): RuntimeRecord[] {
        const current = this.user(actor);
        return (this.db.query('SELECT id FROM hub_resource_runtimes ORDER BY createdAt, id').all() as { id: string }[])
            .map(r => this.runtimeRow(r.id)).filter((r): r is RuntimeRecord => !!r && this.runtimeVisible(current.ownerId, current.spaceId, r));
    }
    private ownRuntime(actor: Principal, id: string): RuntimeRecord {
        const runtime = this.runtime(actor, id);
        if (runtime.ownerId !== this.user(actor).ownerId) throw resourceForbidden();
        return runtime;
    }
    shares(actor: Principal, id: string): string[] {
        this.ownRuntime(actor, id);
        return (this.db.query('SELECT spaceId FROM hub_runtime_shares WHERE runtimeId=? ORDER BY spaceId').all(id) as { spaceId: string }[]).map(r => r.spaceId);
    }
    share(actor: Principal, id: string, spaceId: string, shared: boolean) {
        if (!z.uuid().safeParse(spaceId).success) throw invalidInput();
        return this.transaction(actor, current => {
            const runtime = this.ownRuntime(current, id);
            if (!this.access.member(current.ownerId, spaceId) || !this.associated(runtime.machineId, spaceId)) throw hubNotFound();
            if (shared) this.db.query('INSERT OR IGNORE INTO hub_runtime_shares (runtimeId, machineId, spaceId, createdAt) VALUES (?, ?, ?, ?)')
                .run(id, runtime.machineId, spaceId, Date.now());
            else this.db.query('DELETE FROM hub_runtime_shares WHERE runtimeId=? AND spaceId=?').run(id, spaceId);
            return { runtimeId: id, spaceId, shared };
        });
    }
    block(actor: Principal, spaceId: string, kind: 'machine' | 'runtime', id: string, blocked: boolean) {
        if (!z.uuid().safeParse(spaceId).success || !['machine', 'runtime'].includes(kind)) throw invalidInput();
        return this.transaction(actor, current => {
            if (!this.role(current.ownerId, spaceId)) throw hubNotFound();
            const machineId = kind === 'machine' ? id : this.runtimeRow(id)?.machineId;
            if (!machineId || !this.associated(machineId, spaceId)) throw hubNotFound();
            if (!this.governs(current.ownerId, machineId, spaceId)) throw hubForbidden();
            if (blocked) this.db.query(`INSERT INTO hub_resource_blocks (spaceId, kind, objectId, actorId, createdAt) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(spaceId, kind, objectId) DO NOTHING`).run(spaceId, kind, id, current.ownerId, Date.now());
            else this.db.query('DELETE FROM hub_resource_blocks WHERE spaceId=? AND kind=? AND objectId=?').run(spaceId, kind, id);
            return { spaceId, kind, id, blocked };
        });
    }
    blocked(spaceId: string | null, kind: 'machine' | 'runtime', id: string): boolean {
        return !!spaceId && !!this.db.query('SELECT 1 FROM hub_resource_blocks WHERE spaceId=? AND kind=? AND objectId=?').get(spaceId, kind, id);
    }
    /** Synchronous authoritative policy shared by resolution, Agent binding, intent commit and native dispatch. */
    usable(userId: string, spaceId: string | null, id: string): Eligibility {
        const no = (code: string, message: string) => eligibility({ code, message });
        const runtime = this.runtimeRow(id);
        if (!runtime) return no('runtime_unknown', '找不到目标 runtime。');
        if (!spaceId) return no('resource_space_required', '使用 runtime 前需要选择 Hub 空间。');
        if (!this.role(userId, spaceId)) return no('resource_membership_required', '当前身份不是目标空间成员。');
        const machine = this.row(runtime.machineId);
        if (!machine || !machine.registered) return no('machine_unregistered', '目标机器已取消登记。');
        if (!runtime.registered) return no('runtime_unregistered', '目标 runtime 已取消登记。');
        if (!this.associated(runtime.machineId, spaceId)) return no('machine_space_unlinked', '机器所有者尚未将机器关联此空间。');
        if (runtime.ownerId !== userId && !this.shared(id, spaceId)) return no('runtime_private', '目标 runtime 未向此空间分享。');
        if (this.blocked(spaceId, 'machine', runtime.machineId) || this.blocked(spaceId, 'runtime', id)) return no('resource_space_blocked', '空间管理员已禁用此执行资源。');
        if (this.credentialInfo(machine).status !== 'active') return no('machine_credential_revoked', '机器接入凭据已撤销，需要重新接入。');
        return eligibility(null);
    }
    requireUsable(userId: string, spaceId: string | null, id: string) {
        const reason = this.usable(userId, spaceId, id).reason;
        if (reason) throw new ResourceError(reason.code === 'runtime_unknown' ? 404
            : ['runtime_private', 'resource_membership_required'].includes(reason.code) ? 403 : 409, reason.code, reason.message);
    }
    nativeExecution(ownerId: string, spaceId: string | null, machineId: string, flavor: string) {
        if (spaceId === null) {
            if (this.access.object('machine', machineId)?.ownerId !== ownerId) throw hubNotFound();
            return; // Native personal sessions are not workspace delegation.
        }
        const runtime = this.db.query('SELECT id FROM hub_resource_runtimes WHERE machineId=? AND flavor=?').get(machineId, flavor) as { id: string } | null;
        if (!runtime) throw new ResourceError(409, 'runtime_unregistered', '目标机器尚未登记此类型的 runtime。');
        this.requireUsable(ownerId, spaceId, runtime.id);
    }
    registerRuntime(actor: Principal, input: unknown, inspection: Inspection, prior?: { id: string; registered: boolean } | null): RuntimeRecord {
        const parsed = RuntimeInput.safeParse(input); if (!parsed.success) throw invalidInput();
        const value = parsed.data;
        return this.transaction(actor, current => {
            if (!this.owned(current, value.machineId).registered) throw new ResourceError(409, 'machine_unregistered', '机器已取消登记，不能注册 runtime。');
            if (inspection.agent !== value.flavor) throw invalidInput();
            const existing = this.db.query('SELECT id, registered FROM hub_resource_runtimes WHERE machineId=? AND flavor=?')
                .get(value.machineId, value.flavor) as { id: string; registered: number } | null;
            if (prior !== undefined && existing && !existing.registered && (prior?.id !== existing.id || prior.registered)) {
                throw new ResourceError(409, 'runtime_unregistered', '工具探测期间 runtime 已被取消登记，请刷新后再显式注册。');
            }
            const id = randomUUID(), now = Date.now();
            this.db.query(`INSERT INTO hub_resource_runtimes (id, machineId, flavor, name, registered, inspection, inspectedAt, createdAt, updatedAt)
                VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?) ON CONFLICT(machineId, flavor) DO UPDATE SET registered=1,
                name=COALESCE(?, name), updatedAt=excluded.updatedAt`)
                .run(id, value.machineId, value.flavor, value.name ?? value.flavor, JSON.stringify(inspection), inspection.details.checkedAt, now, now, value.name ?? null);
            this.saveInspections(current, value.machineId, [inspection]);
            const row = this.db.query('SELECT id FROM hub_resource_runtimes WHERE machineId=? AND flavor=?').get(value.machineId, value.flavor) as { id: string };
            return this.runtime(current, row.id);
        });
    }
    saveInspections(actor: Principal, machineId: string, inspections: Inspection[], authorize?: () => void) {
        this.transaction(actor, current => {
            if (authorize) authorize(); else this.owned(current, machineId);
            for (const inspection of inspections) this.db.query(`UPDATE hub_resource_runtimes SET inspection=?, inspectedAt=?
                WHERE machineId=? AND flavor=? AND (inspectedAt IS NULL OR inspectedAt<=?)`)
                .run(JSON.stringify(inspection), inspection.details.checkedAt, machineId, inspection.agent, inspection.details.checkedAt);
        });
    }
    renameRuntime(actor: Principal, id: string, input: unknown) {
        const parsed = RenameInput.safeParse(input); if (!parsed.success) throw invalidInput();
        return this.transaction(actor, current => {
            this.ownRuntime(current, id);
            this.db.query('UPDATE hub_resource_runtimes SET name=?, updatedAt=? WHERE id=?').run(parsed.data.name, Date.now(), id);
            return this.runtime(current, id);
        });
    }
    unregisterRuntime(actor: Principal, id: string) {
        return this.transaction(actor, current => {
            this.ownRuntime(current, id);
            this.db.query('UPDATE hub_resource_runtimes SET registered=0, updatedAt=? WHERE id=?').run(Date.now(), id);
            return this.runtime(current, id);
        });
    }
}
