import { useState } from 'react';
import {
    Badge, Banner, Button, EmptyState, Facts, Icon, InlineEdit, Menu, MenuItem, Mono, PageHead, PanelHead, PanelInner, Row, RowList, Section,
    SplitView, SwitchRow, Tag, fullTime, relativeTime, useConfirm, useSplit,
} from '@runweft/ui';
import type { Discovery } from '../../../resources/types';
import type { CredentialInfo, MachineView } from '../../resources/types';
import { Resource, useResource, useWorkspace } from '../workspace/context';
import { ConnectionBadge, ListHead, flavorLabels, useMutate, useOwners } from './common';

const base = '/resources/machines';

export function MachinesPage() {
    const ws = useWorkspace();
    const machines = useResource(() => ws.spaceApi.request<{ machines: MachineView[] }>(base).then(value => value.machines), [ws.spaceApi]);
    const owner = useOwners();
    const split = useSplit<string>();
    const opened = machines.data?.find(machine => machine.id === split.key);
    return (
        <div className="page-inner">
            <PageHead title="机器" description="执行任务的电脑或服务器。首次接入和凭据轮换都在那台机器上由 Agent 完成。"
                actions={<Button icon="plus" variant="primary" onClick={() => ws.showOnboarding('machine')}>接入新机器</Button>} />
            <SplitView split={split} label="机器详情" list={
                <Resource resource={machines} label="机器">{list => list.length ? (
                    <>
                        {list.some(machine => machine.connection === 'offline') && <Banner tone="offline" title="有机器离线">离线机器上的 Runtime 暂时不可选；已接受的任务记录不受影响。</Banner>}
                        <ListHead columns={['', '名称', '连接', '此空间', '最后活动']} />
                        <RowList label="机器列表" table>
                            {list.map(machine => {
                                const associated = machine.permissions.manage ? !!machine.spaceIds?.includes(ws.space.id) : true;
                                const scope = !associated ? '未关联' : machine.blockedInSpace ? '已在此空间停用' : '已关联';
                                return (
                                    <Row key={machine.id} rowKey={machine.id} opened={split.key === machine.id} onOpen={from => split.open(machine.id, { from })}>
                                        <span className="row-icon"><Icon name="machine" /></span>
                                        <span className="cell cell-name">
                                            <strong className="row-title">{machine.name}</strong>
                                            <small>{machine.permissions.manage ? '你的机器' : `${owner(machine.ownerId)}的机器`}</small>
                                            {!machine.registered && <Tag tone="warn">已取消登记</Tag>}
                                        </span>
                                        <span className="cell" data-label="连接"><ConnectionBadge state={machine.connection} /></span>
                                        <span className="cell" data-label="此空间" data-priority="low" data-tone={machine.blockedInSpace ? 'warn' : associated ? undefined : 'muted'}>{scope}</span>
                                        <span className="cell cell-muted" data-label="最后活动" data-priority="low">{machine.lastActiveAt ? relativeTime(machine.lastActiveAt) : '暂无观察'}</span>
                                    </Row>
                                );
                            })}
                        </RowList>
                    </>
                ) : (
                    <EmptyState icon="machine" title="还没有机器" actions={<Button icon="link" onClick={() => ws.showOnboarding('machine')}>查看接入说明</Button>}>
                        在要执行任务的电脑或服务器上，让 Agent 完成接入。接入后会出现在这里。
                    </EmptyState>
                )}</Resource>
            }>
                {opened && (opened.permissions.manage
                    ? <OwnerPanel key={opened.id} machine={opened} reload={machines.reload} onClose={() => split.close()} />
                    : <SummaryPanel machine={opened} ownerName={owner(opened.ownerId)} reload={machines.reload} onClose={() => split.close()} />)}
            </SplitView>
        </div>
    );
}

function Governance({ machine, reload }: { machine: MachineView; reload: () => void }) {
    const ws = useWorkspace(), confirm = useConfirm(), mutate = useMutate(reload);
    if (!machine.permissions.govern) return null;
    return (
        <Section title="此空间的治理">
            <SwitchRow label={`在“${ws.space.name}”停用这台机器`} description="只影响这个空间的新任务；所有权、其他空间和已接受的任务不受影响。" checked={machine.blockedInSpace}
                onCheckedChange={async on => {
                    if (!await confirm(on ? `停用后，“${ws.space.name}”的成员不能再用这台机器执行新任务。` : '解除停用后，这台机器上已共享的 Runtime 会重新可选。',
                        { title: on ? '在此空间停用？' : '解除停用？', confirmLabel: on ? '停用' : '解除停用', danger: on })) return;
                    await mutate(`/resources/spaces/${encodeURIComponent(ws.space.id)}/blocks/machine/${encodeURIComponent(machine.id)}`, on ? 'PUT' : 'DELETE', {}, on ? '已在此空间停用' : '已解除停用');
                }} />
        </Section>
    );
}

function OwnerPanel({ machine, reload, onClose }: { machine: MachineView; reload: () => void; onClose: () => void }) {
    const ws = useWorkspace(), confirm = useConfirm(), mutate = useMutate(reload);
    const path = `${base}/${encodeURIComponent(machine.id)}`;
    const credential = useResource(() => ws.spaceApi.request<{ credential: CredentialInfo }>(`${path}/credential`).then(value => value.credential), [ws.spaceApi, path]);
    const [discovery, setDiscovery] = useState<Discovery | null>(null);
    const [probing, setProbing] = useState(false);
    const revoked = credential.data?.status === 'revoked';
    const after = (done: unknown) => { if (done) credential.reload(); };
    return (
        <PanelInner>
            <PanelHead title={machine.name} badges={<><ConnectionBadge state={machine.connection} />{!machine.registered && <Badge tone="warn">已取消登记</Badge>}</>}
                sub={<span>你的机器</span>}
                actions={
                    <Menu label="机器操作" align="end" trigger={<Button icon="more" iconOnly label="机器操作" variant="ghost" size="sm" />}>
                        {credential.data?.status === 'active' && <MenuItem icon="key" danger onSelect={async () => {
                            if (!await confirm('撤销后 Runner 无法继续连接。需要在这台机器上让 Agent 轮换凭据并重启 Runner。', { title: '撤销机器凭据？', confirmLabel: '撤销凭据', danger: true })) return;
                            after(await mutate(`${path}/credential`, 'DELETE', {}, '机器凭据已撤销'));
                        }}>撤销机器凭据</MenuItem>}
                        <MenuItem icon={machine.registered ? 'minus-circle' : 'refresh'} danger={machine.registered} onSelect={async () => {
                            if (!machine.registered) { await mutate(`${path}/register`, 'POST', {}, '机器已恢复登记'); return; }
                            if (!await confirm('取消登记会阻止新的执行，不会删除会话或工作区。', { title: '取消机器登记？', confirmLabel: '取消登记', danger: true })) return;
                            await mutate(path, 'DELETE', {}, '机器已取消登记');
                        }}>{machine.registered ? '取消机器登记' : '恢复机器登记'}</MenuItem>
                    </Menu>
                }
                onClose={onClose} />
            {machine.connection === 'pending' && (
                <Banner tone="info" title="这台机器还没有完成首次连接" actions={<Button size="sm" onClick={() => ws.showOnboarding('machine')}>查看接入说明</Button>}>在那台机器上让 Agent 完成接入并启动 Runner。</Banner>
            )}
            {revoked && <Banner tone="danger" title="机器凭据已撤销">Runner 无法连接。在这台机器上让 Agent 执行 machine rotate-credential 并重启 Runner。</Banner>}
            <Section title="状态">
                <Facts rows={[
                    ['连接', <ConnectionBadge state={machine.connection} />],
                    ['登记', machine.registered ? '已登记' : '已取消'],
                    ['机器凭据', credential.data ? <span>{credential.data.status === 'active' ? '有效' : '已撤销'} <Mono>{credential.data.id}</Mono></span>
                        : credential.error ? `无法读取：${credential.error.message}` : '正在读取…'],
                    machine.platform || machine.host ? ['系统', [machine.platform, machine.host].filter(Boolean).join(' · ')] : null,
                    ['最后活动', machine.lastActiveAt ? fullTime(machine.lastActiveAt) : '暂无观察'],
                    ['机器 ID', <Mono>{machine.id}</Mono>],
                ]} />
                <p className="hint">轮换凭据要在这台机器上进行：让 Agent 执行 machine rotate-credential。</p>
            </Section>
            <Section title="名称">
                <InlineEdit label="机器名称" value={machine.name} max={64} onSave={async name => !!await mutate(path, 'PATCH', { name }, '机器名称已保存')} />
            </Section>
            {machine.permissions.associate && (
                <Section title="空间关联">
                    <p className="section-lead">关联后，这个空间才能使用这台机器上共享的 Runtime。关联本身不共享 Runtime。</p>
                    <div className="switch-list">
                        {ws.spaces.map(space => {
                            const associated = !!machine.spaceIds?.includes(space.id);
                            return <SwitchRow key={space.id} label={space.name} description={associated ? '已关联' : '未关联'} checked={associated} onCheckedChange={async on => {
                                if (!on && !await confirm(`撤回关联也会撤回这台机器在“${space.name}”的 Runtime 共享；重新关联不会自动恢复共享。`, { title: '撤回空间关联？', confirmLabel: '撤回关联', danger: true })) return;
                                await mutate(`${path}/spaces/${encodeURIComponent(space.id)}`, on ? 'PUT' : 'DELETE', {}, on ? `已关联到“${space.name}”` : `已撤回“${space.name}”的关联`);
                            }} />;
                        })}
                    </div>
                </Section>
            )}
            <Section title="原生工具">
                <p className="section-lead">查看这台机器上能找到哪些 Codex 或 Claude Code。只确认工具存在，不检查模型认证。</p>
                {discovery && (
                    <ul className="tool-list" tabIndex={-1}>
                        {discovery.tools.map(tool => (
                            <li key={tool.flavor} data-found={String(tool.toolFound)}>
                                <Icon name={tool.toolFound ? 'st-done' : 'st-failed'} /><strong>{flavorLabels[tool.flavor] ?? tool.flavor}</strong>
                                <span>{tool.toolFound ? `已找到${tool.inspection.details.version ? ` · ${tool.inspection.details.version}` : ''}` : tool.problem?.message ?? '没有找到'}</span>
                            </li>
                        ))}
                    </ul>
                )}
                <div><Button icon="search" size="sm" disabled={machine.connection !== 'online' || probing} onClick={async () => {
                    setProbing(true);
                    const result = await ws.run(() => ws.spaceApi.request<Discovery>(`${path}/discover`, undefined, 'GET', true));
                    setProbing(false);
                    if (result) setDiscovery(result);
                }}>{probing ? '正在探测…' : '探测原生工具'}</Button></div>
                {machine.connection !== 'online' && <p className="hint">机器在线时才能探测。</p>}
            </Section>
            <Governance machine={machine} reload={reload} />
        </PanelInner>
    );
}

function SummaryPanel({ machine, ownerName, reload, onClose }: { machine: MachineView; ownerName: string; reload: () => void; onClose: () => void }) {
    return (
        <PanelInner>
            <PanelHead title={machine.name} badges={<ConnectionBadge state={machine.connection} />} sub={<span>{ownerName}的机器</span>} onClose={onClose} />
            <Banner tone="lock" title={`这是${ownerName}的机器`}>你只能查看概要。名称、凭据和空间关联由机器所有者管理。</Banner>
            <Section title="状态">
                <Facts rows={[
                    ['连接', <ConnectionBadge state={machine.connection} />],
                    ['此空间', machine.blockedInSpace ? '已停用' : '已关联'],
                    ['最后活动', machine.lastActiveAt ? fullTime(machine.lastActiveAt) : '暂无观察'],
                    ['机器 ID', <Mono>{machine.id}</Mono>],
                ]} />
            </Section>
            <Governance machine={machine} reload={reload} />
        </PanelInner>
    );
}
