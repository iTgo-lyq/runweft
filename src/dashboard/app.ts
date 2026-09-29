import type { TaskOverview } from '../tasks/query';

type Overview = TaskOverview & { namespace: string };
type Item = Overview['items'][number];
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
export const tokenKey = (origin: string) => `hapi_access_token::${origin}`;
export function hapiLink(origin: string, path = '/') {
    const url = new URL(path, origin); url.searchParams.set('hub', origin); return url.toString();
}
export function consumeUrlToken(location: Pick<Location, 'href'>, history: Pick<History, 'replaceState'>) {
    const url = new URL(location.href), token = url.searchParams.get('token');
    if (url.searchParams.has('token')) { url.searchParams.delete('token'); history.replaceState(null, '', url.pathname + url.search + url.hash); }
    return token;
}
export class LoginRequired extends Error {}
export class DashboardClient {
    private jwt = '';
    private accessToken = '';
    constructor(private origin: string, private storage?: Storage, private fetcher: Fetch = fetch) {}
    remembered() { try { return this.storage?.getItem(tokenKey(this.origin)) ?? ''; } catch { return ''; } }
    async login(token: string, signal?: AbortSignal) {
        const response = await this.fetcher('/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ accessToken: token }), signal });
        if (response.status === 401 || response.status === 403) throw new LoginRequired('访问令牌无效，请重新连接。');
        if (!response.ok) throw new Error(`暂时无法登录（HTTP ${response.status}），请检查 Hub 后重试。`);
        const value = await response.json() as { token?: unknown };
        signal?.throwIfAborted();
        if (typeof value.token !== 'string' || !value.token) throw new Error('Hub 没有返回有效登录，请检查服务版本。');
        this.jwt = value.token; this.accessToken = token;
        try { this.storage?.setItem(tokenKey(this.origin), token); } catch { /* Browser storage may be disabled; this tab can still connect. */ }
    }
    async overview(query: URLSearchParams, signal?: AbortSignal): Promise<Overview> {
        if (!this.jwt) throw new LoginRequired('请先连接当前 Hub。');
        const read = () => this.fetcher(`/api/runweft/tasks/overview?${query}`, { headers: { authorization: `Bearer ${this.jwt}` }, signal, cache: 'no-store' });
        let response = await read();
        if (response.status === 401) { await this.login(this.accessToken, signal); response = await read(); }
        if (response.status === 401 || response.status === 403) throw new LoginRequired('登录已失效，请重新连接。');
        if (!response.ok) throw new Error(`刷新失败（HTTP ${response.status}），请检查 Hub 后重试。`);
        const value = await response.json() as Overview;
        if (!Array.isArray(value.items) || typeof value.namespace !== 'string') throw new Error('Hub 没有返回任务总览，请更新并重启服务。');
        return value;
    }
}

/** Filters supersede older reads; a response that ignores abort still cannot overwrite the current view. */
export class LatestRead {
    private current?: AbortController;
    private generation = 0;
    get busy() { return !!this.current; }
    cancel() { this.current?.abort(); this.current = undefined; this.generation++; }
    async run<T>(action: (signal: AbortSignal) => Promise<T>, success: (value: T) => void, failure: (error: unknown) => void) {
        this.cancel(); const generation = this.generation, controller = new AbortController(); this.current = controller;
        try {
            const value = await action(AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]));
            if (this.generation === generation) success(value);
        } catch (error) { if (this.generation === generation && !controller.signal.aborted) failure(error); }
        finally { if (this.generation === generation) this.current = undefined; }
    }
}

const statuses: Record<string, string> = { running: '进行中', needs_attention: '待处理', completed: '已完成', failed: '失败', interrupted: '已中断', unknown: '未知' };
const phases: Record<string, string> = { queued: '排队中', preparing: '准备工作区', starting: '启动中', resuming: '续接中', running: '执行中', stopping: '停止中', finishing: '收尾中', finished: '已结束', failed: '失败' };
export const phaseText = (value: string) => phases[value] ?? value;
export function executionText(item: Item) { return item.status === 'running' ? phaseText(item.phase) : statuses[item.status] ?? item.status; }
export function stopText(item: Pick<Item, 'stop' | 'execution_not_started'>) {
    return item.execution_not_started ? '已确认未启动' : item.stop === 'stopped' ? '进程已结束' : item.stop === 'stopping' ? '等待进程结束' : '尚未确认进程结束';
}
export function codeText(code: Item['code']) {
    if (code.status === 'pending' && code.sealing_status === 'needs_attention') return '封存待处理';
    if (code.status === 'pending' && code.sealing_status === 'unknown') return '封存未知';
    return ({ not_applicable: '不适用', pending: '待封存', capturing: '捕获中', publishing: '上传中', available: code.ref ? '可审阅' : '可取回',
        needs_attention: '待处理', unknown: '未知', releasing: '释放中', released: '已释放', discarded: '已放弃' } as Record<string, string>)[code.status] ?? code.status;
}
export function filesText(files: Item['files']) {
    if (files.retention !== 'retained') return ({ releasing: '释放中', released: '已释放', discarded: '已放弃' } as Record<string, string>)[files.retention] ?? files.retention;
    return files.status === 'none' ? '未声明' : files.status === 'delivered' ? `已交付 ${files.available} 项`
        : files.status === 'incomplete' ? `待补齐 ${files.available}/${files.count}` : '交付中';
}
const time = (value: number | null) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚未观察';
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string | null, className?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag); if (text != null) node.textContent = text; if (className) node.className = className; return node;
}
function link(label: string, path: string) { const node = el('a', label); node.href = hapiLink(location.origin, path); return node; }
function trackCell(label: string, value: string, tone: string) {
    const node = el('div', undefined, 'track-cell'); node.dataset.tone = tone; node.append(el('span', label, 'label'), el('strong', value)); return node;
}
function taskRow(item: Item, expanded: boolean) {
    const row = el('details', undefined, 'task'); row.dataset.id = item.id; row.open = expanded;
    const summary = el('summary'), identity = el('div', undefined, 'identity'), target = el('div', undefined, 'target');
    identity.append(el('strong', item.agent.name), el('span', item.parent.cwd, 'path'),
        el('span', `${item.parent.host ?? 'CLI'} · ${item.parent.native_session_id ?? item.parent.machine_id}`, 'subline'));
    target.append(el('span', item.machine.name), el('span', `${item.runtime.name} · ${item.runtime.flavor === 'claude' ? 'Claude Code' : 'Codex'}`, 'subline'),
        el('span', `${item.workspace_mode === 'shared' ? '共享目录' : '独立 worktree'} · ${item.machine.online === true ? '在线' : item.machine.online === false ? '离线' : '连接未知'}`, 'subline'));
    const track = el('div', undefined, 'track');
    track.append(trackCell('执行', executionText(item), ['unknown', 'needs_attention', 'failed'].includes(item.status) ? 'warn' : item.status === 'completed' ? 'good' : item.status === 'running' ? 'active' : ''),
        trackCell('代码', codeText(item.code), item.code.error || ['needs_attention', 'unknown'].includes(item.code.status) ? 'warn' : item.code.status === 'available' ? 'good' : ''),
        trackCell('附件', filesText(item.files), item.files.error || item.files.status === 'incomplete' ? 'warn' : item.files.status === 'delivered' && item.files.retention === 'retained' ? 'good' : ''));
    if (item.possibly_stale) target.append(el('span', '状态可能过期', 'stale'));
    summary.append(identity, target, track); row.append(summary);
    const detail = el('div', undefined, 'details'), facts = el('dl');
    for (const [label, value] of [['任务 ID', item.id], ['本轮', `${item.round} · ${phaseText(item.phase)}`], ['执行进程', stopText(item)],
        ['工作目录', item.cwd], ['定义来源', item.agent.scope === 'project' ? '项目' : '全局'], ['Runtime ID', item.runtime.id],
        ['发起机器', item.parent.machine_id], ['更新时间', time(item.updated_at)], ['原生观察', time(item.observed_at)]]) {
        facts.append(el('dt', label), el('dd', value, label?.includes('ID') || label === '工作目录' ? 'mono' : undefined));
    }
    const report = el('div'), section = el('div', undefined, 'detail-section');
    section.append(el('h3', '结果摘要'), el('p', item.summary || '尚无结果摘要。', 'report'));
    if (item.summary_truncated) section.append(el('span', '摘要已截取；完整对话请打开子会话。', 'muted'));
    report.append(section);
    const reasons = [item.attention, item.code.error, item.files.error].filter(Boolean);
    if (reasons.length) {
        const notes = el('div', undefined, 'detail-section'); notes.append(el('h3', '需要关注'));
        for (const reason of reasons) notes.append(el('p', [reason!.message, reason!.hint].filter(Boolean).join('\n'), 'reason'));
        report.append(notes);
    }
    if (item.code.ref || item.code.next) {
        const code = el('div', undefined, 'detail-section'); code.append(el('h3', '代码成果'));
        if (item.code.ref) code.append(el('p', item.code.ref, 'mono'));
        if (item.code.next) code.append(el('p', item.code.next.command, 'mono'));
        report.append(code);
    }
    const links = el('div', undefined, 'detail-links');
    if (item.session_id) links.append(link('打开子会话 ↗', `/sessions/${encodeURIComponent(item.session_id)}`));
    if (item.parent.session_id) links.append(link('打开主会话 ↗', `/sessions/${encodeURIComponent(item.parent.session_id)}`));
    if (!item.session_id && !item.parent.session_id) links.append(el('span', '尚无可打开的 HAPI 会话', 'muted'));
    detail.append(facts, report, links); row.append(detail); return row;
}

export default function bootstrap() {
    const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
    const urlToken = consumeUrlToken(location, history);
    let storage: Storage | undefined; try { storage = localStorage; } catch { /* Private browser settings can disable storage. */ }
    const client = new DashboardClient(location.origin, storage), reads = new LatestRead();
    const list = byId('list'), login = byId('login'), notice = byId('notice'), refresh = byId<HTMLButtonElement>('refresh');
    const loginForm = byId<HTMLFormElement>('login-form'), loginButton = loginForm.querySelector('button')!;
    const tokenInput = byId<HTMLInputElement>('access-token'), workspace = byId<HTMLInputElement>('workspace'), parent = byId<HTMLInputElement>('parent'), status = byId<HTMLSelectElement>('status');
    const previous = byId<HTMLButtonElement>('previous'), next = byId<HTMLButtonElement>('next');
    byId<HTMLAnchorElement>('hapi-link').href = hapiLink(location.origin);
    byId<HTMLAnchorElement>('machines-link').href = hapiLink(location.origin, '/settings/machines');
    let page = 1, connected = false, last: Overview | undefined, signature = '', debounce: ReturnType<typeof setTimeout> | undefined;
    let lastToken = urlToken ?? client.remembered();
    function message(value = '') { notice.textContent = value; notice.hidden = !value; }
    function failed(error: unknown) {
        const detail = error instanceof LoginRequired ? error.message : error instanceof Error && error.name !== 'TypeError' && error.name !== 'TimeoutError'
            ? error.message : '无法连接 Hub，请检查连接后刷新。';
        message(detail + (last ? `\n保留上次成功的数据与筛选结果（${time(last.generated_at)}）。` : ''));
        byId('connection').textContent = '连接需要检查';
        if (error instanceof LoginRequired) { connected = false; login.hidden = false; }
    }
    function render(value: Overview) {
        last = value; connected = true; login.hidden = true;
        byId('connection').textContent = `${value.namespace} · ${location.host}`;
        byId('updated').textContent = `刷新于 ${time(value.generated_at)}`;
        message(value.inventory.available ? '' : value.inventory.error?.message ?? '无法读取机器连接状态。');
        byId('count').textContent = String(value.total);
        byId('page-info').textContent = `第 ${value.page} / ${value.pages} 页 · 共 ${value.total} 项`;
        previous.disabled = value.page <= 1; next.disabled = value.page >= value.pages;
        const updated = JSON.stringify([value.items, value.page, value.namespace, workspace.value, parent.value, status.value]);
        if (updated === signature) return;
        signature = updated;
        const expanded = new Set([...list.querySelectorAll<HTMLDetailsElement>('details[open]')].map(node => node.dataset.id));
        const focused = document.activeElement?.tagName === 'SUMMARY' ? (document.activeElement.parentElement as HTMLElement)?.dataset.id : null;
        if (value.items.length) list.replaceChildren(...value.items.map(item => taskRow(item, expanded.has(item.id))));
        else {
            const filtered = !!(workspace.value || parent.value || status.value || page > 1), empty = el('div', undefined, 'empty');
            empty.append(el('h3', filtered ? '没有匹配的任务' : '还没有协作任务'), el('p', filtered ? '调整筛选条件，或返回第一页查看。' : '从主 agent 委派任务后，各工作区的记录会显示在这里。'));
            list.replaceChildren(empty);
        }
        if (focused) [...list.querySelectorAll<HTMLDetailsElement>('details')].find(node => node.dataset.id === focused)?.querySelector('summary')?.focus();
    }
    function query() {
        const params = new URLSearchParams({ page: String(page), limit: '50' });
        if (workspace.value.trim()) params.set('workspace', workspace.value.trim());
        if (parent.value.trim()) params.set('parent', parent.value.trim());
        if (status.value) params.set('status', status.value);
        return params;
    }
    async function load() {
        if (!connected) { login.hidden = false; return; }
        refresh.textContent = '刷新中…';
        await reads.run(signal => client.overview(query(), signal), render, failed);
        if (!reads.busy) refresh.textContent = '刷新';
    }
    async function connect(token: string) {
        connected = false; lastToken = token; loginButton.disabled = true;
        await reads.run(async signal => { await client.login(token, signal); return client.overview(query(), signal); }, render, failed);
        loginButton.disabled = false;
        if (connected) tokenInput.value = '';
        else login.hidden = false;
    }
    loginForm.addEventListener('submit', event => { event.preventDefault(); void connect(tokenInput.value.trim()); });
    const filter = () => { clearTimeout(debounce); page = 1; void load(); };
    byId<HTMLFormElement>('filters').addEventListener('submit', event => { event.preventDefault(); filter(); });
    for (const input of [workspace, parent]) input.addEventListener('input', () => { reads.cancel(); debounce = setTimeout(filter, 250); });
    status.addEventListener('change', filter);
    refresh.addEventListener('click', () => {
        if (connected) void load();
        else { if (lastToken) void connect(lastToken); else login.hidden = false; }
    });
    previous.addEventListener('click', () => { if (page > 1) { page--; void load(); } });
    next.addEventListener('click', () => { page++; void load(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) reads.cancel(); else if (connected) void load(); });
    setInterval(() => { if (connected && !document.hidden && !reads.busy) void load(); }, 5000);
    if (lastToken) void connect(lastToken); else login.hidden = false;
}
if (typeof document !== 'undefined') bootstrap();
