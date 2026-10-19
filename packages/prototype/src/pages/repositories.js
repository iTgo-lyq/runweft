import { h, icon } from '../ui/dom.js';
import { badge, banner, button, emptyState, field, form, inlineEdit, menuItem, mono, pageHead, panelHead, popover, rovingRows, section, splitView } from '../ui/kit.js';

export async function renderRepositories(ctx) {
  const s = ctx.state;
  const repositories = await ctx.api.repositories();
  const split = splitView('仓库详情', () => { s.openId = null; mark(); });
  ctx.useSplit(split);
  const mutate = (action, success) => ctx.run(action, { success }).then(ok => { if (ok) ctx.refresh(); return ok; });

  const list = h('ul', { class: 'rows', 'aria-label': '仓库列表' });
  rovingRows(list);
  for (const repo of repositories) {
    const row = h('button', { type: 'button', class: 'row', dataset: { key: repo.id, opened: String(s.openId === repo.id) } },
      h('span', { class: 'row-icon', dataset: { tone: repo.registered ? 'accent' : 'neutral' } }, icon('repo')),
      h('span', { class: 'row-main' },
        h('span', { class: 'row-top' }, h('strong', { class: 'row-title', text: repo.name }), repo.registered ? null : h('span', { class: 'tag', dataset: { tone: 'warn' } }, '已取消登记'), h('span', { class: 'row-aside', text: repo.ownerId === ctx.user.id ? '' : `${repo.ownerName}登记` })),
        h('span', { class: 'row-text mono', dataset: { tone: repo.aliases.length ? '' : 'muted' }, text: repo.aliases[0] ?? '没有 Git 别名' }),
        h('span', { class: 'row-meta' },
          repo.aliases.length > 1 ? h('span', { class: 'tag' }, icon('link'), `另有 ${repo.aliases.length - 1} 个别名`) : null,
          h('span', { class: 'tag', dataset: repo.checkouts.length ? { tone: 'accent' } : undefined }, icon('machine'), repo.checkouts.length ? `我的 checkout ${repo.checkouts.length} 处` : '还没有我的 checkout'))),
      icon('chevron-right', 'icon row-go'));
    row.addEventListener('click', () => open(repo.id, { from: row }));
    list.append(h('li', {}, row));
  }
  function mark() { for (const row of list.querySelectorAll('.row')) row.dataset.opened = String(row.dataset.key === s.openId); }

  function open(id, { from, focus = true } = {}) {
    const repo = repositories.find(r => r.id === id);
    if (!repo) return;
    s.openId = id; mark();
    split.open(panel(repo), id, { from, focus });
  }

  function panel(repo) {
    const manage = repo.permissions.manage;
    const actions = [];
    if (manage) {
      const more = button('仓库操作', { icon: 'more', iconOnly: true, variant: 'ghost', size: 'sm' });
      more.setAttribute('aria-haspopup', 'menu');
      more.addEventListener('click', () => popover(more, close => [menuItem(repo.registered ? '取消仓库登记' : '恢复仓库登记', { icon: repo.registered ? 'minus-circle' : 'refresh', danger: repo.registered, close, onSelect: async () => {
        if (await ctx.confirm('只改变这个仓库在空间目录里的登记状态，不删除 Git 文件、Agent 或个人选择。取消登记后不再用于新的解析。', { title: repo.registered ? '取消仓库登记？' : '恢复仓库登记？', confirmLabel: repo.registered ? '取消登记' : '恢复登记', danger: repo.registered }))
          mutate(() => ctx.api.setRepositoryRegistered(repo.id, !repo.registered), repo.registered ? '仓库已取消登记' : '仓库已恢复登记');
      } })], { label: '仓库操作', align: 'end' }));
      actions.push(more);
    }
    const alias = field('添加 Git 别名', { required: true, mono: true, spellcheck: false, placeholder: 'git@github.com:team/project.git' });
    const aliasError = h('div');
    const aliasForm = form([alias.node, aliasError], '添加别名', async () => {
      const ok = await ctx.run(() => ctx.api.addAlias(repo.id, alias.input.value), { onError: e => aliasError.replaceChildren(banner('danger', e.message, e.hint)) });
      if (ok) { ctx.toast('别名已添加'); ctx.refresh(); }
    });
    aliasForm.classList.add('inline-add');
    return h('div', { class: 'panel-inner' },
      panelHead({ title: repo.name, badges: [repo.registered ? badge('ok', '已登记', 'st-done') : badge('warn', '已取消登记', 'st-attention')], sub: [h('span', { text: repo.ownerId === ctx.user.id ? '你登记的仓库' : `${repo.ownerName}登记` }), mono(repo.id)], actions, onClose: () => split.close() }),
      manage ? null : banner('lock', '只能查看', '仓库的名称、别名和登记由登记人或空间管理员维护。'),
      manage ? section('名称', inlineEdit({ label: '仓库名称', value: repo.name, onSave: name => mutate(() => ctx.api.renameRepository(repo.id, name), '仓库名称已保存') })) : null,
      section('Git 别名', h('p', { class: 'section-lead', text: '用来识别同一个项目，不保存 Git 凭据，也不会修改任何 Git remote。' }),
        repo.aliases.length ? h('ul', { class: 'alias-list' }, repo.aliases.map(value => h('li', {}, icon('link'), mono(value),
          manage ? button(`移除别名 ${value}`, { icon: 'x', iconOnly: true, variant: 'ghost', size: 'sm', onClick: async () => {
            if (await ctx.confirm(`移除 ${value} 与这个仓库的识别关联？不会修改任何 Git remote。`, { title: '移除别名？', confirmLabel: '移除', danger: true })) mutate(() => ctx.api.removeAlias(repo.id, value), '别名已移除');
          } }) : null))) : h('p', { class: 'muted', text: '还没有别名。也可以让 Agent 在本机显式绑定 checkout。' }),
        manage ? aliasForm : null),
      section('我的 checkout', h('p', { class: 'section-lead', text: '你的机器上已确认的 Git 关联。新增、重新绑定或解除由对应机器上的 Agent 执行，浏览器不猜测本地路径。' }),
        repo.checkouts.length ? h('ul', { class: 'checkout-list' }, repo.checkouts.map(c => h('li', {},
          h('div', { class: 'checkout-head' }, icon('machine'), h('strong', { text: c.machineName })),
          h('dl', { class: 'facts compact' }, h('div', { class: 'fact' }, h('dt', { text: '工作目录' }), h('dd', {}, mono(c.cwd))), h('div', { class: 'fact' }, h('dt', { text: 'Git 公共目录' }), h('dd', {}, mono(c.commonDir)))))))
          : emptyState({ icon: 'machine', title: '还没有 checkout 关联', text: '让 Agent 在项目里执行 repository inspect，再按本机 ID 执行 repository match 或 bind。' })));
  }

  function create() {
    const name = field('仓库名称', { required: true, max: 80, placeholder: '例如 runweft-web' });
    const aliases = field('Git 别名（可选，每行一个）', { multiline: true, rows: 3, mono: true, spellcheck: false, hint: '支持 HTTP(S)、ssh、git 地址和 git@host:path 形式。' });
    let handle;
    const node = form([name.node, aliases.node], '登记仓库', async () => {
      const repo = await ctx.run(() => ctx.api.createRepository(name.input.value.trim(), aliases.input.value.split('\n').map(v => v.trim()).filter(Boolean)));
      if (!repo) return;
      handle.close('done'); s.openId = repo.id; ctx.toast('仓库已登记。在项目里让 Agent 观察 Git 并绑定 checkout。'); ctx.refresh();
    }, { cancel: button('取消', { onClick: () => handle.close('cancel') }) });
    handle = ctx.dialog({ title: '登记仓库', description: '仓库属于当前空间，用来识别 Git 项目、限定 Agent 的作用范围。', body: node });
  }

  const body = repositories.length ? list : emptyState({ icon: 'repo', title: '还没有仓库', text: '不在 Git 里的工作可以直接使用空间级 Agent。Git 项目可以先登记，再让 Agent 绑定本机 checkout。', actions: [button('登记仓库', { icon: 'plus', variant: 'primary', onClick: create })] });
  split.list.append(body);
  const node = h('div', { class: 'page-inner' },
    pageHead('仓库', '空间里的项目目录，用来识别 Git 项目、限定 Agent 的作用范围。不保存 Git 凭据，也不读取代码。', [button('登记仓库', { icon: 'plus', variant: 'primary', onClick: create })]),
    split.root);
  if (s.openId) open(s.openId, { focus: false });
  return node;
}
