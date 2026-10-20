import { useEffect, useState } from 'react';
import {
    Badge, Banner, Button, Dialog, EmptyState, Facts, Form, Icon, InlineEdit, Menu, MenuItem, Mono, PageHead, PanelHead, PanelInner, Row, RowList, Section, SplitView,
    Tag, TextAreaField, TextField, toast, useConfirm, useSplit,
} from '@runweft/ui';
import type { HubError } from '../mock.js';
import { Loaded, demo, usePage, useProto } from '../proto';

export function RepositoriesPage() {
    const page = usePage(() => demo.api.repositories());
    const split = useSplit<string>();
    const [creating, setCreating] = useState(false);
    return (
        <Loaded page={page} label="仓库">{repositories => {
            const opened = repositories.find((repo: any) => repo.id === split.key);
            const register = <Button icon="plus" variant="primary" onClick={() => setCreating(true)}>登记仓库</Button>;
            return (
                <div className="page-inner">
                    <PageHead title="仓库" description="空间里的项目目录，用来识别 Git 项目、限定 Agent 的作用范围。不保存 Git 凭据，也不读取代码。" actions={register} />
                    <SplitView split={split} label="仓库详情" list={repositories.length ? (
                        <RowList label="仓库列表">
                            {repositories.map((repo: any) => (
                                <Row key={repo.id} rowKey={repo.id} opened={split.key === repo.id} onOpen={from => split.open(repo.id, { from })}>
                                    <span className="row-icon" data-tone={repo.registered ? 'accent' : 'neutral'}><Icon name="repo" /></span>
                                    <span className="row-main">
                                        <span className="row-top"><strong className="row-title">{repo.name}</strong>{!repo.registered && <Tag tone="warn">已取消登记</Tag>}<span className="row-aside">{repo.ownerId === demo.user.id ? '' : `${repo.ownerName}登记`}</span></span>
                                        <span className="row-text mono" data-tone={repo.aliases.length ? undefined : 'muted'}>{repo.aliases[0] ?? '没有 Git 别名'}</span>
                                        <span className="row-meta">
                                            {repo.aliases.length > 1 && <Tag icon="link">另有 {repo.aliases.length - 1} 个别名</Tag>}
                                            <Tag icon="machine" tone={repo.checkouts.length ? 'accent' : undefined}>{repo.checkouts.length ? `我的 checkout ${repo.checkouts.length} 处` : '还没有我的 checkout'}</Tag>
                                        </span>
                                    </span>
                                </Row>
                            ))}
                        </RowList>
                    ) : <EmptyState icon="repo" title="还没有仓库" actions={register}>不在 Git 里的工作可以直接使用空间级 Agent。Git 项目可以先登记，再让 Agent 绑定本机 checkout。</EmptyState>}>
                        {opened && <RepositoryPanel key={opened.id} repo={opened} onClose={() => split.close()} />}
                    </SplitView>
                    <CreateDialog open={creating} onOpenChange={setCreating} onCreated={id => split.open(id)} />
                </div>
            );
        }}</Loaded>
    );
}

function RepositoryPanel({ repo, onClose }: { repo: any; onClose(): void }) {
    const proto = useProto(), confirm = useConfirm();
    const [alias, setAlias] = useState('');
    const [aliasError, setAliasError] = useState<HubError | null>(null);
    const manage = repo.permissions.manage;
    const mutate = async (action: () => Promise<unknown>, success: string) => { const done = await proto.run(action, { success }); if (done) proto.refresh(); return done; };
    return (
        <PanelInner>
            <PanelHead title={repo.name} badges={repo.registered ? <Badge tone="ok" icon="st-done">已登记</Badge> : <Badge tone="warn" icon="st-attention">已取消登记</Badge>}
                sub={<><span>{repo.ownerId === demo.user.id ? '你登记的仓库' : `${repo.ownerName}登记`}</span><Mono>{repo.id}</Mono></>}
                actions={manage && (
                    <Menu label="仓库操作" align="end" trigger={<Button icon="more" iconOnly label="仓库操作" variant="ghost" size="sm" />}>
                        <MenuItem icon={repo.registered ? 'minus-circle' : 'refresh'} danger={repo.registered} onSelect={async () => {
                            if (await confirm('只改变这个仓库在空间目录里的登记状态，不删除 Git 文件、Agent 或个人选择。取消登记后不再用于新的解析。', { title: repo.registered ? '取消仓库登记？' : '恢复仓库登记？', confirmLabel: repo.registered ? '取消登记' : '恢复登记', danger: repo.registered }))
                                await mutate(() => demo.api.setRepositoryRegistered(repo.id, !repo.registered), repo.registered ? '仓库已取消登记' : '仓库已恢复登记');
                        }}>{repo.registered ? '取消仓库登记' : '恢复仓库登记'}</MenuItem>
                    </Menu>
                )}
                onClose={onClose} />
            {!manage && <Banner tone="lock" title="只能查看">仓库的名称、别名和登记由登记人或空间管理员维护。</Banner>}
            {manage && <Section title="名称"><InlineEdit label="仓库名称" value={repo.name} onSave={async name => !!await mutate(() => demo.api.renameRepository(repo.id, name), '仓库名称已保存')} /></Section>}
            <Section title="Git 别名">
                <p className="section-lead">用来识别同一个项目，不保存 Git 凭据，也不会修改任何 Git remote。</p>
                {repo.aliases.length ? (
                    <ul className="alias-list">
                        {repo.aliases.map((value: string) => (
                            <li key={value}><Icon name="link" /><Mono>{value}</Mono>
                                {manage && <Button icon="x" iconOnly label={`移除别名 ${value}`} variant="ghost" size="sm" onClick={async () => {
                                    if (await confirm(`移除 ${value} 与这个仓库的识别关联？不会修改任何 Git remote。`, { title: '移除别名？', confirmLabel: '移除', danger: true }))
                                        await mutate(() => demo.api.removeAlias(repo.id, value), '别名已移除');
                                }} />}
                            </li>
                        ))}
                    </ul>
                ) : <p className="muted">还没有别名。也可以让 Agent 在本机显式绑定 checkout。</p>}
                {manage && (
                    <Form className="inline-add" onSubmit={async () => {
                        setAliasError(null);
                        const done = await proto.run(() => demo.api.addAlias(repo.id, alias), { onError: setAliasError });
                        if (done) { toast('别名已添加'); setAlias(''); proto.refresh(); }
                    }} actions={<Button type="submit" variant="primary">添加别名</Button>}>
                        <TextField label="添加 Git 别名" required mono spellCheck={false} placeholder="git@github.com:team/project.git" value={alias} onChange={event => setAlias(event.target.value)} />
                        {aliasError && <Banner tone="danger" title={aliasError.message}>{aliasError.hint || undefined}</Banner>}
                    </Form>
                )}
            </Section>
            <Section title="我的 checkout">
                <p className="section-lead">你的机器上已确认的 Git 关联。新增、重新绑定或解除由对应机器上的 Agent 执行，浏览器不猜测本地路径。</p>
                {repo.checkouts.length ? (
                    <ul className="checkout-list">
                        {repo.checkouts.map((c: any) => (
                            <li key={`${c.machineId}:${c.cwd}`}>
                                <div className="checkout-head"><Icon name="machine" /><strong>{c.machineName}</strong></div>
                                <Facts compact rows={[['工作目录', <Mono>{c.cwd}</Mono>], ['Git 公共目录', <Mono>{c.commonDir}</Mono>]]} />
                            </li>
                        ))}
                    </ul>
                ) : <EmptyState icon="machine" title="还没有 checkout 关联">让 Agent 在项目里执行 repository inspect，再按本机 ID 执行 repository match 或 bind。</EmptyState>}
            </Section>
        </PanelInner>
    );
}

function CreateDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange(open: boolean): void; onCreated(id: string): void }) {
    const proto = useProto();
    const [name, setName] = useState('');
    const [aliases, setAliases] = useState('');
    useEffect(() => { if (open) { setName(''); setAliases(''); } }, [open]);
    return (
        <Dialog open={open} onOpenChange={onOpenChange} title="登记仓库" description="仓库属于当前空间，用来识别 Git 项目、限定 Agent 的作用范围。"
            footer={<><Button onClick={() => onOpenChange(false)}>取消</Button><Button type="submit" form="create-repository" variant="primary">登记仓库</Button></>}>
            <Form id="create-repository" onSubmit={async () => {
                const repo = await proto.run(() => demo.api.createRepository(name.trim(), aliases.split('\n').map(value => value.trim()).filter(Boolean)));
                if (!repo || repo === true) return;
                onOpenChange(false); toast('仓库已登记。在项目里让 Agent 观察 Git 并绑定 checkout。'); proto.refresh(); onCreated((repo as any).id);
            }}>
                <TextField label="仓库名称" required maxLength={80} placeholder="例如 runweft-web" value={name} onChange={event => setName(event.target.value)} />
                <TextAreaField label="Git 别名（可选，每行一个）" rows={3} mono spellCheck={false} hint="支持 HTTP(S)、ssh、git 地址和 git@host:path 形式。" value={aliases} onChange={event => setAliases(event.target.value)} />
            </Form>
        </Dialog>
    );
}
