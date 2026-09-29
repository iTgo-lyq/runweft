import { nativeTerminal, type Round, type Status, type TaskBundle } from './types';

export function overview(bundle: TaskBundle, round: Round = bundle.rounds.at(-1)!) {
    const inputs = bundle.inputs.filter(input => input.roundId === round.id);
    let status: Status = 'running';
    if (round.phase === 'failed' || (round.phase === 'finished' && round.startupFailure)) status = 'failed';
    else if (round.phase === 'finished') status = inputs.some(input => input.observation?.phase === 'failed') ? 'failed'
        : inputs.some(input => input.observation?.phase === 'interrupted') ? 'interrupted' : 'completed';
    else if (round.attention) status = round.attention.code.includes('unknown') ? 'unknown' : 'needs_attention';
    return { agent_id: bundle.task.id, agent_type: bundle.task.agent.id, round_id: round.id, round: round.ordinal, request_id: round.requestId,
        revision: bundle.task.revision, completed_revision: round.completedRevision, status, attention: round.attention,
        report: { text: round.report.slice(0, 4000), total: round.report.length, next_offset: round.report.length > 4000 ? 4000 : null, structuredMissing: round.structuredMissing },
        cwd: bundle.task.environment.cwd, runtime_id: bundle.task.target.runtimeId, machine_id: bundle.task.target.machineId,
        native_status: inputs.map(input => ({ local_id: input.id, delivery: input.delivery, phase: input.observation?.phase ?? 'not_observed', reliable_terminal: nativeTerminal(input.observation) })),
        stop: round.stop, finish: round.finish, updated_at: bundle.task.updatedAt };
}
export function detail(bundle: TaskBundle, options: { roundId?: string; offset?: number; limit?: number } = {}) {
    const round = options.roundId ? bundle.rounds.find(round => round.id === options.roundId) : bundle.rounds.at(-1);
    if (!round) return null;
    const offset = options.offset ?? 0, limit = options.limit ?? 16_000;
    return { ...overview(bundle, round), parent: bundle.task.parent, agent: bundle.task.agent, environment: bundle.task.environment,
        preparation: round.preparation, phase: round.phase, session_id: round.sessionId, native_session_id: round.nativeSessionId,
        observed_at: round.observedAt, permissions: round.permissions, host_pid: round.hostPid,
        inputs: bundle.inputs.filter(input => input.roundId === round.id).map(({ output, text, ...input }) => input),
        report: { text: round.report.slice(offset, offset + limit), offset, total: round.report.length,
            next_offset: offset + limit < round.report.length ? offset + limit : null, structuredMissing: round.structuredMissing },
        delivery: { report: round.report ? 'available' : round.phase === 'finished' ? 'no_final_text' : 'pending', git: 'not_applicable', attachments: 'not_applicable', acceptance: 'external' },
        rounds: bundle.rounds.map(item => ({ id: item.id, ordinal: item.ordinal, phase: item.phase, request_id: item.requestId, completed_revision: item.completedRevision })) };
}
