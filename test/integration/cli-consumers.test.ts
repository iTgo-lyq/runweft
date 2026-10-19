import { saveTestConnection } from '../identity-fixture';
import { compiledCli } from './compiled-cli';
import { fixtureCleanup } from '../fixture-cleanup';
import { afterEach, beforeAll, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { atomicWrite, loadConfig } from '../../src/config';
import { HubClient } from '../../src/hub/client';
import { HubTaskClient, hubOptions } from '../../src/hub/delegation/client';
import { hubConnectionPaths } from '../../src/hub/resources/connection';
import { recordClaudeCall } from '../../src/mcp/claude-hook';
import { hubDelegationFixture } from './hub-delegation-fixture';
import { until } from '../helpers';
import { resourceInspection } from './native-fixture';

const cleanupOwner = fixtureCleanup([]), cleanups = cleanupOwner.resources;
afterEach(() => cleanupOwner.close());
let executable: string;
beforeAll(async () => { executable = await compiledCli(); }, 30_000);
const environment = () => {
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_') || key.startsWith('HAPI_')) delete env[key]; return env;
};
async function setup(flavor: 'codex' | 'claude' = 'codex') {
    const h = await hubDelegationFixture(cleanups, flavor), home = join(h.home, 'consumer');
    const options = { url: h.url, home, env: environment() }, paths = hubConnectionPaths(home, h.url);
    const credential = h.machineConnections.get(h.machineId)!;
    await saveTestConnection(home, h.url, h.owner.token, h.space);
    atomicWrite(paths.machineConnection, JSON.stringify({ schemaVersion: 1, hub: h.url, ownerId: h.owner.identity.id, requestId: credential.requestId,
        machineId: h.machineId, active: { token: credential.token, credentialId: credential.credentialId }, createdAt: Date.now() }));
    h.gateway.selections.set(h.actor, { agentId: h.agent.id, repositoryId: null, runtimeId: null });
    // The native execution is mocked. '/' is an actual non-Git directory; test writes use the owned fixture directory.
    atomicWrite(join(home, 'config.yaml'), `hub:\n  url: ${h.url}\n`);
    const cwd = '/', client = new HubTaskClient(options, cwd);
    async function cli(args: string[], extraEnv: NodeJS.ProcessEnv = {}) {
        const child = Bun.spawn([executable, '--home', home, '--json', ...args], { cwd, env: { ...options.env, ...extraEnv }, stdout: 'pipe', stderr: 'pipe' });
        const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        expect(stdout + stderr).not.toContain(h.owner.token); expect(stdout + stderr).not.toContain(credential.token);
        const errors = stderr.split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return {}; } });
        return { exit, result: stdout.trim() ? JSON.parse(stdout) : undefined, error: errors.find(item => item.error)?.error };
    }
    async function mcp(host: 'codex' | 'claude', hapiSessionId?: string) {
        const env = { ...options.env, ...(hapiSessionId ? { HAPI_SESSION_ID: hapiSessionId } : {}) };
        const transport = new StdioClientTransport({ command: executable, args: ['--home', home, 'mcp', 'serve', '--client', host],
            cwd, env: Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')), stderr: 'pipe' });
        const mcp = new Client({ name: 'consumer-test', version: '1' }); await mcp.connect(transport); cleanups.push(() => mcp.close());
        let stderr = ''; transport.stderr?.on('data', chunk => { stderr += chunk; });
        const call = async (name: string, args: Record<string, unknown> = {}, session = 'main', callId: string = randomUUID()) => {
            if (host === 'claude') recordClaudeCall(loadConfig(home, env), { hook_event_name: 'PreToolUse', tool_name: `mcp__runweft__${name}`, tool_use_id: callId, session_id: session, cwd });
            const _meta = host === 'codex' ? { threadId: session, sessionId: 'root', callId } : { 'claudecode/toolUseId': callId };
            const value = await mcp.callTool({ name, arguments: args, _meta });
            expect(JSON.stringify(value) + stderr).not.toContain(h.owner.token);
            return value.structuredContent as Record<string, any>;
        };
        return { mcp, call };
    }
    return { ...h, home, cwd, options, paths, client, cli, mcp };
}

test('central definitions isolate unusable targets, retain valid entries and recheck live routing without execution', async () => {
    const h = await setup(), agents = h.gateway.agents;
    const valid = agents.create(h.actor, { requestId: randomUUID(), definition: { ...h.definition, name: 'Second valid' } });
    const unbound = agents.create(h.actor, { requestId: randomUUID(), definition: { name: 'No runtime' } });
    const mismatch = agents.create(h.actor, { requestId: randomUUID(), definition: { ...h.definition, name: 'Changed flavor' } });
    agents.update(h.actor, mismatch.id, { expectedVersion: 1, definition: { ...h.definition, name: 'Changed flavor', flavor: 'claude' } });
    const offlineMachine = h.machine(), offlineRuntime = h.gateway.resources.store.registerRuntime(h.actor,
        { machineId: offlineMachine, flavor: 'codex' }, resourceInspection('codex'));
    const offline = agents.create(h.actor, { requestId: randomUUID(), definition: { name: 'Offline target', runtimeId: offlineRuntime.id } });
    h.machines.find(machine => machine.id === offlineMachine)!.active = false;
    const catalog = await h.client.definitions();
    expect(catalog.agents.filter(agent => !agent.error).map(agent => agent.id).sort()).toEqual([h.agent.id, valid.id].sort());
    for (const [agentId, code] of [[unbound.id, 'agent_runtime_required'], [mismatch.id, 'agent_flavor_mismatch'], [offline.id, 'machine_offline']]) {
        expect(catalog.agents.find(agent => agent.id === agentId)).toMatchObject({ target: null, selection: null, error: { code } });
    }
    expect(catalog.modelAuthentication).toBe('not_checked'); expect(catalog.execution).toBe('not_checked');
    expect(h.gateway.store.db.query('SELECT COUNT(*) AS count FROM delegation_tasks').get()).toEqual({ count: 0 });
    h.machines.find(machine => machine.id === h.machineId)!.active = false;
    const refreshed = await h.client.definitions();
    expect(refreshed.agents.find(agent => agent.id === h.agent.id)?.error?.code).toBe('machine_offline');
    await expect(h.client.spawn(h.agent.id, 'Must not route to an offline target', randomUUID())).rejects.toMatchObject({ code: 'machine_offline' });
    expect(h.gateway.store.db.query('SELECT COUNT(*) AS count FROM delegation_tasks').get()).toEqual({ count: 0 });
});

test('compiled Hub CLI uses the saved central selection, deduplicates and reads/continues with fresh Agent versions', async () => {
    const h = await setup();
    const requestId = randomUUID(), args = ['task', 'spawn', '--message', 'Central default', '--request-id', requestId];
    const accepted = await h.cli(args); expect(accepted.exit).toBe(0); expect(accepted.result.accepted).toBe(true);
    h.gateway.agents.update(h.actor, h.agent.id, { expectedVersion: 1, definition: { ...h.definition, instructions: 'updated centrally' } });
    expect((await h.cli(args)).result).toEqual(accepted.result);
    const active = await until(() => h.client.read(accepted.result.agent_id), value => value.inputs[0]?.observation?.phase === 'accepted');
    expect(active.agent.definition.instructions).toBe('version one'); expect(active.agent.id).toBe(h.agent.id);
    h.complete(active.session_id!, 'Central report');
    const done = await h.cli(['task', 'wait', accepted.result.agent_id, '--timeout', '2000']);
    expect(done.result.agents[0].status).toBe('completed');
    expect((await h.cli(['task', 'show', accepted.result.agent_id])).result.report.text).toBe('Central report');
    const sent = await h.cli(['task', 'send', accepted.result.agent_id, '--message', 'Continue']); expect(sent.exit).toBe(0);
    const next = await until(() => h.client.read(accepted.result.agent_id), value => value.round_id === sent.result.round_id && value.inputs[0]?.observation?.phase === 'accepted');
    expect(next.agent.definition.instructions).toBe('updated centrally'); expect(h.calls.resume).toBe(1);
    await h.client.interrupt(next.agent_id, next.round_id);
    await until(() => h.client.read(next.agent_id), value => value.status === 'interrupted');
    const unrelated = await h.cli(['task', 'show', next.agent_id], { RUNWEFT_IDENTITY_TOKEN: h.other.token, RUNWEFT_UNUSED: '' });
    expect(unrelated.exit).toBe(1); expect(unrelated.error.code).toBe('hub_identity_input_removed');
    const malformed = await h.cli(['task', 'spawn', 'old-yaml-name', '--message', 'No fallback']);
    expect(malformed.exit).toBe(1); expect(h.calls.spawn).toBe(1);
    expect((await h.cli(['workspace', 'prepare', '--base', 'HEAD'])).error.code).toBe('workspace_git_required');
}, 15_000);

test('compiled MCP covers two hosts by two runtimes, native metadata, parent isolation, current selection and child tool suppression', async () => {
    for (const host of ['codex', 'claude'] as const) for (const runtime of ['codex', 'claude'] as const) {
        const h = await setup(runtime), m = await h.mcp(host);
        const tools = await m.mcp.listTools(), spawn = tools.tools.find(tool => tool.name === 'spawn_agent')!;
        expect(spawn.inputSchema.required).not.toContain('agent_type');
        expect((await m.call('runweft_status')).connection).toMatchObject({ connected: true, ownerId: h.owner.identity.id, spaceId: h.space });
        expect((await m.call('list_agent_definitions')).agents[0]).toMatchObject({ id: h.agent.id, error: null });
        const first = await m.call('spawn_agent', { message: 'From native host', runtime_id: h.runtime.id }, 'main', 'stable-call');
        expect(first.accepted).toBe(true);
        expect(await m.call('spawn_agent', { message: 'From native host', runtime_id: h.runtime.id }, 'main', 'stable-call')).toEqual(first);
        expect((await m.call('list_agents', {}, 'another-thread')).agents).toEqual([]);
        const active = await until(() => m.call('read_agent', { id: first.agent_id }), value => value.inputs?.[0]?.observation?.phase === 'accepted');
        expect(active.parent).toMatchObject({ kind: 'mcp', host, nativeSessionId: 'main', cwd: h.cwd });
        if (host === runtime) expect((await m.call('spawn_agent', { message: 'recurse' }, active.native_session_id)).error.code).toBe('subagent_delegation_denied');
        const child = await h.mcp(host, active.session_id); expect((await child.mcp.listTools()).tools).toEqual([]);
        expect((await child.call('spawn_agent', { message: 'bypass discovery' })).error.code).toBe('subagent_delegation_denied');
        h.complete(active.session_id, `${host} to ${runtime}`);
        const result = await m.call('wait', { ids: [first.agent_id], timeout_ms: 2000 });
        expect(result.agents[0].status).toBe('completed'); expect(result.agents[0].report.text).toBe(`${host} to ${runtime}`);
        expect(h.calls.spawn).toBe(1);
        // Native built-in child metadata is not itself a prohibition; only Runweft-managed sessions are blocked.
        expect((await m.call('spawn_agent', { message: 'Other native thread' }, 'native-built-in-child')).accepted).toBe(true);
    }
}, 30_000);

test('Hub transport forbids foreign origins and missing space, preserves cancellation, and refreshes only before a new operation', async () => {
    const h = await setup();
    expect(() => hubOptions(loadConfig(join(h.home, 'unconnected'), {}))).toThrow('显式连接 Hub');
    expect(() => new HubTaskClient({ url: h.url, home: join(h.home, 'empty'), env: {} }, h.cwd)).toThrow('尚未连接');
    expect(() => new HubTaskClient({ url: h.url, home: join(h.home, 'empty'), space: h.space, credential: { token: h.owner.token }, env: {} }, h.cwd)).toThrow('尚未登记本机');
    const consumer = new HubTaskClient(h.options, h.cwd);
    const transport = new HubClient(h.options, 'hubDelegation', 'unavailable').http;
    await expect(transport.request('https://different.invalid')).rejects.toMatchObject({ code: 'hub_request_path_invalid' });
    const accepted = await consumer.spawn(h.agent.id, 'Waiting', randomUUID());
    await until(() => consumer.read(accepted.agent_id), value => value.inputs[0]?.observation?.phase === 'accepted');
    const abort = new AbortController(), wait = consumer.wait([accepted.agent_id], 30_000, undefined, abort.signal).catch(e => e);
    await Bun.sleep(30); abort.abort(new Error('consumer stopped waiting'));
    expect((await wait).message).toBe('consumer stopped waiting'); expect(h.calls.stop).toBe(0);
    const current = await consumer.read(accepted.agent_id); h.complete(current.session_id!, 'Still running after wait cancelled');
    expect((await consumer.wait([accepted.agent_id], 2000)).agents[0].status).toBe('completed');
});
