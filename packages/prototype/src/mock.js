// Fictional data only. Space configuration is local; machines/runtimes are global. Reload/reset discards all state.
const stamp = '2026-10-12T08:30:00.000Z';
const clone = value => structuredClone(value);
const permissions = { manage: true, associate: true, govern: true, use: true, share: true };
const aliases = values => values.map(value => ({ displayUrl: value, canonicalKey: value }));
function seed() {
  const definition = { name: '代码审阅助手', description: '检查变更并给出可操作的建议', instructions: '审阅差异，说明风险与验证结果。', repositoryId: null, runtimeId: 'runtime-1', flavor: 'codex', model: null, reasoningEffort: null };
  return {
    machines: [{ id: 'machine-1', name: '开发工作站', ownerId: 'demo-user', connection: 'online', registered: true, blockedInSpace: false, lastActiveAt: stamp, spaceIds: ['space-1'], permissions: { ...permissions }, credential: 'active' }],
    runtimes: [{ id: 'runtime-1', name: '工作站 Codex', ownerId: 'demo-user', machineId: 'machine-1', flavor: 'codex', registered: true, shared: false, version: '演示版本', inspectionCurrent: true, eligibility: { eligible: true }, permissions: { ...permissions }, shareSpaceIds: [], blockedInSpace: false }],
    agents: [{ id: 'agent-1', name: definition.name, ownerId: 'demo-user', repositoryId: null, version: 1, accessMode: 'private', registered: true, blocked: false, ownerPresent: true, view: 'definition', definition, contentHash: 'demo-v1', memberIds: [], permissions: { invoke: true, edit: true, share: true, history: true, govern: true }, versions: [{ version: 1, createdAt: stamp, contentHash: 'demo-v1', definition: clone(definition) }] }],
    repositories: [{ id: 'repository-1', name: '示例应用', ownerId: 'demo-user', registered: true, aliases: aliases(['https://example.com/team/demo.git']), permissions: { manage: true } }],
    checkouts: [{ repositoryId: 'repository-1', machineId: 'machine-1', cwd: '/demo/application', gitCommonDir: '/demo/application/.git' }],
    selections: [{ repositoryId: null, agentId: 'agent-1', runtimeId: null }],
    tasks: Array.from({ length: 12 }, (_, index) => ({ id: `task-${index + 1}`, agent: { name: index ? `示例审阅 ${index + 1}` : '代码审阅助手' }, machine: { name: '开发工作站' }, runtime: { name: '工作站 Codex' }, round: 2, round_id: 'round-2', status: ['completed', 'running', 'needs_attention'][index % 3], workspace_mode: 'worktree', cwd: '/demo/application', parent: { host: 'demo-desktop', kind: 'codex', cwd: '/demo/application' }, summary: index ? '演示任务：检查页面交互与错误提示。' : '已审阅页面交互，建议补充空态提示与键盘焦点。', files: { status: 'delivered', retention: 'retained', available: 1, count: 1 }, code: { status: 'available', ref: 'demo-review' }, stop: index % 3 ? 'running' : 'stopped' }))
  };
}
export function createDemo() {
  let serial = 10;
  const state = { user: { userId: 'demo-user', name: '林舟' }, spaces: [{ id: 'space-1', name: '产品协作' }, { id: 'space-2', name: '个人实验' }], spaceId: 'space-1', scenario: 'normal', signedIn: true };
  const initial = seed();
  const resources = { machines: initial.machines, runtimes: initial.runtimes };
  const stores = new Map();
  const members = new Map();
  const invitations = new Map();
  function store() { if (!stores.has(state.spaceId)) stores.set(state.spaceId, { ...(state.spaceId === 'space-1' ? initial : { agents: [], repositories: [], checkouts: [], selections: [], tasks: [] }), ...resources }); return stores.get(state.spaceId); }
  function getMembers() { if (!members.has(state.spaceId)) members.set(state.spaceId, [{ userId: 'demo-user', name: state.user.name, role: 'owner' }, { userId: 'demo-member', name: '陈雨', role: 'member' }]); return members.get(state.spaceId); }
  function getInvitations() { if (!invitations.has(state.spaceId)) invitations.set(state.spaceId, []); return invitations.get(state.spaceId); }
  function derive() {
    const s = store();
    for (const m of s.machines) { m.connection = state.scenario === 'offline' || m.credential === 'revoked' ? 'offline' : 'online'; m.blockedInSpace = !!m.blockedSpaceIds?.includes(state.spaceId); }
    for (const r of s.runtimes) {
      r.blockedInSpace = !!r.blockedSpaceIds?.includes(state.spaceId);
      r.shared = r.shareSpaceIds.includes(state.spaceId);
      const m = s.machines.find(m => m.id === r.machineId);
      const eligible = !!(r.registered && !r.blockedInSpace && m?.registered && !m.blockedInSpace && m.connection === 'online' && m.spaceIds.includes(state.spaceId));
      r.eligibility = { eligible, ...(eligible ? {} : { reason: { message: '执行目标当前不可用', hint: '核对机器在线、登记与空间停用状态。' } }) }; r.permissions.use = eligible;
    }
    for (const a of s.agents) a.permissions.invoke = a.registered && !a.blocked;
  }
  async function request(path, body, method = body === undefined ? 'GET' : 'POST') {
    if (state.scenario === 'error') throw new Error('演示：Hub 暂时不可用。切换到“正常”场景后刷新。');
    derive();
    const u = new URL(path, 'https://demo.invalid'), parts = u.pathname.split('/').filter(Boolean), s = store();
    const list = key => state.scenario === 'empty' ? [] : clone(s[key]);
    if (parts[0] === 'tasks') {
      if (parts[1] === 'overview') {
        const rows = list('tasks').filter(t => (!u.searchParams.get('status') || t.status === u.searchParams.get('status')) && t.cwd.includes(u.searchParams.get('workspace') || '') && t.parent.host.includes(u.searchParams.get('parent') || ''));
        const limit = Number(u.searchParams.get('limit') || 25), page = Number(u.searchParams.get('page') || 1);
        return { total: rows.length, page, pages: Math.max(1, Math.ceil(rows.length / limit)), inventory: { available: state.scenario !== 'offline' }, items: rows.slice((page - 1) * limit, page * limit).map(t => ({ ...t, possibly_stale: state.scenario === 'offline' })) };
      }
      const t = s.tasks.find(t => t.id === parts[2]); if (!t) throw new Error('示例任务不存在。');
      const round = u.searchParams.get('roundId') === 'round-1' ? 1 : 2, offset = Number(u.searchParams.get('offset') || 0);
      const report = `第 ${round} 轮审阅：交互已检查，建议补充空态文案。\n` + '演示报告：键盘访问、状态提示与页面布局检查完成。\n'.repeat(1200);
      const text = report.slice(offset, offset + 16000);
      return { ...clone(t), agent_id: t.id, agent: { definition: s.agents[0]?.definition ?? { name: '历史审阅助手' }, hub: { version: round, contentHash: `demo-v${round}` } }, round, round_id: `round-${round}`, rounds: [1, 2].map(n => ({ id: `round-${n}`, ordinal: n, phase: 'completed' })), phase: 'completed', machine_id: 'machine-1', runtime_id: 'runtime-1', observed_at: stamp, report: { incomplete: false, text, offset, total: report.length, next_offset: offset + text.length < report.length ? offset + text.length : null }, actions: { native: true, manageViaAgent: true }, session_id: 'demo-session', environment: { source: '虚构示例' }, delivery: { files: ['review.md'] } };
    }
    if (u.pathname === '/agent-resolution') {
      const chosen = s.selections.find(x => x.repositoryId === body.hubRepositoryId) ?? s.selections.find(x => x.repositoryId === null);
      const a = s.agents.find(a => a.id === (body.agentId || chosen?.agentId));
      if (!a?.permissions.invoke) throw new Error('没有可调用的 Agent。请保存有效选择或恢复登记。');
      const runtimeId = body.runtimeId || (body.agentId && body.agentId !== chosen?.agentId ? null : chosen?.runtimeId) || a.definition.runtimeId;
      const r = s.runtimes.find(r => r.id === runtimeId);
      if (!r?.eligibility.eligible) throw new Error('Runtime 不可用；请检查登记、机器连接与停用状态。');
      return { resolution: { definition: clone(a.definition), version: a.version, selection: { agent: body.agentId ? '显式参数' : '个人选择', runtime: body.runtimeId ? '显式参数' : chosen?.runtimeId ? '个人选择' : 'Agent 定义' }, target: { machineId: r.machineId, flavor: r.flavor }, resolvedVersion: `demo-${a.version}` } };
    }
    if (u.pathname === '/agent-selections') {
      if (method === 'GET') return { selections: list('selections') };
      s.selections = s.selections.filter(x => x.repositoryId !== body.repositoryId);
      if (method === 'PUT') s.selections.push(clone(body)); return {};
    }
    if (parts[0] === 'resources' && parts[1] === 'spaces') {
      const item = s[parts[4] === 'machine' ? 'machines' : 'runtimes'].find(x => x.id === parts[5]);
      if (!item) throw new Error('演示资源不存在。');
      item.blockedSpaceIds = (item.blockedSpaceIds ?? []).filter(id => id !== parts[2]);
      if (method === 'PUT') item.blockedSpaceIds.push(parts[2]); return {};
    }
    const key = parts[0] === 'resources' ? parts[1] : parts[0], index = parts[0] === 'resources' ? 2 : 1;
    if (!['machines', 'runtimes', 'agents', 'repositories', 'checkouts'].includes(key)) throw new Error(`未实现的演示操作：${method} ${u.pathname}`);
    const id = parts[index], action = parts[index + 1];
    if (!id && method === 'GET') return { [key]: list(key) };
    if (!id && method === 'POST') {
      const newId = `${key}-${++serial}`;
      if (key === 'agents') { const a = clone(seed().agents[0]); Object.assign(a, { id: newId, definition: clone(body.definition), name: body.definition.name, repositoryId: body.definition.repositoryId, versions: [{ version: 1, createdAt: stamp, contentHash: 'demo-v1', definition: clone(body.definition) }] }); s.agents.push(a); return { agent: clone(a) }; }
      if (key === 'repositories') { const r = { ...clone(seed().repositories[0]), id: newId, name: body.name, aliases: aliases(body.aliases) }; s.repositories.push(r); return { repository: clone(r) }; }
      if (key === 'runtimes') { let r = s.runtimes.find(r => r.machineId === body.machineId && r.flavor === body.flavor); if (r) r.registered = true; else { r = { ...clone(seed().runtimes[0]), ...body, id: newId, name: body.name || `演示 ${body.flavor}` }; s.runtimes.push(r); } return { runtime: clone(r) }; }
    }
    const item = s[key].find(x => x.id === id); if (!item) throw new Error('演示资源不存在。');
    if (!action && method === 'PATCH') {
      if (key === 'agents') { if (body.expectedVersion !== item.version) throw new Error('版本已改变，请刷新后重试。'); item.definition = clone(body.definition); item.name = body.definition.name; item.repositoryId = body.definition.repositoryId; item.version++; item.contentHash = `demo-v${item.version}`; item.versions.push({ version: item.version, createdAt: stamp, contentHash: item.contentHash, definition: clone(item.definition) }); }
      else item.name = body.name; return {};
    }
    if (!action && method === 'DELETE') { item.registered = false; return {}; }
    if (action === 'register') { item.registered = true; return {}; }
    if (action === 'credential') { if (method === 'DELETE') item.credential = 'revoked'; return { credential: { status: item.credential, id: 'demo-credential' } }; }
    if (action === 'discover') return { tools: [{ flavor: 'codex', found: true }, { flavor: 'claude', found: true }], source: '演示数据' };
    if (action === 'check') return { runtime: { toolFound: true, version: item.version } };
    if (action === 'spaces') {
      const field = key === 'machines' ? 'spaceIds' : 'shareSpaceIds', space = parts[index + 2];
      if (key === 'runtimes' && method === 'PUT' && !s.machines.find(m => m.id === item.machineId)?.spaceIds.includes(space)) throw new Error('先把执行机器关联到目标空间，再共享 Runtime。');
      item[field] = item[field].filter(x => x !== space); if (method === 'PUT') item[field].push(space);
      if (key === 'machines' && method === 'DELETE') for (const runtime of s.runtimes.filter(r => r.machineId === item.id)) runtime.shareSpaceIds = runtime.shareSpaceIds.filter(id => id !== space);
      return {};
    }
    if (action === 'access') { item.accessMode = body.mode; item.memberIds = clone(body.memberIds); return {}; }
    if (action === 'versions') return { versions: clone(item.versions) };
    if (action === 'block') { item.blocked = method === 'PUT'; return {}; }
    if (action === 'aliases') { if (method === 'DELETE') item.aliases = item.aliases.filter(x => x.canonicalKey !== body.canonicalKey); else if (!item.aliases.some(x => x.canonicalKey === body.alias)) item.aliases.push(...aliases([body.alias])); return {}; }
    throw new Error(`未实现的演示操作：${method} ${u.pathname}`);
  }
  return { state, request, getMembers, getInvitations, nextId: prefix => `${prefix}-${++serial}` };
}
