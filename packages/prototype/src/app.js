import { seed } from './glass-data.js';
import './forms.js';
import { connectPreview } from '../../../.agents/skills/spec-trail/prototype/scripts/bridge.mjs';

const paths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  tasks: '<rect x="5" y="4" width="15" height="17" rx="3"/><path d="M9 4V2m7 2V2M9 9h7m-7 4h7m-7 4h4M3 8h3M3 13h3M3 18h3"/>',
  monitor: '<rect x="3" y="3" width="18" height="13" rx="3"/><path d="M8 21h8m-4-5v5"/>',
  server: '<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01M11 7h6m-6 10h6"/>',
  laptop: '<rect x="5" y="3" width="14" height="13" rx="2"/><path d="m5 16-3 4h20l-3-4"/>',
  code: '<path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16"/>',
  sparkles: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Zm7-1v4m-2-2h4"/>',
  bot: '<rect x="4" y="6" width="16" height="14" rx="4"/><path d="M12 6V3m-3 9h.01M15 12h.01M9 16h6M1 10v6m22-6v6"/>',
  git: '<circle cx="6" cy="4" r="2"/><circle cx="6" cy="20" r="2"/><circle cx="18" cy="6" r="2"/><path d="M6 6v12m12-10a8 8 0 0 1-8 8H6"/>',
  sliders: '<path d="M4 7h6m4 0h6M4 17h10m4 0h2"/><circle cx="12" cy="7" r="2"/><circle cx="16" cy="17" r="2"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/><circle cx="9" cy="7" r="4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>', down: '<path d="m6 9 6 6 6-6"/>',
  arrow: '<path d="M7 17 17 7M7 7h10v10"/>', plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-11 12a2 2 0 0 0 4 0"/>',
  refresh: '<path d="M20 7a8 8 0 1 0 1 8M20 3v5h-5"/>',
  check: '<path d="m5 12 4 4L19 6"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 4h.01"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8m-8 4h5"/>',
  shield: '<path d="M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6Z"/><path d="m8 12 3 3 5-6"/>',
  layout: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M9 9v12"/>',
  filter: '<path d="M4 7h16M7 12h10m-7 5h4"/>', more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  book: '<path d="M12 21c-3-3-7-3-10-2V3c4-1 7 0 10 2 3-2 6-3 10-2v16c-3-1-7-1-10 2Zm0-16v16"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>', globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a18 18 0 0 1 0 18 18 18 0 0 1 0-18"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m-7 5h12"/>'
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.grid}</svg>`;
const e = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const $ = id => document.getElementById(id);
const btn = (label, action, symbol = '', cls = 'button', attrs = '') => `<button type="button" class="${cls}" data-action="${action}" ${attrs}>${symbol ? icon(symbol) : ''}${label}</button>`;
const iconBtn = (label, action, symbol) => btn('', action, symbol, 'icon-button', `aria-label="${label}" title="${label}"`);
const statuses = { attention: ['需要关注', 'alert'], running: ['运行中', 'clock'], completed: ['已完成', 'check'], failed: ['失败', 'alert'], online: ['在线', 'check'], offline: ['离线', 'clock'] };
const badge = status => `<span class="badge ${status}"><span class="status-dot"></span>${statuses[status]?.[0] || e(status)}</span>`;
const views = [ ['tasks','任务','tasks','工作空间'], ['machines','机器','monitor','执行资源'], ['runtimes','Runtime','code','执行资源'], ['agents','Agent','bot','执行资源'], ['repositories','仓库','git','执行资源'], ['selections','我的选择','sliders','空间设置'], ['members','成员','users','空间设置'], ['identity','身份与空间','user','空间设置'] ];
let data = seed();
const state = { view: views.some(v => v[0] === location.hash.slice(1)) ? location.hash.slice(1) : document.body.dataset.entry || 'tasks', space: 0, scenario: 'normal', query: '', status: 'all', sort: 'recent', detail: null, tab: 'overview', round: 1, page: 1 };
let toastTimer;
function toast(message) { $('toast').textContent = message; $('toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3500); }
const logo = `<span class="logo-mark"><svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="m8 7 7 6-7 6m9-12 7 6-7 6M8 14l7 6-7 6m9-12 7 6-7 6" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
function visible(key) { return state.scenario === 'empty' || state.space > 0 && !['machines','runtimes'].includes(key) ? [] : data[key]; }
function nav() {
  let group = '';
  return views.map(([id,label,symbol,section]) => { const heading = group !== section ? `<p class="nav-label">${section}</p>` : ''; group = section; return `${heading}<button type="button" class="nav-item ${state.view === id ? 'active' : ''}" data-view="${id}" ${state.view === id ? 'aria-current="page"' : ''}>${icon(symbol)}<span>${label}</span>${id === 'tasks' ? `<span class="nav-count">${visible('tasks').length}</span>` : ''}</button>`; }).join('');
}
function shell() {
  const current = views.find(v => v[0] === state.view) || views[0];
  $('app').innerHTML = `<div class="mobile-shade" data-action="menu-close"></div><aside class="sidebar glass" aria-label="主导航"><a class="brand" href="#tasks">${logo}<span>Runweft<span class="brand-label">协作工作台</span></span></a><button type="button" class="workspace-switch" data-action="space"><span class="workspace-icon">${icon('grid')}</span><span><strong>${e(data.spaces[state.space])}</strong><small>团队空间 · ${data.members.length} 位成员</small></span>${icon('down')}</button><nav id="console-navigation">${nav()}</nav><div class="sidebar-bottom"><button type="button" class="help-link" data-action="guide">${icon('book')}<span>使用指南</span>${icon('arrow')}</button><button type="button" class="account" data-view="identity"><span class="avatar blue">${e(data.user.name.slice(0,1))}</span><span><strong>${e(data.user.name)}</strong><small>个人账户</small></span>${icon('sliders')}</button></div></aside><div class="app-body"><header class="topbar"><div class="breadcrumb">${iconBtn('打开导航','menu','menu')}<span>${e(data.spaces[state.space])}</span>${icon('chevron')}<strong>${current[1]}</strong></div><div class="topbar-actions">${btn('<span>搜索工作空间</span><kbd>⌘ K</kbd>','search','search','global-search')}<span class="topbar-divider"></span>${iconBtn('通知','notifications','bell')}<button type="button" class="avatar blue avatar-small" data-view="identity" aria-label="个人账户">${e(data.user.name.slice(0,1))}</button></div></header><main id="main" tabindex="-1"><div id="page-content" class="space-content"></div><footer class="page-footer"><span><i></i> 所有更改仅保留在本次演示</span><button type="button" data-action="demo">交互原型 ${icon('sliders')}</button></footer></main></div>`;
  renderPage();
}
function title(name, description, action = '') {
  return `<div class="page-heading"><div><h1>${name}</h1><p>${description}</p></div><div class="heading-actions">${iconBtn('刷新当前页面','refresh','refresh')}${action}</div></div>`;
}
function empty(titleText = '这里还没有内容', description = '准备好后，从一个新的协作开始。', action = '') {
  return `<div class="empty-state"> <div class="empty-orbit"><span></span><span></span><div>${icon(state.view === 'tasks' ? 'tasks' : 'grid')}</div></div><h3>${titleText}</h3><p>${description}</p>${action}</div>`;
}
function stats() {
  const tasks = visible('tasks');
  return `<div class="stats">${[['all','全部任务','tasks'],['running','运行中','clock'],['attention','需要关注','alert'],['completed','已完成','check']].map(([status,label,symbol])=>`<button type="button" class="stat ${state.status === status ? 'selected' : ''}" data-status="${status}"><span class="stat-label">${icon(symbol)}${label}</span><span class="stat-value">${status === 'all' ? tasks.length : tasks.filter(t=>t.status===status).length}<span class="stat-note">${status === 'attention' ? '等待你的处理' : status === 'running' ? 'Agent 正在工作' : status === 'completed' ? '协作已有结果' : '当前空间 · 仅你的执行'}</span></span></button>`).join('')}</div>`;
}
function taskRows() {
  let tasks = visible('tasks').filter(t => (state.status === 'all' || t.status === state.status) && `${t.title} ${t.agent} ${t.project}`.toLowerCase().includes(state.query.toLowerCase()));
  if (state.sort === 'title') tasks = [...tasks].sort((a,b)=>a.title.localeCompare(b.title,'zh-CN'));
  if (!tasks.length) return empty(state.query || state.status !== 'all' ? '没有找到匹配的任务' : '从第一次协作开始', state.query || state.status !== 'all' ? '换个关键词，或清除筛选条件再试试。' : '将工作交给合适的 Agent，进展与结果会汇集在这里。', btn(state.query || state.status !== 'all' ? '清除筛选' : '查看委派指南', state.query || state.status !== 'all' ? 'clear-filters' : 'guide', 'arrow'));
  return `<div class="table-scroll"><table class="task-table"><thead><tr><th>任务</th><th>状态</th><th>Agent / Runtime</th><th class="time-column">最近更新 ${icon('down')}</th><th><span class="sr-only">操作</span></th></tr></thead><tbody>${tasks.map(t=>`<tr data-task-row="${t.id}"><td><button type="button" class="task-title" data-task="${t.id}"><span class="task-icon ${t.status}">${icon(t.status === 'completed' ? 'check' : t.status === 'attention' ? 'alert' : 'code')}</span><span><strong>${e(t.title)}</strong><small>${e(t.project)}<span>·</span>第 ${t.rounds} 轮</small></span></button></td><td>${badge(t.status)}</td><td><div class="agent-cell"><span class="agent-mini">${icon(t.runtime === 'Codex' ? 'code' : 'sparkles')}</span><span>${e(t.agent)}<small>${e(t.runtime)}</small></span></div></td><td class="time-column muted">${e(t.time)}</td><td>${btn('','task:'+t.id,'chevron','row-open',`aria-label="查看任务详情：${e(t.title)}"`)}</td></tr>`).join('')}</tbody></table></div><div class="table-footer"><span>共 ${tasks.length} 个任务</span><span class="pagination"><button type="button" disabled aria-label="上一页">${icon('chevron','flip')}</button><span>1</span><button type="button" disabled aria-label="下一页">${icon('chevron')}</button></span></div>`;
}
function tasksPage() {
  return title('任务', '每一次协作，都有清晰的进展。', btn('委派指南','guide','plus','button primary')) + stats() + `<section class="panel task-list" aria-label="任务列表"><div class="panel-heading"><div><h2>最近任务</h2></div><div class="live-label"><i></i>${state.scenario === 'offline' ? '状态可能未更新' : '最近观察已更新'}</div></div><div class="task-toolbar"><div class="segmented glass"><button type="button" data-status="all" class="${state.status === 'all' ? 'active' : ''}">全部</button><button type="button" data-status="running" class="${state.status === 'running' ? 'active' : ''}">运行中</button><button type="button" data-status="attention" class="${state.status === 'attention' ? 'active' : ''}">需要关注 <span>${visible('tasks').filter(t=>t.status==='attention').length}</span></button><button type="button" data-status="completed" class="${state.status === 'completed' ? 'active' : ''}">已完成</button></div><div class="table-tools"><label class="search-input">${icon('search')}<input id="task-search" aria-label="搜索任务" placeholder="搜索任务…" value="${e(state.query)}"></label><label class="sort-select">${icon('filter')}<select id="task-sort" aria-label="排序"><option value="recent" ${state.sort==='recent'?'selected':''}>最近更新</option><option value="title" ${state.sort==='title'?'selected':''}>任务名称</option></select></label></div></div><div id="task-rows">${taskRows()}</div></section><div class="quiet-tip">${icon('lock')}任务仅对你可见。共享 Agent 不会共享执行内容。</div>`;
}
const pageMeta = {
  machines: ['机器', '让每个执行环境，都在掌握之中。', '接入机器'],
  runtimes: ['Runtime', '连接 Codex 与 Claude Code，随时准备协作。', '登记 Runtime'],
  agents: ['Agent', '让擅长不同工作的助手，各展所长。', '新建 Agent'],
  repositories: ['仓库', '把代码、工作环境与协作连接起来。', '登记仓库']
};
function cardsPage(kind) {
  const [name,desc,cta] = pageMeta[kind]; const items = visible(kind);
  const summary = kind === 'machines' ? `${items.filter(i=>i.status==='online' && state.scenario!=='offline').length} 台在线` : kind==='agents' ? `${items.filter(i=>i.shared).length} 个与空间共享` : kind==='runtimes' ? 'Codex · Claude Code' : `${items.reduce((n,i)=>n+i.checkouts,0)} 个工作副本`;
  return title(name,desc,btn(cta,'new:'+kind,'plus','button primary')) + `<div class="section-bar"><h2>全部${name} <span class="subtle-count">${items.length}</span></h2><span class="muted">${summary}</span></div>` + (!items.length ? `<section class="panel">${empty(`还没有${name}`, '添加第一个资源，为接下来的协作做好准备。',btn(cta,'new:'+kind,'plus','button primary'))}</section>` : `<div class="resource-grid ${kind}">${items.map((item,index)=>{
    const status = state.scenario==='offline' && ['machines','runtimes'].includes(kind) ? 'offline' : item.status;
    return `<article class="resource-card"><div class="resource-top"><span class="resource-icon shade-${index%3}">${icon(item.icon)}</span>${kind==='agents'? `<span class="tag">${item.shared?icon('users')+'空间共享':icon('lock')+'仅自己'}</span>` : kind==='repositories'?`<span class="tag">${icon('git')}${item.branch}</span>`:badge(status)}</div><h3>${e(item.name)}</h3><p class="resource-description">${e(item.description)}</p>${kind==='agents'?`<div class="agent-config"><span>${icon('code')}${e(item.runtime)}</span><span>${item.version}</span></div><div class="resource-tags"><span>${item.tag}</span><span>按需调用</span></div>`:kind==='repositories'?`<code class="repo-url">${e(item.url)}</code><div class="resource-tags"><span>${icon('git')}${item.checkouts} 个工作副本</span></div>`:`<dl class="mini-facts"><div><dt>${kind==='machines'?'环境':'所在机器'}</dt><dd>${e(item.type||item.machine)}</dd></div><div><dt>${kind==='machines'?'执行工具':'工具版本'}</dt><dd>${e(item.runtime||item.version)}</dd></div></dl>`}<div class="resource-bottom"><span class="owner"><span class="mini-avatar ${index===1?'purple':'blue'}">${e(item.owner.slice(0,1))}</span>${e(item.owner)}</span>${btn('管理','edit:'+kind+':'+item.id,'chevron','text-button')}</div></article>`;
  }).join('')}</div>`) + (kind==='machines'?`<div class="inline-callout">${icon('monitor')}<div><strong>从你的工作环境开始</strong><p>通过 Runweft CLI 连接机器，工具与环境继续由你掌控。</p></div>${btn('查看接入步骤','connect','arrow','text-button')}</div>`:'');
}
function selectionsPage() {
  const options = (rows,selected) => rows.map(x=>`<option ${x===selected?'selected':''}>${e(x)}</option>`).join('');
  return title('我的选择','为常用工作，选好合适的搭档。') + `<div class="settings-layout"><section class="panel settings-panel"><div class="panel-heading"><div><h2>默认协作配置</h2><p>仅影响你在当前空间中的默认选择</p></div><span class="small-icon">${icon('sliders')}</span></div><form id="selection-form" class="settings-form"><label>默认 Agent<select name="agent">${options(data.agents.map(a=>a.name),data.selection.agent)}</select><small>未指定 Agent 时优先使用此选择。</small></label><label>默认 Runtime<select name="runtime">${options(['跟随 Agent 配置',...data.runtimes.filter(r=>r.status==='online').map(r=>r.name)],data.selection.runtime)}</select><small>跟随配置时，使用 Agent 定义的执行环境。</small></label><div class="form-footer">${btn('预览最终配置','resolve','sparkles','button')}<button class="button primary" type="submit">保存选择</button></div></form></section><aside class="settings-note"><span class="note-icon">${icon('sparkles')}</span><h3>恰好的默认值</h3><p>日常工作少做一步选择，特殊任务仍可单独指定。</p><div class="priority"><span>显式参数</span>${icon('down')}<span class="chosen">我的选择</span>${icon('down')}<span>Agent 定义</span></div></aside></div><section class="panel repository-overrides"><h2>按仓库选择</h2><p class="muted">有特别的工作方式？为仓库单独指定 Agent。</p>${data.repositories.map(r=>`<div class="override-row"><span class="small-icon">${icon('git')}</span><span><strong>${r.name}</strong><small>${e(r.agent || '使用空间默认配置')}</small></span>${btn('设置','override:'+r.id,'chevron','text-button')}</div>`).join('')}</section>`;
}
function membersPage() {
  const rows = visible('members');
  return title('成员','好的协作，从合适的人开始。',btn('邀请成员','invite','plus','button primary')) + `<section class="panel"><div class="panel-heading"><div><h2>空间成员 <span class="subtle-count">${rows.length}</span></h2><p>共同使用资源，独立管理各自的任务</p></div><div class="avatar-stack">${rows.map(m=>`<span class="avatar ${m.color}">${e(m.initial)}</span>`).join('')}</div></div>${!rows.length?empty('还没有其他成员','邀请同伴，一起开展协作。',btn('邀请成员','invite','plus','button primary')):`<div class="table-scroll"><table class="member-table"><thead><tr><th>成员</th><th>角色</th><th>加入时间</th><th><span class="sr-only">操作</span></th></tr></thead><tbody>${rows.map(m=>`<tr><td><div class="member-name"><span class="avatar ${m.color}">${e(m.initial)}</span><span><strong>${e(m.name)} ${m.id==='u1'?'<span class="you-label">你</span>':''}</strong><small>${m.email}</small></span></div></td><td><span class="tag">${m.role}</span></td><td class="muted">${m.id==='u1'?'2026/10/12':'2026/10/15'}</td><td>${m.id==='u1'?'<span class="muted">—</span>':btn('管理','member:'+m.id,'more','text-button')}</td></tr>`).join('')}</tbody></table></div>`}</section><section class="panel invite-list"><div class="panel-heading"><div><h2>待接受的邀请 <span class="subtle-count">${data.invitations.length}</span></h2></div></div>${data.invitations.length?data.invitations.map((i,n)=>`<div class="override-row">${icon('users')}<span><strong>${e(i.name)}</strong><small>${i.role} · 24 小时内有效</small></span>${btn('撤销','revoke:'+n,'close','text-button')}</div>`).join(''):'<div class="compact-empty">没有待接受的邀请</div>'}</section>`;
}
function identityPage() {
  return title('身份与空间','你的身份，你的协作方式。') + `<div class="profile-grid"><section class="panel profile-card"><span class="avatar blue profile-avatar">${e(data.user.name.slice(0,1))}</span><h2 id="identity-name">${e(data.user.name)}</h2><p class="muted">${data.user.role}</p><span class="tag">${icon('shield')}身份已连接</span><div class="profile-actions">${btn('修改名称','rename','user')}${btn('备份身份','backup','lock')}</div><p class="profile-hint">身份是你回到空间的钥匙。<br>请保留一份安全的备份。</p></section><div class="profile-settings"><section class="panel"><div class="panel-heading"><div><h2>我的空间</h2><p>在不同上下文间，轻松切换</p></div>${btn('创建空间','new-space','plus','text-button')}</div>${data.spaces.map((name,i)=>`<button type="button" class="space-row" data-space="${i}"><span class="workspace-icon">${icon('grid')}</span><span><strong>${e(name)}</strong><small>${i===0?'与团队共同协作':'留一点空间给自己的想法'}</small></span>${i===state.space?'<span class="current-space">当前空间 '+icon('check')+'</span>':icon('chevron')}</button>`).join('')}</section><section class="panel security-panel"><h2>身份与安全</h2><div class="security-row"><div><strong>更换身份 token</strong><p>更新后，其他设备需要重新连接。</p></div>${btn('更换','rotate','refresh')}</div><div class="security-row"><div><strong>使用其他身份</strong><p>通过演示 token 体验身份切换。</p></div>${btn('添加身份','add-identity','plus')}</div></section></div></div>`;
}
function renderPage() {
  document.querySelector('.nav-count').textContent=visible('tasks').length;
  if(state.scenario==='error') $('page-content').innerHTML=title(views.find(v=>v[0]===state.view)[1],'')+`<section class="panel">${empty('暂时无法加载','连接有些不稳定，你的配置和任务不会因此改变。',btn('重试加载','recover','refresh','button primary'))}</section>`;
  else $('page-content').innerHTML=(state.scenario==='offline'?`<div class="offline-banner">${icon('alert')}部分机器离线，执行状态可能不是最新。${btn('查看机器','goto-machines','','text-button')}</div>`:'')+(state.view==='tasks'?tasksPage():pageMeta[state.view]?cardsPage(state.view):state.view==='selections'?selectionsPage():state.view==='members'?membersPage():identityPage());
}
function navigate(view) { if (!views.some(v=>v[0]===view)) return; state.view=view; state.query=''; state.status='all'; location.hash=view; document.body.classList.remove('nav-open'); shell(); }
function modal(titleText,body,footer='',wide=false) {
  const el=$('modal'); el.className=wide?'modal wide':'modal';
  el.innerHTML=`<div class="modal-heading"><h2 id="modal-title">${titleText}</h2>${iconBtn('关闭弹窗','modal-close','close')}</div><div class="modal-body">${body}</div>${footer?`<div class="modal-footer">${footer}</div>`:''}`;
  if(!el.open) el.showModal();
}
function guide() { modal('让 Agent 接手下一步',`<div class="guide-intro"><span class="resource-icon">${icon('sparkles')}</span><p>在 Codex 或 Claude Code 中描述你的目标，<br>由主 Agent 选择合适的协作助手。</p></div><div class="instruction"><span class="eyebrow">示例指令</span><p>请在「${e(data.spaces[state.space])}」空间使用代码审阅助手，检查当前仓库的变更，给出风险与验证建议。</p></div><div class="guide-steps"><p>${icon('check')}主 Agent 确认上下文与执行目标</p><p>${icon('check')}Runweft 负责委派与状态跟踪</p><p>${icon('check')}回到任务页查看进展和结果</p></div><p class="form-hint">此原型仅演示交互，不会启动真实执行。</p>`,btn('知道了','modal-close','','button primary')); }
function openTask(id,tab='overview') {
  const t=data.tasks.find(t=>t.id===id); if(!t) return;
  state.detail=id; state.tab=tab; if(!state.round || state.round>t.rounds)state.round=t.rounds;
  const detail=$('detail');
  const wasOpen=detail.open, roundFocused=document.activeElement?.id==='detail-round';
  detail.innerHTML=`<div class="drawer-top"><span>${icon('tasks')}任务详情</span>${iconBtn('关闭任务详情','detail-close','close')}</div><div class="drawer-head">${badge(t.status)}<h2 id="detail-title">${e(t.title)}</h2><p>${e(t.summary)}</p><div class="detail-meta"><span>${icon('bot')}${e(t.agent)}</span><span>${icon('clock')}${e(t.time)}</span></div></div><div class="detail-tabs" role="tablist" aria-label="任务详情内容">${[['overview','概览'],['activity','执行记录'],['files','附件']].map(([id,label])=>`<button type="button" role="tab" data-detail-tab="${id}" aria-selected="${tab===id}" tabindex="${tab===id?0:-1}" class="${tab===id?'active':''}">${label}${id==='files'?'<span>1</span>':''}</button>`).join('')}</div><div class="drawer-content" role="tabpanel">${tab==='overview'?`${t.status==='attention'?`<div class="attention-box">${icon('alert')}<div><strong>需要你的确认</strong><p>Agent 正等待文件访问审批。打开原生会话，确认后继续。</p>${btn('前往处理','native','arrow','text-button')}</div></div>`:t.status==='failed'?`<div class="attention-box">${icon('alert')}<div><strong>等待定向恢复</strong><p>检查依赖下载失败原因后，让主 Agent 续接当前任务。</p></div></div>`:''}<div class="section-title"><h3>本轮报告</h3><label class="round-select">第 <select id="detail-round" aria-label="查看轮次">${Array.from({length:t.rounds},(_,i)=>`<option value="${i+1}" ${state.round===i+1?'selected':''}>${i+1}</option>`).join('')}</select> 轮</label></div><article class="report"><span class="report-label">${t.runtime} · 第 ${state.round} 轮</span><h3>${t.status==='completed'?'检查已完成，结果如下':t.status==='attention'?'已完成初步检查':'当前进展'}</h3><p>${e(t.summary)}。</p><ul><li>核对主要操作路径与页面状态反馈。</li><li>检查键盘访问、移动端布局及异常恢复。</li><li>${state.round===1?'已形成初步建议，等待下一轮进一步验证。':'已保留上下文与检查记录，方便继续处理。'}</li></ul><p class="report-footnote">示例报告 · 用于展示阅读与操作体验</p></article><details class="advanced-details"><summary>运行环境与配置 ${icon('down')}</summary><dl class="mini-facts"><div><dt>Runtime</dt><dd>${t.runtime}</dd></div><div><dt>机器</dt><dd>Studio 工作站</dd></div><div><dt>工作区</dt><dd>独立 worktree</dd></div><div><dt>任务 ID</dt><dd>${t.id}</dd></div></dl></details>`:tab==='activity'?`<h3>第 ${t.rounds} 轮执行</h3><div class="timeline">${[['上下文已准备','工作环境与 Agent 配置已核对','10:24'],['Agent 开始执行','通过 '+t.runtime+' 运行任务','10:25'],[statuses[t.status][0],t.summary,'10:28']].map(([name,desc,time])=>`<div><span class="timeline-dot"></span><time>${time}</time><h4>${name}</h4><p>${e(desc)}</p></div>`).join('')}</div>`:`<div class="file-card"><span class="resource-icon">${icon('file')}</span><span><strong>review.md</strong><small>审阅报告 · Markdown · 2.4 KB</small></span>${btn('预览','file','arrow','text-button')}</div><p class="form-hint">附件为演示内容，刷新后恢复。</p>`}</div><div class="drawer-footer">${btn('关闭','detail-close','','button')}${btn('打开原生会话','native','arrow','button primary')}</div>`;
  if(!wasOpen)detail.showModal();
  else if(roundFocused) $('detail-round')?.focus();
  else detail.querySelector('[role=tab][aria-selected=true]')?.focus();
}
function edit(kind,id) {
  const item=data[kind].find(x=>x.id===id), isNew=!item;
  const titles={machines:'机器',runtimes:'Runtime',agents:'Agent',repositories:'仓库'};
  modal(`${isNew?'添加':'管理'}${titles[kind]}`,`<form id="resource-form" data-kind="${kind}" data-id="${id||''}" class="modal-form"><label>名称<input name="name" value="${e(item?.name||'')}" placeholder="为${titles[kind]}起个容易识别的名字" required maxlength="60"></label><label>说明<textarea name="description" rows="3" placeholder="简要描述用途">${e(item?.description||'')}</textarea></label>${kind==='agents'?`<label>执行环境<select name="runtime">${data.runtimes.filter(r=>r.status==='online').map(r=>`<option ${r.name===item?.runtime?'selected':''}>${e(r.name)}</option>`).join('')}</select></label><label class="checkbox-label"><input type="checkbox" name="shared" ${item?.shared?'checked':''}>与当前空间共享</label>`:''}${kind==='machines'?'<p class="form-hint">此处演示机器信息管理。真实接入通过 CLI 完成。</p>':''}${kind==='repositories'?`<label>仓库地址<input name="url" value="${e(item?.url||'')}" placeholder="example.com/team/repository"></label>`:''}<div class="form-footer">${btn('取消','modal-close')}<button type="submit" class="button primary">${isNew?'添加':'保存更改'}</button></div></form>`);
}
function formDialog(titleText,id,fields,submit='保存') { modal(titleText,`<form id="${id}" class="modal-form">${fields}<div class="form-footer">${btn('取消','modal-close')}<button type="submit" class="button primary">${submit}</button></div></form>`); }
function searchDialog() {
  modal('搜索工作空间',`<label class="search-input large">${icon('search')}<input id="global-query" aria-label="搜索工作空间内容" placeholder="搜索任务、Agent、机器…"></label><div id="global-results" class="global-results"><p class="muted">输入关键词，快速找到你需要的内容。</p></div>`, '',true);
  $('global-query').focus({ preventScroll: true });
}
function searchGlobal(query) {
  const result=[...visible('tasks').map(t=>({label:t.title,sub:'任务',action:'task:'+t.id,icon:'tasks'})),...['agents','machines','repositories'].flatMap(k=>visible(k).map(i=>({label:i.name,sub:pageMeta[k][0],action:'edit:'+k+':'+i.id,icon:i.icon})))].filter(i=>query&&i.label.toLowerCase().includes(query.toLowerCase()));
  $('global-results').innerHTML=result.length?result.map(r=>btn(`<span><strong>${e(r.label)}</strong><small>${r.sub}</small></span>${icon('arrow')}`,r.action,r.icon,'search-result')).join(''):`<div class="compact-empty">${query?'没有找到匹配内容':'输入关键词，快速找到你需要的内容。'}</div>`;
}
function runAction(action) {
  if(action.startsWith('task:')) { $('modal').close();state.round=data.tasks.find(t=>t.id===action.slice(5)).rounds;return openTask(action.slice(5)); }
  if(action.startsWith('new:'))return edit(action.slice(4));
  if(action.startsWith('edit:')) { const [,kind,id]=action.split(':');return edit(kind,id); }
  if(action.startsWith('member:')) { const m=data.members.find(m=>m.id===action.slice(7));return formDialog('管理成员','member-form',`<input type="hidden" name="id" value="${m.id}"><p class="muted">${e(m.name)} · ${m.email}</p><label>空间角色<select name="role"><option ${m.role==='管理员'?'selected':''}>管理员</option><option ${m.role==='成员'?'selected':''}>成员</option></select></label>`); }
  if(action.startsWith('override:'))return formDialog('为仓库选择 Agent','override-form',`<input type="hidden" name="id" value="${action.slice(9)}"><label>默认 Agent<select name="agent">${['使用空间默认配置',...data.agents.map(a=>a.name)].map(a=>`<option>${e(a)}</option>`).join('')}</select></label>`);
  if(action.startsWith('revoke:')) {data.invitations.splice(Number(action.slice(7)),1);renderPage();return toast('邀请已撤销');}
  const actions={
    'modal-close':()=>$('modal').close(), 'detail-close':()=>$('detail').close(),
    menu:()=>document.body.classList.toggle('nav-open'), 'menu-close':()=>document.body.classList.remove('nav-open'),
    guide, search:searchDialog, refresh:()=>{renderPage();toast('已更新当前观察');},
    'goto-machines':()=>navigate('machines'), recover:()=>{state.scenario='normal';renderPage();toast('连接已恢复');},
    'clear-filters':()=>{state.query='';state.status='all';renderPage();},
    notifications:()=>modal('需要你关注',`<button type="button" class="notification-item" data-action="task:t1"><span class="task-icon attention">${icon('alert')}</span><span><strong>有一项任务等待确认</strong><small>审阅身份切换与权限边界</small></span>${icon('chevron')}</button><div class="notification-item"><span class="task-icon completed">${icon('check')}</span><span><strong>协作结果已准备好</strong><small>4 项任务已完成，可查看交付报告</small></span></div>`),
    space:()=>modal('切换空间',data.spaces.map((name,i)=>`<button type="button" class="space-row" data-space="${i}"><span class="workspace-icon">${icon('grid')}</span><span><strong>${e(name)}</strong><small>${i===0?'团队协作空间':'个人探索空间'}</small></span>${i===state.space?icon('check'):icon('chevron')}</button>`).join(''),btn('创建空间','new-space','plus','button primary')),
    'new-space':()=>formDialog('创建空间','space-form','<label>空间名称<input name="name" required maxlength="40" placeholder="例如：新项目协作"></label>','创建空间'),
    rename:()=>formDialog('修改显示名称','rename-form',`<label>显示名称<input name="name" value="${e(data.user.name)}" required maxlength="30"></label>`),
    backup:()=>modal('备份演示身份','<p class="muted">这是演示身份，请勿输入真实凭据。</p><pre class="token-value">demo</pre><p class="form-hint">真实产品可复制或下载身份备份；受限原型仅展示示例。</p>',btn('已了解','modal-close','','button primary')),
    rotate:()=>modal('更换身份 token？','<p class="muted">更换后，其他设备需要使用新 token 重新连接。当前原型仅展示确认流程。</p>',btn('取消','modal-close')+btn('确认更换','rotate-confirm','refresh','button primary')),
    'rotate-confirm':()=>{$('modal').close();toast('演示身份已更新，所有更改仅在内存中生效');},
    'add-identity':()=>formDialog('添加演示身份','identity-form','<label>显示名称<input name="name" placeholder="你希望如何被称呼" required maxlength="30"></label><label>身份 token<input name="token" type="password" placeholder="输入 demo" pattern="demo" title="演示 token 为 demo" required></label>','切换身份'),
    invite:()=>formDialog('邀请成员','invite-form','<p class="muted">邀请对方加入当前空间，一起使用共享资源。</p><label>邀请备注<input name="name" placeholder="例如：设计团队的同伴" required maxlength="40"></label><label>加入后的角色<select name="role"><option>成员</option><option>管理员</option></select></label>','生成邀请'),
    connect:()=>modal('连接你的工作环境',`<p class="muted">在目标机器运行 CLI，按提示核对身份与空间。</p><div class="instruction"><code>runweft --help</code></div><p class="form-hint">当前界面是内存演示，请在真实产品中获取实际接入步骤。</p>`,btn('知道了','modal-close','','button primary')),
    native:()=>modal('原生会话 · 演示',`<div class="native-preview"><div><i></i> Studio Codex <span>等待审批</span></div><p>Agent 请求读取项目中的配置文件，以完成权限边界检查。</p><div class="instruction"><code>Read · config/permissions.json</code></div><p class="form-hint">实际审批由 HAPI 原生会话处理，此处不改变真实权限。</p></div>`,btn('返回任务','modal-close')+btn('体验确认流程','approve-demo','check','button primary')),
    'approve-demo':()=>{$('modal').close();toast('审批流程演示完成；未启动任何真实执行');},
    file:()=>modal('review.md',`<article class="report"><h3>页面交互审阅</h3><p>主要操作路径已检查，建议优先完善以下细节：</p><ul><li>保持任务状态与下一步操作清晰。</li><li>为错误与空态提供恢复入口。</li><li>确保移动端与键盘操作可达。</li></ul></article>`,btn('关闭','modal-close','','button primary')),
    resolve:()=>modal('最终协作配置',`<div class="resolution"><span class="resource-icon">${icon('sparkles')}</span><h3>${e(data.selection.agent)}</h3><p>${e(data.selection.runtime==='跟随 Agent 配置'?data.agents.find(a=>a.name===data.selection.agent)?.runtime:data.selection.runtime)}</p><span class="tag">${icon('monitor')}Studio 工作站</span></div><p class="form-hint">配置预览来自内存示例，不会发起任务。</p>`,btn('完成','modal-close','','button primary')),
    demo:()=>modal('原型演示',`<p class="muted">全部内容为虚构数据，刷新即恢复。</p><label>演示场景<select id="demo-scenario" aria-label="演示场景">${[['normal','正常'],['empty','空数据'],['offline','机器离线'],['error','加载失败']].map(([id,label])=>`<option value="${id}" ${state.scenario===id?'selected':''}>${label}</option>`).join('')}</select></label>`,btn('重置演示','reset','refresh')+btn('完成','modal-close','','button primary')),
    reset:()=>{data=seed();state.space=0;state.scenario='normal';state.query='';state.status='all';$('modal').close();$('detail').close();shell();toast('演示已重置');}
  };
  actions[action]?.();
}

document.addEventListener('click',event=>{
  const target=event.target.closest('button,[data-action]'); if(!target)return;
  if(target.dataset.view)return navigate(target.dataset.view);
  if(target.dataset.space!==undefined) {state.space=Number(target.dataset.space);$('modal').close();shell();toast(`已切换到${data.spaces[state.space]}`);return;}
  if(target.dataset.status) {state.status=target.dataset.status;renderPage();return;}
  if(target.dataset.task) {state.round=data.tasks.find(t=>t.id===target.dataset.task).rounds;openTask(target.dataset.task);return;}
  if(target.dataset.detailTab){openTask(state.detail,target.dataset.detailTab);return;}
  if(target.dataset.action)runAction(target.dataset.action);
});
document.addEventListener('input',event=>{
  if(event.target.id==='task-search'){state.query=event.target.value;$('task-rows').innerHTML=taskRows();}
  if(event.target.id==='global-query')searchGlobal(event.target.value);
});
document.addEventListener('change',event=>{
  if(event.target.id==='task-sort'){state.sort=event.target.value;$('task-rows').innerHTML=taskRows();}
  if(event.target.id==='detail-round'){state.round=Number(event.target.value);openTask(state.detail);}
  if(event.target.id==='demo-scenario'){state.scenario=event.target.value;renderPage();}
});
document.addEventListener('submit',event=>{
  event.preventDefault(); const form=event.target;if(!form.reportValidity())return;
  const values=Object.fromEntries(new FormData(form));
  if(form.id==='resource-form'){
    const kind=form.dataset.kind, item=data[kind].find(x=>x.id===form.dataset.id);
    if(item)Object.assign(item,values,...(kind==='agents'?[{shared:values.shared==='on'}]:[]));
    else {const template=seed()[kind][0];data[kind].push({...template,...values,id:'new-'+Date.now(),shared:values.shared==='on',owner:data.user.name});}
    $('modal').close();renderPage();toast(item?'更改已保存':'已添加到当前演示');
  } else if(form.id==='selection-form'){data.selection=values;toast('默认选择已保存');}
  else if(form.id==='rename-form'||form.id==='identity-form'){data.user.name=values.name;data.members[0].name=values.name;data.members[0].initial=values.name.slice(0,1);$('modal').close();shell();toast('身份信息已更新');}
  else if(form.id==='space-form'){data.spaces.push(values.name);state.space=data.spaces.length-1;$('modal').close();shell();toast('空间已创建');}
  else if(form.id==='invite-form'){data.invitations.push(values);$('modal').close();renderPage();modal('邀请已生成',`<p class="muted">${e(values.name)} · ${e(values.role)} · 24 小时内有效</p><pre class="token-value">demo</pre><p class="form-hint">演示邀请仅存在于内存，真实协作请通过产品创建邀请。</p>`,btn('完成','modal-close','','button primary'));}
  else if(form.id==='member-form'){data.members.find(m=>m.id===values.id).role=values.role;$('modal').close();renderPage();toast('成员角色已更新');}
  else if(form.id==='override-form'){data.repositories.find(r=>r.id===values.id).agent=values.agent;$('modal').close();renderPage();toast('仓库选择已保存');}
});
document.addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();searchDialog();}if(event.key==='Escape')document.body.classList.remove('nav-open');if(event.target.matches('[role=tab]')&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const tabs=['overview','activity','files'];const i=tabs.indexOf(state.tab);const next=event.key==='Home'?0:event.key==='End'?2:(i+(event.key==='ArrowRight'?1:2))%3;openTask(state.detail,tabs[next]);}});
for(const dialog of [$('modal'),$('detail')])dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
window.addEventListener('hashchange',()=>{const view=location.hash.slice(1);if(view!==state.view&&views.some(v=>v[0]===view))navigate(view);});
const version=location.pathname.match(/^\/runweft\/([^/]+)\//)?.[1]||'local-preview';
try{shell();document.body.dataset.ready='true';connectPreview({version});}catch(error){document.body.dataset.ready='error';connectPreview({version,status:'error',message:error.message});throw error;}
