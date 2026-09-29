import { Database } from 'bun:sqlite';
import { chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { ensureDirectory } from './config';
import { ResourceError } from './resources/types';

/** One additive schema for the central business database; native history stays in HAPI. */
export function openState(path: string) {
    ensureDirectory(dirname(path));
    const db = new Database(path, { create: true });
    try {
        chmodSync(path, 0o600);
        db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
        db.transaction(() => {
            const { user_version: version } = db.query('PRAGMA user_version').get() as { user_version: number };
            if (version > 5) throw new ResourceError(503, 'state_version_newer', '业务数据版本高于当前程序。', '使用创建该数据的新版 Runweft；不要删除数据库。');
            if (version < 1) db.exec(`
                CREATE TABLE machine_registrations (
                    namespace TEXT NOT NULL, machineId TEXT NOT NULL, registered INTEGER NOT NULL,
                    createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, PRIMARY KEY(namespace, machineId)
                );
                CREATE TABLE runtime_registrations (
                    id TEXT PRIMARY KEY, namespace TEXT NOT NULL, machineId TEXT NOT NULL,
                    flavor TEXT NOT NULL CHECK(flavor IN ('codex', 'claude')), name TEXT NOT NULL,
                    registered INTEGER NOT NULL, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL,
                    inspection TEXT, inspectedAt INTEGER, UNIQUE(namespace, machineId, flavor)
                );
            `);
            if (version < 2) db.exec(`
                CREATE TABLE delegation_tasks (
                    id TEXT PRIMARY KEY, namespace TEXT NOT NULL, parentKey TEXT NOT NULL,
                    machineId TEXT NOT NULL, cwd TEXT NOT NULL, data TEXT NOT NULL,
                    revision INTEGER NOT NULL, updatedAt INTEGER NOT NULL
                );
                CREATE INDEX delegation_parent ON delegation_tasks(namespace, parentKey, updatedAt);
                CREATE TABLE delegation_rounds (
                    id TEXT PRIMARY KEY, taskId TEXT NOT NULL REFERENCES delegation_tasks(id),
                    ordinal INTEGER NOT NULL, phase TEXT NOT NULL, data TEXT NOT NULL,
                    completedRevision INTEGER, UNIQUE(taskId, ordinal)
                );
                CREATE INDEX delegation_pending ON delegation_rounds(phase);
                CREATE TABLE delegation_inputs (
                    id TEXT PRIMARY KEY, roundId TEXT NOT NULL REFERENCES delegation_rounds(id), data TEXT NOT NULL
                );
                CREATE TABLE delegation_requests (
                    namespace TEXT NOT NULL, requestId TEXT NOT NULL, fingerprint TEXT NOT NULL,
                    taskId TEXT NOT NULL REFERENCES delegation_tasks(id), roundId TEXT NOT NULL REFERENCES delegation_rounds(id),
                    accepted TEXT NOT NULL, createdAt INTEGER NOT NULL, PRIMARY KEY(namespace, requestId)
                );
                CREATE TABLE delegation_sessions (
                    namespace TEXT NOT NULL, hapiId TEXT NOT NULL, nativeId TEXT NOT NULL, flavor TEXT NOT NULL,
                    taskId TEXT NOT NULL REFERENCES delegation_tasks(id), roundId TEXT NOT NULL REFERENCES delegation_rounds(id),
                    PRIMARY KEY(namespace, hapiId, nativeId, roundId)
                );
                CREATE INDEX delegation_child_native ON delegation_sessions(namespace, flavor, nativeId);
                PRAGMA user_version=2;
            `);
            if (version < 3) db.exec(`
                CREATE TABLE delegation_artifact_intents (
                    namespace TEXT NOT NULL, requestId TEXT NOT NULL, fingerprint TEXT NOT NULL,
                    data TEXT NOT NULL, taskId TEXT REFERENCES delegation_tasks(id), createdAt INTEGER NOT NULL,
                    PRIMARY KEY(namespace, requestId)
                );
                PRAGMA user_version=3;
            `);
            if (version < 4) db.exec(`
                CREATE TABLE delegation_artifact_manifests (
                    taskId TEXT NOT NULL REFERENCES delegation_tasks(id), roundId TEXT NOT NULL REFERENCES delegation_rounds(id),
                    version INTEGER NOT NULL, jobId TEXT NOT NULL UNIQUE, data TEXT NOT NULL,
                    PRIMARY KEY(taskId, roundId, version)
                );
                PRAGMA user_version=4;
            `);
            if (version < 5) db.exec(`
                CREATE TABLE repository_snapshots (
                    id TEXT PRIMARY KEY, namespace TEXT NOT NULL, repositoryId TEXT NOT NULL,
                    baseCommit TEXT NOT NULL, generation INTEGER NOT NULL, phase TEXT NOT NULL, data TEXT NOT NULL,
                    UNIQUE(namespace, repositoryId, baseCommit, generation)
                );
                CREATE TABLE repository_imports (
                    id TEXT PRIMARY KEY, snapshotId TEXT NOT NULL REFERENCES repository_snapshots(id),
                    machineId TEXT NOT NULL, generation INTEGER NOT NULL, phase TEXT NOT NULL, data TEXT NOT NULL,
                    UNIQUE(snapshotId, machineId, generation)
                );
                CREATE TABLE repository_consumers (
                    id TEXT PRIMARY KEY, namespace TEXT NOT NULL, snapshotId TEXT NOT NULL REFERENCES repository_snapshots(id),
                    importId TEXT NOT NULL REFERENCES repository_imports(id), kind TEXT NOT NULL,
                    owner TEXT NOT NULL, active INTEGER NOT NULL, data TEXT NOT NULL
                );
                CREATE TABLE repository_lfs (
                    namespace TEXT NOT NULL, oid TEXT NOT NULL, size INTEGER NOT NULL, artifactId TEXT NOT NULL,
                    PRIMARY KEY(namespace, oid, size)
                );
                CREATE TABLE workspace_preparations (
                    id TEXT PRIMARY KEY, namespace TEXT NOT NULL, requestId TEXT NOT NULL, parentKey TEXT NOT NULL,
                    machineId TEXT NOT NULL, cwd TEXT NOT NULL, fingerprint TEXT NOT NULL,
                    phase TEXT NOT NULL, updatedAt INTEGER NOT NULL, data TEXT NOT NULL,
                    UNIQUE(namespace, requestId)
                );
                PRAGMA user_version=5;
            `);
        }).immediate();
        return db;
    } catch (error) { db.close(); throw error; }
}
