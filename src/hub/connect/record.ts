import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { hubOrigin } from '../../config';
import { RunweftError } from '../../errors';
import { PollingSecret } from './types';

import { hubConnectionPaths } from '../resources/connection';

export const IdentityConnectionSchema = z.object({ schemaVersion: z.literal(2), hub: hubOrigin, ownerId: z.uuid(),
    spaceId: z.uuid(), token: PollingSecret, requestId: z.uuid(), createdAt: z.number().int() }).strict();
export type IdentityConnectionRecord = z.infer<typeof IdentityConnectionSchema>;
export function readIdentityConnection(home: string, url: string): IdentityConnectionRecord | undefined {
    const paths = hubConnectionPaths(home, url);
    if (!existsSync(paths.identityConnection)) return;
    try {
        const parsed = IdentityConnectionSchema.parse(JSON.parse(readFileSync(paths.identityConnection, 'utf8')));
        if (parsed.hub !== paths.hub) throw new Error();
        return parsed;
    } catch { throw new RunweftError('hub_connection_invalid', '身份连接记录无效，未修改原文件。', '检查 hub paths 显示的 identity.json；不会把身份 token 发送到另一个 Hub。'); }
}
