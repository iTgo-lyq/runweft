import type { AgentView } from './agents/types';
import type { PersonalSelection } from './agents/selections';
import type { ResolvedHubAgent } from './agents/resolver';
import type { Repository } from './repositories/store';
import type { RuntimeView } from './resources/types';
import { repositoryChoices, runtimeChoices } from './agents-page.js';
import { control, element, empty, expandable, fact, selectField, submitForm, type ConsoleContext } from './console.js';

export default '';
export async function renderSelections(target: HTMLElement, context: ConsoleContext, refresh: () => Promise<void>) {
    const [{ agents }, { repositories }, { runtimes }, { selections }]:
        [{ agents: AgentView[] }, { repositories: Repository[] }, { runtimes: RuntimeView[] }, { selections: PersonalSelection[] }] =
        await Promise.all([context.request('/agents'), context.request('/repositories'), context.request('/resources/runtimes'), context.request('/agent-selections')]);
    target.append(element('h3', '我的选择 · 不改变别人的配置'), element('p', '显式参数 → 我的仓库选择 → 我的空间选择。决定层失效时清楚报错，不静默回退。Runtime override 只适用于同一个已选 Agent，不会跨 Agent 借用。', 'muted'));
    const scopes = repositoryChoices(repositories);
    for (const selection of selections) if (selection.repositoryId && !scopes.some(item => item.value === selection.repositoryId)) {
        scopes.push({ value: selection.repositoryId, label: (repositories.find(item => item.id === selection.repositoryId)?.name ?? selection.repositoryId) + ' · 已失效' });
    }
    const repository = selectField('选择作用范围', scopes);
    const agent = selectField('选择 Agent', []);
    const runtime = selectField('个人 Runtime override', runtimeChoices(runtimes));
    const updateForm = () => {
        const scope = repository.input.value || null, saved = selections.find(item => item.repositoryId === scope);
        const eligible = agents.filter(item => item.permissions.invoke && (item.repositoryId === null || item.repositoryId === scope));
        agent.input.replaceChildren(new Option('请选择 Agent', ''), ...eligible.map(item => new Option(`${item.name} · v${item.version}`, item.id)));
        if (saved && !eligible.some(item => item.id === saved.agentId)) agent.input.add(new Option(`已保存但当前不可调用 · ${saved.agentId}`, saved.agentId));
        agent.input.value = saved?.agentId ?? '';
        runtime.input.replaceChildren(...runtimeChoices(runtimes, saved?.runtimeId).map(item => new Option(item.label, item.value)));
        runtime.input.value = saved?.runtimeId ?? '';
    };
    repository.input.addEventListener('change', updateForm); agent.input.required = true; updateForm();
    target.append(submitForm('保存我的选择', [repository.node, agent.node, runtime.node], async () => {
        await context.request('/agent-selections', { repositoryId: repository.input.value || null, agentId: agent.input.value, runtimeId: runtime.input.value || null }, 'PUT');
        await refresh(); context.notice('已保存你的选择；其他成员不受影响。保存配置不代表模型执行已验证。');
    }, context));
    const list = element('div', '', 'resource-list');
    for (const selection of selections) {
        const card = element('article', '', 'resource-card'); card.dataset.selectionScope = selection.repositoryId ?? 'space';
        const selectedAgent = agents.find(item => item.id === selection.agentId);
        const selectedRuntime = runtimes.find(item => item.id === selection.runtimeId);
        card.append(element('h3', selection.repositoryId ? repositories.find(item => item.id === selection.repositoryId)?.name ?? selection.repositoryId : '整个空间'));
        card.append(element('p', `${selectedAgent?.name ?? selection.agentId} → ${selection.runtimeId ? selectedRuntime?.name ?? selection.runtimeId : 'Agent 定义中的 Runtime'}`, 'relation'));
        card.append(element('p', '有效性以当前解析为准。取消登记、撤回分享、离线或停用不会自动清除这条选择。', 'hint'));
        card.append(control('清除这条选择', async () => {
            if (!await context.confirm('清除后将按剩余的选择层解析，不会修改 Agent 或 Runtime。继续？')) return;
            await context.request('/agent-selections', { repositoryId: selection.repositoryId }, 'DELETE'); await refresh(); context.notice('个人选择已清除。');
        }, context)); list.append(card);
    }
    target.append(list);
    if (!selections.length) target.append(empty('尚未保存个人选择。可以显式指定 Agent 委派，或在上方保存空间/仓库默认值。'));
    const previewScope = selectField('解析仓库', scopes);
    const previewAgent = selectField('显式 Agent（可选）', [{ value: '', label: '使用我的选择' }, ...agents.filter(item => item.permissions.invoke)
        .map(item => ({ value: item.id, label: `${item.name} · v${item.version}` }))]);
    const previewRuntime = selectField('显式 Runtime（可选）', runtimeChoices(runtimes));
    const result = element('div', '', 'resolution-result'); result.setAttribute('role', 'status');
    const form = submitForm('解析当前配置', [previewScope.node, previewAgent.node, previewRuntime.node], async () => {
        result.replaceChildren();
        const resolution: ResolvedHubAgent = (await context.request('/agent-resolution', { hubRepositoryId: previewScope.input.value || null,
            ...(previewAgent.input.value ? { agentId: previewAgent.input.value } : {}), ...(previewRuntime.input.value ? { runtimeId: previewRuntime.input.value } : {}) })).resolution;
        const facts = element('dl', '', 'facts');
        facts.append(fact('Agent', `${resolution.definition.name} · v${resolution.version}`), fact('Agent 来源', resolution.selection.agent),
            fact('Runtime 来源', resolution.selection.runtime), fact('执行机器', resolution.target.machineId), fact('原生类型', resolution.target.flavor),
            fact('配置指纹', resolution.resolvedVersion));
        result.append(facts, element('p', '工具目标解析成功；模型认证、参数兼容和真实执行仍未检查。', 'hint'),
            expandable('解析详情', element('pre', JSON.stringify(resolution, null, 2), 'inspection-output')));
    }, context);
    target.append(expandable('验证我的选择', form, result));
}
