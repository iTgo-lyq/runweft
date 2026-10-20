import { useEffect, useState } from 'react';
import {
    Badge, Banner, Button, Dialog, EmptyState, Facts, Form, Icon, InlineEdit, Menu, MenuItem, Mono, PageHead, PanelHead, PanelInner, Row, RowList, Section,
    SplitView, Tag, TextAreaField, TextField, toast, useConfirm, useSplit,
} from '@runweft/ui';
import type { Checkout, Repository } from '../../repositories/store';
import type { MachineView } from '../../resources/types';
import type { HubApiError } from '../api/http';
import { useMutate, useOwners } from '../resources/common';
import { Resource, useResource, useWorkspace } from '../workspace/context';

type Catalog = { repositories: Repository[]; checkouts: Checkout[]; machines: MachineView[] };

export function RepositoriesPage() {
    const ws = useWorkspace();
    const catalog = useResource<Catalog>(() => Promise.all([
        ws.spaceApi.request<{ repositories: Repository[] }>('/repositories'), ws.spaceApi.request<{ checkouts: Checkout[] }>('/checkouts'),
        ws.spaceApi.request<{ machines: MachineView[] }>('/resources/machines'),
    ]).then(([repositories, checkouts, machines]) => ({ repositories: repositories.repositories, checkouts: checkouts.checkouts, machines: machines.machines })), [ws.spaceApi]);
    const owner = useOwners();
    const split = useSplit<string>();
    const [creating, setCreating] = useState(false);
    const data = catalog.data, opened = data?.repositories.find(repository => repository.id === split.key);
    const register = <Button icon="plus" variant="primary" onClick={() => setCreating(true)}>登记仓库</Button>;
    return (
        <div className="page-inner">
            <PageHead title="仓库" description="空间里的项目目录，用来识别 Git 项目、限定 Agent 的作用范围。不保存 Git 凭据，也不读取代码。" actions={register} />
            <SplitView split={split} label="仓库详情" list={
                <Resource resource={catalog} label="仓库">{({ repositories, checkouts }) => repositories.length ? (
                    <RowList label="仓库列表">
                        {repositories.map(repository => {
                            const mine = checkouts.filter(checkout => checkout.repositoryId === repository.id);
                            return (
                                <Row key={repository.id} rowKey={repository.id} opened={split.key === repository.id} onOpen={from => split.open(repository.id, { from })}>
                                    <span className="row-icon" data-tone={repository.registered ? 'accent' : 'neutral'}><Icon name="repo" /></span>
                                    <span className="row-main">
                                        <span className="row-top">
                                            <strong className="row-title">{repository.name}</strong>
                                            {!repository.registered && <Tag tone="warn">已取消登记</Tag>}
                                            <span className="row-aside">{repository.ownerId === ws.identity.id ? '' : `${owner(repository.ownerId)}登记`}</span>
                                        </span>
                                        <span className="row-text mono" data-tone={repository.aliases.length ? undefined : 'muted'}>{repository.aliases[0]?.displayUrl ?? '没有 Git 别名'}</span>
                                        <span className="row-meta">
                                            {repository.aliases.length > 1 && <Tag icon="link">另有 {repository.aliases.length - 1} 个别名</Tag>}
                                            <Tag icon="machine" tone={mine.length ? 'accent' : undefined}>{mine.length ? `我的 checkout ${mine.length} 处` : '还没有我的 checkout'}</Tag>
                                        </span>
                                    </span>
                                </Row>
                            );
                        })}
                    </RowList>
                ) : (
                    <EmptyState icon="repo" title="还没有仓库" actions={register}>不在 Git 里的工作可以直接使用空间级 Agent。Git 项目可以先登记，再让 Agent 绑定本机 checkout。</EmptyState>
                )}</Resource>
            }>
                {data && opened && <RepositoryPanel key={opened.id} repository={opened} catalog={data} ownerName={owner(opened.ownerId)} reload={catalog.reload} onClose={() => split.close()} />}
            </SplitView>
            <CreateDialog open={creating} onOpenChange={setCreating} onCreated={repository => { catalog.reload(); split.open(repository.id); }} />
        </div>
    );
}

function RepositoryPanel({ repository, catalog, ownerName, reload, onClose }: { repository: Repository; catalog: Catalog; ownerName: string; reload: () => void; onClose: () => void }) {
    const ws = useWorkspace(), confirm = useConfirm(), mutate = useMutate(reload);
    const [alias, setAlias] = useState('');
    const [aliasError, setAliasError] = useState<HubApiError | null>(null);
    const manage = repository.permissions.manage, path = `/repositories/${encodeURIComponent(repository.id)}`;
    const checkouts = catalog.checkouts.filter(checkout => checkout.repositoryId === repository.id);
    const machineName = (id: string) => catalog.machines.find(machine => machine.id === id)?.name ?? id;
    return (
        <PanelInner>
            <PanelHead title={repository.name}
                badges={repository.registered ? <Badge tone="ok" icon="st-done">已登记</Badge> : <Badge tone="warn" icon="st-attention">已取消登记</Badge>}
                sub={<span>{repository.ownerId === ws.identity.id ? '你登记的仓库' : `${ownerName}登记`}</span>}
                actions={manage && (
                    <Menu label="仓库操作" align="end" trigger={<Button icon="more" iconOnly label="仓库操作" variant="ghost" size="sm" />}>
                        <MenuItem icon={repository.registered ? 'minus-circle' : 'refresh'} danger={repository.registered} onSelect={async () => {
                            if (!await confirm('只改变这个仓库在空间目录里的登记状态，不删除 Git 文件、Agent 或个人选择。取消登记后不再用于新的解析。',
                                { title: repository.registered ? '取消仓库登记？' : '恢复仓库登记？', confirmLabel: repository.registered ? '取消登记' : '恢复登记', danger: repository.registered })) return;
                            await mutate(repository.registered ? path : `${path}/register`, repository.registered ? 'DELETE' : 'POST', {}, repository.registered ? '仓库已取消登记' : '仓库已恢复登记');
                        }}>{repository.registered ? '取消仓库登记' : '恢复仓库登记'}</MenuItem>
                    </Menu>
                )}
                onClose={onClose} />
            {!manage && <Banner tone="lock" title="只能查看">仓库的名称、别名和登记由登记人或空间管理员维护。</Banner>}
            {manage && <Section title="名称"><InlineEdit label="仓库名称" value={repository.name} onSave={async name => !!await mutate(path, 'PATCH', { name }, '仓库名称已保存')} /></Section>}
            <Section title="Git 别名">
                <p className="section-lead">用来识别同一个项目，不保存 Git 凭据，也不会修改任何 Git remote。</p>
                {repository.aliases.length ? (
                    <ul className="alias-list">
                        {repository.aliases.map(item => (
                            <li key={item.canonicalKey}>
                                <Icon name="link" /><Mono>{item.displayUrl}</Mono>
                                {manage && <Button icon="x" iconOnly label={`移除别名 ${item.displayUrl}`} variant="ghost" size="sm" onClick={async () => {
                                    if (!await confirm(`移除 ${item.displayUrl} 与这个仓库的识别关联？不会修改任何 Git remote。`, { title: '移除别名？', confirmLabel: '移除', danger: true })) return;
                                    await mutate(`${path}/aliases`, 'DELETE', { canonicalKey: item.canonicalKey }, '别名已移除');
                                }} />}
                            </li>
                        ))}
                    </ul>
                ) : <p className="muted">还没有别名。也可以让 Agent 在本机显式绑定 checkout。</p>}
                {manage && (
                    <Form className="inline-add" onSubmit={async () => {
                        setAliasError(null);
                        const done = await ws.run(() => ws.spaceApi.request(`${path}/aliases`, { alias: alias.trim() }, 'PUT'), { success: '别名已添加', onError: setAliasError });
                        if (done) { setAlias(''); reload(); }
                    }} actions={<Button type="submit">添加别名</Button>}>
                        <TextField label="添加 Git 别名" required mono spellCheck={false} placeholder="git@github.com:team/project.git" value={alias} onChange={event => setAlias(event.target.value)} />
                        {aliasError && <Banner tone="danger" title={aliasError.message}>{aliasError.hint || undefined}</Banner>}
                    </Form>
                )}
            </Section>
            <Section title="我的 checkout">
                <p className="section-lead">你的机器上已确认的 Git 关联。新增、重新绑定或解除由对应机器上的 Agent 执行，浏览器不猜测本地路径。</p>
                {checkouts.length ? (
                    <ul className="checkout-list">
                        {checkouts.map(checkout => (
                            <li key={`${checkout.machineId}:${checkout.gitCommonDir}`}>
                                <div className="checkout-head"><Icon name="machine" /><strong>{machineName(checkout.machineId)}</strong></div>
                                <Facts compact rows={[['工作目录', <Mono>{checkout.cwd}</Mono>], ['Git 公共目录', <Mono>{checkout.gitCommonDir}</Mono>]]} />
                            </li>
                        ))}
                    </ul>
                ) : <EmptyState icon="machine" title="还没有 checkout 关联">让 Agent 在项目里执行 repository inspect，再按本机 ID 执行 repository match 或 bind。</EmptyState>}
            </Section>
            <Section title="标识"><Facts rows={[['仓库 ID', <Mono>{repository.id}</Mono>]]} /></Section>
        </PanelInner>
    );
}

function CreateDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange(open: boolean): void; onCreated(repository: Repository): void }) {
    const ws = useWorkspace(), confirm = useConfirm();
    const [name, setName] = useState('');
    const [aliases, setAliases] = useState('');
    const [error, setError] = useState<HubApiError | null>(null);
    const [busy, setBusy] = useState(false);
    useEffect(() => { if (open) { setName(''); setAliases(''); setError(null); } }, [open]);
    return (
        <Dialog open={open} onOpenChange={onOpenChange}
            title="登记仓库" description="仓库属于当前空间，用来识别 Git 项目、限定 Agent 的作用范围。"
            footer={<><Button onClick={() => onOpenChange(false)}>取消</Button><Button type="submit" form="create-repository" variant="primary" disabled={busy}>登记仓库</Button></>}>
            <Form id="create-repository" onSubmit={async () => {
                setBusy(true); setError(null);
                const payload = { name: name.trim(), aliases: aliases.split('\n').map(value => value.trim()).filter(Boolean) };
                const created = await ws.run(() => ws.spaceApi.create<{ repository: Repository }>('/repositories', payload, message => confirm(message, { title: '核对上次创建', confirmLabel: '确认' })), { onError: setError });
                setBusy(false);
                if (!created) return;
                onOpenChange(false); toast('仓库已登记。在项目里让 Agent 观察 Git 并绑定 checkout。'); onCreated(created.repository);
            }}>
                <TextField label="仓库名称" required maxLength={80} placeholder="例如 runweft-web" value={name} onChange={event => setName(event.target.value)} />
                <TextAreaField label="Git 别名（可选，每行一个）" rows={3} mono spellCheck={false} hint="支持 HTTP(S)、ssh、git 地址和 git@host:path 形式。" value={aliases} onChange={event => setAliases(event.target.value)} />
                {error && <Banner tone={error.kind === 'unknown' ? 'warn' : 'danger'} title={error.message}>{error.hint || undefined}</Banner>}
            </Form>
        </Dialog>
    );
}
