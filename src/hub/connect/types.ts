import { z } from 'zod';
import { isIP } from 'node:net';
import { hubOrigin } from '../../config';
import { HubError, HubName } from '../types';

export const connectionOrigin = hubOrigin.refine(value => {
    const url = new URL(value);
    return url.protocol === 'https:' || url.hostname === 'localhost' || url.hostname === '[::1]' || (isIP(url.hostname) === 4 && url.hostname.startsWith('127.'));
}, '凭据交接只支持 HTTPS 或 localhost；远端请启用 HTTPS 或通过 SSH 隧道连接 localhost');
export const PollingSecret = z.string().regex(/^rw_cli_[A-Za-z0-9_-]{43}$/);
export const BeginConnection = z.object({ requestId: z.uuid(), origin: connectionOrigin, label: HubName,
    tokenDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const ConfirmConnection = z.object({ spaceId: z.uuid() }).strict();
export type ConnectionRequest = { id: string; origin: string; label: string; code: string; createdAt: number; expiresAt: number;
    status: 'pending' | 'confirmed' | 'cancelled' };
export function connectionInput<T>(schema: z.ZodType<T>, value: unknown): T {
    const result = schema.safeParse(value);
    if (!result.success) throw new HubError(400, 'connection_request_invalid', '连接请求无效。', '检查请求 ID、HTTPS/localhost 地址和允许字段，重新使用 hub connect begin。');
    return result.data;
}
