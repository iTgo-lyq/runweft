import { h, icon, relative } from '../ui/dom.js';
import { badge, banner, button, field, form, inlineEdit, mono, pageHead } from '../ui/kit.js';

export async function renderSettings(ctx) {
  const { user, environments } = await ctx.api.account();
  const signOut = notice => {
    ctx.app.scene = 'signin';
    ctx.app.notice = notice;
    ctx.navigate('account');
  };

  const profile = h('section', { class: 'block' },
    h('div', { class: 'block-head' }, h('h2', { text: '个人资料' })),
    h('dl', { class: 'facts' },
      h('div', { class: 'fact' }, h('dt', { text: '用户名' }), h('dd', {}, mono(user.username), h('small', { class: 'muted', text: ' · 用于登录，不能修改' }))),
      h('div', { class: 'fact' }, h('dt', { text: '显示名称' }), h('dd', {}, inlineEdit({ label: '显示名称', value: user.name, onSave: name => ctx.run(() => ctx.api.updateDisplayName(name), { success: '显示名称已保存' }).then(ok => { if (ok) ctx.navigate('settings', { focus: false }); }) })))));

  const envList = h('ul', { class: 'line-list' }, environments.map(env => h('li', { class: 'line', dataset: { revoked: String(env.revoked) } },
    h('span', { class: 'line-icon' }, icon(env.kind === 'cli' ? 'terminal' : 'browser')),
    h('div', { class: 'line-main' },
      h('strong', {}, env.label, env.current ? badge('accent', '当前环境') : null),
      h('small', { text: `${env.kind === 'cli' ? '命令行' : '浏览器'} · ${env.revoked ? '已断开' : `最近使用：${relative(env.lastUsedAt)}`}` })),
    env.current || env.revoked ? h('span', { class: 'line-spacer' }) : button('断开', { size: 'sm', variant: 'ghost', onClick: async () => {
      if (!await ctx.confirm('这个环境将无法继续访问你的账号。已接受的任务会继续执行，机器的 Runner 凭据不受影响。', { title: `断开“${env.label}”？`, confirmLabel: '断开环境', danger: true })) return;
      if (await ctx.run(() => ctx.api.revokeEnvironment(env.id), { success: `已断开“${env.label}”` })) ctx.refresh();
    } }))));

  const current = field('当前密码', { type: 'password', required: true, autocomplete: 'current-password' });
  const next = field('新密码', { type: 'password', required: true, autocomplete: 'new-password', hint: '支持粘贴和密码管理器。' });
  const passwordError = h('div');
  const passwordForm = form([current.node, next.node, passwordError], '修改密码并退出全部环境', async () => {
    const ok = await ctx.run(() => ctx.api.changePassword(current.input.value, next.input.value), { onError: e => passwordError.replaceChildren(banner('danger', e.message, e.hint)) });
    if (ok) signOut({ tone: 'ok', title: '密码已更新', text: '所有浏览器和命令行都已退出，请使用新密码登录。' });
  });

  const logoutAll = h('section', { class: 'block danger-zone' },
    h('div', { class: 'block-head' }, h('h2', { text: '退出全部环境' })),
    h('p', { class: 'section-lead', text: '所有浏览器和命令行都需要重新登录。账号、空间、资源和已接受的任务都会保留。' }),
    button('退出全部环境…', { variant: 'danger', onClick: () => {
      const password = field('当前密码', { type: 'password', required: true, autocomplete: 'current-password' });
      const error = h('div');
      let handle;
      const node = form([password.node, error], '确认退出全部环境', async () => {
        const ok = await ctx.run(() => ctx.api.logoutAll(password.input.value), { onError: e => error.replaceChildren(banner('danger', e.message, e.hint)) });
        if (!ok) return;
        handle.close('done');
        signOut({ tone: 'info', title: '已退出全部环境', text: '可以用账号密码重新登录。' });
      }, { cancel: button('取消', { onClick: () => handle.close('cancel') }) });
      handle = ctx.dialog({ title: '退出全部环境？', description: '需要验证当前密码。已接受的任务会继续执行。', body: node, size: 'sm' });
    } }));

  return h('div', { class: 'page-inner narrow' },
    pageHead('账号设置', '管理你的账号、登录环境和密码。'),
    profile,
    h('section', { class: 'block' }, h('div', { class: 'block-head' }, h('h2', { text: '登录环境' })),
      h('p', { class: 'section-lead', text: '每个浏览器和命令行环境都可以单独断开。断开只影响它的账号访问。' }), envList),
    h('section', { class: 'block' }, h('div', { class: 'block-head' }, h('h2', { text: '修改密码' })),
      h('p', { class: 'section-lead', text: '修改后，所有浏览器和命令行都需要用新密码重新登录。' }), passwordForm),
    logoutAll);
}
