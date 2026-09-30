import { z } from 'zod';
import { contentVersion } from '../../agents/definitions';
import type { Principal } from '../access/types';
import { HubError } from '../types';
import { HubAgentStore } from './store';
import { agentInput, type AgentDefinition } from './types';

export const SelectionScope = z.object({ repositoryId: z.uuid().nullable().default(null) }).strict();
export const SelectionInput = SelectionScope.extend({ agentId: z.uuid(), runtimeId: z.uuid().nullable().default(null) });
export const ResolveInput = z.object({ hubRepositoryId: z.uuid().nullable().default(null), agentId: z.uuid().optional(), runtimeId: z.uuid().optional() }).strict();
export type ResolveInput = z.infer<typeof ResolveInput>;
export type PersonalSelection = { userId: string; spaceId: string; repositoryId: string | null; agentId: string; runtimeId: string | null; createdAt: number; updatedAt: number };
export type SelectionSources = { agent: 'explicit' | 'repository' | 'space'; runtime: 'explicit' | 'repository' | 'space' | 'definition' };
export type SelectedAgent = { actorId: string; spaceId: string; hubRepositoryId: string | null; agentId: string; agentOwnerId: string;
    version: number; contentHash: string; definition: AgentDefinition; runtimeId: string; selection: SelectionSources; request: ResolveInput; selectionHash: string };

export class AgentSelectionStore {
    readonly db;
    constructor(readonly agents: HubAgentStore) { this.db = agents.db; }
    private transaction<T>(actor: Principal, write: boolean, fn: (current: Principal & { spaceId: string }) => T): T {
        const op = this.db.transaction(() => fn(this.agents.repositories.context(actor))); return write ? op.immediate() : op.deferred();
    }
    private row(actor: Principal & { spaceId: string }, repositoryId: string | null): PersonalSelection | null {
        return this.db.query('SELECT * FROM hub_agent_selections WHERE userId=? AND spaceId=? AND repositoryId IS ?').get(actor.ownerId, actor.spaceId, repositoryId) as PersonalSelection | null;
    }
    list(actor: Principal): PersonalSelection[] {
        return this.transaction(actor, false, current => this.db.query('SELECT * FROM hub_agent_selections WHERE userId=? AND spaceId=? ORDER BY repositoryId').all(current.ownerId, current.spaceId) as PersonalSelection[]);
    }
    private runtime(actor: Principal, definition: AgentDefinition, id: string) {
        this.agents.resources.requireUsable(actor.ownerId, actor.spaceId, id);
        const runtime = this.agents.resources.runtime(actor, id);
        if (definition.flavor && definition.flavor !== runtime.flavor) throw new HubError(409, 'agent_flavor_mismatch', 'Agent 类型与选择的 runtime 不一致。');
        return runtime;
    }
    set(actor: Principal, value: unknown): PersonalSelection {
        const body = agentInput(SelectionInput, value);
        return this.transaction(actor, true, current => {
            if (body.repositoryId) this.agents.repositories.requireRegistered(current, body.repositoryId);
            const agent = this.agents.requireInvocable(current, body.agentId, body.repositoryId);
            if (body.runtimeId) this.runtime(current, agent.definition, body.runtimeId);
            const now = Date.now();
            this.db.query(`INSERT INTO hub_agent_selections (userId, spaceId, repositoryId, agentId, runtimeId, createdAt, updatedAt)
                VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(userId, spaceId, COALESCE(repositoryId, '')) DO UPDATE SET
                agentId=excluded.agentId, runtimeId=excluded.runtimeId, updatedAt=excluded.updatedAt`)
                .run(current.ownerId, current.spaceId, body.repositoryId, body.agentId, body.runtimeId, now, now);
            return this.row(current, body.repositoryId)!;
        });
    }
    remove(actor: Principal, value: unknown) {
        const body = agentInput(SelectionScope, value);
        return this.transaction(actor, true, current => ({ removed: this.db.query('DELETE FROM hub_agent_selections WHERE userId=? AND spaceId=? AND repositoryId IS ?').run(current.ownerId, current.spaceId, body.repositoryId).changes > 0 }));
    }
    select(actor: Principal, value: unknown): SelectedAgent {
        const request = agentInput(ResolveInput, value);
        return this.transaction(actor, false, current => {
            if (request.hubRepositoryId) this.agents.repositories.requireRegistered(current, request.hubRepositoryId);
            const repo = request.hubRepositoryId ? this.row(current, request.hubRepositoryId) : null, global = this.row(current, null);
            const agentId = request.agentId ?? repo?.agentId ?? global?.agentId;
            if (!agentId) throw new HubError(409, 'agent_selection_required', '未选择 Agent。', '显式传入 Agent UUID，或保存本人仓库/空间默认选择。');
            const version = this.agents.requireInvocable(current, agentId, request.hubRepositoryId);
            const info = this.agents.agent(current, agentId);
            const repoOverride = repo?.agentId === agentId ? repo.runtimeId : null, globalOverride = global?.agentId === agentId ? global.runtimeId : null;
            const runtimeId = request.runtimeId ?? repoOverride ?? globalOverride ?? version.definition.runtimeId;
            if (!runtimeId) throw new HubError(409, 'agent_runtime_required', '已选 Agent 没有执行目标。', '显式指定 runtime，或保存本人 override；共享 Agent 不会自动取得别人的私有 runtime。');
            this.runtime(current, version.definition, runtimeId);
            const selection: SelectionSources = { agent: request.agentId ? 'explicit' : repo ? 'repository' : 'space',
                runtime: request.runtimeId ? 'explicit' : repoOverride ? 'repository' : globalOverride ? 'space' : 'definition' };
            const chosen = { actorId: current.ownerId, spaceId: current.spaceId, hubRepositoryId: request.hubRepositoryId, agentId, agentOwnerId: info.ownerId,
                version: version.version, contentHash: version.contentHash, definition: version.definition, runtimeId, selection };
            return { ...chosen, request, selectionHash: contentVersion(chosen) };
        });
    }
    /** For one in-flight preview. Accepted task snapshots use current invocable + usable instead of rerouting. */
    validateSelection(actor: Principal, selected: SelectedAgent) {
        return this.transaction(actor, false, currentActor => {
            const changed = () => new HubError(409, 'agent_configuration_changed', '解析期间 Agent 内容或决定层的个人选择已改变。', '重新解析当前配置；不会组合不同版本或静默切换目标。');
            const agent = this.agents.agent(currentActor, selected.agentId);
            if (agent.view === 'definition' && (agent.version !== selected.version || agent.contentHash !== selected.contentHash)) throw changed();
            const current = this.select(currentActor, selected.request);
            if (current.selectionHash !== selected.selectionHash) throw changed();
            return current;
        });
    }
}
