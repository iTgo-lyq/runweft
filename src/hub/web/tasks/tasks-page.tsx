import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
    Banner, Button, Chain, Chips, Disclosure, EmptyState, Facts, Find, Form, Icon, Loading, Menu, MenuItem, Mono, PageHead, PanelHead, PanelInner,
    Pager, Popover, Row, RowList, Section, SelectField, SplitView, Tabs, Tag, TaskStatusBadge, TextField, Weft, fullTime, relativeTime, taskStatus, useSplit,
    type ChoiceOption, type TaskStatus,
} from '@runweft/ui';
import type { TaskOverview } from '../../../tasks/query';
import type { detail } from '../../../tasks/views';
import { HubApiError } from '../api/http';
import { patchHash, readHash } from '../route';
import { useResource, useWorkspace } from '../workspace/context';
import { CopyButton } from '../workspace/shell';
import { codeText, filesText, flavorLabels, modeLabels, parentText, phaseLabels, searchText, stopText } from './labels';

type Item = TaskOverview['items'][number];
type Detail = NonNullable<ReturnType<typeof detail>> & {
    ownerId: string; spaceId: string; hubRepositoryId: string | null; actions: { read: boolean; native: boolean; manageViaAgent: boolean };
};
type Filters = { status: '' | TaskStatus; workspace: string; parent: string; limit: number };
type Target = { id: string; roundId?: string; offset: number };
type Tab = 'report' | 'delivery' | 'details' | 'continue';

const defaults: Filters = { status: '', workspace: '', parent: '', limit: 50 };
const statusOptions: ChoiceOption<'' | TaskStatus>[] = [{ value: '', label: '全部' },
    ...(['needs_attention', 'unknown', 'running', 'completed', 'failed', 'interrupted'] as TaskStatus[]).map(value => ({ value, label: taskStatus[value].label }))];
const tabs: { id: Tab; label: string }[] = [{ id: 'report', label: '报告' }, { id: 'delivery', label: '交付' }, { id: 'details', label: '详情' }, { id: 'continue', label: '继续处理' }];
const reportPage = 16_000;
const numbers = new Intl.NumberFormat('zh-CN');

export function TasksPage() {
    const ws = useWorkspace();
    const link = useMemo(() => readHash(), []);
    const [filters, setFilters] = useState(defaults);
    const [page, setPage] = useState(1);
    const [find, setFind] = useState('');
    const [target, setTarget] = useState<Target | null>(link.task ? { id: link.task, roundId: link.round, offset: 0 } : null);
    const [tab, setTab] = useState<Tab>('report');
    const split = useSplit<string>(link.task ?? null);

    const query = useMemo(() => {
        const value = new URLSearchParams({ page: String(page), limit: String(filters.limit), workspace: filters.workspace, parent: filters.parent });
        if (filters.status) value.set('status', filters.status);
        return value.toString();
    }, [filters, page]);
    const overview = useResource(() => ws.spaceApi.request<TaskOverview>(`/tasks/overview?${query}`), [ws.spaceApi, query]);
    const inspected = useResource<Detail | null>(() => {
        if (!target) return Promise.resolve(null);
        const params = new URLSearchParams({ offset: String(target.offset), limit: String(reportPage) });
        if (target.roundId) params.set('roundId', target.roundId);
        return ws.spaceApi.request<Detail>(`/tasks/details/${encodeURIComponent(target.id)}?${params}`);
    }, [ws.spaceApi, target?.id, target?.roundId, target?.offset]);

    // A link opens its task once; closing the inspector removes the task and round from the address.
    useEffect(() => { if (link.task) split.open(link.task); }, [link.task, split.open]);
    useEffect(() => { if (split.key === null && target) { setTarget(null); patchHash({ task: null, round: null }); } }, [split.key, target]);

    const openTask = (id: string, from: HTMLElement) => {
        setTarget({ id, offset: 0 }); setTab('report');
        split.open(id, { from });
        patchHash({ task: id, round: null });
    };
    const reload = (next: Partial<Filters>) => {
        setFilters(current => ({ ...current, ...next })); setPage(1);
        split.close({ restore: false });
    };

    const view = overview.data;
    const filtered = !!(filters.status || filters.workspace || filters.parent);
    const term = find.trim().toLowerCase();
    const shown = view ? view.items.filter(task => !term || searchText(task).includes(term)) : [];
    const known = new Map(view?.items.map(task => [task.id, task]));

    let list: ReactNode;
    if (!view) list = overview.error ? <EmptyState icon="wifi-off" tone="offline" title="无法读取任务" actions={<Button icon="refresh" variant="primary" onClick={overview.reload}>重试</Button>}>
        {[overview.error.message, overview.error.hint].filter(Boolean).join('。')}</EmptyState> : <Loading />;
    else if (!view.total && !filtered) list = <EmptyState icon="tasks" title="还没有任务" actions={<Button icon="link" onClick={() => ws.showOnboarding()}>查看接入说明</Button>}>
        在 Codex 或 Claude Code 里让 Agent 委派任务，开始后会出现在这里。</EmptyState>;
    else if (!view.total) list = <EmptyState icon="filter" title="没有符合条件的任务" actions={<Button onClick={() => reload(defaults)}>清除筛选</Button>}>调整筛选条件，或清除筛选查看全部任务。</EmptyState>;
    else if (!view.items.length) list = <EmptyState icon="tasks" title="这一页没有任务" actions={<Button onClick={() => setPage(1)}>回到第一页</Button>}>任务可能已经变化，回到第一页查看。</EmptyState>;
    else list = (
        <>
            <div className="list-meta"><span>{filtered ? '符合条件的任务' : '你的任务'} {view.total} 个</span><span className="list-meta-hint">需要你处理的排在最前</span></div>
            {term && <p className="list-note">“{find.trim()}”在这一页的 {view.items.length} 个任务中找到 {shown.length} 个。查找只覆盖当前这一页。</p>}
            <RowList label="任务列表">
                {shown.map(task => <TaskRow key={task.id} task={task} opened={split.key === task.id} onOpen={from => openTask(task.id, from)} />)}
            </RowList>
            {term && !shown.length && <EmptyState icon="search" title={`这一页没有包含“${find.trim()}”的任务`}>查找只覆盖当前这一页。可以翻页，或用“筛选”按工作目录和主宿主查询全部任务。</EmptyState>}
            {view.pages > 1 && <Pager page={view.page} pages={view.pages} text={`第 ${view.page} / ${view.pages} 页 · 每页 ${view.limit} 个`} onPage={next => { setPage(next); split.close({ restore: false }); }} />}
        </>
    );

    return (
        <div className="page-inner">
            <PageHead title="任务" description={`你在“${ws.space.name}”委派的任务。这里只显示你本人的任务，共享 Agent 不会分享任务记录。`} />
            <SplitView split={split} label="任务详情" list={<>
                {overview.stale && overview.error && (
                    <Banner tone="offline" title={`刷新失败：${overview.error.message}`} actions={<Button size="sm" icon="refresh" onClick={overview.reload}>重试</Button>}>下面是之前读取的任务，可能已经变化。</Banner>
                )}
                {view && !view.inventory.available && (
                    <Banner tone="offline" title="机器状态暂时无法读取">下面是任务记录。进行中的任务可能已经变化，标记“可能滞后”的条目以机器恢复后的观察为准。</Banner>
                )}
                <div className="toolbar-row">
                    <Chips label="按状态筛选" options={statusOptions} value={filters.status} onValueChange={status => reload({ status })} />
                    <div className="toolbar-row-end"><Find value={find} onChange={setFind} /><FilterPopover filters={filters} onApply={reload} /></div>
                </div>
                <FilterTokens filters={filters} onClear={reload} />
                {list}
            </>}>
                {target && <Inspector target={target} item={known.get(target.id)} resource={inspected} tab={tab} onTab={setTab}
                    onRound={roundId => { setTarget(current => current && { ...current, roundId, offset: 0 }); patchHash({ round: roundId }); }}
                    onOffset={offset => setTarget(current => current && { ...current, offset })}
                    onClose={() => split.close()} />}
            </SplitView>
        </div>
    );
}

function TaskRow({ task, opened, onOpen }: { task: Item; opened: boolean; onOpen(from: HTMLElement): void }) {
    const status = taskStatus[task.status];
    const text = task.attention ? task.attention.message : task.summary ? task.summary.split('\n')[0] : '尚无最终报告';
    return (
        <Row rowKey={task.id} opened={opened} onOpen={onOpen}>
            <span className="row-icon" data-tone={status.tone}><Icon name={status.icon} /></span>
            <span className="row-main">
                <span className="row-top"><strong className="row-title">{task.agent.name}</strong><span className="row-status" data-tone={status.tone}>{status.label}</span><span className="row-time">{relativeTime(task.updated_at)}</span></span>
                <span className="row-text" data-tone={task.attention ? status.tone : task.summary ? undefined : 'muted'}>{text}</span>
                <span className="row-meta">
                    <Chain parts={[task.machine.name, flavorLabels[task.runtime.flavor] ?? task.runtime.name, `第 ${task.round} 轮`]} />
                    <Tag>{modeLabels[task.workspace_mode] ?? task.workspace_mode}</Tag>
                    {task.files.status === 'delivered' && task.files.retention === 'retained' && <Tag icon="file">附件 {task.files.available}</Tag>}
                    {task.code.status === 'available' && <Tag tone="accent" icon="code">代码可取回</Tag>}
                    {task.code.sealing_status === 'needs_attention' && <Tag tone="warn" icon="code">代码封存待处理</Tag>}
                    {task.possibly_stale && <Tag tone="warn" icon="wifi-off">可能滞后</Tag>}
                </span>
            </span>
        </Row>
    );
}

function FilterPopover({ filters, onApply }: { filters: Filters; onApply(next: Partial<Filters>): void }) {
    const [open, setOpen] = useState(false);
    const [workspace, setWorkspace] = useState(filters.workspace);
    const [parent, setParent] = useState(filters.parent);
    const [limit, setLimit] = useState(String(filters.limit));
    const extra = [filters.workspace, filters.parent].filter(Boolean).length + (filters.limit !== defaults.limit ? 1 : 0);
    const apply = (next: Partial<Filters>) => { setOpen(false); onApply(next); };
    return (
        <Popover label="筛选任务" align="end" open={open} onOpenChange={next => {
            if (next) { setWorkspace(filters.workspace); setParent(filters.parent); setLimit(String(filters.limit)); }
            setOpen(next);
        }} trigger={<Button icon="filter" size="sm" aria-haspopup="dialog">{extra ? `筛选 · ${extra}` : '筛选'}</Button>}>
            <Form className="popover-form" onSubmit={() => apply({ workspace: workspace.trim(), parent: parent.trim(), limit: Number(limit) })}
                actions={<><Button variant="ghost" onClick={() => apply({ workspace: '', parent: '', limit: defaults.limit })}>清除</Button><Button type="submit" variant="primary">应用筛选</Button></>}>
                <TextField label="来源工作目录包含" placeholder="例如 runweft-web" value={workspace} onChange={event => setWorkspace(event.target.value)} />
                <TextField label="主宿主包含" placeholder="Codex、Claude Code 或机器" hint="匹配主宿主类型、机器或工作目录。" value={parent} onChange={event => setParent(event.target.value)} />
                <SelectField label="每页数量" value={limit} onChange={event => setLimit(event.target.value)} options={[10, 25, 50, 100].map(value => ({ value: String(value), label: `${value} 个` }))} />
            </Form>
        </Popover>
    );
}

function FilterTokens({ filters, onClear }: { filters: Filters; onClear(next: Partial<Filters>): void }) {
    const tokens: [string, string, Partial<Filters>][] = [];
    if (filters.workspace) tokens.push(['工作目录包含', filters.workspace, { workspace: '' }]);
    if (filters.parent) tokens.push(['主宿主包含', filters.parent, { parent: '' }]);
    if (!tokens.length) return null;
    return (
        <div className="tokens">
            {tokens.map(([label, value, clear]) => (
                <span className="token" key={label}>{label} “{value}”<Button icon="x" iconOnly label={`清除“${label}”`} variant="ghost" size="xs" onClick={() => onClear(clear)} /></span>
            ))}
        </div>
    );
}

function Inspector({ target, item, resource, tab, onTab, onRound, onOffset, onClose }: {
    target: Target; item?: Item; resource: ReturnType<typeof useResource<Detail | null>>; tab: Tab;
    onTab(tab: Tab): void; onRound(roundId: string): void; onOffset(offset: number): void; onClose(): void;
}) {
    const ws = useWorkspace();
    const d = resource.data?.agent_id === target.id ? resource.data : null;
    if (!d) {
        if (resource.error && !resource.loading) {
            const missing = resource.error instanceof HubApiError && resource.error.status === 404;
            return (
                <PanelInner>
                    <PanelHead title="任务详情" onClose={onClose} />
                    <Banner tone={missing ? 'warn' : 'danger'} title={missing ? '无法打开这个任务' : resource.error.message}
                        actions={missing ? undefined : <Button size="sm" icon="refresh" onClick={resource.reload}>重试</Button>}>
                        {missing ? '任务不存在，或它不属于你在当前空间的任务。任务记录只对发起人可见。' : resource.error.hint || undefined}
                    </Banner>
                </PanelInner>
            );
        }
        return <PanelInner><PanelHead title="任务详情" onClose={onClose} /><Loading /></PanelInner>;
    }
    const status = taskStatus[d.status];
    const openNative = (files: boolean) => d.session_id && void ws.run(() => ws.spaceApi.openNative(d.session_id!, files));
    const native = d.actions.native && !!d.session_id;
    return (
        <PanelInner>
            <PanelHead title={d.agent.definition.name} badges={<TaskStatusBadge status={d.status} />}
                sub={<span>第 {d.round} 轮 · 更新于 {relativeTime(d.updated_at)}</span>}
                actions={<>
                    {native && <Button icon="external" variant="primary" size="sm" onClick={() => openNative(false)}>打开原生会话</Button>}
                    <Menu label="任务操作" align="end" trigger={<Button icon="more" iconOnly label="更多操作" variant="ghost" size="sm" />}>
                        {native && <MenuItem icon="file" onSelect={() => openNative(true)}>打开原生文件</MenuItem>}
                        <MenuItem icon="refresh" onSelect={resource.reload}>刷新详情</MenuItem>
                    </Menu>
                </>}
                onClose={onClose} />
            {resource.stale && resource.error && (
                <Banner tone="offline" title={`刷新失败：${resource.error.message}`} actions={<Button size="sm" icon="refresh" onClick={resource.reload}>重试</Button>}>下面是之前读取的内容，可能已经变化。</Banner>
            )}
            {d.attention && <Banner tone={status.tone === 'unknown' ? 'unknown' : 'warn'} title={d.attention.message}>{d.attention.hint || undefined}</Banner>}
            {d.report.incomplete && <Banner tone="warn" title="报告可能不完整">停止已经确认，但部分原生终态还没有观察到。</Banner>}
            {native && <p className="hint">原生页面使用当前身份与空间的限时凭据，不会取得机器 shell；过期后回到 Hub 重新打开。</p>}
            <div className="weft-wrap">
                <Weft currentId={d.round_id} onSelect={roundId => { if (roundId !== d.round_id) onRound(roundId); }}
                    rounds={d.rounds.map(round => ({ id: round.id, ordinal: round.ordinal, phaseLabel: phaseLabels[round.phase] ?? round.phase,
                        tone: round.phase === 'failed' ? 'danger' : round.phase === 'finished' ? 'ok' : 'accent' }))} />
            </div>
            <Tabs label="任务详情" items={tabs} value={tab} onValueChange={onTab}>
                {tab === 'report' && <ReportTab d={d} onOffset={onOffset} />}
                {tab === 'delivery' && <DeliveryTab d={d} onOpenFiles={native ? () => openNative(true) : undefined} />}
                {tab === 'details' && <DetailsTab d={d} item={item} />}
                {tab === 'continue' && <ContinueTab d={d} />}
            </Tabs>
        </PanelInner>
    );
}

function ReportTab({ d, onOffset }: { d: Detail; onOffset(offset: number): void }) {
    const r = d.report, text = useRef<HTMLDivElement>(null);
    const structured = r.structured as Record<'summary' | 'changes' | 'tests' | 'remaining', string> | undefined;
    const go = (offset: number) => { onOffset(offset); requestAnimationFrame(() => text.current?.focus()); };
    return (
        <>
            {structured && (
                <div className="digest">
                    {([['摘要', structured.summary], ['变更', structured.changes], ['测试', structured.tests], ['剩余事项', structured.remaining]] as const)
                        .map(([label, value]) => <div className="digest-item" key={label}><h4>{label}</h4><p>{value}</p></div>)}
                </div>
            )}
            {r.text ? (
                <article className="reading" aria-label="完整报告">
                    <h4 className="reading-title">{structured ? '完整报告' : '报告'}</h4>
                    <div ref={text} className="report-text task-report" tabIndex={0}>{r.text}</div>
                    {r.total > r.text.length && (
                        <nav className="pager" aria-label="报告分段">
                            <span className="pager-text">{numbers.format(r.offset + 1)}–{numbers.format(r.offset + r.text.length)} / {numbers.format(r.total)} 字</span>
                            <Button size="sm" icon="chevron-left" disabled={!r.offset} onClick={() => go(Math.max(0, r.offset - reportPage))}>上一段</Button>
                            <Button size="sm" disabled={r.next_offset === null} onClick={() => r.next_offset !== null && go(r.next_offset)}>下一段<Icon name="chevron-right" /></Button>
                        </nav>
                    )}
                </article>
            ) : <EmptyState icon="file" title="这一轮还没有最终报告">这不代表任务没有执行。可以打开原生会话查看进展。</EmptyState>}
        </>
    );
}

function DeliveryTab({ d, onOpenFiles }: { d: Detail; onOpenFiles?: () => void }) {
    const attachments = d.delivery.attachments, items = attachments.manifest?.items ?? [];
    const sealing = d.git === 'not_applicable' ? null : d.git.status;
    const files = { status: attachments.status, retention: attachments.retention.state, available: items.filter(file => file.status === 'available').length,
        count: items.length || (attachments.status === 'none' ? 0 : items.length) };
    const next = d.code.next;
    const nextHint = next && ('hint' in next && next.hint ? next.hint
        : { review: '在源仓库查看本轮改动。', fetch_result: '让 Agent 取回本轮代码后审阅。', read_agent: '让 Agent 读取取回进度。', retry_result: '让 Agent 重新取回本轮代码。' }[next.action]);
    return (
        <>
            <Section title="附件">
                <p className="section-lead">{filesText(files)}</p>
                {items.length > 0 && (
                    <ul className="file-list">
                        {items.map(file => (
                            <li key={file.name}>
                                <Icon name="file" /><Mono>{file.name}</Mono>
                                {file.status === 'failed' ? <Tag tone="danger">{file.error?.message ?? '交付失败'}</Tag>
                                    : onOpenFiles && <Button icon="external" iconOnly label={`在原生文件中查看 ${file.name}`} variant="ghost" size="sm" onClick={onOpenFiles} />}
                            </li>
                        ))}
                    </ul>
                )}
            </Section>
            <Section title="代码">
                <Facts rows={[['状态', codeText({ status: d.code.status, sealing_status: sealing, ref: d.code.ref })],
                    d.code.ref ? ['交付引用', <Mono>{d.code.ref}</Mono>] : null,
                    d.code.result?.resultHead ? ['结果提交', <Mono>{d.code.result.resultHead}</Mono>] : null]} />
                {next && <div className="next-step"><Icon name="arrow-right" /><div><p>{nextHint}</p><code className="command">{next.command}</code></div></div>}
            </Section>
            <Section title="进程"><p className="section-lead">{stopText(d)}</p></Section>
        </>
    );
}

function DetailsTab({ d, item }: { d: Detail; item?: Item }) {
    const json = (title: string, value: unknown) => <Disclosure summary={title}><pre className="code-block">{JSON.stringify(value, null, 2)}</pre></Disclosure>;
    return (
        <>
            <Facts rows={[
                ['状态', <TaskStatusBadge status={d.status} />],
                ['阶段', `${phaseLabels[d.phase] ?? d.phase} · ${stopText(d)}`],
                ['工作区', <span>{modeLabels[d.workspace_mode] ?? d.workspace_mode} <Mono>{d.cwd}</Mono></span>],
                ['来源', <span>{parentText(d.parent.kind === 'mcp' ? { kind: 'mcp', host: d.parent.host } : d.parent)} · <Mono>{d.parent.cwd}</Mono></span>],
                ['执行目标', <Chain parts={[item?.machine.name ?? d.machine_id, item?.runtime.name ?? d.runtime_id]} />],
                ['配置版本', <span>v{d.agent.hub.version} · <Mono>{d.agent.hub.contentHash}</Mono></span>],
                ['最后观察', d.observed_at ? fullTime(d.observed_at) : '尚未观察'],
                ['任务 ID', <Mono>{d.agent_id}</Mono>],
                ['轮次 ID', <Mono>{d.round_id}</Mono>],
            ]} />
            <Section title="诊断">
                <p className="section-lead">原始记录，供核对与排查。</p>
                {json('本轮 Agent 配置快照', d.agent)}
                {json('主宿主与工作环境', { parent: d.parent, environment: d.environment, preparation: d.preparation })}
                {json('附件与代码交付', { input: d.input_files, delivery: d.delivery })}
                {json('执行观察与恢复', { native: d.native_status, stop: d.stop, finish: d.finish, permissions: d.permissions, cancellation: d.cancellation, resume: d.resume, reconstruction: d.reconstruction })}
            </Section>
        </>
    );
}

function ContinueTab({ d }: { d: Detail }) {
    const ws = useWorkspace(), prompt = useRef<HTMLPreElement>(null);
    if (!d.actions.manageViaAgent) return <EmptyState icon="lock" title="这个任务不能交给 Agent 继续处理" />;
    const text = `请在 ${location.origin} 的空间 ${ws.space.id} 检查任务 ${d.agent_id}，先运行 task show 核对第 ${d.round} 轮（${d.round_id}）的状态，再按我的要求续接、停止或取回成果。执行未知时不要盲目重发；取回 bundle 后由主 Agent 审查合入，不自动 push。显式清理前说明删除范围。`;
    return (
        <>
            <p className="section-lead">续接、停止、取回成果和清理都由 Agent 完成。把下面的说明交给 Codex 或 Claude Code：</p>
            <pre ref={prompt} className="prompt" tabIndex={0}>{text}</pre>
            <div className="form-actions"><CopyButton text={text} source={prompt} /></div>
            {d.status === 'unknown' && <Banner tone="unknown" title="这一轮的执行状态还没有确认">先让 Agent 核对，确认之前不要重新发起这一轮。</Banner>}
        </>
    );
}
