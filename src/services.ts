import { validateState } from './state';
import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, openSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { atomicWrite, dataPaths, ensureDirectory, localUrl, type ResolvedConfig } from './config';
import { RunweftError, errorDetails } from './errors';
import { BUILD, deploymentKeys, fetchJson, clientEnvironment, hapiEnvironment, hapiExecutable, runHapi, serverToken, stopChild } from './hapi';
import { createDelegationGateway } from './hub/delegation/gateway';
import { HubClient } from './hub/client';
import { hubOptions } from './hub/delegation/client';
import { machineConnection, runnerProcessAlive, runnerStatus, startRunner, stopRunner } from './runner';

export type ServiceState = {
    pid: number; instanceId: string; version: string; hapiRevision: string;
    url: string; hapiPort: number; public: boolean; startedAt: string;
};

export function serviceState(c: ResolvedConfig): ServiceState | null {
    const path = dataPaths(c).process;
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
}

function processAlive(pid: number): boolean {
    try { process.kill(pid, 0); return true; }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
        throw error;
    }
}

export async function freePort(): Promise<number> {
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('无法取得本机端口。');
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    return address.port;
}

async function waitUntil(check: () => Promise<boolean>, message: string, timeout = 30_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        if (await check()) return;
        await Bun.sleep(150);
    }
    throw new RunweftError('startup_timeout', message, '运行 runweft doctor，并查看 runweft paths 所列日志。');
}

async function healthAt(url: string): Promise<any | null> {
    let response: Response;
    try { response = await fetch(`${url}/api/runweft/health`, { signal: AbortSignal.timeout(1200) }); }
    catch { return null; }
    const health = response.ok ? await response.json().catch(() => null) : null;
    if (!health || health.service !== 'runweft' || health.protocolVersion !== 1) {
        throw new RunweftError('runweft_unavailable', '该地址未提供兼容的 Runweft 服务；纯 HAPI Hub 不包含协作服务。', '检查 hub.url；中心应通过 runweft serve 部署。');
    }
    return health;
}

export async function requireRunweft(url: string) {
    const health = await healthAt(url);
    if (!health || health.service !== 'runweft' || health.protocolVersion !== 1) {
        throw new RunweftError('runweft_unavailable', '目标没有可用的 Runweft 服务，或版本不兼容。', '检查 hub.url；Hub 端需要运行 runweft serve。');
    }
    return health;
}

export async function runnerOnline(c: ResolvedConfig): Promise<boolean> { return (await runnerStatus(c)).online; }

export async function status(c: ResolvedConfig) {
    const hosted = serviceState(c);
    let hostedHealth: any = null;
    let hostedError: unknown;
    if (hosted && processAlive(hosted.pid)) {
        try { hostedHealth = await healthAt(hosted.url); }
        catch (error) { hostedError = errorDetails(error); }
    }
    const service = { url: hosted?.url ?? localUrl(c.config), running: hostedHealth?.instanceId === hosted?.instanceId && hostedHealth?.ready === true,
        version: hostedHealth?.version, ...(hostedError ? { error: hostedError } : {}) };
    let connection: Record<string, unknown>;
    try {
        const client = new HubClient(hubOptions(c), 'hubDelegation', 'hub_delegation_unavailable');
        connection = { connected: true, ...await client.connection(AbortSignal.timeout(3000)) };
    } catch (error) { connection = { connected: false, hub: c.config.hub.url ?? null, error: errorDetails(error) }; }
    const runner = await runnerStatus(c);
    return { role: c.config.mode === 'local' ? 'local' : 'hub-client', url: c.config.hub.url ?? service.url,
        running: c.config.mode === 'local' ? service.running : connection.connected === true,
        service, connection, runner, version: hostedHealth?.version, installedVersion: BUILD.version,
        hapiRevision: hostedHealth?.hapiRevision, dataRoot: c.home,
        restartRequired: service.running && (hostedHealth.version !== BUILD.version || hostedHealth.hapiRevision !== BUILD.hapi.revision) };
}

export async function serve(c: ResolvedConfig, publicly = false): Promise<void> {
    const paths = dataPaths(c);
    validateState(paths.state); validateState(paths.clientState, 'client');
    if (!publicly && !['127.0.0.1', 'localhost'].includes(c.config.server.host)) {
        throw new RunweftError('public_server_required', '本地服务只允许 loopback 地址。', '对外部署请显式运行 runweft serve --public，并配置 server.publicUrl。');
    }
    if (serviceState(c) && processAlive(serviceState(c)!.pid)) throw new RunweftError('already_running', '此数据目录的服务正在运行。', '运行 runweft status，或先 runweft stop。');
    const configuredHost = c.config.server.host === 'localhost' ? '127.0.0.1' : c.config.server.host;
    const host = publicly && configuredHost === '127.0.0.1' ? '0.0.0.0' : configuredHost;
    const publicUrl = c.config.server.publicUrl ?? localUrl(c.config);
    if (publicly && !c.config.server.publicUrl) throw new RunweftError('public_url_missing', '对外部署需要设置 server.publicUrl。', '填写用户访问的完整根地址，如 https://runweft.example.com。');
    const token = serverToken(c, true)!;
    const hapiPort = c.config.server.hapiPort ?? await freePort();
    const privateUrl = `http://127.0.0.1:${hapiPort}`;
    const hapi = hapiExecutable(c);
    for (const directory of [paths.logs, paths.runweftServer, paths.cache, paths.temporary]) ensureDirectory(directory);
    const children: ChildProcess[] = [];
    let gateway: Awaited<ReturnType<typeof createDelegationGateway>> | undefined;
    let stopping = false, ready = false;
    let failure: Error | undefined;
    let complete!: () => void;
    const finished = new Promise<void>(resolve => { complete = resolve; });
    const state: ServiceState = { pid: process.pid, instanceId: randomUUID(), version: BUILD.version,
        hapiRevision: BUILD.hapi.revision, url: localUrl(c.config), hapiPort, public: publicly, startedAt: new Date().toISOString() };
    const shutdown = async (error?: Error) => {
        if (stopping) return;
        stopping = true; failure = error;
        for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.off(signal, onSignal);
        try {
            try { await gateway?.close(); }
            catch (error) { failure ??= error instanceof Error ? error : new Error(String(error)); }
            for (const child of [...children].reverse()) await stopChild(child);
        } finally {
            if (serviceState(c)?.instanceId === state.instanceId) unlinkSync(paths.process);
            complete();
        }
    };
    const onSignal = () => { void shutdown(); };
    const startChild = (args: string[], env: NodeJS.ProcessEnv, logName: string) => {
        const fd = openSync(join(paths.logs, logName), 'a', 0o600);
        const child = spawn(hapi, args, { env, stdio: ['ignore', fd, fd] });
        closeSync(fd); children.push(child);
        child.once('error', error => { void shutdown(error); });
        child.once('exit', code => {
            if (!stopping) void shutdown(new RunweftError('hapi_exited', `HAPI ${args[0]} 意外退出（${code}）。`, `查看 ${join(paths.logs, logName)}`));
        });
        return child;
    };
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, onSignal);
    try {
        const hub = startChild(['hub'], hapiEnvironment(c, { home: paths.hapiServer, url: state.url, token, port: hapiPort, publicUrl }), 'hapi-hub.log');
        await waitUntil(async () => {
            if (stopping || hub.exitCode !== null) throw failure ?? new Error('HAPI 启动已结束。');
            try {
                const health = await fetchJson(`${privateUrl}/health`, { signal: AbortSignal.timeout(800) });
                if (health.protocolVersion !== BUILD.hapi.protocolVersion) throw new RunweftError('hapi_incompatible', 'HAPI 协议版本不兼容。');
                return true;
            } catch (error) {
                if (error instanceof RunweftError && error.code === 'connection_failed') return false;
                throw error;
            }
        }, 'HAPI 启动超时。');
        const secret = JSON.parse(readFileSync(join(paths.hapiServer, 'jwt-secret.json'), 'utf8'));
        const key = Buffer.from(secret.secretBase64, 'base64');
        gateway = await createDelegationGateway({ host, port: c.config.server.port, target: privateUrl, rootToken: token, key, statePath: paths.state,
            health: () => ({ ready, version: BUILD.version, hapiRevision: BUILD.hapi.revision,
                instanceId: state.instanceId, role: publicly ? 'hub-server' : 'local' }),
        });
        // Hosting is independent of the selected business connection. An enrolled Runner is opt-in.
        if (c.config.server.runner) {
            const record = machineConnection(c);
            if (record.pending) throw new RunweftError('machine_rotation_pending', '先完成机器凭据轮换，再启动托管 Runner。');
            if (runnerProcessAlive(c)) throw new RunweftError('runner_already_running', '此连接已有独立 Runner。', '先执行 runner stop，或关闭 server.runner。');
            const runner = startChild(['runner', 'start-sync'], { ...clientEnvironment(c), HAPI_DISABLE_VERSION_HANDOFF: '1' }, 'hapi-runner.log');
            await waitUntil(async () => {
                if (stopping || runner.exitCode !== null) throw failure ?? new Error('Runner 启动已结束。');
                return runnerOnline(c);
            }, 'Runner 未能连接所选 Hub；核对 hub.url 和机器凭据。');
        }
        ready = true;
        atomicWrite(paths.process, JSON.stringify(state, null, 2));
        console.error(`Runweft ${BUILD.version} 已就绪：${publicUrl}\n数据目录：${c.home}`);
        await finished;
        if (failure) throw failure;
    } catch (error) {
        await shutdown(error instanceof Error ? error : new Error(String(error)));
        throw error;
    }
}

export function selfCommand(args: string[]): string[] {
    return import.meta.dir.startsWith('/$bunfs/') ? [process.execPath, ...args]
        : [process.execPath, resolve(import.meta.dir, 'cli.ts'), ...args];
}

export async function start(c: ResolvedConfig) {
    const paths = dataPaths(c); validateState(paths.state); validateState(paths.clientState, 'client');
    if (c.config.mode === 'hub') { await startRunner(c); return status(c); }
    const existing = serviceState(c);
    if (existing && processAlive(existing.pid)) {
        const health = await requireRunweft(existing.url);
        if (health.instanceId !== existing.instanceId) throw new RunweftError('service_mismatch', '端口上的服务与本机记录不一致。');
        if (existing.url !== localUrl(c.config)) throw new RunweftError('configuration_changed', '本机服务仍在使用旧地址。', '运行 runweft restart 应用新配置。');
        return status(c);
    }
    if (existing) unlinkSync(dataPaths(c).process);
    ensureDirectory(dataPaths(c).logs);
    const log = join(dataPaths(c).logs, 'service.log');
    const fd = openSync(log, 'a', 0o600);
    const [executable, ...args] = selfCommand(['--home', c.home, 'serve']);
    const child = spawn(executable, args, { detached: true, stdio: ['ignore', fd, fd], env: c.env });
    closeSync(fd);
    let launchError: Error | undefined;
    child.once('error', error => { launchError = error; });
    child.unref();
    await waitUntil(async () => {
        if (launchError) throw launchError;
        if (child.exitCode !== null || child.signalCode !== null) throw new RunweftError('service_start_failed', '本地服务启动失败。', `查看 ${log}`);
        const state = serviceState(c);
        if (!state || state.pid !== child.pid) return false;
        const health = await healthAt(state.url);
        return health?.instanceId === state.instanceId && health.ready === true;
    }, `本地服务启动超时，查看 ${log}`);
    return status(c);
}

export async function stop(c: ResolvedConfig) {
    if (c.config.mode === 'hub') { await stopRunner(c); return { stopped: true, role: 'hub-client', sessionsPreserved: true }; }
    const state = serviceState(c);
    if (!state) { await stopRunner(c); return { stopped: true, alreadyStopped: true, sessionsPreserved: true }; }
    if (!processAlive(state.pid)) {
        unlinkSync(dataPaths(c).process);
        await stopRunner(c);
        return { stopped: true, alreadyStopped: true, sessionsPreserved: true };
    }
    const health = await requireRunweft(state.url);
    if (health.instanceId !== state.instanceId) throw new RunweftError('service_mismatch', '服务归属不一致，未发送停止信号。', '运行 runweft doctor 检查服务记录。');
    process.kill(state.pid, 'SIGTERM');
    await waitUntil(async () => serviceState(c)?.instanceId !== state.instanceId && !await healthAt(state.url), '服务尚未完成关闭。');
    await stopRunner(c);
    return { stopped: true, sessionsPreserved: true };
}

export async function doctor(c: ResolvedConfig) {
    const checks: { name: string; ok: boolean; detail: unknown }[] = [];
    checks.push({ name: 'config', ok: true, detail: c.file });
    const root = dataPaths(c).taskWorkspaces;
    try {
        const directories = statSync(root, { throwIfNoEntry: false }) ? readdirSync(root, { withFileTypes: true }) : [];
        const checkoutCount = directories.filter(entry => entry.isDirectory()
            && statSync(join(root, entry.name, 'checkout'), { throwIfNoEntry: false })?.isDirectory()).length;
        checks.push({ name: 'task_workspaces', ok: true, detail: { root, checkoutCount, scope: 'current_connection_on_this_machine',
            repositoryCaches: dataPaths(c).repositoryCaches, repositoryExports: dataPaths(c).repositoryExports, repositoryFetches: dataPaths(c).repositoryFetches,
            cleanup: 'task result release → task workspace remove → artifact prune/remove；查询任务确认操作结束，不直接删除这些目录。' } });
    } catch (error) { checks.push({ name: 'task_workspaces', ok: false, detail: { root, error: errorDetails(error) } }); }
    try {
        const result = await runHapi(c, ['--version'], true);
        checks.push({ name: 'hapi', ok: result.code === 0 && result.stdout.includes(BUILD.hapi.version), detail: result.stdout.trim() });
    } catch (error) { checks.push({ name: 'hapi', ok: false, detail: errorDetails(error) }); }
    const current = await status(c);
    checks.push({ name: 'hub_connection', ok: current.connection.connected === true, detail: current.connection });
    if (c.config.mode === 'local') checks.push({ name: 'hosted_service', ok: current.service.running && !current.restartRequired, detail: current.service });
    checks.push({ name: 'runner', ok: !current.runner.running || current.runner.online, detail: current.runner });
    return { ok: checks.every(check => check.ok), mode: c.config.mode, url: current.url, dataRoot: c.home, checks,
        ignoredEnvironment: deploymentKeys.filter(key => c.env[key] !== undefined), modelAuthentication: 'not_checked' };
}
