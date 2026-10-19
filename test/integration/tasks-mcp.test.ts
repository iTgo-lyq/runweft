import { saveTestConnection } from '../identity-fixture';
import { afterEach, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { execFileSync } from 'node:child_process';
import { atomicWrite, loadConfig } from '../../src/config';
import { HubAgentClient } from '../../src/hub/agents/client';
import { hubConnectionPaths } from '../../src/hub/resources/connection';
import { observeRepository } from '../../src/hub/repositories/observation';
import { createMcpServer } from '../../src/mcp/server';
import { recordClaudeCall } from '../../src/mcp/claude-hook';
import { hubDelegationFixture } from './hub-delegation-fixture';
import { until } from '../helpers';
import { workspaces } from './workspaces-fixture';

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanups.splice(0).reverse()) await fn(); });
async function fixture(host: 'codex' | 'claude' = 'codex', workspaceApi?: (request: Request) => Promise<Response>) {
    const h = await hubDelegationFixture(cleanups, host, workspaceApi);
    const cwd = workspaceApi ? h.cwd : '/';
    if (workspaceApi) {
        for (const args of [['init'], ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '--allow-empty', '-m', 'baseline'], ['branch', 'review-base']])
            execFileSync('git', args, { cwd, stdio: 'ignore' });
        const repository = h.gateway.repositories.create(h.actor, { requestId: crypto.randomUUID(), name: 'Fixture repository', aliases: [] });
        h.gateway.repositories.bind(h.actor, { machineId: h.machineId, observation: observeRepository(cwd), repositoryId: repository.id });
    }
    const config = loadConfig(h.home, { ...process.env, HAPI_SESSION_ID: undefined });
    const paths = hubConnectionPaths(h.home, h.url), credential = h.machineConnections.get(h.machineId)!;
    await saveTestConnection(h.home, h.url, h.owner.token, h.space);
    atomicWrite(paths.machineConnection, JSON.stringify({ schemaVersion: 1, hub: h.url, ownerId: h.owner.identity.id, requestId: credential.requestId,
        machineId: h.machineId, active: { token: credential.token, credentialId: credential.credentialId }, createdAt: Date.now() }));
    const hub = { url: h.url, home: h.home, env: config.env };
    const server = createMcpServer({ client: host, cwd, config: () => config, hub: () => hub });
    const client = new Client({ name: 'delegation-test', version: '1' });
    const [left, right] = InMemoryTransport.createLinkedPair();
    await server.connect(left); await client.connect(right);
    cleanups.push(async () => { await client.close(); await server.close(); });
    const call = async (name: string, args: Record<string, unknown> = {}, options: { callId?: string; parent?: string; signal?: AbortSignal } = {}) => {
        const callId = options.callId ?? crypto.randomUUID(), parent = options.parent ?? 'parent';
        if (host === 'claude') recordClaudeCall(config, { hook_event_name: 'PreToolUse', tool_name: `mcp__runweft__${name}`, tool_use_id: callId, session_id: parent, cwd });
        const _meta = host === 'codex' ? { threadId: parent, sessionId: parent, callId } : { 'claudecode/toolUseId': callId };
        const result = await client.callTool({ name, arguments: args, _meta }, undefined, { signal: options.signal });
        const value = result.structuredContent as Record<string, any>;
        expect(JSON.parse((result.content as { text: string }[])[0].text)).toEqual(value);
        return value;
    };
    return { ...h, cwd, config, client, call };
}

test('MCP discover, durably accept, deduplicate, wait, paginate and isolate parent tasks', async () => {
    for (const host of ['codex'] as const) {
        const h = await fixture(host);
        expect((await h.call('list_agent_definitions')).agents[0]).toMatchObject({ id: h.agent.id });
        const args = { agent_type: h.agent.id, message: 'Report only' };
        const first = await h.call('spawn_agent', args, { callId: 'stable-call' });
        expect(first).toMatchObject({ accepted: true, revision: 1 });
        h.gateway.agents.update(h.actor, h.agent.id, { expectedVersion: 1, definition: { ...h.definition, instructions: 'version two' } });
        expect(await h.call('spawn_agent', args, { callId: 'stable-call' })).toEqual(first);
        expect(await h.call('spawn_agent', { ...args, request_id: first.request_id })).toEqual(first);
        expect((await h.call('spawn_agent', { ...args, message: 'Changed', request_id: first.request_id })).error.code).toBe('task_request_conflict');
        expect((await h.call('list_agents', {}, { parent: 'other-parent' })).agents).toEqual([]);
        expect((await h.call('read_agent', { id: first.agent_id }, { parent: 'other-parent' })).error).toBeDefined();
        expect((await h.call('list_agents')).agents[0].accepted_requests[0]).toMatchObject(first);
        const active = await until(() => h.call('read_agent', { id: first.agent_id }), v => v.inputs?.[0]?.observation?.phase === 'accepted');
        expect(active.parent).toMatchObject({ kind: 'mcp', host, nativeSessionId: 'parent' });
        expect(h.calls.spawn).toBe(1);
        h.complete(active.session_id, 'x'.repeat(5000));
        const waited = await h.call('wait', { ids: [first.agent_id], timeout_ms: 2000 });
        expect(waited.timed_out).toBe(false); expect(waited.agents[0].status).toBe('completed');
        expect(waited.agents[0].report.next_offset).toBe(4000);
        expect((await h.call('read_agent', { id: first.agent_id, offset: 4000, limit: 1000 })).report.text).toHaveLength(1000);
        expect((await h.call('wait', { ids: [first.agent_id], timeout_ms: 0, after_revision: { [first.agent_id]: waited.agents[0].revision } })).timed_out).toBe(true);
        expect((await h.call('spawn_agent', { ...args, workspace_mode: 'remote' })).error.code).toBe('invalid_task_request');
        expect((await h.call('wait', { ids: [first.agent_id], timeout_ms: 600_000 })).error.code).toBe('invalid_tool_arguments');
    }
});

test('MCP controls use exact rounds and native approval IDs; child associations reject delegation', async () => {
    const h = await fixture();
    const first = await h.call('spawn_agent', { agent_type: h.agent.id, message: 'First' });
    const active = await until(() => h.call('read_agent', { id: first.agent_id }), v => v.inputs?.[0]?.observation?.phase === 'accepted');
    h.sessions.get(active.session_id)!.session.agentState!.requests = { approval: { tool: 'Bash', arguments: { command: 'test' }, createdAt: Date.now() } };
    expect((await h.call('respond_to_permission', { id: first.agent_id, round_id: first.round_id, request_id: 'approval', decision: 'denied' })).error).toBeUndefined();
    expect(h.calls.permission).toBe(1);
    const next = await h.call('send_input', { id: first.agent_id, message: 'Next' }, { callId: 'next' });
    expect(await h.call('send_input', { id: first.agent_id, message: 'Next' }, { callId: 'next' })).toEqual(next);
    expect(next.round_id).not.toBe(first.round_id);
    const steered = await h.call('send_input', { id: first.agent_id, message: 'Steer', mode: 'steer', round_id: first.round_id });
    expect(steered.round_id).toBe(first.round_id); expect(steered.input_id).toBeString();
    for (const name of ['spawn_agent', 'send_input']) {
        const args = name === 'spawn_agent' ? { agent_type: h.agent.id, message: 'Recurse' } : { id: first.agent_id, message: 'Recurse' };
        expect((await h.call(name, args, { parent: active.native_session_id })).error.code).toBe('subagent_delegation_denied');
        h.config.env.HAPI_SESSION_ID = active.session_id;
        expect((await h.call(name, args)).error.code).toBe('subagent_delegation_denied');
        delete h.config.env.HAPI_SESSION_ID;
    }
    expect((await h.call('interrupt_agent', { id: first.agent_id, round_id: next.round_id })).error).toBeUndefined();
    expect(h.calls.interrupt).toBe(0);
    await h.call('interrupt_agent', { id: first.agent_id, round_id: first.round_id });
    await until(() => h.call('read_agent', { id: first.agent_id, round_id: first.round_id }), v => v.status === 'interrupted');
    expect(h.calls.interrupt).toBeGreaterThan(0);
});

for (const mode of ['cancel', 'disconnect']) {
    const workspace_mode = 'worktree';
    test(`MCP ${mode} leaves ${workspace_mode} work running and center finishes it once`, async () => {
        const git = workspaces(), h = await fixture('codex', git.handler);
        const first = await h.call('spawn_agent', { agent_type: h.agent.id, message: 'Accepted once', workspace_mode });
        const active = await until(() => h.call('read_agent', { id: first.agent_id }), v => v.inputs?.[0]?.observation?.phase === 'accepted');
        const controller = new AbortController();
        const waiting = h.call('wait', { ids: [first.agent_id], timeout_ms: 5000 }, { signal: controller.signal }).catch(error => error);
        await Bun.sleep(60);
        if (mode === 'cancel') controller.abort(); else await h.client.close();
        await waiting;
        expect(h.calls.stop).toBe(0); expect(h.calls.interrupt).toBe(0); expect(h.calls.send).toBe(1);
        h.complete(active.session_id);
        const done = await until(() => h.post('read', { id: first.agent_id }), v => v.status === 'completed');
        if (workspace_mode === 'worktree') expect(done.git.status).toBe('sealed');
        expect(h.calls.spawn).toBe(1); expect(h.calls.stop).toBe(1);
    });
}

test('MCP pin explicit Git bases, repair only finishing and resume with sealed result facts', async () => {
    for (const host of ['codex'] as const) {
        const git = workspaces(); git.control.failFinish = true;
        const h = await fixture(host, git.handler);
        const tools = (await h.client.listTools()).tools;
        expect(tools.some(tool => tool.name === 'retry_finish')).toBe(true);
        expect(tools.some(tool => tool.name.includes('remove'))).toBe(false);
        const args = { agent_type: h.agent.id, message: 'Independent task', workspace_mode: 'worktree', base_ref: 'refs/heads/review-base' };
        const accepted = await h.call('spawn_agent', args, { callId: 'worktree-call' }), id = accepted.agent_id;
        expect(await h.call('spawn_agent', args, { callId: 'worktree-call' })).toEqual(accepted);
        expect(git.calls.find(call => call.action === 'resolve')).toMatchObject({ baseRef: args.base_ref });
        expect((await h.call('spawn_agent', { ...args, request_id: accepted.request_id, base_ref: 'HEAD' })).error.code).toBe('task_request_conflict');
        expect((await h.call('spawn_agent', { ...args, workspace_mode: 'shared' })).error.code).toBe('invalid_task_request');
        const active = await until(() => h.call('read_agent', { id }), value => value.inputs?.[0]?.observation?.phase === 'accepted');
        h.complete(active.session_id, 'NATIVE_REPORT');
        const attention = await h.call('wait', { ids: [id], timeout_ms: 2000 });
        expect(attention.agents[0]).toMatchObject({ status: 'needs_attention', git: { status: 'needs_attention' }, native_status: [{ phase: 'completed' }] });
        expect((await h.call('retry_finish', { id, round_id: accepted.round_id }, { parent: 'other-parent' })).error.code).toBe('task_parent_mismatch');
        git.control.failFinish = false;
        expect((await h.call('retry_finish', { id, round_id: accepted.round_id })).status).toBe('retry_requested');
        const sealed = await until(() => h.call('read_agent', { id }), value => value.status === 'completed');
        expect(sealed.report.text).toBe('NATIVE_REPORT'); expect(sealed.git.status).toBe('sealed');
        expect(h.calls.spawn).toBe(1); expect(h.calls.send).toBe(1);
        const next = await h.call('send_input', { id, message: 'Continue' });
        const running = await until(() => h.call('read_agent', { id }), value => value.round_id === next.round_id && value.inputs?.[0]?.observation?.phase === 'accepted');
        expect(running.preparation.startHead).toBe(sealed.git.result_head); expect(running.cwd).toBe(sealed.cwd);
        h.complete(running.session_id, 'SECOND_REPORT');
        const done = await h.call('wait', { ids: [id], timeout_ms: 2000 });
        expect(done.agents[0].git.status).toBe('sealed'); expect(h.calls.resume).toBe(1); expect(h.calls.spawn).toBe(1);
    }
});

test('agent resolution forwards cancellation through current Hub authentication without resource probes', async () => {
    const h = await fixture();
    let started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; }), paths: string[] = [];
    const http = Bun.serve({ port: 0, fetch(request) {
        const path = new URL(request.url).pathname; paths.push(path);
        if (path === '/api/runweft/health') return Response.json({ service: 'runweft', protocolVersion: 1, ready: true, capabilities: { hubAccess: 1, hubAgents: 1, hubAgentDefinitions: 1 } });
        started(); return new Promise<Response>(resolve => request.signal.addEventListener('abort', () => resolve(new Response()), { once: true }));
    } });
    cleanups.push(() => http.stop(true));
    const controller = new AbortController();
    const pending = new HubAgentClient({ url: http.url.origin, space: h.space, credential: { token: h.owner.token }, env: {} }).resolve({ agentId: h.agent.id }, controller.signal);
    await entered; controller.abort(new Error('cancel resolution'));
    await expect(pending).rejects.toThrow('cancel resolution');
    expect(paths).toEqual(['/api/runweft/health', '/api/auth']);
});
