import { useState } from 'react';
import {
    Badge, Banner, Button, Chain, Dialog, EmptyState, Facts, Form, Icon, InlineEdit, Menu, MenuItem, Mono, PageHead, PanelHead, PanelInner, Row, RowList,
    Section, Segmented, SelectField, SplitView, SwitchRow, Tag, TextField, relativeTime, toast, useConfirm, useSplit,
} from '@runweft/ui';
import { HubApiError } from '../api/http';
import type { MachineView, RuntimeView } from '../../resources/types';
import { Resource, useResource, useWorkspace } from '../workspace/context';
import { ConnectionBadge, ListHead, connectionText, flavorLabels, useMutate, useOwners } from './common';

const base = '/resources/runtimes';
type Inventory = { runtimes: RuntimeView[]; machines: MachineView[] };

function Eligibility({ runtime }: { runtime: RuntimeView }) {
    return runtime.eligibility.eligible ? <Badge tone="ok" icon="st-done">可以选用</Badge> : <Badge tone="warn" icon="st-attention">{runtime.eligibility.reason?.message ?? '现在不能选用'}</Badge>;
}

export function RuntimesPage() {
    const ws = useWorkspace();
    const inventory = useResource<Inventory>(() => Promise.all([
        ws.spaceApi.request<{ runtimes: RuntimeView[] }>(base), ws.spaceApi.request<{ machines: MachineView[] }>('/resources/machines'),
    ]).then(([runtimes, machines]) => ({ runtimes: runtimes.runtimes, machines: machines.machines })), [ws.spaceApi]);
    const owner = useOwners();
    const split = useSplit<string>();
    const [registering, setRegistering] = useState(false);
    const own = inventory.data?.machines.filter(machine => machine.permissions.manage) ?? [];
    const machineOf = (runtime: RuntimeView) => inventory.data?.machines.find(machine => machine.id === runtime.machineId);
    const opened = inventory.data?.runtimes.find(runtime => runtime.id === split.key);
    const register = own.length ? <Button icon="plus" variant="primary" onClick={() => setRegistering(true)}>登记 Runtime</Button> : null;
    return (
        <div className="page-inner">
            <PageHead title="Runtime" description="机器上的 Codex 或 Claude Code，分别登记。共享给空间后，成员可以用它执行任务。" actions={register} />
            <SplitView split={split} label="Runtime 详情" list={
                <Resource resource={inventory} label="Runtime">{({ runtimes }) => runtimes.length ? (
                    <>
                        <ListHead columns={['', '名称', '此空间', '可用性', '工具版本']} />
                        <RowList label="Runtime 列表" table>
                            {runtimes.map(runtime => {
                                const mine = runtime.permissions.manage;
                                return (
                                    <Row key={runtime.id} rowKey={runtime.id} opened={split.key === runtime.id} onOpen={from => split.open(runtime.id, { from })}>
                                        <span className="row-icon"><Icon name="runtime" /></span>
                                        <span className="cell cell-name">
                                            <strong className="row-title">{runtime.name}</strong>
                                            <Chain parts={[machineOf(runtime)?.name ?? runtime.machineId, flavorLabels[runtime.flavor]]} />
                                            {!runtime.registered && <Tag tone="warn">已取消登记</Tag>}
                                        </span>
                                        <span className="cell" data-label="此空间" data-priority="low" data-tone={runtime.shared || !mine ? undefined : 'muted'}>
                                            {mine ? (runtime.shared ? '已共享' : '未共享') : `${owner(runtime.ownerId)}共享`}
                                        </span>
                                        <span className="cell" data-label="可用性"><Eligibility runtime={runtime} /></span>
                                        <span className="cell cell-muted" data-label="工具版本" data-priority="low">{runtime.version ?? '尚未确认'}</span>
                                    </Row>
                                );
                            })}
                        </RowList>
                    </>
                ) : (
                    <EmptyState icon="runtime" title="还没有 Runtime" actions={register ?? <Button icon="link" onClick={() => ws.showOnboarding('machine')}>查看接入说明</Button>}>
                        {own.length ? '把机器上的 Codex 或 Claude Code 登记为 Runtime，之后就能在 Agent 和个人选择里用它。' : '先接入一台机器，再登记机器上的 Codex 或 Claude Code。'}
                    </EmptyState>
                )}</Resource>
            }>
                {opened && <RuntimePanel key={opened.id} runtime={opened} machine={machineOf(opened)} ownerName={owner(opened.ownerId)} reload={inventory.reload} onClose={() => split.close()} />}
            </SplitView>
            <RegisterDialog open={registering} onOpenChange={setRegistering} machines={own}
                onRegistered={runtime => { inventory.reload(); split.open(runtime.id); }} />
        </div>
    );
}

function RuntimePanel({ runtime, machine, ownerName, reload, onClose }: { runtime: RuntimeView; machine?: MachineView; ownerName: string; reload: () => void; onClose: () => void }) {
    const ws = useWorkspace(), confirm = useConfirm(), mutate = useMutate(reload);
    const path = `${base}/${encodeURIComponent(runtime.id)}`;
    const [check, setCheck] = useState<{ result?: RuntimeView; error?: HubApiError } | null>(null);
    const [checking, setChecking] = useState(false);
    const mine = runtime.permissions.manage;
    const machineName = machine?.name ?? runtime.machineId;
    return (
        <PanelInner>
            <PanelHead title={runtime.name} badges={<Eligibility runtime={runtime} />} sub={<span>{mine ? '你的 Runtime' : `${ownerName}共享到此空间`}</span>}
                actions={mine ? (
                    <Menu label="Runtime 操作" align="end" trigger={<Button icon="more" iconOnly label="Runtime 操作" variant="ghost" size="sm" />}>
                        <MenuItem icon={runtime.registered ? 'minus-circle' : 'refresh'} danger={runtime.registered} onSelect={async () => {
                            if (!runtime.registered) { await mutate(base, 'POST', { machineId: runtime.machineId, flavor: runtime.flavor }, 'Runtime 已恢复登记'); return; }
                            if (!await confirm('取消登记会阻止新任务选用它，不删除原生历史。', { title: '取消 Runtime 登记？', confirmLabel: '取消登记', danger: true })) return;
                            await mutate(path, 'DELETE', {}, 'Runtime 已取消登记');
                        }}>{runtime.registered ? '取消 Runtime 登记' : '恢复 Runtime 登记'}</MenuItem>
                    </Menu>
                ) : undefined}
                onClose={onClose} />
            {!runtime.eligibility.eligible && <Banner tone="warn" title={`现在不能选用：${runtime.eligibility.reason?.message ?? '不满足选用条件'}`}>{runtime.eligibility.reason?.hint || undefined}</Banner>}
            {!mine && <Banner tone="lock" title={`由${ownerName}共享到此空间`}>你可以选用和检查它，但不能修改配置或共享范围。共享会消耗对方机器的模型额度。</Banner>}
            <Section title="状态">
                <Facts rows={[
                    ['机器', <span>{machineName} {machine && <ConnectionBadge state={machine.connection} />}</span>],
                    ['原生工具', flavorLabels[runtime.flavor] ?? runtime.flavor],
                    ['工具版本', `${runtime.version ?? '尚未确认'}${runtime.checkedAt ? ` · 观察于 ${relativeTime(runtime.checkedAt)}` : ''}${runtime.inspectionCurrent ? '' : ' · 历史观察'}`],
                    ['登记', runtime.registered ? '已登记' : '已取消'],
                    ['模型认证与执行', '未检查'],
                    ['Runtime ID', <Mono>{runtime.id}</Mono>],
                ]} />
                {check?.result && (check.result.toolFound
                    ? <Banner tone="ok" title={`找到 ${flavorLabels[runtime.flavor]}${check.result.version ? ` · ${check.result.version}` : ''}`}>只确认了工具存在和版本；模型认证、参数和真实执行没有检查。</Banner>
                    : <Banner tone="warn" title={`没有找到 ${flavorLabels[runtime.flavor]}`}>{check.result.eligibility.reason?.hint || '在这台机器上安装或修复原生工具后再检查。'}</Banner>)}
                {check?.error && <Banner tone="warn" title={check.error.message}>{check.error.hint || undefined}</Banner>}
                {(runtime.permissions.use || mine) && <div><Button icon="search" size="sm" disabled={checking} onClick={async () => {
                    setChecking(true); setCheck(null);
                    const result = await ws.run(() => ws.spaceApi.request<{ runtime: RuntimeView }>(`${path}/check`, undefined, 'GET', mine), { onError: error => setCheck({ error }) });
                    setChecking(false);
                    if (result) { setCheck({ result: result.runtime }); reload(); }
                }}>{checking ? '正在检查…' : '检查 Runtime'}</Button></div>}
            </Section>
            {mine && (
                <Section title="名称">
                    <InlineEdit label="Runtime 名称" value={runtime.name} max={64} onSave={async name => !!await mutate(path, 'PATCH', { name }, 'Runtime 名称已保存')} />
                </Section>
            )}
            {runtime.permissions.share && (
                <Section title="共享到空间">
                    <p className="section-lead">共享后，空间成员可以用它执行任务，会消耗这台机器的模型额度。不提供系统隔离，也不会公开你的历史任务。</p>
                    <div className="switch-list">
                        {ws.spaces.map(space => {
                            const shared = !!runtime.shareSpaceIds?.includes(space.id), associated = !!machine?.spaceIds?.includes(space.id);
                            return <SwitchRow key={space.id} label={space.name} checked={shared} disabled={!associated && !shared}
                                description={associated ? (shared ? '已共享' : '未共享') : `先把 ${machineName} 关联到这个空间`}
                                onCheckedChange={async on => {
                                    const message = on ? `允许“${space.name}”的成员使用 ${runtime.name}？会消耗这台机器的模型额度，不提供系统隔离。`
                                        : '撤回后这个空间不能再发起新轮次；运行中的任务会被核对并停止，停止未确认时保留未知状态。';
                                    if (!await confirm(message, { title: on ? '共享 Runtime？' : '撤回共享？', confirmLabel: on ? '共享' : '撤回共享', danger: !on })) return;
                                    await mutate(`${path}/spaces/${encodeURIComponent(space.id)}`, on ? 'PUT' : 'DELETE', {}, on ? `已共享到“${space.name}”` : `已撤回“${space.name}”的共享`);
                                }} />;
                        })}
                    </div>
                </Section>
            )}
            {runtime.permissions.govern && (
                <Section title="此空间的治理">
                    <SwitchRow label={`在“${ws.space.name}”停用这个 Runtime`} description="只变更这个空间的治理状态，不取得他人的配置或任务内容。" checked={runtime.blockedInSpace}
                        onCheckedChange={async on => {
                            if (!await confirm(on ? '停用后，这个空间不能再选用它执行新任务。' : '解除停用后，它会重新可选。', { title: on ? '在此空间停用？' : '解除停用？', confirmLabel: on ? '停用' : '解除停用', danger: on })) return;
                            await mutate(`/resources/spaces/${encodeURIComponent(ws.space.id)}/blocks/runtime/${encodeURIComponent(runtime.id)}`, on ? 'PUT' : 'DELETE', {}, on ? '已在此空间停用' : '已解除停用');
                        }} />
                </Section>
            )}
        </PanelInner>
    );
}

function RegisterDialog({ open, onOpenChange, machines, onRegistered }: { open: boolean; onOpenChange(open: boolean): void; machines: MachineView[]; onRegistered(runtime: RuntimeView): void }) {
    const ws = useWorkspace();
    const preferred = machines.find(machine => machine.connection === 'online')?.id ?? machines[0]?.id ?? '';
    const [machineId, setMachineId] = useState(preferred);
    const [flavor, setFlavor] = useState<'codex' | 'claude'>('codex');
    const [name, setName] = useState('');
    const [error, setError] = useState<HubApiError | null>(null);
    const [busy, setBusy] = useState(false);
    return (
        <Dialog open={open} onOpenChange={next => { if (next) { setMachineId(preferred); setFlavor('codex'); setName(''); setError(null); } onOpenChange(next); }}
            title="登记 Runtime" description="把一台你的机器上的 Codex 或 Claude Code 登记为可选的执行工具。"
            footer={<><Button onClick={() => onOpenChange(false)}>取消</Button><Button type="submit" form="register-runtime" variant="primary" disabled={busy}>登记 Runtime</Button></>}>
            <Form id="register-runtime" onSubmit={async () => {
                setBusy(true); setError(null);
                const created = await ws.run(() => ws.spaceApi.request<{ runtime: RuntimeView }>(base, { machineId, flavor, ...(name.trim() ? { name: name.trim() } : {}) }), { onError: setError });
                setBusy(false);
                if (!created) return;
                onOpenChange(false); toast('Runtime 已登记，目前只有你能选用'); onRegistered(created.runtime);
            }}>
                <SelectField label="执行机器" value={machineId} onChange={event => setMachineId(event.target.value)}
                    options={machines.map(machine => ({ value: machine.id, label: `${machine.name} · ${connectionText[machine.connection]}` }))} />
                <div className="field">
                    <span className="field-label" id="runtime-flavor-label">原生工具</span>
                    <Segmented label="原生工具" value={flavor} onValueChange={setFlavor} options={[{ value: 'codex', label: 'Codex' }, { value: 'claude', label: 'Claude Code' }]} />
                </div>
                <TextField label="名称（可选）" maxLength={64} placeholder="留空时使用机器名和工具名" value={name} onChange={event => setName(event.target.value)} />
                <p className="hint">登记会在机器上确认工具存在，机器需要在线。Codex 和 Claude Code 分别登记。</p>
                {error && <Banner tone="danger" title={error.message}>{error.hint || undefined}</Banner>}
            </Form>
        </Dialog>
    );
}
