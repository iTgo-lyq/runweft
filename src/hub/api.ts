import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { jsonResponse } from '../proxy';
import { HubStore } from './store';
import { HubError, HubName, HubRole, IdentityToken, InvitationToken, hubInput, hubNotFound, hubUnauthorized } from './types';

const prefix = '/api/runweft/hub';
const named = z.object({ name: HubName }).strict();
const roleInput = z.object({ role: HubRole }).strict();
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
        const method = request.method, creating = path === `${prefix}/identities` && method === 'POST';
        const authorization = request.headers.authorization;
        const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
        if (!creating && !IdentityToken.safeParse(token).success) throw hubUnauthorized();
        const body = method === 'POST' || method === 'PATCH' ? await readBody(request) : undefined;
        if (creating) {
            const { name } = hubInput(named, body);
            jsonResponse(response, 201, store.createIdentity(name));
            return true;
        }
        const result = store.authorized(token, !['GET', 'HEAD'].includes(method ?? ''), identity => {
            let parts: string[];
            try { parts = path.slice(prefix.length + 1).split('/').map(decodeURIComponent); }
            catch { throw new HubError(400, 'invalid_path', '请求路径编码无效。'); }
            if (parts.length === 1 && parts[0] === 'identity') {
                if (method === 'GET') return { identity };
                if (method === 'PATCH') return { identity: store.renameIdentity(identity.id, hubInput(named, body).name) };
            }
            if (parts.join('/') === 'identity/rotate' && method === 'POST') {
                const next = hubInput(z.object({ token: IdentityToken }).strict(), body).token;
                return { identity: store.rotate(identity, token, next) };
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
