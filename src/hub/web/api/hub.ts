// Typed Hub API for the browser. Identity routes use the account token; resource routes use a short space JWT.
import type { PublicUserCredential } from '../../accounts/credentials';
import type { ConnectionRequest } from '../../connect/types';
import type { HubStore } from '../../store';
import type { Identity, Invitation, Member, Role, Space } from '../../types';
import { HubApiError, hubFetch } from './http';

export type { Identity, Invitation, Member, Role, Space, ConnectionRequest };
export type SpacePermissions = ReturnType<HubStore['permissions']>;
export type Credential = PublicUserCredential & { active: boolean };
export const roleLabels: Record<Role, string> = { owner: '所有者', admin: '管理员', member: '成员' };

// ---- session record --------------------------------------------------------------
// The tab keeps its account token and selected space in sessionStorage under the existing key, so tabs stay
// signed in across an upgrade. Nothing is written to localStorage.
export type Saved = { token: string; spaceId?: string };
const storageKey = 'runweft.hub.session';

export function readSaved(): Saved {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return { token: '' };
    let value: unknown;
    try { value = JSON.parse(raw); } catch { sessionStorage.removeItem(storageKey); throw new HubApiError('error', '当前会话记录无效，请重新登录。'); }
    const saved = value as Partial<Saved> | null;
    if (!saved || typeof saved.token !== 'string' || (saved.spaceId !== undefined && typeof saved.spaceId !== 'string')) {
        sessionStorage.removeItem(storageKey); throw new HubApiError('error', '请使用账号密码重新登录。');
    }
    return { token: saved.token, ...(saved.spaceId ? { spaceId: saved.spaceId } : {}) };
}

export function writeSaved(saved: Saved) {
    try { sessionStorage.setItem(storageKey, JSON.stringify(saved)); }
    catch { throw new HubApiError('error', '浏览器无法保存当前登录。', '请允许此站点使用会话存储，再用账号密码登录。'); }
}

export function clearSaved() { sessionStorage.removeItem(storageKey); }

// ---- account and identity routes -----------------------------------------------------

export const accounts = {
    register: (username: string, password: string) => hubFetch<{ token: string }>('/accounts', { body: { username, password } }),
    login: (username: string, password: string) => hubFetch<{ token: string }>('/sessions', { body: { username, password } }),
    resetPassword: (username: string, code: string, password: string) => hubFetch('/account/password-reset', { body: { username, code, password } }),
    connection: (id: string) => hubFetch<ConnectionRequest>(`/${encodeURIComponent(id)}`, { base: '/api/runweft/connect' }),
};

/** Routes that act as the signed-in account. Each call carries the token it was created with. */
export function identityApi(token: string) {
    const call = <T = any>(path: string, body?: unknown, method?: string) => hubFetch<T>(path, { body, method, token });
    return {
        identity: () => call<{ identity: Identity }>('/identity').then(value => value.identity),
        rename: (name: string) => call<{ identity: Identity }>('/identity', { name }, 'PATCH').then(value => value.identity),
        account: () => call<{ username: string }>('/account'),
        credentials: () => call<{ credentials: Credential[]; currentCredentialId: string }>('/credentials'),
        revokeCredential: (id: string) => call(`/credentials/${encodeURIComponent(id)}`, undefined, 'DELETE'),
        changePassword: (password: string, newPassword: string) => call('/account/password', { password, newPassword }),
        logoutAll: (password: string) => call('/credentials/revoke-all', { password }),
        logout: () => call('/sessions/logout', {}),
        spaces: () => call<{ spaces: Space[] }>('/spaces').then(value => value.spaces),
        createSpace: (name: string) => call<{ space: Space }>('/spaces', { name }).then(value => value.space),
        renameSpace: (id: string, name: string) => call(`/spaces/${encodeURIComponent(id)}`, { name }, 'PATCH'),
        acceptInvitation: (invitation: string) => call<{ space: Space }>('/invitations/accept', { token: invitation }).then(value => value.space),
        permissions: (id: string) => call<{ permissions: SpacePermissions }>(`/spaces/${encodeURIComponent(id)}/permissions`).then(value => value.permissions),
        members: (id: string) => call<{ members: Member[] }>(`/spaces/${encodeURIComponent(id)}/members`).then(value => value.members),
        setRole: (id: string, userId: string, role: Role) => call(`/spaces/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, { role }, 'PATCH'),
        removeMember: (id: string, userId: string) => call(`/spaces/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, undefined, 'DELETE'),
        invitations: (id: string) => call<{ invitations: Invitation[] }>(`/spaces/${encodeURIComponent(id)}/invitations`).then(value => value.invitations),
        createInvitation: (id: string, role: Role) => call<{ invitation: Invitation; token: string }>(`/spaces/${encodeURIComponent(id)}/invitations`, { role }),
        revokeInvitation: (id: string, invitationId: string) => call(`/spaces/${encodeURIComponent(id)}/invitations/${encodeURIComponent(invitationId)}`, undefined, 'DELETE'),
        confirmConnection: (requestId: string, spaceId: string) =>
            hubFetch<ConnectionRequest>(`/${encodeURIComponent(requestId)}/confirm`, { body: { spaceId }, token, base: '/api/runweft/connect' }),
    };
}
export type IdentityApi = ReturnType<typeof identityApi>;

// ---- space-scoped resource routes ------------------------------------------------------

export type Scope = { token: string; userId: string; spaceId: string };
type Credential14 = { token: string; expiresAt: number };

/**
 * Resource routes under /api/runweft use a short JWT for the current space (or a global one for machine-scoped
 * reads). `isCurrent` lets the caller reject answers that arrive after the identity or space changed.
 */
export function spaceApi(scope: Scope, isCurrent: () => boolean) {
    const tokens = new Map<string, Credential14>();
    const stale = () => new HubApiError('error', '当前身份或空间已变化，请刷新。');
    async function jwt(global: boolean) {
        const key = global ? 'global' : scope.spaceId;
        const cached = tokens.get(key);
        if (cached && cached.expiresAt > Date.now() + 30_000) return cached.token;
        const auth = await hubFetch<{ token: string }>('/auth', { body: { accessToken: scope.token, ...(global ? {} : { spaceId: scope.spaceId }) }, base: '/api' });
        tokens.set(key, { token: auth.token, expiresAt: Date.now() + 14 * 60_000 });
        return auth.token;
    }
    /**
     * The Hub answers 401 both when the account session ended and when the account is no longer a member of the space.
     * Only the account route tells them apart, so a space-scoped 401 signs out only if that route also refuses.
     */
    async function explain(error: unknown, key: string): Promise<never> {
        if (!(error instanceof HubApiError) || error.kind !== 'expired') throw error;
        tokens.delete(key);
        await hubFetch('/identity', { token: scope.token });
        throw new HubApiError('error', '无法访问这个空间', '你可能已不是这个空间的成员。刷新后选择有权访问的空间。', 403, 'hub_space_access_lost');
    }
    async function request<T = any>(path: string, body?: unknown, method?: string, global = false): Promise<T> {
        if (!isCurrent()) throw stale();
        let result: T;
        try { result = await hubFetch<T>(path, { body, method, token: await jwt(global), base: '/api/runweft' }); }
        catch (error) { return explain(error, global ? 'global' : scope.spaceId); }
        if (!isCurrent()) throw stale();
        return result;
    }

    /**
     * Creation keeps a request ID and payload digest in sessionStorage until the Hub answers. An unknown result is
     * checked against the original receipt first; a changed form never silently creates a second object.
     */
    async function create<T = any>(path: string, payload: object, confirm: (message: string) => Promise<boolean>): Promise<T> {
        const key = `runweft.create:${scope.userId}:${scope.spaceId}:${path}`;
        const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)));
        const fingerprint = Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');
        const saved = sessionStorage.getItem(key);
        const pending: { requestId: string; fingerprint: string } = saved ? JSON.parse(saved) : { requestId: crypto.randomUUID(), fingerprint };
        const receipt = () => request<T>(`${path}/requests/${pending.requestId}`);
        if (saved) {
            try { const result = await receipt(); sessionStorage.removeItem(key); return result; }
            catch (error) {
                if (!(error instanceof HubApiError && error.status === 404)) throw error;
                if (pending.fingerprint !== fingerprint) {
                    if (await confirm(`Hub 未找到上次创建请求 ${pending.requestId}，表单也已改变。放弃本地待确认记录？放弃不会删除 Hub 上的资源，请先刷新核对。`)) sessionStorage.removeItem(key);
                    throw new HubApiError('error', '请核对列表后重新提交。', '未自动创建新的资源。');
                }
                if (!await confirm(`Hub 未找到请求 ${pending.requestId}。使用同一请求 ID 与相同参数重试？`)) throw new HubApiError('error', '创建尚未确认。', '已保留原请求 ID。');
            }
        }
        sessionStorage.setItem(key, JSON.stringify(pending));
        try {
            const result = await request<T>(path, { ...payload, requestId: pending.requestId });
            sessionStorage.removeItem(key); return result;
        } catch (error) {
            if (error instanceof HubApiError && error.status >= 400 && error.status < 500 && error.status !== 408) sessionStorage.removeItem(key);
            else {
                try { const result = await receipt(); sessionStorage.removeItem(key); return result; }
                catch { throw new HubApiError('unknown', `创建结果未确认，已保留请求 ${pending.requestId}`, '再次提交时会先查询原回执，不会自动新建。'); }
            }
            throw error;
        }
    }

    /**
     * Opens a native HAPI page in a new tab with a short JWT for the current space. The tab starts blank, checks the
     * session is readable, and only then receives the credential; nothing goes into the URL.
     */
    async function openNative(sessionId: string, files = false) {
        if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) throw new HubApiError('error', '无效原生会话 ID。');
        const tab = window.open('about:blank', '_blank');
        if (!tab) throw new HubApiError('error', '浏览器阻止了新标签页。', '允许此 Hub 打开弹窗后重试。');
        try {
            tab.sessionStorage.removeItem(storageKey); tab.sessionStorage.removeItem('runweft.native.access'); tab.opener = null;
            tab.document.title = '正在打开受限会话';
            tab.document.body.textContent = '正在核对当前空间的会话访问权限…';
            const auth = await hubFetch<{ token: string }>('/auth', { body: { accessToken: scope.token, spaceId: scope.spaceId }, base: '/api' })
                .catch(error => explain(error, scope.spaceId));
            await hubFetch(`/sessions/${sessionId}`, { token: auth.token, base: '/api' }).catch(error => explain(error, scope.spaceId));
            if (!isCurrent()) throw new HubApiError('error', '身份或空间已变化，请重新打开。');
            tab.sessionStorage.setItem('runweft.native.access', auth.token);
            tab.location.replace(`/sessions/${sessionId}${files ? '/files' : ''}`);
        } catch (error) { tab.close(); throw error; }
    }

    return { request, create, openNative };
}
export type SpaceApi = ReturnType<typeof spaceApi>;
