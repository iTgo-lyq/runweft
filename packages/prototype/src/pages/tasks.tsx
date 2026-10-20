import { useEffect, useRef, useState, type RefObject } from 'react';
import {
    Banner, Button, Chain, Chips, Disclosure, EmptyState, Facts, Find, Form, Icon, Menu, MenuItem, Mono, PageHead, PanelHead, PanelInner, Pager, Popover,
    Row, RowList, Section, SelectField, SplitView, Tabs, Tag, TaskStatusBadge, TextField, Weft, fullTime, taskStatus, useSplit, type TaskStatus,
} from '@runweft/ui';
import { HUB_ORIGIN, flavorLabels, phaseLabels, type HubError } from '../mock.js';
import { Loaded, demo, usePage, useProto } from '../proto';
import { relative } from '../time-format';

type Filters = { status: '' | TaskStatus; workspace: string; parent: string; limit: number };
type Tab = 'report' | 'delivery' | 'details' | 'continue';
const statusFilter = [{ value: '' as const, label: '全部' }, ...(['needs_attention', 'unknown', 'running', 'completed', 'failed', 'interrupted'] as TaskStatus[]).map(value => ({ value, label: taskStatus[value].label }))];
const modeLabels: Record<string, string> = { shared: '共享目录', worktree: '独立 worktree' };
const numbers = new Intl.NumberFormat('zh-CN');

const stopText = (task: any) => task.stop === 'stopped' ? '进程已结束' : task.stop === 'stopping' ? '等待进程结束' : task.stop === 'unconfirmed' ? '尚未确认进程状态' : '进程运行中';
function codeText(code: any) {
    if (code.status === 'pending' && code.sealing_status === 'needs_attention') return '封存待处理';
    return ({ not_applicable: '不交付代码', pending: '等待封存', capturing: '正在捕获', publishing: '正在上传', available: code.ref ? '可以取回' : '可以审阅', needs_attention: '需要处理', unknown: '状态未知', releasing: '正在释放', released: '已释放', discarded: '已放弃' } as Record<string, string>)[code.status] ?? code.status;
}
function filesText(files: any) {
    if (files.retention !== 'retained') return ({ releasing: '正在释放', released: '已释放', discarded: '已放弃' } as Record<string, string>)[files.retention] ?? files.retention;
    return files.status === 'none' ? '没有声明附件' : files.status === 'delivered' ? `已交付 ${files.available} 项` : files.status === 'incomplete' ? `待补齐 ${files.available}/${files.count}` : '正在交付';
}

export function TasksPage() {
    const proto = useProto();
    const [filters, setFilters] = useState<Filters>({ status: '', workspace: '', parent: '', limit: 50 });
    const [page, setPage] = useState(1);
    const [find, setFind] = useState('');
    const split = useSplit<string>();
    // Changing filters or page reloads like a refresh, as in the accepted prototype.
    const view = usePage(() => demo.api.taskOverview({ ...filters, page }), [filters, page]);
    const apply = (next: Partial<Filters>) => { setFilters(current => ({ ...current, ...next })); setPage(1); split.close({ restore: false }); };
    return (
        <Loaded page={view} label="任务">{data => {
            const filtered = !!(filters.status || filters.workspace || filters.parent);
            const term = find.trim().toLowerCase();
            const search = (task: any) => `${task.agent.name} ${task.summary} ${task.machine.name} ${task.runtime.name} ${task.cwd}`.toLowerCase();
            const shown = data.items.filter((task: any) => !term || search(task).includes(term));
            let body;
            if (!data.total && !filtered) body = <EmptyState icon="tasks" title="还没有任务" actions={<Button icon="link" onClick={() => proto.showOnboarding()}>查看接入说明</Button>}>
                {demo.firstRun ? '回到原对话，Agent 会准备执行环境并发起第一次评审。任务开始后会出现在这里。' : '在 Codex 或 Claude Code 里让 Agent 委派任务，开始后会出现在这里。'}</EmptyState>;
            else if (!data.total) body = <EmptyState icon="filter" title="没有符合条件的任务" actions={<Button onClick={() => apply({ status: '', workspace: '', parent: '' })}>清除筛选</Button>}>调整筛选条件，或清除筛选查看全部任务。</EmptyState>;
            else body = (
                <>
                    <div className="list-meta"><span>{filtered ? '符合条件的任务' : '你的任务'} {data.total} 个</span><span className="list-meta-hint">需要你处理的排在最前</span></div>
                    {term && <p className="list-note">“{find.trim()}”在这一页的 {data.items.length} 个任务中找到 {shown.length} 个。查找只覆盖当前这一页。</p>}
                    <RowList label="任务列表">{shown.map((task: any) => <TaskRow key={task.id} task={task} opened={split.key === task.id} onOpen={from => split.open(task.id, { from })} />)}</RowList>
                    {term && !shown.length && data.items.length > 0 && <EmptyState icon="search" title={`这一页没有包含“${find.trim()}”的任务`}>查找只覆盖当前这一页。可以翻页，或用“筛选”按工作目录和主宿主查询全部任务。</EmptyState>}
                    <Pager page={data.page} pages={data.pages} text={`第 ${data.page} / ${data.pages} 页 · 每页 ${data.limit} 个`} onPage={next => { setPage(next); split.close({ restore: false }); }} />
                </>
            );
            return (
                <div className="page-inner">
                    <PageHead title="任务" description={`你在“${demo.space().name}”委派的任务。这里只显示你本人的任务，共享 Agent 不会分享任务记录。`} />
                    <SplitView split={split} label="任务详情" list={<>
                        {!data.inventory.available && <Banner tone="offline" title="机器状态暂时无法读取">下面是任务记录。进行中的任务可能已经变化，标记“可能滞后”的条目以机器恢复后的观察为准。</Banner>}
                        <div className="toolbar-row">
                            <Chips label="按状态筛选" options={statusFilter} value={filters.status} onValueChange={status => apply({ status })} />
                            <div className="toolbar-row-end"><Find value={find} onChange={setFind} /><FilterPopover filters={filters} onApply={apply} /></div>
                        </div>
                        <FilterTokens filters={filters} onClear={apply} />
                        {body}
                    </>}>
                        {split.key && <Inspector key={split.key} taskId={split.key} onClose={() => split.close()} />}
                    </SplitView>
                </div>
            );
        }}</Loaded>
    );
}

function TaskRow({ task, opened, onOpen }: { task: any; opened: boolean; onOpen(from: HTMLElement): void }) {
    const status = taskStatus[task.status as TaskStatus];
    const text = task.attention ? task.attention.message : task.summary ? task.summary.split('\n')[0] : '尚无最终报告';
    return (
        <Row rowKey={task.id} opened={opened} onOpen={onOpen} className="task-row" tone={status.tone}>
            <span className="row-icon" data-tone={status.tone}><Icon name={status.icon} /></span>
            <span className="row-main">
                <span className="row-top"><strong className="row-title">{task.agent.name}</strong><span className="row-status" data-tone={status.tone}>{status.label}</span><span className="row-time">{relative(task.updated_at)}</span></span>
                <span className="row-text" data-tone={task.attention ? status.tone : task.summary ? undefined : 'muted'}>{text}</span>
                <span className="row-meta">
                    <Chain parts={[task.machine.name, flavorLabels[task.runtime.flavor], `第 ${task.round} 轮`]} />
                    <Tag>{modeLabels[task.workspace_mode]}</Tag>
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
    const extra = [filters.workspace, filters.parent].filter(Boolean).length + (filters.limit !== 50 ? 1 : 0);
    const apply = (next: Partial<Filters>) => { setOpen(false); onApply(next); };
    return (
        <Popover label="筛选任务" align="end" open={open} onOpenChange={next => { if (next) { setWorkspace(filters.workspace); setParent(filters.parent); setLimit(String(filters.limit)); } setOpen(next); }}
            trigger={<Button icon="filter" size="sm" aria-haspopup="dialog">{extra ? `筛选 · ${extra}` : '筛选'}</Button>}>
            <Form className="popover-form" onSubmit={() => apply({ workspace: workspace.trim(), parent: parent.trim(), limit: Number(limit) })}
                actions={<><Button variant="ghost" onClick={() => apply({ workspace: '', parent: '', limit: 50 })}>清除</Button><Button type="submit" variant="primary">应用筛选</Button></>}>
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
    return <div className="tokens">{tokens.map(([label, value, clear]) => <span className="token" key={label}>{label} “{value}”<Button icon="x" iconOnly label={`清除“${label}”`} variant="ghost" size="xs" onClick={() => onClear(clear)} /></span>)}</div>;
}

function Inspector({ taskId, onClose }: { taskId: string; onClose(): void }) {
    const proto = useProto();
    const [target, setTarget] = useState<{ roundId?: string; offset: number }>({ offset: 0 });
    const [tab, setTab] = useState<Tab>('report');
    const [state, setState] = useState<{ detail?: any; error?: HubError }>({});
    const [retry, setRetry] = useState(0);
    const reportRef = useRef<HTMLDivElement>(null), focusReport = useRef(false);
    useEffect(() => {
        let live = true;
        demo.api.taskDetail(taskId, target).then(detail => { if (live) setState({ detail }); }, error => { if (live) setState({ error }); });
        return () => { live = false; };
    }, [taskId, target, retry, proto.refreshTick]);
    useEffect(() => { if (focusReport.current && state.detail) { focusReport.current = false; reportRef.current?.focus(); } }, [state.detail]);
    const d = state.detail;
    if (!d) {
        return (
            <PanelInner>
                <PanelHead title="任务详情" onClose={onClose} />
                {state.error && <Banner tone="danger" title={state.error.message} actions={<Button size="sm" onClick={() => setRetry(n => n + 1)}>重试</Button>}>{state.error.hint || undefined}</Banner>}
            </PanelInner>
        );
    }
    const status = taskStatus[d.status as TaskStatus];
    const page = (offset: number) => { focusReport.current = true; setTarget(current => ({ ...current, offset })); };
    return (
        <PanelInner>
            <PanelHead title={d.agent.name} badges={<TaskStatusBadge status={d.status} />} sub={<><Mono>{d.id}</Mono><span>更新于 {relative(d.updated_at)}</span></>}
                actions={<>
                    <Button icon="external" variant="primary" size="sm" onClick={() => proto.openNative(d, 'session')}>打开原生会话</Button>
                    <Menu label="任务操作" align="end" trigger={<Button icon="more" iconOnly label="更多操作" variant="ghost" size="sm" />}>
                        <MenuItem icon="file" onSelect={() => proto.openNative(d, 'files')}>打开原生文件</MenuItem>
                        <MenuItem icon="refresh" onSelect={() => setRetry(n => n + 1)}>刷新详情</MenuItem>
                    </Menu>
                </>}
                onClose={onClose} />
            {d.attention && <Banner tone={status.tone === 'unknown' ? 'unknown' : 'warn'} title={d.attention.message}>{d.attention.hint || undefined}</Banner>}
            {d.report.incomplete && <Banner tone="warn" title="报告可能不完整">停止已经确认，但部分原生终态还没有观察到。</Banner>}
            <div className="weft-wrap">
                <Weft currentId={d.round_id} onSelect={roundId => { if (roundId !== d.round_id) setTarget({ roundId, offset: 0 }); }}
                    rounds={d.rounds.map((r: any) => ({ id: r.id, ordinal: r.ordinal, phaseLabel: phaseLabels[r.phase], tone: r.phase === 'failed' ? 'danger' : r.phase === 'finished' ? 'ok' : 'accent' }))} />
            </div>
            <Tabs label="任务详情" value={tab} onValueChange={setTab} items={[{ id: 'report', label: '报告' }, { id: 'delivery', label: '交付' }, { id: 'details', label: '详情' }, { id: 'continue', label: '继续处理' }]}>
                {tab === 'report' && <Report d={d} reportRef={reportRef} onPage={page} />}
                {tab === 'delivery' && <Delivery d={d} onOpenFiles={() => proto.openNative(d, 'files')} />}
                {tab === 'details' && <Details d={d} />}
                {tab === 'continue' && <Continue d={d} />}
            </Tabs>
        </PanelInner>
    );
}

function Report({ d, reportRef, onPage }: { d: any; reportRef: RefObject<HTMLDivElement | null>; onPage(offset: number): void }) {
    const r = d.report;
    return (
        <>
            {r.structured && (
                <div className="digest">
                    {[['摘要', r.structured.summary], ['变更', r.structured.changes], ['测试', r.structured.tests], ['剩余事项', r.structured.remaining]].map(([label, value]) => (
                        <div className="digest-item" key={label}><h4>{label}</h4><p>{value}</p></div>
                    ))}
                </div>
            )}
            {r.text ? (
                <article className="reading" aria-label="完整报告">
                    <h4 className="reading-title">{r.structured ? '完整报告' : '报告'}</h4>
                    <div ref={reportRef} className="report-text" tabIndex={0}>{r.text}</div>
                    {r.total > r.text.length && (
                        <nav className="pager" aria-label="报告分段">
                            <span className="pager-text">{numbers.format(r.offset + 1)}–{numbers.format(r.offset + r.text.length)} / {numbers.format(r.total)} 字</span>
                            <Button size="sm" icon="chevron-left" disabled={!r.offset} onClick={() => onPage(Math.max(0, r.offset - 16000))}>上一段</Button>
                            <Button size="sm" disabled={r.next_offset === null} onClick={() => onPage(r.next_offset)}>下一段<Icon name="chevron-right" /></Button>
                        </nav>
                    )}
                </article>
            ) : <EmptyState icon="file" title="这一轮还没有最终报告">这不代表任务没有执行。可以打开原生会话查看进展。</EmptyState>}
        </>
    );
}

function Delivery({ d, onOpenFiles }: { d: any; onOpenFiles(): void }) {
    return (
        <>
            <Section title="附件">
                <p className="section-lead">{filesText(d.files)}</p>
                {d.delivery.files.length > 0 && (
                    <ul className="file-list">
                        {d.delivery.files.map((name: string) => <li key={name}><Icon name="file" /><Mono>{name}</Mono><Button icon="external" iconOnly label={`在原生文件中查看 ${name}`} variant="ghost" size="sm" onClick={onOpenFiles} /></li>)}
                    </ul>
                )}
            </Section>
            <Section title="代码">
                <Facts rows={[['状态', codeText(d.code)], d.code.ref ? ['交付引用', <Mono>{d.code.ref}</Mono>] : null, d.code.result_head ? ['结果提交', <Mono>{d.code.result_head}</Mono>] : null]} />
                {d.code.next && <div className="next-step"><Icon name="arrow-right" /><div><p>{d.code.next.hint}</p><code className="command">{d.code.next.command}</code></div></div>}
            </Section>
            <Section title="进程"><p className="section-lead">{stopText(d)}</p></Section>
        </>
    );
}

function Details({ d }: { d: any }) {
    const json = (title: string, value: unknown) => <Disclosure summary={title}><pre className="code-block">{JSON.stringify(value, null, 2)}</pre></Disclosure>;
    return (
        <>
            <Facts rows={[
                ['状态', <TaskStatusBadge status={d.status} />], ['阶段', `${phaseLabels[d.phase]} · ${stopText(d)}`],
                ['工作区', <span>{modeLabels[d.workspace_mode]} <Mono>{d.cwd}</Mono></span>], ['来源', <span>{d.parent.host} · <Mono>{d.parent.cwd}</Mono></span>],
                ['执行目标', <Chain parts={[d.machine.name, d.runtime.name]} />], ['配置版本', <span>v{d.agent_config.hub.version} · <Mono>{d.agent_config.hub.contentHash}</Mono></span>],
                ['最后观察', fullTime(d.observed_at)],
            ]} />
            {json('本轮 Agent 配置快照', d.agent_config)}{json('工作环境', d.environment)}{json('主宿主', d.parent)}
        </>
    );
}

function Continue({ d }: { d: any }) {
    const prompt = `请在 ${HUB_ORIGIN} 的空间 ${demo.space().id} 检查任务 ${d.id}，先运行 task show 核对第 ${d.round} 轮（${d.round_id}）的状态，再按我的要求续接、停止或取回成果。执行未知时不要盲目重发；取回 bundle 后由主 Agent 审查合入，不自动 push。显式清理前说明删除范围。`;
    return (
        <>
            <p className="section-lead">续接、停止、取回成果和清理都由 Agent 完成。把下面的说明交给 Codex 或 Claude Code：</p>
            <pre className="prompt" tabIndex={0}>{prompt}</pre>
            {d.status === 'unknown' && <Banner tone="unknown" title="这一轮的执行状态还没有确认">先让 Agent 核对，确认之前不要重新发起这一轮。</Banner>}
        </>
    );
}
