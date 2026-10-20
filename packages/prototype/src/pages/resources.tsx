import { useEffect, useState } from 'react';
import {
    Badge, Banner, Button, Chain, Dialog, EmptyState, Facts, Form, Icon, InlineEdit, Menu, MenuItem, Mono, PageHead, PanelHead, PanelInner, Row, RowList,
    Section, Segmented, SelectField, SplitView, SwitchRow, Tag, TextField, fullTime, toast, useConfirm, useSplit,
} from '@runweft/ui';
import { flavorLabels, type HubError } from '../mock.js';
import { Loaded, demo, usePage, useProto } from '../proto';
import { relative } from '../time-format';

function ConnectionBadge({ state }: { state: string }) {
    if (state === 'online') return <Badge tone="ok" icon="st-done">在线</Badge>;
    if (state === 'offline') return <Badge tone="neutral" icon="wifi-off">离线</Badge>;
    return <Badge tone="neutral" icon="st-pending">尚未首次连接</Badge>;
}
const ListHead = ({ columns }: { columns: string[] }) => <div className="list-head" aria-hidden="true">{columns.map((text, index) => <span key={index}>{text}</span>)}</div>;

/** Writes reload the page on success, like ctx.refresh() after mutate in the accepted prototype. */
function useMutate() {
    const proto = useProto();
    return async (action: () => Promise<unknown>, success: string) => {
        const done = await proto.run(action, { success });
        if (done) proto.refresh();
        return done;
    };
}

// ---- machines -------------------------------------------------------------------

export function MachinesPage() {
    const proto = useProto();
    const page = usePage(() => Promise.all([demo.api.machines(), demo.api.spaces()]));
    const split = useSplit<string>();
    const [discovery, setDiscovery] = useState<Record<string, any>>({});
    return (
        <Loaded page={page} label="机器">{([machines, spaces]) => {
            const opened = machines.find((machine: any) => machine.id === split.key);
            return (
                <div className="page-inner">
                    <PageHead title="机器" description="执行任务的电脑或服务器。首次接入和凭据轮换都在那台机器上由 Agent 完成。"
                        actions={<Button icon="plus" variant="primary" onClick={() => proto.showOnboarding('machine')}>接入新机器</Button>} />
                    <SplitView split={split} label="机器详情" list={machines.length ? <>
                        {machines.some((machine: any) => machine.connection === 'offline') && <Banner tone="offline" title="有机器离线">离线机器上的 Runtime 暂时不可选；已接受的任务记录不受影响。</Banner>}
                        <ListHead columns={['', '名称', '连接', '此空间', '最后活动']} />
                        <RowList label="机器列表" table>
                            {machines.map((machine: any) => (
                                <Row key={machine.id} rowKey={machine.id} opened={split.key === machine.id} onOpen={from => split.open(machine.id, { from })} className="resource-row">
                                    <span className="row-icon"><Icon name="machine" /></span>
                                    <span className="cell cell-name">
                                        <strong className="row-title">{machine.name}</strong>
                                        <small>{machine.owner ? '你的机器' : `${machine.ownerName}的机器`}</small>
                                        {!machine.registered && <Tag tone="warn">已取消登记</Tag>}
                                    </span>
                                    <span className="cell" data-label="连接"><ConnectionBadge state={machine.connection} /></span>
                                    <span className="cell" data-label="此空间" data-priority="low" data-tone={machine.blocked ? 'warn' : machine.associated ? undefined : 'muted'}>
                                        {!machine.associated ? '未关联' : machine.blocked ? '已在此空间停用' : '已关联'}
                                    </span>
                                    <span className="cell cell-muted" data-label="最后活动" data-priority="low">{relative(machine.lastActiveAt)}</span>
                                </Row>
                            ))}
                        </RowList>
                    </> : (
                        <EmptyState icon="machine" title="还没有机器" actions={<Button icon="link" onClick={() => proto.showOnboarding('machine')}>查看接入说明</Button>}>在要执行任务的电脑或服务器上，让 Agent 完成接入。接入后会出现在这里。</EmptyState>
                    )}>
                        {opened && (opened.owner
                            ? <OwnerPanel machine={opened} spaces={spaces} discovery={discovery[opened.id]} onDiscovered={result => setDiscovery(current => ({ ...current, [opened.id]: result }))} onClose={() => split.close()} />
                            : <SummaryPanel machine={opened} onClose={() => split.close()} />)}
                    </SplitView>
                </div>
            );
        }}</Loaded>
    );
}

function MachineGovernance({ machine }: { machine: any }) {
    const confirm = useConfirm(), mutate = useMutate(), space = demo.space();
    if (!machine.permissions.govern) return null;
    return (
        <Section title="此空间的治理">
            <SwitchRow label={`在“${space.name}”停用这台机器`} description="只影响这个空间的新任务；所有权、其他空间和已接受的任务不受影响。" checked={machine.blocked}
                onCheckedChange={async on => {
                    if (!await confirm(on ? `停用后，“${space.name}”的成员不能再用这台机器执行新任务。` : '解除停用后，这台机器上已共享的 Runtime 会重新可选。',
                        { title: on ? '在此空间停用？' : '解除停用？', confirmLabel: on ? '停用' : '解除停用', danger: on })) return;
                    await mutate(() => demo.api.setMachineBlocked(machine.id, on), on ? '已在此空间停用' : '已解除停用');
                }} />
        </Section>
    );
}

function OwnerPanel({ machine, spaces, discovery, onDiscovered, onClose }: { machine: any; spaces: any[]; discovery?: any; onDiscovered(result: any): void; onClose(): void }) {
    const proto = useProto(), confirm = useConfirm(), mutate = useMutate();
    return (
        <PanelInner>
            <PanelHead title={machine.name} badges={<><ConnectionBadge state={machine.connection} />{!machine.registered && <Badge tone="warn">已取消登记</Badge>}</>}
                sub={<><span>你的机器</span><Mono>{machine.id}</Mono></>}
                actions={
                    <Menu label="机器操作" align="end" trigger={<Button icon="more" iconOnly label="机器操作" variant="ghost" size="sm" />}>
                        {machine.credential.status === 'active' && <MenuItem icon="key" danger onSelect={async () => {
                            if (await confirm('撤销后 Runner 无法继续连接。需要在这台机器上让 Agent 轮换凭据并重启 Runner。', { title: '撤销机器凭据？', confirmLabel: '撤销凭据', danger: true }))
                                await mutate(() => demo.api.revokeMachineCredential(machine.id), '机器凭据已撤销');
                        }}>撤销机器凭据</MenuItem>}
                        <MenuItem icon={machine.registered ? 'minus-circle' : 'refresh'} danger={machine.registered} onSelect={async () => {
                            if (!machine.registered) { await mutate(() => demo.api.setMachineRegistered(machine.id, true), '机器已恢复登记'); return; }
                            if (await confirm('取消登记会阻止新的执行，不会删除会话或工作区。', { title: '取消机器登记？', confirmLabel: '取消登记', danger: true }))
                                await mutate(() => demo.api.setMachineRegistered(machine.id, false), '机器已取消登记');
                        }}>{machine.registered ? '取消机器登记' : '恢复机器登记'}</MenuItem>
                    </Menu>
                }
                onClose={onClose} />
            {machine.connection === 'pending' && <Banner tone="info" title="这台机器还没有完成首次连接" actions={<Button size="sm" onClick={() => proto.showOnboarding('machine')}>查看接入说明</Button>}>在那台机器上让 Agent 完成接入并启动 Runner。</Banner>}
            {machine.credential.status !== 'active' && <Banner tone="danger" title="机器凭据已撤销">Runner 无法连接。在这台机器上让 Agent 执行 machine rotate-credential 并重启 Runner。</Banner>}
            <Section title="状态">
                <Facts rows={[['连接', <ConnectionBadge state={machine.connection} />], ['登记', machine.registered ? '已登记' : '已取消'],
                    ['机器凭据', <span>{machine.credential.status === 'active' ? '有效 ' : '已撤销 '}<Mono>{machine.credential.id}</Mono></span>], ['最后活动', fullTime(machine.lastActiveAt)]]} />
                <p className="hint">轮换凭据要在这台机器上进行：让 Agent 执行 machine rotate-credential。</p>
            </Section>
            <Section title="名称">
                <InlineEdit label="机器名称" value={machine.name} max={64} onSave={async name => !!await mutate(() => demo.api.renameMachine(machine.id, name), '机器名称已保存')} />
            </Section>
            <Section title="空间关联">
                <p className="section-lead">关联后，这个空间才能使用这台机器上共享的 Runtime。关联本身不共享 Runtime。</p>
                <div className="switch-list">
                    {spaces.map(space => {
                        const on = machine.spaceIds.includes(space.id);
                        return <SwitchRow key={space.id} label={space.name} description={on ? '已关联' : '未关联'} checked={on} onCheckedChange={async next => {
                            if (!next && !await confirm(`撤回关联也会撤回这台机器在“${space.name}”的 Runtime 共享；重新关联不会自动恢复共享。`, { title: '撤回空间关联？', confirmLabel: '撤回关联', danger: true })) return;
                            await mutate(() => demo.api.setMachineSpace(machine.id, space.id, next), next ? `已关联到“${space.name}”` : `已撤回“${space.name}”的关联`);
                        }} />;
                    })}
                </div>
            </Section>
            <Section title="原生工具">
                <p className="section-lead">查看这台机器上能找到哪些 Codex 或 Claude Code。只确认工具存在，不检查模型认证。</p>
                {discovery && (
                    <ul className="tool-list" tabIndex={-1}>
                        {discovery.tools.map((tool: any) => <li key={tool.flavor}><Icon name={tool.found ? 'st-done' : 'st-failed'} /><strong>{flavorLabels[tool.flavor]}</strong><span>{tool.found ? `已找到 · ${tool.version}` : '没有找到'}</span></li>)}
                    </ul>
                )}
                <div><Button icon="search" size="sm" disabled={machine.connection !== 'online'} onClick={async () => {
                    const result = await proto.run(() => demo.api.discoverTools(machine.id));
                    if (result && result !== true) onDiscovered(result);
                }}>探测原生工具</Button></div>
            </Section>
            <MachineGovernance machine={machine} />
        </PanelInner>
    );
}

function SummaryPanel({ machine, onClose }: { machine: any; onClose(): void }) {
    return (
        <PanelInner>
            <PanelHead title={machine.name} badges={<ConnectionBadge state={machine.connection} />} sub={<><span>{machine.ownerName}的机器</span><Mono>{machine.id}</Mono></>} onClose={onClose} />
            <Banner tone="lock" title={`这是${machine.ownerName}的机器`}>你只能查看概要。名称、凭据和空间关联由机器所有者管理。</Banner>
            <Section title="状态"><Facts rows={[['连接', <ConnectionBadge state={machine.connection} />], ['此空间', machine.blocked ? '已停用' : '已关联'], ['最后活动', fullTime(machine.lastActiveAt)]]} /></Section>
            <MachineGovernance machine={machine} />
        </PanelInner>
    );
}

// ---- runtimes -------------------------------------------------------------------

function Eligibility({ runtime }: { runtime: any }) {
    return runtime.eligibility.eligible ? <Badge tone="ok" icon="st-done">可以选用</Badge> : <Badge tone="warn" icon="st-attention">{runtime.eligibility.reason}</Badge>;
}

export function RuntimesPage() {
    const page = usePage(() => Promise.all([demo.api.runtimes(), demo.api.spaces(), demo.api.ownMachines()]));
    const split = useSplit<string>();
    const [registering, setRegistering] = useState(false);
    const [checks, setChecks] = useState<Record<string, { result?: any; error?: HubError }>>({});
    return (
        <Loaded page={page} label="Runtime">{([runtimes, spaces, own]) => {
            const opened = runtimes.find((runtime: any) => runtime.id === split.key);
            const register = own.length ? <Button icon="plus" variant="primary" onClick={() => setRegistering(true)}>登记 Runtime</Button> : null;
            return (
                <div className="page-inner">
                    <PageHead title="Runtime" description="机器上的 Codex 或 Claude Code，分别登记。共享给空间后，成员可以用它执行任务。" actions={register} />
                    <SplitView split={split} label="Runtime 详情" list={runtimes.length ? <>
                        <ListHead columns={['', '名称', '此空间', '可用性', '工具版本']} />
                        <RowList label="Runtime 列表" table>
                            {runtimes.map((runtime: any) => (
                                <Row key={runtime.id} rowKey={runtime.id} opened={split.key === runtime.id} onOpen={from => split.open(runtime.id, { from })} className="resource-row">
                                    <span className="row-icon"><Icon name="runtime" /></span>
                                    <span className="cell cell-name"><strong className="row-title">{runtime.name}</strong><Chain parts={[runtime.machineName, flavorLabels[runtime.flavor]]} /></span>
                                    <span className="cell" data-label="此空间" data-priority="low" data-tone={runtime.shared || !runtime.owner ? undefined : 'muted'}>{runtime.owner ? (runtime.shared ? '已共享' : '未共享') : `${runtime.ownerName}共享`}</span>
                                    <span className="cell" data-label="可用性"><Eligibility runtime={runtime} /></span>
                                    <span className="cell cell-muted" data-label="工具版本" data-priority="low">{runtime.version ?? '尚未确认'}</span>
                                </Row>
                            ))}
                        </RowList>
                    </> : (
                        <EmptyState icon="runtime" title="还没有 Runtime" actions={register ?? <ShowOnboarding />}>
                            {own.length ? '把机器上的 Codex 或 Claude Code 登记为 Runtime，之后就能在 Agent 和个人选择里用它。' : '先接入一台机器，再登记机器上的 Codex 或 Claude Code。'}
                        </EmptyState>
                    )}>
                        {opened && <RuntimePanel runtime={opened} spaces={spaces} check={checks[opened.id]} onCheck={value => setChecks(current => ({ ...current, [opened.id]: value }))} onClose={() => split.close()} />}
                    </SplitView>
                    <RegisterDialog open={registering} onOpenChange={setRegistering} machines={own} onRegistered={id => split.open(id)} />
                </div>
            );
        }}</Loaded>
    );
}

function ShowOnboarding() {
    const proto = useProto();
    return <Button icon="link" onClick={() => proto.showOnboarding('machine')}>查看接入说明</Button>;
}

function RuntimePanel({ runtime, spaces, check, onCheck, onClose }: { runtime: any; spaces: any[]; check?: { result?: any; error?: HubError }; onCheck(value: { result?: any; error?: HubError }): void; onClose(): void }) {
    const proto = useProto(), confirm = useConfirm(), mutate = useMutate(), space = demo.space();
    return (
        <PanelInner>
            <PanelHead title={runtime.name} badges={<Eligibility runtime={runtime} />} sub={<><span>{runtime.owner ? '你的 Runtime' : `${runtime.ownerName}共享到此空间`}</span><Mono>{runtime.id}</Mono></>}
                actions={runtime.permissions.manage ? (
                    <Menu label="Runtime 操作" align="end" trigger={<Button icon="more" iconOnly label="Runtime 操作" variant="ghost" size="sm" />}>
                        <MenuItem icon={runtime.registered ? 'minus-circle' : 'refresh'} danger={runtime.registered} onSelect={async () => {
                            if (!runtime.registered) { await mutate(() => demo.api.setRuntimeRegistered(runtime.id, true), 'Runtime 已恢复登记'); return; }
                            if (await confirm('取消登记会阻止新任务选用它，不删除原生历史。', { title: '取消 Runtime 登记？', confirmLabel: '取消登记', danger: true }))
                                await mutate(() => demo.api.setRuntimeRegistered(runtime.id, false), 'Runtime 已取消登记');
                        }}>{runtime.registered ? '取消 Runtime 登记' : '恢复 Runtime 登记'}</MenuItem>
                    </Menu>
                ) : undefined}
                onClose={onClose} />
            {!runtime.eligibility.eligible && <Banner tone="warn" title={`现在不能选用：${runtime.eligibility.reason}`}>{runtime.eligibility.hint}</Banner>}
            {!runtime.owner && <Banner tone="lock" title={`由${runtime.ownerName}共享到此空间`}>你可以选用和检查它，但不能修改配置或共享范围。共享会消耗对方机器的模型额度。</Banner>}
            <Section title="状态">
                <Facts rows={[
                    ['机器', <span>{runtime.machineName} <ConnectionBadge state={runtime.machineConnection} /></span>], ['原生工具', flavorLabels[runtime.flavor]],
                    ['工具版本', `${runtime.version ?? '尚未确认'} · 观察于 ${relative(runtime.inspectedAt)}`], ['登记', runtime.registered ? '已登记' : '已取消'], ['模型认证与执行', '未检查'],
                ]} />
                {check?.result && <Banner tone="ok" title={`找到 ${flavorLabels[runtime.flavor]} · ${check.result.version}`}>只确认了工具存在和版本；模型认证、参数和真实执行没有检查。</Banner>}
                {check?.error && <Banner tone="warn" title={check.error.message}>{check.error.hint || undefined}</Banner>}
                {(runtime.permissions.use || runtime.permissions.manage) && <div><Button icon="search" size="sm" onClick={async () => {
                    const result = await proto.run(() => demo.api.checkRuntime(runtime.id), { onError: error => onCheck({ error }) });
                    if (result && result !== true) onCheck({ result });
                }}>检查 Runtime</Button></div>}
            </Section>
            {runtime.permissions.manage && <Section title="名称"><InlineEdit label="Runtime 名称" value={runtime.name} max={64} onSave={async name => !!await mutate(() => demo.api.renameRuntime(runtime.id, name), 'Runtime 名称已保存')} /></Section>}
            {runtime.permissions.manage && (
                <Section title="共享到空间">
                    <p className="section-lead">共享后，空间成员可以用它执行任务，会消耗这台机器的模型额度。不提供系统隔离，也不会公开你的历史任务。</p>
                    <div className="switch-list">
                        {spaces.map(item => {
                            const associated = runtime.machineSpaceIds.includes(item.id), shared = runtime.shareSpaceIds.includes(item.id);
                            return <SwitchRow key={item.id} label={item.name} checked={shared} disabled={!associated && !shared}
                                description={associated ? (shared ? '已共享' : '未共享') : `先把 ${runtime.machineName} 关联到这个空间`}
                                onCheckedChange={async on => {
                                    const message = on ? `允许“${item.name}”的成员使用 ${runtime.name}？会消耗这台机器的模型额度，不提供系统隔离。` : '撤回后这个空间不能再发起新轮次；运行中的任务会被核对并停止，停止未确认时保留未知状态。';
                                    if (await confirm(message, { title: on ? '共享 Runtime？' : '撤回共享？', confirmLabel: on ? '共享' : '撤回共享', danger: !on }))
                                        await mutate(() => demo.api.setRuntimeShare(runtime.id, item.id, on), on ? `已共享到“${item.name}”` : `已撤回“${item.name}”的共享`);
                                }} />;
                        })}
                    </div>
                </Section>
            )}
            {runtime.permissions.govern && (
                <Section title="此空间的治理">
                    <SwitchRow label={`在“${space.name}”停用这个 Runtime`} description="只变更这个空间的治理状态，不取得他人的配置或任务内容。" checked={runtime.blocked}
                        onCheckedChange={async on => {
                            if (await confirm(on ? '停用后，这个空间不能再选用它执行新任务。' : '解除停用后，它会重新可选。', { title: on ? '在此空间停用？' : '解除停用？', confirmLabel: on ? '停用' : '解除停用', danger: on }))
                                await mutate(() => demo.api.setRuntimeBlocked(runtime.id, on), on ? '已在此空间停用' : '已解除停用');
                        }} />
                </Section>
            )}
        </PanelInner>
    );
}

function RegisterDialog({ open, onOpenChange, machines, onRegistered }: { open: boolean; onOpenChange(open: boolean): void; machines: any[]; onRegistered(id: string): void }) {
    const proto = useProto();
    const preferred = machines.find(machine => machine.connection === 'online')?.id ?? machines[0]?.id ?? '';
    const [machineId, setMachineId] = useState(preferred);
    const [flavor, setFlavor] = useState('codex');
    const [name, setName] = useState('');
    const [error, setError] = useState<HubError | null>(null);
    useEffect(() => { if (open) { setMachineId(preferred); setFlavor('codex'); setName(''); setError(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
    const labels: Record<string, string> = { online: '在线', offline: '离线', pending: '尚未首次连接' };
    return (
        <Dialog open={open} onOpenChange={onOpenChange} title="登记 Runtime" description="把一台你的机器上的 Codex 或 Claude Code 登记为可选的执行工具。"
            footer={<><Button onClick={() => onOpenChange(false)}>取消</Button><Button type="submit" form="register-runtime" variant="primary">登记 Runtime</Button></>}>
            <Form id="register-runtime" onSubmit={async () => {
                setError(null);
                const created = await proto.run(() => demo.api.registerRuntime({ machineId, flavor, name: name.trim() }), { onError: setError });
                if (!created || created === true) return;
                onOpenChange(false); toast('Runtime 已登记，目前只有你能选用'); proto.refresh(); onRegistered((created as any).id);
            }}>
                <SelectField label="执行机器" value={machineId} onChange={event => setMachineId(event.target.value)} options={machines.map(machine => ({ value: machine.id, label: `${machine.name} · ${labels[machine.connection]}` }))} />
                <div className="field"><span className="field-label">原生工具</span>
                    <Segmented label="原生工具" value={flavor} onValueChange={setFlavor} options={[{ value: 'codex', label: 'Codex' }, { value: 'claude', label: 'Claude Code' }]} />
                </div>
                <TextField label="名称（可选）" maxLength={64} placeholder="留空时使用机器名和工具名" value={name} onChange={event => setName(event.target.value)} />
                <p className="hint">登记会在机器上确认工具存在，机器需要在线。Codex 和 Claude Code 分别登记。</p>
                {error && <Banner tone="danger" title={error.message}>{error.hint || undefined}</Banner>}
            </Form>
        </Dialog>
    );
}
