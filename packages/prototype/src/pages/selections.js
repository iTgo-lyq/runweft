import { h, icon } from '../ui/dom.js';
import { badge, banner, button, chain, emptyState, facts, form, mono, pageHead, select } from '../ui/kit.js';
import { flavorLabels } from '../mock.js';

export async function renderSelections(ctx) {
  const s = ctx.state;
  const [selections, agents, repositories, runtimes] = await Promise.all([ctx.api.selections(), ctx.api.agents(), ctx.api.repositories(), ctx.api.runtimes()]);
  const mutate = (action, success) => ctx.run(action, { success }).then(ok => { if (ok) ctx.refresh(); return ok; });
  const repoName = id => (id ? repositories.find(r => r.id === id)?.name ?? `原仓库不可见 · ${id}` : '整个空间');
  const agentById = id => agents.find(a => a.id === id);
  const runtimeById = id => runtimes.find(r => r.id === id);
  const usableAgents = scope => agents.filter(a => a.view === 'definition' && a.invocable && (a.repositoryId === null || a.repositoryId === scope));

  function problem(selection) {
    const agent = agentById(selection.agentId);
    if (!agent) return { title: '已保存的 Agent 不可见', text: `${selection.agentId}。修改或清除这条选择后才会继续解析。` };
    if (!agent.invocable) return { title: '已保存的 Agent 当前不可调用', text: `${agent.name} · ${!agent.registered ? '已取消登记' : agent.blocked ? '已在此空间停用' : '所属人已离开空间'}。这条选择不会自动换成其他 Agent，修改或清除后才会继续解析。` };
    if (selection.runtimeId) {
      const runtime = runtimeById(selection.runtimeId);
      if (!runtime) return { title: '已保存的 Runtime 不可见', text: `${selection.runtimeId}。修改或清除 Runtime 后才会继续解析。` };
      if (!runtime.eligibility.eligible) return { title: `已保存的 Runtime 不可用：${runtime.eligibility.reason}`, text: runtime.eligibility.hint };
    }
    return null;
  }

  function card(selection) {
    const agent = agentById(selection.agentId), runtime = selection.runtimeId ? runtimeById(selection.runtimeId) : null;
    const issue = problem(selection);
    const definitionRuntime = agent?.definition?.runtimeId ? runtimeById(agent.definition.runtimeId) : null;
    return h('article', { class: 'choice', dataset: { tone: issue ? 'warn' : '' } },
      h('header', { class: 'choice-head' }, h('span', { class: 'choice-icon' }, icon(selection.repositoryId ? 'repo' : 'space')), h('h3', { text: repoName(selection.repositoryId) }), issue ? badge('warn', '需要处理', 'st-attention') : badge('ok', '有效', 'st-done')),
      h('dl', { class: 'choice-body' },
        h('div', {}, h('dt', { text: 'Agent' }), h('dd', {}, agent ? `${agent.name} · v${agent.version}` : mono(selection.agentId))),
        h('div', {}, h('dt', { text: 'Runtime' }), h('dd', {}, runtime ? runtime.name : selection.runtimeId ? mono(selection.runtimeId) : [definitionRuntime?.name ?? '未指定', ' ', h('span', { class: 'tag', text: '按 Agent 定义' })]))),
      issue ? h('p', { class: 'choice-issue' }, h('strong', { text: issue.title }), ' ', issue.text) : null,
      h('div', { class: 'choice-actions' },
        button('修改', { icon: 'edit', size: 'sm', onClick: () => edit(selection) }),
        button('清除', { variant: 'ghost', size: 'sm', onClick: async () => {
          if (await ctx.confirm('清除后会按剩余的选择层解析，不会修改 Agent 或 Runtime。', { title: `清除“${repoName(selection.repositoryId)}”的选择？`, confirmLabel: '清除', danger: true })) mutate(() => ctx.api.clearSelection(selection.repositoryId), '选择已清除');
        } })));
  }

  function edit(existing) {
    const taken = new Set(selections.map(x => x.repositoryId ?? ''));
    const scopes = existing ? [{ value: existing.repositoryId ?? '', label: repoName(existing.repositoryId) }]
      : [{ value: '', label: '整个空间' }, ...repositories.filter(r => r.registered).map(r => ({ value: r.id, label: r.name }))].filter(option => !taken.has(option.value));
    if (!scopes.length) { ctx.toast('每个范围都已经有选择了，可以修改已有的选择', 'info'); return; }
    const scope = select('作用范围', scopes, scopes[0].value);
    scope.input.disabled = !!existing;
    const agent = select('Agent', [], '', { required: true });
    const runtime = select('Runtime', [], '', { hint: '只能选择与 Agent 类型相同、你当前可以使用的 Runtime。' });
    const fill = () => {
      const scopeId = scope.input.value || null;
      const options = usableAgents(scopeId).map(a => ({ value: a.id, label: `${a.name} · v${a.version}` }));
      if (existing && !options.some(o => o.value === existing.agentId)) options.push({ value: existing.agentId, label: `已保存但当前不可调用 · ${agentById(existing.agentId)?.name ?? existing.agentId}` });
      agent.input.replaceChildren(new Option('请选择 Agent', ''), ...options.map(o => new Option(o.label, o.value)));
      agent.input.value = existing?.agentId ?? '';
      fillRuntimes();
    };
    const fillRuntimes = () => {
      const chosen = agentById(agent.input.value);
      const flavor = chosen?.definition?.flavor;
      const options = runtimes.filter(r => r.permissions.use && (!flavor || r.flavor === flavor)).map(r => ({ value: r.id, label: `${r.name} · ${flavorLabels[r.flavor]}` }));
      runtime.input.replaceChildren(new Option('不指定，使用 Agent 定义', ''), ...options.map(o => new Option(o.label, o.value)));
      runtime.input.value = existing && existing.agentId === agent.input.value && options.some(o => o.value === existing.runtimeId) ? existing.runtimeId : '';
    };
    scope.input.addEventListener('change', fill);
    agent.input.addEventListener('change', fillRuntimes);
    fill();
    let handle;
    const node = form([scope.node, agent.node, runtime.node], '保存选择', async () => {
      const ok = await ctx.run(() => ctx.api.saveSelection({ repositoryId: scope.input.value || null, agentId: agent.input.value, runtimeId: runtime.input.value || null }));
      if (!ok) return;
      handle.close('done'); ctx.toast('选择已保存，只影响你自己'); ctx.refresh();
    }, { cancel: button('取消', { onClick: () => handle.close('cancel') }) });
    handle = ctx.dialog({ title: existing ? '修改选择' : '添加选择', description: '委派时如果没有显式指定，会按这里的选择决定 Agent 和 Runtime。', body: node });
  }

  // Resolution preview uses the same order as delegation, and fails instead of falling back.
  const scopeChoices = [{ value: '', label: '整个空间' }, ...repositories.filter(r => r.registered).map(r => ({ value: r.id, label: r.name }))];
  const previewScope = select('仓库', scopeChoices, s.previewScope ?? '');
  const previewAgent = select('显式 Agent（可选）', [{ value: '', label: '使用我的选择' }, ...agents.filter(a => a.view === 'definition' && a.invocable).map(a => ({ value: a.id, label: a.name }))], s.previewAgent ?? '');
  const previewRuntime = select('显式 Runtime（可选）', [{ value: '', label: '按选择或定义' }, ...runtimes.filter(r => r.permissions.use).map(r => ({ value: r.id, label: r.name }))], s.previewRuntime ?? '');
  const result = h('div', { class: 'resolution', role: 'status', tabIndex: -1 });
  const showResult = outcome => {
    if (!outcome) return result.replaceChildren();
    if (outcome.error) return result.replaceChildren(banner('warn', outcome.error.message, outcome.error.hint));
    const r = outcome.resolution;
    result.replaceChildren(h('div', { class: 'resolution-ok' },
      h('p', { class: 'resolution-path' }, chain([`${r.agent.name} · v${r.agent.version}`, r.runtime.name, r.machine], '解析结果')),
      facts([['Agent 来自', r.agentSource], ['Runtime 来自', r.runtimeSource], ['原生类型', flavorLabels[r.runtime.flavor]], ['配置指纹', mono(r.fingerprint)]]),
      h('p', { class: 'hint', text: '执行目标已经确认；模型认证、参数兼容和真实执行还没有检查。' })));
  };
  const previewForm = form([h('div', { class: 'form-grid three' }, previewScope.node, previewAgent.node, previewRuntime.node)], '解析', async () => {
    Object.assign(s, { previewScope: previewScope.input.value, previewAgent: previewAgent.input.value, previewRuntime: previewRuntime.input.value });
    try { s.preview = { resolution: await ctx.api.resolve({ repositoryId: previewScope.input.value || null, agentId: previewAgent.input.value, runtimeId: previewRuntime.input.value }) }; }
    catch (error) { if (error.kind === 'expired' || error.kind === 'unreachable') { ctx.showAlert(error); return; } s.preview = { error }; }
    showResult(s.preview);
    result.focus?.();
  });
  showResult(s.preview);

  const order = h('section', { class: 'order', 'aria-label': '解析顺序' },
    h('div', { class: 'order-row' }, h('span', { class: 'order-label', text: 'Agent' }), chain(['本次显式指定', '我的仓库选择', '我的空间默认'], 'Agent 的解析顺序')),
    h('div', { class: 'order-row' }, h('span', { class: 'order-label', text: 'Runtime' }), chain(['本次显式指定', '同一 Agent 的仓库选择', '同一 Agent 的空间默认', 'Agent 定义'], 'Runtime 的解析顺序')),
    h('p', { class: 'hint', text: '从左往右，第一个有值的层决定结果。决定的那一层失效时直接报错，不会自动换成下一层。' }));

  const cards = selections.map(card);
  const grid = selections.length
    ? h('div', { class: 'choices' }, cards, h('button', { type: 'button', class: 'choice choice-add', onClick: () => edit(null) }, icon('plus'), h('span', { text: '添加选择' })))
    : emptyState({ icon: 'sliders', title: '还没有保存选择', text: '可以在委派时显式指定 Agent，也可以在这里保存空间默认或仓库选择。', actions: [button('添加选择', { icon: 'plus', variant: 'primary', onClick: () => edit(null) })] });

  return h('div', { class: 'page-inner narrow' },
    pageHead('我的选择', '委派时默认使用哪个 Agent 和 Runtime。只影响你自己，不改变别人的配置。'),
    order, grid,
    h('section', { class: 'block' }, h('h2', { text: '验证解析' }), h('p', { class: 'section-lead', text: '按委派时的顺序解析一次，看看会用到哪个 Agent 和 Runtime。' }), previewForm, result));
}
