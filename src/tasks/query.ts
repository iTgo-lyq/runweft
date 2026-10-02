import { z } from 'zod';
import type { Problem } from '../resources/types';
import { overview } from './views';
import type { TaskBundle } from './types';

const pageNumber = z.string().regex(/^[1-9][0-9]*$/).transform(Number).pipe(z.number().int().max(1_000_000));
export const OverviewQuerySchema = z.strictObject({
    workspace: z.string().trim().max(4096).default(''), parent: z.string().trim().max(512).default(''),
    status: z.enum(['running', 'needs_attention', 'completed', 'failed', 'interrupted', 'unknown']).optional(),
    page: pageNumber.default(1), limit: pageNumber.pipe(z.number().max(100)).default(50),
});
export type OverviewQuery = z.infer<typeof OverviewQuerySchema>;
export type TaskInventory = { machines: { id: string; name: string; online: boolean }[]; error: Problem | null };
const text = (value: string | undefined, max = 1000) => value?.slice(0, max) ?? null;
function problem(value: Problem | null | undefined) {
    return value ? { code: text(value.code, 128), message: text(value.message), hint: text(value.hint) } : null;
}

/** Explicit read projection: prompts, definitions, native logs and file manifests stay in their domain. */
export function taskOverview(bundles: TaskBundle[], runtimes: { id: string; name: string }[], inventory: TaskInventory, query: OverviewQuery) {
    const machines = new Map(inventory.machines.map(machine => [machine.id, machine]));
    const names = new Map(runtimes.map(runtime => [runtime.id, runtime.name]));
    const workspace = query.workspace.toLowerCase(), parentSearch = query.parent.toLowerCase();
    const items = bundles.filter(({ task }) => {
        const parent = task.parent;
        return parent.cwd.toLowerCase().includes(workspace)
            && [parent.kind, parent.machineId, parent.cwd, parent.hapiSessionId,
                ...(parent.kind === 'mcp' ? [parent.host, parent.nativeSessionId] : [])].some(value => value?.toLowerCase().includes(parentSearch));
    }).map(bundle => {
        const { task } = bundle;
        const round = bundle.rounds.find(round => !['finished', 'failed'].includes(round.phase)) ?? bundle.rounds.at(-1)!;
        const view = overview(bundle, round), machine = machines.get(task.target.machineId);
        const parent = task.parent, code = view.code, files = view.artifacts;
        const online = machine?.online ?? null;
        const fileError = files.retention.error ?? files.pending.find(job => job.error)?.error ?? files.manifest?.items.find(item => item.error)?.error;
        return {
            id: task.id, round_id: round.id, round: round.ordinal, revision: task.revision, updated_at: view.updated_at,
            parent: { kind: parent.kind, machine_id: parent.machineId, cwd: text(parent.cwd, 4096),
                host: parent.kind === 'mcp' ? parent.host : null, native_session_id: parent.kind === 'mcp' ? parent.nativeSessionId : null,
                session_id: parent.hapiSessionId ?? null },
            agent: { id: task.agent.id, name: text(task.agent.definition.name, 256), scope: task.agent.source.scope },
            runtime: { id: task.target.runtimeId, name: text(names.get(task.target.runtimeId) ?? task.target.flavor, 256), flavor: task.target.flavor },
            machine: { id: task.target.machineId, name: text(machine?.name ?? task.target.machineId, 256), online },
            cwd: text(view.cwd, 4096), workspace_mode: view.workspace_mode, session_id: round.sessionId ?? null,
            status: view.status, phase: round.phase, stop: view.stop, finish: view.finish, execution_not_started: view.execution_not_started === true,
            observed_at: round.observedAt ?? null, possibly_stale: !['finished', 'failed'].includes(round.phase) && online !== true,
            attention: view.attention ? { ...problem(view.attention)!, stage: text(view.attention.stage, 128), scope: view.attention.scope ?? null } : null,
            summary: view.report.text.slice(0, 1000), summary_truncated: view.report.total > 1000,
            code: { status: code.status, sealing_status: round.git?.status ?? null, ref: text(code.ref, 4096),
                result_head: text(code.result?.resultHead, 128), storage: code.storage,
                error: problem(code.error ?? round.git?.error),
                next: code.next ? { action: code.next.action, command: text(code.next.command, 4096), hint: text(code.next.hint) } : null },
            files: { status: files.status, retention: files.retention.state, pending: files.pending.length,
                count: files.manifest?.items.length ?? round.outputFiles?.declarations.length ?? 0,
                available: files.manifest?.items.filter(item => item.status === 'available').length ?? 0, error: problem(fileError) },
        };
    }).filter(item => !query.status || item.status === query.status);
    const rank = (item: typeof items[number]) => item.attention || item.status === 'unknown' ? 0 : item.status === 'running' ? 1 : 2;
    items.sort((a, b) => rank(a) - rank(b) || b.updated_at - a.updated_at || a.id.localeCompare(b.id));
    return { generated_at: Date.now(), inventory: { available: !inventory.error, error: problem(inventory.error) },
        total: items.length, page: query.page, limit: query.limit, pages: Math.max(1, Math.ceil(items.length / query.limit)),
        items: items.slice((query.page - 1) * query.limit, query.page * query.limit) };
}
export type TaskOverview = ReturnType<typeof taskOverview>;
