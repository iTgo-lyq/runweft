import { afterEach, expect, test } from 'bun:test';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { atomicWrite } from '../../src/config';
import { IdentityConnection } from '../../src/hub/connect/client';
import { HubTaskReader } from '../../src/hub/delegation/reader';
import { hubConnectionPaths } from '../../src/hub/resources/connection';
import { hubDelegationFixture } from './hub-delegation-fixture';
import { integrationBinaries } from './binaries';
import { fixtureCleanup } from '../fixture-cleanup';
import { until } from '../helpers';

const cleanup = fixtureCleanup([]); afterEach(() => cleanup.close());

test('query-only compiled CLI reads saved tasks and bounded native pages; exact local scope precedes pagination', async () => {
    const h = await hubDelegationFixture(cleanup.resources), home = join(h.home, 'reader');
    const connection = new IdentityConnection(home, h.url), begin = await connection.begin();
    const confirm = await fetch(h.url + `/api/runweft/connect/${begin.requestId}/confirm`, { method: 'POST',
        headers: { authorization: `Bearer ${h.owner.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ spaceId: h.space }) });
    expect(confirm.status).toBe(200); await connection.complete();
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, CODEX_HOME: join(home, 'codex'), CLAUDE_CONFIG_DIR: join(home, 'claude') };
    delete env.RUNWEFT_IDENTITY_TOKEN; delete env.HAPI_SESSION_ID;
    const cli = async (args: string[], ok = true, session?: string) => {
        const child = Bun.spawn([integrationBinaries().runweft.path, '--home', home, '--json', ...args], {
            cwd: h.cwd, env: { ...env, ...(session ? { HAPI_SESSION_ID: session } : {}) }, stdout: 'pipe', stderr: 'pipe' });
        const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        expect(exit).toBe(ok ? 0 : 1); return JSON.parse(ok ? stdout : stderr);
    };
    const tasks = [];
    for (const cwd of [h.cwd, h.cwd, join(h.cwd, 'different')]) {
        const accepted = await h.post('spawn', { ...h.payload(), parent: { ...h.parent, cwd }, intent: { ...h.payload().intent, observation: { kind: 'non_git', cwd } } });
        const active = await until(() => h.post('read', { id: accepted.agent_id }), value => value.inputs[0]?.observation?.phase === 'accepted');
        h.complete(active.session_id, 'Synthetic saved report');
        await until(() => h.post('read', { id: accepted.agent_id }), value => value.status === 'completed');
        tasks.push({ ...accepted, sessionId: active.session_id });
    }
    const first = tasks[0], calls = { ...h.calls };
    expect((await cli(['task', 'list'], false)).error.code).toBe('task_local_scope_unavailable');
    const all = await cli(['task', 'list', '--all', '--status', 'completed', '--limit', '2']);
    expect(all.total).toBe(3); expect(all.items).toHaveLength(2); expect(all.pages).toBe(2); expect(all.scope.kind).toBe('all');
    expect((await cli(['task', 'show', first.agent_id, '--round', first.round_id])).report.text).toBe('Synthetic saved report');
    expect((await cli(['task', 'wait', first.agent_id, '--timeout', '0'])).timed_out).toBe(false);
    expect((await cli(['task', 'result', 'show', first.agent_id])).round_id).toBe(first.round_id);
    expect((await cli(['task', 'artifacts', 'show', first.agent_id, '--round', first.round_id])).manifests).toEqual([]);
    const latest = await cli(['task', 'messages', first.agent_id, '--limit', '2']);
    expect(latest.messages).toHaveLength(2); expect(latest.history_scope).toBe('native_session');
    const earlier = await cli(['task', 'messages', first.agent_id, '--limit', '2', '--before-at', String(latest.page.nextBeforeAt), '--before-seq', String(latest.page.nextBeforeSeq)]);
    expect(earlier.messages.every((m: any) => !latest.messages.some((n: any) => m.id === n.id))).toBe(true);
    expect((await cli(['task', 'messages', first.agent_id, '--limit', '201'], false)).error.code).toBe('invalid_task_request');
    expect((await cli(['task', 'messages', first.agent_id, '--before-at', '1'], false)).error.code).toBe('invalid_task_request');
    expect((await cli(['task', 'show', first.agent_id], false, first.sessionId)).error.code).toBe('subagent_delegation_denied');
    expect((await cli(['task', 'list', '--all'], false, first.sessionId)).error.code).toBe('subagent_delegation_denied');
    expect((await cli(['task', 'wait', ...Array(9).fill(first.agent_id)], false)).error.code).toBe('invalid_task_request');
    expect(existsSync(connection.paths.machineConnection)).toBe(false);
    const machine = h.machineConnections.get(h.machineId)!;
    atomicWrite(hubConnectionPaths(home, h.url).machineConnection, JSON.stringify({ schemaVersion: 1, hub: h.url, ownerId: h.owner.identity.id,
        requestId: machine.requestId, machineId: h.machineId, active: { token: machine.token, credentialId: machine.credentialId }, createdAt: Date.now() }));
    const local = await cli(['task', 'list', '--page', '2', '--limit', '1', '--workspace', 'project', '--parent', h.machineId]);
    expect(local.total).toBe(2); expect(local.items).toHaveLength(1); expect(local.scope).toEqual({ kind: 'local', machineId: h.machineId, cwd: h.cwd });
    const foreign = new HubTaskReader({ url: h.url, credential: { token: h.other.token, spaceId: h.space }, env: {} }, h.cwd);
    await expect(foreign.read(first.agent_id)).rejects.toMatchObject({ status: 404 });
    expect(h.calls).toEqual(calls); // Diagnostic reads do not spawn, send, resume, stop or mutate execution.
}, 30_000);

test('read waits cancel without stopping, bind their original round and reject missing native history', async () => {
    const h = await hubDelegationFixture(cleanup.resources), reader = new HubTaskReader({ url: h.url, credential: { token: h.owner.token, spaceId: h.space }, env: {} }, h.cwd);
    const accepted = await h.post('spawn', h.payload());
    const active = await until(() => h.post('read', { id: accepted.agent_id }), value => value.inputs[0]?.observation?.phase === 'accepted');
    const before = { ...h.calls };
    expect((await reader.wait([accepted.agent_id], 1)).timed_out).toBe(true);
    await expect(reader.wait([accepted.agent_id], 30_000, undefined, AbortSignal.timeout(40))).rejects.toThrow();
    expect(h.calls).toEqual(before);
    const pending = reader.wait([accepted.agent_id], 10_000);
    h.complete(active.session_id, 'Fixed first round');
    const completed = await pending;
    expect(completed.agents[0].round_id).toBe(accepted.round_id);
    const revision = completed.agents[0].revision;
    const next = await h.post('send', { requestId: crypto.randomUUID(), intent: { id: accepted.agent_id, message: 'Next', mode: 'next' } });
    const running = await until(() => h.post('read', { id: accepted.agent_id }), value => value.round_id === next.round_id && value.inputs[0]?.observation?.phase === 'accepted');
    h.complete(running.session_id, 'Second round');
    const update = await reader.wait([accepted.agent_id], 10_000, { [accepted.agent_id]: revision });
    expect(update.agents[0].round_id).toBe(next.round_id);
    expect((await reader.messages(accepted.agent_id, { roundId: accepted.round_id })).history_scope).toBe('native_session');
    const bundle = h.gateway.delegation.coordinator.store.require(h.namespace, accepted.agent_id), round = bundle.rounds.at(-1)!;
    round.sessionId = undefined; h.gateway.delegation.coordinator.store.save(bundle.task, round, []);
    await expect(reader.messages(accepted.agent_id)).rejects.toMatchObject({ code: 'task_session_unavailable' });
}, 30_000);
