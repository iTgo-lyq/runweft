import { Database, SQLiteError } from 'bun:sqlite';
import { chmodSync, copyFileSync, existsSync, linkSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { ensureDirectory } from './config';
import { ResourceError } from './resources/types';

export const STATE_SCHEMA_VERSION = 19;

/** The only supported business format. Native history remains owned by HAPI. */
const schema = `
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
CREATE TABLE delegation_artifact_intents (
    namespace TEXT NOT NULL, requestId TEXT NOT NULL, fingerprint TEXT NOT NULL,
    data TEXT NOT NULL, taskId TEXT REFERENCES delegation_tasks(id), createdAt INTEGER NOT NULL,
    PRIMARY KEY(namespace, requestId)
);
CREATE TABLE delegation_artifact_manifests (
    taskId TEXT NOT NULL REFERENCES delegation_tasks(id), roundId TEXT NOT NULL REFERENCES delegation_rounds(id),
    version INTEGER NOT NULL, jobId TEXT NOT NULL UNIQUE, data TEXT NOT NULL,
    PRIMARY KEY(taskId, roundId, version)
);
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
    leaseKey TEXT NOT NULL DEFAULT 'manual',
    PRIMARY KEY(credentialId, kind, objectId, operation, leaseKey),
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
CREATE TABLE hub_file_reservations (
    id TEXT PRIMARY KEY, sender TEXT NOT NULL, requestId TEXT NOT NULL,
    ownerId TEXT NOT NULL REFERENCES hub_users(id), spaceId TEXT REFERENCES hub_spaces(id),
    taskId TEXT, machineId TEXT, filename TEXT NOT NULL, reference TEXT,
    fingerprint TEXT, artifactId TEXT, cancelledAt INTEGER,
    UNIQUE(sender, requestId)
);
CREATE TABLE hub_native_session_claims (
    field TEXT NOT NULL, nativeId TEXT NOT NULL,
    ownerId TEXT NOT NULL REFERENCES hub_users(id), spaceId TEXT REFERENCES hub_spaces(id), machineId TEXT NOT NULL,
    PRIMARY KEY(field, nativeId)
);
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
CREATE TABLE hub_resource_runtimes (
    id TEXT PRIMARY KEY, machineId TEXT NOT NULL REFERENCES hub_resource_machines(machineId),
    flavor TEXT NOT NULL CHECK(flavor IN ('codex', 'claude')), name TEXT NOT NULL,
    registered INTEGER NOT NULL CHECK(registered IN (0, 1)),
    inspection TEXT, inspectedAt INTEGER, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL,
    UNIQUE(machineId, flavor), UNIQUE(id, machineId)
);
CREATE TABLE hub_runtime_shares (
    runtimeId TEXT NOT NULL, machineId TEXT NOT NULL, spaceId TEXT NOT NULL,
    createdAt INTEGER NOT NULL, PRIMARY KEY(runtimeId, spaceId),
    FOREIGN KEY(runtimeId, machineId) REFERENCES hub_resource_runtimes(id, machineId),
    FOREIGN KEY(machineId, spaceId) REFERENCES hub_machine_spaces(machineId, spaceId) ON DELETE CASCADE
);
CREATE TABLE hub_resource_blocks (
    spaceId TEXT NOT NULL REFERENCES hub_spaces(id), kind TEXT NOT NULL CHECK(kind IN ('machine', 'runtime')),
    objectId TEXT NOT NULL, actorId TEXT NOT NULL REFERENCES hub_users(id), createdAt INTEGER NOT NULL,
    PRIMARY KEY(spaceId, kind, objectId)
);
CREATE TABLE hub_repositories (
    id TEXT PRIMARY KEY, spaceId TEXT NOT NULL REFERENCES hub_spaces(id), ownerId TEXT NOT NULL REFERENCES hub_users(id),
    name TEXT NOT NULL, registered INTEGER NOT NULL CHECK(registered IN (0, 1)),
    requestId TEXT NOT NULL, fingerprint TEXT NOT NULL, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL,
    UNIQUE(ownerId, requestId), UNIQUE(id, spaceId)
);
CREATE INDEX hub_repository_space ON hub_repositories(spaceId);
CREATE TABLE hub_repository_aliases (
    spaceId TEXT NOT NULL, canonicalKey TEXT NOT NULL, repositoryId TEXT NOT NULL,
    displayUrl TEXT NOT NULL, descriptor TEXT NOT NULL, PRIMARY KEY(spaceId, canonicalKey),
    FOREIGN KEY(repositoryId, spaceId) REFERENCES hub_repositories(id, spaceId)
);
CREATE TABLE hub_checkouts (
    ownerId TEXT NOT NULL REFERENCES hub_users(id), spaceId TEXT NOT NULL, machineId TEXT NOT NULL REFERENCES hub_resource_machines(machineId),
    gitCommonDir TEXT NOT NULL, repositoryId TEXT NOT NULL, remoteFingerprint TEXT NOT NULL,
    repositoryRoot TEXT NOT NULL, cwd TEXT NOT NULL, objectFormat TEXT NOT NULL CHECK(objectFormat IN ('sha1', 'sha256')),
    createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL,
    PRIMARY KEY(ownerId, spaceId, machineId, gitCommonDir),
    FOREIGN KEY(repositoryId, spaceId) REFERENCES hub_repositories(id, spaceId)
);
CREATE TABLE hub_agents (
    id TEXT PRIMARY KEY, ownerId TEXT NOT NULL REFERENCES hub_users(id), spaceId TEXT NOT NULL REFERENCES hub_spaces(id),
    repositoryId TEXT, currentVersion INTEGER NOT NULL, registered INTEGER NOT NULL CHECK(registered IN (0, 1)),
    accessMode TEXT NOT NULL CHECK(accessMode IN ('private', 'members', 'space')),
    requestId TEXT NOT NULL, fingerprint TEXT NOT NULL, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL,
    UNIQUE(ownerId, requestId), UNIQUE(id, spaceId),
    FOREIGN KEY(repositoryId, spaceId) REFERENCES hub_repositories(id, spaceId)
);
CREATE INDEX hub_agent_space ON hub_agents(spaceId);
CREATE TABLE hub_agent_versions (
    agentId TEXT NOT NULL REFERENCES hub_agents(id), version INTEGER NOT NULL,
    definition TEXT NOT NULL, contentHash TEXT NOT NULL, createdAt INTEGER NOT NULL,
    PRIMARY KEY(agentId, version)
);
CREATE TABLE hub_agent_members (
    agentId TEXT NOT NULL, spaceId TEXT NOT NULL, userId TEXT NOT NULL,
    PRIMARY KEY(agentId, userId),
    FOREIGN KEY(agentId, spaceId) REFERENCES hub_agents(id, spaceId),
    FOREIGN KEY(spaceId, userId) REFERENCES hub_memberships(spaceId, userId) ON DELETE CASCADE
);
CREATE TABLE hub_agent_blocks (
    agentId TEXT PRIMARY KEY REFERENCES hub_agents(id), actorId TEXT NOT NULL REFERENCES hub_users(id), createdAt INTEGER NOT NULL
);
CREATE TABLE hub_agent_selections (
    userId TEXT NOT NULL, spaceId TEXT NOT NULL, repositoryId TEXT, agentId TEXT NOT NULL,
    runtimeId TEXT REFERENCES hub_resource_runtimes(id), createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL,
    FOREIGN KEY(spaceId, userId) REFERENCES hub_memberships(spaceId, userId) ON DELETE CASCADE,
    FOREIGN KEY(repositoryId, spaceId) REFERENCES hub_repositories(id, spaceId),
    FOREIGN KEY(agentId, spaceId) REFERENCES hub_agents(id, spaceId)
);
CREATE UNIQUE INDEX hub_agent_selection_scope ON hub_agent_selections(userId, spaceId, COALESCE(repositoryId, ''));
CREATE TABLE hub_delegation_scopes (
    namespace TEXT PRIMARY KEY, ownerId TEXT NOT NULL REFERENCES hub_users(id),
    spaceId TEXT NOT NULL REFERENCES hub_spaces(id), UNIQUE(ownerId, spaceId)
);
CREATE TABLE hub_connection_requests (
    id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, origin TEXT NOT NULL, label TEXT NOT NULL,
    publicKey TEXT NOT NULL, pollingDigest TEXT NOT NULL, code TEXT NOT NULL,
    createdAt INTEGER NOT NULL, expiresAt INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending', 'confirmed', 'consumed', 'cancelled')),
    ownerId TEXT REFERENCES hub_users(id), spaceId TEXT REFERENCES hub_spaces(id),
    identityDigest TEXT, ciphertext TEXT
);
PRAGMA user_version=19;
`;
type SchemaRow = { type: string; name: string; tbl_name: string; sql: string | null };
function structure(db: Database) {
    return (db.query("SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type, name").all() as SchemaRow[])
        .map(row => ({ ...row, sql: row.sql?.replace(/\s+/g, ' ').trim() ?? null }));
}
const clientSchema = `CREATE TABLE claude_mcp_calls (callId TEXT PRIMARY KEY, sessionId TEXT NOT NULL, cwd TEXT NOT NULL, agentId TEXT, createdAt INTEGER NOT NULL); PRAGMA user_version=1;`;
function schemaStructure(sql: string) {
    const reference = new Database(':memory:');
    try { reference.exec(sql); return JSON.stringify(structure(reference)); } finally { reference.close(); }
}
const expectedStructure = schemaStructure(schema), expectedClientStructure = schemaStructure(clientSchema);
type StateKind = 'hub' | 'client';
function formatError(code: 'state_format_unsupported' | 'state_format_invalid') {
    return new ResourceError(503, code, code === 'state_format_unsupported' ? '业务数据库不是当前支持的格式。' : '业务数据库损坏或结构无效。',
        '使用独立的新 Runweft home；原目录保持不变，请自行保管。');
}
/** Check fixed format metadata on a private DB/WAL copy; opening the original readonly can modify SHM.
 * This copy is not a transactional backup of concurrently changing business rows. */
export function validateState(path: string, kind: StateKind = 'hub') {
    if (!existsSync(path)) return;
    const root = mkdtempSync(join(tmpdir(), 'runweft-state-check-'));
    let db: Database | undefined;
    try {
        const copy = join(root, 'state.sqlite');
        copyFileSync(path, copy);
        try { copyFileSync(path + '-wal', copy + '-wal'); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        db = new Database(copy, { readonly: true });
        const version = (db.query('PRAGMA user_version').get() as { user_version: number }).user_version;
        if (version !== (kind === 'hub' ? STATE_SCHEMA_VERSION : 1)) throw formatError('state_format_unsupported');
        if (JSON.stringify(structure(db)) !== (kind === 'hub' ? expectedStructure : expectedClientStructure)) throw formatError('state_format_invalid');
    } catch (error) {
        if (error instanceof SQLiteError && [11, 26].includes(error.errno & 0xff)) throw formatError('state_format_invalid');
        throw error;
    } finally { try { db?.close(); } finally { rmSync(root, { recursive: true, force: true }); } }
}

export function openState(path: string, kind: StateKind = 'hub') {
    validateState(path, kind);
    if (!existsSync(path)) {
        ensureDirectory(dirname(path));
        const root = mkdtempSync(join(dirname(path), '.state-create-'));
        let fresh: Database | undefined;
        try {
            const temporary = join(root, 'state.sqlite');
            fresh = new Database(temporary, { create: true });
            fresh.exec(kind === 'hub' ? schema : clientSchema); fresh.close(); fresh = undefined;
            chmodSync(temporary, 0o600);
            try { linkSync(temporary, path); }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
        } finally { try { fresh?.close(); } finally { rmSync(root, { recursive: true, force: true }); } }
        validateState(path, kind); // A concurrent creator may have won; never overwrite its file.
    }
    const db = new Database(path, { readwrite: true, create: false });
    try {
        db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
        return db;
    } catch (error) { db.close(); throw error; }
}
