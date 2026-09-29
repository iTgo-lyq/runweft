import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { HapiClient } from '../src/hapi';
import { freePort } from '../src/services';

// Explicit native version probes only. No model calls or copies of user credentials.
const executable = resolve(process.argv[2] ?? 'dist/runweft');
const parent = resolve(process.env.RUNWEFT_SMOKE_ROOT ?? '.dev-smoke');
mkdirSync(parent, { recursive: true });
const root = mkdtempSync(join(parent, 'resources-'));
const center = join(root, 'center'), client = join(root, 'hub-client');
const projectA = join(root, 'project-a'), projectB = join(root, 'project-b');
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_')) delete env[key];
env.CODEX_HOME = join(root, 'codex'); env.CLAUDE_CONFIG_DIR = join(root, 'claude');
for (const directory of [projectA, projectB, env.CODEX_HOME, env.CLAUDE_CONFIG_DIR]) mkdirSync(directory, { mode: 0o700 });
env.HAPI_CLAUDE_PATH = process.env.RUNWEFT_SMOKE_CLAUDE || Bun.which('iclaude') || Bun.which('claude') || undefined;
delete env.HAPI_CODEX_APP_SERVER_BIN;
const evidence: { [key: string]: any; checks: string[]; cleanupErrors: string[] } = {
    executable, platform: process.platform, architecture: process.arch, root, checks: [], cleanupErrors: [], success: false,
};
let token: string | undefined;
let foreground: ChildProcess | undefined;
const homes: string[] = [];

function cli(home: string, args: string[], options: { input?: string; code?: number; human?: boolean; env?: NodeJS.ProcessEnv; cwd?: string } = {}) {
    const result = spawnSync(executable, ['--home', home, ...(options.human ? [] : ['--json']), ...args], {
        env: { ...env, ...options.env }, cwd: options.cwd ?? projectA, input: options.input, encoding: 'utf8', timeout: 60_000,
    });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    if (token) assert(!output.includes(token), `Credential appeared in ${args[0]} output`);
    assert.equal(result.status, options.code ?? 0, `${args.join(' ')}: ${result.stderr || String(result.error ?? result.signal)}`);
    if (options.human) return result.stdout;
    return JSON.parse(result.stdout || result.stderr);
}
function record(check: string) { evidence.checks.push(check); console.log(`PASS ${check}`); }
async function until(check: () => Promise<boolean>, message: string, timeout = 70_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { if (await check()) return; await Bun.sleep(500); }
    throw new Error(message);
}
function registerPair(home: string) {
    const machine = cli(home, ['machine', 'register', '--name', home === center ? 'Local Runner' : 'Hub Runner']).machine;
    const codex = cli(home, ['runtime', 'register', 'codex', '--name', 'Code reviewer']).runtime;
    const claude = cli(home, ['runtime', 'register', 'claude']).runtime;
    assert.notEqual(codex.id, claude.id);
    for (const runtime of [codex, claude]) {
        assert.equal(runtime.machineId, machine.id); assert.equal(runtime.eligibility.eligible, true);
        assert.equal(runtime.modelAuthentication, 'not_checked'); assert.equal(runtime.execution, 'not_checked');
        assert.equal(runtime.inspection.details.versionStatus, 'detected');
    }
    return { machineId: machine.id, codexId: codex.id, claudeId: claude.id };
}

console.log(`Evidence directory: ${root}`);
try {
    assert(env.HAPI_CLAUDE_PATH, 'Install Claude Code/iclaude or set RUNWEFT_SMOKE_CLAUDE');
    assert(Bun.which('codex') || (process.platform === 'darwin' && existsSync('/Applications/Codex.app/Contents/Resources/codex')), 'Install Codex before native resource verification');
    cli(center, ['init']); homes.push(center);
    cli(center, ['config', 'set', 'server.port', String(await freePort())]);
    const noService = cli(center, ['machine', 'register'], { code: 1 });
    assert.equal(noService.error.code, 'authentication_missing');
    assert(!existsSync(join(center, 'server/process.json')));
    const started = cli(center, ['start']);
    token = JSON.parse(readFileSync(join(center, 'server/hapi/settings.json'), 'utf8')).cliApiToken;
    assert(token);
    const url = started.url;
    const hapi = new HapiClient(url, token);
    const discovery = cli(center, ['runtime', 'discover']);
    assert.equal(discovery.machine.registered, false);
    assert.deepEqual(cli(center, ['runtime', 'list']).runtimes, []);
    evidence.tools = discovery.tools.map((tool: any) => ({ flavor: tool.flavor, ...tool.inspection.details }));
    const local = registerPair(center);
    assert.equal(cli(center, ['runtime', 'register', 'codex'], { cwd: projectB }).runtime.id, local.codexId);
    assert(!existsSync(join(projectA, '.runweft')) && !existsSync(join(projectB, '.runweft')));
    assert.equal(cli(center, ['runtime', 'check', local.codexId]).runtime.eligibility.eligible, true);
    cli(center, ['mcp', 'install', '--client', 'all']);
    assert.equal(cli(center, ['mcp', 'check', '--client', 'all']).ok, true);
    cli(center, ['restart']);
    assert.equal(cli(center, ['runtime', 'show', local.codexId]).runtime.name, 'Code reviewer');
    record('local compiled CLI: empty startup, read-only discovery, both native versions, stable global IDs across cwd and restart');
    record('dedicated global MCP install and stdio/connection checks still work without calling models');

    // The same local configuration can host a public Hub; it must accept another Runner identity.
    cli(center, ['stop']);
    cli(center, ['config', 'set', 'server.runner', 'false']);
    cli(center, ['config', 'set', 'server.publicUrl', url]);
    const fd = openSync(join(root, 'public-service.log'), 'a', 0o600);
    let launchError: Error | undefined;
    try { foreground = spawn(executable, ['--home', center, 'serve', '--public'], { env, stdio: ['ignore', fd, fd] }); }
    finally { closeSync(fd); }
    foreground.once('error', error => { launchError = error; });
    await until(async () => {
        if (launchError) throw launchError;
        if (foreground!.exitCode !== null) throw new Error('Public service exited before ready');
        const response = await fetch(`${url}/api/runweft/health`, { signal: AbortSignal.timeout(1000) }).catch(() => null);
        return Boolean(response?.ok && (await response.json() as any).ready);
    }, 'Public Hub did not become ready');
    assert.equal(cli(center, ['status']).role, 'hub-server');
    cli(client, ['init', '--url', url]); homes.push(client);
    cli(client, ['auth', 'login', '--token-stdin'], { input: token });
    cli(client, ['start']);
    const remote = registerPair(client);
    assert.notEqual(remote.machineId, local.machineId);
    assert.equal((await hapi.request(`/api/runweft/resources/runtimes/${remote.codexId}/resolve`)).target.machineId, remote.machineId);
    assert.equal(cli(center, ['runtime', 'check', remote.codexId], { code: 1 }).runtime.eligibility.reason.code, 'local_target_required');
    assert.equal(cli(center, ['machine', 'register', remote.machineId], { code: 1 }).error.code, 'local_target_required');
    assert.equal(cli(client, ['runtime', 'check', remote.codexId]).runtime.eligibility.eligible, true);
    assert(!existsSync(cli(client, ['paths']).state));
    const otherEnv = { RUNWEFT_HUB_TOKEN: `${token}:resources-smoke-other` };
    assert.deepEqual(cli(client, ['machine', 'list', '--all'], { env: otherEnv }).machines, []);
    assert.equal(cli(client, ['runtime', 'show', remote.codexId], { env: otherEnv, code: 1 }).error.code, 'runtime_unknown');
    record('public Hub with local config accepts Hub client targets, while local CLI routing, namespace and authority storage stay separate');

    cli(client, ['machine', 'rename', remote.machineId, 'Renamed Runner']);
    cli(client, ['runtime', 'rename', remote.codexId, 'Writer']);
    const affected = cli(client, ['machine', 'unregister', remote.machineId]);
    assert.deepEqual(affected.affectedRuntimeIds.sort(), [remote.codexId, remote.claudeId].sort());
    assert.equal(cli(client, ['runtime', 'check', remote.codexId], { code: 1 }).runtime.eligibility.reason.code, 'machine_unregistered');
    assert.equal(cli(client, ['runtime', 'show', remote.codexId]).runtime.registered, true);
    cli(client, ['machine', 'register']);
    cli(client, ['runtime', 'unregister', remote.codexId]);
    assert.equal(cli(client, ['runtime', 'check', remote.codexId], { code: 1 }).runtime.eligibility.reason.code, 'runtime_unregistered');
    assert(!cli(client, ['runtime', 'list']).runtimes.some((runtime: any) => runtime.id === remote.codexId));
    assert(cli(client, ['runtime', 'list', '--all']).runtimes.some((runtime: any) => runtime.id === remote.codexId));
    const restored = cli(client, ['runtime', 'register', 'codex']).runtime;
    assert.equal(restored.id, remote.codexId); assert.equal(restored.name, 'Writer');
    assert.equal(restored.machine.name, 'Renamed Runner');
    record('official CLI separates machine/runtime cancellation, lists affected identities and restores stable names and IDs');

    const last = cli(client, ['runtime', 'show', remote.codexId]).runtime.inspection;
    cli(client, ['stop']);
    console.log('Waiting for the existing HAPI machine presence timeout (45 seconds); no custom heartbeat.');
    await until(async () => !(await hapi.request(`/api/runweft/resources/machines/${remote.machineId}`)).machine.online, 'HAPI offline presence did not expire');
    const offline = cli(client, ['runtime', 'check', remote.codexId], { code: 1 }).runtime;
    assert.equal(offline.eligibility.reason.code, 'machine_offline');
    assert.equal(offline.inspectionCurrent, false); assert.deepEqual(offline.inspection, last);
    assert(cli(client, ['machine', 'list', '--all']).machines.some((machine: any) => machine.id === remote.machineId && !machine.online));
    cli(client, ['start']);
    assert.equal(cli(client, ['machine', 'show']).machine.id, remote.machineId);
    assert.equal(cli(client, ['runtime', 'check', remote.codexId]).runtime.eligibility.eligible, true);
    record('real Runner stop expires via native liveness, retains historical observation, and reconnects with the same identity');

    const tools = join(root, 'runtime-free-tools'); mkdirSync(tools);
    // Keep the OS process inspector: HAPI intentionally refuses to stop a PID
    // whose identity cannot be verified. Only native agent commands are removed.
    for (const name of ['node', 'ps']) {
        const command = Bun.which(name); assert(command, `${name} is required for the Runner environment check`);
        symlinkSync(command, join(tools, name));
    }
    const legacy = join(root, 'legacy-codex'), versionFailure = join(root, 'version-failure');
    writeFileSync(legacy, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    writeFileSync(versionFailure, '#!/bin/sh\nexit 7\n', { mode: 0o700 });
    const missingEnv = { PATH: tools, HAPI_CODEX_APP_SERVER_BIN: legacy, HAPI_CLAUDE_PATH: join(root, 'missing-claude') };
    cli(client, ['restart'], { env: missingEnv });
    const missing = cli(client, ['runtime', 'check', remote.claudeId], { code: 1 }).runtime;
    assert.equal(missing.eligibility.reason.code, 'runtime_command_missing');
    assert.equal(missing.inspection.details.executable, null);
    const inspectedCodex = cli(client, ['runtime', 'show', remote.codexId]).runtime;
    assert.equal(inspectedCodex.inspection.available, true);
    evidence.codexMissingVerified = inspectedCodex.inspection.details.executable === null;
    if (evidence.codexMissingVerified) assert.equal(inspectedCodex.eligibility.reason.code, 'runtime_command_missing');
    else {
        assert.equal(process.platform, 'darwin');
        assert.equal(inspectedCodex.inspection.details.executable, '/Applications/Codex.app/Contents/Resources/codex');
    }
    const badOverride = { HAPI_CODEX_APP_SERVER_BIN: join(root, 'missing-codex') };
    cli(client, ['restart'], { env: badOverride });
    const invalid = cli(client, ['runtime', 'check', remote.codexId], { code: 1 }).runtime;
    assert.equal(invalid.eligibility.reason.code, 'runtime_invalid_configuration');
    assert(invalid.inspection.details.executable); assert.equal(invalid.inspection.details.versionStatus, 'detected');
    cli(client, ['restart'], { env: { HAPI_CLAUDE_PATH: versionFailure } });
    const unknown = cli(client, ['runtime', 'check', remote.claudeId]).runtime;
    assert.equal(unknown.inspection.details.versionStatus, 'failed'); assert.equal(unknown.eligibility.eligible, true);
    assert.equal(unknown.modelAuthentication, 'not_checked');
    cli(client, ['restart']);
    for (const id of [remote.codexId, remote.claudeId]) assert.equal(cli(client, ['runtime', 'check', id]).runtime.inspection.details.versionStatus, 'detected');
    record('dedicated Runner environment distinguishes missing native command, invalid legacy override and version-read failure; restoration reuses IDs');
    assert.equal(cli(center, ['mcp', 'check', '--client', 'all']).ok, true);
    cli(center, ['mcp', 'uninstall', '--client', 'all']);
    evidence.local = local; evidence.hubClient = remote; evidence.success = true;
} catch (error) {
    evidence.error = error instanceof Error ? error.message : String(error); process.exitCode = 1;
} finally {
    for (const home of homes.reverse()) try { cli(home, ['stop']); } catch (error) { evidence.cleanupErrors.push(String(error)); }
    if (foreground?.pid && foreground.exitCode === null) {
        await until(async () => foreground!.exitCode !== null, 'Public Hub did not exit after stop', 15_000).catch(error => evidence.cleanupErrors.push(String(error)));
    }
    if (evidence.cleanupErrors.length) { evidence.success = false; process.exitCode = 1; }
    evidence.finishedAt = new Date().toISOString();
    writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(`Evidence: ${join(root, 'evidence.json')}`);
    if (evidence.error) console.error(evidence.error);
}
