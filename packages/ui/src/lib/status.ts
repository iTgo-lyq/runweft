import type { IconName } from '../icons';

export type Tone = 'ok' | 'warn' | 'danger' | 'unknown' | 'accent' | 'info' | 'neutral' | 'offline' | 'lock';

/** Each tone has an icon so state never depends on colour alone. */
export const toneIcons: Record<Tone, IconName> = {
  info: 'info', accent: 'info', ok: 'st-done', warn: 'st-attention', danger: 'st-failed', unknown: 'st-unknown', neutral: 'info', offline: 'wifi-off', lock: 'lock',
};

export type TaskStatus = 'needs_attention' | 'unknown' | 'running' | 'completed' | 'failed' | 'interrupted';

/** Task status wording. "unknown" means execution is unconfirmed and must never read as retryable. */
export const taskStatus: Record<TaskStatus, { label: string; icon: IconName; tone: Tone }> = {
  needs_attention: { label: '需要处理', icon: 'st-attention', tone: 'warn' },
  unknown: { label: '执行未确认', icon: 'st-unknown', tone: 'unknown' },
  running: { label: '进行中', icon: 'st-running', tone: 'accent' },
  completed: { label: '已完成', icon: 'st-done', tone: 'ok' },
  failed: { label: '失败', icon: 'st-failed', tone: 'danger' },
  interrupted: { label: '已停止', icon: 'st-stopped', tone: 'neutral' },
};
