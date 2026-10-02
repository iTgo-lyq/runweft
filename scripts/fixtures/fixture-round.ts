import { randomUUID } from 'node:crypto';
import type { TaskStore } from '../../src/tasks/store';
import type { Task, Round } from '../../src/tasks/types';

/** Current fixture records use the production append/save contract, scoped to this round. */
export function appendFixtureRound(store: TaskStore, task: Task, agent: Round['agent'], fields: Pick<Round, 'stop'> & Partial<Pick<Round, 'report' | 'sessionId' | 'nativeSessionId' | 'executionAbsent'>>) {
    const accepted = store.append(task.namespace, task.parent, randomUUID(), { id: task.id, mode: 'next', message: 'Fixture continuation' }, agent);
    const bundle = store.require(task.namespace, task.id), round = bundle.rounds.find(item => item.id === accepted.round_id)!;
    Object.assign(round, fields, { phase: 'finished', finish: 'complete', completedAt: Date.now() });
    store.save(bundle.task, round, bundle.inputs.filter(input => input.roundId === round.id));
    return { task: bundle.task, round };
}
