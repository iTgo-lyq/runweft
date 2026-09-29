import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stringify } from 'yaml';
import { HapiClient } from '../src/hapi';
import { freePort } from '../src/services';

// Dedicated homes, native version probes and real Hub/Runner only. No model calls.
const executable = resolve(process.argv[2] ?? 'dist/runweft');
const parent = resolve(process.env.RUNWEFT_SMOKE_ROOT ?? '.dev-smoke'); mkdirSync(parent, { recursive: true });
const root = mkdtempSync(join(parent, 'agents-')), center = join(root, 'center'), otherHome = join(root, 'other-client');
const project = join(root, 'project'), worktree = join(root, 'worktree'), unrelated = join(root, 'unrelated');
const env: NodeJS.ProcessEnv = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_')) delete env[key];
Object.assign(env, { CODEX_HOME: join(root, 'codex'), CLAUDE_CONFIG_DIR: join(root, 'claude'), GIT_CEILING_DIRECTORIES: root });
env.HAPI_CLAUDE_PATH = process.env.RUNWEFT_SMOKE_CLAUDE || Bun.which('iclaude') || Bun.which('claude') || undefined;
delete env.HAPI_CODEX_APP_SERVER_BIN;
for (const directory of [project, unrelated, env.CODEX_HOME!, env.CLAUDE_CONFIG_DIR!]) mkdirSync(directory, { mode: 0o700 });
const evidence: { [key: string]: any; checks: string[]; cleanupErrors: string[] } = { root, executable, platform: process.platform, architecture: process.arch, checks: [], cleanupErrors: [], success: false };
const homes: string[] = [];
let token: string | undefined;
function cli(home: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; code?: number; input?: string; human?: boolean } = {}) {
    const result = spawnSync(executable, ['--home', home, ...(options.human ? [] : ['--json']), ...args], { cwd: options.cwd ?? project, env: { ...env, ...options.env }, input: options.input, encoding: 'utf8', timeout: 60_000 });
    if (token) assert(!`${result.stdout}${result.stderr}`.includes(token), 'Credential leaked into command output');
    assert.equal(result.status, options.code ?? 0, `${args.join(' ')}: ${result.stderr || result.error || result.signal}`);
    return options.human ? result.stdout : JSON.parse(result.stdout || result.stderr);
}
function git(...args: string[]) {
    const result = spawnSync('git', ['-C', project, ...args], { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
}
function record(check: string) { evidence.checks.push(check); console.log(`PASS ${check}`); }
function edit(path: string, value: object) { writeFileSync(path, stringify(value)); }
console.log(`Evidence directory: ${root}`);
try {
    assert(env.HAPI_CLAUDE_PATH, 'Install Claude Code/iclaude or set RUNWEFT_SMOKE_CLAUDE');
    assert(Bun.which('codex') || (process.platform === 'darwin' && existsSync('/Applications/Codex.app/Contents/Resources/codex')), 'Install Codex for native tool verification');
    assert.deepEqual(cli(center, ['agent', 'list']).agents, []);
    assert(!existsSync(center), 'Offline reads must not create data');
    git('init', '-b', 'main');
    const global = cli(center, ['agent', 'init', 'review']).agent;
    const local = cli(center, ['agent', 'init', 'review', '--scope', 'project']).agent;
    edit(global.source.path, { description: 'Global reviewer', instructions: 'Check correctness' });
    edit(local.source.path, { description: 'Project reviewer', instructions: 'Review project conventions' });
    const shared = readFileSync(local.source.path, 'utf8');
    git('add', '.'); git('-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.test', 'commit', '-m', 'project definition');
    git('worktree', 'add', '-b', 'child', worktree);
    assert.equal(cli(center, ['agent', 'validate']).valid, true);
    assert.equal(cli(center, ['agent', 'show', 'review']).agent.source.scope, 'project');
    assert.equal(cli(center, ['agent', 'show', 'review'], { cwd: unrelated }).agent.source.scope, 'global');
    record('compiled offline CLI creates portable definitions, shows overrides, and validates without services');

    cli(center, ['init']); homes.push(center);
    cli(center, ['config', 'set', 'server.port', String(await freePort())]);
    const started = cli(center, ['start']);
    token = JSON.parse(readFileSync(join(center, 'server/hapi/settings.json'), 'utf8')).cliApiToken; assert(token);
    const hapi = new HapiClient(started.url, token);
    const before = await hapi.request('/api/sessions');
    const machine = cli(center, ['machine', 'register']).machine;
    const codex = cli(center, ['runtime', 'register', 'codex']).runtime;
    const claude = cli(center, ['runtime', 'register', 'claude']).runtime;
    for (const runtime of [codex, claude]) assert.equal(runtime.inspection.details.versionStatus, 'detected');
    evidence.tools = [codex, claude].map(runtime => ({ flavor: runtime.flavor, ...runtime.inspection.details }));
    cli(center, ['agent', 'bind', 'review', '--runtime', codex.id]);
    cli(center, ['agent', 'bind', 'review', '--scope', 'global', '--runtime', claude.id]);
    const checked = cli(center, ['agent', 'check', 'review']).agent;
    assert.equal(checked.target.machineId, machine.id);
    assert.deepEqual(checked.launchOptions, { agent: 'codex', disabledMcpServers: ['runweft'] });
    const child = cli(center, ['agent', 'check', 'review'], { cwd: worktree }).agent;
    assert.equal(child.target.runtimeId, codex.id); assert.equal(child.source.key, checked.source.key);
    assert.equal(child.resolvedVersion, checked.resolvedVersion);
    assert.equal(readFileSync(local.source.path, 'utf8'), shared);
    assert.equal(cli(center, ['agent', 'check', 'review'], { cwd: unrelated }).agent.target.runtimeId, claude.id);
    const params = cli(center, ['agent', 'init', 'parameters']).agent;
    edit(params.source.path, { runtime: codex.id, flavor: 'codex', model: 'native-model-example', reasoningEffort: 'high' });
    assert.deepEqual(cli(center, ['agent', 'check', 'parameters']).agent.launchOptions, { agent: 'codex', disabledMcpServers: ['runweft'], model: 'native-model-example', modelReasoningEffort: 'high' });
    assert.equal(cli(center, ['agent', 'bind', 'parameters', '--runtime', claude.id], { code: 1 }).error.code, 'agent_flavor_mismatch');
    edit(params.source.path, { runtime: claude.id, flavor: 'claude', model: 'native-model-example', reasoningEffort: 'max' });
    const claudeParams = cli(center, ['agent', 'check', 'parameters']).agent;
    assert.deepEqual(claudeParams.launchOptions, { agent: 'claude', disabledMcpServers: ['runweft'], model: 'native-model-example', effort: 'max' });
    assert.equal(claudeParams.modelCompatibility, 'not_checked');
    record('real local Hub/Runner resolves both native tools; Git worktrees share personal bindings and retain independent source paths');
    record('native parameter mappings and Runweft MCP filtering appear in snapshots; model names are explicitly not execution-tested');

    const hubEnv = { RUNWEFT_MODE: 'hub', RUNWEFT_HUB_URL: started.url, RUNWEFT_HUB_TOKEN: token };
    assert.equal(cli(center, ['agent', 'check', 'review'], { env: hubEnv, code: 1 }).error.code, 'agent_unbound');
    cli(center, ['agent', 'bind', 'review', '--runtime', claude.id], { env: hubEnv });
    const hub = cli(center, ['agent', 'check', 'review'], { env: hubEnv }).agent;
    assert.notEqual(hub.connection.name, checked.connection.name);
    assert.equal(hub.target.runtimeId, claude.id);
    assert.equal(cli(center, ['agent', 'check', 'review']).agent.target.runtimeId, codex.id);
    const otherEnv = { ...hubEnv, RUNWEFT_HUB_TOKEN: `${token}:agent-smoke-other` };
    assert.equal(cli(center, ['agent', 'check', 'review'], { env: otherEnv, code: 1 }).error.code, 'agent_unbound');
    cli(otherHome, ['init', '--url', started.url]); homes.push(otherHome);
    cli(otherHome, ['auth', 'login', '--token-stdin'], { input: otherEnv.RUNWEFT_HUB_TOKEN });
    cli(otherHome, ['start']); cli(otherHome, ['machine', 'register']);
    const otherRuntime = cli(otherHome, ['runtime', 'register', 'codex']).runtime;
    cli(center, ['agent', 'bind', 'review', '--runtime', otherRuntime.id], { env: otherEnv });
    assert.equal(cli(center, ['agent', 'check', 'review'], { env: otherEnv }).agent.connection.namespace, 'agent-smoke-other');
    assert.equal(cli(center, ['agent', 'check', 'review'], { env: hubEnv }).agent.target.runtimeId, claude.id);
    const possible = cli(center, ['agent', 'show', 'review'], { env: hubEnv }).agent;
    assert.equal(possible.namespaceVerified, false); assert.equal(possible.personalBindings.length, 2);
    cli(center, ['agent', 'unbind', 'review'], { env: otherEnv });
    assert.equal(cli(center, ['agent', 'check', 'review'], { env: otherEnv, code: 1 }).error.code, 'agent_unbound');
    assert.equal(cli(center, ['agent', 'check', 'review'], { env: hubEnv }).agent.target.runtimeId, claude.id);
    record('actual HAPI token namespace suffix and local/Hub mode switching isolate personal bindings in one client store');

    const listed = cli(center, ['agent', 'list', '--check']);
    assert(listed.agents.every((agent: any) => agent.error === null));
    cli(center, ['runtime', 'unregister', codex.id]);
    assert.equal(cli(center, ['agent', 'check', 'review'], { code: 1 }).error.code, 'runtime_unregistered');
    const bad = cli(center, ['agent', 'list', '--check'], { code: 1 });
    assert.equal(bad.agents.find((agent: any) => agent.id === 'review').error.code, 'runtime_unregistered');
    assert.equal(cli(center, ['runtime', 'register', 'codex']).runtime.id, codex.id);
    cli(center, ['restart']);
    assert.equal(cli(center, ['agent', 'check', 'review']).agent.resolvedVersion, checked.resolvedVersion);
    assert.equal(cli(center, ['paths']).agents, join(center, 'agents'));
    assert(!existsSync(cli(otherHome, ['paths']).state), 'Hub client must not create another resource authority');
    assert.deepEqual((await hapi.request('/api/sessions')).sessions, before.sessions, 'Agent definition operations must not start native sessions');
    record('target cancellation/recovery and service restart retain explicit bindings and snapshots without creating sessions or client resource databases');
    evidence.local = { runtimeId: codex.id, connection: checked.connection };
    evidence.hub = { runtimeId: claude.id, connection: hub.connection };
    evidence.success = true;
} catch (error) {
    evidence.error = error instanceof Error ? error.message : String(error); process.exitCode = 1;
} finally {
    for (const home of homes.reverse()) try { cli(home, ['stop']); } catch (error) { evidence.cleanupErrors.push(String(error)); }
    if (evidence.cleanupErrors.length) { evidence.success = false; process.exitCode = 1; }
    evidence.finishedAt = new Date().toISOString();
    writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(`Evidence: ${join(root, 'evidence.json')}`);
    if (evidence.error) console.error(evidence.error);
}
