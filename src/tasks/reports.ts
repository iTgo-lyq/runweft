import { z } from 'zod';
import type { Round, StructuredReport, TaskBundle } from './types';

const text = z.union([z.string(), z.array(z.string())]).transform(value => Array.isArray(value) ? value.join('\n') : value);
const schema = z.object({ summary: z.string(), changes: text, tests: text, remaining: text });
export function parseReport(raw: string): StructuredReport | undefined {
    const blocks = [...raw.matchAll(/```runweft-report\s*\n([\s\S]*?)\n```/g)];
    for (const block of blocks.reverse()) {
        try { const result = schema.safeParse(JSON.parse(block[1])); if (result.success) return result.data; } catch { /* Raw native output remains available. */ }
    }
    return undefined;
}
export function historyContext(bundle: TaskBundle, before: Round, reason: NonNullable<Round['reconstruction']>['reason'] = 'native_session_missing'): NonNullable<Round['reconstruction']> {
    const rounds = bundle.rounds.filter(round => round.ordinal < before.ordinal).slice(-6);
    const context = [`${reason === 'native_session_missing' ? '原生 session 已确认缺失。' : '启动配置已改变，本轮使用新的原生 session。'}以下是先前任务和报告的业务记录，仅用于理解当前状态；不要重新执行旧工具或任务。`,
        `固定环境：${bundle.task.environment.cwd}；模式 ${bundle.task.environment.mode}。`,
        ...rounds.map(round => `轮次 ${round.id}（${round.phase}）：\n任务：${round.message.slice(0, 1600)}\n`
            + bundle.inputs.filter(input => input.roundId === round.id && input.kind === 'steer').map(input => `追加：${input.text.slice(0, 400)}`).join('\n').slice(0, 800)
            + `\n报告：${round.report.slice(0, 1400)}`),
        '以上为有界历史摘要；完整业务报告按旧轮次 ID 查询。下面才是本轮新任务。'].join('\n\n');
    return { reason, sourceRoundIds: rounds.map(round => round.id), context };
}
