import './forms.js';
import { connectPreview } from '../../../.agents/skills/spec-trail/prototype/scripts/bridge.mjs';
import { NOW, clockTime, h, icon, mark } from './ui/dom.js';
import { avatar, banner, button, closeLayer, confirmDialog, emptyState, field, menuItem, menuLabel, menuSeparator, openDialog, popover, segmented, submitForm, toast } from './ui/kit.js';
import { HUB_ORIGIN, HubError, createDemo, roleLabels } from './mock.js';
import { renderAccount } from './pages/account.js';
import { renderTasks } from './pages/tasks.js';
import { renderMachines, renderRuntimes } from './pages/resources.js';
import { renderAgents } from './pages/agents.js';
import { renderRepositories } from './pages/repositories.js';
import { renderSelections } from './pages/selections.js';
import { renderMembers } from './pages/members.js';
import { renderSettings } from './pages/settings.js';

const pages = {
  tasks: { label: '任务', icon: 'tasks', group: '工作', render: renderTasks },
  machines: { label: '机器', icon: 'machine', group: '执行资源', render: renderMachines },
  runtimes: { label: 'Runtime', icon: 'runtime', group: '执行资源', render: renderRuntimes },
  agents: { label: 'Agent', icon: 'agent', group: '执行资源', render: renderAgents },
  repositories: { label: '仓库', icon: 'repo', group: '空间', render: renderRepositories },
  selections: { label: '我的选择', icon: 'sliders', group: '空间', render: renderSelections },
  members: { label: '成员', icon: 'users', group: '空间', render: renderMembers },
  settings: { label: '账号设置', icon: 'account', render: renderSettings },
};
const scenarios = [
  { value: 'normal', label: '正常' }, { value: 'empty', label: '空数据' }, { value: 'error', label: '首次加载失败' },
  { value: 'refresh-error', label: '刷新失败' }, { value: 'offline', label: '离线或结果未知' }, { value: 'expired', label: '登录过期' },
];
const accountScenes = [
  { value: 'register', label: '首次注册并连接' }, { value: 'login', label: '已有账号（多个空间）' }, { value: 'expired-request', label: '连接请求过期' },
  { value: 'recover', label: '忘记密码' }, { value: 'settings', label: '账号设置' }, { value: 'first-run', label: '首次工作台' },
];

const entry = document.body.dataset.entry;
const initialRoute = entry === 'account-onboarding' ? 'account' : pages[entry] ? entry : 'tasks';
const demo = createDemo();
const app = { route: initialRoute, scene: 'register', notice: null, returnTo: null, theme: 'system', state: {}, epoch: 0, split: null, alert: null };
const root = document.getElementById('app');
let shell = null;

// ---- helpers shared with pages ---------------------------------------------

function context() {
  return {
    api: demo.api, demo, app, user: demo.user, role: demo.role(), manager: demo.isManager(), space: demo.space(), firstRun: demo.firstRun,
    state: (app.state[`${demo.settings.spaceId}:${app.route}`] ??= {}),
    navigate, refresh, run, toast, confirm: confirmDialog, dialog: openDialog, showOnboarding, openNative, pages,
    useSplit(split) { app.split = split; },
    showAlert,
  };
}

// Writes go through one path so expired sessions and unconfirmed results are handled the same way everywhere.
async function run(action, { success, onError } = {}) {
  try {
    const result = await action();
    if (success) toast(success);
    return result ?? true;
  } catch (error) {
    if (!(error instanceof HubError)) throw error;
    if (error.kind === 'expired') { expire(); return false; }
    if (onError) { onError(error); return false; }
    showAlert(error);
    return false;
  }
}

function showAlert(error) {
  app.alert = error;
  const slot = document.getElementById('page-alert');
  if (!slot) return;
  const tone = error.kind === 'unknown' ? 'warn' : error.kind === 'unreachable' ? 'offline' : 'danger';
  const actions = error.kind === 'unknown' ? [button('刷新核对', { icon: 'refresh', size: 'sm', onClick: () => refresh() })] : [];
  slot.replaceChildren(banner(tone, error.message, error.hint, [...actions, button('关闭提示', { icon: 'x', iconOnly: true, variant: 'ghost', size: 'sm', onClick: () => { app.alert = null; slot.replaceChildren(); } })]));
  slot.querySelector('.banner')?.scrollIntoView?.({ block: 'nearest' });
}

function showOnboarding(kind = 'hub') {
  const text = `请按 Runweft 产品 Skill 帮我接入 ${HUB_ORIGIN} 并完成一次只读评审体验。先检查已有安装和连接；没有有效连接时给我浏览器注册/登录授权链接，再用 complete --wait 60 继续。密码由我在自己的界面输入。通过 CLI 复用或准备机器、Runtime、当前仓库关联和私有评审 Agent，发起任务并读回完整报告；保留其他 MCP 与原生配置，MCP 重载及实际可用性单独报告。`;
  let handle;
  handle = openDialog({
    title: kind === 'machine' ? '接入新机器' : '让 Agent 帮你接入',
    description: kind === 'machine'
      ? '在要接入的那台机器上，把下面的说明交给 Codex 或 Claude Code。机器登记和凭据都在那台机器上完成，浏览器里不需要操作。'
      : '把下面的说明交给 Codex 或 Claude Code。密码由你在自己的终端或浏览器里输入，不要发给模型。',
    body: h('pre', { class: 'prompt', tabIndex: 0, text }),
    actions: [button('完成', { variant: 'primary', onClick: () => handle.close('done') })],
  });
}

function openNative(detail, kind) {
  let handle;
  handle = openDialog({
    title: kind === 'files' ? '原生文件' : '原生会话',
    description: '实际产品会在新标签页打开这一轮的 HAPI 页面。',
    body: [
      h('div', { class: 'native-preview' }, icon(kind === 'files' ? 'file' : 'external'), h('div', {},
        h('strong', { text: kind === 'files' ? `${detail.agent.name} · 第 ${detail.round} 轮的文件与差异` : `${detail.agent.name} · 第 ${detail.round} 轮的消息与审批` }),
        h('span', { class: 'mono', text: detail.native.session_id }))),
      h('p', { class: 'hint', text: '新标签页只获得当前账号和空间的限时访问，不会取得机器的 shell。过期后回到这里重新打开。审批、消息和文件都在 HAPI 页面里处理。' }),
    ],
    actions: [button('知道了', { variant: 'primary', onClick: () => handle.close('done') })],
  });
}

// ---- routing -------------------------------------------------------------------

function navigate(route, { focus = true } = {}) {
  closeLayer();
  app.alert = null;
  if (route === 'account') { app.route = 'account'; renderAll(); return; }
  const wasWorkspace = app.route !== 'account' && shell;
  app.route = route;
  document.body.dataset.nav = 'closed';
  if (!wasWorkspace) renderAll({ focus });
  else { updateShell(); renderPage({ focus }); }
}

function refresh() { return renderPage({ refreshing: true }); }

function expire() {
  const previous = app.route;
  app.returnTo = previous === 'account' ? 'tasks' : previous;
  app.scene = 'signin';
  app.notice = { tone: 'warn', title: '登录已失效', text: `重新登录后回到“${pages[app.returnTo]?.label ?? '任务'}”。` };
  demo.settings.scenario = 'normal';
  app.route = 'account';
  renderAll();
}

// ---- account route ---------------------------------------------------------------

function accountContext() {
  return {
    api: demo.api, app, toast, run,
    setScene(scene, notice = null) { app.scene = scene; app.notice = notice; renderAll(); focusHeading(); },
    signedIn(target) { const next = target ?? app.returnTo ?? 'tasks'; app.returnTo = null; app.notice = null; app.state = {}; navigate(next); },
    signedOut(notice) { app.scene = 'signin'; app.notice = notice; app.route = 'account'; renderAll(); focusHeading(); },
  };
}

// ---- workspace shell ---------------------------------------------------------------

function renderAll({ focus = false } = {}) {
  closeLayer();
  delete document.body.dataset.panel;
  document.body.dataset.route = app.route === 'account' ? 'account' : 'workspace';
  if (app.route === 'account') {
    shell = null;
    root.replaceChildren(renderAccount(accountContext()));
    updateDemoPill();
    return Promise.resolve();
  }
  shell = buildShell();
  root.replaceChildren(shell.node);
  updateShell();
  updateDemoPill();
  return renderPage({ focus });
}

function buildShell() {
  const nav = h('nav', { class: 'nav', 'aria-label': '主导航' });
  let group = null;
  for (const [route, spec] of Object.entries(pages)) {
    if (!spec.group) continue;
    if (spec.group !== group) { group = spec.group; nav.append(h('p', { class: 'nav-label', text: group })); }
    nav.append(h('a', { class: 'nav-item', href: `#${route}`, dataset: { route }, onClick: event => { event.preventDefault(); navigate(route); } }, icon(spec.icon), h('span', { text: spec.label })));
  }
  const spaceButton = h('button', { type: 'button', class: 'space-switch', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onClick: () => openSpaces(spaceButton) });
  const accountButton = h('button', { type: 'button', class: 'account-chip', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onClick: () => openAccountMenu(accountButton) });
  const sidebar = h('aside', { class: 'sidebar', 'aria-label': '工作台' },
    h('div', { class: 'brand' }, mark(), h('span', { class: 'brand-name', text: 'Runweft' }), h('span', { class: 'brand-tag', text: 'Hub' }),
      button('收起导航', { icon: 'x', iconOnly: true, variant: 'ghost', size: 'sm', className: 'nav-close', onClick: () => setNav(false) })),
    spaceButton, nav,
    h('div', { class: 'sidebar-foot' },
      h('button', { type: 'button', class: 'nav-item', onClick: () => showOnboarding() }, icon('link'), h('span', { text: '接入新环境' })),
      accountButton));
  const crumbs = h('div', { class: 'crumbs' });
  const toolbar = h('header', { class: 'toolbar glass' },
    button('打开导航', { icon: 'menu', iconOnly: true, variant: 'ghost', className: 'nav-open', onClick: () => setNav(true) }),
    crumbs,
    h('div', { class: 'toolbar-actions' }, button('刷新', { icon: 'refresh', iconOnly: true, variant: 'ghost', onClick: () => refresh() })));
  const page = h('main', { class: 'page', id: 'page', tabIndex: -1 });
  const scrim = h('div', { class: 'scrim', 'aria-hidden': 'true', onClick: () => { setNav(false); app.split?.close(); } });
  // The bar stays clear at rest; the scroll edge and deeper shadow appear only when content passes underneath.
  const surface = h('section', { class: 'surface', 'aria-label': '内容', dataset: { scrolled: 'false' } }, h('div', { class: 'scroll-edge', 'aria-hidden': 'true' }), toolbar, page);
  // Desktop scrolls the surface; phones scroll the document.
  const markScrolled = () => { surface.dataset.scrolled = String(surface.scrollTop > 2 || window.scrollY > 2); };
  surface.addEventListener('scroll', markScrolled, { passive: true });
  window.addEventListener('scroll', markScrolled, { passive: true });
  const node = h('div', { class: 'app' }, sidebar, h('div', { class: 'main' }, surface), scrim);
  return { node, nav, spaceButton, accountButton, crumbs, page };
}

function setNav(open) {
  document.body.dataset.nav = open ? 'open' : 'closed';
  if (open) shell.nav.querySelector('[aria-current=page]')?.focus();
  else shell.node.querySelector('.nav-open')?.focus();
}

function updateShell() {
  if (!shell) return;
  const space = demo.space(), user = demo.user, spec = pages[app.route];
  shell.nav.querySelectorAll('.nav-item').forEach(item => { if (item.dataset.route === app.route) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current'); });
  shell.spaceButton.replaceChildren(h('span', { class: 'space-glyph', 'aria-hidden': 'true', text: Array.from(space.name)[0] }),
    h('span', { class: 'space-text' }, h('strong', { text: space.name }), h('small', { text: `${roleLabels[demo.role()]} · 切换空间` })), icon('updown'));
  shell.spaceButton.setAttribute('aria-label', `当前空间：${space.name}，${roleLabels[demo.role()]}。切换空间`);
  shell.accountButton.replaceChildren(avatar(user.name, user.hue), h('span', { class: 'account-text' }, h('strong', { text: user.name }), h('small', { text: user.username })), icon('updown'));
  shell.accountButton.setAttribute('aria-label', `账号：${user.name}。打开账号菜单`);
  shell.crumbs.replaceChildren(h('span', { class: 'crumb-space', text: space.name }), icon('chevron-right', 'icon crumb-sep'), h('span', { class: 'crumb-page', text: spec.label }));
  document.title = `${spec.label} · ${space.name} · Runweft Hub`;
}

async function renderPage({ focus = false, refreshing = false } = {}) {
  const epoch = ++app.epoch;
  const page = shell.page;
  const hadContent = page.dataset.loaded === 'true';
  delete document.body.dataset.panel;
  app.split = null;
  demo.settings.refreshing = refreshing;
  if (!hadContent || !refreshing) page.replaceChildren(h('div', { class: 'loading', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), '正在读取…'));
  let node;
  try {
    node = await pages[app.route].render(context());
  } catch (error) {
    demo.settings.refreshing = false;
    if (epoch !== app.epoch) return;
    if (!(error instanceof HubError)) throw error;
    if (error.kind === 'expired') { expire(); return; }
    if (refreshing && hadContent) { markStale(); return; }
    node = loadFailure(error);
    page.dataset.loaded = 'false';
  }
  demo.settings.refreshing = false;
  if (epoch !== app.epoch) return;
  if (node.dataset?.failed !== 'true') page.dataset.loaded = 'true';
  page.replaceChildren(h('div', { id: 'page-alert', class: 'page-alert' }), node);
  if (app.alert) showAlert(app.alert);
  if (focus) page.querySelector('h1')?.focus();
}

function markStale() {
  const slot = document.getElementById('page-alert');
  slot.replaceChildren(banner('offline', '刷新失败：无法连接 Hub', `下面是 ${clockTime(NOW)} 读取的内容，可能已经变化。你的账号和设置不会改变。`, [button('重试', { icon: 'refresh', size: 'sm', onClick: () => refresh() })]));
}

function loadFailure(error) {
  const node = h('div', { class: 'page-inner', dataset: { failed: 'true' } },
    emptyState({ icon: 'wifi-off', tone: 'offline', title: `无法读取${pages[app.route].label}`, text: `${error.message}。${error.hint}`, actions: [button('重试', { icon: 'refresh', variant: 'primary', onClick: () => renderPage({ focus: true }) })] }));
  return node;
}

// ---- menus -------------------------------------------------------------------------

async function openSpaces(trigger) {
  const spaces = await demo.api.spaces().catch(() => null);
  popover(trigger, close => [
    menuLabel('我的空间'),
    ...(spaces ?? [{ ...demo.space(), role: demo.role() }]).map(space => menuItem(space.name, {
      icon: 'space', description: roleLabels[space.role], checked: space.id === demo.settings.spaceId, close,
      onSelect: () => { if (space.id === demo.settings.spaceId) return; demo.settings.spaceId = space.id; app.alert = null; updateShell(); renderPage(); toast(`已切换到“${space.name}”`); },
    })),
    menuSeparator(),
    menuItem('创建空间…', { icon: 'plus', close, onSelect: createSpace }),
    menuItem('接受邀请…', { icon: 'link', close, onSelect: acceptInvitation }),
  ], { label: '切换空间' });
}

function createSpace() {
  const name = field('空间名称', { required: true, max: 80, placeholder: '例如：设计评审' });
  let handle;
  const formNode = h('form', { class: 'form' }, name.node);
  formNode.addEventListener('submit', async event => {
    event.preventDefault();
    const space = await run(() => demo.api.createSpace(name.input.value.trim()));
    if (!space) return;
    handle.close('done');
    demo.settings.spaceId = space.id; updateShell(); renderPage(); toast(`空间“${space.name}”已创建`);
  });
  handle = openDialog({ title: '创建空间', description: '你会成为这个空间的所有者，之后可以邀请成员。', body: formNode, actions: [button('取消', { onClick: () => handle.close('cancel') }), button('创建空间', { variant: 'primary', onClick: () => submitForm(formNode) })] });
}

function acceptInvitation() {
  const token = field('邀请', { required: true, mono: true, spellcheck: false, placeholder: 'rw_inv_…', hint: '演示中输入 demo。邀请 24 小时内有效，只能由一人使用。' });
  const error = h('div');
  let handle;
  const formNode = h('form', { class: 'form' }, token.node, error);
  formNode.addEventListener('submit', async event => {
    event.preventDefault();
    const space = await run(() => demo.api.acceptInvitation(token.input.value), { onError: e => error.replaceChildren(banner('danger', e.message, e.hint)) });
    if (!space) return;
    handle.close('done');
    demo.settings.spaceId = space.id; updateShell(); renderPage(); toast(`已加入“${space.name}”`);
  });
  handle = openDialog({ title: '接受空间邀请', description: '粘贴成员发给你的邀请。加入后的角色由邀请决定。', body: formNode, actions: [button('取消', { onClick: () => handle.close('cancel') }), button('加入空间', { variant: 'primary', onClick: () => submitForm(formNode) })] });
}

function openAccountMenu(trigger) {
  const user = demo.user;
  popover(trigger, close => [
    h('div', { class: 'menu-profile' }, avatar(user.name, user.hue, 'lg'), h('div', {}, h('strong', { text: user.name }), h('span', { class: 'mono', text: user.username }))),
    menuSeparator(),
    menuItem('账号设置', { icon: 'account', description: '显示名称、登录环境和密码', close, onSelect: () => navigate('settings') }),
    menuItem('退出此浏览器', { icon: 'logout', close, onSelect: async () => {
      if (!await confirmDialog('当前标签页会退出登录。已连接的命令行环境不受影响，已接受的任务会继续执行。', { title: '退出此浏览器？', confirmLabel: '退出' })) return;
      accountContext().signedOut({ tone: 'info', title: '已退出当前浏览器', text: '可以用账号密码重新登录。' });
    } }),
  ], { label: '账号菜单', align: 'start' });
}

// ---- demo controls (review only, not part of the product) ---------------------------

const demoPill = h('button', { type: 'button', class: 'demo-pill glass', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' }, icon('flask'), h('span', { text: '演示' }));
demoPill.addEventListener('click', () => openDemo());
document.body.append(demoPill);

function updateDemoPill() {
  const changed = demo.settings.scenario !== 'normal' || demo.settings.role !== 'owner';
  demoPill.dataset.changed = String(changed && app.route !== 'account');
}

function openDemo() {
  popover(demoPill, close => {
    const group = (title, control) => h('div', { class: 'demo-group' }, h('p', { class: 'demo-title', text: title }), control);
    const parts = [h('div', { class: 'demo-head' }, h('strong', { text: '交互原型' }), h('span', { text: '虚构数据，只保存在内存里；刷新即重置。' }))];
    if (app.route === 'account' || demo.firstRun) parts.push(group('账号场景', segmented('账号场景', accountScenes, app.route === 'account' ? sceneValue() : 'first-run', value => { close(); goScene(value); }, 'segmented stacked')));
    if (app.route !== 'account') {
      parts.push(group('数据场景', segmented('数据场景', scenarios, demo.settings.scenario, value => { close(); setScenario(value); }, 'segmented stacked')));
      parts.push(group('我在“产品协作”的角色', segmented('我在“产品协作”的角色', ['owner', 'admin', 'member'].map(value => ({ value, label: roleLabels[value] })), demo.settings.role, value => { demo.settings.role = value; app.alert = null; updateShell(); renderPage(); updateDemoPill(); })));
    }
    parts.push(group('外观', segmented('外观', [{ value: 'system', label: '跟随系统', icon: 'display' }, { value: 'light', label: '浅色', icon: 'sun' }, { value: 'dark', label: '深色', icon: 'moon' }], app.theme, value => { app.theme = value; document.documentElement.dataset.theme = value; })));
    parts.push(button('重置演示', { icon: 'refresh', variant: 'secondary', className: 'demo-reset', onClick: () => { close(); resetDemo(); } }));
    return parts;
  }, { className: 'demo-panel', role: 'dialog', label: '演示设置', align: 'end' });
}

function sceneValue() {
  return { register: 'register', login: 'login', 'expired-request': 'expired-request', recover: 'recover' }[app.scene] ?? '';
}

async function goScene(value) {
  if (value === 'settings') { await demo.api.login('linzhou'); app.state = {}; navigate('settings'); return; }
  if (value === 'first-run') { await demo.api.register('demo-user'); app.state = {}; navigate('tasks'); return; }
  demo.reset(); app.state = {};
  app.notice = null; app.scene = value; app.route = 'account'; renderAll(); focusHeading();
}

function setScenario(value) {
  demo.settings.scenario = value;
  app.alert = null;
  updateDemoPill();
  if (value === 'expired') { expire(); return; }
  renderPage().then(() => { if (value === 'refresh-error') refresh(); });
}

function resetDemo() {
  demo.reset();
  Object.assign(app, { route: initialRoute, scene: 'register', notice: null, returnTo: null, state: {}, alert: null });
  renderAll();
  toast('演示已重置', 'info');
}

function focusHeading() { requestAnimationFrame(() => document.querySelector('#page h1')?.focus()); }

// ---- global keys ---------------------------------------------------------------------

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && document.body.dataset.nav === 'open') { setNav(false); return; }
  const typing = event.target.closest?.('input, textarea, select, [contenteditable]');
  if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey) {
    const find = document.querySelector('[data-find]');
    if (find) { event.preventDefault(); find.focus(); }
  }
});

// The immutable hosting path is the protocol version; local previews use a local marker.
const version = location.pathname.match(/^\/runweft\/([^/]+)\//)?.[1] || 'local-preview';
renderAll().then(() => {
  connectPreview({ version });
  document.body.dataset.ready = 'true';
}, error => {
  connectPreview({ version, status: 'error', message: error.message });
  throw error;
});
