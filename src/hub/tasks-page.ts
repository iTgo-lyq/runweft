import type { TaskOverview } from '../tasks/query';
import type { detail } from '../tasks/views';
import { control, element, empty, expandable, fact, field, selectField, submitForm, type ConsoleContext } from './console.js';

export default '';
type TaskDetail = NonNullable<ReturnType<typeof detail>> & { ownerId: string; spaceId: string; hubRepositoryId: string | null;
    actions: { read: boolean; native: boolean; manageViaAgent: boolean } };
const statusLabels = { running: '进行中', needs_attention: '需要处理', unknown: '执行未确认', completed: '已完成', failed: '失败', interrupted: '已停止' };
function jsonDetails(title: string, value: unknown) { return expandable(title, element('pre', JSON.stringify(value, null, 2), 'inspection-output')); }
export async function renderTasks(target: HTMLElement, context: ConsoleContext) {
    let page = 1, chosen: string | undefined, roundId: string | undefined, offset = 0;
    const workspace = field('来源工作目录筛选'), parent = field('主宿主筛选');
    const status = selectField('任务状态', [{ value: '', label: '全部状态' }, ...Object.entries(statusLabels).map(([value, label]) => ({ value, label }))]);
    const limit = selectField('每页任务数', [10, 25, 50, 100].map(value => ({ value: String(value), label: String(value) })), '25');
    const list = element('div', '', 'task-list'), details = element('section', '', 'task-detail'); details.tabIndex = -1;
    target.append(element('h3', '任务 · 只看你的执行'), element('p', '计数与内容仅来自你在当前空间的任务。共享 Agent 不分享任务；未知状态不表示可以重发。刷新查看最新观察。', 'muted'));
    target.append(submitForm('应用筛选', [workspace.node, parent.node, status.node, limit.node], async () => {
        page = 1; chosen = undefined; details.replaceChildren(); await load();
    }, context), list, details);
    async function show() {
        if (!chosen) return;
        const query = new URLSearchParams({ offset: String(offset), limit: '16000' });
        if (roundId) query.set('roundId', roundId);
        const view: TaskDetail = await context.request(`/tasks/details/${chosen}?${query}`);
        const content = element('div');
        content.append(element('h3', `${view.agent.definition.name ?? view.agent_id} · 第 ${view.round} 轮`), element('code', view.agent_id));
        const navigation = element('div', '', 'actions');
        navigation.append(control('返回任务列表', async () => { chosen = undefined; details.replaceChildren(); list.hidden = false; list.scrollIntoView({ block: 'start' }); }, context),
            control('刷新任务详情', show, context));
        content.append(navigation);
        const rounds = selectField('查看轮次', view.rounds.map(item => ({ value: item.id, label: `第 ${item.ordinal} 轮 · ${item.phase}` })), view.round_id);
        rounds.input.addEventListener('change', () => { void context.action(async () => { roundId = rounds.input.value; offset = 0; await show(); }); });
        content.append(rounds.node);
        const facts = element('dl', '', 'facts');
        facts.append(fact('状态', statusLabels[view.status]), fact('阶段 / 进程停止', `${view.phase} / ${view.stop}`),
            fact('工作区', `${view.workspace_mode} · ${view.cwd}`), fact('机器 / Runtime', `${view.machine_id} / ${view.runtime_id}`),
            fact('配置版本', view.agent.hub ? `v${view.agent.hub.version} · ${view.agent.hub.contentHash}` : view.agent.definitionVersion),
            fact('最后观察', view.observed_at ? new Date(view.observed_at).toLocaleString('zh-CN') : '未观察'));
        content.append(facts);
        if (view.attention) content.append(element('p', `${view.attention.code} · ${view.attention.message} ${view.attention.hint ?? ''}`, 'attention'));
        if (view.report.incomplete) content.append(element('p', '报告可能不完整：停止已确认，但部分原生终态仍未观察。', 'attention'));
        const native = element('div', '', 'actions');
        if (view.actions.native && view.session_id) {
            native.append(control('打开原生详情 / 审批', () => context.openNative(view.session_id!), context),
                control('打开原生文件', () => context.openNative(view.session_id!, true), context));
            content.append(native, element('p', '新标签页使用当前身份与空间的限时凭据，不会取得机器 shell；输入与恢复仍受委派控制。过期后回到 Hub 重新打开。', 'hint'));
        }
        content.append(element('h4', '轮次报告'), element('pre', view.report.text || '尚无最终报告；这不表示任务未执行。', 'task-report'));
        if (view.report.structured) content.append(jsonDetails('结构化报告', view.report.structured));
        const pages = element('div', '', 'actions');
        pages.append(element('span', `${view.report.offset}–${view.report.offset + view.report.text.length} / ${view.report.total} 字符`));
        if (offset) pages.append(control('上一段报告', async () => { offset = Math.max(0, offset - 16000); await show(); }, context));
        if (view.report.next_offset !== null) pages.append(control('下一段报告', async () => { offset = view.report.next_offset!; await show(); }, context));
        content.append(pages, jsonDetails('本轮 Agent 配置快照', view.agent), jsonDetails('主宿主与工作环境', { parent: view.parent, environment: view.environment, preparation: view.preparation }),
            jsonDetails('附件与代码交付', { input: view.input_files, delivery: view.delivery }),
            jsonDetails('执行观察与恢复', { native: view.native_status, stop: view.stop, finish: view.finish, permissions: view.permissions,
                cancellation: view.cancellation, resume: view.resume, reconstruction: view.reconstruction }));
        if (view.actions.manageViaAgent) content.append(expandable('让 Agent 继续处理此任务', element('pre',
            `请在 ${location.origin} 的空间 ${context.spaceId} 检查任务 ${view.agent_id}，先运行 task show 核对第 ${view.round} 轮（${view.round_id}）的状态，再按我的要求续接、停止或取回成果。执行未知时不要盲目重发；取回 bundle 后由主 Agent 审查合入，不自动 push。显式清理前说明删除范围。`, 'task-report')));
        details.replaceChildren(content); list.hidden = true;
    }
    async function load() {
        const query = new URLSearchParams({ page: String(page), limit: limit.input.value, workspace: workspace.input.value, parent: parent.input.value });
        if (status.input.value) query.set('status', status.input.value);
        const view: TaskOverview = await context.request('/tasks/overview?' + query);
        const content = element('div');
        const heading = element('div', '', 'actions');
        heading.append(element('span', `你的任务 ${view.total} 个 · 第 ${view.page} / ${view.pages} 页`),
            control('刷新任务列表', load, context));
        content.append(heading);
        if (!view.inventory.available) content.append(element('p', view.inventory.error?.message ?? '机器状态暂不可用，以下是任务记录。', 'attention'));
        for (const task of view.items) {
            const card = element('article', '', 'resource-card'); card.dataset.taskId = task.id;
            card.append(element('h3', task.agent.name ?? task.id), element('code', task.id),
                element('p', `${task.machine.name} → ${task.runtime.name} → 第 ${task.round} 轮`, 'relation'),
                element('p', `${statusLabels[task.status]} · ${task.workspace_mode} · ${task.cwd}`),
                element('p', `来源：${task.parent.host ?? task.parent.kind} · ${task.parent.cwd}`, 'hint'));
            if (task.attention) card.append(element('p', task.attention.message ?? task.attention.code ?? '需要处理', 'attention'));
            if (task.possibly_stale) card.append(element('p', '机器离线或未观察，当前记录可能滞后。', 'hint'));
            card.append(element('p', task.summary || '尚无最终报告', 'task-summary'),
                element('p', `附件 ${task.files.available}/${task.files.count} · 代码 ${task.code.status}`, 'hint'),
                control('查看任务详情', async () => { chosen = task.id; roundId = task.round_id; offset = 0; await show(); details.focus(); }, context));
            content.append(card);
        }
        if (!view.items.length) content.append(empty(view.total ? '此页没有任务，请返回前一页。' : '没有匹配的本人任务。通过 Agent 发起首次委派，或调整筛选条件。'));
        const navigation = element('div', '', 'actions');
        if (page > 1) navigation.append(control('上一页任务', async () => { page--; await load(); }, context));
        if (page < view.pages) navigation.append(control('下一页任务', async () => { page++; await load(); }, context));
        content.append(navigation); list.replaceChildren(content); list.hidden = false;
    }
    await load();
}
