import { randomBytes, randomUUID } from 'node:crypto';
import { openState } from '../../state';
import { tokenDigest } from '../store';
import { HubError, IdentityToken, hubNotFound, hubUnauthorized } from '../types';
import { Binding, CredentialToken, IntentInput, type ExecutionObject, type ExecutionIntent, type ObjectKind, type Operation, type Principal, type PrincipalKind } from './types';

type Credential = { id: string; kind: 'machine' | 'task'; ownerId: string; machineId: string; spaceId: string | null;
    taskId: string | null; tokenDigest: string; createdAt: number; expiresAt: number | null; revokedAt: number | null };
const conflict = () => new HubError(409, 'execution_binding_conflict', '对象或请求已经有不同的执行归属。', '使用原有请求查询；不要修改所有者或自动重新启动。');
const invalid = () => new HubError(400, 'invalid_execution_binding', '执行主体、对象或派生意图不完整。');

/** Trusted service methods only. HTTP callers never supply authoritative owner or machine bindings. */
export class AccessStore {
    readonly db;
    constructor(path: string) { this.db = openState(path); }
    close() { this.db.close(); }

    nativeClaim(field: string, nativeId: string): Pick<ExecutionObject, 'ownerId' | 'spaceId' | 'machineId'> | null {
        return this.db.query('SELECT ownerId, spaceId, machineId FROM hub_native_session_claims WHERE field=? AND nativeId=?').get(field, nativeId) as any;
    }
    claimNative(field: 'codexSessionId' | 'claudeSessionId', nativeId: string, sessionId: string) {
        return this.db.transaction(() => {
            const binding = this.live('session', sessionId), prior = this.nativeClaim(field, nativeId);
            if (prior && (prior.ownerId !== binding.ownerId || prior.spaceId !== binding.spaceId || prior.machineId !== binding.machineId)) throw conflict();
            this.db.query('INSERT OR IGNORE INTO hub_native_session_claims (field, nativeId, ownerId, spaceId, machineId) VALUES (?, ?, ?, ?, ?)')
                .run(field, nativeId, binding.ownerId, binding.spaceId, binding.machineId);
        }).immediate();
    }

    private user(id: string) {
        const row = this.db.query('SELECT id, name, rowid AS userNumber, tokenDigest FROM hub_users WHERE id=?')
            .get(id) as { id: string; name: string; userNumber: number; tokenDigest: string } | null;
        if (!row) throw hubUnauthorized();
        return row;
    }
    member(ownerId: string, spaceId: string | null): boolean {
        return spaceId === null || !!this.db.query('SELECT 1 FROM hub_memberships WHERE userId=? AND spaceId=?').get(ownerId, spaceId);
    }
    private requireMember(ownerId: string, spaceId: string | null) {
        this.user(ownerId);
        if (!this.member(ownerId, spaceId)) throw hubNotFound();
    }
    object(kind: ObjectKind, id: string): ExecutionObject | null {
        return this.db.query('SELECT * FROM hub_execution_objects WHERE kind=? AND id=?').get(kind, id) as ExecutionObject | null;
    }
    private live(kind: ObjectKind, id: string) {
        const object = this.object(kind, id);
        if (!object || object.retiredAt !== null || !this.member(object.ownerId, object.spaceId)) throw hubNotFound();
        return object;
    }
    bind(input: unknown): ExecutionObject {
        const parsed = Binding.safeParse(input);
        if (!parsed.success) throw invalid();
        const value = parsed.data;
        return this.db.transaction(() => {
            this.requireMember(value.ownerId, value.spaceId);
            if (value.kind === 'machine') {
                if (value.spaceId || value.taskId || (value.machineId && value.machineId !== value.id)) throw invalid();
                value.machineId = value.id;
            } else {
                if (['task', 'session'].includes(value.kind) && !value.machineId) throw invalid();
                if (value.machineId) this.live('machine', value.machineId);
            }
            if (value.kind === 'task') {
                if (value.taskId && value.taskId !== value.id) throw invalid();
                value.taskId = value.id;
            } else if (value.taskId) {
                const task = this.live('task', value.taskId);
                if (task.ownerId !== value.ownerId || task.spaceId !== value.spaceId
                    || (value.machineId !== null && task.machineId !== value.machineId)) throw conflict();
            }
            const prior = this.object(value.kind, value.id);
            if (prior) {
                for (const field of ['ownerId', 'spaceId', 'taskId', 'machineId'] as const) if (prior[field] !== value[field]) throw conflict();
                if (prior.retiredAt !== null) throw conflict();
                return prior;
            }
            this.db.query(`INSERT INTO hub_execution_objects (kind, id, ownerId, spaceId, taskId, machineId, createdAt)
                VALUES (?, ?, ?, ?, ?, ?, ?)`).run(value.kind, value.id, value.ownerId, value.spaceId, value.taskId, value.machineId, Date.now());
            return this.object(value.kind, value.id)!;
        }).immediate();
    }
    retire(kind: ObjectKind, id: string) {
        return this.db.transaction(() => {
            const now = Date.now();
            this.db.query('UPDATE hub_execution_objects SET retiredAt=COALESCE(retiredAt, ?) WHERE kind=? AND id=?').run(now, kind, id);
            if (kind === 'machine') this.db.query('UPDATE hub_execution_credentials SET revokedAt=COALESCE(revokedAt, ?) WHERE machineId=?').run(now, id);
            if (kind === 'task') this.db.query('UPDATE hub_execution_credentials SET revokedAt=COALESCE(revokedAt, ?) WHERE taskId=?').run(now, id);
        }).immediate();
    }
    issueMachine(machineId: string, token?: string) { return this.issue('machine', machineId, token); }
    issueTask(taskId: string) { return this.issue('task', taskId); }
    private issue(kind: 'machine' | 'task', objectId: string, suppliedToken?: string) {
        return this.db.transaction(() => {
            const object = this.live(kind, objectId);
            if (suppliedToken !== undefined && (kind !== 'machine' || !/^rw_mc_[A-Za-z0-9_-]{43}$/.test(suppliedToken))) throw invalid();
            const id = randomUUID(), token = suppliedToken ?? `${kind === 'machine' ? 'rw_mc_' : 'rw_task_'}${randomBytes(32).toString('base64url')}`;
            if (this.db.query('SELECT 1 FROM hub_execution_credentials WHERE tokenDigest=?').get(tokenDigest(token))) {
                throw new HubError(409, 'machine_credential_unavailable', '该机器凭据无法使用，请生成新的凭据。');
            }
            this.db.query(`INSERT INTO hub_execution_credentials
                (id, kind, ownerId, machineId, spaceId, taskId, tokenDigest, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(id, kind, object.ownerId, object.machineId, object.spaceId, object.taskId, tokenDigest(token), Date.now());
            return { id, token };
        }).immediate();
    }
    revoke(id: string) { this.db.query('UPDATE hub_execution_credentials SET revokedAt=COALESCE(revokedAt, ?) WHERE id=?').run(Date.now(), id); }
    authenticate(token: string, spaceId: string | null = null): Principal {
        if (IdentityToken.safeParse(token).success) return this.resolve('user', tokenDigest(token), spaceId);
        if (!CredentialToken.test(token) || spaceId !== null) throw hubUnauthorized();
        return this.resolve(token.startsWith('rw_mc_') ? 'machine' : 'task', tokenDigest(token));
    }
    /** Only called with a verified JWT or a digest computed from the presented raw credential. */
    resolve(kind: PrincipalKind, digest: string, selectedSpace: string | null = null): Principal {
        if (kind === 'user') {
            const user = this.db.query('SELECT id, name, rowid AS userNumber FROM hub_users WHERE tokenDigest=?').get(digest) as
                { id: string; name: string; userNumber: number } | null;
            if (!user || !this.member(user.id, selectedSpace)) throw hubUnauthorized();
            return { kind, id: user.id, ownerId: user.id, userNumber: user.userNumber, name: user.name,
                digest, machineId: null, taskId: null, spaceId: selectedSpace };
        }
        const row = this.db.query('SELECT * FROM hub_execution_credentials WHERE tokenDigest=? AND kind=?').get(digest, kind) as Credential | null;
        if (!row || row.revokedAt !== null || (row.expiresAt !== null && row.expiresAt <= Date.now()) || !this.member(row.ownerId, row.spaceId)) throw hubUnauthorized();
        const machine = this.object('machine', row.machineId), task = row.taskId ? this.object('task', row.taskId) : null;
        if (!machine || machine.retiredAt !== null || (kind === 'machine' && machine.ownerId !== row.ownerId)
            || (kind === 'task' && (!task || task.retiredAt !== null || task.ownerId !== row.ownerId
                || task.machineId !== row.machineId || task.spaceId !== row.spaceId))) throw hubUnauthorized();
        const user = this.user(row.ownerId);
        return { kind, id: row.id, ownerId: row.ownerId, userNumber: user.userNumber, name: user.name, digest,
            machineId: row.machineId, taskId: row.taskId, spaceId: row.spaceId };
    }
    refresh(principal: Principal): Principal {
        if (principal.expiresAt !== undefined && principal.expiresAt <= Date.now()) throw hubUnauthorized();
        return { ...this.resolve(principal.kind, principal.digest, principal.kind === 'user' ? principal.spaceId : null), expiresAt: principal.expiresAt };
    }
    /** Background service only: accepted work survives token rotation, never membership removal. */
    serviceUser(ownerId: string, spaceId: string): Principal {
        return this.resolve('user', this.user(ownerId).tokenDigest, spaceId);
    }
    private permitted(principal: Principal, object: ExecutionObject, operation: Operation): boolean {
        if (object.retiredAt !== null || !this.member(object.ownerId, object.spaceId)) return false;
        if (principal.kind === 'user') return operation !== 'report' && object.ownerId === principal.ownerId
            && (principal.spaceId === null || object.spaceId === null || object.spaceId === principal.spaceId);
        if (object.kind === 'artifact') return !!this.db.query(`SELECT 1 FROM hub_execution_grants
            WHERE credentialId=? AND kind=? AND objectId=? AND operation=?`).get(principal.id, object.kind, object.id, operation);
        if (principal.kind === 'machine') return object.machineId === principal.machineId
            && (object.kind === 'session' || (object.kind === 'machine' && operation !== 'write'));
        // Task credentials are for Runweft transfers/reporting, never native session or machine control.
        return object.kind === 'task' && object.id === principal.taskId && operation !== 'write';
    }
    can(principal: Principal, kind: ObjectKind, id: string, operation: Operation = 'read'): boolean {
        return this.db.transaction(() => {
            const current = this.refresh(principal), object = this.object(kind, id);
            return !!object && this.permitted(current, object, operation);
        }).deferred();
    }
    require(principal: Principal, kind: ObjectKind, id: string, operation: Operation = 'read'): ExecutionObject {
        return this.db.transaction(() => {
            const current = this.refresh(principal), object = this.object(kind, id);
            if (!object || !this.permitted(current, object, operation)) throw hubNotFound();
            return object;
        }).deferred();
    }
    list(principal: Principal, kind: ObjectKind): ExecutionObject[] {
        return this.db.transaction(() => {
            const current = this.refresh(principal);
            return (this.db.query('SELECT * FROM hub_execution_objects WHERE kind=? ORDER BY createdAt, id').all(kind) as ExecutionObject[])
                .filter(object => this.permitted(current, object, 'read'));
        }).deferred();
    }
    grant(credentialId: string, artifactId: string, operation: 'read' | 'write', leaseKey = 'manual') {
        return this.db.transaction(() => {
            const credential = this.db.query('SELECT * FROM hub_execution_credentials WHERE id=?').get(credentialId) as Credential | null;
            if (!credential) throw hubNotFound();
            this.resolve(credential.kind, credential.tokenDigest);
            const object = this.live('artifact', artifactId);
            if (credential.kind === 'task' && object.ownerId !== credential.ownerId) throw conflict();
            this.db.query("INSERT OR IGNORE INTO hub_execution_grants (credentialId, kind, objectId, operation, leaseKey) VALUES (?, 'artifact', ?, ?, ?)")
                .run(credentialId, artifactId, operation, leaseKey);
        }).immediate();
    }
    revokeGrant(credentialId: string, artifactId: string) {
        this.db.query("DELETE FROM hub_execution_grants WHERE credentialId=? AND kind='artifact' AND objectId=?").run(credentialId, artifactId);
    }
    /** Release one persisted transfer across credential rotations; other transfers retain their grants. */
    releaseFileLease(leaseKey: string) {
        this.db.query("DELETE FROM hub_execution_grants WHERE kind='artifact' AND leaseKey=?").run(leaseKey);
    }
    intent(id: string): ExecutionIntent | null {
        return this.db.query('SELECT * FROM hub_execution_intents WHERE id=?').get(id) as ExecutionIntent | null;
    }
    beginIntent(input: unknown): ExecutionIntent {
        const parsed = IntentInput.safeParse(input);
        if (!parsed.success) throw invalid();
        const value = parsed.data;
        return this.db.transaction(() => {
            this.requireMember(value.ownerId, value.spaceId);
            this.live('machine', value.machineId);
            if (value.operation !== 'spawn' && !value.sourceSessionId) throw invalid();
            if (value.sourceSessionId) {
                const source = this.live('session', value.sourceSessionId);
                if (source.ownerId !== value.ownerId || source.spaceId !== value.spaceId
                    || source.machineId !== value.machineId || source.taskId !== value.taskId) throw conflict();
            }
            if (value.taskId) {
                const task = this.live('task', value.taskId);
                if (task.ownerId !== value.ownerId || task.spaceId !== value.spaceId || task.machineId !== value.machineId) throw conflict();
            }
            const prior = this.db.query('SELECT * FROM hub_execution_intents WHERE ownerId=? AND requestKey=?')
                .get(value.ownerId, value.requestKey) as ExecutionIntent | null;
            if (prior) {
                for (const key of ['spaceId', 'taskId', 'machineId', 'sourceSessionId', 'operation', 'fingerprint'] as const) if (value[key] !== prior[key]) throw conflict();
                // Re-observing an expired request does not grant a fresh dispatch window.
                return prior;
            }
            if (value.expiresAt <= Date.now()) throw invalid();
            const id = randomUUID();
            this.db.query(`INSERT INTO hub_execution_intents (id, requestKey, ownerId, spaceId, taskId, machineId,
                sourceSessionId, operation, fingerprint, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(id, value.requestKey, value.ownerId, value.spaceId, value.taskId, value.machineId, value.sourceSessionId,
                    value.operation, value.fingerprint, Date.now(), value.expiresAt);
            return this.intent(id)!;
        }).immediate();
    }
    intentByRequest(ownerId: string, requestKey: string): ExecutionIntent | null {
        return this.db.query('SELECT * FROM hub_execution_intents WHERE ownerId=? AND requestKey=?').get(ownerId, requestKey) as ExecutionIntent | null;
    }
    pending(machineId: string): ExecutionIntent[] {
        return (this.db.query(`SELECT * FROM hub_execution_intents WHERE machineId=? AND expiresAt>? AND cancelledAt IS NULL AND sessionId IS NULL`)
            .all(machineId, Date.now()) as ExecutionIntent[]).filter(intent => this.member(intent.ownerId, intent.spaceId));
    }
    /** Caller must first prove the native receipt or authorized fork/clear relation. */
    bindIntent(id: string, sessionId: string, confirmedReceipt = false): ExecutionObject {
        return this.db.transaction(() => {
            const intent = this.intent(id);
            if (!intent || intent.cancelledAt !== null) throw hubNotFound();
            if (intent.sessionId && intent.sessionId !== sessionId) throw conflict();
            if (!confirmedReceipt && !intent.sessionId && intent.expiresAt <= Date.now()) throw hubNotFound();
            const object = this.bind({ kind: 'session', id: sessionId, ownerId: intent.ownerId, spaceId: intent.spaceId,
                taskId: intent.taskId, machineId: intent.machineId });
            this.db.query('UPDATE hub_execution_intents SET sessionId=? WHERE id=?').run(sessionId, id);
            return object;
        }).immediate();
    }
    cancelIntent(id: string) { this.db.query('UPDATE hub_execution_intents SET cancelledAt=COALESCE(cancelledAt, ?) WHERE id=?').run(Date.now(), id); }
}
