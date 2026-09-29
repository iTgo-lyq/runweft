import { isDeepStrictEqual } from 'node:util';
import type { CodeFetch, CodeManifest, ResultAction } from './result-types';
import type { ArtifactRetention } from './retention';
import { assertResultReleaseIdle, type CodeRetention } from './result-retention';
import { randomUUID } from 'node:crypto';
import { openState } from '../state';
import { contentVersion } from '../agents/definitions';
import type { WorkspaceSource } from '../../hapi/shared/src/workspaces';
import type { ExecutionTarget } from '../resources/types';
import { pendingOutputs, type OutputItem, type OutputJob, type OutputManifest } from './output-types';
import { parentKey, pendingPreparation, validateWorkspaceTarget, TaskError, type ArtifactAction, type ArtifactIntent, type InputFiles, type Acceptance, type AgentSnapshot, type Input, type Parent, type Round, type SendIntent, type SpawnIntent, type Task, type TaskBundle } from './types';

type TaskRow = { data: string; revision: number; updatedAt: number };
const read = <T>(row: { data: string }): T => JSON.parse(row.data);
const semantic = (parent: Parent, intent: SpawnIntent | SendIntent) => {
    const normalized = { ...intent }; if ('workspaceMode' in normalized && normalized.workspaceMode === 'worktree') normalized.baseRef ??= 'HEAD'; if (!normalized.inputs?.length) delete normalized.inputs; if (!normalized.outputs?.length) delete normalized.outputs;
    return contentVersion({ parentKey: parentKey(parent), machineId: parent.machineId, cwd: parent.cwd, intent: normalized });
};

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
            WHERE r.phase NOT IN ('finished', 'failed') OR json_extract(t.data, '$.environment.status')='deleting'
            OR json_extract(r.data, '$.artifactRetention.state')='releasing'
            OR json_extract(r.data, '$.codeRetention.state')='releasing'
            OR json_extract(t.data, '$.environment.remote.release.state')='pending'
            OR json_extract(r.data, '$.code.retryRequested')=1
            OR json_extract(r.data, '$.code.status') IN ('capturing', 'publishing', 'unknown')
            OR (json_extract(r.data, '$.code.status')='available' AND json_extract(r.data, '$.code.sourceReleased')=0)
            OR EXISTS (SELECT 1 FROM delegation_code_fetches f WHERE f.taskId=t.id AND (f.status NOT IN ('failed', 'available') OR (f.status='available' AND json_extract(f.data, '$.released')=0)))
            OR (json_extract(r.data, '$.inputFiles.attempted')=1 AND json_extract(r.data, '$.inputFiles.intermediateReleased')=0)
            OR EXISTS (SELECT 1 FROM json_each(r.data, '$.outputFiles.jobs') WHERE json_extract(value, '$.phase') <> 'complete')`).all() as { namespace: string; id: string }[];
    }
    lookup(namespace: string, parent: Parent, requestId: string, intent: SpawnIntent | SendIntent): Acceptance | null {
        const row = this.db.query('SELECT fingerprint, accepted FROM delegation_requests WHERE namespace=? AND requestId=?').get(namespace, requestId) as { fingerprint: string; accepted: string } | null;
        if (!row) {
            const pending = this.db.query('SELECT fingerprint FROM delegation_artifact_intents WHERE namespace=? AND requestId=?').get(namespace, requestId) as { fingerprint: string } | null;
            if (pending && pending.fingerprint !== semantic(parent, intent)) throw new TaskError(409, 'task_request_conflict', '同一 request ID 已固定其他附件接受意图。');
            return null;
        }
        if (row.fingerprint !== semantic(parent, intent)) throw new TaskError(409, 'task_request_conflict', '同一 request ID 已用于不同任务意图。', '重试原请求请保持参数；新任务使用新的 request ID。');
        const accepted: Acceptance = JSON.parse(row.accepted);
        const task = this.require(namespace, accepted.agent_id, parent).task;
        if ('workspaceMode' in intent) validateWorkspaceTarget(task.target.machineId, parent, intent);
        return accepted;
    }
    requests(namespace: string, taskId: string) {
        return (this.db.query('SELECT accepted, createdAt FROM delegation_requests WHERE namespace=? AND taskId=? ORDER BY createdAt DESC, rowid DESC LIMIT 20')
            .all(namespace, taskId) as { accepted: string; createdAt: number }[]).map(row => ({ ...JSON.parse(row.accepted) as Acceptance, created_at: row.createdAt }));
    }
    beginArtifactIntent(namespace: string, parent: Parent, requestId: string, intent: SpawnIntent | SendIntent): ArtifactIntent {
        const fingerprint = semantic(parent, intent);
        const previous = this.db.query('SELECT fingerprint, data FROM delegation_artifact_intents WHERE namespace=? AND requestId=?')
            .get(namespace, requestId) as { fingerprint: string; data: string } | null;
        if (previous) {
            if (previous.fingerprint !== fingerprint) throw new TaskError(409, 'task_request_conflict', '同一 request ID 已固定其他附件接受意图。');
            return read<ArtifactIntent>(previous);
        }
        const value: ArtifactIntent = { namespace, requestId, reference: `runweft:input:${requestId}`, requests: intent.inputs ?? [] };
        this.db.query('INSERT INTO delegation_artifact_intents VALUES (?, ?, ?, ?, NULL, ?)').run(namespace, requestId, fingerprint, JSON.stringify(value), Date.now());
        return value;
    }
    saveArtifactIntent(value: ArtifactIntent) {
        this.db.query('UPDATE delegation_artifact_intents SET data=? WHERE namespace=? AND requestId=?').run(JSON.stringify(value), value.namespace, value.requestId);
    }
    pendingArtifactIntents(): ArtifactIntent[] {
        return (this.db.query('SELECT data FROM delegation_artifact_intents WHERE taskId IS NULL').all() as { data: string }[]).map(read<ArtifactIntent>);
    }
    artifactIntentAccepted(value: ArtifactIntent) {
        const result = this.db.query('UPDATE delegation_artifact_intents SET taskId=(SELECT taskId FROM delegation_requests WHERE namespace=? AND requestId=?) WHERE namespace=? AND requestId=? AND EXISTS(SELECT 1 FROM delegation_requests WHERE namespace=? AND requestId=?)')
            .run(value.namespace, value.requestId, value.namespace, value.requestId, value.namespace, value.requestId);
        return result.changes > 0;
    }
    deleteArtifactIntent(value: ArtifactIntent) {
        this.db.query('DELETE FROM delegation_artifact_intents WHERE namespace=? AND requestId=? AND taskId IS NULL').run(value.namespace, value.requestId);
    }
    private inputFiles(namespace: string, requestId: string, intent: SpawnIntent | SendIntent): InputFiles | undefined {
        if (!intent.inputs?.length) return;
        const row = this.db.query('SELECT data FROM delegation_artifact_intents WHERE namespace=? AND requestId=?').get(namespace, requestId) as { data: string } | null;
        const value = row ? read<ArtifactIntent>(row) : null;
        if (!value?.files || value.files.length !== intent.inputs.length) throw new TaskError(409, 'artifact_acceptance_incomplete', '附件尚未完成冻结和留存。');
        return { reference: value.reference, files: value.files, operationId: randomUUID(), attempted: false, status: 'pending', downloaded: [], paths: [], intermediateReleased: false };
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
            validateWorkspaceTarget(target.machineId, parent, intent);
            const now = Date.now(), id = randomUUID(), roundId = randomUUID();
            if (intent.workspaceMode === 'worktree' && !source) throw new TaskError(409, 'workspace_source_missing', '独立任务缺少已解析的 Git 基线。');
            const task: Task = { version: 2, id, namespace, parent, agent, target,
                environment: intent.workspaceMode === 'shared' ? { mode: 'shared', machineId: parent.machineId, cwd: parent.cwd }
                    : { mode: 'worktree', machineId: target.machineId, environmentId: id, source: source!, cwd: source!.sourcePath, status: 'retained',
                        ...(target.machineId === parent.machineId ? {} : { remote: { origin: source! } }) },
                createdAt: now, updatedAt: now, revision: 1 };
            const round: Round = { id: roundId, taskId: id, ordinal: 1, requestId, message: intent.message, phase: 'queued',
                preparation: pendingPreparation(task.environment), inputFiles: this.inputFiles(namespace, requestId, intent), outputFiles: pendingOutputs(intent.outputs, requestId), ...(task.environment.mode === 'worktree' ? { git: { status: 'pending' as const, attempted: false } } : {}),
                spawnRequestId: randomUUID(), spawnAttempted: false,
                report: '', structuredMissing: true, stop: 'not_started', finish: 'pending', attention: null, createdAt: now, permissions: {} };
            const input: Input = { id: randomUUID(), roundId, kind: 'initial', text: intent.message, delivery: 'pending', output: [] };
            const accepted: Acceptance = { agent_id: id, round_id: roundId, request_id: requestId, revision: 1, accepted: true };
            this.db.query('INSERT INTO delegation_tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, namespace, parentKey(parent), parent.machineId, parent.cwd, JSON.stringify(task), 1, now);
            this.db.query('INSERT INTO delegation_rounds VALUES (?, ?, ?, ?, ?, NULL)').run(roundId, id, 1, round.phase, JSON.stringify(round));
            this.db.query('INSERT INTO delegation_inputs VALUES (?, ?, ?)').run(input.id, roundId, JSON.stringify(input));
            this.db.query('INSERT INTO delegation_requests VALUES (?, ?, ?, ?, ?, ?, ?)').run(namespace, requestId, semantic(parent, intent), id, roundId, JSON.stringify(accepted), now);
            this.db.query('UPDATE delegation_artifact_intents SET taskId=? WHERE namespace=? AND requestId=?').run(accepted.agent_id, namespace, requestId);
            return accepted;
        }).immediate();
    }
    append(namespace: string, parent: Parent, requestId: string, intent: SendIntent): Acceptance {
        return this.db.transaction(() => {
            this.assertCanDelegate(namespace, parent);
            const previous = this.lookup(namespace, parent, requestId, intent);
            if (previous) return previous;
            const bundle = this.require(namespace, intent.id, parent), now = Date.now();
            if (bundle.rounds.some(round => round.artifactRetention?.state === 'releasing')) throw new TaskError(409, 'artifact_release_pending', '附件释放尚未完成，请查询任务后再继续委派。');
            if (bundle.rounds.some(round => round.codeRetention?.state === 'releasing')) throw new TaskError(409, 'result_release_pending', '代码成果释放尚未完成，请查询任务后再继续委派。');
            let round: Round;
            if (bundle.task.environment.mode === 'worktree' && bundle.task.environment.status !== 'retained') throw new TaskError(409, 'workspace_not_retained', '工作区正在删除或已删除，无法继续委派。');
            if (intent.mode === 'next') {
                round = { id: randomUUID(), taskId: intent.id, ordinal: bundle.rounds.at(-1)!.ordinal + 1, requestId, message: intent.message,
                    phase: 'queued', preparation: pendingPreparation(bundle.task.environment), inputFiles: this.inputFiles(namespace, requestId, intent), outputFiles: pendingOutputs(intent.outputs, requestId),
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
            this.db.query('UPDATE delegation_artifact_intents SET taskId=? WHERE namespace=? AND requestId=?').run(accepted.agent_id, namespace, requestId);
            return accepted;
        }).immediate();
    }
    artifactAction(namespace: string, value: ArtifactAction) {
        return this.db.transaction(() => {
            const { parent, requestId, ...intent } = value;
            this.assertCanDelegate(namespace, parent);
            const bundle = this.require(namespace, intent.id, parent);
            const fingerprint = contentVersion({ parentKey: parentKey(parent), machineId: parent.machineId, cwd: parent.cwd, artifactAction: intent });
            const previous = this.db.query('SELECT fingerprint, accepted FROM delegation_requests WHERE namespace=? AND requestId=?').get(namespace, requestId) as { fingerprint: string; accepted: string } | null;
            if (previous) {
                if (previous.fingerprint !== fingerprint) throw new TaskError(409, 'task_request_conflict', '同一 request ID 已用于其他任务或文件操作。');
                return JSON.parse(previous.accepted) as Acceptance & { artifact_operation_id: string };
            }
            if (this.db.query('SELECT 1 FROM delegation_artifact_intents WHERE namespace=? AND requestId=?').get(namespace, requestId)) throw new TaskError(409, 'task_request_conflict', '同一 request ID 已用于附件接受意图。');
            const round = bundle.rounds.find(item => item.id === intent.roundId);
            if (!round) throw new TaskError(404, 'round_unknown', '此任务中没有指定轮次。');
            if (!['finished', 'failed'].includes(round.phase)) throw new TaskError(409, 'artifact_round_pending', '轮次尚未结束，请先等待执行与收尾。');
            if (round.artifactRetention) throw new TaskError(409, 'artifact_retention_released', '该轮已请求释放留存，不能再补交或重传。', '新的成果通过 next 新建轮次。');
            if (bundle.rounds.some(item => item.artifactRetention?.state === 'releasing')) throw new TaskError(409, 'artifact_release_pending', '本任务仍有附件释放操作。');
            if (round.outputFiles?.jobs.some(job => job.phase !== 'complete')) throw new TaskError(409, 'artifact_operation_pending', '该轮已有文件操作，先查询其结果。');
            if (intent.action === 'collect' && (bundle.rounds.some(item => !['finished', 'failed'].includes(item.phase))
                || bundle.rounds.some(item => item.outputFiles?.jobs.some(job => job.phase !== 'complete')))) throw new TaskError(409, 'artifact_collect_active', '补收需要本任务所有轮次及文件操作静止。');
            if (intent.action === 'collect' && bundle.task.environment.mode === 'worktree' && bundle.task.environment.status !== 'retained') throw new TaskError(409, 'workspace_not_retained', '工作区已移除或正在删除，不能补收文件。');
            if (intent.action === 'collect' && bundle.task.environment.mode === 'worktree' && !bundle.rounds.some(item => item.preparation.status === 'ready')) throw new TaskError(409, 'workspace_not_prepared', '工作区尚未准备成功，不能从主目录代收成果。');
            const base = structuredClone(round.outputFiles?.latest?.items ?? []);
            if (intent.action === 'retry' && !base.some(item => item.status === 'failed' && item.captureOperationId && item.upload)) {
                throw new TaskError(409, 'artifact_no_retry_candidate', '没有可重传的失败候选。', '缺失文件请在任务静止后用 task artifacts collect 显式补收。');
            }
            const job: OutputJob = { id: randomUUID(), requestId, kind: intent.action, createdAt: Date.now(), phase: 'pending',
                declarations: intent.action === 'collect' ? intent.files : [], base };
            round.outputFiles ??= { declarations: [], jobs: [] }; round.outputFiles.jobs.push(job);
            this.save(bundle.task, round, []);
            const accepted = { agent_id: intent.id, round_id: round.id, request_id: requestId, artifact_operation_id: job.id, revision: bundle.task.revision, accepted: true as const };
            this.db.query('INSERT INTO delegation_requests VALUES (?, ?, ?, ?, ?, ?, ?)').run(namespace, requestId, fingerprint, intent.id, round.id, JSON.stringify(accepted), Date.now());
            return accepted;
        }).immediate();
    }
    beginArtifactRelease(namespace: string, parent: Parent, id: string, plans: { roundId: string; retention: ArtifactRetention }[]) {
        return this.db.transaction(() => {
            const bundle = this.require(namespace, id, parent);
            this.assertCanDelegate(namespace, parent);
            if (bundle.rounds.some(round => !['finished', 'failed'].includes(round.phase) || round.outputFiles?.jobs.some(job => job.phase !== 'complete'))) {
                throw new TaskError(409, 'artifact_release_active', '释放需要本任务所有轮次和文件操作结束。');
            }
            for (const plan of plans) {
                const round = bundle.rounds.find(round => round.id === plan.roundId)!;
                if (round.artifactRetention) continue; // Resume the already persisted release, never invent a second owner.
                round.artifactRetention = plan.retention; round.artifactsRevision = bundle.task.revision + 1;
                this.save(bundle.task, round, []);
            }
            return this.require(namespace, id, parent);
        }).immediate();
    }
    manifests(taskId: string, roundId: string): OutputManifest[] {
        return (this.db.query('SELECT data FROM delegation_artifact_manifests WHERE taskId=? AND roundId=? ORDER BY version').all(taskId, roundId) as { data: string }[]).map(read<OutputManifest>);
    }
    publishArtifacts(task: Task, round: Round, job: OutputJob, items: OutputItem[]) {
        this.db.transaction(() => {
            const previous = this.db.query('SELECT data FROM delegation_artifact_manifests WHERE jobId=?').get(job.id) as { data: string } | null;
            if (previous) throw new TaskError(409, 'artifact_manifest_exists', '此交付操作已经发布清单，请重新读取任务。');
            const manifest: OutputManifest = { version: (round.outputFiles!.latest?.version ?? 0) + 1, jobId: job.id, kind: job.kind, createdAt: Date.now(),
                status: items.every(item => item.status === 'available') ? 'delivered' : 'incomplete', items: structuredClone(items) };
            this.db.query('INSERT INTO delegation_artifact_manifests VALUES (?, ?, ?, ?, ?)').run(task.id, round.id, manifest.version, job.id, JSON.stringify(manifest));
            round.outputFiles!.latest = manifest; job.publishedVersion = manifest.version; job.phase = 'cleanup'; delete job.error;
            round.artifactsRevision = this.require(task.namespace, task.id).task.revision + 1;
            this.save(task, round, []);
        }).immediate();
    }
    codeManifests(taskId: string, roundId?: string): CodeManifest[] {
        return (this.db.query('SELECT data FROM delegation_code_manifests WHERE taskId=? AND (? IS NULL OR roundId=?) ORDER BY rowid')
            .all(taskId, roundId ?? null, roundId ?? null) as { data: string }[]).map(read<CodeManifest>);
    }
    beginResultRelease(namespace: string, parent: Parent, id: string, plans: { roundId: string; retention: CodeRetention }[], discardPending: boolean) {
        return this.db.transaction(() => {
            const bundle = this.require(namespace, id, parent);
            this.assertCanDelegate(namespace, parent);
            const selected = bundle.rounds.filter(round => plans.some(plan => plan.roundId === round.id));
            assertResultReleaseIdle(bundle, selected, discardPending);
            for (const round of selected) if (!round.codeRetention) {
                round.codeRetention = plans.find(plan => plan.roundId === round.id)!.retention;
                round.codeRevision = bundle.task.revision + 1; this.save(bundle.task, round, []);
            }
            return this.require(namespace, id, parent);
        }).immediate();
    }
    publishCode(task: Task, round: Round, manifest: CodeManifest) {
        this.db.transaction(() => {
            this.db.query('INSERT INTO delegation_code_manifests VALUES (?, ?, ?, ?, ?)')
                .run(task.id, round.id, manifest.version, manifest.jobId, JSON.stringify(manifest));
            round.code!.latest = manifest; round.code!.status = 'available'; delete round.code!.error;
            if (round.attention?.scope === 'code') round.attention = null;
            round.codeRevision = this.require(task.namespace, task.id).task.revision + 1;
            this.save(task, round, []);
        }).immediate();
    }
    codeFetches(taskId: string, roundId?: string): CodeFetch[] {
        return (this.db.query('SELECT data FROM delegation_code_fetches WHERE taskId=? AND (? IS NULL OR roundId=?) ORDER BY rowid')
            .all(taskId, roundId ?? null, roundId ?? null) as { data: string }[]).map(read<CodeFetch>);
    }
    saveCodeFetch(task: Task, round: Round, fetch: CodeFetch) {
        this.db.transaction(() => {
            const previous = this.codeFetches(task.id).find(item => item.id === fetch.id);
            if (JSON.stringify(previous) === JSON.stringify(fetch)) return;
            fetch.updatedAt = Date.now();
            this.db.query('INSERT INTO delegation_code_fetches VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status=excluded.status, data=excluded.data')
                .run(fetch.id, task.id, round.id, fetch.status, JSON.stringify(fetch));
            const latest = this.codeFetches(task.id, round.id).at(-1)!;
            round.resultFetch = { id: latest.id, requestId: latest.requestId, status: latest.status, error: latest.error,
                cleanupError: latest.cleanupError, ref: latest.fetched?.ref ?? latest.localRef, head: latest.fetched?.head };
            if (['available', 'failed', 'unknown'].includes(fetch.status)
                && (previous?.status !== fetch.status || !isDeepStrictEqual(previous?.error, fetch.error))) {
                round.codeRevision = this.require(task.namespace, task.id).task.revision + 1;
            }
            this.save(task, round, []);
        }).immediate();
    }
    resultAction(namespace: string, value: ResultAction) {
        return this.db.transaction(() => {
            const { parent, requestId, ...intent } = value;
            this.assertCanDelegate(namespace, parent);
            const { task, rounds } = this.require(namespace, intent.id, parent);
            const fingerprint = contentVersion({ parentKey: parentKey(parent), machineId: parent.machineId, cwd: parent.cwd, resultAction: intent });
            const previous = this.db.query('SELECT fingerprint, accepted FROM delegation_requests WHERE namespace=? AND requestId=?').get(namespace, requestId) as { fingerprint: string; accepted: string } | null;
            if (previous) {
                if (previous.fingerprint !== fingerprint) throw new TaskError(409, 'task_request_conflict', '同一 request ID 已用于其他操作。');
                return JSON.parse(previous.accepted) as Acceptance & { result_operation_id: string };
            }
            if (this.db.query('SELECT 1 FROM delegation_artifact_intents WHERE namespace=? AND requestId=?').get(namespace, requestId)) throw new TaskError(409, 'task_request_conflict', '同一 request ID 已用于附件接受意图。');
            const round = intent.roundId ? rounds.find(item => item.id === intent.roundId) : rounds.at(-1);
            if (!round) throw new TaskError(404, 'round_unknown', '此任务中没有指定轮次。');
            if (task.environment.mode !== 'worktree') throw new TaskError(409, 'result_not_applicable', '共享目录的改动直接位于主工作区，没有独立代码成果。');
            if (round.codeRetention) throw new TaskError(409, 'result_released', '该轮代码已请求释放，不能重新发布或取回；已导入主仓库的引用仍由主仓库保留。');
            let operationId: string;
            if (intent.action === 'retry') {
                if (!round.code || !['needs_attention', 'unknown'].includes(round.code.status)) throw new TaskError(409, 'result_retry_unavailable', '该轮没有需要重试的代码交付。');
                if (round.code.retryRequested) throw new TaskError(409, 'result_retry_pending', '已有重试请求，先查询该轮状态。');
                round.code.retryRequested = true; operationId = round.code.id;
                this.save(task, round, []);
            } else {
                const origin = task.environment.remote?.origin ?? task.environment.source;
                if (parent.machineId !== origin.machineId) throw new TaskError(409, 'result_target_mismatch', '请在发起仓库所在机器取回代码。');
                const fetch: CodeFetch = { id: randomUUID(), requestId, taskId: task.id, roundId: round.id, parent,
                    target: { machineId: origin.machineId, repositoryId: origin.repositoryId, commonDir: origin.commonDir, objectFormat: origin.objectFormat, cwd: parent.cwd },
                    status: 'waiting', operationId: randomUUID(), attempted: false, baseline: [], output: [], released: false,
                    createdAt: Date.now(), updatedAt: Date.now() };
                this.saveCodeFetch(task, round, fetch); operationId = fetch.id;
            }
            const accepted = { agent_id: task.id, round_id: round.id, request_id: requestId, result_operation_id: operationId, revision: task.revision, accepted: true as const };
            this.db.query('INSERT INTO delegation_requests VALUES (?, ?, ?, ?, ?, ?, ?)').run(namespace, requestId, fingerprint, task.id, round.id, JSON.stringify(accepted), Date.now());
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
            if (rounds.some(round => !['finished', 'failed'].includes(round.phase) || round.outputFiles?.jobs.some(job => job.kind !== 'retry' && !job.publishedVersion && job.phase !== 'complete'))) throw new TaskError(409, 'workspace_round_pending', '仍有排队、执行或待收尾轮次，不能删除工作区。');
            if (environment.remote) {
                if (rounds.some(round => (!round.executionAbsent && round.stop !== 'stopped')
                    || round.outputFiles?.jobs.some(job => job.phase !== 'complete') || round.artifactRetention?.state === 'releasing'
                    || (round.inputFiles?.attempted && !round.inputFiles.intermediateReleased)
                    || round.codeRetention?.state === 'releasing' || round.code?.retryRequested
                    || (round.git?.status !== 'not_prepared' && (round.git?.status !== 'sealed'
                        || (!round.codeRetention && (!round.code?.latest || !round.code.sourceReleased || round.code.cleanupError)))))
                    || this.codeFetches(id).some(fetch => !fetch.released)) {
                    throw new TaskError(409, 'result_remove_pending', '远端成果、附件或取回操作尚未完成；先完成交付或显式释放未交付代码，再移除工作区。');
                }
                environment.remote.release = { state: 'pending' };
            }
            const last = [...rounds].reverse().find(round => round.git?.status === 'sealed');
            const unprepared = rounds.every(round => round.preparation.mode === 'worktree' && !round.preparation.attempted);
            environment.status = unprepared ? 'removed' : 'deleting';
            environment.removal = { attemptId: randomUUID(), expectedHead: last?.git?.result?.resultHead ?? environment.source.baseCommit,
                discardIgnored, attempted: false, status: unprepared ? 'succeeded' : 'pending',
                ...(environment.remote ? { releaseResults: rounds.flatMap(round => round.git?.result ? [{ roundId: round.id, resultHead: round.git.result.resultHead }] : []) } : {}) };
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
