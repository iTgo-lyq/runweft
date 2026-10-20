import { useEffect, useRef, useState } from 'react';
import {
    Avatar, Badge, Banner, Block, Button, Dialog, EmptyState, Icon, InlineEdit, Menu, MenuItem, MenuSeparator, PageHead, Segmented, dayLabel, relativeTime, useConfirm,
} from '@runweft/ui';
import { roleLabels, type Invitation, type Member, type Role, type SpacePermissions } from '../api/hub';
import { patchHash } from '../route';
import { CopyButton } from '../workspace/shell';
import { Resource, useResource, useWorkspace } from '../workspace/context';

const roleTone: Record<Role, 'accent' | 'info' | 'neutral'> = { owner: 'accent', admin: 'info', member: 'neutral' };
type Roster = { members: Member[]; permissions: SpacePermissions; invitations: Invitation[] };

export function MembersPage() {
    const ws = useWorkspace(), confirm = useConfirm();
    const roster = useResource<Roster>(async () => {
        const [members, permissions] = await Promise.all([ws.identityApi.members(ws.space.id), ws.identityApi.permissions(ws.space.id)]);
        return { members, permissions, invitations: permissions.manageInvitations ? await ws.identityApi.invitations(ws.space.id) : [] };
    }, [ws.identityApi, ws.space.id]);
    const [inviting, setInviting] = useState(false);
    const mutate = async (action: () => Promise<unknown>, success: string) => {
        const done = await ws.run(action, { success });
        if (done) roster.reload();
        return done;
    };
    const invite = roster.data?.permissions.inviteRoles.length ? <Button icon="plus" variant="primary" onClick={() => setInviting(true)}>邀请成员</Button> : null;
    return (
        <div className="page-inner narrow">
            <PageHead title="成员" description="空间是成员的授权边界。成员可以使用共享给空间的资源，但不能编辑他人的私有资源。" actions={invite} />
            <Resource resource={roster} label="成员">{({ members, permissions, invitations }) => {
                const nameOf = (userId: string) => members.find(member => member.userId === userId)?.name ?? '已离开的成员';
                const lastOwner = ws.role === 'owner' && !permissions.leave;
                return (
                    <>
                        <section className="space-card">
                            <span className="space-glyph large" aria-hidden="true">{Array.from(ws.space.name)[0]}</span>
                            <div>
                                <p className="field-label">空间名称</p>
                                <InlineEdit label="空间名称" value={ws.space.name} editable={permissions.rename} onSave={async name => {
                                    const done = await ws.run(() => ws.identityApi.renameSpace(ws.space.id, name), { success: '空间名称已保存' });
                                    if (!done) return false;
                                    await ws.reloadIdentity();
                                }} />
                                <p className="muted">{members.length} 位成员 · 你是{roleLabels[ws.role]}</p>
                            </div>
                        </section>
                        <Block title="成员" aside={<span className="muted">{members.length} 位</span>}>
                            <ul className="people" aria-label="成员列表">
                                {members.map(member => {
                                    const self = member.userId === ws.identity.id, allowed = permissions.members[member.userId] ?? { roles: [], remove: false };
                                    const roles = allowed.roles.filter(role => role !== member.role);
                                    const canAct = !self && (roles.length > 0 || allowed.remove);
                                    return (
                                        <li className="person" key={member.userId} data-member-id={member.userId}>
                                            <Avatar name={member.name} />
                                            <div className="person-main"><strong>{member.name}{self && <span className="muted">（你）</span>}</strong></div>
                                            <Badge tone={roleTone[member.role]}>{roleLabels[member.role]}</Badge>
                                            <span className="person-joined">{dayLabel(member.joinedAt)}加入</span>
                                            {canAct ? (
                                                <Menu label={`${member.name} 的操作`} align="end" trigger={<Button icon="more" iconOnly label={`${member.name} 的操作`} variant="ghost" size="sm" />}>
                                                    {roles.map(role => (
                                                        <MenuItem key={role} icon="shield" description={role === 'owner' ? '与你拥有相同的管理权' : undefined} onSelect={async () => {
                                                            if (!await confirm(`${member.name} 的角色将从${roleLabels[member.role]}改为${roleLabels[role]}。`, { title: `设为${roleLabels[role]}？`, confirmLabel: '更改角色' })) return;
                                                            await mutate(() => ws.identityApi.setRole(ws.space.id, member.userId, role), `${member.name} 已设为${roleLabels[role]}`);
                                                        }}>设为{roleLabels[role]}</MenuItem>
                                                    ))}
                                                    {roles.length > 0 && <MenuSeparator />}
                                                    <MenuItem icon="minus-circle" danger disabled={!allowed.remove} description={allowed.remove ? undefined : ws.role === 'admin' ? '管理员只能移出普通成员' : '空间至少保留一位所有者'}
                                                        onSelect={async () => {
                                                            if (!await confirm(`${member.name} 将失去这个空间的访问权。对其私有资源的授权会一并撤回，已接受的任务不受影响。`, { title: `把 ${member.name} 移出空间？`, confirmLabel: '移出', danger: true })) return;
                                                            await mutate(() => ws.identityApi.removeMember(ws.space.id, member.userId), `已把 ${member.name} 移出空间`);
                                                        }}>移出空间</MenuItem>
                                                </Menu>
                                            ) : <span className="person-spacer" />}
                                        </li>
                                    );
                                })}
                            </ul>
                            {members.length < 2 && (
                                <EmptyState icon="users" title="只有你一个人" actions={invite}>
                                    {permissions.inviteRoles.length ? '生成邀请，交给希望加入的成员。' : '请所有者或管理员邀请其他成员。'}
                                </EmptyState>
                            )}
                        </Block>
                        {permissions.manageInvitations && (
                            <Block title="待使用的邀请">
                                {invitations.length ? (
                                    <ul className="line-list">
                                        {invitations.map(invitation => (
                                            <li className="line" key={invitation.id} data-invitation-id={invitation.id}>
                                                <span className="line-icon"><Icon name="link" /></span>
                                                <div className="line-main"><strong>{roleLabels[invitation.role]}邀请</strong><small>{nameOf(invitation.createdBy)}创建 · {relativeTime(invitation.expiresAt)}</small></div>
                                                {permissions.invitations[invitation.id]?.revoke ? <Button size="sm" variant="ghost" onClick={async () => {
                                                    if (!await confirm('撤销后这个邀请立即失效。已经加入的成员不受影响。', { title: '撤销邀请？', confirmLabel: '撤销邀请', danger: true })) return;
                                                    await mutate(() => ws.identityApi.revokeInvitation(ws.space.id, invitation.id), '邀请已撤销');
                                                }}>撤销</Button> : <span className="line-spacer" />}
                                            </li>
                                        ))}
                                    </ul>
                                ) : <p className="muted">没有待使用的邀请。</p>}
                            </Block>
                        )}
                        <Block title="退出这个空间" className="danger-zone">
                            <p className="section-lead">{lastOwner ? '你是这个空间唯一的所有者。先把另一位成员设为所有者，再退出。' : '退出后你将看不到这个空间的资源和任务。你在这里的个人选择会被清除。'}</p>
                            <div><Button variant="danger" disabled={!permissions.leave} onClick={async () => {
                                if (!await confirm(`退出后你将看不到“${ws.space.name}”的资源和任务。重新加入需要新的邀请。`, { title: '退出这个空间？', confirmLabel: '退出空间', danger: true })) return;
                                const left = await ws.run(() => ws.identityApi.removeMember(ws.space.id, ws.identity.id), { success: `已退出“${ws.space.name}”` });
                                if (!left) return;
                                // A link may still name the space just left; drop it so the next space opens instead of an error.
                                // Switch first, so no page asks for the space just left.
                                patchHash({ space: null, task: null, round: null });
                                await ws.reloadIdentity({ spaceId: ws.spaces.find(space => space.id !== ws.space.id)?.id });
                                ws.navigate('tasks', { focus: false });
                            }}>退出空间</Button></div>
                        </Block>
                        <InviteDialog open={inviting} onOpenChange={setInviting} roles={permissions.inviteRoles as Role[]} onCreated={roster.reload} />
                    </>
                );
            }}</Resource>
        </div>
    );
}

/** The invitation is shown once: it lives only in this dialog's state and is dropped when the dialog closes. */
function InviteDialog({ open, onOpenChange, roles, onCreated }: { open: boolean; onOpenChange(open: boolean): void; roles: Role[]; onCreated(): void }) {
    const ws = useWorkspace();
    const [role, setRole] = useState<Role>('member');
    const [issued, setIssued] = useState<{ token: string; invitation: Invitation } | null>(null);
    const [busy, setBusy] = useState(false);
    const secret = useRef<HTMLPreElement>(null);
    useEffect(() => { if (open) { setRole('member'); setIssued(null); } else setIssued(null); }, [open]);
    useEffect(() => { if (issued) requestAnimationFrame(() => secret.current?.focus()); }, [issued]);
    const generate = async () => {
        setBusy(true);
        const result = await ws.run(() => ws.identityApi.createInvitation(ws.space.id, role));
        setBusy(false);
        if (result) { setIssued(result); onCreated(); }
    };
    return (
        <Dialog open={open} onOpenChange={onOpenChange} title="邀请成员" description={`邀请只能加入“${ws.space.name}”，24 小时内有效，只能由一人使用。`}
            footer={issued ? <CopyButton text={issued.token} label="复制邀请" source={secret} onDone={() => onOpenChange(false)} />
                : <><Button onClick={() => onOpenChange(false)}>取消</Button><Button variant="primary" disabled={busy} onClick={generate}>生成邀请</Button></>}>
            {issued ? (
                <>
                    <Banner tone="ok" title="邀请已生成">加入后的角色：{roleLabels[issued.invitation.role]}。{relativeTime(issued.invitation.expiresAt)}，只能由一人使用。</Banner>
                    <div className="secret"><span className="field-label">邀请</span><pre ref={secret} className="secret-value" tabIndex={0}>{issued.token}</pre></div>
                    <p className="hint">这个邀请只显示这一次，关闭后无法再查看。把它交给希望加入的成员，对方在“切换空间 → 接受邀请”里使用。成员身份不授予他人私有资源的编辑权。</p>
                </>
            ) : (
                <div className="field">
                    <span className="field-label">加入后的角色</span>
                    <Segmented label="加入后的角色" value={role} onValueChange={setRole} options={roles.map(value => ({ value, label: roleLabels[value] }))} />
                    <p className="field-hint">{roles.includes('admin') ? '邀请不能直接授予所有者；加入后可以再调整。' : '管理员只能邀请普通成员。'}</p>
                </div>
            )}
        </Dialog>
    );
}

