import { append, fullTime, h, icon, relative } from '../ui/dom.js';
import { badge, banner, button, chain, emptyState, facts, form, inlineEdit, menuItem, mono, pageHead, panelHead, popover, rovingRows, section, segmented, select, field, splitView, switchRow } from '../ui/kit.js';
import { flavorLabels } from '../mock.js';

const connectionBadge = state => ({
  online: badge('ok', '在线', 'st-done'),
  offline: badge('neutral', '离线', 'wifi-off'),
  pending: badge('neutral', '尚未首次连接', 'st-pending'),
}[state]);

function moreMenu(label, items) {
  const trigger = button(label, { icon: 'more', iconOnly: true, variant: 'ghost', size: 'sm' });
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.addEventListener('click', () => popover(trigger, close => items.filter(Boolean).map(([text, options]) => menuItem(text, { ...options, close })), { label, align: 'end' }));
  return trigger;
}

function listHead(columns) {
  return h('div', { class: 'list-head', 'aria-hidden': 'true' }, columns.map(text => h('span', { text })));
}

// ---- machines -------------------------------------------------------------------

export async function renderMachines(ctx) {
  const s = ctx.state;
  const [machines, spaces] = await Promise.all([ctx.api.machines(), ctx.api.spaces()]);
  const split = splitView('机器详情', () => { s.openId = null; mark(); });
  ctx.useSplit(split);
  const mutate = (action, success) => ctx.run(action, { success }).then(ok => { if (ok) ctx.refresh(); return ok; });

  const list = h('ul', { class: 'rows rows-table', 'aria-label': '机器列表' });
  rovingRows(list);
  for (const machine of machines) {
    const scopeText = !machine.associated ? '未关联' : machine.blocked ? '已在此空间停用' : '已关联';
    const row = h('button', { type: 'button', class: 'row resource-row', dataset: { key: machine.id, opened: String(s.openId === machine.id) } },
      h('span', { class: 'row-icon' }, icon('machine')),
      h('span', { class: 'cell cell-name' }, h('strong', { class: 'row-title', text: machine.name }),
        h('small', { text: machine.owner ? '你的机器' : `${machine.ownerName}的机器` }), machine.registered ? null : h('span', { class: 'tag', dataset: { tone: 'warn' } }, '已取消登记')),
      h('span', { class: 'cell', dataset: { label: '连接' } }, connectionBadge(machine.connection)),
      h('span', { class: 'cell', dataset: { label: '此空间', priority: 'low', tone: machine.blocked ? 'warn' : machine.associated ? '' : 'muted' } }, scopeText),
      h('span', { class: 'cell cell-muted', dataset: { label: '最后活动', priority: 'low' } }, relative(machine.lastActiveAt)),
      icon('chevron-right', 'icon row-go'));
    row.addEventListener('click', () => open(machine.id, { from: row }));
    list.append(h('li', {}, row));
  }

  function mark() { for (const row of list.querySelectorAll('.row')) row.dataset.opened = String(row.dataset.key === s.openId); }

  function open(id, { from, focus = true } = {}) {
    const machine = machines.find(m => m.id === id);
    if (!machine) return;
    s.openId = id; mark();
    split.open(machine.owner ? ownerPanel(machine) : summaryPanel(machine), id, { from, focus });
  }

  function governance(machine) {
    if (!machine.permissions.govern) return null;
    return section('此空间的治理', switchRow({
      label: `在“${ctx.space.name}”停用这台机器`, description: '只影响这个空间的新任务；所有权、其他空间和已接受的任务不受影响。', checked: machine.blocked,
      onChange: async on => { if (await ctx.confirm(on ? `停用后，“${ctx.space.name}”的成员不能再用这台机器执行新任务。` : '解除停用后，这台机器上已共享的 Runtime 会重新可选。', { title: on ? '在此空间停用？' : '解除停用？', confirmLabel: on ? '停用' : '解除停用', danger: on })) mutate(() => ctx.api.setMachineBlocked(machine.id, on), on ? '已在此空间停用' : '已解除停用'); },
    }));
  }

  function ownerPanel(machine) {
    const discovery = s.discovery?.[machine.id];
    const actions = moreMenu('机器操作', [
      machine.credential.status === 'active' ? ['撤销机器凭据', { icon: 'key', danger: true, onSelect: async () => {
        if (await ctx.confirm('撤销后 Runner 无法继续连接。需要在这台机器上让 Agent 轮换凭据并重启 Runner。', { title: '撤销机器凭据？', confirmLabel: '撤销凭据', danger: true })) mutate(() => ctx.api.revokeMachineCredential(machine.id), '机器凭据已撤销');
      } }] : null,
      [machine.registered ? '取消机器登记' : '恢复机器登记', { icon: machine.registered ? 'minus-circle' : 'refresh', danger: machine.registered, onSelect: async () => {
        if (!machine.registered) return mutate(() => ctx.api.setMachineRegistered(machine.id, true), '机器已恢复登记');
        if (await ctx.confirm('取消登记会阻止新的执行，不会删除会话或工作区。', { title: '取消机器登记？', confirmLabel: '取消登记', danger: true })) mutate(() => ctx.api.setMachineRegistered(machine.id, false), '机器已取消登记');
      } }],
    ]);
    const discoverButton = button('探测原生工具', { icon: 'search', size: 'sm', disabled: machine.connection !== 'online', onClick: async () => {
      const result = await ctx.run(() => ctx.api.discoverTools(machine.id));
      if (!result) return;
      (s.discovery ??= {})[machine.id] = result;
      open(machine.id, { focus: false });
      split.panel.querySelector('.tool-list')?.focus();
    } });
    return h('div', { class: 'panel-inner' },
      panelHead({ title: machine.name, badges: [connectionBadge(machine.connection), machine.registered ? null : badge('warn', '已取消登记')].filter(Boolean), sub: [h('span', { text: '你的机器' }), mono(machine.id)], actions: [actions], onClose: () => split.close() }),
      machine.connection === 'pending' ? banner('info', '这台机器还没有完成首次连接', '在那台机器上让 Agent 完成接入并启动 Runner。', [button('查看接入说明', { size: 'sm', onClick: () => ctx.showOnboarding('machine') })]) : null,
      machine.credential.status !== 'active' ? banner('danger', '机器凭据已撤销', 'Runner 无法连接。在这台机器上让 Agent 执行 machine rotate-credential 并重启 Runner。') : null,
      section('状态', facts([
        ['连接', connectionBadge(machine.connection)], ['登记', machine.registered ? '已登记' : '已取消'],
        ['机器凭据', h('span', {}, machine.credential.status === 'active' ? '有效 ' : '已撤销 ', mono(machine.credential.id))],
        ['最后活动', fullTime(machine.lastActiveAt)],
      ]), h('p', { class: 'hint', text: '轮换凭据要在这台机器上进行：让 Agent 执行 machine rotate-credential。' })),
      section('名称', inlineEdit({ label: '机器名称', value: machine.name, max: 64, onSave: name => mutate(() => ctx.api.renameMachine(machine.id, name), '机器名称已保存') })),
      section('空间关联', h('p', { class: 'section-lead', text: '关联后，这个空间才能使用这台机器上共享的 Runtime。关联本身不共享 Runtime。' }),
        h('div', { class: 'switch-list' }, spaces.map(space => switchRow({
          label: space.name, description: machine.spaceIds.includes(space.id) ? '已关联' : '未关联', checked: machine.spaceIds.includes(space.id),
          onChange: async on => {
            if (!on && !await ctx.confirm(`撤回关联也会撤回这台机器在“${space.name}”的 Runtime 共享；重新关联不会自动恢复共享。`, { title: '撤回空间关联？', confirmLabel: '撤回关联', danger: true })) return;
            mutate(() => ctx.api.setMachineSpace(machine.id, space.id, on), on ? `已关联到“${space.name}”` : `已撤回“${space.name}”的关联`);
          },
        })))),
      section('原生工具', h('p', { class: 'section-lead', text: '查看这台机器上能找到哪些 Codex 或 Claude Code。只确认工具存在，不检查模型认证。' }),
        discovery ? h('ul', { class: 'tool-list', tabIndex: -1 }, discovery.tools.map(tool => h('li', {}, icon(tool.found ? 'st-done' : 'st-failed'), h('strong', { text: flavorLabels[tool.flavor] }), h('span', { text: tool.found ? `已找到 · ${tool.version}` : '没有找到' })))) : null,
        discoverButton),
      governance(machine));
  }

  function summaryPanel(machine) {
    return h('div', { class: 'panel-inner' },
      panelHead({ title: machine.name, badges: [connectionBadge(machine.connection)], sub: [h('span', { text: `${machine.ownerName}的机器` }), mono(machine.id)], onClose: () => split.close() }),
      banner('lock', `这是${machine.ownerName}的机器`, '你只能查看概要。名称、凭据和空间关联由机器所有者管理。'),
      section('状态', facts([['连接', connectionBadge(machine.connection)], ['此空间', machine.blocked ? '已停用' : '已关联'], ['最后活动', fullTime(machine.lastActiveAt)]])),
      governance(machine));
  }

  let body;
  if (!machines.length) body = emptyState({ icon: 'machine', title: '还没有机器', text: '在要执行任务的电脑或服务器上，让 Agent 完成接入。接入后会出现在这里。', actions: [button('查看接入说明', { icon: 'link', onClick: () => ctx.showOnboarding('machine') })] });
  else body = [listHead(['', '名称', '连接', '此空间', '最后活动']), list];
  append(split.list, [machines.some(m => m.connection === 'offline') ? banner('offline', '有机器离线', '离线机器上的 Runtime 暂时不可选；已接受的任务记录不受影响。') : null, body]);

  const node = h('div', { class: 'page-inner' },
    pageHead('机器', '执行任务的电脑或服务器。首次接入和凭据轮换都在那台机器上由 Agent 完成。', [button('接入新机器', { icon: 'plus', variant: 'primary', onClick: () => ctx.showOnboarding('machine') })]),
    split.root);
  if (s.openId) open(s.openId, { focus: false });
  return node;
}

// ---- runtimes -------------------------------------------------------------------

export async function renderRuntimes(ctx) {
  const s = ctx.state;
  const [runtimes, spaces, own] = await Promise.all([ctx.api.runtimes(), ctx.api.spaces(), ctx.api.ownMachines()]);
  const split = splitView('Runtime 详情', () => { s.openId = null; mark(); });
  ctx.useSplit(split);
  const mutate = (action, success) => ctx.run(action, { success }).then(ok => { if (ok) ctx.refresh(); return ok; });

  const list = h('ul', { class: 'rows rows-table', 'aria-label': 'Runtime 列表' });
  rovingRows(list);
  for (const runtime of runtimes) {
    const shareText = runtime.owner ? (runtime.shared ? '已共享' : '未共享') : `${runtime.ownerName}共享`;
    const row = h('button', { type: 'button', class: 'row resource-row', dataset: { key: runtime.id, opened: String(s.openId === runtime.id) } },
      h('span', { class: 'row-icon' }, icon('runtime')),
      h('span', { class: 'cell cell-name' }, h('strong', { class: 'row-title', text: runtime.name }), chain([runtime.machineName, flavorLabels[runtime.flavor]])),
      h('span', { class: 'cell', dataset: { label: '此空间', priority: 'low', tone: runtime.shared || !runtime.owner ? '' : 'muted' } }, shareText),
      h('span', { class: 'cell', dataset: { label: '可用性' } }, runtime.eligibility.eligible ? badge('ok', '可以选用', 'st-done') : badge('warn', runtime.eligibility.reason, 'st-attention')),
      h('span', { class: 'cell cell-muted', dataset: { label: '工具版本', priority: 'low' } }, runtime.version ?? '尚未确认'),
      icon('chevron-right', 'icon row-go'));
    row.addEventListener('click', () => open(runtime.id, { from: row }));
    list.append(h('li', {}, row));
  }
  function mark() { for (const row of list.querySelectorAll('.row')) row.dataset.opened = String(row.dataset.key === s.openId); }

  function open(id, { from, focus = true } = {}) {
    const runtime = runtimes.find(r => r.id === id);
    if (!runtime) return;
    s.openId = id; mark();
    split.open(panel(runtime), id, { from, focus });
  }

  function panel(runtime) {
    const check = s.checks?.[runtime.id];
    const checkButton = button('检查 Runtime', { icon: 'search', size: 'sm', onClick: async () => {
      const result = await ctx.run(() => ctx.api.checkRuntime(runtime.id), { onError: error => { (s.checks ??= {})[runtime.id] = { error }; open(runtime.id, { focus: false }); } });
      if (!result) return;
      (s.checks ??= {})[runtime.id] = { result };
      open(runtime.id, { focus: false });
    } });
    const eligibility = runtime.eligibility.eligible ? badge('ok', '可以选用', 'st-done') : badge('warn', runtime.eligibility.reason, 'st-attention');
    const parts = [
      panelHead({ title: runtime.name, badges: [eligibility], sub: [h('span', { text: runtime.owner ? '你的 Runtime' : `${runtime.ownerName}共享到此空间` }), mono(runtime.id)],
        actions: runtime.permissions.manage ? [moreMenu('Runtime 操作', [[runtime.registered ? '取消 Runtime 登记' : '恢复 Runtime 登记', { icon: runtime.registered ? 'minus-circle' : 'refresh', danger: runtime.registered, onSelect: async () => {
          if (!runtime.registered) return mutate(() => ctx.api.setRuntimeRegistered(runtime.id, true), 'Runtime 已恢复登记');
          if (await ctx.confirm('取消登记会阻止新任务选用它，不删除原生历史。', { title: '取消 Runtime 登记？', confirmLabel: '取消登记', danger: true })) mutate(() => ctx.api.setRuntimeRegistered(runtime.id, false), 'Runtime 已取消登记');
        } }]])] : [],
        onClose: () => split.close() }),
      runtime.eligibility.eligible ? null : banner('warn', `现在不能选用：${runtime.eligibility.reason}`, runtime.eligibility.hint),
      runtime.owner ? null : banner('lock', `由${runtime.ownerName}共享到此空间`, '你可以选用和检查它，但不能修改配置或共享范围。共享会消耗对方机器的模型额度。'),
      section('状态', facts([
        ['机器', h('span', {}, `${runtime.machineName} `, connectionBadge(runtime.machineConnection))], ['原生工具', flavorLabels[runtime.flavor]],
        ['工具版本', `${runtime.version ?? '尚未确认'} · 观察于 ${relative(runtime.inspectedAt)}`], ['登记', runtime.registered ? '已登记' : '已取消'],
        ['模型认证与执行', '未检查'],
      ]),
      check?.result ? banner('ok', `找到 ${flavorLabels[runtime.flavor]} · ${check.result.version}`, '只确认了工具存在和版本；模型认证、参数和真实执行没有检查。') : null,
      check?.error ? banner('warn', check.error.message, check.error.hint) : null,
      runtime.permissions.use || runtime.permissions.manage ? checkButton : null),
    ];
    if (runtime.permissions.manage) {
      parts.push(section('名称', inlineEdit({ label: 'Runtime 名称', value: runtime.name, max: 64, onSave: name => mutate(() => ctx.api.renameRuntime(runtime.id, name), 'Runtime 名称已保存') })));
      parts.push(section('共享到空间', h('p', { class: 'section-lead', text: '共享后，空间成员可以用它执行任务，会消耗这台机器的模型额度。不提供系统隔离，也不会公开你的历史任务。' }),
        h('div', { class: 'switch-list' }, spaces.map(space => {
          const associated = runtime.machineSpaceIds.includes(space.id);
          return switchRow({
            label: space.name, description: associated ? (runtime.shareSpaceIds.includes(space.id) ? '已共享' : '未共享') : `先把 ${runtime.machineName} 关联到这个空间`,
            checked: runtime.shareSpaceIds.includes(space.id), disabled: !associated && !runtime.shareSpaceIds.includes(space.id),
            onChange: async on => {
              const message = on ? `允许“${space.name}”的成员使用 ${runtime.name}？会消耗这台机器的模型额度，不提供系统隔离。` : '撤回后这个空间不能再发起新轮次；运行中的任务会被核对并停止，停止未确认时保留未知状态。';
              if (await ctx.confirm(message, { title: on ? '共享 Runtime？' : '撤回共享？', confirmLabel: on ? '共享' : '撤回共享', danger: !on })) mutate(() => ctx.api.setRuntimeShare(runtime.id, space.id, on), on ? `已共享到“${space.name}”` : `已撤回“${space.name}”的共享`);
            },
          });
        }))));
    }
    if (runtime.permissions.govern) parts.push(section('此空间的治理', switchRow({
      label: `在“${ctx.space.name}”停用这个 Runtime`, description: '只变更这个空间的治理状态，不取得他人的配置或任务内容。', checked: runtime.blocked,
      onChange: async on => { if (await ctx.confirm(on ? '停用后，这个空间不能再选用它执行新任务。' : '解除停用后，它会重新可选。', { title: on ? '在此空间停用？' : '解除停用？', confirmLabel: on ? '停用' : '解除停用', danger: on })) mutate(() => ctx.api.setRuntimeBlocked(runtime.id, on), on ? '已在此空间停用' : '已解除停用'); },
    })));
    return h('div', { class: 'panel-inner' }, parts);
  }

  function register() {
    const machine = select('执行机器', own.map(m => ({ value: m.id, label: `${m.name} · ${{ online: '在线', offline: '离线', pending: '尚未首次连接' }[m.connection]}` })), own.find(m => m.connection === 'online')?.id ?? own[0]?.id);
    let flavor = 'codex';
    const flavorControl = h('div', { class: 'field' }, h('span', { class: 'field-label', id: 'flavor-label', text: '原生工具' }), segmented('原生工具', [{ value: 'codex', label: 'Codex' }, { value: 'claude', label: 'Claude Code' }], flavor, value => { flavor = value; }));
    const name = field('名称（可选）', { max: 64, placeholder: '留空时使用机器名和工具名' });
    const error = h('div');
    let handle;
    const node = form([machine.node, flavorControl, name.node, h('p', { class: 'hint', text: '登记会在机器上确认工具存在，机器需要在线。Codex 和 Claude Code 分别登记。' }), error], '登记 Runtime', async () => {
      const created = await ctx.run(() => ctx.api.registerRuntime({ machineId: machine.input.value, flavor, name: name.input.value.trim() }), { onError: e => error.replaceChildren(banner('danger', e.message, e.hint)) });
      if (!created) return;
      handle.close('done'); s.openId = created.id; ctx.toast('Runtime 已登记，目前只有你能选用'); ctx.refresh();
    }, { cancel: button('取消', { onClick: () => handle.close('cancel') }) });
    handle = ctx.dialog({ title: '登记 Runtime', description: '把一台你的机器上的 Codex 或 Claude Code 登记为可选的执行工具。', body: node });
  }

  let body;
  if (!runtimes.length) body = emptyState({ icon: 'runtime', title: '还没有 Runtime', text: own.length ? '把机器上的 Codex 或 Claude Code 登记为 Runtime，之后就能在 Agent 和个人选择里用它。' : '先接入一台机器，再登记机器上的 Codex 或 Claude Code。', actions: own.length ? [button('登记 Runtime', { icon: 'plus', variant: 'primary', onClick: register })] : [button('查看接入说明', { icon: 'link', onClick: () => ctx.showOnboarding('machine') })] });
  else body = [listHead(['', '名称', '此空间', '可用性', '工具版本']), list];
  append(split.list, body);

  const node = h('div', { class: 'page-inner' },
    pageHead('Runtime', '机器上的 Codex 或 Claude Code，分别登记。共享给空间后，成员可以用它执行任务。', own.length ? [button('登记 Runtime', { icon: 'plus', variant: 'primary', onClick: register })] : []),
    split.root);
  if (s.openId) open(s.openId, { focus: false });
  return node;
}
