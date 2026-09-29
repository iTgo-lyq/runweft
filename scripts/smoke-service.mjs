import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';

// The same test runs against the compiled executable and the npm-installed launcher.
const executable = resolve(process.argv[2] ?? 'dist/runweft');
const parent = resolve(process.env.RUNWEFT_SMOKE_ROOT ?? '.dev-smoke');
mkdirSync(parent, { recursive: true });
const root = mkdtempSync(join(parent, 'service-'));
const local = join(root, 'local');
const remote = join(root, 'hub-client');
const sentinel = join(root, 'must-not-be-used');
const env = { ...process.env, HAPI_HOME: sentinel, DB_PATH: join(sentinel, 'hapi.db'), HAPI_API_URL: 'http://127.0.0.1:1',
    CLI_API_TOKEN: 'unused-smoke-value', HAPI_LISTEN_PORT: '1', HAPI_PUBLIC_URL: 'http://127.0.0.1:1' };
for (const key of Object.keys(env)) if (key.startsWith('RUNWEFT_')) delete env[key];
const evidence = { executable, platform: process.platform, architecture: process.arch, root, checks: [] };
let token;
let foreground;
function run(home, args, options = {}) {
    const result = spawnSync(executable, ['--home', home, ...(options.raw ? [] : ['--json']), ...args], {
        env, encoding: 'utf8', timeout: 45_000, input: options.input,
    });
    const stdout = result.stdout ?? '', stderr = result.stderr ?? '';
    if (token) assert(!stdout.includes(token) && !stderr.includes(token), `Credential leaked by ${args[0]}`);
    if (options.failure) { assert.notEqual(result.status, 0); return JSON.parse(stderr); }
    assert.equal(result.status, options.exitCode ?? 0, `${args.join(' ')}: ${stderr || result.error || result.signal}`);
    return options.raw ? stdout : JSON.parse(stdout);
}
function record(name) { evidence.checks.push(name); console.log(`PASS ${name}`); }
async function port() {
    const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const number = server.address().port; await new Promise(resolve => server.close(resolve)); return number;
}
async function json(url, options = {}) {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000), ...options });
    assert(response.ok, `HTTP ${response.status}`); return response.json();
}
async function wait(check) {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 150)); }
    throw new Error('Expected service condition did not become true');
}
async function down(url) {
    try { await fetch(url, { signal: AbortSignal.timeout(500) }); return false; } catch { return true; }
}
try {
    assert.equal(run(local, ['init']).created, true);
    const publicPort = await port();
    run(local, ['config', 'set', 'server.port', String(publicPort)]);
    run(local, ['config', 'set', 'server.host', 'localhost']);
    const url = `http://127.0.0.1:${publicPort}`;
    const started = run(local, ['start']);
    assert.equal(started.running, true); assert.equal(started.runner, true); assert.equal(started.role, 'local');
    const paths = run(local, ['paths']);
    token = JSON.parse(readFileSync(join(paths.hapiServer, 'settings.json'), 'utf8')).cliApiToken;
    const machineId = JSON.parse(readFileSync(join(paths.hapiClient, 'settings.json'), 'utf8')).machineId;
    assert.equal(JSON.parse(readFileSync(join(paths.hapiClient, 'runner.state.json'), 'utf8')).startedWithVersionHandoffDisabled, true);
    const statePath = join(local, 'server', 'process.json');
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    assert.equal(run(local, ['start']).running, true);
    assert.equal(JSON.parse(readFileSync(statePath, 'utf8')).pid, state.pid);
    assert.equal(run(local, ['auth', 'status']).authenticated, true);
    const diagnosis = run(local, ['doctor']);
    assert.equal(diagnosis.ok, true); assert.equal(diagnosis.modelAuthentication, 'not_checked');
    assert.equal(paths.taskWorkspaces, join(paths.hapiClient, 'workspaces', 'environments'));
    assert.deepEqual(diagnosis.checks.find(check => check.name === 'task_workspaces'), {
        name: 'task_workspaces', ok: true, detail: {
            root: paths.taskWorkspaces, checkoutCount: 0, scope: 'current_connection_on_this_machine',
            repositoryCaches: paths.repositoryCaches, repositoryExports: paths.repositoryExports,
            repositoryFetches: paths.repositoryFetches,
            cleanup: 'task result release → task workspace remove → artifact prune/remove；查询任务确认操作结束，不直接删除这些目录。',
        },
    });
    assert(!existsSync(paths.taskWorkspaces), 'Diagnostics created a task workspace');
    assert(diagnosis.ignoredEnvironment.includes('HAPI_HOME'));
    assert(!existsSync(sentinel));
    record('local startup, authentication, Runner registration, idempotence and managed environment');

    const { token: jwt } = await json(`${url}/api/auth`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accessToken: token }) });
    const headers = { authorization: `Bearer ${jwt}` };
    assert.equal((await fetch(`${url}/api/runweft/identity`)).status, 401);
    const identity = await json(`${url}/api/runweft/identity`, { headers });
    assert.equal(identity.namespace, started.namespace);
    assert.equal((await json(`${url}/api/runweft/health`)).capabilities.dashboard, 1);
    const dashboardPage = await fetch(`${url}/runweft/`);
    assert.equal(dashboardPage.status, 200);
    assert.equal(dashboardPage.headers.get('referrer-policy'), 'no-referrer');
    assert.match(await dashboardPage.text(), /协作总览/);
    const dashboardScript = await fetch(`${url}/runweft/app.js`);
    assert.equal(dashboardScript.status, 200);
    const dashboardModule = await import('data:text/javascript;base64,' + Buffer.from(await dashboardScript.text()).toString('base64'));
    assert.equal(dashboardModule.tokenKey(url), `hapi_access_token::${url}`);
    assert.equal((await fetch(`${url}/runweft/style.css`)).status, 200);
    assert.equal((await fetch(`${url}/api/runweft/tasks/overview`)).status, 401);
    const dashboardTasks = await json(`${url}/api/runweft/tasks/overview`, { headers });
    assert.equal(dashboardTasks.namespace, started.namespace);
    assert.deepEqual(dashboardTasks.items, []);
    assert.equal(dashboardTasks.inventory.available, true);
    record('compiled dashboard assets, HAPI login scope and authenticated read-only overview');
    assert((await (await fetch(url)).text()).includes('<html'));
    const controller = new AbortController();
    const events = await fetch(`${url}/api/events?all=true`, { headers, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]) });
    assert.equal(events.status, 200);
    assert.match(events.headers.get('content-type'), /text\/event-stream/);
    assert.match(new TextDecoder().decode((await events.body.getReader().read()).value), /connection-changed/);
    controller.abort();
    await new Promise((resolve, reject) => {
        const socket = new WebSocket(`${url.replace('http:', 'ws:')}/socket.io/?EIO=4&transport=websocket`);
        const timer = setTimeout(() => { socket.close(); reject(new Error('WebSocket handshake timeout')); }, 5000);
        socket.onmessage = event => { clearTimeout(timer); socket.close(); try { assert.match(event.data, /^0\{/); resolve(); } catch (error) { reject(error); } };
        socket.onerror = () => { clearTimeout(timer); reject(new Error('WebSocket upgrade failed')); };
    });
    record('compiled gateway: HAPI Web, authentication, SSE and WebSocket upgrade');

    assert.equal(run(local, ['auth', 'token'], { failure: true }).error.code, 'terminal_required');
    assert.equal(run(local, ['hapi', 'runner', 'stop'], { failure: true }).error.code, 'managed_service');
    assert.match(run(local, ['hapi', '--version'], { raw: true }), /0\.30\.7/);
    run(local, ['workspace', 'bind', root]);
    const binding = run(local, ['workspace', 'list']).workspaces[0].id;
    assert.equal(run(local, ['restart']).runner, true);
    assert.equal(JSON.parse(readFileSync(join(paths.hapiClient, 'settings.json'), 'utf8')).machineId, machineId);
    assert.equal(JSON.parse(readFileSync(join(paths.hapiServer, 'settings.json'), 'utf8')).cliApiToken, token);
    assert.equal(run(local, ['workspace', 'list']).workspaces[0].id, binding);
    record('restart preserves credentials, machine identity and workspace bindings; passthrough works');

    run(remote, ['init', '--url', url]);
    run(remote, ['auth', 'login', '--token-stdin'], { input: `${token}\n` });
    const client = run(remote, ['start']);
    assert.equal(client.role, 'hub-client'); assert.equal(client.runner, true);
    const remotePaths = run(remote, ['paths']);
    assert.notEqual(remotePaths.taskWorkspaces, paths.taskWorkspaces);
    assert.notEqual(JSON.parse(readFileSync(join(remotePaths.hapiClient, 'settings.json'), 'utf8')).machineId, machineId);
    assert.equal(run(remote, ['doctor']).ok, true);
    const privatePort = JSON.parse(readFileSync(statePath, 'utf8')).hapiPort;
    run(remote, ['config', 'set', 'hub.url', `http://127.0.0.1:${privatePort}`]);
    const wrongHub = run(remote, ['doctor'], { exitCode: 1 });
    assert.equal(wrongHub.ok, false);
    assert(wrongHub.checks.some(check => check.detail?.code === 'runweft_unavailable'));
    run(remote, ['config', 'set', 'hub.url', url]);
    run(remote, ['stop']);
    assert.equal(run(local, ['status']).running, true);
    await wait(async () => !(run(remote, ['status']).runner));
    record('independent Hub client authentication, Runner lifecycle and data ownership');

    const finalState = JSON.parse(readFileSync(statePath, 'utf8'));
    process.kill(finalState.pid, 'SIGTERM');
    await wait(async () => !existsSync(statePath) && await down(`${url}/health`) && await down(`http://127.0.0.1:${finalState.hapiPort}/health`));
    assert.equal(run(local, ['status']).running, false);
    assert.equal(run(local, ['stop']).alreadyStopped, true);
    for (const name of readdirSync(join(local, 'logs'))) assert(!readFileSync(join(local, 'logs', name), 'utf8').includes(token), `Credential in log ${name}`);
    record('SIGTERM closes owned services, preserves data and keeps credentials out of logs');

    assert.equal(run(local, ['serve', '--public'], { failure: true }).error.code, 'public_url_missing');
    run(local, ['config', 'set', 'server.runner', 'false']);
    run(local, ['config', 'set', 'server.publicUrl', url]);
    foreground = spawn(executable, ['--home', local, 'serve', '--public'], { env, stdio: 'ignore' });
    await wait(async () => {
        if (foreground.exitCode !== null) throw new Error('Public service exited before readiness');
        if (!existsSync(statePath)) return false;
        return (await json(`${url}/api/runweft/health`)).ready;
    });
    assert.equal(run(local, ['status']).role, 'hub-server');
    assert.equal(run(local, ['status']).runner, false);
    assert.equal(run(local, ['doctor']).ok, true);
    foreground.kill('SIGTERM');
    await wait(async () => !existsSync(statePath) && await down(`${url}/health`));
    record('explicit Hub hosting without a Runner and foreground signal forwarding');
    evidence.success = true;
} finally {
    if (foreground && foreground.exitCode === null && foreground.signalCode === null) foreground.kill('SIGTERM');
    for (const home of [remote, local]) {
        if (existsSync(join(home, 'config.yaml'))) {
            const result = spawnSync(executable, ['--home', home, '--json', 'stop'], { env, encoding: 'utf8', timeout: 40_000 });
            if (result.status !== 0) console.error(`Cleanup did not succeed for ${home}; inspect its logs.`);
        }
    }
    writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(`Evidence: ${join(root, 'evidence.json')}`);
}
