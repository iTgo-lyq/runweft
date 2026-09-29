import { createHash } from 'node:crypto';
import type { z } from 'zod';
import type { HostIdentity } from './identity';
import type { McpCallContext, McpTool } from './server';

// Retransmitting one native call preserves its request identity; a new call is new intent.
export function taskRequestId(identity: HostIdentity, operation: string): string {
    const bytes = createHash('sha256').update(JSON.stringify(['runweft', identity.host, identity.nativeSessionId, identity.callId, operation])).digest().subarray(0, 16);
    bytes[6] = (bytes[6]! & 0x0f) | 0x80; bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function tool<S extends z.ZodObject>(name: string, description: string, input: S, readOnly: boolean,
    run: (args: z.output<S>, context: McpCallContext) => Promise<Record<string, unknown>>, timeoutMs: number | null = 60_000): McpTool {
    return { name, description, input, timeoutMs: timeoutMs ?? undefined,
        annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, openWorldHint: true },
        // createMcpServer validates this exact schema before invoking the handler.
        run: (args, context) => run(args as z.output<S>, context) };
}
