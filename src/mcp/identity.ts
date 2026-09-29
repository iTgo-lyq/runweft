import { realpathSync, statSync } from 'node:fs';
import { z } from 'zod';
import type { ResolvedConfig } from '../config';
import { RunweftError } from '../errors';
import { consumeClaudeCall } from './claude-hook';

export const hostClientSchema = z.enum(['codex', 'claude']);
export type HostClient = z.infer<typeof hostClientSchema>;
export type HostIdentity = {
    host: HostClient;
    nativeSessionId: string;
    currentThreadId?: string;
    rootSessionId?: string;
    callId: string;
    cwd: string;
    nativeAgentId?: string;
    hapiSessionId?: string;
};

function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new RunweftError('host_identity_invalid', '宿主调用元数据格式无效。', '更新原生客户端并运行 runweft mcp check。');
    }
    return value as Record<string, unknown>;
}

function identifier(...values: unknown[]): string | undefined {
    const present = values.filter(value => value !== undefined);
    if (present.some(value => typeof value !== 'string' || !value.trim() || value.length > 512)) {
        throw new RunweftError('host_identity_invalid', '宿主调用身份字段无效。');
    }
    if (new Set(present).size > 1) throw new RunweftError('host_identity_conflict', '宿主调用包含相互冲突的身份。');
    return present[0] as string | undefined;
}

export function hostDirectory(directory: string): string {
    try {
        const path = realpathSync(directory);
        if (statSync(path).isDirectory()) return path;
    } catch { /* Report only the path, never tool inputs. */ }
    throw new RunweftError('host_workspace_missing', '宿主工作目录不存在。', '从实际项目目录重新启动原生会话。');
}

export function resolveHostIdentity(client: HostClient, meta: unknown, cwd: string, c: ResolvedConfig): HostIdentity {
    if (meta === undefined) throw new RunweftError('host_identity_missing', '工具调用缺少原生宿主身份。', '请从 Codex 或 Claude Code 调用 Runweft 工具。');
    const top = object(meta);
    const hapiSessionId = identifier(c.env.HAPI_SESSION_ID);
    if (client === 'claude') {
        const callId = identifier(top['claudecode/toolUseId']);
        if (!callId) throw new RunweftError('host_identity_missing', 'Claude 调用缺少 toolUseId。', '更新 Claude Code 并检查 MCP 安装。');
        const call = consumeClaudeCall(c, callId);
        return { host: client, nativeSessionId: call.sessionId, callId, cwd: hostDirectory(call.cwd),
            nativeAgentId: call.agentId ?? undefined, hapiSessionId };
    }
    let nested = top['x-codex-turn-metadata'];
    if (typeof nested === 'string') {
        try { nested = JSON.parse(nested); }
        catch { throw new RunweftError('host_identity_invalid', 'Codex 调用元数据不是有效 JSON。'); }
    }
    const turn = nested === undefined ? {} : object(nested);
    const currentThreadId = identifier(top.threadId, turn.thread_id);
    const rootSessionId = identifier(top.sessionId, turn.session_id);
    const callId = identifier(top.callId, turn.call_id);
    if (!currentThreadId || !callId) {
        throw new RunweftError('host_identity_missing', 'Codex 调用缺少当前 threadId 或 callId。', '更新 Codex 并运行 runweft mcp check。');
    }
    return { host: client, nativeSessionId: currentThreadId, currentThreadId, rootSessionId,
        callId, cwd: hostDirectory(cwd), hapiSessionId };
}
