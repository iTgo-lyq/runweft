import type { Principal } from '../access/types';
import type { AccessStore } from '../access/store';
import { fingerprint, type AuthorizationLease } from '../access/transport';
import { HubError, hubNotFound } from '../types';
import type { AgentSnapshot } from '../../tasks/types';
import type { ResolvedHubAgent } from '../agents/resolver';

export class DelegationScopes {
    constructor(readonly access: AccessStore) {}
    ensure(actor: Principal) {
        const current = this.access.refresh(actor);
        if (current.kind !== 'user' || !current.spaceId) throw new HubError(409, 'delegation_space_required', '委派需要用户身份和已选择的 Hub 空间。');
        const namespace = `rw_tasks_${fingerprint([current.ownerId, current.spaceId])}`;
        this.access.db.query('INSERT OR IGNORE INTO hub_delegation_scopes VALUES (?, ?, ?)').run(namespace, current.ownerId, current.spaceId);
        return namespace;
    }
    has(namespace: string) { return !!this.access.db.query('SELECT 1 FROM hub_delegation_scopes WHERE namespace=?').get(namespace); }
    get(namespace: string) {
        const row = this.access.db.query('SELECT ownerId, spaceId FROM hub_delegation_scopes WHERE namespace=?').get(namespace) as { ownerId: string; spaceId: string } | null;
        if (!row) throw hubNotFound(); return row;
    }
    /** Background operations re-evaluate membership using stable ownership, never a saved bearer. */
    lease(namespace: string, guard: () => void = () => {}): AuthorizationLease {
        const { ownerId, spaceId } = this.get(namespace), access = this.access;
        const checks = new Set([guard]), signal = AbortSignal.timeout(30_000);
        const lease: AuthorizationLease = { get actor() { return access.serviceUser(ownerId, spaceId); }, signal,
            add(check) { checks.add(check); check(); return () => { checks.delete(check); }; },
            check() { signal.throwIfAborted(); access.serviceUser(ownerId, spaceId); for (const check of checks) check(); } };
        return lease;
    }
}

export function agentSnapshot(namespace: string, hub: ResolvedHubAgent): AgentSnapshot {
    const { name, description, instructions, runtimeId, flavor, model, reasoningEffort, repositoryId } = hub.definition;
    return { id: hub.agentId, definition: { schemaVersion: 1, name, description, instructions, runtime: runtimeId, flavor, model, reasoningEffort },
        source: { scope: repositoryId ? 'project' : 'global', hubId: hub.agentId, repositoryId },
        definitionVersion: hub.contentHash, resolvedVersion: hub.resolvedVersion, runtimeId: hub.target.runtimeId,
        machineId: hub.target.machineId, flavor: hub.target.flavor, namespace, hub: structuredClone(hub) };
}
