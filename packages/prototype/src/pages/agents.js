import { fullTime, h, icon } from '../ui/dom.js';
import { badge, banner, button, emptyState, facts, field, menuItem, mono, pageHead, panelHead, popover, rovingRows, section, segmented, select, splitView, switchRow, tabs } from '../ui/kit.js';
import { accessLabels, flavorLabels } from '../mock.js';

const blank = { name: '', description: '', instructions: '', repositoryId: null, runtimeId: null, flavor: null, model: null, reasoningEffort: null };

export async function renderAgents(ctx) {
  const s = ctx.state;
  s.tab ??= 'definition';
  const [agents, repositories, runtimes, peers] = await Promise.all([ctx.api.agents(), ctx.api.repositories(), ctx.api.runtimes(), ctx.api.peers()]);
  const split = splitView('Agent 详情', () => { s.openId = null; s.mode = null; mark(); });
  ctx.useSplit(split);
  const mutate = (action, success) => ctx.run(action, { success }).then(ok => { if (ok) ctx.refresh(); return ok; });
  const repoName = id => (id ? repositories.find(r => r.id === id)?.name ?? `原仓库不可见 · ${id}` : '整个空间');
  const runtimeName = id => (id ? runtimes.find(r => r.id === id)?.name ?? `原 Runtime 不可见 · ${id}` : '未指定');

  const list = h('ul', { class: 'rows', 'aria-label': 'Agent 列表' });
  rovingRows(list);
  for (const agent of agents) {
    const governanceOnly = agent.view === 'governance';
    const flags = [
      !agent.registered ? h('span', { class: 'tag', dataset: { tone: 'warn' } }, '已取消登记') : null,
      agent.blocked ? h('span', { class: 'tag', dataset: { tone: 'warn' } }, '已在此空间停用') : null,
      agent.registered && !agent.blocked && !agent.invocable && !governanceOnly ? h('span', { class: 'tag', dataset: { tone: 'warn' } }, '不可调用') : null,
    ];
    const row = h('button', { type: 'button', class: 'row', dataset: { key: agent.id, opened: String(s.openId === agent.id) } },
      h('span', { class: 'row-icon', dataset: { tone: governanceOnly ? 'neutral' : 'accent' } }, icon(governanceOnly ? 'lock' : 'agent')),
      h('span', { class: 'row-main' },
        h('span', { class: 'row-top' }, h('strong', { class: 'row-title', text: agent.name }), h('span', { class: 'row-version', text: `v${agent.version}` }), h('span', { class: 'row-aside', text: agent.ownerId === ctx.user.id ? '' : agent.ownerName })),
        h('span', { class: 'row-text', dataset: { tone: governanceOnly ? 'muted' : '' }, text: governanceOnly ? `${agent.ownerName}的私有 Agent。你只能查看治理概要。` : agent.definition.description || '没有用途说明' }),
        h('span', { class: 'row-meta' }, h('span', { class: 'tag' }, icon('repo'), repoName(agent.repositoryId)), h('span', { class: 'tag' }, icon('share'), accessLabels[agent.accessMode]), flags)),
      icon('chevron-right', 'icon row-go'));
    row.addEventListener('click', () => { s.mode = null; open(agent.id, { from: row }); });
    list.append(h('li', {}, row));
  }
  function mark() { for (const row of list.querySelectorAll('.row')) row.dataset.opened = String(row.dataset.key === s.openId); }

  function open(id, { from, focus = true } = {}) {
    if (id === 'new') { s.openId = 'new'; mark(); split.open(editor(null), 'new', { from, focus }); return; }
    const agent = agents.find(a => a.id === id);
    if (!agent) return;
    s.openId = id; mark();
    if (agent.view === 'governance') split.open(governancePanel(agent), id, { from, focus });
    else if (s.mode === 'edit' && agent.permissions.edit) split.open(editor(agent), id, { from, focus });
    else split.open(detail(agent), id, { from, focus });
  }

  function governanceSwitch(agent) {
    if (!agent.permissions.govern) return null;
    return section('此空间的治理', switchRow({
      label: `在“${ctx.space.name}”停用这个 Agent`, description: '只变更这个空间的治理状态，不取得定义的编辑权或执行内容。', checked: agent.blocked,
      onChange: async on => { if (await ctx.confirm(on ? '停用后，这个空间不能再调用它。所属人的内容、登记和分享不会改变。' : '解除停用后，它会按原来的分享范围重新可用。', { title: on ? '在此空间停用？' : '解除停用？', confirmLabel: on ? '停用' : '解除停用', danger: on })) mutate(() => ctx.api.setAgentBlocked(agent.id, on), on ? 'Agent 已在此空间停用' : 'Agent 已解除停用'); },
    }));
  }

  function governancePanel(agent) {
    return h('div', { class: 'panel-inner' },
      panelHead({ title: agent.name, badges: [badge('neutral', accessLabels[agent.accessMode], 'lock')], sub: [h('span', { text: `${agent.ownerName}的 Agent` }), mono(agent.id)], onClose: () => split.close() }),
      banner('lock', '只能查看治理概要', '管理员看不到私有定义、模型参数或指令。'),
      section('概要', facts([['所属人', `${agent.ownerName}${agent.ownerPresent ? '' : '（已离开空间）'}`], ['作用范围', repoName(agent.repositoryId)], ['版本', `v${agent.version}`], ['登记', agent.registered ? '已登记' : '已取消'], ['分享', accessLabels[agent.accessMode]], ['此空间', agent.blocked ? '已停用' : '未停用']])),
      governanceSwitch(agent));
  }

  function detail(agent) {
    const owner = agent.permissions.edit;
    const actions = [];
    if (owner) actions.push(button('编辑定义', { icon: 'edit', size: 'sm', onClick: () => { s.mode = 'edit'; open(agent.id); } }));
    const menuItems = [
      owner ? [agent.registered ? '取消 Agent 登记' : '恢复 Agent 登记', { icon: agent.registered ? 'minus-circle' : 'refresh', danger: agent.registered, onSelect: async () => {
        if (await ctx.confirm(agent.registered ? '取消后不再接受新调用，历史版本和任务仍然保留。' : '恢复后会按原来的分享范围重新可用。', { title: agent.registered ? '取消 Agent 登记？' : '恢复 Agent 登记？', confirmLabel: agent.registered ? '取消登记' : '恢复登记', danger: agent.registered }))
          mutate(() => ctx.api.setAgentRegistered(agent.id, !agent.registered), agent.registered ? 'Agent 已取消登记' : 'Agent 已恢复登记');
      } }] : null,
    ].filter(Boolean);
    if (menuItems.length) {
      const more = button('Agent 操作', { icon: 'more', iconOnly: true, variant: 'ghost', size: 'sm' });
      more.setAttribute('aria-haspopup', 'menu');
      more.addEventListener('click', () => popover(more, close => menuItems.map(([text, options]) => menuItem(text, { ...options, close })), { label: 'Agent 操作', align: 'end' }));
      actions.push(more);
    }
    const tabItems = [{ id: 'definition', label: '定义' }, ...(owner ? [{ id: 'history', label: '版本历史' }, { id: 'share', label: '分享' }] : [])];
    if (!tabItems.some(t => t.id === s.tab)) s.tab = 'definition';
    const t = tabs('agent', 'Agent 详情', tabItems, s.tab, (tab, focus) => { s.tab = tab; open(agent.id, { focus: false }); if (focus) split.panel.querySelector('[role=tab][aria-selected=true]')?.focus(); });
    const node = h('div', { class: 'panel-inner' },
      panelHead({ title: agent.name, badges: [badge('neutral', `v${agent.version}`), badge(agent.accessMode === 'private' ? 'neutral' : 'accent', accessLabels[agent.accessMode], 'share')], sub: [h('span', { text: owner ? '你的 Agent' : `${agent.ownerName}分享给你` }), mono(agent.id)], actions, onClose: () => split.close() }),
      agent.invocable ? null : banner('warn', '当前不能调用', !agent.registered ? '这个 Agent 已取消登记。恢复登记后才能调用。' : agent.blocked ? '这个 Agent 已在此空间停用。' : '所属人已经离开这个空间。'),
      owner ? null : banner('info', `由${agent.ownerName}分享给你`, '你可以调用它，也能看到当前定义；修改、历史版本和历史任务不对你开放。'),
      t.list, t.panel);
    if (s.tab === 'history') {
      t.panel.append(h('p', { class: 'section-lead', text: '每次保存都会生成新版本。已接受的任务继续使用接受时的版本。' }));
      ctx.api.agentVersions(agent.id).then(versions => t.panel.append(h('ol', { class: 'versions' }, versions.map(v => h('li', {},
        h('details', { class: 'disclosure', open: v.version === agent.version }, h('summary', {}, h('strong', { text: `v${v.version}` }), h('span', { text: fullTime(v.createdAt) }), v.version === agent.version ? badge('accent', '当前') : null),
          facts([['内容指纹', mono(v.contentHash)], ['Runtime', runtimeName(v.definition.runtimeId)], ['推理等级', v.definition.reasoningEffort ?? '默认']]),
          h('div', { class: 'report-text compact', text: v.definition.instructions })))))));
    } else if (s.tab === 'share') {
      t.panel.append(shareForm(agent));
    } else {
      const d = agent.definition;
      const runtime = runtimes.find(r => r.id === d.runtimeId);
      t.panel.append(
        h('div', { class: 'digest' }, h('div', { class: 'digest-item' }, h('h4', { text: '用途' }), h('p', { text: d.description || '没有用途说明' }))),
        h('article', { class: 'reading', 'aria-label': '指令' }, h('h4', { class: 'reading-title', text: '指令' }), h('div', { class: 'report-text', tabIndex: 0, text: d.instructions || '没有指令' })),
        facts([
          ['作用仓库', repoName(d.repositoryId)],
          ['Runtime', runtime ? h('span', {}, `${runtime.name} `, runtime.eligibility.eligible ? badge('ok', '可以选用') : badge('warn', runtime.eligibility.reason)) : runtimeName(d.runtimeId)],
          ['原生类型', d.flavor ? flavorLabels[d.flavor] : '由执行目标决定'], ['模型', d.model ?? '默认'], ['推理等级', d.reasoningEffort ?? '默认'], ['内容指纹', mono(agent.contentHash)],
        ]));
    }
    node.append(governanceSwitch(agent) ?? '');
    return node;
  }

  function shareForm(agent) {
    let mode = agent.accessMode;
    const checks = peers.map(peer => h('label', { class: 'check' }, h('input', { type: 'checkbox', value: peer.id, checked: agent.memberIds.includes(peer.id) }), h('span', { text: peer.name }), h('small', { class: 'mono', text: peer.username })));
    const memberBox = h('fieldset', { class: 'member-choices', hidden: mode !== 'members' }, h('legend', { text: '可以使用的成员' }), checks);
    const node = h('form', { class: 'form' },
      h('p', { class: 'section-lead', text: '分享只开放当前定义的读取和调用，不开放修改、历史版本或历史任务。Runtime 的使用权仍要单独取得。' }),
      segmented('分享范围', ['private', 'members', 'space'].map(value => ({ value, label: accessLabels[value] })), mode, value => { mode = value; memberBox.hidden = value !== 'members'; }),
      memberBox,
      h('div', { class: 'form-actions' }, button('保存分享范围', { type: 'submit', variant: 'primary' })));
    node.addEventListener('submit', async event => {
      event.preventDefault();
      const memberIds = checks.map(c => c.querySelector('input')).filter(i => i.checked).map(i => i.value);
      if (!await ctx.confirm('变更这个 Agent 的读取和调用范围，不会分享历史任务；撤回会让对应成员的调用失效。', { title: '保存分享范围？', confirmLabel: '保存' })) return;
      mutate(() => ctx.api.setAgentAccess(agent.id, mode, memberIds), '分享范围已保存');
    });
    return node;
  }

  function editor(agent) {
    const d = agent?.definition ?? blank;
    const repoChoices = [{ value: '', label: '整个空间' }, ...repositories.filter(r => r.registered || r.id === d.repositoryId).map(r => ({ value: r.id, label: r.registered ? r.name : `${r.name} · 已取消登记` }))];
    const runtimeChoices = [{ value: '', label: '不指定，使用个人选择' }, ...runtimes.filter(r => r.permissions.use || r.id === d.runtimeId).map(r => ({ value: r.id, label: `${r.name}${r.eligibility.eligible ? '' : ` · ${r.eligibility.reason}`}` }))];
    const name = field('名称', { value: d.name, required: true, max: 80 });
    const description = field('用途', { value: d.description, multiline: true, rows: 2, max: 4096, hint: '一句话说明它做什么，成员在选择时会看到。' });
    const instructions = field('指令', { value: d.instructions, multiline: true, rows: 9, max: 32768, hint: '交给执行 Agent 的业务指令。' });
    const repository = select('作用仓库', repoChoices, d.repositoryId ?? '');
    const runtime = select('默认 Runtime', runtimeChoices, d.runtimeId ?? '');
    const flavor = select('原生类型', [{ value: '', label: '由执行目标决定' }, { value: 'codex', label: 'Codex' }, { value: 'claude', label: 'Claude Code' }], d.flavor ?? '');
    const model = field('模型（可选）', { value: d.model ?? '', max: 256, placeholder: '默认' });
    const effort = field('推理等级（可选）', { value: d.reasoningEffort ?? '', max: 256, placeholder: '默认' });
    const error = h('div');
    const cancel = () => { s.mode = null; if (agent) open(agent.id); else split.close(); };
    const node = h('form', { class: 'form editor' },
      name.node, description.node, instructions.node,
      h('div', { class: 'form-grid' }, repository.node, runtime.node, flavor.node, model.node, effort.node),
      error,
      h('p', { class: 'hint', text: agent ? `保存后生成 v${agent.version + 1}。已接受的任务继续使用接受时的版本，新轮次使用新版本。` : '创建后默认只有你能看到，可以在“分享”里调整。' }),
      h('div', { class: 'form-actions sticky' }, button('取消', { onClick: cancel }), button(agent ? `保存为 v${agent.version + 1}` : '创建 Agent', { type: 'submit', variant: 'primary' })));
    node.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); cancel(); } });
    node.addEventListener('submit', async event => {
      event.preventDefault();
      const definition = { name: name.input.value.trim(), description: description.input.value, instructions: instructions.input.value, repositoryId: repository.input.value || null, runtimeId: runtime.input.value || null, flavor: flavor.input.value || null, model: model.input.value.trim() || null, reasoningEffort: effort.input.value.trim() || null };
      const saved = await ctx.run(() => (agent ? ctx.api.updateAgent(agent.id, agent.version, definition) : ctx.api.createAgent(definition)), { onError: e => error.replaceChildren(banner('danger', e.message, e.hint)) });
      if (!saved) return;
      s.mode = null; s.openId = saved.id; s.tab = 'definition';
      ctx.toast(agent ? `已保存为 v${saved.version}` : 'Agent 已创建，目前只有你能看到');
      ctx.refresh();
    });
    return h('div', { class: 'panel-inner' }, panelHead({ title: agent ? `编辑 ${agent.name}` : '新建 Agent', eyebrow: agent ? `当前 v${agent.version}` : null, onClose: () => split.close() }), node);
  }

  let body;
  if (!agents.length) body = emptyState({ icon: 'agent', title: '还没有 Agent', text: 'Agent 是一份带指令的配置：做什么、作用在哪个仓库、默认用哪个 Runtime。创建你自己的，或请所有者分享给你。', actions: [button('创建 Agent', { icon: 'plus', variant: 'primary', onClick: () => open('new') })] });
  else body = list;
  split.list.append(body);
  const node = h('div', { class: 'page-inner' },
    pageHead('Agent', '一份带指令的执行配置。共享只开放当前定义和调用，不开放修改和历史。', [button('创建 Agent', { icon: 'plus', variant: 'primary', onClick: event => { s.mode = null; open('new', { from: event.currentTarget }); } })]),
    split.root);
  if (s.openId) open(s.openId, { focus: false });
  return node;
}
