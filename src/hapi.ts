import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { decodeJwt } from 'jose';
import pkg from '../package.json';
import { atomicWrite, dataPaths, targetUrl, type ResolvedConfig } from './config';
import { RunweftError } from './errors';

export const BUILD = { version: pkg.version, hapi: pkg.hapi };
export const deploymentKeys = ['HAPI_HOME', 'DB_PATH', 'HAPI_LISTEN_HOST', 'HAPI_LISTEN_PORT', 'HAPI_PUBLIC_URL', 'CORS_ORIGINS', 'HAPI_API_URL', 'CLI_API_TOKEN', 'HAPI_DISABLE_VERSION_HANDOFF'];

export function readSettings(home: string): Record<string, unknown> {
    const path = join(home, 'settings.json');
    if (!existsSync(path)) return {};
    return JSON.parse(readFileSync(path, 'utf8'));
}

export function serverToken(c: ResolvedConfig, create = false): string | undefined {
    const home = dataPaths(c).hapiServer;
    const settings = readSettings(home);
    if (typeof settings.cliApiToken === 'string' && settings.cliApiToken) return settings.cliApiToken;
    if (!create) return undefined;
    const token = randomBytes(32).toString('base64url');
    atomicWrite(join(home, 'settings.json'), JSON.stringify({ ...settings, cliApiToken: token }, null, 2));
    return token;
}

export function accessToken(c: ResolvedConfig): string {
    const token = c.config.mode === 'local' ? serverToken(c)
        : c.env[c.config.hub.tokenEnv] || readSettings(dataPaths(c).hapiClient).cliApiToken;
    if (typeof token !== 'string' || !token) {
        throw new RunweftError('authentication_missing', '当前连接尚未配置 HAPI 访问令牌。', c.config.mode === 'local'
            ? '运行 runweft start 启动本地服务。'
            : `设置 ${c.config.hub.tokenEnv}，或运行 runweft auth login。`);
    }
    return token;
}

export function hapiExecutable(c: ResolvedConfig): string {
    if (c.config.hapi.executable) return c.config.hapi.executable;
    const sibling = join(dirname(process.execPath), 'hapi');
    if (existsSync(sibling)) return sibling;
    const target = `bun-${process.platform}-${process.arch}${process.platform === 'linux' && process.arch === 'x64' ? '-baseline' : ''}`;
    const sourceBuild = join(import.meta.dir, '..', 'hapi', 'cli', 'dist-exe', target, 'hapi');
    if (existsSync(sourceBuild)) return sourceBuild;
    throw new RunweftError('hapi_missing', '安装包中找不到兼容的 HAPI 程序。', '重新安装 Runweft；源码开发请先构建 HAPI。');
}

export function hapiEnvironment(c: ResolvedConfig, options: {
    home: string; url: string; token?: string; port?: number; publicUrl?: string; supervised?: boolean;
}): NodeJS.ProcessEnv {
    const env = { ...c.env };
    for (const key of deploymentKeys) delete env[key];
    env.HAPI_HOME = options.home;
    env.DB_PATH = join(options.home, 'hapi.db');
    env.HAPI_API_URL = options.url;
    if (options.token) env.CLI_API_TOKEN = options.token;
    if (options.port) {
        env.HAPI_LISTEN_HOST = '127.0.0.1';
        env.HAPI_LISTEN_PORT = String(options.port);
    }
    if (options.publicUrl) {
        env.HAPI_PUBLIC_URL = options.publicUrl;
        env.CORS_ORIGINS = new URL(options.publicUrl).origin;
    }
    if (options.supervised) env.HAPI_DISABLE_VERSION_HANDOFF = '1';
    return env;
}

export function clientEnvironment(c: ResolvedConfig) {
    let token: string | undefined;
    try { token = accessToken(c); } catch (error) {
        if (!(error instanceof RunweftError) || error.code !== 'authentication_missing') throw error;
    }
    return hapiEnvironment(c, { home: dataPaths(c).hapiClient, url: targetUrl(c.config), token });
}

export async function runHapi(c: ResolvedConfig, args: string[], capture = false) {
    return new Promise<{ code: number; signal: NodeJS.Signals | null; stdout: string; stderr: string }>((resolve, reject) => {
        const child = spawn(hapiExecutable(c), args, { env: clientEnvironment(c), stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
        let stdout = '', stderr = '';
        child.stdout?.on('data', data => { stdout += data; });
        child.stderr?.on('data', data => { stderr += data; });
        const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];
        const listeners = signals.map(signal => ({ signal, listener: () => { child.kill(signal); } }));
        for (const { signal, listener } of listeners) process.on(signal, listener);
        const cleanup = () => { for (const { signal, listener } of listeners) process.off(signal, listener); };
        child.once('error', error => { cleanup(); reject(error); });
        child.once('exit', (code, signal) => { cleanup(); resolve({ code: code ?? 1, signal, stdout, stderr }); });
    });
}

export async function stopChild(child: ChildProcess) {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>(resolve => {
        const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
        child.kill('SIGTERM');
    });
}

export class HapiRequestError extends RunweftError {
    constructor(readonly status: number, code: string, message: string, hint = '运行 runweft doctor 检查当前连接。') {
        super(code, message, hint);
    }
}

export async function fetchJson(url: string, options: RequestInit = {}): Promise<any> {
    let response: Response;
    try { response = await fetch(url, { ...options, signal: options.signal ?? AbortSignal.timeout(10_000) }); }
    catch {
        options.signal?.throwIfAborted();
        throw new RunweftError('connection_failed', '无法连接服务。', '检查目标地址，或运行 runweft status / runweft doctor。');
    }
    if (!response.ok) {
        const body = await response.json().catch(() => null) as { code?: unknown; error?: unknown; message?: unknown; hint?: unknown } | null;
        const nested = body?.error && typeof body.error === 'object' ? body.error as { code?: unknown; message?: unknown; hint?: unknown } : null;
        const code = typeof nested?.code === 'string' ? nested.code : typeof body?.code === 'string' ? body.code
            : response.status === 401 || response.status === 403 ? 'authentication_failed' : 'request_failed';
        const detail = typeof nested?.message === 'string' ? nested.message
            : typeof body?.error === 'string' ? body.error : typeof body?.message === 'string' ? body.message : undefined;
        throw new HapiRequestError(response.status, code, detail ?? `服务请求失败（HTTP ${response.status}）。`,
            typeof nested?.hint === 'string' ? nested.hint : typeof body?.hint === 'string' ? body.hint : undefined);
    }
    try { return await response.json(); }
    catch { throw new RunweftError('invalid_hapi_response', 'HAPI 返回了无法解析的响应。'); }
}

export class HapiClient {
    private jwt?: string;
    private expiresAt = 0;
    constructor(readonly url: string, private readonly token: string) {}
    async authenticate(signal?: AbortSignal) {
        const result = await fetchJson(`${this.url}/api/auth`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accessToken: this.token }), signal,
        });
        if (typeof result.token !== 'string') throw new RunweftError('invalid_hapi_response', 'HAPI 未返回认证凭据。');
        this.jwt = result.token;
        // The token came from the authenticated HAPI exchange; the server remains authoritative.
        const claims = decodeJwt(result.token);
        this.expiresAt = typeof claims.exp === 'number' ? claims.exp * 1000 : Infinity;
        return { userId: claims.uid, namespace: claims.ns };
    }
    async request(path: string, options: RequestInit = {}) {
        // Refresh before sending, never replay a business POST after an uncertain response.
        if (!this.jwt || Date.now() >= this.expiresAt - 30_000) await this.authenticate(options.signal ?? undefined);
        return fetchJson(`${this.url}${path}`, { ...options, headers: { ...Object.fromEntries(new Headers(options.headers)), authorization: `Bearer ${this.jwt}` } });
    }
}

export function hapiClient(c: ResolvedConfig) { return new HapiClient(targetUrl(c.config), accessToken(c)); }
