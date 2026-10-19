import { dayLabel, h, icon, relative } from '../ui/dom.js';
import { avatar, badge, banner, button, emptyState, inlineEdit, menuItem, menuSeparator, mono, pageHead, popover, segmented } from '../ui/kit.js';
import { roleLabels } from '../mock.js';

const roleTone = { owner: 'accent', admin: 'info', member: 'neutral' };

export async function renderMembers(ctx) {
  const [{ role, members }, invitations] = await Promise.all([ctx.api.members(), ctx.api.invitations()]);
  const mutate = (action, success) => ctx.run(action, { success }).then(ok => { if (ok) ctx.refresh(); return ok; });
  const manager = role === 'owner' || role === 'admin';
  const owners = members.filter(m => m.role === 'owner').length;

  function memberMenu(member, trigger) {
    popover(trigger, close => {
      const items = [];
      if (role === 'owner') {
        for (const next of ['owner', 'admin', 'member']) {
          if (next === member.role) continue;
          const lastOwner = member.role === 'owner' && owners === 1;
          items.push(menuItem(`设为${roleLabels[next]}`, { icon: 'shield', close, disabled: lastOwner, description: lastOwner ? '空间至少保留一位所有者' : next === 'owner' ? '与你拥有相同的管理权' : undefined,
            onSelect: () => mutate(() => ctx.api.setMemberRole(member.userId, next), `${member.name} 已设为${roleLabels[next]}`) }));
        }
        items.push(menuSeparator());
      }
      const removable = role === 'owner' ? member.role !== 'owner' || owners > 1 : member.role === 'member';
      items.push(menuItem('移出空间', { icon: 'minus-circle', danger: true, close, disabled: !removable, description: removable ? undefined : role === 'admin' ? '管理员只能移出普通成员' : '空间至少保留一位所有者',
        onSelect: async () => { if (await ctx.confirm(`${member.name} 将失去这个空间的访问权。对其私有资源的授权会一并撤回，已接受的任务不受影响。`, { title: `把 ${member.name} 移出空间？`, confirmLabel: '移出', danger: true })) mutate(() => ctx.api.removeMember(member.userId), `已把 ${member.name} 移出空间`); } }));
      return items;
    }, { label: `${member.name} 的操作`, align: 'end' });
  }

  const rows = h('ul', { class: 'people', 'aria-label': '成员列表' }, members.map(member => {
    const self = member.userId === ctx.user.id;
    const canAct = !self && (role === 'owner' || (role === 'admin' && member.role === 'member'));
    const trigger = canAct ? button(`${member.name} 的操作`, { icon: 'more', iconOnly: true, variant: 'ghost', size: 'sm' }) : null;
    trigger?.setAttribute('aria-haspopup', 'menu');
    trigger?.addEventListener('click', () => memberMenu(member, trigger));
    return h('li', { class: 'person' },
      avatar(member.name, member.hue),
      h('div', { class: 'person-main' }, h('strong', {}, member.name, self ? h('span', { class: 'muted', text: '（你）' }) : null), mono(member.username, 'mono person-handle')),
      badge(roleTone[member.role], roleLabels[member.role]),
      h('span', { class: 'person-joined', text: `${dayLabel(member.joinedAt)}加入` }),
      trigger ?? h('span', { class: 'person-spacer' }));
  }));

  function invite() {
    let chosen = 'member';
    let handle;
    const roleControl = h('div', { class: 'field' }, h('span', { class: 'field-label', text: '加入后的角色' }),
      segmented('加入后的角色', (role === 'owner' ? ['member', 'admin'] : ['member']).map(value => ({ value, label: roleLabels[value] })), chosen, value => { chosen = value; }),
      h('p', { class: 'field-hint', text: role === 'owner' ? '邀请不能直接授予所有者；加入后可以再调整。' : '管理员只能邀请普通成员。' }));
    const generate = button('生成邀请', { variant: 'primary', onClick: async () => {
      const invitation = await ctx.run(() => ctx.api.createInvitation(chosen));
      if (!invitation) return;
      handle.setBody([
        banner('ok', '邀请已生成', `加入后的角色：${roleLabels[invitation.role]}。${relative(invitation.expiresAt)}，只能由一人使用。`),
        h('div', { class: 'secret' }, h('span', { class: 'field-label', text: '邀请' }), h('pre', { class: 'secret-value', tabIndex: 0, text: invitation.token })),
        h('p', { class: 'hint', text: '这个邀请只显示这一次，关闭后无法再查看。把它交给希望加入的成员，对方在“切换空间 → 接受邀请”里使用。成员身份不授予他人私有资源的编辑权。' }),
      ], [button('完成', { variant: 'primary', onClick: () => { handle.close('done'); ctx.refresh(); } })]);
      handle.dialog.querySelector('.secret-value')?.focus();
    } });
    handle = ctx.dialog({ title: '邀请成员', description: `邀请只能加入“${ctx.space.name}”，24 小时内有效，只能由一人使用。`, body: roleControl, actions: [button('取消', { onClick: () => handle.close('cancel') }), generate] });
  }

  const invitationList = manager ? h('section', { class: 'block' },
    h('div', { class: 'block-head' }, h('h2', { text: '待使用的邀请' })),
    invitations.length ? h('ul', { class: 'line-list' }, invitations.map(inv => h('li', { class: 'line' },
      h('span', { class: 'line-icon' }, icon('link')),
      h('div', { class: 'line-main' }, h('strong', { text: `${roleLabels[inv.role]}邀请` }), h('small', { text: `${inv.creator}创建 · ${relative(inv.expiresAt)}` })),
      button('撤销', { size: 'sm', variant: 'ghost', onClick: async () => { if (await ctx.confirm('撤销后这个邀请立即失效。已经加入的成员不受影响。', { title: '撤销邀请？', confirmLabel: '撤销邀请', danger: true })) mutate(() => ctx.api.revokeInvitation(inv.id), '邀请已撤销'); } }))))
      : h('p', { class: 'muted', text: '没有待使用的邀请。' })) : null;

  const lastOwner = role === 'owner' && owners === 1;
  const leave = h('section', { class: 'block danger-zone' },
    h('div', { class: 'block-head' }, h('h2', { text: '退出这个空间' })),
    h('p', { class: 'section-lead', text: lastOwner ? '你是这个空间唯一的所有者。先把另一位成员设为所有者，再退出。' : '退出后你将看不到这个空间的资源和任务。你在这里的个人选择会被清除。' }),
    button('退出空间', { variant: 'danger', disabled: lastOwner, onClick: async () => {
      if (!await ctx.confirm(`退出后你将看不到“${ctx.space.name}”的资源和任务。重新加入需要新的邀请。`, { title: '退出这个空间？', confirmLabel: '退出空间', danger: true })) return;
      if (await ctx.run(() => ctx.api.leaveSpace(), { success: '已退出空间' })) ctx.navigate('tasks');
    } }));

  const nameBlock = h('section', { class: 'space-card' },
    h('span', { class: 'space-glyph large', 'aria-hidden': 'true', text: Array.from(ctx.space.name)[0] }),
    h('div', {}, h('p', { class: 'field-label', text: '空间名称' }), inlineEdit({ label: '空间名称', value: ctx.space.name, editable: manager, onSave: name => ctx.run(() => ctx.api.renameSpace(name), { success: '空间名称已保存' }).then(ok => { if (ok) ctx.navigate('members', { focus: false }); }) }),
      h('p', { class: 'muted', text: `${members.length} 位成员 · 你是${roleLabels[role]}` })));

  return h('div', { class: 'page-inner narrow' },
    pageHead('成员', '空间是成员的授权边界。成员可以使用共享给空间的资源，但不能编辑他人的私有资源。', manager ? [button('邀请成员', { icon: 'plus', variant: 'primary', onClick: invite })] : []),
    nameBlock,
    h('section', { class: 'block' }, h('div', { class: 'block-head' }, h('h2', { text: '成员' }), h('span', { class: 'muted', text: `${members.length} 位` })),
      members.length > 1 ? rows : [rows, emptyState({ icon: 'users', title: '只有你一个人', text: manager ? '生成邀请，交给希望加入的成员。' : '请所有者或管理员邀请其他成员。', actions: manager ? [button('邀请成员', { icon: 'plus', onClick: invite })] : [] })]),
    invitationList, leave);
}
