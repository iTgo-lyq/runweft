import { useState } from 'react';
import {
    Badge, Banner, Button, Disclosure, EmptyState, Facts, Form, Icon, Loading, Menu, MenuItem, Mono, PageHead, PanelHead, PanelInner, Row, RowList, Section,
    Segmented, SelectField, SplitView, SwitchRow, Tabs, Tag, TextAreaField, TextField, fullTime, toast, useConfirm, useSplit,
} from '@runweft/ui';
import type { AccessMode, AgentDefinition, AgentVersion, AgentView } from '../../agents/types';
import type { Repository } from '../../repositories/store';
import type { RuntimeView } from '../../resources/types';
import type { HubApiError } from '../api/http';
import { flavorLabels, useMutate, useOwners } from '../resources/common';
import { Resource, useResource, useWorkspace } from '../workspace/context';

export const accessLabels: Record<AccessMode, string> = { private: '私有', members: '指定成员', space: '空间成员' };
const blank: AgentDefinition = { name: '', description: '', instructions: '', repositoryId: null, runtimeId: null, flavor: null, model: null, reasoningEffort: null };
type Catalog = { agents: AgentView[]; repositories: Repository[]; runtimes: RuntimeView[] };
type Tab = 'definition' | 'history' | 'share';

export function repositoryName(repositories: Repository[], id: string | null) {
    return id ? repositories.find(item => item.id === id)?.name ?? `原仓库不可见 · ${id}` : '整个空间';
}

/** Why an Agent the user can see cannot be called right now, in the order the Hub checks it. */
function notInvocable(agent: AgentView) {
    return !agent.registered ? '这个 Agent 已取消登记。恢复登记后才能调用。' : agent.blocked ? '这个 Agent 已在此空间停用。' : !agent.ownerPresent ? '所属人已经离开这个空间。' : '当前不满足调用条件。';
}

export function AgentsPage() {
    const ws = useWorkspace();
    const catalog = useResource<Catalog>(() => Promise.all([
        ws.spaceApi.request<{ agents: AgentView[] }>('/agents'), ws.spaceApi.request<{ repositories: Repository[] }>('/repositories'),
        ws.spaceApi.request<{ runtimes: RuntimeView[] }>('/resources/runtimes'),
    ]).then(([agents, repositories, runtimes]) => ({ agents: agents.agents, repositories: repositories.repositories, runtimes: runtimes.runtimes })), [ws.spaceApi]);
    const owner = useOwners();
    const split = useSplit<string>();
    const [editing, setEditing] = useState(false);
    const [tab, setTab] = useState<Tab>('definition');
    const open = (id: string, from?: HTMLElement) => { setEditing(id === 'new'); setTab('definition'); split.open(id, { from }); };
    const data = catalog.data, opened = data?.agents.find(agent => agent.id === split.key);
    const create = <Button icon="plus" variant="primary" onClick={event => open('new', event.currentTarget)}>创建 Agent</Button>;
    return (
        <div className="page-inner">
            <PageHead title="Agent" description="一份带指令的执行配置。共享只开放当前定义和调用，不开放修改和历史。" actions={create} />
            <SplitView split={split} label="Agent 详情" list={
                <Resource resource={catalog} label="Agent">{({ agents, repositories }) => agents.length ? (
                    <RowList label="Agent 列表">
                        {agents.map(agent => {
                            const governance = agent.view === 'governance', mine = agent.permissions.edit;
                            return (
                                <Row key={agent.id} rowKey={agent.id} opened={split.key === agent.id} onOpen={from => open(agent.id, from)}>
                                    <span className="row-icon" data-tone={governance ? 'neutral' : 'accent'}><Icon name={governance ? 'lock' : 'agent'} /></span>
                                    <span className="row-main">
                                        <span className="row-top"><strong className="row-title">{agent.name}</strong><span className="row-version">v{agent.version}</span><span className="row-aside">{mine ? '' : owner(agent.ownerId)}</span></span>
                                        <span className="row-text" data-tone={governance || (agent.view === 'definition' && !agent.definition.description) ? 'muted' : undefined}>
                                            {governance ? `${owner(agent.ownerId)}的私有 Agent。你只能查看治理概要。` : agent.definition.description || '没有用途说明'}
                                        </span>
                                        <span className="row-meta">
                                            <Tag icon="repo">{repositoryName(repositories, agent.repositoryId)}</Tag>
                                            <Tag icon="share">{accessLabels[agent.accessMode]}</Tag>
                                            {!agent.registered && <Tag tone="warn">已取消登记</Tag>}
                                            {agent.blocked && <Tag tone="warn">已在此空间停用</Tag>}
                                            {agent.registered && !agent.blocked && !agent.permissions.invoke && !governance && <Tag tone="warn">不可调用</Tag>}
                                        </span>
                                    </span>
                                </Row>
                            );
                        })}
                    </RowList>
                ) : (
                    <EmptyState icon="agent" title="还没有 Agent" actions={create}>Agent 是一份带指令的配置：做什么、作用在哪个仓库、默认用哪个 Runtime。创建你自己的，或请所有者分享给你。</EmptyState>
                )}</Resource>
            }>
                {data && split.key === 'new' && <Editor catalog={data} onClose={() => split.close()} onSaved={agent => { catalog.reload(); setEditing(false); split.open(agent.id); }} />}
                {data && opened && (opened.view === 'governance'
                    ? <GovernancePanel agent={opened} catalog={data} ownerName={owner(opened.ownerId)} reload={catalog.reload} onClose={() => split.close()} />
                    : editing && opened.permissions.edit
                        ? <Editor key={opened.id} agent={opened} catalog={data} onClose={() => setEditing(false)} onSaved={() => { catalog.reload(); setEditing(false); }} />
                        : <DetailPanel key={opened.id} agent={opened} catalog={data} ownerName={owner(opened.ownerId)} tab={tab} onTab={setTab}
                            onEdit={() => setEditing(true)} reload={catalog.reload} onClose={() => split.close()} />)}
            </SplitView>
        </div>
    );
}

function Governance({ agent, reload }: { agent: AgentView; reload: () => void }) {
    const ws = useWorkspace(), confirm = useConfirm(), mutate = useMutate(reload);
    if (!agent.permissions.govern) return null;
    return (
        <Section title="此空间的治理">
            <SwitchRow label={`在“${ws.space.name}”停用这个 Agent`} description="只变更这个空间的治理状态，不取得定义的编辑权或执行内容。" checked={agent.blocked}
                onCheckedChange={async on => {
                    if (!await confirm(on ? '停用后，这个空间不能再调用它。所属人的内容、登记和分享不会改变。' : '解除停用后，它会按原来的分享范围重新可用。',
                        { title: on ? '在此空间停用？' : '解除停用？', confirmLabel: on ? '停用' : '解除停用', danger: on })) return;
                    await mutate(`/agents/${encodeURIComponent(agent.id)}/block`, on ? 'PUT' : 'DELETE', {}, on ? 'Agent 已在此空间停用' : 'Agent 已解除停用');
                }} />
        </Section>
    );
}

function GovernancePanel({ agent, catalog, ownerName, reload, onClose }: { agent: AgentView; catalog: Catalog; ownerName: string; reload: () => void; onClose: () => void }) {
    return (
        <PanelInner>
            <PanelHead title={agent.name} badges={<Badge tone="neutral" icon="lock">{accessLabels[agent.accessMode]}</Badge>} sub={<span>{ownerName}的 Agent</span>} onClose={onClose} />
            <Banner tone="lock" title="只能查看治理概要">管理员看不到私有定义、模型参数或指令。</Banner>
            <Section title="概要">
                <Facts rows={[
                    ['所属人', `${ownerName}${agent.ownerPresent ? '' : '（已离开空间）'}`], ['作用范围', repositoryName(catalog.repositories, agent.repositoryId)],
                    ['版本', `v${agent.version}`], ['登记', agent.registered ? '已登记' : '已取消'], ['分享', accessLabels[agent.accessMode]],
                    ['此空间', agent.blocked ? '已停用' : '未停用'], ['Agent ID', <Mono>{agent.id}</Mono>],
                ]} />
            </Section>
            <Governance agent={agent} reload={reload} />
        </PanelInner>
    );
}

function DetailPanel({ agent, catalog, ownerName, tab, onTab, onEdit, reload, onClose }: {
    agent: Extract<AgentView, { view: 'definition' }>; catalog: Catalog; ownerName: string; tab: Tab; onTab(tab: Tab): void; onEdit(): void; reload: () => void; onClose: () => void;
}) {
    const confirm = useConfirm(), mutate = useMutate(reload), mine = agent.permissions.edit;
    const items = [{ id: 'definition' as const, label: '定义' }, ...(agent.permissions.history ? [{ id: 'history' as const, label: '版本历史' }] : []),
        ...(agent.permissions.share ? [{ id: 'share' as const, label: '分享' }] : [])];
    const current = items.some(item => item.id === tab) ? tab : 'definition';
    const path = `/agents/${encodeURIComponent(agent.id)}`;
    return (
        <PanelInner>
            <PanelHead title={agent.name} badges={<><Badge tone="neutral">v{agent.version}</Badge><Badge tone={agent.accessMode === 'private' ? 'neutral' : 'accent'} icon="share">{accessLabels[agent.accessMode]}</Badge></>}
                sub={<span>{mine ? '你的 Agent' : `${ownerName}分享给你`}</span>}
                actions={mine && <>
                    <Button icon="edit" size="sm" onClick={onEdit}>编辑定义</Button>
                    <Menu label="Agent 操作" align="end" trigger={<Button icon="more" iconOnly label="Agent 操作" variant="ghost" size="sm" />}>
                        <MenuItem icon={agent.registered ? 'minus-circle' : 'refresh'} danger={agent.registered} onSelect={async () => {
                            if (!await confirm(agent.registered ? '取消后不再接受新调用，历史版本和任务仍然保留。' : '恢复后会按原来的分享范围重新可用。',
                                { title: agent.registered ? '取消 Agent 登记？' : '恢复 Agent 登记？', confirmLabel: agent.registered ? '取消登记' : '恢复登记', danger: agent.registered })) return;
                            await mutate(agent.registered ? path : `${path}/register`, agent.registered ? 'DELETE' : 'POST', {}, agent.registered ? 'Agent 已取消登记' : 'Agent 已恢复登记');
                        }}>{agent.registered ? '取消 Agent 登记' : '恢复 Agent 登记'}</MenuItem>
                    </Menu>
                </>}
                onClose={onClose} />
            {!agent.permissions.invoke && <Banner tone="warn" title="当前不能调用">{notInvocable(agent)}</Banner>}
            {!mine && <Banner tone="info" title={`由${ownerName}分享给你`}>你可以调用它，也能看到当前定义；修改、历史版本和历史任务不对你开放。</Banner>}
            <Tabs label="Agent 详情" items={items} value={current} onValueChange={onTab}>
                {current === 'definition' && <Definition agent={agent} catalog={catalog} />}
                {current === 'history' && <History agent={agent} catalog={catalog} />}
                {current === 'share' && <ShareForm agent={agent} reload={reload} />}
            </Tabs>
            <Governance agent={agent} reload={reload} />
        </PanelInner>
    );
}

function runtimeLabel(runtimes: RuntimeView[], id: string | null) {
    return id ? runtimes.find(item => item.id === id)?.name ?? `原 Runtime 不可见 · ${id}` : '未指定';
}

function Definition({ agent, catalog }: { agent: Extract<AgentView, { view: 'definition' }>; catalog: Catalog }) {
    const d = agent.definition, runtime = catalog.runtimes.find(item => item.id === d.runtimeId);
    return (
        <>
            <div className="digest"><div className="digest-item"><h4>用途</h4><p>{d.description || '没有用途说明'}</p></div></div>
            <article className="reading" aria-label="指令"><h4 className="reading-title">指令</h4><div className="report-text" tabIndex={0}>{d.instructions || '没有指令'}</div></article>
            <Facts rows={[
                ['作用仓库', repositoryName(catalog.repositories, d.repositoryId)],
                ['Runtime', runtime ? <span>{runtime.name} {runtime.eligibility.eligible ? <Badge tone="ok">可以选用</Badge> : <Badge tone="warn">{runtime.eligibility.reason?.message ?? '现在不能选用'}</Badge>}</span> : runtimeLabel(catalog.runtimes, d.runtimeId)],
                ['原生类型', d.flavor ? flavorLabels[d.flavor] : '由执行目标决定'], ['模型', d.model ?? '默认'], ['推理等级', d.reasoningEffort ?? '默认'],
                ['内容指纹', <Mono>{agent.contentHash}</Mono>], ['Agent ID', <Mono>{agent.id}</Mono>],
            ]} />
        </>
    );
}

function History({ agent, catalog }: { agent: AgentView; catalog: Catalog }) {
    const ws = useWorkspace();
    const versions = useResource(() => ws.spaceApi.request<{ versions: AgentVersion[] }>(`/agents/${encodeURIComponent(agent.id)}/versions`).then(value => value.versions), [ws.spaceApi, agent.id, agent.version]);
    return (
        <>
            <p className="section-lead">每次保存都会生成新版本。已接受的任务继续使用接受时的版本。</p>
            <Resource resource={versions} label="版本历史">{list => (
                <ol className="versions">
                    {[...list].reverse().map(version => (
                        <li key={version.version}>
                            <Disclosure open={version.version === agent.version} summary={<><strong>v{version.version}</strong><span>{fullTime(version.createdAt)}</span>{version.version === agent.version && <Badge tone="accent">当前</Badge>}</>}>
                                <Facts rows={[['内容指纹', <Mono>{version.contentHash}</Mono>], ['Runtime', runtimeLabel(catalog.runtimes, version.definition.runtimeId)],
                                    ['模型', version.definition.model ?? '默认'], ['推理等级', version.definition.reasoningEffort ?? '默认']]} />
                                <div className="report-text compact">{version.definition.instructions || '没有指令'}</div>
                            </Disclosure>
                        </li>
                    ))}
                </ol>
            )}</Resource>
        </>
    );
}

function ShareForm({ agent, reload }: { agent: Extract<AgentView, { view: 'definition' }>; reload: () => void }) {
    const ws = useWorkspace(), confirm = useConfirm(), mutate = useMutate(reload);
    const members = useResource(() => ws.identityApi.members(ws.space.id), [ws.identityApi, ws.space.id]);
    const [mode, setMode] = useState<AccessMode>(agent.accessMode);
    const [chosen, setChosen] = useState<string[]>(agent.memberIds ?? []);
    return (
        <Form onSubmit={async () => {
            if (!await confirm('变更这个 Agent 的读取和调用范围，不会分享历史任务；撤回会让对应成员的调用失效。', { title: '保存分享范围？', confirmLabel: '保存' })) return;
            await mutate(`/agents/${encodeURIComponent(agent.id)}/access`, 'PUT', { mode, memberIds: mode === 'members' ? chosen : [] }, '分享范围已保存');
        }} actions={<Button type="submit" variant="primary">保存分享范围</Button>}>
            <p className="section-lead">分享只开放当前定义的读取和调用，不开放修改、历史版本或历史任务。Runtime 的使用权仍要单独取得。</p>
            <Segmented label="分享范围" value={mode} onValueChange={setMode} options={(['private', 'members', 'space'] as const).map(value => ({ value, label: accessLabels[value] }))} />
            {mode === 'members' && (
                <fieldset className="member-choices">
                    <legend>可以使用的成员</legend>
                    {members.data ? members.data.filter(member => member.userId !== ws.identity.id).map(member => (
                        <label className="check" key={member.userId}>
                            <input type="checkbox" checked={chosen.includes(member.userId)} onChange={event => setChosen(list => event.target.checked ? [...list, member.userId] : list.filter(id => id !== member.userId))} />
                            <span>{member.name}</span>
                        </label>
                    )) : <Loading />}
                    {members.data && members.data.length < 2 && <p className="hint">这个空间还没有其他成员。</p>}
                </fieldset>
            )}
        </Form>
    );
}

function Editor({ agent, catalog, onClose, onSaved }: { agent?: Extract<AgentView, { view: 'definition' }>; catalog: Catalog; onClose(): void; onSaved(agent: AgentView): void }) {
    const ws = useWorkspace(), confirm = useConfirm();
    const initial = agent?.definition ?? blank;
    const [d, setD] = useState<AgentDefinition>(initial);
    const [error, setError] = useState<HubApiError | null>(null);
    const [busy, setBusy] = useState(false);
    const set = <K extends keyof AgentDefinition>(key: K, value: AgentDefinition[K]) => setD(current => ({ ...current, [key]: value }));
    const repositories = [{ value: '', label: '整个空间' }, ...catalog.repositories.filter(item => item.registered || item.id === initial.repositoryId)
        .map(item => ({ value: item.id, label: item.registered ? item.name : `${item.name} · 已取消登记` }))];
    if (initial.repositoryId && !repositories.some(item => item.value === initial.repositoryId)) repositories.push({ value: initial.repositoryId, label: `原仓库不可见 · ${initial.repositoryId}` });
    const runtimes = [{ value: '', label: '不指定，使用个人选择' }, ...catalog.runtimes.filter(item => item.permissions.use || item.id === initial.runtimeId)
        .map(item => ({ value: item.id, label: `${item.name}${item.eligibility.eligible ? '' : ` · ${item.eligibility.reason?.message ?? '不可用'}`}` }))];
    if (initial.runtimeId && !runtimes.some(item => item.value === initial.runtimeId)) runtimes.push({ value: initial.runtimeId, label: `原 Runtime 不可见 · ${initial.runtimeId}` });
    const submit = async () => {
        setBusy(true); setError(null);
        const definition: AgentDefinition = { ...d, name: d.name.trim(), model: d.model?.trim() || null, reasoningEffort: d.reasoningEffort?.trim() || null };
        const saved = await ws.run(() => agent
            ? ws.spaceApi.request<{ agent: AgentView }>(`/agents/${encodeURIComponent(agent.id)}`, { expectedVersion: agent.version, definition }, 'PATCH')
            : ws.spaceApi.create<{ agent: AgentView }>('/agents', { definition }, message => confirm(message, { title: '核对上次创建', confirmLabel: '确认' })), { onError: setError });
        setBusy(false);
        if (!saved) return;
        toast(agent ? `已保存为 v${saved.agent.version}` : 'Agent 已创建，目前只有你能看到');
        onSaved(saved.agent);
    };
    return (
        <PanelInner>
            <PanelHead title={agent ? `编辑 ${agent.name}` : '新建 Agent'} eyebrow={agent ? `当前 v${agent.version}` : undefined} onClose={onClose} />
            <Form className="editor" stickyActions onSubmit={submit} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } }}
                actions={<><Button onClick={onClose}>取消</Button><Button type="submit" variant="primary" disabled={busy}>{agent ? `保存为 v${agent.version + 1}` : '创建 Agent'}</Button></>}>
                <TextField label="名称" required maxLength={80} value={d.name} onChange={event => set('name', event.target.value)} />
                <TextAreaField label="用途" rows={2} maxLength={4096} hint="一句话说明它做什么，成员在选择时会看到。" value={d.description} onChange={event => set('description', event.target.value)} />
                <TextAreaField label="指令" rows={9} maxLength={32768} hint="交给执行 Agent 的业务指令。" value={d.instructions} onChange={event => set('instructions', event.target.value)} />
                <div className="form-grid">
                    <SelectField label="作用仓库" options={repositories} value={d.repositoryId ?? ''} onChange={event => set('repositoryId', event.target.value || null)} />
                    <SelectField label="默认 Runtime" options={runtimes} value={d.runtimeId ?? ''} onChange={event => set('runtimeId', event.target.value || null)} />
                    <SelectField label="原生类型" value={d.flavor ?? ''} onChange={event => set('flavor', (event.target.value || null) as AgentDefinition['flavor'])}
                        options={[{ value: '', label: '由执行目标决定' }, { value: 'codex', label: 'Codex' }, { value: 'claude', label: 'Claude Code' }]} />
                    <TextField label="模型（可选）" maxLength={256} placeholder="默认" value={d.model ?? ''} onChange={event => set('model', event.target.value)} />
                    <TextField label="推理等级（可选）" maxLength={256} placeholder="默认" value={d.reasoningEffort ?? ''} onChange={event => set('reasoningEffort', event.target.value)} />
                </div>
                {(d.model?.trim() || d.reasoningEffort?.trim()) && !d.flavor && <p className="hint">填写模型或推理等级时需要选择原生类型。</p>}
                {error && <Banner tone={error.kind === 'unknown' ? 'warn' : 'danger'} title={error.message}>{error.hint || undefined}</Banner>}
                <p className="hint">{agent ? `保存后生成 v${agent.version + 1}。已接受的任务继续使用接受时的版本，新轮次使用新版本。` : '创建后默认只有你能看到，可以在“分享”里调整。'}</p>
            </Form>
        </PanelInner>
    );
}
