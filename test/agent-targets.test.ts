import { afterEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stringify } from 'yaml';
import { AgentClient, offlineAgent } from '../src/agents/client';
import { agentBindings } from '../src/agents/bindings';
import { initAgent, readAgent } from '../src/agents/definitions';
import { atomicWrite, dataPaths, loadConfig } from '../src/config';
import { resourceFixture, resourcePrefix, resourceWrite } from './resources-fixture';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function setup() {
    const h = await resourceFixture(cleanups);
    const home = join(h.home, 'client'), cwd = join(h.home, 'project'); mkdirSync(cwd);
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_')) delete env[key];
    Object.assign(env, { RUNWEFT_MODE: 'hub', RUNWEFT_HUB_URL: h.url, RUNWEFT_HUB_TOKEN: 'test-alpha', GIT_CEILING_DIRECTORIES: h.home });
    const c = loadConfig(home, env), client = new AgentClient(c, cwd);
    function define(id: string, definition: object, scope: 'global' | 'project' = 'global') {
        const path = join(scope === 'global' ? join(home, 'agents') : join(cwd, '.runweft', 'agents'), `${id}.yaml`);
        atomicWrite(path, stringify(definition)); return path;
    }
    async function cli(args: string[], options: { human?: boolean; env?: NodeJS.ProcessEnv } = {}) {
        const child = Bun.spawn([process.execPath, resolve('src/cli.ts'), '--home', home, ...(options.human ? [] : ['--json']), 'agent', ...args], { cwd, env: { ...env, ...options.env }, stdout: 'pipe', stderr: 'pipe' });
        const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
        expect(stdout + stderr).not.toContain('test-alpha');
        return { stdout, stderr, code, value: !options.human && stdout ? JSON.parse(stdout) : null, error: !options.human && stderr ? JSON.parse(stderr).error : null };
    }
    return { ...h, home, cwd, c, env, client, define, cli };
}

test('agent target snapshots preserve native defaults and flavor mapping without starting execution', async () => {
    const h = await setup();
    const codex = await h.register(), claude = await h.register('own', 'claude');
    h.define('portable', { runtime: codex.id });
    h.define('coder', { runtime: codex.id, description: 'Not a prompt', instructions: 'Task instructions', flavor: 'codex', model: 'custom-model', reasoningEffort: 'high' });
    h.define('writer', { runtime: claude.id, flavor: 'claude', model: 'custom-claude', reasoningEffort: 'max' });
    const boundary = h.calls.length;
    const defaults = await h.client.resolve('portable');
    expect(defaults.launchOptions).toEqual({ agent: 'codex', disabledMcpServers: ['runweft'] });
    const coder = await h.client.resolve('coder'), writer = await h.client.resolve('writer');
    expect(coder.launchOptions).toEqual({ agent: 'codex', disabledMcpServers: ['runweft'], model: 'custom-model', modelReasoningEffort: 'high' });
    expect(writer.launchOptions).toEqual({ agent: 'claude', disabledMcpServers: ['runweft'], model: 'custom-claude', effort: 'max' });
    expect(coder).toMatchObject({ connection: { namespace: 'alpha' }, selection: { source: 'definition', runtimeId: codex.id }, modelAuthentication: 'not_checked', modelCompatibility: 'not_checked', execution: 'not_checked' });
    expect(JSON.parse(JSON.stringify(coder))).toEqual(coder);
    h.inspections.get('own')![0].details.checkedAt += 500;
    expect((await h.client.resolve('coder')).resolvedVersion).toBe(coder.resolvedVersion);
    h.define('coder', { runtime: codex.id, instructions: 'Changed' });
    expect((await h.client.resolve('coder')).resolvedVersion).not.toBe(coder.resolvedVersion);
    expect(coder.definition.instructions).toBe('Task instructions');
    expect(h.calls.slice(boundary).every(call => call.method === 'GET')).toBe(true);
    expect(existsSync(dataPaths(h.c).bindings)).toBe(false);
    expect(existsSync(dataPaths(h.c).state)).toBe(false);
});

test('bindings take precedence, preserve shared files and existing client tables, and never cross sources or namespaces', async () => {
    const h = await setup();
    const codex = await h.register(), claude = await h.register('own', 'claude'), betaRuntime = await h.register('beta-machine', 'codex', h.beta);
    const path = h.define('review', { runtime: codex.id });
    const original = readFileSync(path, 'utf8');
    const db = new Database(dataPaths(h.c).bindings, { create: true });
    db.exec('CREATE TABLE claude_mcp_calls (callId TEXT); INSERT INTO claude_mcp_calls VALUES (\'existing\')'); db.close();
    const first = await h.client.resolve('review');
    await h.client.bind('review', claude.id);
    const bound = await h.client.resolve('review');
    expect(bound.target.flavor).toBe('claude'); expect(bound.selection.source).toBe('binding');
    expect(bound.resolvedVersion).not.toBe(first.resolvedVersion);
    expect(readFileSync(path, 'utf8')).toBe(original);
    h.define('review', {}, 'project');
    await expect(h.client.resolve('review')).rejects.toMatchObject({ code: 'agent_unbound' });
    expect((await h.client.resolve('review', 'global')).target.runtimeId).toBe(claude.id);
    await h.client.bind('review', codex.id);
    const betaConfig = loadConfig(h.home, { ...h.env, RUNWEFT_HUB_TOKEN: 'test-beta' });
    const beta = new AgentClient(betaConfig, h.cwd);
    await expect(beta.resolve('review')).rejects.toMatchObject({ code: 'agent_unbound' });
    await beta.bind('review', betaRuntime.id);
    expect((await beta.resolve('review')).target.runtimeId).toBe(betaRuntime.id);
    expect((await h.client.resolve('review')).target.runtimeId).toBe(codex.id);
    const document = readAgent(h.c, h.cwd, 'review');
    expect(offlineAgent(document, agentBindings(h.c)).personalBindings.map(item => item.namespace)).toEqual(['alpha', 'beta']);
    expect(offlineAgent(document, agentBindings(h.c)).namespaceVerified).toBe(false);
    expect((await beta.unbind('review')).removed).toBe(true);
    expect((await beta.unbind('review')).removed).toBe(false);
    expect((await h.client.resolve('review')).target.runtimeId).toBe(codex.id);
    expect((await h.client.unbind('review', 'global')).declaredRuntime).toBe(codex.id);
    expect((await h.client.resolve('review', 'global')).selection.source).toBe('definition');
    const check = new Database(dataPaths(h.c).bindings, { readonly: true });
    expect(check.query('SELECT callId FROM claude_mcp_calls').get()).toEqual({ callId: 'existing' }); check.close();
});

test('known offline bindings are retained, while flavor mismatch, missing target and local routing never fall back', async () => {
    const h = await setup();
    const codex = await h.register(), claude = await h.register('own', 'claude');
    const remote = await h.register('remote');
    h.define('review', { flavor: 'codex', model: 'custom-model', runtime: codex.id });
    await expect(h.client.bind('review', claude.id)).rejects.toMatchObject({ code: 'agent_flavor_mismatch' });
    expect(agentBindings(h.c)).toEqual([]);
    await expect(h.client.bind('review', randomUUID())).rejects.toMatchObject({ code: 'runtime_unknown' });
    const own = h.machines.find(machine => machine.id === 'own')!;
    own.active = false;
    expect((await h.client.bind('review', codex.id)).runtime.eligibility.reason?.code).toBe('machine_offline');
    await expect(h.client.resolve('review')).rejects.toMatchObject({ code: 'machine_offline' });
    own.active = true;
    await h.alpha.request(`${resourcePrefix}/runtimes/${codex.id}`, resourceWrite({}, 'DELETE'));
    await expect(h.client.resolve('review')).rejects.toMatchObject({ code: 'runtime_unregistered' });
    expect((await h.client.bind('review', codex.id)).runtime.registered).toBe(false);
    await h.register();
    const local = loadConfig(h.home, { ...h.env, RUNWEFT_MODE: 'local', RUNWEFT_PORT: String(new URL(h.url).port) });
    atomicWrite(join(dataPaths(local).hapiServer, 'settings.json'), JSON.stringify({ cliApiToken: 'test-alpha' }));
    atomicWrite(join(dataPaths(local).hapiClient, 'settings.json'), JSON.stringify({ machineId: 'own' }));
    const localClient = new AgentClient(local, h.cwd);
    expect(agentBindings(local)).toEqual([]);
    await expect(localClient.bind('review', remote.id)).rejects.toMatchObject({ code: 'local_target_required' });
    await localClient.bind('review', codex.id);
    expect(agentBindings(local)).toHaveLength(1);
    const resolved = await localClient.resolve('review');
    expect(resolved.resolvedVersion).not.toBe((await h.client.resolve('review')).resolvedVersion);
    const changedPort = loadConfig(h.home, { ...local.env, RUNWEFT_PORT: '48320' });
    expect(agentBindings(changedPort)).toEqual(agentBindings(local));
    const differentHub = loadConfig(h.home, { ...h.env, RUNWEFT_HUB_URL: 'http://127.0.0.1:48321' });
    expect(agentBindings(differentHub)).toEqual([]);
    h.define('review', { flavor: 'claude', runtime: codex.id });
    await expect(h.client.resolve('review')).rejects.toMatchObject({ code: 'agent_flavor_mismatch' });
});

test('online agent discovery batches target probes, isolates item errors, and dispatch resolution rechecks freshness', async () => {
    const h = await setup();
    const codex = await h.register(), claude = await h.register('own', 'claude');
    h.define('one', { runtime: codex.id }); h.define('two', { runtime: codex.id }); h.define('three', { runtime: claude.id });
    h.define('unknown', { runtime: randomUUID() }); h.define('unbound', {}); h.define('invalid', { recursive: true });
    h.define('wrong-type', { runtime: claude.id, flavor: 'codex' });
    const start = h.calls.length;
    const result = await h.client.list();
    expect(h.calls.slice(start).filter(call => call.path.endsWith('/agent-availability'))).toHaveLength(1);
    expect(result.agents.filter(agent => !agent.error).map(agent => agent.id)).toEqual(['one', 'three', 'two']);
    expect(result.agents.filter(agent => agent.error).map(agent => agent.error!.code).sort()).toEqual(['agent_flavor_mismatch', 'agent_unbound', 'runtime_unknown']);
    expect(result.errors).toHaveLength(1);
    h.machines.find(machine => machine.id === 'own')!.active = false;
    await expect(h.client.resolve('one')).rejects.toMatchObject({ code: 'machine_offline' });
});

test('agent CLI bind/check/list and unbind clearly separate offline data, namespaces and target failure', async () => {
    const h = await setup();
    const codex = await h.register(), claude = await h.register('own', 'claude');
    initAgent(h.c, h.cwd, 'review'); initAgent(h.c, h.cwd, 'review', { scope: 'project' });
    expect((await h.cli(['check', 'review'])).error.code).toBe('agent_unbound');
    expect((await h.cli(['bind', 'review', '--runtime', codex.id])).code).toBe(0);
    expect((await h.cli(['bind', 'review', '--scope', 'global', '--runtime', claude.id])).code).toBe(0);
    const checked = await h.cli(['check', 'review']);
    expect(checked.code).toBe(0); expect(checked.value.agent.target.runtimeId).toBe(codex.id);
    expect((await h.cli(['check', 'review', '--scope', 'global'])).value.agent.target.runtimeId).toBe(claude.id);
    const offline = await h.cli(['show', 'review']);
    expect(offline.value.agent.namespaceVerified).toBe(false);
    expect((await h.cli(['show', 'review'], { human: true })).stdout).toContain('namespace 尚未认证');
    expect((await h.cli(['list', '--check'])).value.agents[0].selection.runtimeId).toBe(codex.id);
    const other = await h.cli(['check', 'review'], { env: { RUNWEFT_HUB_TOKEN: 'test-beta' } });
    expect(other.error.code).toBe('agent_unbound');
    h.machines.find(machine => machine.id === 'own')!.active = false;
    const unavailable = await h.cli(['list', '--check']);
    expect(unavailable.code).toBe(1); expect(unavailable.value.agents[0].error.code).toBe('machine_offline');
    expect((await h.cli(['bind', 'review', '--runtime', codex.id], { human: true })).stdout).toContain('当前不可选');
    expect((await h.cli(['check', 'review'])).error.code).toBe('machine_offline');
    expect((await h.cli(['unbind', 'review'])).value.removed).toBe(true);
    expect((await h.cli(['check', 'review'])).error.code).toBe('agent_unbound');
    expect((await h.cli(['validate', 'review'])).value.valid).toBe(true);
    expect(existsSync(dataPaths(h.c).state)).toBe(false);
}, 20_000);
