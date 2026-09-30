import { readFileSync } from 'node:fs';
import { decodeJwt } from 'jose';
import { z } from 'zod';
import { expandPath, hubOrigin } from '../config';
import { RunweftError } from '../errors';
import { fetchJson, HapiRequestError } from '../hapi';
import { IdentityToken, type Identity } from './types';

export type HubConnectionOptions = { url: string; identityFile?: string; space?: string; env?: NodeJS.ProcessEnv };
const missingIdentity = () => new RunweftError('hub_identity_missing', '需要此 Hub 的身份 token。', '使用 --identity-file 指向 Web 下载的备份，或设置 RUNWEFT_IDENTITY_TOKEN。');

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
        let token: string | undefined;
        if (options.identityFile) {
            let contents: string;
            try { contents = readFileSync(expandPath(options.identityFile), 'utf8').trim(); }
            catch { throw new RunweftError('hub_identity_file_unreadable', '无法读取身份备份文件。', '检查 --identity-file 的路径和权限。'); }
            if (contents.length > 16_384) throw missingIdentity();
            if (IdentityToken.safeParse(contents).success) token = contents;
            else {
                const lines = contents.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
                const source = lines.find(line => line.startsWith('Runweft Hub: '))?.slice('Runweft Hub: '.length);
                const identity = lines.find(line => line.startsWith('身份 ID: '))?.slice('身份 ID: '.length);
                const backupOrigin = hubOrigin.safeParse(source);
                if (!backupOrigin.success || backupOrigin.data !== this.url) throw new RunweftError('hub_identity_origin_mismatch', '备份文件的 Hub 地址与当前 --url 不一致。', '选择此 Hub 的身份备份；不会把身份 token 发送到另一个 Hub。');
                if (!z.uuid().safeParse(identity).success) throw missingIdentity();
                const tokens = lines.filter(line => IdentityToken.safeParse(line).success);
                if (tokens.length !== 1) throw missingIdentity();
                token = tokens[0]; this.expectedIdentity = identity;
            }
        } else token = (options.env ?? process.env).RUNWEFT_IDENTITY_TOKEN;
        if (!IdentityToken.safeParse(token).success) throw missingIdentity();
        this.identityToken = token!;
    }
    private async checkHub() {
        if (this.ready) return;
        const health = await fetchJson(this.url + '/api/runweft/health', { redirect: 'error' });
        if (health?.service !== 'runweft' || health?.capabilities?.[this.capability] !== 1 || health?.capabilities?.hubAccess !== 1) {
            throw new RunweftError(this.unavailableCode, '目标服务尚未启用当前命令所需的 Hub 能力。', '升级配套 Hub；不会回退到旧 HAPI token 或本地配置。');
        }
        this.capabilities = health.capabilities; this.ready = true;
    }
    protected async requireCapability(capability: string, code: string) {
        await this.checkHub();
        if (this.capabilities[capability] !== 1) throw new RunweftError(code, '目标 Hub 尚未启用此功能。', '升级配套 Hub 后重试；不会回退本地配置。');
    }
    private async send(path: string, options: RequestInit, extraSecrets: string[] = []) {
        try { await this.checkHub(); return await fetchJson(this.url + path, { ...options, redirect: 'error' }); }
        catch (error) {
            if (!(error instanceof RunweftError)) throw new RunweftError('hub_request_failed', 'Hub 请求未能完成。', '先查询原对象或请求结果，不要重复创建。');
            const clean = (text?: string) => text && [this.identityToken, this.jwt, ...extraSecrets].filter((s): s is string => !!s)
                .reduce((result, secret) => result.split(secret).join('[redacted]'), text);
            throw new HapiRequestError(error instanceof HapiRequestError ? error.status : 503, clean(error.code)!, clean(error.message)!, clean(error.hint));
        }
    }
    private async userJwt() {
        if (this.jwt && this.expiresAt > Date.now() + 30_000) return this.jwt;
        const reply = await this.send('/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ accessToken: this.identityToken, ...(this.spaceId ? { spaceId: this.spaceId } : {}) }) });
        const claims = decodeJwt(reply.token);
        if (claims.kind !== 'user' || typeof claims.sub !== 'string' || !z.uuid().safeParse(claims.sub).success
            || claims.space !== this.spaceId || typeof claims.exp !== 'number' || (this.expectedIdentity && this.expectedIdentity !== claims.sub)) {
            throw new RunweftError('hub_identity_response_invalid', 'Hub 返回的身份与当前备份或选定空间不一致。');
        }
        this.jwt = reply.token; this.expiresAt = claims.exp * 1000; return this.jwt!;
    }
    protected async request<T>(path: string, method = 'GET', body?: object): Promise<T> {
        const jwt = await this.userJwt();
        return this.send(path, { method, headers: { authorization: `Bearer ${jwt}`, ...(body ? { 'content-type': 'application/json' } : {}) },
            ...(body ? { body: JSON.stringify(body) } : {}) }, body && 'token' in body ? [String(body.token)] : []);
    }
    async identity(): Promise<Identity> {
        const reply = await this.send('/api/runweft/hub/identity', { headers: { authorization: `Bearer ${this.identityToken}` } });
        const parsed = z.object({ id: z.uuid(), name: z.string(), createdAt: z.number() }).safeParse(reply.identity);
        if (!parsed.success || (this.expectedIdentity && this.expectedIdentity !== parsed.data.id)) throw new RunweftError('hub_identity_response_invalid', 'Hub 返回的身份与当前备份不一致。');
        return parsed.data;
    }
    async verifyMachine(token: string, credentialId: string): Promise<void> {
        const reply = await this.send('/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accessToken: token }) }, [token]);
        const claims = decodeJwt(reply.token);
        if (claims.kind !== 'machine' || claims.sub !== credentialId) throw new RunweftError('machine_credential_mismatch', '机器凭据与 Hub 登记不一致。', '显式轮换凭据后重新启动 Runner。');
    }
}
