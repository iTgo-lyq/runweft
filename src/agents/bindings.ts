import { Database } from 'bun:sqlite';
import { chmodSync, existsSync } from 'node:fs';
import { connectionName, dataPaths, ensureDirectory, type ResolvedConfig } from '../config';

export type AgentBinding = { sourceKey: string; connectionName: string; namespace: string; runtimeId: string; updatedAt: number };
const table = 'agent_runtime_bindings';

export function agentBindings(c: ResolvedConfig, sourceKey?: string): AgentBinding[] {
    const path = dataPaths(c).bindings;
    if (!existsSync(path)) return [];
    const db = new Database(path, { readonly: true });
    try {
        if (!db.query("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)) return [];
        return (sourceKey === undefined
            ? db.query(`SELECT * FROM ${table} WHERE connectionName=? ORDER BY sourceKey,namespace`).all(connectionName(c.config))
            : db.query(`SELECT * FROM ${table} WHERE connectionName=? AND sourceKey=? ORDER BY namespace`).all(connectionName(c.config), sourceKey)) as AgentBinding[];
    } finally { db.close(); }
}
export function saveAgentBinding(c: ResolvedConfig, sourceKey: string, namespace: string, runtimeId: string) {
    ensureDirectory(c.home);
    const path = dataPaths(c).bindings, db = new Database(path, { create: true });
    try {
        chmodSync(path, 0o600);
        db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
            CREATE TABLE IF NOT EXISTS ${table} (sourceKey TEXT NOT NULL, connectionName TEXT NOT NULL, namespace TEXT NOT NULL, runtimeId TEXT NOT NULL, updatedAt INTEGER NOT NULL, PRIMARY KEY(sourceKey,connectionName,namespace));`);
        const binding: AgentBinding = { sourceKey, connectionName: connectionName(c.config), namespace, runtimeId, updatedAt: Date.now() };
        db.query(`INSERT INTO ${table} VALUES (?,?,?,?,?) ON CONFLICT(sourceKey,connectionName,namespace) DO UPDATE SET runtimeId=excluded.runtimeId,updatedAt=excluded.updatedAt`)
            .run(binding.sourceKey, binding.connectionName, binding.namespace, binding.runtimeId, binding.updatedAt);
        return binding;
    } finally { db.close(); }
}
export function removeAgentBinding(c: ResolvedConfig, sourceKey: string, namespace: string) {
    if (!agentBindings(c, sourceKey).some(binding => binding.namespace === namespace)) return false;
    const db = new Database(dataPaths(c).bindings);
    try {
        db.exec('PRAGMA busy_timeout=5000;');
        return db.query(`DELETE FROM ${table} WHERE sourceKey=? AND connectionName=? AND namespace=?`).run(sourceKey, connectionName(c.config), namespace).changes > 0;
    } finally { db.close(); }
}
