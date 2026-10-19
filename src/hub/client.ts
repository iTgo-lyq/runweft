import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { decodeJwt } from 'jose';
import { z } from 'zod';
import { configPath, hubOrigin } from '../config';
import { RunweftError } from '../errors';
import { fetchJson, fetchResponse, HapiRequestError, type HapiHttp } from '../hapi';
import { userCredentialKind } from './accounts/credentials';
import { type Identity } from './types';
import { readIdentityConnection } from './connect/record';

export type HubConnectionOptions = { url: string; credential?: {token: string; ownerId?: string; spaceId?: string | null}; space?: string; home?: string; env?: NodeJS.ProcessEnv };
const missingIdentity = () => new RunweftError('hub_identity_missing', '尚未连接此 Hub 的身份。', '执行 hub connect begin，在 Web 确认后执行 hub connect complete；普通用户无需保管 token。');

/** Never starts a local service, accepts the legacy root credential, or keeps a central authority copy. */
export class HubClient {
    readonly url: string;
    readonly spaceId: string | null;
    private readonly identityToken: string;
    private readonly expectedIdentity?: string;
    private ready = false;
    private capabilities: Record<string, number> = {};
    private jwt?: string;
    private expiresAt = 0;

    constructor(options: HubConnectionOptions, private readonly capability: string, private readonly unavailableCode: string) {
        const parsed = hubOrigin.safeParse(options.url);
        if (!parsed.success) throw new RunweftError('hub_url_invalid', '请显式填写不带路径或凭据的 Hub HTTP(S) 根地址。');
        this.url = parsed.data;
        if (options.space && !z.uuid().safeParse(options.space).success) throw new RunweftError('hub_space_invalid', '空间 ID 必须是 Hub 分配的 UUID。');
        this.spaceId = options.space ?? null;
        if ((options.env ?? process.env).RUNWEFT_IDENTITY_TOKEN) throw new RunweftError('hub_identity_input_removed','已移除身份 token 环境变量输入，请用账号连接。');
        const record = options.credential ?? readIdentityConnection(dirname(configPath(options.home,options.env)),this.url);
        const token = record?.token;
        if (!userCredentialKind(token)) throw missingIdentity();
        this.spaceId = options.space ?? record?.spaceId ?? null;
        this.expectedIdentity = record?.ownerId;
        this.identityToken = token!;
    }
    private async checkHub(signal?: AbortSignal) {
        if (this.ready) return;
        const health = await fetchJson(this.url + '/api/runweft/health', { redirect: 'error', signal });
        if (health?.service !== 'runweft' || health?.capabilities?.[this.capability] !== 1 || health?.capabilities?.hubAccess !== 1) {
            throw new RunweftError(this.unavailableCode, '目标服务尚未启用当前命令所需的 Hub 能力。', '升级配套 Hub；不会回退到旧 HAPI token 或本地配置。');
        }
        this.capabilities = health.capabilities; this.ready = true;
    }
    protected async requireCapability(capability: string, code: string, signal?: AbortSignal) {
        await this.checkHub(signal);
        if (this.capabilities[capability] !== 1) throw new RunweftError(code, '目标 Hub 尚未启用此功能。', '升级配套 Hub 后重试；不会回退本地配置。');
    }
    private async sendResponse(path: string, options: RequestInit, extraSecrets: string[] = []) {
        if (!path.startsWith('/') || new URL(path, this.url).origin !== this.url) throw new RunweftError('hub_request_path_invalid', 'Hub 请求必须使用当前服务的路径。');
        try { await this.checkHub(options.signal ?? undefined); return await fetchResponse(this.url + path, { ...options, redirect: 'error' }); }
        catch (error) {
            options.signal?.throwIfAborted();
            if (!(error instanceof RunweftError)) throw new RunweftError('hub_request_failed', 'Hub 请求未能完成。', '先查询原对象或请求结果，不要重复创建。');
            const clean = (text?: string) => text && [this.identityToken, this.jwt, ...extraSecrets].filter((s): s is string => !!s)
                .reduce((result, secret) => result.split(secret).join('[redacted]'), text);
            throw new HapiRequestError(error instanceof HapiRequestError ? error.status : 503, clean(error.code)!, clean(error.message)!, clean(error.hint));
        }
    }
    private async send(path: string, options: RequestInit, extraSecrets: string[] = []) {
        const response = await this.sendResponse(path, options, extraSecrets);
        try { return await response.json(); }
        catch { throw new RunweftError('hub_response_invalid', 'Hub 返回了无法解析的响应。'); }
    }
    private async userJwt(signal?: AbortSignal) {
        signal?.throwIfAborted();
        if (this.jwt && this.expiresAt > Date.now() + 30_000) return this.jwt;
        const reply = await this.send('/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ accessToken: this.identityToken, ...(this.spaceId ? { spaceId: this.spaceId } : {}) }), signal });
        const claims = decodeJwt(reply.token);
        if (claims.kind !== 'user' || typeof claims.sub !== 'string' || !z.uuid().safeParse(claims.sub).success
            || claims.space !== this.spaceId || typeof claims.exp !== 'number' || (this.expectedIdentity && this.expectedIdentity !== claims.sub)) {
            throw new RunweftError('hub_identity_response_invalid', 'Hub 返回的身份与当前备份或选定空间不一致。');
        }
        this.jwt = reply.token; this.expiresAt = claims.exp * 1000; return this.jwt!;
    }
    protected async request<T>(path: string, method = 'GET', body?: object, signal?: AbortSignal): Promise<T> {
        const jwt = await this.userJwt(signal);
        return this.send(path, { method, headers: { authorization: `Bearer ${jwt}`, ...(body ? { 'content-type': 'application/json' } : {}) },
            ...(body ? { body: JSON.stringify(body) } : {}), signal }, body && 'token' in body ? [String(body.token)] : []);
    }
    /** Existing task/file helpers use the same authenticated Hub transport, including streaming and cancellation. */
    readonly http: HapiHttp = {
        request: async (path, options = {}) => {
            const response = await this.http.response(path, options);
            try { return await response.json(); } catch { throw new RunweftError('hub_response_invalid', 'Hub 返回了无法解析的响应。'); }
        },
        response: async (path, options = {}) => {
            if (!this.spaceId) throw new RunweftError('hub_space_required', '此操作需要选择 Hub 空间。', '通过 Web 确认连接或显式指定 --space。');
            const jwt = await this.userJwt(options.signal ?? undefined);
            return this.sendResponse(path, { ...options, headers: { ...Object.fromEntries(new Headers(options.headers)), authorization: `Bearer ${jwt}` } });
        },
    };
    async user(path: string, method = 'GET', body?: object, signal?: AbortSignal): Promise<any> {
        const secrets = body ? Object.entries(body).filter(([key])=>/password|token|code/i.test(key)).map(([,value])=>String(value)) : [];
        return this.send('/api/runweft/hub'+path,{method,headers:{authorization:`Bearer ${this.identityToken}`,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal},secrets);
    }
    async identity(signal?: AbortSignal): Promise<Identity> {
        const reply = await this.send('/api/runweft/hub/identity', { headers: { authorization: `Bearer ${this.identityToken}` }, signal });
        const parsed = z.object({ id: z.uuid(), name: z.string(), createdAt: z.number() }).safeParse(reply.identity);
        if (!parsed.success || (this.expectedIdentity && this.expectedIdentity !== parsed.data.id)) throw new RunweftError('hub_identity_response_invalid', 'Hub 返回的身份与当前备份不一致。');
        return parsed.data;
    }
    async connection(signal?: AbortSignal) {
        if (!this.spaceId) throw new RunweftError('hub_space_required', '尚未选择 Hub 空间。', '通过 Web 确认连接，或使用 --space 指定已加入的空间。');
        await this.userJwt(signal);
        return { hub: this.url, ownerId: (await this.identity(signal)).id, spaceId: this.spaceId };
    }
    async verifyMachine(token: string, credentialId: string): Promise<void> {
        const reply = await this.send('/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accessToken: token }) }, [token]);
        const claims = decodeJwt(reply.token);
        if (claims.kind !== 'machine' || claims.sub !== credentialId) throw new RunweftError('machine_credential_mismatch', '机器凭据与 Hub 登记不一致。', '显式轮换凭据后重新启动 Runner。');
    }
}
