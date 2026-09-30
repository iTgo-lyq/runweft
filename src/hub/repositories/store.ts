import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Principal } from '../access/types';
import { HubResourceStore } from '../resources/store';
import { HubError, HubName, hubForbidden, hubNotFound } from '../types';
import { digest, repositoryAlias, type RepositoryAlias } from './identity';
import { observation, remoteFingerprint, type Observation } from './observation';

export type Repository = { id: string; ownerId: string; spaceId: string; name: string; registered: boolean;
    aliases: RepositoryAlias[]; createdAt: number; updatedAt: number; permissions: { manage: boolean } };
type Row = Omit<Repository, 'registered' | 'aliases' | 'permissions'> & { registered: number; requestId: string; fingerprint: string };
export type Checkout = { ownerId: string; spaceId: string; machineId: string; gitCommonDir: string; repositoryId: string;
    remoteFingerprint: string; repositoryRoot: string; cwd: string; objectFormat: 'sha1' | 'sha256'; createdAt: number; updatedAt: number };
export type RepositoryMatch = { status: 'matched'; source: 'checkout' | 'aliases'; repository: Repository; observation: Observation; remoteFingerprint: string }
    | { status: 'non_git' | 'unbound' | 'unmatched' | 'ambiguous' | 'binding_changed'; candidates: Repository[]; observation: Observation; hint: string };
const createSchema = z.object({ requestId: z.uuid(), name: HubName, aliases: z.array(z.unknown()).max(64).default([]) }).strict();
const checkoutInput = z.object({ machineId: z.uuid(), observation: z.unknown(), remote: z.string().min(1).max(255).optional() }).strict();
const bindInput = checkoutInput.omit({ remote: true }).extend({ repositoryId: z.uuid() });
const invalid = () => new HubError(400, 'repository_input_invalid', '仓库请求参数无效。', '检查 UUID、名称和允许的字段；归属与空间来自当前身份。');
function input<T>(schema: z.ZodType<T>, value: unknown): T { const parsed = schema.safeParse(value); if (!parsed.success) throw invalid(); return parsed.data; }

/** Configuration identity only. No paths are trusted as proof of execution or Git access. */
export class RepositoryStore {
    readonly db;
    constructor(readonly resources: HubResourceStore) { this.db = resources.db; }
    context(actor: Principal) {
        const current = this.resources.user(actor);
        if (!current.spaceId) throw new HubError(409, 'repository_space_required', '先选择 Hub 空间再管理仓库或 Agent 配置。');
        return { ...current, spaceId: current.spaceId };
    }
    private transaction<T>(actor: Principal, write: boolean, fn: (current: Principal & { spaceId: string }) => T): T {
        const op = this.db.transaction(() => fn(this.context(actor))); return write ? op.immediate() : op.deferred();
    }
    private row(actor: Principal & { spaceId: string }, id: string): Row {
        const row = this.db.query('SELECT * FROM hub_repositories WHERE id=? AND spaceId=?').get(id, actor.spaceId) as Row | null;
        if (!row) throw hubNotFound(); return row;
    }
    private governs(actor: Principal, row: Row) { return row.ownerId === actor.ownerId || ['owner', 'admin'].includes(this.resources.role(actor.ownerId, row.spaceId) ?? ''); }
    private manage(actor: Principal & { spaceId: string }, id: string) { const row = this.row(actor, id); if (!this.governs(actor, row)) throw hubForbidden(); return row; }
    private view(actor: Principal, row: Row): Repository {
        const aliases = (this.db.query('SELECT canonicalKey, displayUrl, descriptor FROM hub_repository_aliases WHERE repositoryId=? ORDER BY canonicalKey').all(row.id) as { canonicalKey: string; displayUrl: string; descriptor: string }[]).map(alias => ({ ...alias, descriptor: JSON.parse(alias.descriptor) }));
        return { id: row.id, ownerId: row.ownerId, spaceId: row.spaceId, name: row.name, registered: !!row.registered,
            aliases, createdAt: row.createdAt, updatedAt: row.updatedAt, permissions: { manage: this.governs(actor, row) } };
    }
    repository(actor: Principal, id: string): Repository { return this.transaction(actor, false, current => this.view(current, this.row(current, id))); }
    requireRegistered(actor: Principal, id: string) {
        const repository = this.repository(actor, id);
        if (!repository.registered) throw new HubError(409, 'repository_unregistered', '仓库已取消登记。', '显式恢复原仓库登记，或选择其他仓库。');
        return repository;
    }
    list(actor: Principal) { return this.transaction(actor, false, current => (this.db.query('SELECT * FROM hub_repositories WHERE spaceId=? ORDER BY createdAt, id').all(current.spaceId) as Row[]).map(row => this.view(current, row))); }
    receipt(actor: Principal, requestId: string) {
        if (!z.uuid().safeParse(requestId).success) throw invalid();
        return this.transaction(actor, false, current => {
            const row = this.db.query('SELECT * FROM hub_repositories WHERE ownerId=? AND spaceId=? AND requestId=?').get(current.ownerId, current.spaceId, requestId) as Row | null;
            if (!row) throw hubNotFound(); return this.view(current, row);
        });
    }
    create(actor: Principal, value: unknown): Repository {
        const body = input(createSchema, value);
        const aliases = [...new Map(body.aliases.map(a => { const alias = repositoryAlias(a); return [alias.canonicalKey, alias] as const; })).values()].sort((a, b) => a.canonicalKey.localeCompare(b.canonicalKey));
        return this.transaction(actor, true, current => {
            const fingerprint = digest(JSON.stringify({ kind: 'repository', spaceId: current.spaceId, name: body.name, aliases: aliases.map(a => a.canonicalKey) }));
            const prior = this.db.query('SELECT * FROM hub_repositories WHERE ownerId=? AND requestId=?').get(current.ownerId, body.requestId) as Row | null;
            if (prior) {
                if (prior.fingerprint !== fingerprint) throw new HubError(409, 'repository_request_conflict', '原仓库创建请求已使用不同参数。', '查询原 requestId，或为新操作使用新的 requestId。');
                return this.view(current, prior);
            }
            const id = randomUUID(), now = Date.now();
            this.db.query('INSERT INTO hub_repositories (id, ownerId, spaceId, name, registered, requestId, fingerprint, createdAt, updatedAt) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)')
                .run(id, current.ownerId, current.spaceId, body.name, body.requestId, fingerprint, now, now);
            for (const alias of aliases) this.insertAlias(current.spaceId, id, alias);
            return this.view(current, this.row(current, id));
        });
    }
    private insertAlias(spaceId: string, id: string, alias: RepositoryAlias) {
        const prior = this.db.query('SELECT repositoryId FROM hub_repository_aliases WHERE spaceId=? AND canonicalKey=?').get(spaceId, alias.canonicalKey) as { repositoryId: string } | null;
        if (prior && prior.repositoryId !== id) throw new HubError(409, 'repository_alias_conflict', '该别名已属于本空间的其他仓库。', '查看仓库目录并显式修正别名；不会合并记录。');
        this.db.query('INSERT OR IGNORE INTO hub_repository_aliases (spaceId, canonicalKey, repositoryId, displayUrl, descriptor) VALUES (?, ?, ?, ?, ?)')
            .run(spaceId, alias.canonicalKey, id, alias.displayUrl, JSON.stringify(alias.descriptor));
    }
    alias(actor: Principal, id: string, value: unknown, add: boolean) {
        const aliasInput = z.object({ alias: z.unknown() }).strict();
        const body = input(add ? aliasInput : z.union([aliasInput, z.object({ canonicalKey: z.string().regex(/^[a-f0-9]{64}$/) }).strict()]), value);
        return this.transaction(actor, true, current => {
            this.manage(current, id);
            if ('canonicalKey' in body) this.db.query('DELETE FROM hub_repository_aliases WHERE repositoryId=? AND canonicalKey=?').run(id, body.canonicalKey);
            else {
                const alias = repositoryAlias(body.alias);
                if (add) this.insertAlias(current.spaceId, id, alias);
                else this.db.query('DELETE FROM hub_repository_aliases WHERE repositoryId=? AND canonicalKey=?').run(id, alias.canonicalKey);
            }
            this.db.query('UPDATE hub_repositories SET updatedAt=? WHERE id=?').run(Date.now(), id);
            return this.view(current, this.row(current, id));
        });
    }
    rename(actor: Principal, id: string, value: unknown) {
        const body = input(z.object({ name: HubName }).strict(), value);
        return this.transaction(actor, true, current => { this.manage(current, id); this.db.query('UPDATE hub_repositories SET name=?, updatedAt=? WHERE id=?').run(body.name, Date.now(), id); return this.view(current, this.row(current, id)); });
    }
    register(actor: Principal, id: string, registered: boolean) {
        return this.transaction(actor, true, current => { this.manage(current, id); this.db.query('UPDATE hub_repositories SET registered=?, updatedAt=? WHERE id=?').run(Number(registered), Date.now(), id); return this.view(current, this.row(current, id)); });
    }
    private checkout(actor: Principal & { spaceId: string }, machineId: string, gitCommonDir: string) {
        return this.db.query('SELECT * FROM hub_checkouts WHERE ownerId=? AND spaceId=? AND machineId=? AND gitCommonDir=?').get(actor.ownerId, actor.spaceId, machineId, gitCommonDir) as Checkout | null;
    }
    checkouts(actor: Principal) {
        return this.transaction(actor, false, current => this.db.query('SELECT * FROM hub_checkouts WHERE ownerId=? AND spaceId=? ORDER BY updatedAt, machineId, gitCommonDir').all(current.ownerId, current.spaceId) as Checkout[]);
    }
    match(actor: Principal, value: unknown): RepositoryMatch {
        const body = input(checkoutInput, value), seen = observation(body.observation);
        return this.transaction(actor, false, current => {
            this.resources.ownMachine(current, body.machineId);
            const no = (status: Exclude<RepositoryMatch['status'], 'matched'>, candidates: Repository[], hint: string): RepositoryMatch => ({ status, candidates, observation: seen, hint });
            if (seen.kind === 'non_git') return no('non_git', [], '当前目录不是 Git 工作区，只能使用空间级 Agent。');
            const fingerprint = remoteFingerprint(seen), prior = this.checkout(current, body.machineId, seen.gitCommonDir);
            if (prior) {
                const repo = this.requireRegistered(current, prior.repositoryId);
                if (prior.remoteFingerprint !== fingerprint || prior.objectFormat !== seen.objectFormat) return no('binding_changed', [repo], 'remote 集合或 Git 格式已变化；显式 repository bind 确认新的关联。');
                return { status: 'matched', source: 'checkout', repository: repo, observation: seen, remoteFingerprint: fingerprint };
            }
            const remotes = body.remote ? seen.remotes.filter(r => r.name === body.remote) : seen.remotes;
            if (body.remote && !remotes.length) throw new HubError(400, 'repository_remote_unknown', '工作区没有指定 remote。');
            const ids = new Set<string>(), unknown = new Set<string>();
            for (const remote of remotes) for (const url of remote.urls) {
                if (url.kind !== 'remote') { unknown.add(`${url.kind}:${url.digest}`); continue; }
                const key = repositoryAlias(url).canonicalKey;
                const alias = this.db.query('SELECT repositoryId FROM hub_repository_aliases WHERE spaceId=? AND canonicalKey=?').get(current.spaceId, key) as { repositoryId: string } | null;
                if (alias) ids.add(alias.repositoryId); else unknown.add(key);
            }
            const candidates = [...ids].sort().map(id => this.repository(current, id));
            if (ids.size === 1 && unknown.size === 0) return { status: 'matched', source: 'aliases', repository: this.requireRegistered(current, [...ids][0]), observation: seen, remoteFingerprint: fingerprint };
            if (!remotes.length || remotes.every(r => r.urls.every(u => u.kind === 'local'))) return no('unbound', [], '没有可跨机器识别的 remote；显式 repository bind 关联当前仓库。');
            if (ids.size > 1 || (ids.size && unknown.size) || unknown.size > 1) return no('ambiguous', candidates, '多个 remote 未收敛为一个仓库；选择 --remote 或显式 repository bind，必要时添加明确 alias。');
            return no('unmatched', [], '未找到本空间仓库别名；使用 repository alias 添加明确地址，或显式 repository bind。');
        });
    }
    bind(actor: Principal, value: unknown): Checkout {
        const body = input(bindInput, value), seen = observation(body.observation);
        if (seen.kind !== 'git') throw new HubError(409, 'repository_git_required', '只有 Git 工作区可以关联 Repository。');
        return this.transaction(actor, true, current => {
            this.resources.ownMachine(current, body.machineId); this.requireRegistered(current, body.repositoryId); const now = Date.now();
            this.db.query(`INSERT INTO hub_checkouts (ownerId, spaceId, machineId, gitCommonDir, repositoryId, remoteFingerprint, repositoryRoot, cwd, objectFormat, createdAt, updatedAt)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(ownerId, spaceId, machineId, gitCommonDir) DO UPDATE SET
                repositoryId=excluded.repositoryId, remoteFingerprint=excluded.remoteFingerprint, repositoryRoot=excluded.repositoryRoot,
                cwd=excluded.cwd, objectFormat=excluded.objectFormat, updatedAt=excluded.updatedAt`)
                .run(current.ownerId, current.spaceId, body.machineId, seen.gitCommonDir, body.repositoryId, remoteFingerprint(seen), seen.repositoryRoot, seen.cwd, seen.objectFormat, now, now);
            return this.checkout(current, body.machineId, seen.gitCommonDir)!;
        });
    }
    unbind(actor: Principal, value: unknown) {
        const body = input(checkoutInput.omit({ remote: true }), value), seen = observation(body.observation);
        if (seen.kind !== 'git') throw new HubError(409, 'repository_git_required', '只有 Git 工作区可以解除 Repository 关联。');
        return this.transaction(actor, true, current => { this.resources.ownMachine(current, body.machineId); const result = this.db.query('DELETE FROM hub_checkouts WHERE ownerId=? AND spaceId=? AND machineId=? AND gitCommonDir=?').run(current.ownerId, current.spaceId, body.machineId, seen.gitCommonDir); return { removed: result.changes > 0 }; });
    }
}
