import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { freePort } from '../src/services';
import { HapiClient } from '../src/hapi';
import type { SessionResponse } from '../hapi/shared/src/apiTypes';
import { ExecutionClient } from '../src/execution';
import pkg from '../package.json';

// Compiled CLI + real models in dedicated homes and repositories. Never part of ordinary unit tests.
const binary = resolve(process.argv[2] ?? 'dist/runweft');
mkdirSync('.dev-smoke', { recursive: true }); const root = mkdtempSync(resolve('.dev-smoke/task-inputs-'));
const home = join(root, 'home'), codexHome = join(root, 'codex-home'), claudeHome = join(root, 'claude-home');
const env: NodeJS.ProcessEnv = { ...process.env }; for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_')) delete env[key];
function copy(source: string, target: string) {
    if (existsSync(source)) { mkdirSync(dirname(target), { recursive: true, mode: 0o700 }); copyFileSync(source, target); chmodSync(target, 0o600); }
}
const nativeCodexHome = process.env.CODEX_HOME ?? join(homedir(), '.codex'), nativeClaudeHome = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
for (const file of ['config.toml', 'auth.json']) copy(join(nativeCodexHome, file), join(codexHome, file));
copy(process.env.CLAUDE_CONFIG_DIR ? join(nativeClaudeHome, '.claude.json') : join(homedir(), '.claude.json'), join(claudeHome, '.claude.json'));
for (const file of ['settings.json', '.credentials.json']) copy(join(nativeClaudeHome, file), join(claudeHome, file));
Object.assign(env, { CODEX_HOME: codexHome, CLAUDE_CONFIG_DIR: claudeHome, GIT_CEILING_DIRECTORIES: root });
const evidence = { root, binary, hapiRevision: pkg.hapi.revision, startedAt: new Date().toISOString(), finishedAt: '', success: false,
    checks: [] as string[], cases: [] as Record<string, any>[], error: '', cleanupErrors: [] as string[] };
let token: string | undefined, hapi: HapiClient | undefined;
function cli(args: string[], cwd = root, expected = 0) {
    const result = spawnSync(binary, ['--home', home, '--json', ...args], { env, cwd, encoding: 'utf8', timeout: 60_000 });
    if (token) assert(!`${result.stdout}${result.stderr}`.includes(token), 'Credential leaked');
    assert.equal(result.status, expected, `${args.slice(0, 2).join(' ')}: ${result.stderr || result.error || result.signal}`);
    return { value: result.stdout.trim() ? JSON.parse(result.stdout) : null, stderr: result.stderr };
}
function git(cwd: string, ...args: string[]) {
    const result = spawnSync('git', ['-C', cwd, ...args], { env, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
}
const record = (message: string) => { evidence.checks.push(message); console.log(message); };
async function completed(id: string, roundId: string, cwd: string, item: Record<string, any>) {
    const deadline = Date.now() + 180_000;
    do {
        cli(['task', 'wait', id, '--timeout', '1000'], cwd);
        const result = cli(['task', 'show', id, '--round', roundId], cwd).value; item.lastObserved = result;
        if (result.status === 'completed') return result;
        if (result.status !== 'running') throw new Error(JSON.stringify({ status: result.status, attention: result.attention }));
    } while (Date.now() < deadline);
    throw new Error(`Task input timeout: ${id}/${roundId}`);
}
try {
    cli(['init']); cli(['config', 'set', 'server.port', String(await freePort())]); const started = cli(['start']).value;
    token = JSON.parse(readFileSync(join(home, 'server/hapi/settings.json'), 'utf8')).cliApiToken; assert(token);
    hapi = new HapiClient(started.url, token); cli(['machine', 'register']);
    for (const agent of ['codex', 'claude'] as const) {
        const runtime = cli(['runtime', 'register', agent]).value.runtime, agentType = `input-${agent}`;
        cli(['agent', 'init', agentType, '--runtime', runtime.id]);
        for (const mode of ['shared', 'worktree'] as const) {
            const project = join(root, `${agent}-${mode}`); mkdirSync(project); const projectMarker = `PROJECT_${randomUUID()}`;
            for (const name of ['AGENTS.md', 'CLAUDE.md']) writeFileSync(join(project, name), `这是专用输入验收工程。最终报告包含工程标记 ${projectMarker}。只读取请求中的输入，不修改文件，不委派。\n`);
            git(project, 'init', '-q'); git(project, 'config', 'user.name', 'Input Task Smoke'); git(project, 'config', 'user.email', 'smoke@example.invalid'); git(project, 'config', 'commit.gpgsign', 'false'); git(project, 'add', '.'); git(project, 'commit', '-qm', 'fixture');
            const before = git(project, 'rev-parse', 'HEAD'); let id = '', nativeSessionId = '';
            for (let round = 0; round < 2; round++) {
                const marker = `FILE_${randomUUID()}`, inputPath = join(root, `材料 ${agent}-${mode}-${round}.txt`); writeFileSync(inputPath, marker);
                const object = cli(['artifact', 'upload', inputPath], project).value;
                const name = `设计 第 ${round + 1} 轮.txt`, requestId = randomUUID();
                const message = '读取本轮提供的全部输入文件，将文件中的完整标记和工程指令标记写入最终报告；不要修改任何文件，不要委派。';
                const args = round === 0 ? ['task', 'spawn', agentType, '--workspace-mode', mode] : ['task', 'send', id];
                args.push('--message', message, '--input', `${name}=${object.id}`, '--request-id', requestId);
                const accepted = cli(args, project).value; id = accepted.agent_id;
                assert.deepEqual(cli(args, project).value, accepted);
                const item: Record<string, any> = { agent, mode, round, requestId, taskId: id, roundId: accepted.round_id, artifactId: object.id };
                evidence.cases.push(item); const done = await completed(id, accepted.round_id, project, item);
                assert(done.report.text.includes(marker)); assert(done.report.text.includes(projectMarker));
                assert.equal(done.input_files.files[0].name, name); assert.equal(done.input_files.files[0].sha256, object.sha256);
                assert.equal(readFileSync(done.input_files.paths[0].path, 'utf8'), marker);
                assert(!done.input_files.paths[0].path.startsWith(project));
                assert.equal(done.stop, 'stopped'); assert.equal(done.finish, 'complete');
                if (round) assert.equal(done.native_session_id, nativeSessionId); else nativeSessionId = done.native_session_id;
                const session: SessionResponse['session'] = (await hapi.request(`/api/sessions/${done.session_id}`)).session; assert(session.metadata);
                assert.equal(session.active, false); assert.deepEqual(session.metadata.disabledMcpServers, ['runweft']);
                if (mode === 'shared') { assert.equal(done.cwd, project); assert.equal(session.metadata.preparedFiles?.operationId, done.input_files.operation_id); }
                else { assert.equal(done.git.status, 'sealed'); assert(session.metadata.preparedWorkspace); assert.equal(session.metadata.preparedFiles, undefined); assert(!done.cwd.startsWith(project)); }
                assert.equal(git(project, 'status', '--porcelain'), ''); assert.equal(git(project, 'rev-parse', 'HEAD'), before);
                assert(cli(['artifact', 'remove', object.id], project, 1).stderr.includes('artifact_referenced'));
                item.nativeSessionId = nativeSessionId; item.sessionId = done.session_id; item.pid = done.host_pid; delete item.lastObserved;
                record(`${agent}/${mode} round ${round + 1}: CLI input read, project context, pin protection, stop and ${round ? 'same native resume' : 'initial launch'} verified`);
                if (!round) cli(['restart']);
            }
        }
    }
    evidence.success = true;
} catch (error) { evidence.error = error instanceof Error ? error.stack ?? error.message : String(error); process.exitCode = 1; }
finally {
    if (hapi) {
        try { const execution = new ExecutionClient(hapi); for (const session of (await hapi.request('/api/sessions')).sessions) if (session.active || session.metadata?.lifecycleState !== 'archived') {
            if ((await execution.stop(session.id)).outcome !== 'stopped') evidence.cleanupErrors.push(`Stop unconfirmed: ${session.id}`);
        } } catch (error) { evidence.cleanupErrors.push(String(error)); }
    }
    try { cli(['stop']); } catch (error) { evidence.cleanupErrors.push(String(error)); }
    if (evidence.cleanupErrors.length) { evidence.success = false; process.exitCode = 1; }
    evidence.finishedAt = new Date().toISOString(); writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(`Evidence: ${join(root, 'evidence.json')}`); if (evidence.error) console.error(evidence.error);
}
