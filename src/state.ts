import { Database } from 'bun:sqlite';
import { chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { ensureDirectory } from './config';
import { ResourceError } from './resources/types';

export const STATE_SCHEMA_VERSION = 11;

/** One additive schema for the central business database; native history stays in HAPI. */
export function openState(path: string) {
    ensureDirectory(dirname(path));
    const db = new Database(path, { create: true });
    try {
        chmodSync(path, 0o600);
        db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
        db.transaction(() => {
            const { user_version: version } = db.query('PRAGMA user_version').get() as { user_version: number };
            if (version > STATE_SCHEMA_VERSION) throw new ResourceError(503, 'state_version_newer', '业务数据版本高于当前程序。', '使用创建该数据的新版 Runweft；不要删除数据库。');
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
            if (version < 6) db.exec(`
                CREATE TABLE delegation_code_manifests (
                    taskId TEXT NOT NULL REFERENCES delegation_tasks(id), roundId TEXT NOT NULL REFERENCES delegation_rounds(id),
                    version INTEGER NOT NULL, jobId TEXT NOT NULL UNIQUE, data TEXT NOT NULL,
                    PRIMARY KEY(taskId, roundId, version)
                );
                CREATE TABLE delegation_code_fetches (
                    id TEXT PRIMARY KEY, taskId TEXT NOT NULL REFERENCES delegation_tasks(id),
                    roundId TEXT NOT NULL REFERENCES delegation_rounds(id), status TEXT NOT NULL, data TEXT NOT NULL
                );
                CREATE INDEX delegation_code_fetch_task ON delegation_code_fetches(taskId);
                PRAGMA user_version=6;
            `);
            if (version < 7) db.exec(`
                CREATE TABLE hub_users (
                    id TEXT PRIMARY KEY, name TEXT NOT NULL, tokenDigest TEXT NOT NULL UNIQUE,
                    createdAt INTEGER NOT NULL
                );
                CREATE TABLE hub_spaces (
                    id TEXT PRIMARY KEY, name TEXT NOT NULL, createdAt INTEGER NOT NULL
                );
                CREATE TABLE hub_memberships (
                    spaceId TEXT NOT NULL REFERENCES hub_spaces(id), userId TEXT NOT NULL REFERENCES hub_users(id),
                    role TEXT NOT NULL CHECK(role IN ('owner', 'admin', 'member')), joinedAt INTEGER NOT NULL,
                    PRIMARY KEY(spaceId, userId)
                );
                CREATE INDEX hub_membership_user ON hub_memberships(userId);
                CREATE TABLE hub_invitations (
                    id TEXT PRIMARY KEY, spaceId TEXT NOT NULL REFERENCES hub_spaces(id),
                    tokenDigest TEXT NOT NULL UNIQUE, createdBy TEXT NOT NULL REFERENCES hub_users(id),
                    role TEXT NOT NULL CHECK(role IN ('admin', 'member')), createdAt INTEGER NOT NULL,
                    expiresAt INTEGER NOT NULL, consumedBy TEXT REFERENCES hub_users(id),
                    consumedAt INTEGER, revokedAt INTEGER
                );
                CREATE INDEX hub_invitation_space ON hub_invitations(spaceId);
                PRAGMA user_version=7;
            `);
            if (version < 8) db.exec(`
                CREATE TABLE hub_execution_objects (
                    kind TEXT NOT NULL CHECK(kind IN ('machine', 'task', 'session', 'artifact')),
                    id TEXT NOT NULL, ownerId TEXT NOT NULL REFERENCES hub_users(id),
                    spaceId TEXT REFERENCES hub_spaces(id), taskId TEXT, machineId TEXT,
                    retiredAt INTEGER, createdAt INTEGER NOT NULL, PRIMARY KEY(kind, id)
                );
                CREATE INDEX hub_execution_object_owner ON hub_execution_objects(ownerId, spaceId, kind);
                CREATE TABLE hub_execution_credentials (
                    id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('machine', 'task')),
                    ownerId TEXT NOT NULL REFERENCES hub_users(id), machineId TEXT NOT NULL,
                    spaceId TEXT REFERENCES hub_spaces(id), taskId TEXT,
                    tokenDigest TEXT NOT NULL UNIQUE, createdAt INTEGER NOT NULL,
                    expiresAt INTEGER, revokedAt INTEGER
                );
                CREATE INDEX hub_execution_credential_machine ON hub_execution_credentials(machineId, kind);
                CREATE TABLE hub_execution_grants (
                    credentialId TEXT NOT NULL REFERENCES hub_execution_credentials(id),
                    kind TEXT NOT NULL, objectId TEXT NOT NULL,
                    operation TEXT NOT NULL CHECK(operation IN ('read', 'write')),
                    PRIMARY KEY(credentialId, kind, objectId, operation),
                    FOREIGN KEY(kind, objectId) REFERENCES hub_execution_objects(kind, id)
                );
                CREATE TABLE hub_execution_intents (
                    id TEXT PRIMARY KEY, requestKey TEXT NOT NULL, ownerId TEXT NOT NULL REFERENCES hub_users(id),
                    spaceId TEXT REFERENCES hub_spaces(id), taskId TEXT, machineId TEXT NOT NULL,
                    sourceSessionId TEXT, operation TEXT NOT NULL CHECK(operation IN ('spawn', 'resume', 'reopen', 'fork', 'clear')),
                    fingerprint TEXT NOT NULL, createdAt INTEGER NOT NULL, expiresAt INTEGER NOT NULL,
                    sessionId TEXT, cancelledAt INTEGER, UNIQUE(ownerId, requestKey)
                );
                CREATE INDEX hub_execution_intent_machine ON hub_execution_intents(machineId, expiresAt);
                PRAGMA user_version=8;
            `);
            if (version < 9) db.exec(`
                CREATE TABLE hub_file_reservations (
                    id TEXT PRIMARY KEY, sender TEXT NOT NULL, requestId TEXT NOT NULL,
                    ownerId TEXT NOT NULL REFERENCES hub_users(id), spaceId TEXT REFERENCES hub_spaces(id),
                    taskId TEXT, machineId TEXT, filename TEXT NOT NULL, reference TEXT,
                    fingerprint TEXT, artifactId TEXT, cancelledAt INTEGER,
                    UNIQUE(sender, requestId)
                );
                PRAGMA user_version=9;
            `);
            if (version < 10) db.exec(`
                CREATE TABLE hub_native_session_claims (
                    field TEXT NOT NULL, nativeId TEXT NOT NULL,
                    ownerId TEXT NOT NULL REFERENCES hub_users(id), spaceId TEXT REFERENCES hub_spaces(id), machineId TEXT NOT NULL,
                    PRIMARY KEY(field, nativeId)
                );
                PRAGMA user_version=10;
            `);
            if (version < 11) db.exec(`
                CREATE TABLE hub_resource_machines (
                    machineId TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'machine' CHECK(kind='machine'),
                    requestId TEXT NOT NULL, fingerprint TEXT NOT NULL,
                    enrollmentCredentialId TEXT NOT NULL REFERENCES hub_execution_credentials(id),
                    currentCredentialId TEXT NOT NULL REFERENCES hub_execution_credentials(id),
                    name TEXT, registered INTEGER NOT NULL CHECK(registered IN (0, 1)),
                    createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL,
                    FOREIGN KEY(kind, machineId) REFERENCES hub_execution_objects(kind, id)
                );
                CREATE INDEX hub_resource_machine_request ON hub_resource_machines(requestId);
                CREATE TABLE hub_machine_spaces (
                    machineId TEXT NOT NULL REFERENCES hub_resource_machines(machineId),
                    spaceId TEXT NOT NULL REFERENCES hub_spaces(id), createdAt INTEGER NOT NULL,
                    PRIMARY KEY(machineId, spaceId)
                );
                PRAGMA user_version=11;
            `);
        }).immediate();
        return db;
    } catch (error) { db.close(); throw error; }
}
