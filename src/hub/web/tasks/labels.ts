// Wording for task state on the Hub page. "Unknown" never reads as safe to resend.
import type { TaskOverview } from '../../../tasks/query';

type Item = TaskOverview['items'][number];

export const phaseLabels: Record<string, string> = {
    queued: '排队中', preparing: '准备中', starting: '启动中', resuming: '恢复中', running: '执行中',
    stopping: '停止中', finishing: '收尾中', finished: '已结束', failed: '失败',
};
export const flavorLabels: Record<string, string> = { codex: 'Codex', claude: 'Claude Code' };
export const modeLabels: Record<string, string> = { shared: '共享目录', worktree: '独立 worktree' };

export function stopText(item: { stop: string; execution_not_started?: boolean }) {
    if (item.execution_not_started) return '已确认未启动';
    return item.stop === 'stopped' ? '进程已结束' : item.stop === 'stopping' ? '等待进程结束' : '尚未确认进程结束';
}

export function codeText(code: { status: string; sealing_status?: string | null; ref?: string | null }) {
    if (code.status === 'pending' && code.sealing_status === 'needs_attention') return '封存待处理';
    if (code.status === 'pending' && code.sealing_status === 'unknown') return '封存状态未知';
    return ({ not_applicable: '不交付代码', pending: '等待封存', capturing: '正在捕获', publishing: '正在上传', available: code.ref ? '可以审阅' : '可以取回',
        needs_attention: '需要处理', unknown: '状态未知', releasing: '正在释放', released: '已释放', discarded: '已放弃' } as Record<string, string>)[code.status] ?? code.status;
}

export function filesText(files: { status: string; retention: string; available: number; count: number }) {
    if (files.retention !== 'retained') return ({ releasing: '正在释放', released: '已释放', discarded: '已放弃' } as Record<string, string>)[files.retention] ?? files.retention;
    return files.status === 'none' ? '没有声明附件' : files.status === 'delivered' ? `已交付 ${files.available} 项` : files.status === 'incomplete' ? `待补齐 ${files.available}/${files.count}` : '正在交付';
}

/** Where the delegation came from: the host Agent for MCP, otherwise the command line. */
export function parentText(parent: { kind: string; host?: string | null }) {
    return parent.kind === 'mcp' ? flavorLabels[parent.host ?? ''] ?? parent.host ?? 'MCP' : '命令行';
}

/** Text the in-page find matches against: what the row shows plus where the task ran. */
export function searchText(task: Item) {
    return [task.agent.name, task.summary, task.machine.name, task.runtime.name, task.cwd, task.id].filter(Boolean).join(' ').toLowerCase();
}
