import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { ensureDirectory } from '../config';
import { ResourceError, InspectionSchema, type Flavor, type Inspection, type MachineRegistration, type RuntimeRegistration } from './types';

type MachineRow = Omit<MachineRegistration, 'registered'> & { registered: number };
type RuntimeRow = Omit<RuntimeRegistration, 'registered' | 'inspection'> & { registered: number; inspection: string | null };

/** Authoritative server database. Native machines, heartbeats and sessions stay in HAPI. */
export class ResourceStore {
    private readonly db: Database;
    constructor(path: string) {
        ensureDirectory(dirname(path));
        this.db = new Database(path, { create: true });
        try {
            chmodSync(path, 0o600);
            this.db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;');
            this.db.transaction(() => {
                const { user_version: version } = this.db.query('PRAGMA user_version').get() as { user_version: number };
                if (version > 1) throw new ResourceError(503, 'state_version_newer', '业务数据版本高于当前程序。', '使用创建该数据的新版 Runweft；不要删除数据库。');
                if (version === 1) return;
                this.db.exec(`
                    CREATE TABLE machine_registrations (
                        namespace TEXT NOT NULL, machineId TEXT NOT NULL, registered INTEGER NOT NULL,
                        createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, PRIMARY KEY(namespace, machineId)
                    );
                    CREATE TABLE runtime_registrations (
                        id TEXT PRIMARY KEY, namespace TEXT NOT NULL, machineId TEXT NOT NULL,
                        flavor TEXT NOT NULL CHECK(flavor IN ('codex', 'claude')), name TEXT NOT NULL,
                        registered INTEGER NOT NULL, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL,
                        inspection TEXT, inspectedAt INTEGER,
                        UNIQUE(namespace, machineId, flavor)
                    );
                    PRAGMA user_version=1;
                `);
            }).immediate();
        } catch (error) { this.db.close(); throw error; }
    }
    close() { this.db.close(); }

    machine(namespace: string, machineId: string): MachineRegistration | null {
        const row = this.db.query('SELECT machineId, registered, createdAt, updatedAt FROM machine_registrations WHERE namespace=? AND machineId=?')
            .get(namespace, machineId) as MachineRow | null;
        return row ? { ...row, registered: Boolean(row.registered) } : null;
    }
    registerMachine(namespace: string, machineId: string) {
        const now = Date.now();
        this.db.query(`INSERT INTO machine_registrations VALUES (?, ?, 1, ?, ?)
            ON CONFLICT(namespace, machineId) DO UPDATE SET registered=1, updatedAt=excluded.updatedAt`)
            .run(namespace, machineId, now, now);
        return this.machine(namespace, machineId)!;
    }
    unregisterMachine(namespace: string, machineId: string) {
        return this.db.transaction(() => {
            this.db.query('UPDATE machine_registrations SET registered=0, updatedAt=? WHERE namespace=? AND machineId=?')
                .run(Date.now(), namespace, machineId);
            return this.runtimes(namespace, true).filter(runtime => runtime.machineId === machineId && runtime.registered).map(runtime => runtime.id);
        }).immediate();
    }
    private runtimeFrom(row: RuntimeRow | null): RuntimeRegistration | null {
        if (!row) return null;
        return { ...row, registered: Boolean(row.registered), inspection: row.inspection ? InspectionSchema.parse(JSON.parse(row.inspection)) : null };
    }
    runtime(namespace: string, id: string) {
        return this.runtimeFrom(this.db.query(`SELECT id, machineId, flavor, name, registered, createdAt, updatedAt, inspection
            FROM runtime_registrations WHERE namespace=? AND id=?`).get(namespace, id) as RuntimeRow | null);
    }
    runtimes(namespace: string, all = false): RuntimeRegistration[] {
        const rows = this.db.query(`SELECT id, machineId, flavor, name, registered, createdAt, updatedAt, inspection
            FROM runtime_registrations WHERE namespace=? AND (?=1 OR registered=1) ORDER BY createdAt, id`)
            .all(namespace, all ? 1 : 0) as RuntimeRow[];
        return rows.map(row => this.runtimeFrom(row)!);
    }
    registerRuntime(namespace: string, machineId: string, flavor: Flavor, name: string | undefined, inspection: Inspection) {
        return this.db.transaction(() => {
            // A machine may have been unregistered while the asynchronous native probe was running.
            if (!this.machine(namespace, machineId)?.registered) throw new ResourceError(409, 'machine_unregistered', '机器尚未登记或已取消登记。', '先恢复机器登记，再登记 runtime。');
            const now = Date.now();
            this.db.query(`INSERT INTO runtime_registrations (id, namespace, machineId, flavor, name, registered, createdAt, updatedAt)
                VALUES (?, ?, ?, ?, ?, 1, ?, ?) ON CONFLICT(namespace, machineId, flavor)
                DO UPDATE SET registered=1, name=COALESCE(?, runtime_registrations.name), updatedAt=excluded.updatedAt`)
                .run(randomUUID(), namespace, machineId, flavor, name ?? flavor, now, now, name ?? null);
            this.saveInspection(namespace, machineId, inspection);
            const row = this.db.query('SELECT id FROM runtime_registrations WHERE namespace=? AND machineId=? AND flavor=?')
                .get(namespace, machineId, flavor) as { id: string };
            return this.runtime(namespace, row.id)!;
        }).immediate();
    }
    saveInspection(namespace: string, machineId: string, inspection: Inspection) {
        this.db.query(`UPDATE runtime_registrations SET inspection=?, inspectedAt=?
            WHERE namespace=? AND machineId=? AND flavor=? AND (inspectedAt IS NULL OR inspectedAt<=?)`)
            .run(JSON.stringify(inspection), inspection.details.checkedAt, namespace, machineId, inspection.agent, inspection.details.checkedAt);
    }
    renameRuntime(namespace: string, id: string, name: string) {
        this.db.query('UPDATE runtime_registrations SET name=?, updatedAt=? WHERE namespace=? AND id=?').run(name, Date.now(), namespace, id);
    }
    unregisterRuntime(namespace: string, id: string) {
        this.db.query('UPDATE runtime_registrations SET registered=0, updatedAt=? WHERE namespace=? AND id=?').run(Date.now(), namespace, id);
    }
}
