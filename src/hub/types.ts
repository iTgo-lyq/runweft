import { z } from 'zod';
import { RunweftError } from '../errors';

export const HubName = z.string().trim().min(1).max(80);
export const HubRole = z.enum(['owner', 'admin', 'member']);
export const InvitationToken = z.string().regex(/^rw_inv_[A-Za-z0-9_-]{43}$/);
export type Role = z.infer<typeof HubRole>;
export type Identity = { id: string; name: string; createdAt: number };
export type Space = { id: string; name: string; createdAt: number; role: Role };
export type Member = { userId: string; name: string; role: Role; joinedAt: number };
export type Invitation = { id: string; spaceId: string; createdBy: string; role: 'admin' | 'member'; createdAt: number; expiresAt: number };

export class HubError extends RunweftError {
    constructor(readonly status: number, code: string, message: string, hint?: string) { super(code, message, hint); }
}
export const hubUnauthorized = () => new HubError(401, 'user_session_invalid', '登录已失效，请重新登录。', '使用账号密码登录，或让 Agent 重新发起浏览器连接授权。');
export const hubForbidden = () => new HubError(403, 'space_action_forbidden', '当前空间角色无权执行此操作。');
export const hubNotFound = () => new HubError(404, 'hub_object_not_found', '对象不存在或不属于你可访问的空间。');
export function hubInput<T>(schema: z.ZodType<T>, value: unknown): T {
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new HubError(400, 'invalid_hub_request', '请求参数无效。', '名称为 1–80 个字符；检查角色、token 格式及接口允许的字段。');
    return parsed.data;
}
export function canAssign(actor: Role, role: Role) { return actor === 'owner' || (actor === 'admin' && role === 'member'); }
