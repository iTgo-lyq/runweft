import { useEffect, useRef, useState } from 'react';
import { Badge, Banner, Block, Button, Chain, Dialog, EmptyState, Facts, Form, Icon, Mono, PageHead, SelectField, toast, useConfirm } from '@runweft/ui';
import { HubError, flavorLabels } from '../mock.js';
import { Loaded, demo, usePage, useProto } from '../proto';

type Catalog = { selections: any[]; agents: any[]; repositories: any[]; runtimes: any[] };

export function SelectionsPage() {
    const page = usePage(() => Promise.all([demo.api.selections(), demo.api.agents(), demo.api.repositories(), demo.api.runtimes()])
        .then(([selections, agents, repositories, runtimes]) => ({ selections, agents, repositories, runtimes })));
    const [editing, setEditing] = useState<any | 'new' | null>(null);
    return (
        <Loaded page={page} label="我的选择">{catalog => (
            <div className="page-inner narrow">
                <PageHead title="我的选择" description="委派时默认使用哪个 Agent 和 Runtime。只影响你自己，不改变别人的配置。" />
                <section className="order" aria-label="解析顺序">
                    <div className="order-row"><span className="order-label">Agent</span><Chain label="Agent 的解析顺序" parts={['本次显式指定', '我的仓库选择', '我的空间默认']} /></div>
                    <div className="order-row"><span className="order-label">Runtime</span><Chain label="Runtime 的解析顺序" parts={['本次显式指定', '同一 Agent 的仓库选择', '同一 Agent 的空间默认', 'Agent 定义']} /></div>
                    <p className="hint">从左往右，第一个有值的层决定结果。决定的那一层失效时直接报错，不会自动换成下一层。</p>
                </section>
                {catalog.selections.length ? (
                    <div className="choices">
                        {catalog.selections.map((selection: any) => <Choice key={selection.repositoryId ?? 'space'} selection={selection} catalog={catalog} onEdit={() => setEditing(selection)} />)}
                        <button type="button" className="choice choice-add" onClick={() => setEditing('new')}><Icon name="plus" /><span>添加选择</span></button>
                    </div>
                ) : <EmptyState icon="sliders" title="还没有保存选择" actions={<Button icon="plus" variant="primary" onClick={() => setEditing('new')}>添加选择</Button>}>可以在委派时显式指定 Agent，也可以在这里保存空间默认或仓库选择。</EmptyState>}
                <EditDialog catalog={catalog} editing={editing} onClose={() => setEditing(null)} />
                <Preview catalog={catalog} />
            </div>
        )}</Loaded>
    );
}

const repoName = (catalog: Catalog, id: string | null) => id ? catalog.repositories.find(r => r.id === id)?.name ?? `原仓库不可见 · ${id}` : '整个空间';

function problem(catalog: Catalog, selection: any) {
    const agent = catalog.agents.find(a => a.id === selection.agentId);
    if (!agent) return { title: '已保存的 Agent 不可见', text: `${selection.agentId}。修改或清除这条选择后才会继续解析。` };
    if (!agent.invocable) return { title: '已保存的 Agent 当前不可调用', text: `${agent.name} · ${!agent.registered ? '已取消登记' : agent.blocked ? '已在此空间停用' : '所属人已离开空间'}。这条选择不会自动换成其他 Agent，修改或清除后才会继续解析。` };
    if (selection.runtimeId) {
        const runtime = catalog.runtimes.find(r => r.id === selection.runtimeId);
        if (!runtime) return { title: '已保存的 Runtime 不可见', text: `${selection.runtimeId}。修改或清除 Runtime 后才会继续解析。` };
        if (!runtime.eligibility.eligible) return { title: `已保存的 Runtime 不可用：${runtime.eligibility.reason}`, text: runtime.eligibility.hint };
    }
    return null;
}

function Choice({ selection, catalog, onEdit }: { selection: any; catalog: Catalog; onEdit(): void }) {
    const proto = useProto(), confirm = useConfirm();
    const agent = catalog.agents.find(a => a.id === selection.agentId), runtime = selection.runtimeId ? catalog.runtimes.find(r => r.id === selection.runtimeId) : null;
    const issue = problem(catalog, selection);
    const definitionRuntime = agent?.definition?.runtimeId ? catalog.runtimes.find(r => r.id === agent.definition.runtimeId) : null;
    const scope = repoName(catalog, selection.repositoryId);
    return (
        <article className="choice" data-tone={issue ? 'warn' : undefined}>
            <header className="choice-head">
                <span className="choice-icon"><Icon name={selection.repositoryId ? 'repo' : 'space'} /></span><h3>{scope}</h3>
                {issue ? <Badge tone="warn" icon="st-attention">需要处理</Badge> : <Badge tone="ok" icon="st-done">有效</Badge>}
            </header>
            <dl className="choice-body">
                <div><dt>Agent</dt><dd>{agent ? `${agent.name} · v${agent.version}` : <Mono>{selection.agentId}</Mono>}</dd></div>
                <div><dt>Runtime</dt><dd>{runtime ? runtime.name : selection.runtimeId ? <Mono>{selection.runtimeId}</Mono> : <>{definitionRuntime?.name ?? '未指定'} <span className="tag">按 Agent 定义</span></>}</dd></div>
            </dl>
            {issue && <p className="choice-issue"><strong>{issue.title}</strong> {issue.text}</p>}
            <div className="choice-actions">
                <Button icon="edit" size="sm" onClick={onEdit}>修改</Button>
                <Button variant="ghost" size="sm" onClick={async () => {
                    if (!await confirm('清除后会按剩余的选择层解析，不会修改 Agent 或 Runtime。', { title: `清除“${scope}”的选择？`, confirmLabel: '清除', danger: true })) return;
                    if (await proto.run(() => demo.api.clearSelection(selection.repositoryId), { success: '选择已清除' })) proto.refresh();
                }}>清除</Button>
            </div>
        </article>
    );
}

function EditDialog({ catalog, editing, onClose }: { catalog: Catalog; editing: any | 'new' | null; onClose(): void }) {
    const proto = useProto();
    const existing = editing && editing !== 'new' ? editing : null;
    const taken = new Set(catalog.selections.map(x => x.repositoryId ?? ''));
    const scopes = existing ? [{ value: existing.repositoryId ?? '', label: repoName(catalog, existing.repositoryId) }]
        : [{ value: '', label: '整个空间' }, ...catalog.repositories.filter(r => r.registered).map(r => ({ value: r.id, label: r.name }))].filter(option => !taken.has(option.value));
    const [scope, setScope] = useState('');
    const [agentId, setAgentId] = useState('');
    const [runtimeId, setRuntimeId] = useState('');
    const open = editing !== null && scopes.length > 0;
    useEffect(() => {
        if (editing === null) return;
        if (!scopes.length) { toast('每个范围都已经有选择了，可以修改已有的选择', 'info'); onClose(); return; }
        setScope(existing ? existing.repositoryId ?? '' : scopes[0].value); setAgentId(existing?.agentId ?? ''); setRuntimeId(existing?.runtimeId ?? '');
    }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps
    const usable = catalog.agents.filter(a => a.view === 'definition' && a.invocable && (a.repositoryId === null || a.repositoryId === (scope || null)));
    const agents = usable.map(a => ({ value: a.id, label: `${a.name} · v${a.version}` }));
    if (existing && !agents.some(o => o.value === existing.agentId)) agents.push({ value: existing.agentId, label: `已保存但当前不可调用 · ${catalog.agents.find(a => a.id === existing.agentId)?.name ?? existing.agentId}` });
    const flavor = catalog.agents.find(a => a.id === agentId)?.definition?.flavor;
    const runtimes = catalog.runtimes.filter(r => r.permissions.use && (!flavor || r.flavor === flavor)).map(r => ({ value: r.id, label: `${r.name} · ${flavorLabels[r.flavor]}` }));
    return (
        <Dialog open={open} onOpenChange={next => { if (!next) onClose(); }} title={existing ? '修改选择' : '添加选择'} description="委派时如果没有显式指定，会按这里的选择决定 Agent 和 Runtime。"
            footer={<><Button onClick={onClose}>取消</Button><Button type="submit" form="save-selection" variant="primary">保存选择</Button></>}>
            <Form id="save-selection" onSubmit={async () => {
                const done = await proto.run(() => demo.api.saveSelection({ repositoryId: scope || null, agentId, runtimeId: runtimeId || null }));
                if (!done) return;
                onClose(); toast('选择已保存，只影响你自己'); proto.refresh();
            }}>
                <SelectField label="作用范围" options={scopes} value={scope} disabled={!!existing} onChange={event => { setScope(event.target.value); setAgentId(''); setRuntimeId(''); }} />
                <SelectField label="Agent" required options={[{ value: '', label: '请选择 Agent' }, ...agents]} value={agentId}
                    onChange={event => { setAgentId(event.target.value); setRuntimeId(existing && existing.agentId === event.target.value && runtimes.some(o => o.value === existing.runtimeId) ? existing.runtimeId : ''); }} />
                <SelectField label="Runtime" hint="只能选择与 Agent 类型相同、你当前可以使用的 Runtime。" options={[{ value: '', label: '不指定，使用 Agent 定义' }, ...runtimes]} value={runtimeId} onChange={event => setRuntimeId(event.target.value)} />
            </Form>
        </Dialog>
    );
}

// Resolution preview uses the same order as delegation, and fails instead of falling back.
function Preview({ catalog }: { catalog: Catalog }) {
    const proto = useProto();
    const [scope, setScope] = useState('');
    const [agentId, setAgentId] = useState('');
    const [runtimeId, setRuntimeId] = useState('');
    const [outcome, setOutcome] = useState<{ resolution?: any; error?: HubError } | null>(null);
    const result = useRef<HTMLDivElement>(null);
    const r = outcome?.resolution;
    return (
        <Block title="验证解析">
            <p className="section-lead">按委派时的顺序解析一次，看看会用到哪个 Agent 和 Runtime。</p>
            <Form onSubmit={async () => {
                try { setOutcome({ resolution: await demo.api.resolve({ repositoryId: scope || null, agentId, runtimeId }) }); }
                catch (error) {
                    if (!(error instanceof HubError)) throw error;
                    if (error.kind === 'expired') { proto.expire(); return; }
                    if (error.kind === 'unreachable') { proto.showAlert(error); return; }
                    setOutcome({ error });
                }
                requestAnimationFrame(() => result.current?.focus());
            }} actions={<Button type="submit" variant="primary">解析</Button>}>
                <div className="form-grid three">
                    <SelectField label="仓库" value={scope} onChange={event => setScope(event.target.value)} options={[{ value: '', label: '整个空间' }, ...catalog.repositories.filter(r => r.registered).map(r => ({ value: r.id, label: r.name }))]} />
                    <SelectField label="显式 Agent（可选）" value={agentId} onChange={event => setAgentId(event.target.value)} options={[{ value: '', label: '使用我的选择' }, ...catalog.agents.filter(a => a.view === 'definition' && a.invocable).map(a => ({ value: a.id, label: a.name }))]} />
                    <SelectField label="显式 Runtime（可选）" value={runtimeId} onChange={event => setRuntimeId(event.target.value)} options={[{ value: '', label: '按选择或定义' }, ...catalog.runtimes.filter(rt => rt.permissions.use).map(rt => ({ value: rt.id, label: rt.name }))]} />
                </div>
            </Form>
            <div ref={result} className="resolution" role="status" tabIndex={-1}>
                {outcome?.error && <Banner tone="warn" title={outcome.error.message}>{outcome.error.hint || undefined}</Banner>}
                {r && (
                    <div className="resolution-ok">
                        <p className="resolution-path"><Chain label="解析结果" parts={[`${r.agent.name} · v${r.agent.version}`, r.runtime.name, r.machine]} /></p>
                        <Facts rows={[['Agent 来自', r.agentSource], ['Runtime 来自', r.runtimeSource], ['原生类型', flavorLabels[r.runtime.flavor]], ['配置指纹', <Mono>{r.fingerprint}</Mono>]]} />
                        <p className="hint">执行目标已经确认；模型认证、参数兼容和真实执行还没有检查。</p>
                    </div>
                )}
            </div>
        </Block>
    );
}
