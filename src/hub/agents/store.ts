import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { contentVersion } from '../../agents/definitions';
import type { Principal } from '../access/types';
import { RepositoryStore } from '../repositories/store';
import { HubError, hubForbidden, hubNotFound } from '../types';
import { AgentAccess, CreateAgent, UpdateAgent, agentInput, agentOwnerRequired, agentInvalid,
    type AccessMode, type AgentDefinition, type AgentVersion, type AgentView, type Invocable } from './types';

type AgentRow = { id: string; ownerId: string; spaceId: string; repositoryId: string | null; currentVersion: number;
    registered: number; accessMode: AccessMode; requestId: string; fingerprint: string; createdAt: number; updatedAt: number };
type VersionRow = Omit<AgentVersion, 'definition'> & { definition: string };

export class HubAgentStore {
    readonly db;
    readonly resources;
    constructor(readonly repositories: RepositoryStore) { this.db = repositories.db; this.resources = repositories.resources; }
    private transaction<T>(actor: Principal, write: boolean, fn: (current: Principal & { spaceId: string }) => T): T {
        const op = this.db.transaction(() => fn(this.repositories.context(actor))); return write ? op.immediate() : op.deferred();
    }
    private row(id: string): AgentRow | null { return this.db.query('SELECT * FROM hub_agents WHERE id=?').get(id) as AgentRow | null; }
    private version(row: AgentRow, version = row.currentVersion): AgentVersion {
        const stored = this.db.query('SELECT * FROM hub_agent_versions WHERE agentId=? AND version=?').get(row.id, version) as VersionRow | null;
        if (!stored) throw hubNotFound(); return { ...stored, definition: JSON.parse(stored.definition) };
    }
    private governs(userId: string, spaceId: string) { return ['owner', 'admin'].includes(this.resources.role(userId, spaceId) ?? ''); }
    private reads(userId: string, row: AgentRow) {
        return row.ownerId === userId || this.resources.access.member(row.ownerId, row.spaceId) && (row.accessMode === 'space'
            || row.accessMode === 'members' && !!this.db.query('SELECT 1 FROM hub_agent_members WHERE agentId=? AND userId=?').get(row.id, userId));
    }
    private visible(actor: Principal & { spaceId: string }, id: string) {
        const row = this.row(id);
        if (!row || row.spaceId !== actor.spaceId || !this.reads(actor.ownerId, row) && !this.governs(actor.ownerId, row.spaceId)) throw hubNotFound();
        return row;
    }
    private own(actor: Principal & { spaceId: string }, id: string) { const row = this.visible(actor, id); if (row.ownerId !== actor.ownerId) throw agentOwnerRequired(); return row; }
    blocked(id: string) { return !!this.db.query('SELECT 1 FROM hub_agent_blocks WHERE agentId=?').get(id); }
    /** DB-only Agent policy. Runtime policy remains a separate intersection in the resolver. */
    invocable(userId: string, spaceId: string | null, id: string, repositoryId: string | null): Invocable {
        const no = (code: string, message: string): Invocable => ({ eligible: false, reason: { code, message } });
        if (!spaceId || !this.resources.access.member(userId, spaceId)) return no('agent_membership_required', '当前身份不是所选空间成员。');
        const row = this.row(id);
        if (!row || row.spaceId !== spaceId) return no('agent_unknown', '当前空间中找不到该 Agent。');
        if (!this.reads(userId, row)) return no('agent_private', 'Agent 未向当前身份分享。');
        if (!this.resources.access.member(row.ownerId, spaceId)) return no('agent_owner_absent', 'Agent 所有者已离开空间。');
        if (!row.registered) return no('agent_unregistered', 'Agent 已取消登记。');
        if (this.blocked(id)) return no('agent_blocked', '空间管理员已禁用 Agent。');
        if (row.repositoryId !== null && row.repositoryId !== repositoryId) return no('agent_repository_mismatch', 'Agent 不适用于当前仓库；非 Git 工作区只能使用空间级 Agent。');
        if (repositoryId !== null) {
            const repo = this.db.query('SELECT registered FROM hub_repositories WHERE id=? AND spaceId=?').get(repositoryId, spaceId) as { registered: number } | null;
            if (!repo) return no('repository_unknown', '当前空间没有指定仓库。');
            if (!repo.registered) return no('repository_unregistered', '当前仓库已取消登记。');
        }
        return { eligible: true, reason: null };
    }
    requireInvocable(actor: Principal, id: string, repositoryId: string | null): AgentVersion {
        return this.transaction(actor, false, current => {
            const row = this.visible(current, id), result = this.invocable(current.ownerId, current.spaceId, id, repositoryId);
            if (result.reason) throw new HubError(['agent_private', 'agent_membership_required'].includes(result.reason.code) ? 403 : 409, result.reason.code, result.reason.message);
            return this.version(row);
        });
    }
    private view(actor: Principal & { spaceId: string }, row: AgentRow): AgentView {
        const owner = row.ownerId === actor.ownerId, read = this.reads(actor.ownerId, row), version = this.version(row);
        const summary = { id: row.id, ownerId: row.ownerId, spaceId: row.spaceId, name: version.definition.name, repositoryId: row.repositoryId,
            version: row.currentVersion, registered: !!row.registered, accessMode: row.accessMode, blocked: this.blocked(row.id),
            ownerPresent: this.resources.access.member(row.ownerId, row.spaceId), createdAt: row.createdAt, updatedAt: row.updatedAt,
            permissions: { edit: owner, share: owner, govern: this.governs(actor.ownerId, row.spaceId), readDefinition: read,
                invoke: this.invocable(actor.ownerId, row.spaceId, row.id, row.repositoryId).eligible, history: owner } };
        // Explicit whitelist: private definitions never leave via an admin catalog/detail response.
        if (!read) return { ...summary, view: 'governance' };
        const memberIds = owner ? (this.db.query('SELECT userId FROM hub_agent_members WHERE agentId=? ORDER BY userId').all(row.id) as { userId: string }[]).map(r => r.userId) : undefined;
        return { ...summary, view: 'definition', definition: version.definition, contentHash: version.contentHash, ...(owner ? { memberIds } : {}) };
    }
    agent(actor: Principal, id: string): AgentView { return this.transaction(actor, false, current => this.view(current, this.visible(current, id))); }
    list(actor: Principal): AgentView[] {
        return this.transaction(actor, false, current => (this.db.query('SELECT * FROM hub_agents WHERE spaceId=? ORDER BY createdAt, id').all(current.spaceId) as AgentRow[])
            .filter(row => this.reads(current.ownerId, row) || this.governs(current.ownerId, current.spaceId)).map(row => this.view(current, row)));
    }
    receipt(actor: Principal, requestId: string) {
        if (!z.uuid().safeParse(requestId).success) throw agentInvalid();
        return this.transaction(actor, false, current => {
            const row = this.db.query('SELECT * FROM hub_agents WHERE ownerId=? AND spaceId=? AND requestId=?').get(current.ownerId, current.spaceId, requestId) as AgentRow | null;
            if (!row) throw hubNotFound(); return this.view(current, row);
        });
    }
    private validateDefinition(actor: Principal, definition: AgentDefinition, previous?: AgentDefinition) {
        if (definition.repositoryId && definition.repositoryId !== previous?.repositoryId) this.repositories.requireRegistered(actor, definition.repositoryId);
        if (definition.runtimeId && definition.runtimeId !== previous?.runtimeId) {
            this.resources.requireUsable(actor.ownerId, actor.spaceId, definition.runtimeId);
            const runtime = this.resources.runtime(actor, definition.runtimeId);
            if (definition.flavor && definition.flavor !== runtime.flavor) throw new HubError(409, 'agent_flavor_mismatch', 'Agent 类型与绑定 runtime 不一致。');
        }
    }
    private append(id: string, version: number, definition: AgentDefinition, now: number) {
        this.db.query('INSERT INTO hub_agent_versions (agentId, version, definition, contentHash, createdAt) VALUES (?, ?, ?, ?, ?)')
            .run(id, version, JSON.stringify(definition), contentVersion(definition), now);
    }
    create(actor: Principal, value: unknown): AgentView {
        const body = agentInput(CreateAgent, value);
        return this.transaction(actor, true, current => {
            const fingerprint = contentVersion({ kind: 'agent', spaceId: current.spaceId, definition: body.definition });
            const prior = this.db.query('SELECT * FROM hub_agents WHERE ownerId=? AND requestId=?').get(current.ownerId, body.requestId) as AgentRow | null;
            if (prior) {
                if (prior.fingerprint !== fingerprint) throw new HubError(409, 'agent_request_conflict', '原 Agent 创建请求已使用不同参数。', '查询原 requestId，或为新操作使用新的 requestId。');
                return this.view(current, prior);
            }
            this.validateDefinition(current, body.definition); const id = randomUUID(), now = Date.now();
            this.db.query(`INSERT INTO hub_agents (id, ownerId, spaceId, repositoryId, currentVersion, registered, accessMode, requestId, fingerprint, createdAt, updatedAt)
                VALUES (?, ?, ?, ?, 1, 1, 'private', ?, ?, ?, ?)`).run(id, current.ownerId, current.spaceId, body.definition.repositoryId, body.requestId, fingerprint, now, now);
            this.append(id, 1, body.definition, now); return this.view(current, this.row(id)!);
        });
    }
    update(actor: Principal, id: string, value: unknown): AgentView {
        const body = agentInput(UpdateAgent, value);
        return this.transaction(actor, true, current => {
            const row = this.own(current, id);
            if (row.currentVersion !== body.expectedVersion) throw new HubError(409, 'agent_version_conflict', 'Agent 已被其他操作更新。', '读取当前定义与版本后重新应用修改。');
            this.validateDefinition(current, body.definition, this.version(row).definition); const now = Date.now();
            this.append(id, row.currentVersion + 1, body.definition, now);
            this.db.query('UPDATE hub_agents SET currentVersion=currentVersion+1, repositoryId=?, updatedAt=? WHERE id=?').run(body.definition.repositoryId, now, id);
            return this.view(current, this.row(id)!);
        });
    }
    versions(actor: Principal, id: string): AgentVersion[] {
        return this.transaction(actor, false, current => { this.own(current, id); return (this.db.query('SELECT * FROM hub_agent_versions WHERE agentId=? ORDER BY version').all(id) as VersionRow[]).map(row => ({ ...row, definition: JSON.parse(row.definition) })); });
    }
    register(actor: Principal, id: string, registered: boolean): AgentView {
        return this.transaction(actor, true, current => { this.own(current, id); this.db.query('UPDATE hub_agents SET registered=?, updatedAt=? WHERE id=?').run(Number(registered), Date.now(), id); return this.view(current, this.row(id)!); });
    }
    access(actor: Principal, id: string, value: unknown): AgentView {
        const body = agentInput(AgentAccess, value);
        return this.transaction(actor, true, current => {
            this.own(current, id); const memberIds = [...new Set(body.memberIds)].filter(userId => userId !== current.ownerId).sort();
            for (const userId of memberIds) if (!this.resources.access.member(userId, current.spaceId)) throw new HubError(409, 'agent_member_unknown', '分享目标必须是当前空间成员。');
            this.db.query('DELETE FROM hub_agent_members WHERE agentId=?').run(id);
            for (const userId of memberIds) this.db.query('INSERT INTO hub_agent_members (agentId, spaceId, userId) VALUES (?, ?, ?)').run(id, current.spaceId, userId);
            this.db.query('UPDATE hub_agents SET accessMode=?, updatedAt=? WHERE id=?').run(body.mode, Date.now(), id);
            return this.view(current, this.row(id)!);
        });
    }
    block(actor: Principal, id: string, blocked: boolean): AgentView {
        return this.transaction(actor, true, current => {
            this.visible(current, id); if (!this.governs(current.ownerId, current.spaceId)) throw hubForbidden();
            if (blocked) this.db.query('INSERT OR IGNORE INTO hub_agent_blocks (agentId, actorId, createdAt) VALUES (?, ?, ?)').run(id, current.ownerId, Date.now());
            else this.db.query('DELETE FROM hub_agent_blocks WHERE agentId=?').run(id);
            return this.view(current, this.row(id)!);
        });
    }
}
