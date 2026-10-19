import { append, fullTime, h, icon, relative } from '../ui/dom.js';
import { badge, banner, button, chain, emptyState, facts, field, menuItem, mono, pageHead, panelHead, popover, rovingRows, section, select, segmented, splitView, statusBadge, tabs, taskStatus, weft } from '../ui/kit.js';
import { HUB_ORIGIN, flavorLabels, phaseLabels } from '../mock.js';

const statusFilter = [{ value: '', label: '全部' }, ...['needs_attention', 'unknown', 'running', 'completed', 'failed', 'interrupted'].map(value => ({ value, label: taskStatus[value].label }))];
const modeLabels = { shared: '共享目录', worktree: '独立 worktree' };
const numbers = new Intl.NumberFormat('zh-CN');

export function stopText(task) {
  return task.stop === 'stopped' ? '进程已结束' : task.stop === 'stopping' ? '等待进程结束' : task.stop === 'unconfirmed' ? '尚未确认进程状态' : '进程运行中';
}
export function codeText(code) {
  if (code.status === 'pending' && code.sealing_status === 'needs_attention') return '封存待处理';
  return { not_applicable: '不交付代码', pending: '等待封存', capturing: '正在捕获', publishing: '正在上传', available: code.ref ? '可以取回' : '可以审阅', needs_attention: '需要处理', unknown: '状态未知', releasing: '正在释放', released: '已释放', discarded: '已放弃' }[code.status] ?? code.status;
}
export function filesText(files) {
  if (files.retention !== 'retained') return { releasing: '正在释放', released: '已释放', discarded: '已放弃' }[files.retention] ?? files.retention;
  return files.status === 'none' ? '没有声明附件' : files.status === 'delivered' ? `已交付 ${files.available} 项` : files.status === 'incomplete' ? `待补齐 ${files.available}/${files.count}` : '正在交付';
}

function deliveryTags(task) {
  const tags = [];
  if (task.files.status === 'delivered' && task.files.retention === 'retained') tags.push(h('span', { class: 'tag' }, icon('file'), `附件 ${task.files.available}`));
  if (task.code.status === 'available') tags.push(h('span', { class: 'tag', dataset: { tone: 'accent' } }, icon('code'), '代码可取回'));
  if (task.code.sealing_status === 'needs_attention') tags.push(h('span', { class: 'tag', dataset: { tone: 'warn' } }, icon('code'), '代码封存待处理'));
  if (task.possibly_stale) tags.push(h('span', { class: 'tag', dataset: { tone: 'warn' } }, icon('wifi-off'), '可能滞后'));
  return tags;
}

export async function renderTasks(ctx) {
  const s = ctx.state;
  Object.assign(s, { status: s.status ?? '', workspace: s.workspace ?? '', parent: s.parent ?? '', limit: s.limit ?? 50, page: s.page ?? 1, find: s.find ?? '', tab: s.tab ?? 'report' });
  const view = await ctx.api.taskOverview({ status: s.status, workspace: s.workspace, parent: s.parent, page: s.page, limit: s.limit });
  s.page = view.page;
  const split = splitView('任务详情', () => { s.openId = null; markOpened(); });
  ctx.useSplit(split);

  const filtered = !!(s.status || s.workspace || s.parent);
  const extraFilters = [s.workspace, s.parent].filter(Boolean).length + (s.limit !== 50 ? 1 : 0);
  const reload = () => { s.page = 1; ctx.refresh(); };

  const chips = segmented('按状态筛选', statusFilter, s.status, value => { s.status = value; s.openId = null; reload(); }, 'chips');
  const filterButton = button(extraFilters ? `筛选 · ${extraFilters}` : '筛选', { icon: 'filter', size: 'sm', onClick: () => openFilters(filterButton) });
  filterButton.setAttribute('aria-haspopup', 'dialog');
  const find = h('input', { type: 'search', class: 'find-input', placeholder: '在本页查找', 'aria-label': '在本页查找', value: s.find, dataset: { find: 'true' } });
  find.addEventListener('input', () => { s.find = find.value; applyFind(); });

  function openFilters(trigger) {
    popover(trigger, close => {
      const workspace = field('来源工作目录包含', { value: s.workspace, placeholder: '例如 runweft-web' });
      const parent = field('主宿主包含', { value: s.parent, placeholder: 'Codex、Claude Code 或机器', hint: '匹配主宿主类型、机器或工作目录。' });
      const limit = select('每页数量', [10, 25, 50, 100].map(value => ({ value: String(value), label: `${value} 个` })), String(s.limit));
      const node = h('form', { class: 'form popover-form' }, workspace.node, parent.node, limit.node,
        h('div', { class: 'form-actions' },
          button('清除', { variant: 'ghost', onClick: () => { Object.assign(s, { workspace: '', parent: '', limit: 50 }); close(); reload(); } }),
          button('应用筛选', { type: 'submit', variant: 'primary' })));
      node.addEventListener('submit', event => { event.preventDefault(); Object.assign(s, { workspace: workspace.input.value.trim(), parent: parent.input.value.trim(), limit: Number(limit.input.value) }); close(); reload(); });
      return node;
    }, { className: 'popover', role: 'dialog', label: '筛选任务', align: 'end' });
  }

  const tokens = [];
  if (s.workspace) tokens.push(['工作目录包含', s.workspace, () => { s.workspace = ''; reload(); }]);
  if (s.parent) tokens.push(['主宿主包含', s.parent, () => { s.parent = ''; reload(); }]);
  const tokenRow = tokens.length ? h('div', { class: 'tokens' }, tokens.map(([label, value, clear]) =>
    h('span', { class: 'token' }, `${label} “${value}”`, button(`清除“${label}”`, { icon: 'x', iconOnly: true, variant: 'ghost', size: 'xs', onClick: clear })))) : null;

  const list = h('ul', { class: 'rows', 'aria-label': '任务列表' });
  rovingRows(list);
  for (const task of view.items) {
    const status = taskStatus[task.status];
    const text = task.attention ? task.attention.message : task.summary ? task.summary.split('\n')[0] : '尚无最终报告';
    const row = h('button', { type: 'button', class: 'row task-row', dataset: { key: task.id, tone: status.tone, opened: String(s.openId === task.id), search: `${task.agent.name} ${task.summary} ${task.machine.name} ${task.runtime.name} ${task.cwd}`.toLowerCase() } },
      h('span', { class: 'row-icon', dataset: { tone: status.tone } }, icon(status.icon)),
      h('span', { class: 'row-main' },
        h('span', { class: 'row-top' }, h('strong', { class: 'row-title', text: task.agent.name }), h('span', { class: 'row-status', dataset: { tone: status.tone }, text: status.label }), h('span', { class: 'row-time', text: relative(task.updated_at) })),
        h('span', { class: 'row-text', dataset: { tone: task.attention ? status.tone : task.summary ? '' : 'muted' }, text }),
        h('span', { class: 'row-meta' }, chain([task.machine.name, flavorLabels[task.runtime.flavor], `第 ${task.round} 轮`]), h('span', { class: 'tag' }, modeLabels[task.workspace_mode]), deliveryTags(task))),
      icon('chevron-right', 'icon row-go'));
    row.addEventListener('click', () => openTask(task.id, { from: row }));
    list.append(h('li', {}, row));
  }

  const findEmpty = h('div', { hidden: true });
  const findNote = h('p', { class: 'list-note', hidden: true });
  function applyFind() {
    const term = s.find.trim().toLowerCase();
    let shown = 0;
    for (const row of list.querySelectorAll('.row')) { const hit = !term || row.dataset.search.includes(term); row.parentElement.hidden = !hit; shown += hit; }
    findNote.hidden = !term;
    findNote.textContent = term ? `“${s.find.trim()}”在这一页的 ${view.items.length} 个任务中找到 ${shown} 个。查找只覆盖当前这一页。` : '';
    findEmpty.hidden = !(term && !shown && view.items.length);
    findEmpty.replaceChildren(findEmpty.hidden ? '' : emptyState({ icon: 'search', title: `这一页没有包含“${s.find.trim()}”的任务`, text: '查找只覆盖当前这一页。可以翻页，或用“筛选”按工作目录和主宿主查询全部任务。' }));
  }

  const pager = view.pages > 1 || view.total > 0 ? h('nav', { class: 'pager', 'aria-label': '任务分页' },
    h('span', { class: 'pager-text', text: `第 ${view.page} / ${view.pages} 页 · 每页 ${view.limit} 个` }),
    button('上一页', { icon: 'chevron-left', size: 'sm', disabled: view.page <= 1, onClick: () => { s.page--; s.openId = null; ctx.refresh(); } }),
    button('下一页', { size: 'sm', disabled: view.page >= view.pages, onClick: () => { s.page++; s.openId = null; ctx.refresh(); } })) : null;
  pager?.lastChild.append(icon('chevron-right'));

  let body;
  if (!view.total && !filtered) body = emptyState({ icon: 'tasks', title: '还没有任务', text: ctx.firstRun ? '回到原对话，Agent 会准备执行环境并发起第一次评审。任务开始后会出现在这里。' : '在 Codex 或 Claude Code 里让 Agent 委派任务，开始后会出现在这里。', actions: [button('查看接入说明', { icon: 'link', onClick: () => ctx.showOnboarding() })] });
  else if (!view.total) body = emptyState({ icon: 'filter', title: '没有符合条件的任务', text: '调整筛选条件，或清除筛选查看全部任务。', actions: [button('清除筛选', { onClick: () => { Object.assign(s, { status: '', workspace: '', parent: '' }); reload(); } })] });
  else body = [h('div', { class: 'list-meta' }, h('span', { text: `${filtered ? '符合条件的任务' : '你的任务'} ${view.total} 个` }), h('span', { class: 'list-meta-hint', text: '需要你处理的排在最前' })), findNote, list, findEmpty, pager];

  append(split.list, [
    view.inventory.available ? null : banner('offline', '机器状态暂时无法读取', '下面是任务记录。进行中的任务可能已经变化，标记“可能滞后”的条目以机器恢复后的观察为准。'),
    h('div', { class: 'toolbar-row' }, chips, h('div', { class: 'toolbar-row-end' }, h('label', { class: 'find' }, icon('search'), find), filterButton)),
    tokenRow, body]);
  applyFind();

  function markOpened() {
    for (const row of list.querySelectorAll('.row')) row.dataset.opened = String(row.dataset.key === s.openId);
  }

  async function openTask(id, { from, focus = true } = {}) {
    if (s.openId !== id) { s.roundId = null; s.offset = 0; s.tab = 'report'; }
    s.openId = id;
    markOpened();
    try {
      const detail = await ctx.api.taskDetail(id, { roundId: s.roundId, offset: s.offset });
      split.open(detailView(detail), id, { from, focus });
    } catch (error) {
      split.open(h('div', { class: 'panel-inner' }, panelHead({ title: '任务详情', onClose: () => split.close() }),
        banner('danger', error.message, error.hint, [button('重试', { size: 'sm', onClick: () => openTask(id) })])), id, { from, focus });
    }
  }

  function detailView(d) {
    const status = taskStatus[d.status];
    const more = button('更多操作', { icon: 'more', iconOnly: true, variant: 'ghost', size: 'sm' });
    more.setAttribute('aria-haspopup', 'menu');
    more.addEventListener('click', () => popover(more, close => [
      menuItem('打开原生文件', { icon: 'file', close, onSelect: () => ctx.openNative(d, 'files') }),
      menuItem('刷新详情', { icon: 'refresh', close, onSelect: () => openTask(d.id) }),
    ], { label: '任务操作', align: 'end' }));
    const node = h('div', { class: 'panel-inner' },
      panelHead({
        title: d.agent.name, badges: [statusBadge(d.status)], sub: [mono(d.id), h('span', { text: `更新于 ${relative(d.updated_at)}` })],
        actions: [button('打开原生会话', { icon: 'external', variant: 'primary', size: 'sm', onClick: () => ctx.openNative(d, 'session') }), more],
        onClose: () => split.close(),
      }));
    if (d.attention) node.append(banner(status.tone === 'unknown' ? 'unknown' : 'warn', d.attention.message, d.attention.hint));
    if (d.report.incomplete) node.append(banner('warn', '报告可能不完整', '停止已经确认，但部分原生终态还没有观察到。'));
    node.append(h('div', { class: 'weft-wrap' }, weft(d.rounds.map(r => ({ ...r, phaseLabel: phaseLabels[r.phase], tone: r.phase === 'failed' ? 'danger' : r.phase === 'finished' ? 'ok' : 'accent' })), d.round_id,
      roundId => { if (roundId === d.round_id) return; s.roundId = roundId; s.offset = 0; openTask(d.id, { focus: false }).then(() => split.panel.querySelector('.weft [aria-current=step]')?.focus()); })));
    const tabList = [{ id: 'report', label: '报告' }, { id: 'delivery', label: '交付' }, { id: 'details', label: '详情' }, { id: 'continue', label: '继续处理' }];
    const t = tabs('task', '任务详情', tabList, s.tab, (tab, focus) => { s.tab = tab; const fresh = detailView(d); split.open(fresh, d.id, { focus: false }); if (focus) split.panel.querySelector('[role=tab][aria-selected=true]')?.focus(); });
    append(t.panel, tabContent(d));
    node.append(t.list, t.panel);
    return node;
  }

  function tabContent(d) {
    if (s.tab === 'delivery') {
      const files = d.delivery.files.length ? h('ul', { class: 'file-list' }, d.delivery.files.map(name => h('li', {}, icon('file'), h('span', { class: 'mono', text: name }),
        button(`在原生文件中查看 ${name}`, { icon: 'external', iconOnly: true, variant: 'ghost', size: 'sm', onClick: () => ctx.openNative(d, 'files') })))) : null;
      return [
        section('附件', h('p', { class: 'section-lead', text: filesText(d.files) }), files),
        section('代码', facts([['状态', codeText(d.code)], d.code.ref ? ['交付引用', mono(d.code.ref)] : null, d.code.result_head ? ['结果提交', mono(d.code.result_head)] : null]),
          d.code.next ? h('div', { class: 'next-step' }, icon('arrow-right'), h('div', {}, h('p', { text: d.code.next.hint }), h('code', { class: 'command', text: d.code.next.command }))) : null),
        section('进程', h('p', { class: 'section-lead', text: stopText(d) })),
      ];
    }
    if (s.tab === 'details') {
      const json = (title, value) => h('details', { class: 'disclosure' }, h('summary', { text: title }), h('pre', { class: 'code-block', text: JSON.stringify(value, null, 2) }));
      return [
        facts([
          ['状态', statusBadge(d.status)], ['阶段', `${phaseLabels[d.phase]} · ${stopText(d)}`],
          ['工作区', h('span', {}, `${modeLabels[d.workspace_mode]} `, mono(d.cwd))], ['来源', h('span', {}, `${d.parent.host} · `, mono(d.parent.cwd))],
          ['执行目标', chain([d.machine.name, d.runtime.name])], ['配置版本', h('span', {}, `v${d.agent_config.hub.version} · `, mono(d.agent_config.hub.contentHash))],
          ['最后观察', fullTime(d.observed_at)],
        ]),
        json('本轮 Agent 配置快照', d.agent_config), json('工作环境', d.environment), json('主宿主', d.parent),
      ];
    }
    if (s.tab === 'continue') {
      const prompt = `请在 ${HUB_ORIGIN} 的空间 ${ctx.space.id} 检查任务 ${d.id}，先运行 task show 核对第 ${d.round} 轮（${d.round_id}）的状态，再按我的要求续接、停止或取回成果。执行未知时不要盲目重发；取回 bundle 后由主 Agent 审查合入，不自动 push。显式清理前说明删除范围。`;
      return [
        h('p', { class: 'section-lead', text: '续接、停止、取回成果和清理都由 Agent 完成。把下面的说明交给 Codex 或 Claude Code：' }),
        h('pre', { class: 'prompt', tabIndex: 0, text: prompt }),
        d.status === 'unknown' ? banner('unknown', '这一轮的执行状态还没有确认', '先让 Agent 核对，确认之前不要重新发起这一轮。') : null,
      ];
    }
    const parts = [];
    const r = d.report;
    if (r.structured) parts.push(h('div', { class: 'digest' }, [['摘要', r.structured.summary], ['变更', r.structured.changes], ['测试', r.structured.tests], ['剩余事项', r.structured.remaining]]
      .map(([label, value]) => h('div', { class: 'digest-item' }, h('h4', { text: label }), h('p', { text: value })))));
    if (r.text) {
      const paged = r.total > r.text.length;
      parts.push(h('article', { class: 'reading', 'aria-label': '完整报告' },
        h('h4', { class: 'reading-title', text: r.structured ? '完整报告' : '报告' }),
        h('div', { class: 'report-text', tabIndex: 0, text: r.text }),
        paged ? h('nav', { class: 'pager', 'aria-label': '报告分段' },
          h('span', { class: 'pager-text', text: `${numbers.format(r.offset + 1)}–${numbers.format(r.offset + r.text.length)} / ${numbers.format(r.total)} 字` }),
          button('上一段', { icon: 'chevron-left', size: 'sm', disabled: !r.offset, onClick: () => { s.offset = Math.max(0, r.offset - 16000); openTask(d.id, { focus: false }).then(() => split.panel.querySelector('.report-text')?.focus()); } }),
          button('下一段', { size: 'sm', disabled: r.next_offset === null, onClick: () => { s.offset = r.next_offset; openTask(d.id, { focus: false }).then(() => split.panel.querySelector('.report-text')?.focus()); } })) : null));
      parts.at(-1).querySelector('.pager')?.lastChild.append(icon('chevron-right'));
    } else {
      parts.push(emptyState({ icon: 'file', title: '这一轮还没有最终报告', text: '这不代表任务没有执行。可以打开原生会话查看进展。' }));
    }
    return parts;
  }

  const node = h('div', { class: 'page-inner' }, pageHead('任务', `你在“${ctx.space.name}”委派的任务。这里只显示你本人的任务，共享 Agent 不会分享任务记录。`), split.root);
  if (s.openId && view.items.some(t => t.id === s.openId)) await openTask(s.openId, { focus: false });
  else s.openId = null;
  return node;
}
