import { randomUUID } from 'node:crypto';
import { openState } from '../state';
import { contentVersion } from '../agents/definitions';
import type { ExecutionTarget } from '../resources/types';
import { parentKey, TaskError, type Acceptance, type AgentSnapshot, type Input, type Parent, type Round, type SendIntent, type SpawnIntent, type Task, type TaskBundle } from './types';

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
        const task: Task = { ...read<Task>(row), revision: row.revision, updatedAt: row.updatedAt };
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
            WHERE r.phase NOT IN ('finished', 'failed')`).all() as { namespace: string; id: string }[];
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
    accept(namespace: string, parent: Parent, requestId: string, intent: SpawnIntent, agent: AgentSnapshot, target: ExecutionTarget): Acceptance {
        return this.db.transaction(() => {
            this.assertCanDelegate(namespace, parent);
            const previous = this.lookup(namespace, parent, requestId, intent);
            if (previous) return previous;
            const now = Date.now(), id = randomUUID(), roundId = randomUUID();
            const task: Task = { id, namespace, parent, agent, target, environment: { mode: 'shared', machineId: parent.machineId, cwd: parent.cwd },
                createdAt: now, updatedAt: now, revision: 1 };
            const round: Round = { id: roundId, taskId: id, ordinal: 1, requestId, message: intent.message, phase: 'queued',
                preparation: { mode: 'shared', status: 'pending' }, spawnRequestId: randomUUID(), spawnAttempted: false,
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
            if (intent.mode === 'next') {
                round = { id: randomUUID(), taskId: intent.id, ordinal: bundle.rounds.at(-1)!.ordinal + 1, requestId, message: intent.message,
                    phase: 'queued', preparation: { mode: 'shared', status: 'pending' }, spawnRequestId: randomUUID(), spawnAttempted: false,
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
    /** A single coordinator serializes writes for a task. Acceptance uses its own SQLite transaction. */
    save(task: Task, round: Round, inputs: Input[]) {
        this.db.transaction(() => {
            const old = this.require(task.namespace, task.id);
            const previous = old.rounds.find(item => item.id === round.id)!;
            const compare = (value: Round | Input) => JSON.stringify({ ...value, observedAt: undefined, completedRevision: undefined });
            const changed = compare(previous) !== compare(round) || inputs.some(input => {
                const before = old.inputs.find(item => item.id === input.id);
                return !before || compare(before) !== compare(input);
            });
            const revision = old.task.revision + (changed ? 1 : 0);
            if (['finished', 'failed'].includes(round.phase) && !previous.completedRevision) round.completedRevision = revision;
            this.db.query('UPDATE delegation_rounds SET phase=?, data=?, completedRevision=? WHERE id=? AND taskId=?')
                .run(round.phase, JSON.stringify(round), round.completedRevision ?? null, round.id, task.id);
            for (const input of inputs) this.db.query(`INSERT INTO delegation_inputs VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`)
                .run(input.id, round.id, JSON.stringify(input));
            if (changed) this.db.query('UPDATE delegation_tasks SET revision=?, updatedAt=? WHERE id=?').run(revision, Date.now(), task.id);
            if (round.sessionId) this.db.query('INSERT OR IGNORE INTO delegation_sessions VALUES (?, ?, ?, ?, ?, ?)')
                .run(task.namespace, round.sessionId, round.nativeSessionId ?? '', task.target.flavor, task.id, round.id);
        }).immediate();
    }
}
