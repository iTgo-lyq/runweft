import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { jsonResponse } from '../proxy';
import { HubStore } from './store';
import { HubError, HubName, HubRole, InvitationToken, hubInput, hubNotFound, hubUnauthorized } from './types';

const prefix = '/api/runweft/hub';
const named = z.object({ name: HubName }).strict();
const roleInput = z.object({ role: HubRole }).strict();
const attempts = new Map<string,{at: number; count: number}>();
function limitPassword(request: IncomingMessage, body: unknown) {
    const now = Date.now(), name = body && typeof body === 'object' && 'username' in body ? String(body.username).trim().toLowerCase().slice(0,80) : '';
    for (const [key,value] of attempts) if (now-value.at>=60_000) attempts.delete(key);
    if (attempts.size>4096) throw new HubError(429,'account_rate_limited','登录请求过多，请稍后重试。');
    for (const key of ['ip:'+request.socket.remoteAddress,...(name ? ['username:'+name] : [])]) {
        const value = attempts.get(key) ?? {at:now,count:0}; value.count++; attempts.set(key,value);
        if(value.count>(key.startsWith('ip:') ? 120 : 10)) throw new HubError(429,'account_rate_limited','登录请求过多，请稍后重试。');
    }
}
const inviteInput = z.object({ role: z.enum(['admin', 'member']) }).strict();

async function readBody(request: IncomingMessage): Promise<unknown> {
    if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
        throw new HubError(415, 'json_required', '请以 application/json 发送请求。');
    }
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0, settled = false;
        const timeout = setTimeout(() => done(new HubError(408, 'request_timeout', '请求读取超时。')), 10_000);
        const done = (error?: Error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            request.off('data', data); request.off('end', end); request.off('aborted', aborted);
            // An aborted request may emit error afterwards; retain its one-shot listener.
            if (error) { request.resume(); reject(error); }
            else {
                try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
                catch { reject(new HubError(400, 'invalid_json', '请求必须是有效的 JSON 对象。')); }
            }
        };
        const data = (chunk: Buffer) => {
            size += chunk.length;
            if (size > 16_384) done(new HubError(413, 'hub_request_too_large', '请求不能超过 16 KiB。'));
            else chunks.push(Buffer.from(chunk));
        };
        const end = () => done();
        const failed = () => done(new HubError(400, 'request_failed', '请求读取失败。'));
        const aborted = () => done(new HubError(400, 'request_aborted', '请求已中断。'));
        request.on('data', data); request.once('end', end); request.once('error', failed); request.once('aborted', aborted);
    });
}

export async function handleHubRequest(request: IncomingMessage, response: ServerResponse, store?: HubStore): Promise<boolean> {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (path !== prefix && !path.startsWith(`${prefix}/`)) return false;
    try {
        if (!store) throw new HubError(503, 'hub_identity_unavailable', '当前服务尚未启用 Hub 身份入口。');
        const method = request.method;
        const publicAction = method === 'POST' && ['/accounts','/sessions','/account/password-reset'].some(route => path === prefix+route);
        const authorization = request.headers.authorization;
        const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
        const body = method === 'POST' || method === 'PATCH' ? await readBody(request) : undefined;
        if (request.headers.origin && new URL(request.headers.origin).host !== request.headers.host) throw new HubError(403,'account_origin_invalid','请在当前 Hub 页面完成操作。');
        if (publicAction) {
            limitPassword(request,body);
            const input = hubInput(z.object({ username: z.unknown(), password: z.unknown(), code: z.unknown().optional() }).strict(), body);
            const result = path.endsWith('/accounts') ? await store.accounts.register(input.username,input.password)
                : path.endsWith('/sessions') ? await store.accounts.login(input.username,input.password)
                : await store.accounts.recover(input.username,input.code,input.password);
            jsonResponse(response,path.endsWith('/accounts') ? 201 : 200,result); return true;
        }
        if (method === 'POST' && [prefix+'/account/password',prefix+'/credentials/revoke-all'].includes(path)) {
            limitPassword(request,body);
            const input = hubInput(z.object({ password: z.unknown(), newPassword: z.unknown().optional() }).strict(),body);
            const result = path.endsWith('/account/password') ? await store.accounts.changePassword(token,input.password,input.newPassword)
                : await store.accounts.logoutAll(token,input.password);
            jsonResponse(response,200,result); return true;
        }
        const result = store.authorized(token, !['GET', 'HEAD'].includes(method ?? ''), identity => {
            let parts: string[];
            try { parts = path.slice(prefix.length + 1).split('/').map(decodeURIComponent); }
            catch { throw new HubError(400, 'invalid_path', '请求路径编码无效。'); }
            if (parts.length === 1 && parts[0] === 'identity') {
                if (method === 'GET') return { identity };
                if (method === 'PATCH') return { identity: store.renameIdentity(identity.id, hubInput(named, body).name) };
            }
            if (parts.join('/') === 'account' && method === 'GET') return { identity, username: (store.accounts.db.query('SELECT username FROM hub_accounts WHERE userId=?').get(identity.id) as {username:string}).username };
            if (parts.join('/') === 'sessions/logout' && method === 'POST') return store.accounts.revoke(identity.id,store.accounts.authenticate(token).credential.id);
            if (parts[0] === 'credentials') {
                if (parts.length === 1 && method === 'GET') return { credentials: store.accounts.list(identity.id), currentCredentialId: store.accounts.authenticate(token).credential.id };
                if (parts.length === 2 && method === 'DELETE') return store.accounts.revoke(identity.id,hubInput(z.uuid(),parts[1]));
            }
            if (parts.join('/') === 'invitations/accept' && method === 'POST') {
                const invitation = hubInput(z.object({ token: InvitationToken }).strict(), body).token;
                return { space: store.acceptInvitation(identity.id, invitation) };
            }
            const [kind, id, section, targetId] = parts;
            if (kind === 'spaces') {
                if (parts.length === 1) {
                    if (method === 'GET') return { spaces: store.spaces(identity.id) };
                    if (method === 'POST') return { space: store.createSpace(identity.id, hubInput(named, body).name) };
                }
                if (id && parts.length === 2) {
                    if (method === 'GET') return { space: store.space(identity.id, id) };
                    if (method === 'PATCH') return { space: store.renameSpace(identity.id, id, hubInput(named, body).name) };
                }
                if (id && section === 'permissions' && parts.length === 3 && method === 'GET') {
                    return { permissions: store.permissions(identity.id, id) };
                }
                if (id && section === 'members') {
                    if (parts.length === 3 && method === 'GET') return { members: store.members(identity.id, id) };
                    if (targetId && parts.length === 4) {
                        if (method === 'PATCH') return { member: store.changeMember(identity.id, id, targetId, hubInput(roleInput, body).role) };
                        if (method === 'DELETE') return { member: store.changeMember(identity.id, id, targetId, null) };
                    }
                }
                if (id && section === 'invitations') {
                    if (parts.length === 3) {
                        if (method === 'GET') return { invitations: store.invitations(identity.id, id) };
                        if (method === 'POST') return store.invite(identity.id, id, hubInput(inviteInput, body).role);
                    }
                    if (targetId && parts.length === 4 && method === 'DELETE') return store.revokeInvitation(identity.id, id, targetId);
                }
            }
            throw hubNotFound();
        });
        jsonResponse(response, 200, result);
    } catch (error) {
        const known = error instanceof HubError;
        if (!response.destroyed) jsonResponse(response, known ? error.status : 500, { error: known
            ? { code: error.code, message: error.message, hint: error.hint }
            : { code: 'hub_operation_failed', message: 'Hub 操作未能完成。', hint: '检查中心存储状态；写操作不要盲目重试。' } });
    }
    return true;
}
