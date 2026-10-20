import { useEffect, useRef, useState } from 'react';
import {
    Avatar, Badge, Banner, Block, Button, Dialog, EmptyState, Icon, InlineEdit, Menu, MenuItem, MenuSeparator, PageHead, Segmented, dayLabel, useConfirm,
} from '@runweft/ui';
import { roleLabels } from '../mock.js';
import { Loaded, demo, usePage, useProto } from '../proto';
import { relative } from '../time-format';

const roleTone: Record<string, 'accent' | 'info' | 'neutral'> = { owner: 'accent', admin: 'info', member: 'neutral' };

export function MembersPage() {
    const proto = useProto(), confirm = useConfirm();
    const page = usePage(() => Promise.all([demo.api.members(), demo.api.invitations()]));
    const [inviting, setInviting] = useState(false);
    const mutate = async (action: () => Promise<unknown>, success: string) => { const done = await proto.run(action, { success }); if (done) proto.refresh(); return done; };
    return (
        <Loaded page={page} label="成员">{([{ role, members }, invitations]) => {
            const manager = role === 'owner' || role === 'admin', owners = members.filter((m: any) => m.role === 'owner').length;
            const lastOwner = role === 'owner' && owners === 1, space = demo.space();
            const invite = manager ? <Button icon="plus" variant="primary" onClick={() => setInviting(true)}>邀请成员</Button> : null;
            return (
                <div className="page-inner narrow">
                    <PageHead title="成员" description="空间是成员的授权边界。成员可以使用共享给空间的资源，但不能编辑他人的私有资源。" actions={invite} />
                    <section className="space-card">
                        <span className="space-glyph large" aria-hidden="true">{Array.from(space.name)[0]}</span>
                        <div>
                            <p className="field-label">空间名称</p>
                            <InlineEdit label="空间名称" value={space.name} editable={manager} onSave={async name => {
                                const done = await proto.run(() => demo.api.renameSpace(name), { success: '空间名称已保存' });
                                if (!done) return false;
                                proto.changed(); proto.refresh();
                            }} />
                            <p className="muted">{members.length} 位成员 · 你是{roleLabels[role]}</p>
                        </div>
                    </section>
                    <Block title="成员" aside={<span className="muted">{members.length} 位</span>}>
                        <ul className="people" aria-label="成员列表">
                            {members.map((member: any) => {
                                const self = member.userId === demo.user.id;
                                const canAct = !self && (role === 'owner' || (role === 'admin' && member.role === 'member'));
                                const removable = role === 'owner' ? member.role !== 'owner' || owners > 1 : member.role === 'member';
                                return (
                                    <li className="person" key={member.userId}>
                                        <Avatar name={member.name} hue={member.hue} />
                                        <div className="person-main"><strong>{member.name}{self && <span className="muted">（你）</span>}</strong><span className="mono person-handle">{member.username}</span></div>
                                        <Badge tone={roleTone[member.role]}>{roleLabels[member.role]}</Badge>
                                        <span className="person-joined">{dayLabel(member.joinedAt)}加入</span>
                                        {canAct ? (
                                            <Menu label={`${member.name} 的操作`} align="end" trigger={<Button icon="more" iconOnly label={`${member.name} 的操作`} variant="ghost" size="sm" />}>
                                                {role === 'owner' && <>
                                                    {['owner', 'admin', 'member'].filter(next => next !== member.role).map(next => {
                                                        const protectedOwner = member.role === 'owner' && owners === 1;
                                                        return <MenuItem key={next} icon="shield" disabled={protectedOwner} description={protectedOwner ? '空间至少保留一位所有者' : next === 'owner' ? '与你拥有相同的管理权' : undefined}
                                                            onSelect={() => void mutate(() => demo.api.setMemberRole(member.userId, next), `${member.name} 已设为${roleLabels[next]}`)}>设为{roleLabels[next]}</MenuItem>;
                                                    })}
                                                    <MenuSeparator />
                                                </>}
                                                <MenuItem icon="minus-circle" danger disabled={!removable} description={removable ? undefined : role === 'admin' ? '管理员只能移出普通成员' : '空间至少保留一位所有者'} onSelect={async () => {
                                                    if (await confirm(`${member.name} 将失去这个空间的访问权。对其私有资源的授权会一并撤回，已接受的任务不受影响。`, { title: `把 ${member.name} 移出空间？`, confirmLabel: '移出', danger: true }))
                                                        await mutate(() => demo.api.removeMember(member.userId), `已把 ${member.name} 移出空间`);
                                                }}>移出空间</MenuItem>
                                            </Menu>
                                        ) : <span className="person-spacer" />}
                                    </li>
                                );
                            })}
                        </ul>
                        {members.length < 2 && <EmptyState icon="users" title="只有你一个人" actions={invite}>{manager ? '生成邀请，交给希望加入的成员。' : '请所有者或管理员邀请其他成员。'}</EmptyState>}
                    </Block>
                    {manager && (
                        <Block title="待使用的邀请">
                            {invitations.length ? (
                                <ul className="line-list">
                                    {invitations.map((inv: any) => (
                                        <li className="line" key={inv.id}>
                                            <span className="line-icon"><Icon name="link" /></span>
                                            <div className="line-main"><strong>{roleLabels[inv.role]}邀请</strong><small>{inv.creator}创建 · {relative(inv.expiresAt)}</small></div>
                                            <Button size="sm" variant="ghost" onClick={async () => {
                                                if (await confirm('撤销后这个邀请立即失效。已经加入的成员不受影响。', { title: '撤销邀请？', confirmLabel: '撤销邀请', danger: true }))
                                                    await mutate(() => demo.api.revokeInvitation(inv.id), '邀请已撤销');
                                            }}>撤销</Button>
                                        </li>
                                    ))}
                                </ul>
                            ) : <p className="muted">没有待使用的邀请。</p>}
                        </Block>
                    )}
                    <Block title="退出这个空间" className="danger-zone">
                        <p className="section-lead">{lastOwner ? '你是这个空间唯一的所有者。先把另一位成员设为所有者，再退出。' : '退出后你将看不到这个空间的资源和任务。你在这里的个人选择会被清除。'}</p>
                        <div><Button variant="danger" disabled={lastOwner} onClick={async () => {
                            if (!await confirm(`退出后你将看不到“${space.name}”的资源和任务。重新加入需要新的邀请。`, { title: '退出这个空间？', confirmLabel: '退出空间', danger: true })) return;
                            if (await proto.run(() => demo.api.leaveSpace(), { success: '已退出空间' })) { proto.changed(); proto.navigate('tasks'); }
                        }}>退出空间</Button></div>
                    </Block>
                    <InviteDialog open={inviting} onOpenChange={setInviting} owner={role === 'owner'} />
                </div>
            );
        }}</Loaded>
    );
}

function InviteDialog({ open, onOpenChange, owner }: { open: boolean; onOpenChange(open: boolean): void; owner: boolean }) {
    const proto = useProto();
    const [role, setRole] = useState('member');
    const [issued, setIssued] = useState<any>(null);
    const secret = useRef<HTMLPreElement>(null);
    useEffect(() => { if (open) { setRole('member'); setIssued(null); } }, [open]);
    useEffect(() => { if (issued) secret.current?.focus(); }, [issued]);
    const done = () => { onOpenChange(false); setIssued(null); proto.refresh(); };
    return (
        <Dialog open={open} onOpenChange={next => { if (!next) done(); }} title="邀请成员" description={`邀请只能加入“${demo.space().name}”，24 小时内有效，只能由一人使用。`}
            footer={issued ? <Button variant="primary" onClick={done}>完成</Button> : <><Button onClick={() => onOpenChange(false)}>取消</Button><Button variant="primary" onClick={async () => {
                const invitation = await proto.run(() => demo.api.createInvitation(role));
                if (invitation && invitation !== true) setIssued(invitation);
            }}>生成邀请</Button></>}>
            {issued ? (
                <>
                    <Banner tone="ok" title="邀请已生成">加入后的角色：{roleLabels[issued.role]}。{relative(issued.expiresAt)}，只能由一人使用。</Banner>
                    <div className="secret"><span className="field-label">邀请</span><pre ref={secret} className="secret-value" tabIndex={0}>{issued.token}</pre></div>
                    <p className="hint">这个邀请只显示这一次，关闭后无法再查看。把它交给希望加入的成员，对方在“切换空间 → 接受邀请”里使用。成员身份不授予他人私有资源的编辑权。</p>
                </>
            ) : (
                <div className="field">
                    <span className="field-label">加入后的角色</span>
                    <Segmented label="加入后的角色" value={role} onValueChange={setRole} options={(owner ? ['member', 'admin'] : ['member']).map(value => ({ value, label: roleLabels[value] }))} />
                    <p className="field-hint">{owner ? '邀请不能直接授予所有者；加入后可以再调整。' : '管理员只能邀请普通成员。'}</p>
                </div>
            )}
        </Dialog>
    );
}
