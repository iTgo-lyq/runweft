import type { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import type { WorkspaceSource } from '../../hapi/shared/src/workspaces';
import { contentVersion } from '../agents/definitions';
import { openState } from '../state';
import { parentKey, type Parent } from '../tasks/types';
import { PreparationError, type BaselineConsumer, type BaselineImport, type BaselineSnapshot,
    type Preparation, type PreparationIntent, type Selection } from './types';

const read = <T>(row: { data: string }): T => JSON.parse(row.data);
const fingerprint = (parent: Parent, intent: PreparationIntent) => contentVersion({ parent: parentKey(parent), machineId: parent.machineId, cwd: parent.cwd, intent });
export class BaselineStore {
    private readonly db;
    constructor(path: string, private readonly options?: { db: Database; ownsScope: (namespace: string) => boolean }) { this.db = options?.db ?? openState(path); }
    close() { if (!this.options) this.db.close(); }
    private owns(namespace: string) { return this.options?.ownsScope(namespace) ?? true; }
    snapshot(id: string): BaselineSnapshot { return read(this.db.query('SELECT data FROM repository_snapshots WHERE id=?').get(id) as { data: string }); }
    latest(namespace: string, origin: WorkspaceSource): BaselineSnapshot | null {
        const row = this.db.query('SELECT data FROM repository_snapshots WHERE namespace=? AND repositoryId=? AND baseCommit=? ORDER BY generation DESC LIMIT 1')
            .get(namespace, origin.repositoryId, origin.baseCommit) as { data: string } | null;
        return row ? read(row) : null;
    }
    createSnapshot(namespace: string, origin: WorkspaceSource) {
        const record: BaselineSnapshot = { id: randomUUID(), namespace, origin, generation: (this.latest(namespace, origin)?.generation ?? 0) + 1,
            phase: 'exporting', stage: 'export', exportId: randomUUID(), exportAttempted: false, sourceReleased: false, createdAt: Date.now(), updatedAt: Date.now() };
        this.db.query('INSERT INTO repository_snapshots VALUES (?, ?, ?, ?, ?, ?, ?)').run(record.id, namespace, origin.repositoryId, origin.baseCommit, record.generation, record.phase, JSON.stringify(record));
        return record;
    }
    saveSnapshot(record: BaselineSnapshot) {
        record.updatedAt = Date.now(); this.db.query('UPDATE repository_snapshots SET phase=?, data=? WHERE id=?').run(record.phase, JSON.stringify(record), record.id);
    }
    snapshots() { return (this.db.query('SELECT data FROM repository_snapshots').all() as { data: string }[]).map(read<BaselineSnapshot>).filter(row => this.owns(row.namespace)); }
    imported(id: string): BaselineImport { return read(this.db.query('SELECT data FROM repository_imports WHERE id=?').get(id) as { data: string }); }
    latestImport(snapshotId: string, machineId: string): BaselineImport | null {
        const row = this.db.query('SELECT data FROM repository_imports WHERE snapshotId=? AND machineId=? ORDER BY generation DESC LIMIT 1').get(snapshotId, machineId) as { data: string } | null;
        return row ? read(row) : null;
    }
    consumers(snapshotId: string) { return (this.db.query('SELECT data FROM repository_consumers WHERE snapshotId=? AND active=1').all(snapshotId) as { data: string }[]).map(read<BaselineConsumer>); }
    imports() { return (this.db.query('SELECT data FROM repository_imports').all() as { data: string }[]).map(read<BaselineImport>).filter(row => this.owns(row.namespace)); }
    saveImport(record: BaselineImport) {
        record.updatedAt = Date.now(); this.db.query('UPDATE repository_imports SET phase=?, data=? WHERE id=?').run(record.phase, JSON.stringify(record), record.id);
    }
    consumer(id: string): BaselineConsumer { return read(this.db.query('SELECT data FROM repository_consumers WHERE id=?').get(id) as { data: string }); }
    releaseConsumer(consumer: BaselineConsumer) {
        consumer.active = false; this.db.query('UPDATE repository_consumers SET active=0, data=? WHERE id=?').run(JSON.stringify(consumer), consumer.id);
    }
    consumerForOwner(namespace: string, kind: BaselineConsumer['kind'], owner: string): BaselineConsumer | null {
        const row = this.db.query('SELECT data FROM repository_consumers WHERE namespace=? AND kind=? AND owner=? ORDER BY rowid LIMIT 1')
            .get(namespace, kind, owner) as { data: string } | null;
        return row ? read(row) : null;
    }
    consume(snapshot: BaselineSnapshot, machineId: string, origin: WorkspaceSource, kind: BaselineConsumer['kind'], owner: string): BaselineConsumer {
        const previous = this.consumerForOwner(snapshot.namespace, kind, owner);
        if (previous) {
            if (!previous.active || previous.snapshotId !== snapshot.id || this.imported(previous.importId).machineId !== machineId) throw new PreparationError(409, 'baseline_consumer_conflict', '此消费者已绑定其他基线或已释放。');
            return previous;
        }
        const prior = this.latestImport(snapshot.id, machineId);
        let imported: BaselineImport;
        if (prior && prior.phase !== 'failed' && (!prior.retention || prior.retention === 'retained')) imported = prior;
        else {
            imported = { id: randomUUID(), snapshotId: snapshot.id, namespace: snapshot.namespace, machineId, generation: (prior?.generation ?? 0) + 1, phase: 'importing', operationId: randomUUID(), attempted: false, updatedAt: Date.now() };
            this.db.query('INSERT INTO repository_imports VALUES (?, ?, ?, ?, ?, ?)').run(imported.id, snapshot.id, machineId, imported.generation, imported.phase, JSON.stringify(imported));
        }
        const consumer: BaselineConsumer = { id: randomUUID(), namespace: snapshot.namespace, snapshotId: snapshot.id, importId: imported.id, kind, owner, origin, snapshotReused: snapshot.phase === 'available', active: true, createdAt: Date.now() };
        this.db.query('INSERT INTO repository_consumers VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(consumer.id, consumer.namespace, consumer.snapshotId, consumer.importId, kind, owner, 1, JSON.stringify(consumer));
        return consumer;
    }
    lfs(namespace: string, oid: string, size: number) {
        return (this.db.query('SELECT artifactId FROM repository_lfs WHERE namespace=? AND oid=? AND size=?').get(namespace, oid, size) as { artifactId: string } | null)?.artifactId;
    }
    rememberLfs(namespace: string, oid: string, size: number, artifactId: string) {
        this.db.query('INSERT INTO repository_lfs VALUES (?, ?, ?, ?) ON CONFLICT(namespace, oid, size) DO UPDATE SET artifactId=excluded.artifactId').run(namespace, oid, size, artifactId);
    }
    lookup(namespace: string, parent: Parent, requestId: string, intent: PreparationIntent): Preparation | null {
        const row = this.db.query('SELECT fingerprint, data FROM workspace_preparations WHERE namespace=? AND requestId=?').get(namespace, requestId) as { fingerprint: string; data: string } | null;
        if (!row) return null;
        if (row.fingerprint !== fingerprint(parent, intent)) throw new PreparationError(409, 'preparation_request_conflict', '同一 request ID 已用于不同准备请求。', '查询原记录；新的准备使用新的 request ID。');
        return read(row);
    }
    accept(namespace: string, parent: Parent, requestId: string, intent: PreparationIntent, agent: Selection, origin: WorkspaceSource, snapshot: BaselineSnapshot) {
        return this.db.transaction(() => {
            const previous = this.lookup(namespace, parent, requestId, intent); if (previous) return previous;
            const id = randomUUID(), consumer = this.consume(snapshot, agent.machineId, origin, 'diagnostic', id);
            const record: Preparation = { id, namespace, parent, requestId, intent, agent, origin, consumerId: consumer.id,
                environmentId: randomUUID(), preparationId: randomUUID(), attempted: false, phase: 'preparing', createdAt: Date.now(), updatedAt: Date.now() };
            this.db.query('INSERT INTO workspace_preparations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
                .run(id, namespace, requestId, parentKey(parent), parent.machineId, parent.cwd, fingerprint(parent, intent), record.phase, record.updatedAt, JSON.stringify(record));
            return record;
        }).immediate();
    }
    preparation(namespace: string, id: string, parent?: Parent): Preparation {
        const row = this.db.query('SELECT data FROM workspace_preparations WHERE namespace=? AND id=?').get(namespace, id) as { data: string } | null;
        if (!row) throw new PreparationError(404, 'preparation_unknown', '当前连接中找不到此准备记录。', '运行 runweft workspace preparations --all 检查 ID。');
        const record = read<Preparation>(row);
        if (parent?.kind === 'mcp' && parentKey(record.parent) !== parentKey(parent)) throw new PreparationError(403, 'preparation_parent_mismatch', '准备记录不属于当前主会话。');
        return record;
    }
    savePreparation(record: Preparation) {
        record.updatedAt = Date.now(); this.db.query('UPDATE workspace_preparations SET phase=?, updatedAt=?, data=? WHERE id=?').run(record.phase, record.updatedAt, JSON.stringify(record), record.id);
    }
    preparations(namespace?: string, parent?: Parent, all = false): Preparation[] {
        return (this.db.query('SELECT data FROM workspace_preparations ORDER BY updatedAt DESC, id').all() as { data: string }[]).map(read<Preparation>)
            .filter(record => this.owns(record.namespace) && (!namespace || record.namespace === namespace) && (!parent || parent.kind === 'cli' && all || parentKey(record.parent) === parentKey(parent)));
    }
}
