import { Database } from 'bun:sqlite';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { atomicWrite, connectionName, ensureDirectory, expandPath, hubOrigin } from '../../config';
import { RunweftError } from '../../errors';
import { NameSchema } from '../../resources/types';
import type { HubResourceClient } from './client';
import { MachineToken } from './types';

const RecordSchema = z.object({
    schemaVersion: z.literal(1), hub: hubOrigin, ownerId: z.uuid(), requestId: z.uuid(), name: NameSchema.optional(),
    machineId: z.uuid().optional(), active: z.object({ token: MachineToken, credentialId: z.uuid().optional() }).strict(),
    pending: z.object({ token: MachineToken, expectedCredentialId: z.uuid() }).strict().optional(), createdAt: z.number().int(),
}).strict();
type MachineConnectionRecord = z.infer<typeof RecordSchema>;
const newToken = () => `rw_mc_${randomBytes(32).toString('base64url')}`;
const recordError = () => new RunweftError('machine_connection_invalid', '机器接入记录无效，未修改原文件。', '检查 hub paths 显示的 machine.json；保留原记录以便确认接入请求。');
const changed = () => new RunweftError('machine_connection_changed', '机器接入凭据已变化。', '重新查询凭据状态；需要时显式运行 hub machine rotate-credential。');

export function hubConnectionPaths(home: string, url: string) {
    const hub = hubOrigin.safeParse(url); if (!hub.success) throw new RunweftError('hub_url_invalid', '请填写 Hub HTTP(S) 根地址。');
    const root = expandPath(home), connection = join(root, 'connections', connectionName({ mode: 'hub', hub: { url: hub.data, tokenEnv: 'RUNWEFT_IDENTITY_TOKEN' } }));
    return { hub: hub.data, home: root, connection, identityConnection: join(connection, 'identity.json'), pendingConnection: join(connection, 'connect.json'),
        machineConnection: join(connection, 'machine.json'), clientState: join(root, 'client.sqlite') };
}

export function connectionFileLock<T>(paths: ReturnType<typeof hubConnectionPaths>, change: () => T): T {
    ensureDirectory(paths.home);
    const db = new Database(paths.clientState, { create: true });
    try {
        chmodSync(paths.clientState, 0o600); db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;');
        return db.transaction(change).immediate();
    } finally { db.close(); }
}

/** Secrets live in one predictable file; short SQLite write locks serialize file updates and release on process death. */
export class MachineConnection {
    readonly paths: ReturnType<typeof hubConnectionPaths>;
    constructor(home: string, readonly client: HubResourceClient) { this.paths = hubConnectionPaths(home, client.url); }
    private read(ownerId: string): MachineConnectionRecord | undefined {
        if (!existsSync(this.paths.machineConnection)) return;
        let parsed: ReturnType<typeof RecordSchema.safeParse>;
        try { parsed = RecordSchema.safeParse(JSON.parse(readFileSync(this.paths.machineConnection, 'utf8'))); }
        catch { throw recordError(); }
        if (!parsed.success || parsed.data.hub !== this.client.url) throw recordError();
        if (parsed.data.ownerId !== ownerId) throw new RunweftError('machine_connection_owner_mismatch', '此 Hub 的机器记录属于另一个身份。', '使用原身份，或为新身份选择独立 --home；不会覆盖或复用原机器凭据。');
        return parsed.data;
    }
    private update(ownerId: string, change: (record: MachineConnectionRecord | undefined) => MachineConnectionRecord): MachineConnectionRecord {
        return connectionFileLock(this.paths, () => {
            const record = change(this.read(ownerId));
            if (!RecordSchema.safeParse(record).success) throw recordError();
            atomicWrite(this.paths.machineConnection, JSON.stringify(record, null, 2) + '\n');
            return record;
        });
    }
    private required(ownerId: string) {
        const record = this.read(ownerId);
        if (!record) throw new RunweftError('machine_enrollment_required', '本机尚未保存此 Hub 的机器接入记录。', '先运行 hub machine enroll。');
        return record;
    }
    private summary(record: MachineConnectionRecord, restart: boolean) {
        return { hub: record.hub, ownerId: record.ownerId, machineId: record.machineId!, credentialId: record.active.credentialId!,
            requestId: record.requestId, credentialFile: this.paths.machineConnection, runnerRestartRequired: restart };
    }
    async enroll(name?: string) {
        if (name !== undefined && !NameSchema.safeParse(name).success) throw new RunweftError('machine_name_invalid', '机器展示名称无效。');
        if (name !== undefined) name = NameSchema.parse(name);
        const owner = await this.client.identity();
        let record = this.update(owner.id, current => {
            if (current) {
                if (name !== undefined && current.name !== name) throw new RunweftError('machine_enrollment_conflict', '已有接入请求使用了不同名称。', '保留原接入记录；接入完成后用 hub machine rename 修改名称。');
                return current;
            }
            return { schemaVersion: 1, hub: this.client.url, ownerId: owner.id, requestId: randomUUID(), name,
                active: { token: newToken() }, createdAt: Date.now() };
        });
        if (record.pending) return this.rotate();
        if (!record.machineId) {
            const sent = record;
            const reply = await this.client.enroll({ requestId: sent.requestId, token: sent.active.token, name: sent.name });
            record = this.update(owner.id, current => {
                if (!current || current.requestId !== sent.requestId) throw changed();
                if (current.machineId) return current; // Another process already confirmed; never overwrite its rotation.
                if (current.active.token !== sent.active.token || reply.requestId !== sent.requestId) throw changed();
                return { ...current, machineId: reply.machineId, active: { ...current.active, credentialId: reply.credential.id } };
            });
        }
        if (record.pending) return this.rotate();
        const { credential } = await this.client.credential(record.machineId!);
        if (credential.status !== 'active' || credential.id !== record.active.credentialId) throw changed();
        await this.client.verifyMachine(record.active.token, credential.id);
        return this.summary(record, false);
    }
    async rotate(replacePending = false) {
        const owner = await this.client.identity();
        let original = this.required(owner.id);
        if (!original.machineId) {
            // The first receipt may have been lost and its credential revoked before this explicit rotation.
            const receipt = await this.client.enrollment(original.requestId);
            original = this.update(owner.id, current => {
                if (!current || current.requestId !== receipt.requestId) throw changed();
                return current.machineId ? current : { ...current, machineId: receipt.machineId };
            });
        }
        const { credential } = await this.client.credential(original.machineId!);
        const record = this.update(owner.id, current => {
            if (!current || current.machineId !== original.machineId) throw changed();
            if (current.pending && !replacePending) return current;
            // If another process has just completed a rotation, query again instead of pinning an obsolete CAS value.
            if (current.active.credentialId !== original.active.credentialId) throw changed();
            return { ...current, pending: { token: newToken(), expectedCredentialId: credential.id } };
        });
        const pending = record.pending!;
        const reply = await this.client.replaceCredential(record.machineId!, pending.expectedCredentialId, pending.token);
        await this.client.verifyMachine(pending.token, reply.credential.id);
        const confirmed = this.update(owner.id, current => {
            if (!current || current.machineId !== record.machineId) throw changed();
            if (!current.pending && current.active.token === pending.token) return current;
            if (current.pending?.token !== pending.token) throw changed();
            return { ...current, active: { token: pending.token, credentialId: reply.credential.id }, pending: undefined };
        });
        return this.summary(confirmed, true);
    }
}
