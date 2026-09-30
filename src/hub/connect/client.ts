import { constants, createHash, generateKeyPairSync, privateDecrypt, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { hostname } from 'node:os';
import { z } from 'zod';
import { atomicWrite } from '../../config';
import { RunweftError } from '../../errors';
import { fetchJson, HapiRequestError } from '../../hapi';
import { HubClient } from '../client';
import { HubName, IdentityToken } from '../types';
import { connectionFileLock, hubConnectionPaths } from '../resources/connection';
import { IdentityConnectionSchema, readIdentityConnection, type IdentityConnectionRecord } from './record';
import { PollingSecret, connectionOrigin } from './types';

const PendingSchema = z.object({ requestId: z.uuid(), hub: connectionOrigin, label: HubName, secret: PollingSecret,
    publicKey: z.string(), privateKey: z.string(), priorDigest: z.string().nullable(), createdAt: z.number(), expiresAt: z.number() }).strict();
type Pending = z.infer<typeof PendingSchema>;
const RequestSchema = z.object({ id: z.uuid(), origin: connectionOrigin, label: HubName, publicKey: z.string(), code: z.string().regex(/^[A-F0-9]{8}$/),
    expiresAt: z.number(), status: z.enum(['pending', 'confirmed', 'consumed', 'cancelled']) });
const PollSchema = z.discriminatedUnion('status', [
    z.object({ status: z.literal('confirmed'), ownerId: z.uuid(), spaceId: z.uuid(), ciphertext: z.string().regex(/^[A-Za-z0-9_-]{342}$/), expiresAt: z.number() }),
    z.object({ status: z.enum(['pending', 'consumed', 'cancelled']), expiresAt: z.number().optional() }),
]);
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const changed = () => new RunweftError('hub_connection_changed', '本机的连接请求或身份已改变，未覆盖现有记录。', '查询 hub connect status；如需换身份，请取消旧请求后重新连接。');
const invalid = () => new RunweftError('hub_connection_response_invalid', 'Hub 连接响应无法验证。', '核对 Hub 地址；不要重复创建身份。');

export class IdentityConnection {
    readonly paths: ReturnType<typeof hubConnectionPaths>;
    constructor(home: string, url: string) {
        if (!url) throw new RunweftError('hub_connection_required', '尚未选择 Hub 地址。', '使用 hub --url <HTTPS或localhost根地址> connect begin；确认后 complete 会保存连接。');
        const parsed = connectionOrigin.safeParse(url);
        if (!parsed.success) throw new RunweftError('hub_connect_https_required', '凭据交接只支持 HTTPS 或 localhost。', '远端启用 HTTPS 或通过 SSH 隧道连接 localhost。');
        this.paths = hubConnectionPaths(home, parsed.data);
    }
    private pending(): Pending | undefined {
        if (!existsSync(this.paths.pendingConnection)) return;
        try {
            const record = PendingSchema.parse(JSON.parse(readFileSync(this.paths.pendingConnection, 'utf8')));
            if (record.hub !== this.paths.hub) throw new Error(); return record;
        } catch { throw new RunweftError('hub_connect_record_invalid', '本机连接请求文件无效。', '检查 hub paths 显示的 connect.json，未修改现有身份。'); }
    }
    private identity() { return readIdentityConnection(this.paths.home, this.paths.hub); }
    private currentDigest() { return existsSync(this.paths.identityConnection) ? digest(readFileSync(this.paths.identityConnection, 'utf8')) : null; }
    private summary(record: IdentityConnectionRecord) {
        return { hub: record.hub, ownerId: record.ownerId, spaceId: record.spaceId, requestId: record.requestId, identityFile: this.paths.identityConnection };
    }
    status() {
        const pending = this.pending(), record = this.identity();
        return { hub: this.paths.hub, connected: !!record, ...(record ? this.summary(record) : {}),
            ...(pending ? { pending: { requestId: pending.requestId, label: pending.label, expiresAt: pending.expiresAt } } : {}) };
    }
    private async request(path: string, body?: object, secret?: string, privateValues: string[] = []) {
        try {
            const health = await fetchJson(this.paths.hub + '/api/runweft/health', { redirect: 'error' });
            if (health?.service !== 'runweft' || health?.capabilities?.hubConnect !== 1 || health?.capabilities?.hubAccess !== 1) {
                throw new RunweftError('hub_connect_unavailable', '目标 Hub 尚未提供身份交接功能。', '升级配套 Hub。');
            }
            return await fetchJson(this.paths.hub + '/api/runweft/connect' + path, { method: 'POST', redirect: 'error',
                headers: { ...(secret ? { authorization: `Bearer ${secret}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
                ...(body ? { body: JSON.stringify(body) } : {}) });
        } catch (error) {
            if (!(error instanceof RunweftError)) throw new RunweftError('hub_connect_failed', '无法完成 Hub 连接请求。', '网络恢复后使用原命令重试；请求已保存在本机。');
            const clean = (text?: string) => [secret, ...privateValues].filter((value): value is string => !!value)
                .reduce((result, value) => result?.split(value).join('[redacted]'), text);
            throw new HapiRequestError(error instanceof HapiRequestError ? error.status : 503, clean(error.code)!, clean(error.message)!, clean(error.hint));
        }
    }
    async begin(label?: string) {
        if (label !== undefined && !HubName.safeParse(label).success) throw new RunweftError('hub_connect_label_invalid', '连接展示名称无效。');
        const pending = connectionFileLock(this.paths, () => {
            const current = this.pending();
            if (current && current.expiresAt > Date.now()) {
                if (label !== undefined && label !== current.label) throw changed(); return current;
            }
            const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
            const now = Date.now(), record: Pending = { hub: this.paths.hub, label: label?.trim() ?? hostname(), requestId: randomUUID(),
                secret: `rw_cp_${randomBytes(32).toString('base64url')}`, publicKey: keys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
                privateKey: keys.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(), priorDigest: this.currentDigest(), createdAt: now, expiresAt: now + 600_000 };
            atomicWrite(this.paths.pendingConnection, JSON.stringify(record, null, 2) + '\n'); return record;
        });
        const reply = RequestSchema.safeParse(await this.request('', { requestId: pending.requestId, origin: pending.hub, label: pending.label,
            publicKey: pending.publicKey, pollingDigest: digest(pending.secret) }, undefined, [pending.secret, pending.privateKey]));
        if (!reply.success || reply.data.id !== pending.requestId || reply.data.origin !== pending.hub || reply.data.publicKey !== pending.publicKey || reply.data.label !== pending.label) throw invalid();
        connectionFileLock(this.paths, () => {
            if (this.pending()?.requestId !== pending.requestId) throw changed();
            atomicWrite(this.paths.pendingConnection, JSON.stringify({ ...pending, expiresAt: reply.data.expiresAt }, null, 2) + '\n');
        });
        return { requestId: pending.requestId, hub: pending.hub, label: pending.label, code: reply.data.code, expiresAt: reply.data.expiresAt,
            status: reply.data.status, confirmationUrl: `${pending.hub}/hub#connect=${pending.requestId}` };
    }
    private async validate(record: IdentityConnectionRecord) {
        const client = new HubClient({ url: record.hub, space: record.spaceId, home: this.paths.home, env: { RUNWEFT_IDENTITY_TOKEN: record.token } }, 'hubConnect', 'hub_connect_unavailable');
        const result = await client.connection();
        if (result.ownerId !== record.ownerId) throw invalid();
    }
    async complete() {
        const pending = this.pending();
        if (!pending) {
            const record = this.identity();
            if (!record) throw new RunweftError('hub_connect_required', '本机没有待完成的连接请求。', '先执行 hub connect begin。');
            await this.validate(record); return { status: 'connected', ...this.summary(record) };
        }
        const parsed = PollSchema.safeParse(await this.request(`/${pending.requestId}/poll`, undefined, pending.secret, [pending.privateKey]));
        if (!parsed.success) throw invalid();
        const reply = parsed.data;
        if (reply.status === 'pending') return { status: 'pending', requestId: pending.requestId, expiresAt: reply.expiresAt,
            confirmationUrl: `${pending.hub}/hub#connect=${pending.requestId}` };
        let record: IdentityConnectionRecord;
        if (reply.status === 'confirmed') {
            let token: string;
            try { token = privateDecrypt({ key: pending.privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(reply.ciphertext, 'base64url')).toString('utf8'); }
            catch { throw new RunweftError('hub_connect_decryption_failed', '连接密文无法由本机请求解密。', '未更改身份记录；取消并重新发起连接。'); }
            if (!IdentityToken.safeParse(token).success) throw invalid();
            record = { schemaVersion: 1, hub: pending.hub, ownerId: reply.ownerId, spaceId: reply.spaceId, token, requestId: pending.requestId, createdAt: Date.now() };
        } else {
            const current = this.identity();
            if (reply.status !== 'consumed' || current?.requestId !== pending.requestId) throw changed(); record = current;
        }
        await this.validate(record);
        connectionFileLock(this.paths, () => {
            const current = this.identity(), same = current?.requestId === pending.requestId && current.token === record.token && current.spaceId === record.spaceId;
            // A concurrent complete may have finished and removed the pending request. Never restore its obsolete private key.
            if (!same && (this.pending()?.requestId !== pending.requestId || this.currentDigest() !== pending.priorDigest)) throw changed();
            if (existsSync(this.paths.machineConnection)) {
                let owner: string;
                try { owner = z.object({ ownerId: z.uuid() }).parse(JSON.parse(readFileSync(this.paths.machineConnection, 'utf8'))).ownerId; }
                catch { throw new RunweftError('machine_connection_invalid', '机器接入记录无效，未修改身份连接。'); }
                if (owner !== record.ownerId) throw new RunweftError('machine_connection_owner_mismatch', '此 Hub 的机器记录属于另一个身份。', '保留原身份，或为新身份选择独立 --home。');
            }
            if (!same) atomicWrite(this.paths.identityConnection, JSON.stringify(IdentityConnectionSchema.parse(record), null, 2) + '\n');
        });
        const ack = await this.request(`/${pending.requestId}/acknowledge`, undefined, pending.secret, [pending.privateKey, record.token]);
        if (ack?.status !== 'consumed') throw invalid();
        connectionFileLock(this.paths, () => { if (this.pending()?.requestId === pending.requestId) unlinkSync(this.paths.pendingConnection); });
        return { status: 'connected', ...this.summary(record) };
    }
    async cancel() {
        const pending = this.pending();
        if (pending) {
            const reply = await this.request(`/${pending.requestId}/cancel`, undefined, pending.secret, [pending.privateKey]);
            if (!['cancelled', 'consumed'].includes(reply?.status)) throw invalid();
            connectionFileLock(this.paths, () => { if (this.pending()?.requestId === pending.requestId) unlinkSync(this.paths.pendingConnection); });
        }
        return { hub: this.paths.hub, status: 'cancelled', requestId: pending?.requestId };
    }
}
