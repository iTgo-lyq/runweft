import { Database } from 'bun:sqlite';
import { chmodSync, existsSync } from 'node:fs';
import { z } from 'zod';
import { dataPaths, ensureDirectory, type ResolvedConfig } from '../config';
import { RunweftError } from '../errors';

const id = z.string().min(1).max(512);
const hookSchema = z.object({
    hook_event_name: z.literal('PreToolUse'),
    tool_name: z.string().regex(/^mcp__runweft__.+$/),
    tool_use_id: id, session_id: id, cwd: z.string().min(1), agent_id: id.optional(),
});
export const CLAUDE_CALL_TTL_MS = 24 * 60 * 60 * 1000;
type ClaudeCall = { callId: string; sessionId: string; cwd: string; agentId: string | null; createdAt: number };

function store(c: ResolvedConfig, now: number) {
    ensureDirectory(c.home);
    const path = dataPaths(c).clientState;
    const db = new Database(path, { create: true });
    chmodSync(path, 0o600);
    db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    db.exec('CREATE TABLE IF NOT EXISTS claude_mcp_calls (callId TEXT PRIMARY KEY, sessionId TEXT NOT NULL, cwd TEXT NOT NULL, agentId TEXT, createdAt INTEGER NOT NULL)');
    db.query('DELETE FROM claude_mcp_calls WHERE createdAt < ?').run(now - CLAUDE_CALL_TTL_MS);
    return db;
}

/** Only these identity fields are persisted; tool input and transcript never enter the store. */
export function recordClaudeCall(c: ResolvedConfig, input: unknown, now = Date.now()): void {
    const parsed = hookSchema.safeParse(input);
    if (!parsed.success) throw new RunweftError('claude_hook_invalid', 'Claude PreToolUse 身份事件无效。', '运行 runweft mcp install --client claude 更新 hook。');
    const event = parsed.data;
    const db = store(c, now);
    try {
        db.transaction(() => {
            const existing = db.query('SELECT * FROM claude_mcp_calls WHERE callId = ?').get(event.tool_use_id) as ClaudeCall | null;
            if (existing && (existing.sessionId !== event.session_id || existing.cwd !== event.cwd || existing.agentId !== (event.agent_id ?? null))) {
                throw new RunweftError('host_identity_conflict', '相同 toolUseId 已关联另一个 Claude 调用。');
            }
            db.query('INSERT OR IGNORE INTO claude_mcp_calls VALUES (?, ?, ?, ?, ?)')
                .run(event.tool_use_id, event.session_id, event.cwd, event.agent_id ?? null, now);
        })();
    } finally { db.close(); }
}

export function consumeClaudeCall(c: ResolvedConfig, callId: string, now = Date.now()): ClaudeCall {
    const missing = () => new RunweftError('claude_hook_missing', '未找到本次 Claude 调用对应的 hook 身份。', '运行 runweft mcp install --client claude，并重新发起调用；已消费或超过 24 小时的记录不可复用。');
    if (!existsSync(dataPaths(c).clientState)) throw missing();
    const db = store(c, now);
    try {
        const call = db.query('DELETE FROM claude_mcp_calls WHERE callId = ? RETURNING *').get(callId) as ClaudeCall | null;
        if (!call) throw missing();
        return call;
    } finally { db.close(); }
}
