import { nativeTerminal, type Round, type Status, type TaskBundle } from './types';

function gitDelivery(bundle: TaskBundle, round: Round) {
    const environment = bundle.task.environment;
    if (environment.mode === 'shared') return 'not_applicable' as const;
    const result = round.git?.result;
    return { status: round.git?.status ?? 'pending', environment_id: environment.environmentId, retained: environment.status,
        source_cwd: environment.source.sourcePath, checkout: environment.checkout, branch: environment.branch,
        base_commit: environment.source.baseCommit, start_head: round.preparation.mode === 'worktree' ? round.preparation.startHead : undefined,
        result_head: result?.resultHead, result_ref: result?.resultRef, checkpoint: result?.checkpoint,
        partial: result?.partial, file_count: result?.fileCount, paths: result?.paths, error: round.git?.error };
}
export function overview(bundle: TaskBundle, round: Round = bundle.rounds.at(-1)!) {
    const inputs = bundle.inputs.filter(input => input.roundId === round.id);
    const blocking = round.phase === 'queued' ? bundle.rounds.find(item => item.ordinal < round.ordinal && item.attention && !['finished', 'failed'].includes(item.phase)) : undefined;
    const attention = round.attention ?? blocking?.attention ?? null;
    let status: Status = 'running';
    if (round.phase === 'failed' || (round.phase === 'finished' && round.startupFailure)) status = 'failed';
    else if (round.phase === 'finished' && round.cancellation?.confirmed) status = 'interrupted';
    else if (round.phase === 'finished') status = inputs.some(input => input.observation?.phase === 'failed') ? 'failed'
        : inputs.some(input => input.observation?.phase === 'interrupted') ? 'interrupted' : 'completed';
    else if (attention) status = attention.scope !== 'workspace' && attention.code.includes('unknown') ? 'unknown' : 'needs_attention';
    return { agent_id: bundle.task.id, agent_type: bundle.task.agent.id, round_id: round.id, round: round.ordinal, request_id: round.requestId,
        active_round_id: bundle.rounds.find(round => !['finished', 'failed'].includes(round.phase))?.id,
        revision: bundle.task.revision, completed_revision: round.completedRevision, status, attention, blocking_round_id: blocking?.id,
        report: { text: round.report.slice(0, 4000), total: round.report.length, next_offset: round.report.length > 4000 ? 4000 : null, structuredMissing: round.structuredMissing,
            structured: round.structuredReport ? Object.fromEntries(Object.entries(round.structuredReport).map(([key, value]) => [key, value.slice(0, 1000)])) : undefined,
            incomplete: !!round.cancellation?.confirmed && !inputs.every(input => nativeTerminal(input.observation)) },
        cwd: bundle.task.environment.cwd, workspace_mode: bundle.task.environment.mode, git: gitDelivery(bundle, round), runtime_id: bundle.task.target.runtimeId, machine_id: bundle.task.target.machineId,
        native_status: inputs.map(input => ({ local_id: input.id, delivery: input.delivery,
            phase: round.cancellation?.confirmed && !nativeTerminal(input.observation) ? 'unknown' : input.observation?.phase ?? 'not_observed',
            last_observed_phase: input.observation?.phase, reliable_terminal: nativeTerminal(input.observation) })),
        stop: round.stop, finish: round.finish, updated_at: bundle.task.updatedAt };
}
export function detail(bundle: TaskBundle, options: { roundId?: string; offset?: number; limit?: number } = {}) {
    const round = options.roundId ? bundle.rounds.find(round => round.id === options.roundId) : bundle.rounds.at(-1);
    if (!round) return null;
    const offset = options.offset ?? 0, limit = options.limit ?? 16_000;
    return { ...overview(bundle, round), parent: bundle.task.parent, agent: bundle.task.agent, environment: bundle.task.environment,
        preparation: round.preparation, phase: round.phase, session_id: round.sessionId, native_session_id: round.nativeSessionId,
        resume: round.resume, reconstruction: round.reconstruction ? { reason: round.reconstruction.reason, source_round_ids: round.reconstruction.sourceRoundIds } : undefined,
        cancellation: round.cancellation,
        observed_at: round.observedAt, permissions: round.permissions, host_pid: round.hostPid,
        inputs: bundle.inputs.filter(input => input.roundId === round.id).map(({ output, text, ...input }) => ({ ...input,
            // Claude's native result contains the same full report; expose it only through report pagination.
            observation: input.observation ? (({ nativeResult, ...fact }) => fact)(input.observation) : undefined })),
        report: { ...overview(bundle, round).report, text: round.report.slice(offset, offset + limit), offset, total: round.report.length,
            next_offset: offset + limit < round.report.length ? offset + limit : null, structuredMissing: round.structuredMissing },
        delivery: { report: round.report ? 'available' : round.phase === 'finished' ? 'no_final_text' : 'pending', git: gitDelivery(bundle, round), attachments: 'not_applicable', acceptance: 'external' },
        rounds: bundle.rounds.map(item => ({ id: item.id, ordinal: item.ordinal, phase: item.phase, request_id: item.requestId, completed_revision: item.completedRevision })) };
}
