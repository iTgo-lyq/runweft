import { randomUUID } from 'node:crypto';
import { openState } from '../state';
import { contentVersion } from '../agents/definitions';
import type { WorkspaceSource } from '../../hapi/shared/src/workspaces';
import type { ExecutionTarget } from '../resources/types';
import { parentKey, pendingPreparation, TaskError, type Acceptance, type AgentSnapshot, type Input, type Parent, type Round, type SendIntent, type SpawnIntent, type Task, type TaskBundle } from './types';

type TaskRow = { data: string; revision: number; updatedAt: number };
const read = <T>(row: { data: string }): T => JSON.parse(row.data);
const semantic = (parent: Parent, intent: SpawnIntent | SendIntent) => contentVersion({ parentKey: parentKey(parent), machineId: parent.machineId, cwd: parent.cwd, intent });

export class TaskStore {
    private readonly db;
    constructor(path: string) { this.db = openState(path); }
    close() { this.db.close(); }
    require(namespace: string, id: string, parent?: Parent): TaskBundle {
        const row = this.db.query('SELECT data, revision, updatedAt FROM delegation_tasks WHERE namespace=? AND id=?').get(namespace, id) as TaskRow | null;
        if (!row) throw new TaskError(404, 'task_unknown', '当前连接中找不到此任务。', '运行 runweft task list --all 检查任务 ID。');
        const task: Task = { version: 2, ...read<Omit<Task, 'version'>>(row), revision: row.revision, updatedAt: row.updatedAt };
        if (parent?.kind === 'mcp' && parentKey(parent) !== parentKey(task.parent)) throw new TaskError(403, 'task_parent_mismatch', '此任务不属于当前主会话。');
        const rounds = (this.db.query('SELECT data, completedRevision FROM delegation_rounds WHERE taskId=? ORDER BY ordinal').all(id) as { data: string; completedRevision: number | null }[])
            .map(row => ({ ...read<Round>(row), completedRevision: row.completedRevision ?? undefined }));
        const inputs = (this.db.query('SELECT i.data FROM delegation_inputs i JOIN delegation_rounds r ON i.roundId=r.id WHERE r.taskId=? ORDER BY r.ordinal, i.rowid').all(id) as { data: string }[]).map(row => read<Input>(row));
        return { task, rounds, inputs };
    }
    list(namespace: string, parent: Parent, all = false) {
        const ids = this.db.query(`SELECT id FROM delegation_tasks WHERE namespace=? AND
            (?=1 OR (?=1 AND machineId=? AND cwd=?) OR (?=0 AND parentKey=?)) ORDER BY updatedAt DESC, id`)
            .all(namespace, parent.kind === 'cli' && all ? 1 : 0, parent.kind === 'cli' ? 1 : 0, parent.machineId, parent.cwd,
                parent.kind === 'cli' ? 1 : 0, parentKey(parent)) as { id: string }[];
        return ids.map(row => this.require(namespace, row.id, parent));
    }
    pending(): { namespace: string; id: string }[] {
        return this.db.query(`SELECT DISTINCT t.namespace, t.id FROM delegation_tasks t JOIN delegation_rounds r ON t.id=r.taskId
            WHERE r.phase NOT IN ('finished', 'failed') OR json_extract(t.data, '$.environment.status')='deleting'`).all() as { namespace: string; id: string }[];
    }
    lookup(namespace: string, parent: Parent, requestId: string, intent: SpawnIntent | SendIntent): Acceptance | null {
        const row = this.db.query('SELECT fingerprint, accepted FROM delegation_requests WHERE namespace=? AND requestId=?').get(namespace, requestId) as { fingerprint: string; accepted: string } | null;
        if (!row) return null;
        if (row.fingerprint !== semantic(parent, intent)) throw new TaskError(409, 'task_request_conflict', '同一 request ID 已用于不同任务意图。', '重试原请求请保持参数；新任务使用新的 request ID。');
        const accepted: Acceptance = JSON.parse(row.accepted);
        this.require(namespace, accepted.agent_id, parent);
        return accepted;
    }
    requests(namespace: string, taskId: string) {
        return (this.db.query('SELECT accepted, createdAt FROM delegation_requests WHERE namespace=? AND taskId=? ORDER BY createdAt DESC, rowid DESC LIMIT 20')
            .all(namespace, taskId) as { accepted: string; createdAt: number }[]).map(row => ({ ...JSON.parse(row.accepted) as Acceptance, created_at: row.createdAt }));
    }
    assertCanDelegate(namespace: string, parent: Parent) {
        const match = this.db.query(`SELECT taskId FROM delegation_sessions WHERE namespace=? AND
            ((?<>'' AND hapiId=?) OR (?<>'' AND flavor=? AND nativeId=?)) LIMIT 1`)
            .get(namespace, parent.hapiSessionId ?? '', parent.hapiSessionId ?? '', parent.kind === 'mcp' ? parent.nativeSessionId : '',
                parent.kind === 'mcp' ? parent.host : '', parent.kind === 'mcp' ? parent.nativeSessionId : '');
        if (match) throw new TaskError(403, 'subagent_delegation_denied', 'Runweft 子任务不能再次发起 Runweft 委派。', '向主 agent 返回结果；原生内置 subagent 仍按原生规则使用。');
    }
    accept(namespace: string, parent: Parent, requestId: string, intent: SpawnIntent, agent: AgentSnapshot, target: ExecutionTarget, source?: WorkspaceSource): Acceptance {
        return this.db.transaction(() => {
            this.assertCanDelegate(namespace, parent);
            const previous = this.lookup(namespace, parent, requestId, intent);
            if (previous) return previous;
            const now = Date.now(), id = randomUUID(), roundId = randomUUID();
            if (intent.workspaceMode === 'worktree' && !source) throw new TaskError(409, 'workspace_source_missing', '独立任务缺少已解析的 Git 基线。');
            const task: Task = { version: 2, id, namespace, parent, agent, target,
                environment: intent.workspaceMode === 'shared' ? { mode: 'shared', machineId: parent.machineId, cwd: parent.cwd }
                    : { mode: 'worktree', machineId: parent.machineId, environmentId: id, source: source!, cwd: source!.sourcePath, status: 'retained' },
                createdAt: now, updatedAt: now, revision: 1 };
            const round: Round = { id: roundId, taskId: id, ordinal: 1, requestId, message: intent.message, phase: 'queued',
                preparation: pendingPreparation(task.environment), ...(task.environment.mode === 'worktree' ? { git: { status: 'pending' as const, attempted: false } } : {}),
                spawnRequestId: randomUUID(), spawnAttempted: false,
                report: '', structuredMissing: true, stop: 'not_started', finish: 'pending', attention: null, createdAt: now, permissions: {} };
            const input: Input = { id: randomUUID(), roundId, kind: 'initial', text: intent.message, delivery: 'pending', output: [] };
            const accepted: Acceptance = { agent_id: id, round_id: roundId, request_id: requestId, revision: 1, accepted: true };
            this.db.query('INSERT INTO delegation_tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, namespace, parentKey(parent), parent.machineId, parent.cwd, JSON.stringify(task), 1, now);
            this.db.query('INSERT INTO delegation_rounds VALUES (?, ?, ?, ?, ?, NULL)').run(roundId, id, 1, round.phase, JSON.stringify(round));
            this.db.query('INSERT INTO delegation_inputs VALUES (?, ?, ?)').run(input.id, roundId, JSON.stringify(input));
            this.db.query('INSERT INTO delegation_requests VALUES (?, ?, ?, ?, ?, ?, ?)').run(namespace, requestId, semantic(parent, intent), id, roundId, JSON.stringify(accepted), now);
            return accepted;
        }).immediate();
    }
    append(namespace: string, parent: Parent, requestId: string, intent: SendIntent): Acceptance {
        return this.db.transaction(() => {
            this.assertCanDelegate(namespace, parent);
            const previous = this.lookup(namespace, parent, requestId, intent);
            if (previous) return previous;
            const bundle = this.require(namespace, intent.id, parent), now = Date.now();
            let round: Round;
            if (bundle.task.environment.mode === 'worktree' && bundle.task.environment.status !== 'retained') throw new TaskError(409, 'workspace_not_retained', '工作区正在删除或已删除，无法继续委派。');
            if (intent.mode === 'next') {
                round = { id: randomUUID(), taskId: intent.id, ordinal: bundle.rounds.at(-1)!.ordinal + 1, requestId, message: intent.message,
                    phase: 'queued', preparation: pendingPreparation(bundle.task.environment),
                    ...(bundle.task.environment.mode === 'worktree' ? { git: { status: 'pending' as const, attempted: false } } : {}),
                    spawnRequestId: randomUUID(), spawnAttempted: false,
                    report: '', structuredMissing: true, stop: 'not_started', finish: 'pending', attention: null, createdAt: now, permissions: {} };
                this.db.query('INSERT INTO delegation_rounds VALUES (?, ?, ?, ?, ?, NULL)').run(round.id, intent.id, round.ordinal, round.phase, JSON.stringify(round));
            } else {
                if (bundle.task.target.flavor !== 'codex') throw new TaskError(409, 'steer_unsupported', 'Claude Code 暂不支持运行中追加。', '使用默认 next 排队下一轮，或中断当前轮次。');
                const active = bundle.rounds.find(round => !['finished', 'failed'].includes(round.phase));
                if (!active || active.id !== intent.roundId || active.phase !== 'running' || active.cancellation) throw new TaskError(409, 'round_not_running', '指定轮次已不接受运行中追加。', '读取当前任务；新任务可用 next 排队，不自动改投后续轮次。');
                round = active;
            }
            const input: Input = { id: randomUUID(), requestId, roundId: round.id, kind: intent.mode === 'steer' ? 'steer' : 'initial', text: intent.message,
                delivery: 'pending', output: [], ...(intent.mode === 'steer' ? { steer: { attempted: false, status: 'pending' as const } } : {}) };
            this.db.query('INSERT INTO delegation_inputs VALUES (?, ?, ?)').run(input.id, round.id, JSON.stringify(input));
            const revision = bundle.task.revision + 1;
            this.db.query('UPDATE delegation_tasks SET revision=?, updatedAt=? WHERE id=?').run(revision, now, intent.id);
            const accepted: Acceptance = { agent_id: intent.id, round_id: round.id, request_id: requestId, input_id: input.id, revision, accepted: true };
            this.db.query('INSERT INTO delegation_requests VALUES (?, ?, ?, ?, ?, ?, ?)').run(namespace, requestId, semantic(parent, intent), intent.id, round.id, JSON.stringify(accepted), now);
            return accepted;
        }).immediate();
    }
    beginRemoval(namespace: string, parent: Parent, id: string, discardIgnored: boolean): Task {
        return this.db.transaction(() => {
            const { task, rounds } = this.require(namespace, id, parent), environment = task.environment;
            if (environment.mode !== 'worktree') throw new TaskError(409, 'workspace_shared', '共享目录不由 Runweft 删除。');
            if (environment.status === 'removed') return task;
            if (environment.status === 'deleting') {
                if (environment.removal?.discardIgnored !== discardIgnored) throw new TaskError(409, 'workspace_remove_pending', '原删除操作仍在对账，不能变更 ignored 文件处理选项。');
                return task;
            }
            if (rounds.some(round => !['finished', 'failed'].includes(round.phase))) throw new TaskError(409, 'workspace_round_pending', '仍有排队、执行或待收尾轮次，不能删除工作区。');
            const last = [...rounds].reverse().find(round => round.git?.status === 'sealed');
            const unprepared = rounds.every(round => round.preparation.mode === 'worktree' && !round.preparation.attempted);
            environment.status = unprepared ? 'removed' : 'deleting';
            environment.removal = { attemptId: randomUUID(), expectedHead: last?.git?.result?.resultHead ?? environment.source.baseCommit,
                discardIgnored, attempted: false, status: unprepared ? 'succeeded' : 'pending' };
            this.saveEnvironment(task); return task;
        }).immediate();
    }
    saveEnvironment(task: Task) {
        this.db.transaction(() => {
            const old = this.require(task.namespace, task.id).task;
            if (JSON.stringify(old.environment) === JSON.stringify(task.environment)) return;
            const revision = old.revision + 1, updatedAt = Date.now();
            this.db.query('UPDATE delegation_tasks SET data=?, revision=?, updatedAt=? WHERE id=?')
                .run(JSON.stringify({ ...old, environment: task.environment, revision, updatedAt }), revision, updatedAt, task.id);
            task.revision = revision; task.updatedAt = updatedAt;
        }).immediate();
    }
    /** A single coordinator serializes writes for a task. Acceptance uses its own SQLite transaction. */
    save(task: Task, round: Round, inputs: Input[]) {
        this.db.transaction(() => {
            const old = this.require(task.namespace, task.id);
            const previous = old.rounds.find(item => item.id === round.id)!;
            const compare = (value: Round | Input) => JSON.stringify({ ...value, observedAt: undefined, completedRevision: undefined });
            const changed = JSON.stringify(old.task.environment) !== JSON.stringify(task.environment) || compare(previous) !== compare(round) || inputs.some(input => {
                const before = old.inputs.find(item => item.id === input.id);
                return !before || compare(before) !== compare(input);
            });
            const revision = old.task.revision + (changed ? 1 : 0);
            if (['finished', 'failed'].includes(round.phase) && !previous.completedRevision) round.completedRevision = revision;
            this.db.query('UPDATE delegation_rounds SET phase=?, data=?, completedRevision=? WHERE id=? AND taskId=?')
                .run(round.phase, JSON.stringify(round), round.completedRevision ?? null, round.id, task.id);
            for (const input of inputs) this.db.query(`INSERT INTO delegation_inputs VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`)
                .run(input.id, round.id, JSON.stringify(input));
            const updatedAt = changed ? Date.now() : old.task.updatedAt;
            const data = { ...old.task, version: 2, environment: task.environment, revision, updatedAt };
            if (changed) {
                const updated = this.db.query('UPDATE delegation_tasks SET data=?, revision=?, updatedAt=? WHERE id=? AND revision=?')
                    .run(JSON.stringify(data), revision, updatedAt, task.id, old.task.revision);
                if (updated.changes !== 1) throw new TaskError(409, 'task_revision_changed', '任务状态已变化，请重新查询。');
            }
            task.revision = revision; task.updatedAt = updatedAt;
            if (round.sessionId) this.db.query('INSERT OR IGNORE INTO delegation_sessions VALUES (?, ?, ?, ?, ?, ?)')
                .run(task.namespace, round.sessionId, round.nativeSessionId ?? '', task.target.flavor, task.id, round.id);
        }).immediate();
    }
}
