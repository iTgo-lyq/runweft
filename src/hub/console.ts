import { renderResources } from './resources-page.js';
import { renderAgents } from './agents-page.js';
import { renderRepositories } from './repositories-page.js';
import { renderSelections } from './selections-page.js';

export default '';
export type ConsoleContext = {
    userId: string; spaceId: string; members: { userId: string; name: string }[]; spaces: { id: string; name: string }[];
    request(path: string, body?: unknown, method?: string, global?: boolean): Promise<any>;
    action(operation: () => Promise<void>): Promise<void>;
    confirm(message: string): Promise<boolean>;
    notice(message: string, error?: boolean): void;
};
export const element = <Tag extends keyof HTMLElementTagNameMap>(tag: Tag, value = '', className = '') => {
    const node = document.createElement(tag); node.textContent = value; node.className = className; return node;
};
export function control(label: string, operation: () => Promise<void>, context: ConsoleContext, className = 'secondary') {
    const node = element('button', label, className); node.type = 'button';
    node.addEventListener('click', () => { void context.action(operation); }); return node;
}
export function field(label: string, value = '', options: { required?: boolean; multiline?: boolean; max?: number } = {}) {
    const node = element('label', label);
    const input = options.multiline ? element('textarea') : element('input');
    input.value = value; input.required = options.required ?? false;
    if (options.max) input.maxLength = options.max;
    node.append(input); return { node, input };
}
export function selectField(label: string, choices: { value: string; label: string }[], value = '') {
    const node = element('label', label), input = element('select');
    input.setAttribute('aria-label', label);
    choices.forEach(choice => input.add(new Option(choice.label, choice.value)));
    input.value = value; node.append(input); return { node, input };
}
export function submitForm(label: string, fields: HTMLElement[], operation: () => Promise<void>, context: ConsoleContext) {
    const form = element('form', '', 'resource-form'), submit = element('button', label);
    submit.type = 'submit'; form.append(...fields, submit);
    form.addEventListener('submit', event => { event.preventDefault(); void context.action(operation); }); return form;
}
export function expandable(title: string, ...children: HTMLElement[]) {
    const details = element('details'); details.append(element('summary', title), ...children); return details;
}
export function fact(label: string, value: unknown) {
    const node = element('div', '', 'fact'); node.append(element('dt', label), element('dd', String(value ?? '—'))); return node;
}
export const ownerName = (context: ConsoleContext, ownerId: string) =>
    ownerId === context.userId ? '你' : context.members.find(member => member.userId === ownerId)?.name ?? `已离开或未加入此空间 · ${ownerId}`;
export function resourceCard(name: string, id: string, ownerId: string, context: ConsoleContext) {
    const card = element('article', '', 'resource-card'); card.dataset.resourceId = id;
    card.append(element('h3', name), element('code', id), element('p', `所属人：${ownerName(context, ownerId)}`, 'muted'));
    return card;
}
export function empty(message: string) { return element('p', message, 'empty-state'); }

export async function createResource(context: ConsoleContext, path: string, payload: unknown) {
    const key = `runweft.create:${context.userId}:${context.spaceId}:${path}`;
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)));
    const fingerprint = Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');
    const saved = sessionStorage.getItem(key);
    const pending: { requestId: string; fingerprint: string } = saved ? JSON.parse(saved) : { requestId: crypto.randomUUID(), fingerprint };
    const receipt = () => context.request(`${path}/requests/${pending.requestId}`);
    if (saved) {
        try { const result = await receipt(); sessionStorage.removeItem(key); return result; }
        catch (error) {
            if (!(error && typeof error === 'object' && 'status' in error && error.status === 404)) throw error;
            if (pending.fingerprint !== fingerprint) {
                if (await context.confirm(`Hub 未找到上次创建请求 ${pending.requestId}。表单已改变；放弃本地待确认记录？放弃不会删除 Hub 上的资源，请先刷新核对。`)) sessionStorage.removeItem(key);
                throw new Error('请核对资源列表后重新提交。未自动创建新资源。');
            }
            if (!await context.confirm(`Hub 未找到请求 ${pending.requestId}。使用同一请求 ID 与相同参数重试？`)) throw new Error('创建尚未确认；已保留原请求 ID。');
        }
    }
    sessionStorage.setItem(key, JSON.stringify(pending));
    try {
        const result = await context.request(path, { ...payload as object, requestId: pending.requestId });
        sessionStorage.removeItem(key); return result;
    } catch (error) {
        if (error && typeof error === 'object' && 'status' in error && typeof error.status === 'number'
            && error.status >= 400 && error.status < 500 && error.status !== 408) sessionStorage.removeItem(key);
        else {
            try { const result = await receipt(); sessionStorage.removeItem(key); return result; }
            catch { context.notice(`创建结果未确认，已保留请求 ${pending.requestId}。再次提交时先查询原回执，不会自动新建。`, true); }
        }
        throw error;
    }
}

let generation = 0;
let active = 'machines';
export function clearConsole() {
    generation++;
    document.getElementById('console-content')?.replaceChildren();
    document.getElementById('console-navigation')?.replaceChildren();
}
export async function mountConsole(context: ConsoleContext) {
    const epoch = ++generation;
    const content = document.getElementById('console-content')!, navigation = document.getElementById('console-navigation')!;
    const members = document.getElementById('members-panel')!;
    const modes = [{ id: 'machines', label: '机器' }, { id: 'runtimes', label: 'Runtime' }, { id: 'agents', label: 'Agent' },
        { id: 'repositories', label: '仓库' }, { id: 'selections', label: '我的选择' }, { id: 'members', label: '成员' }];
    async function render() {
        if (epoch !== generation) return;
        content.replaceChildren(); members.hidden = active !== 'members'; content.hidden = active === 'members';
        navigation.querySelectorAll('button').forEach(button => button.setAttribute('aria-current', button.dataset.view === active ? 'page' : 'false'));
        if (active === 'members') return;
        content.append(element('p', '正在读取当前权限与资源…', 'muted'));
        const target = element('div');
        try {
            if (active === 'agents') await renderAgents(target, context, render);
            else if (active === 'repositories') await renderRepositories(target, context, render);
            else if (active === 'selections') await renderSelections(target, context, render);
            else await renderResources(target, context, active === 'runtimes' ? 'runtimes' : 'machines', render);
            if (epoch === generation) content.replaceChildren(target);
        } catch (error) {
            if (epoch !== generation) return;
            content.replaceChildren(empty('资源未能加载。检查 Hub 连接后刷新；不会切换身份或本地配置。'));
            throw error;
        }
    }
    navigation.replaceChildren(...modes.map(mode => {
        const button = control(mode.label, async () => { active = mode.id; await render(); }, context);
        button.dataset.view = mode.id; return button;
    }));
    const guide = document.getElementById('agent-onboarding')!;
    guide.textContent = `请按 Runweft 产品 Skill 帮我接入 ${location.origin}。先检查已有安装和此 Hub 的连接；没有身份时发起 hub connect begin，让我在 Web 领取或导入 token 并确认，随后 complete。不要让我把凭据发到对话。分别登记机器、Runtime 和 Agent，保留其他 MCP 与原生配置，完成首次委派后返回 Hub 页面。`;
    await render();
}
