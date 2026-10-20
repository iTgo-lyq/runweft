import { useEffect, useRef, useState } from 'react';
import { Badge, Banner, Block, Button, Chain, Dialog, EmptyState, Facts, Form, Icon, Mono, PageHead, SelectField, toast, useConfirm } from '@runweft/ui';
import type { ResolvedHubAgent } from '../../agents/resolver';
import type { PersonalSelection } from '../../agents/selections';
import type { AgentView } from '../../agents/types';
import type { Repository } from '../../repositories/store';
import type { MachineView, RuntimeView } from '../../resources/types';
import { HubApiError } from '../api/http';
import { repositoryName } from '../agents/agents-page';
import { flavorLabels } from '../resources/common';
import { Resource, useResource, useWorkspace } from '../workspace/context';

type Catalog = { selections: PersonalSelection[]; agents: AgentView[]; repositories: Repository[]; runtimes: RuntimeView[]; machines: MachineView[] };
const sourceLabels: Record<string, string> = { explicit: '本次显式指定', repository: '我的仓库选择', space: '我的空间默认', definition: 'Agent 定义' };

/** A saved choice that no longer resolves is shown with the reason and its original ID; it is never replaced. */
function problem(catalog: Catalog, selection: PersonalSelection) {
    const agent = catalog.agents.find(item => item.id === selection.agentId);
    if (!agent) return { title: '已保存的 Agent 不可见', text: `${selection.agentId}。修改或清除这条选择后才会继续解析。` };
    if (!agent.permissions.invoke) return { title: '已保存的 Agent 当前不可调用',
        text: `${agent.name} · ${!agent.registered ? '已取消登记' : agent.blocked ? '已在此空间停用' : !agent.ownerPresent ? '所属人已离开空间' : '不满足调用条件'}。这条选择不会自动换成其他 Agent，修改或清除后才会继续解析。` };
    if (selection.runtimeId) {
        const runtime = catalog.runtimes.find(item => item.id === selection.runtimeId);
        if (!runtime) return { title: '已保存的 Runtime 不可见', text: `${selection.runtimeId}。修改或清除 Runtime 后才会继续解析。` };
        if (!runtime.eligibility.eligible) return { title: `已保存的 Runtime 不可用：${runtime.eligibility.reason?.message ?? '不满足选用条件'}`, text: runtime.eligibility.reason?.hint ?? '' };
    }
    return null;
}

export function SelectionsPage() {
    const ws = useWorkspace(), confirm = useConfirm();
    const catalog = useResource<Catalog>(() => Promise.all([
        ws.spaceApi.request<{ selections: PersonalSelection[] }>('/agent-selections'), ws.spaceApi.request<{ agents: AgentView[] }>('/agents'),
        ws.spaceApi.request<{ repositories: Repository[] }>('/repositories'), ws.spaceApi.request<{ runtimes: RuntimeView[] }>('/resources/runtimes'),
        ws.spaceApi.request<{ machines: MachineView[] }>('/resources/machines'),
    ]).then(([selections, agents, repositories, runtimes, machines]) => ({ selections: selections.selections, agents: agents.agents, repositories: repositories.repositories,
        runtimes: runtimes.runtimes, machines: machines.machines })), [ws.spaceApi]);
    const [editing, setEditing] = useState<PersonalSelection | 'new' | null>(null);
    return (
        <div className="page-inner narrow">
            <PageHead title="我的选择" description="委派时默认使用哪个 Agent 和 Runtime。只影响你自己，不改变别人的配置。" />
            <section className="order" aria-label="解析顺序">
                <div className="order-row"><span className="order-label">Agent</span><Chain label="Agent 的解析顺序" parts={['本次显式指定', '我的仓库选择', '我的空间默认']} /></div>
                <div className="order-row"><span className="order-label">Runtime</span><Chain label="Runtime 的解析顺序" parts={['本次显式指定', '同一 Agent 的仓库选择', '同一 Agent 的空间默认', 'Agent 定义']} /></div>
                <p className="hint">从左往右，第一个有值的层决定结果。决定的那一层失效时直接报错，不会自动换成下一层。</p>
            </section>
            <Resource resource={catalog} label="我的选择">{data => (
                <>
                    {data.selections.length ? (
                        <div className="choices">
                            {data.selections.map(selection => {
                                const agent = data.agents.find(item => item.id === selection.agentId), issue = problem(data, selection);
                                const runtime = selection.runtimeId ? data.runtimes.find(item => item.id === selection.runtimeId) : null;
                                const definitionRuntimeId = agent?.view === 'definition' ? agent.definition.runtimeId : null;
                                const definitionRuntime = definitionRuntimeId ? data.runtimes.find(item => item.id === definitionRuntimeId) : null;
                                const scope = repositoryName(data.repositories, selection.repositoryId);
                                return (
                                    <article className="choice" key={selection.repositoryId ?? 'space'} data-tone={issue ? 'warn' : undefined} data-selection-scope={selection.repositoryId ?? 'space'}>
                                        <header className="choice-head">
                                            <span className="choice-icon"><Icon name={selection.repositoryId ? 'repo' : 'space'} /></span><h3>{scope}</h3>
                                            {issue ? <Badge tone="warn" icon="st-attention">需要处理</Badge> : <Badge tone="ok" icon="st-done">有效</Badge>}
                                        </header>
                                        <dl className="choice-body">
                                            <div><dt>Agent</dt><dd>{agent ? `${agent.name} · v${agent.version}` : <Mono>{selection.agentId}</Mono>}</dd></div>
                                            <div><dt>Runtime</dt><dd>{runtime ? runtime.name : selection.runtimeId ? <Mono>{selection.runtimeId}</Mono>
                                                : <>{definitionRuntime?.name ?? (definitionRuntimeId ? <Mono>{definitionRuntimeId}</Mono> : '未指定')} <span className="tag">按 Agent 定义</span></>}</dd></div>
                                        </dl>
                                        {issue && <p className="choice-issue"><strong>{issue.title}</strong> {issue.text}</p>}
                                        <div className="choice-actions">
                                            <Button icon="edit" size="sm" onClick={() => setEditing(selection)}>修改</Button>
                                            <Button variant="ghost" size="sm" onClick={async () => {
                                                if (!await confirm('清除后会按剩余的选择层解析，不会修改 Agent 或 Runtime。', { title: `清除“${scope}”的选择？`, confirmLabel: '清除', danger: true })) return;
                                                if (await ws.run(() => ws.spaceApi.request('/agent-selections', { repositoryId: selection.repositoryId }, 'DELETE'), { success: '选择已清除' })) catalog.reload();
                                            }}>清除</Button>
                                        </div>
                                    </article>
                                );
                            })}
                            <button type="button" className="choice choice-add" onClick={() => setEditing('new')}><Icon name="plus" /><span>添加选择</span></button>
                        </div>
                    ) : (
                        <EmptyState icon="sliders" title="还没有保存选择" actions={<Button icon="plus" variant="primary" onClick={() => setEditing('new')}>添加选择</Button>}>
                            可以在委派时显式指定 Agent，也可以在这里保存空间默认或仓库选择。
                        </EmptyState>
                    )}
                    <EditDialog catalog={data} editing={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); catalog.reload(); }} />
                    <Preview catalog={data} />
                </>
            )}</Resource>
        </div>
    );
}

function usableAgents(catalog: Catalog, scope: string | null) {
    return catalog.agents.filter(agent => agent.view === 'definition' && agent.permissions.invoke && (agent.repositoryId === null || agent.repositoryId === scope));
}

function EditDialog({ catalog, editing, onClose, onSaved }: { catalog: Catalog; editing: PersonalSelection | 'new' | null; onClose(): void; onSaved(): void }) {
    const ws = useWorkspace();
    const existing = editing && editing !== 'new' ? editing : null;
    const taken = new Set(catalog.selections.map(item => item.repositoryId ?? ''));
    const scopes = existing ? [{ value: existing.repositoryId ?? '', label: repositoryName(catalog.repositories, existing.repositoryId) }]
        : [{ value: '', label: '整个空间' }, ...catalog.repositories.filter(item => item.registered).map(item => ({ value: item.id, label: item.name }))].filter(option => !taken.has(option.value));
    const [scope, setScope] = useState('');
    const [agentId, setAgentId] = useState('');
    const [runtimeId, setRuntimeId] = useState('');
    const [error, setError] = useState<HubApiError | null>(null);
    const [busy, setBusy] = useState(false);
    const agents = usableAgents(catalog, scope || null).map(agent => ({ value: agent.id, label: `${agent.name} · v${agent.version}` }));
    if (existing && !agents.some(option => option.value === existing.agentId)) {
        agents.push({ value: existing.agentId, label: `已保存但当前不可调用 · ${catalog.agents.find(agent => agent.id === existing.agentId)?.name ?? existing.agentId}` });
    }
    const chosen = catalog.agents.find(agent => agent.id === agentId), flavor = chosen?.view === 'definition' ? chosen.definition.flavor : null;
    const runtimes = catalog.runtimes.filter(runtime => runtime.permissions.use && (!flavor || runtime.flavor === flavor))
        .map(runtime => ({ value: runtime.id, label: `${runtime.name} · ${flavorLabels[runtime.flavor] ?? runtime.flavor}` }));
    if (existing?.runtimeId && existing.agentId === agentId && !runtimes.some(option => option.value === existing.runtimeId)) runtimes.push({ value: existing.runtimeId, label: `原 Runtime 不可用 · ${existing.runtimeId}` });
    const reset = () => {
        setScope(existing ? existing.repositoryId ?? '' : scopes[0]?.value ?? ''); setAgentId(existing?.agentId ?? ''); setRuntimeId(existing?.runtimeId ?? '');
        setError(null);
    };
    const open = editing !== null;
    useEffect(() => { if (open) reset(); }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps
    return (
        <Dialog open={open} onOpenChange={next => { if (!next) onClose(); }} title={existing ? '修改选择' : '添加选择'}
            description="委派时如果没有显式指定，会按这里的选择决定 Agent 和 Runtime。"
            footer={scopes.length ? <><Button onClick={onClose}>取消</Button><Button type="submit" form="save-selection" variant="primary" disabled={busy}>保存选择</Button></> : <Button onClick={onClose}>完成</Button>}>
            {scopes.length ? (
                <Form id="save-selection" onSubmit={async () => {
                    setBusy(true); setError(null);
                    const saved = await ws.run(() => ws.spaceApi.request('/agent-selections', { repositoryId: scope || null, agentId, runtimeId: runtimeId || null }, 'PUT'), { onError: setError });
                    setBusy(false);
                    if (!saved) return;
                    toast('选择已保存，只影响你自己'); onSaved();
                }}>
                    <SelectField label="作用范围" options={scopes} value={scope} disabled={!!existing} onChange={event => { setScope(event.target.value); setAgentId(''); setRuntimeId(''); }} />
                    <SelectField label="Agent" required options={[{ value: '', label: '请选择 Agent' }, ...agents]} value={agentId} onChange={event => { setAgentId(event.target.value); setRuntimeId(''); }} />
                    <SelectField label="Runtime" hint="只能选择与 Agent 类型相同、你当前可以使用的 Runtime。" options={[{ value: '', label: '不指定，使用 Agent 定义' }, ...runtimes]}
                        value={runtimeId} onChange={event => setRuntimeId(event.target.value)} />
                    {error && <Banner tone="danger" title={error.message}>{error.hint || undefined}</Banner>}
                </Form>
            ) : <p>每个范围都已经有选择了，可以修改已有的选择。</p>}
        </Dialog>
    );
}

function Preview({ catalog }: { catalog: Catalog }) {
    const ws = useWorkspace();
    const [scope, setScope] = useState('');
    const [agentId, setAgentId] = useState('');
    const [runtimeId, setRuntimeId] = useState('');
    const [outcome, setOutcome] = useState<{ resolution?: ResolvedHubAgent; error?: HubApiError } | null>(null);
    const result = useRef<HTMLDivElement>(null);
    const r = outcome?.resolution;
    const runtimeName = (id: string) => catalog.runtimes.find(item => item.id === id)?.name ?? id;
    const machineName = (id: string) => catalog.machines.find(item => item.id === id)?.name ?? id;
    return (
        <Block title="验证解析">
            <p className="section-lead">按委派时的顺序解析一次，看看会用到哪个 Agent 和 Runtime。</p>
            <Form onSubmit={async () => {
                const resolved = await ws.run(() => ws.spaceApi.request<{ resolution: ResolvedHubAgent }>('/agent-resolution', {
                    hubRepositoryId: scope || null, ...(agentId ? { agentId } : {}), ...(runtimeId ? { runtimeId } : {}),
                }), { onError: error => setOutcome({ error: error.kind === 'unknown' ? new HubApiError('unreachable', '无法连接 Hub', '检查网络或 Hub 服务后重试。') : error }) });
                if (resolved) setOutcome({ resolution: resolved.resolution });
                requestAnimationFrame(() => result.current?.focus());
            }} actions={<Button type="submit" variant="primary">解析</Button>}>
                <div className="form-grid three">
                    <SelectField label="仓库" value={scope} onChange={event => setScope(event.target.value)}
                        options={[{ value: '', label: '整个空间' }, ...catalog.repositories.filter(item => item.registered).map(item => ({ value: item.id, label: item.name }))]} />
                    <SelectField label="显式 Agent（可选）" value={agentId} onChange={event => setAgentId(event.target.value)}
                        options={[{ value: '', label: '使用我的选择' }, ...catalog.agents.filter(agent => agent.view === 'definition' && agent.permissions.invoke).map(agent => ({ value: agent.id, label: agent.name }))]} />
                    <SelectField label="显式 Runtime（可选）" value={runtimeId} onChange={event => setRuntimeId(event.target.value)}
                        options={[{ value: '', label: '按选择或定义' }, ...catalog.runtimes.filter(runtime => runtime.permissions.use).map(runtime => ({ value: runtime.id, label: runtime.name }))]} />
                </div>
            </Form>
            <div ref={result} className="resolution" role="status" tabIndex={-1}>
                {outcome?.error && <Banner tone="warn" title={outcome.error.message}>{outcome.error.hint || undefined}</Banner>}
                {r && (
                    <div className="resolution-ok">
                        <p className="resolution-path"><Chain label="解析结果" parts={[`${r.definition.name} · v${r.version}`, runtimeName(r.target.runtimeId), machineName(r.target.machineId)]} /></p>
                        <Facts rows={[['Agent 来自', sourceLabels[r.selection.agent] ?? r.selection.agent], ['Runtime 来自', sourceLabels[r.selection.runtime] ?? r.selection.runtime],
                            ['原生类型', flavorLabels[r.target.flavor] ?? r.target.flavor], ['配置指纹', <Mono>{r.resolvedVersion}</Mono>]]} />
                        <p className="hint">执行目标已经确认；模型认证、参数兼容和真实执行还没有检查。</p>
                    </div>
                )}
            </div>
        </Block>
    );
}
