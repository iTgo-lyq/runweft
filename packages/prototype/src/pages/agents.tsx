import { useEffect, useState } from 'react';
import {
    Badge, Banner, Button, Disclosure, EmptyState, Facts, Form, Icon, Menu, MenuItem, Mono, PageHead, PanelHead, PanelInner, Row, RowList, Section, Segmented,
    SelectField, SplitView, SwitchRow, Tabs, Tag, TextAreaField, TextField, fullTime, toast, useConfirm, useSplit,
} from '@runweft/ui';
import { accessLabels, flavorLabels, type HubError } from '../mock.js';
import { Loaded, demo, usePage, useProto } from '../proto';

const blank = { name: '', description: '', instructions: '', repositoryId: null, runtimeId: null, flavor: null, model: null, reasoningEffort: null };
type Tab = 'definition' | 'history' | 'share';
type Catalog = { agents: any[]; repositories: any[]; runtimes: any[]; peers: any[] };

export function AgentsPage() {
    const page = usePage(() => Promise.all([demo.api.agents(), demo.api.repositories(), demo.api.runtimes(), demo.api.peers()])
        .then(([agents, repositories, runtimes, peers]) => ({ agents, repositories, runtimes, peers })));
    const split = useSplit<string>();
    const [editing, setEditing] = useState(false);
    const [tab, setTab] = useState<Tab>('definition');
    const open = (id: string, from?: HTMLElement | null) => { setEditing(false); if (id !== split.key) setTab('definition'); split.open(id, { from }); };
    return (
        <Loaded page={page} label="Agent">{catalog => {
            const repoName = (id: string | null) => id ? catalog.repositories.find((r: any) => r.id === id)?.name ?? `原仓库不可见 · ${id}` : '整个空间';
            const opened = catalog.agents.find((agent: any) => agent.id === split.key);
            const create = <Button icon="plus" variant="primary" onClick={event => open('new', event.currentTarget)}>创建 Agent</Button>;
            return (
                <div className="page-inner">
                    <PageHead title="Agent" description="一份带指令的执行配置。共享只开放当前定义和调用，不开放修改和历史。" actions={create} />
                    <SplitView split={split} label="Agent 详情" list={catalog.agents.length ? (
                        <RowList label="Agent 列表">
                            {catalog.agents.map((agent: any) => {
                                const governance = agent.view === 'governance';
                                return (
                                    <Row key={agent.id} rowKey={agent.id} opened={split.key === agent.id} onOpen={from => open(agent.id, from)}>
                                        <span className="row-icon" data-tone={governance ? 'neutral' : 'accent'}><Icon name={governance ? 'lock' : 'agent'} /></span>
                                        <span className="row-main">
                                            <span className="row-top"><strong className="row-title">{agent.name}</strong><span className="row-version">v{agent.version}</span><span className="row-aside">{agent.ownerId === demo.user.id ? '' : agent.ownerName}</span></span>
                                            <span className="row-text" data-tone={governance ? 'muted' : undefined}>{governance ? `${agent.ownerName}的私有 Agent。你只能查看治理概要。` : agent.definition.description || '没有用途说明'}</span>
                                            <span className="row-meta">
                                                <Tag icon="repo">{repoName(agent.repositoryId)}</Tag><Tag icon="share">{accessLabels[agent.accessMode]}</Tag>
                                                {!agent.registered && <Tag tone="warn">已取消登记</Tag>}
                                                {agent.blocked && <Tag tone="warn">已在此空间停用</Tag>}
                                                {agent.registered && !agent.blocked && !agent.invocable && !governance && <Tag tone="warn">不可调用</Tag>}
                                            </span>
                                        </span>
                                    </Row>
                                );
                            })}
                        </RowList>
                    ) : <EmptyState icon="agent" title="还没有 Agent" actions={create}>Agent 是一份带指令的配置：做什么、作用在哪个仓库、默认用哪个 Runtime。创建你自己的，或请所有者分享给你。</EmptyState>}>
                        {split.key === 'new' && <Editor catalog={catalog} onClose={() => split.close()} onSaved={saved => { setTab('definition'); split.open(saved.id); }} />}
                        {opened && (opened.view === 'governance' ? <GovernancePanel agent={opened} repoName={repoName} onClose={() => split.close()} />
                            : editing && opened.permissions.edit ? <Editor key={opened.id} agent={opened} catalog={catalog} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); setTab('definition'); }} />
                                : <DetailPanel agent={opened} catalog={catalog} repoName={repoName} tab={tab} onTab={setTab} onEdit={() => setEditing(true)} onClose={() => split.close()} />)}
                    </SplitView>
                </div>
            );
        }}</Loaded>
    );
}

function useMutate() {
    const proto = useProto();
    return async (action: () => Promise<unknown>, success: string) => {
        const done = await proto.run(action, { success });
        if (done) proto.refresh();
        return done;
    };
}

function Governance({ agent }: { agent: any }) {
    const confirm = useConfirm(), mutate = useMutate(), space = demo.space();
    if (!agent.permissions.govern) return null;
    return (
        <Section title="此空间的治理">
            <SwitchRow label={`在“${space.name}”停用这个 Agent`} description="只变更这个空间的治理状态，不取得定义的编辑权或执行内容。" checked={agent.blocked}
                onCheckedChange={async on => {
                    if (await confirm(on ? '停用后，这个空间不能再调用它。所属人的内容、登记和分享不会改变。' : '解除停用后，它会按原来的分享范围重新可用。', { title: on ? '在此空间停用？' : '解除停用？', confirmLabel: on ? '停用' : '解除停用', danger: on }))
                        await mutate(() => demo.api.setAgentBlocked(agent.id, on), on ? 'Agent 已在此空间停用' : 'Agent 已解除停用');
                }} />
        </Section>
    );
}

function GovernancePanel({ agent, repoName, onClose }: { agent: any; repoName(id: string | null): string; onClose(): void }) {
    return (
        <PanelInner>
            <PanelHead title={agent.name} badges={<Badge tone="neutral" icon="lock">{accessLabels[agent.accessMode]}</Badge>} sub={<><span>{agent.ownerName}的 Agent</span><Mono>{agent.id}</Mono></>} onClose={onClose} />
            <Banner tone="lock" title="只能查看治理概要">管理员看不到私有定义、模型参数或指令。</Banner>
            <Section title="概要">
                <Facts rows={[['所属人', `${agent.ownerName}${agent.ownerPresent ? '' : '（已离开空间）'}`], ['作用范围', repoName(agent.repositoryId)], ['版本', `v${agent.version}`],
                    ['登记', agent.registered ? '已登记' : '已取消'], ['分享', accessLabels[agent.accessMode]], ['此空间', agent.blocked ? '已停用' : '未停用']]} />
            </Section>
            <Governance agent={agent} />
        </PanelInner>
    );
}

function DetailPanel({ agent, catalog, repoName, tab, onTab, onEdit, onClose }: { agent: any; catalog: Catalog; repoName(id: string | null): string; tab: Tab; onTab(tab: Tab): void; onEdit(): void; onClose(): void }) {
    const confirm = useConfirm(), mutate = useMutate(), owner = agent.permissions.edit;
    const items = [{ id: 'definition' as const, label: '定义' }, ...(owner ? [{ id: 'history' as const, label: '版本历史' }, { id: 'share' as const, label: '分享' }] : [])];
    const current = items.some(item => item.id === tab) ? tab : 'definition';
    const runtimeName = (id: string | null) => id ? catalog.runtimes.find((r: any) => r.id === id)?.name ?? `原 Runtime 不可见 · ${id}` : '未指定';
    return (
        <PanelInner>
            <PanelHead title={agent.name} badges={<><Badge tone="neutral">v{agent.version}</Badge><Badge tone={agent.accessMode === 'private' ? 'neutral' : 'accent'} icon="share">{accessLabels[agent.accessMode]}</Badge></>}
                sub={<><span>{owner ? '你的 Agent' : `${agent.ownerName}分享给你`}</span><Mono>{agent.id}</Mono></>}
                actions={owner && <>
                    <Button icon="edit" size="sm" onClick={onEdit}>编辑定义</Button>
                    <Menu label="Agent 操作" align="end" trigger={<Button icon="more" iconOnly label="Agent 操作" variant="ghost" size="sm" />}>
                        <MenuItem icon={agent.registered ? 'minus-circle' : 'refresh'} danger={agent.registered} onSelect={async () => {
                            if (await confirm(agent.registered ? '取消后不再接受新调用，历史版本和任务仍然保留。' : '恢复后会按原来的分享范围重新可用。', { title: agent.registered ? '取消 Agent 登记？' : '恢复 Agent 登记？', confirmLabel: agent.registered ? '取消登记' : '恢复登记', danger: agent.registered }))
                                await mutate(() => demo.api.setAgentRegistered(agent.id, !agent.registered), agent.registered ? 'Agent 已取消登记' : 'Agent 已恢复登记');
                        }}>{agent.registered ? '取消 Agent 登记' : '恢复 Agent 登记'}</MenuItem>
                    </Menu>
                </>}
                onClose={onClose} />
            {!agent.invocable && <Banner tone="warn" title="当前不能调用">{!agent.registered ? '这个 Agent 已取消登记。恢复登记后才能调用。' : agent.blocked ? '这个 Agent 已在此空间停用。' : '所属人已经离开这个空间。'}</Banner>}
            {!owner && <Banner tone="info" title={`由${agent.ownerName}分享给你`}>你可以调用它，也能看到当前定义；修改、历史版本和历史任务不对你开放。</Banner>}
            <Tabs label="Agent 详情" items={items} value={current} onValueChange={onTab}>
                {current === 'definition' && <Definition agent={agent} catalog={catalog} repoName={repoName} runtimeName={runtimeName} />}
                {current === 'history' && <History agent={agent} runtimeName={runtimeName} />}
                {current === 'share' && <ShareForm agent={agent} peers={catalog.peers} />}
            </Tabs>
            <Governance agent={agent} />
        </PanelInner>
    );
}

function Definition({ agent, catalog, repoName, runtimeName }: { agent: any; catalog: Catalog; repoName(id: string | null): string; runtimeName(id: string | null): string }) {
    const d = agent.definition, runtime = catalog.runtimes.find((r: any) => r.id === d.runtimeId);
    return (
        <>
            <div className="digest"><div className="digest-item"><h4>用途</h4><p>{d.description || '没有用途说明'}</p></div></div>
            <article className="reading" aria-label="指令"><h4 className="reading-title">指令</h4><div className="report-text" tabIndex={0}>{d.instructions || '没有指令'}</div></article>
            <Facts rows={[
                ['作用仓库', repoName(d.repositoryId)],
                ['Runtime', runtime ? <span>{runtime.name} {runtime.eligibility.eligible ? <Badge tone="ok">可以选用</Badge> : <Badge tone="warn">{runtime.eligibility.reason}</Badge>}</span> : runtimeName(d.runtimeId)],
                ['原生类型', d.flavor ? flavorLabels[d.flavor] : '由执行目标决定'], ['模型', d.model ?? '默认'], ['推理等级', d.reasoningEffort ?? '默认'], ['内容指纹', <Mono>{agent.contentHash}</Mono>],
            ]} />
        </>
    );
}

function History({ agent, runtimeName }: { agent: any; runtimeName(id: string | null): string }) {
    const [versions, setVersions] = useState<any[] | null>(null);
    useEffect(() => { demo.api.agentVersions(agent.id).then(setVersions, () => setVersions([])); }, [agent.id, agent.version]);
    return (
        <>
            <p className="section-lead">每次保存都会生成新版本。已接受的任务继续使用接受时的版本。</p>
            {versions && (
                <ol className="versions">
                    {versions.map(v => (
                        <li key={v.version}>
                            <Disclosure open={v.version === agent.version} summary={<><strong>v{v.version}</strong><span>{fullTime(v.createdAt)}</span>{v.version === agent.version && <Badge tone="accent">当前</Badge>}</>}>
                                <Facts rows={[['内容指纹', <Mono>{v.contentHash}</Mono>], ['Runtime', runtimeName(v.definition.runtimeId)], ['推理等级', v.definition.reasoningEffort ?? '默认']]} />
                                <div className="report-text compact">{v.definition.instructions}</div>
                            </Disclosure>
                        </li>
                    ))}
                </ol>
            )}
        </>
    );
}

function ShareForm({ agent, peers }: { agent: any; peers: any[] }) {
    const confirm = useConfirm(), mutate = useMutate();
    const [mode, setMode] = useState<string>(agent.accessMode);
    const [chosen, setChosen] = useState<string[]>(agent.memberIds);
    return (
        <Form onSubmit={async () => {
            if (!await confirm('变更这个 Agent 的读取和调用范围，不会分享历史任务；撤回会让对应成员的调用失效。', { title: '保存分享范围？', confirmLabel: '保存' })) return;
            await mutate(() => demo.api.setAgentAccess(agent.id, mode, chosen), '分享范围已保存');
        }} actions={<Button type="submit" variant="primary">保存分享范围</Button>}>
            <p className="section-lead">分享只开放当前定义的读取和调用，不开放修改、历史版本或历史任务。Runtime 的使用权仍要单独取得。</p>
            <Segmented label="分享范围" value={mode} onValueChange={setMode} options={['private', 'members', 'space'].map(value => ({ value, label: accessLabels[value] }))} />
            <fieldset className="member-choices" hidden={mode !== 'members'}>
                <legend>可以使用的成员</legend>
                {peers.map(peer => (
                    <label className="check" key={peer.id}>
                        <input type="checkbox" value={peer.id} checked={chosen.includes(peer.id)} onChange={event => setChosen(list => event.target.checked ? [...list, peer.id] : list.filter(id => id !== peer.id))} />
                        <span>{peer.name}</span><small className="mono">{peer.username}</small>
                    </label>
                ))}
            </fieldset>
        </Form>
    );
}

function Editor({ agent, catalog, onClose, onSaved }: { agent?: any; catalog: Catalog; onClose(): void; onSaved(saved: any): void }) {
    const proto = useProto();
    const d0 = agent?.definition ?? blank;
    const [d, setD] = useState<any>(d0);
    const [error, setError] = useState<HubError | null>(null);
    const set = (key: string, value: unknown) => setD((current: any) => ({ ...current, [key]: value }));
    const repoChoices = [{ value: '', label: '整个空间' }, ...catalog.repositories.filter((r: any) => r.registered || r.id === d0.repositoryId).map((r: any) => ({ value: r.id, label: r.registered ? r.name : `${r.name} · 已取消登记` }))];
    const runtimeChoices = [{ value: '', label: '不指定，使用个人选择' }, ...catalog.runtimes.filter((r: any) => r.permissions.use || r.id === d0.runtimeId).map((r: any) => ({ value: r.id, label: `${r.name}${r.eligibility.eligible ? '' : ` · ${r.eligibility.reason}`}` }))];
    return (
        <PanelInner>
            <PanelHead title={agent ? `编辑 ${agent.name}` : '新建 Agent'} eyebrow={agent ? `当前 v${agent.version}` : undefined} onClose={onClose} />
            <Form className="editor" stickyActions onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } }}
                onSubmit={async () => {
                    setError(null);
                    const definition = { ...d, name: d.name.trim(), model: d.model?.trim() || null, reasoningEffort: d.reasoningEffort?.trim() || null, repositoryId: d.repositoryId || null, runtimeId: d.runtimeId || null, flavor: d.flavor || null };
                    const saved = await proto.run(() => agent ? demo.api.updateAgent(agent.id, agent.version, definition) : demo.api.createAgent(definition), { onError: setError });
                    if (!saved || saved === true) return;
                    toast(agent ? `已保存为 v${(saved as any).version}` : 'Agent 已创建，目前只有你能看到');
                    proto.refresh(); onSaved(saved);
                }}
                actions={<><Button onClick={onClose}>取消</Button><Button type="submit" variant="primary">{agent ? `保存为 v${agent.version + 1}` : '创建 Agent'}</Button></>}>
                <TextField label="名称" required maxLength={80} value={d.name} onChange={event => set('name', event.target.value)} />
                <TextAreaField label="用途" rows={2} maxLength={4096} hint="一句话说明它做什么，成员在选择时会看到。" value={d.description} onChange={event => set('description', event.target.value)} />
                <TextAreaField label="指令" rows={9} maxLength={32768} hint="交给执行 Agent 的业务指令。" value={d.instructions} onChange={event => set('instructions', event.target.value)} />
                <div className="form-grid">
                    <SelectField label="作用仓库" options={repoChoices} value={d.repositoryId ?? ''} onChange={event => set('repositoryId', event.target.value || null)} />
                    <SelectField label="默认 Runtime" options={runtimeChoices} value={d.runtimeId ?? ''} onChange={event => set('runtimeId', event.target.value || null)} />
                    <SelectField label="原生类型" value={d.flavor ?? ''} onChange={event => set('flavor', event.target.value || null)} options={[{ value: '', label: '由执行目标决定' }, { value: 'codex', label: 'Codex' }, { value: 'claude', label: 'Claude Code' }]} />
                    <TextField label="模型（可选）" maxLength={256} placeholder="默认" value={d.model ?? ''} onChange={event => set('model', event.target.value)} />
                    <TextField label="推理等级（可选）" maxLength={256} placeholder="默认" value={d.reasoningEffort ?? ''} onChange={event => set('reasoningEffort', event.target.value)} />
                </div>
                {error && <Banner tone="danger" title={error.message}>{error.hint || undefined}</Banner>}
                <p className="hint">{agent ? `保存后生成 v${agent.version + 1}。已接受的任务继续使用接受时的版本，新轮次使用新版本。` : '创建后默认只有你能看到，可以在“分享”里调整。'}</p>
            </Form>
        </PanelInner>
    );
}
