// Fictional, in-memory data only. Reload or "重置演示" discards every change.
// Field names follow the real Hub projections so the prototype cannot promise data the product lacks.
import { NOW, ago, later } from './time.js';

export const HUB_ORIGIN = 'https://hub.example.com';
const SPACE = 'space-7c21', LAB = 'space-a903';
const clone = value => structuredClone(value);

export class HubError extends Error {
  constructor(kind, message, hint = '') { super(message); this.kind = kind; this.hint = hint; }
}
const unreachable = () => new HubError('unreachable', '无法连接 Hub', '检查网络或 Hub 是否在运行，然后重试。你的账号和设置不会改变。');
const writeUnknown = () => new HubError('unknown', '无法连接 Hub，这次操作的结果还没有确认', '先刷新核对结果，不要重复提交。');
const expiredSession = () => new HubError('expired', '登录已失效', '使用账号密码重新登录。');
const invalid = (message, hint = '') => new HubError('invalid', message, hint);

const reviewReport = (() => {
  const files = [
    ['src/hub/app.ts', '登录表单在提交失败后没有把焦点移回出错的字段。屏幕阅读器用户听到错误提示后，需要自己找回输入框。建议在提示出现后把焦点移到第一个无效字段，并保留已输入的用户名。'],
    ['src/hub/app.ts', '连接确认按钮在请求进行中仍可再次点击。虽然服务端会拒绝重复确认，但界面会先显示一次失败提示，容易让人以为授权没有成功。建议在请求进行中禁用按钮，完成后再恢复。'],
    ['src/hub/console.ts', '切换空间时会清空旧内容，这一点是正确的；但刷新失败时也清空了已有列表。按页面规格，同一账号和空间的刷新失败应保留已经读取成功的内容，只显示错误提示。'],
    ['src/hub/tasks-page.ts', '“执行未确认”的任务使用了与“失败”相同的红色。两者含义不同：前者不能重发，后者可以按需续接。建议给未确认状态单独的颜色和图标，并在文案中说明不要重发。'],
    ['src/hub/members.ts', '最后一位所有者退出空间时，按钮先被点击、再由服务端返回 409。可以在界面上提前说明限制，但仍要以服务端结果为准，不要只依赖前端判断。'],
    ['src/hub/style.css', '窄屏下资源导航可以横向滚动，但没有任何视觉提示表明右侧还有内容。可以在容器边缘加渐隐，或者在 680px 以下改成两行排列。'],
  ];
  const sections = [];
  for (let pass = 0; sections.join('').length < 42000; pass++) {
    for (const [file, note] of files) {
      sections.push(`${sections.length + 1}. ${file}\n${note}${pass ? `\n补充（第 ${pass + 1} 遍核对）：已在本地复现，修改范围限于该文件，不影响其他页面的请求或权限判断。` : ''}\n`);
    }
  }
  return `结论：账号页改动整体可以合入。发现 2 处需要修改的问题和 1 处建议，均已给出具体位置。\n\n已检查范围：账号注册、登录、连接确认、账号设置和成员管理相关的页面脚本与样式；没有修改任何文件。\n\n逐项说明\n\n${sections.join('\n')}`;
})();

function seedTasks() {
  const parent = (host, cwd) => ({ kind: 'mcp', host, cwd, machine_id: 'machine-3f8a' });
  const web = '/Users/lin/code/runweft-web', hub = '/Users/lin/code/hub-service';
  const review = { id: 'agent-review', name: '代码审阅', version: 3, contentHash: 'sha256:9c1e…4a07' };
  const build = { id: 'agent-build', name: '功能实现', version: 1, contentHash: 'sha256:51ad…e2b9' };
  const remote = { id: 'agent-remote', name: '远端测试', version: 2, contentHash: 'sha256:c7f0…13d5' };
  const mac = { id: 'machine-3f8a', name: '林舟的 MacBook Pro' }, bj = { id: 'machine-b210', name: '构建服务器 bj-04' }, chen = { id: 'machine-6d4e', name: '陈雨的工作站' };
  const codex = { id: 'runtime-1a7c', name: 'MacBook · Codex', flavor: 'codex' }, claude = { id: 'runtime-2b4e', name: 'MacBook · Claude Code', flavor: 'claude' };
  const bjCodex = { id: 'runtime-5e90', name: 'bj-04 · Codex', flavor: 'codex' }, chenClaude = { id: 'runtime-8c33', name: '陈雨 · Claude Code', flavor: 'claude' };
  const none = { status: 'none', retention: 'retained', count: 0, available: 0 };
  const round = (ordinal, phase, report = '', structured = null) => ({ id: `round-${ordinal}`, ordinal, phase, report, structured });
  return [
    { id: 'task-a41e', agent: build, machine: mac, runtime: claude, parent: parent('Codex', web), workspace_mode: 'worktree', cwd: '/Users/lin/.runweft/worktrees/runweft-web-a41e', updated_at: ago.minutes(4),
      rounds: [round(1, 'running')], status: 'needs_attention', stop: 'running',
      attention: { code: 'approval_required', message: '原生会话正在等待你的审批', hint: '在原生会话里批准或拒绝“写入 package.json”，任务会继续。' },
      files: { status: 'pending', retention: 'retained', count: 1, available: 0 }, code: { status: 'pending' } },
    { id: 'task-c93b', agent: remote, machine: chen, runtime: chenClaude, parent: parent('Codex', hub), workspace_mode: 'worktree', cwd: '/home/chen/.runweft/worktrees/hub-service-c93b', updated_at: ago.minutes(38),
      rounds: [round(1, 'finished', '在陈雨的工作站上完成构建，e2e 有 3 项失败：邀请过期提示、成员移除确认、空间改名回显。'), round(2, 'starting')], status: 'unknown', stop: 'unconfirmed',
      attention: { code: 'start_unknown', message: '无法确认第 2 轮是否已经开始执行', hint: '让 Agent 运行 task show 核对；确认之前不要重新发起这一轮。' },
      files: none, code: { status: 'unknown' } },
    { id: 'task-e0d7', agent: review, machine: mac, runtime: codex, parent: parent('Claude Code', web), workspace_mode: 'shared', cwd: web, updated_at: ago.minutes(2),
      rounds: [round(1, 'running')], status: 'running', stop: 'running', files: none, code: { status: 'not_applicable' } },
    { id: 'task-5b62', agent: build, machine: mac, runtime: claude, parent: parent('Codex', web), workspace_mode: 'worktree', cwd: '/Users/lin/.runweft/worktrees/runweft-web-5b62', updated_at: ago.minutes(11),
      rounds: [round(1, 'finished', '完成任务列表分页的接口接入，测试通过。按要求下一轮补充空态和错误提示。'), round(2, 'running')], status: 'running', stop: 'running',
      files: { status: 'pending', retention: 'retained', count: 0, available: 0 }, code: { status: 'capturing' } },
    { id: 'task-91f0', agent: review, machine: mac, runtime: codex, parent: parent('Codex', web), workspace_mode: 'shared', cwd: web, updated_at: ago.minutes(26),
      rounds: [round(1, 'finished', '第 1 轮：发现 4 处问题，已列出具体位置。'), round(2, 'finished', reviewReport, {
        summary: '账号页改动整体可以合入。发现 2 处需要修改的问题和 1 处建议。',
        changes: '只读评审，没有修改任何文件。',
        tests: '本地运行 bun run test：通过（312 项）。没有运行集成测试。',
        remaining: '1. 登录失败后把焦点移回出错字段。\n2. 连接确认请求进行中时禁用按钮。\n3. 建议：窄屏资源导航加滚动提示。',
      })], status: 'completed', stop: 'stopped', files: { status: 'delivered', retention: 'retained', count: 1, available: 1, items: ['review.md'] }, code: { status: 'not_applicable' } },
    { id: 'task-2d8c', agent: build, machine: mac, runtime: claude, parent: parent('Codex', web), workspace_mode: 'worktree', cwd: '/Users/lin/.runweft/worktrees/runweft-web-2d8c', updated_at: ago.hours(1),
      rounds: [round(1, 'finished', '实现了成员页的邀请撤销：新增确认对话框，撤销后刷新邀请列表。补充 6 项单元测试，全部通过。', {
        summary: '邀请撤销已实现，单元测试通过。', changes: 'src/hub/members.ts、src/hub/style.css，新增 test/core/invitations.test.ts。', tests: 'bun run test：通过（318 项）。', remaining: '没有剩余事项。',
      })], status: 'completed', stop: 'stopped', files: { status: 'delivered', retention: 'retained', count: 2, available: 2, items: ['CHANGES.md', 'test-output.txt'] },
      code: { status: 'available', ref: 'runweft/task-2d8c/round-1', result_head: 'a3f91c2', next: { action: 'fetch', command: 'runweft task fetch task-2d8c', hint: '取回后由主 Agent 审查再合入，不会自动 push。' } } },
    { id: 'task-77aa', agent: remote, machine: chen, runtime: chenClaude, parent: parent('Claude Code', hub), workspace_mode: 'worktree', cwd: '/home/chen/.runweft/worktrees/hub-service-77aa', updated_at: ago.hours(3),
      rounds: [round(1, 'failed', '构建在依赖安装阶段失败：registry 请求超时，重试 3 次后放弃。')], status: 'failed', stop: 'stopped', files: none, code: { status: 'not_applicable' } },
    { id: 'task-0f3e', agent: build, machine: mac, runtime: claude, parent: parent('Codex', web), workspace_mode: 'worktree', cwd: '/Users/lin/.runweft/worktrees/runweft-web-0f3e', updated_at: ago.hours(15.7),
      rounds: [round(1, 'finished', '已按你的要求停止。停止前完成了分页组件的初稿，没有提交。')], status: 'interrupted', stop: 'stopped', files: { status: 'none', retention: 'released', count: 0, available: 0 }, code: { status: 'discarded' } },
    { id: 'task-b5c1', agent: review, machine: mac, runtime: codex, parent: parent('Codex', web), workspace_mode: 'shared', cwd: web, updated_at: ago.hours(17.9),
      rounds: [round(1, 'finished', '第 1 轮：提出 4 个问题。'), round(2, 'finished', '第 2 轮：修复了 3 个，剩余 1 个。'), round(3, 'finished', '第 3 轮复审：之前提出的 4 个问题都已修复，可以合入。')], status: 'completed', stop: 'stopped', files: none, code: { status: 'not_applicable' } },
    { id: 'task-6e19', agent: review, machine: mac, runtime: codex, parent: parent('Claude Code', hub), workspace_mode: 'shared', cwd: hub, updated_at: ago.days(2),
      rounds: [round(1, 'finished', '审阅 Hub 邀请流程：建议邀请过期时给出更明确的提示，并说明可以请管理员重新生成。')], status: 'completed', stop: 'stopped', files: none, code: { status: 'not_applicable' } },
    { id: 'task-d204', agent: build, machine: bj, runtime: bjCodex, parent: parent('Codex', hub), workspace_mode: 'worktree', cwd: '/srv/runweft/worktrees/hub-service-d204', updated_at: ago.days(3),
      rounds: [round(1, 'finished', '完成接口改动。'), round(2, 'failed', '第 2 轮：类型检查失败，3 处类型不匹配，没有修复成功。')], status: 'failed', stop: 'stopped', files: none,
      code: { status: 'pending', sealing_status: 'needs_attention', next: { action: 'inspect', command: 'runweft task show task-d204', hint: '代码封存需要处理，先让 Agent 查看原因。' } } },
    { id: 'task-3a7b', agent: remote, machine: chen, runtime: chenClaude, parent: parent('Codex', hub), workspace_mode: 'worktree', cwd: '/home/chen/.runweft/worktrees/hub-service-3a7b', updated_at: ago.days(4),
      rounds: [round(1, 'finished', '在陈雨的工作站上完整构建并测试通过（312 项）。')], status: 'completed', stop: 'stopped', files: { status: 'delivered', retention: 'retained', count: 1, available: 1, items: ['junit.xml'] }, code: { status: 'not_applicable' } },
    { id: 'task-48fd', agent: review, machine: mac, runtime: codex, parent: parent('Codex', web), workspace_mode: 'shared', cwd: web, updated_at: ago.days(5),
      rounds: [round(1, 'finished', '审阅 Runtime 共享说明：文案准确，建议补充“不提供系统隔离”的提示。')], status: 'completed', stop: 'stopped', files: none, code: { status: 'not_applicable' } },
    { id: 'task-f3c0', agent: build, machine: mac, runtime: claude, parent: parent('Claude Code', web), workspace_mode: 'worktree', cwd: '/Users/lin/.runweft/worktrees/runweft-web-f3c0', updated_at: ago.days(6),
      rounds: [round(1, 'finished', '实现仓库别名的添加与移除，测试通过。成果已取回并合入。')], status: 'completed', stop: 'stopped', files: { status: 'delivered', retention: 'released', count: 1, available: 0 }, code: { status: 'released' } },
  ];
}

const definitions = {
  review: { name: '代码审阅', description: '审阅当前改动，指出风险并给出可以直接执行的修改建议。', instructions: '只读审阅当前工作目录中的改动，包括未提交的部分。\n\n1. 先说明结论：能否合入。\n2. 按文件列出问题，写清位置、影响和修改建议。\n3. 区分“必须修改”和“建议”。\n4. 说明运行了哪些检查；没有运行的检查要写明。\n\n不要修改文件，不要提交或推送。', repositoryId: null, runtimeId: 'runtime-1a7c', flavor: 'codex', model: null, reasoningEffort: 'high' },
  build: { name: '功能实现', description: '在独立 worktree 中实现指定功能，补齐测试，并交付可审阅的代码。', instructions: '在独立 worktree 中完成任务，不改动原工作目录。\n\n完成后：运行类型检查和测试；在报告里列出改动的文件、测试结果和剩余事项。代码交付后由主 Agent 审查再合入，不要推送。', repositoryId: 'repo-web', runtimeId: 'runtime-2b4e', flavor: 'claude', model: null, reasoningEffort: null },
  remote: { name: '远端测试', description: '在陈雨的工作站上运行完整构建和端到端测试。', instructions: '从已提交的版本准备独立 worktree，运行完整构建、单元测试和 e2e 测试，汇报失败用例和日志位置。', repositoryId: 'repo-hub', runtimeId: 'runtime-8c33', flavor: 'claude', model: null, reasoningEffort: null },
  release: { name: '发布检查', description: '', instructions: '', repositoryId: 'repo-hub', runtimeId: 'runtime-8c33', flavor: 'claude', model: null, reasoningEffort: null },
  legacy: { name: '旧版审阅', description: '早期的审阅配置，已被“代码审阅”取代。', instructions: '审阅改动并列出问题。', repositoryId: null, runtimeId: 'runtime-5e90', flavor: 'codex', model: null, reasoningEffort: null },
};

function versions(definition, count, startDaysAgo) {
  return Array.from({ length: count }, (_, index) => ({
    version: index + 1, createdAt: ago.days(startDaysAgo - index * 4),
    contentHash: `sha256:${(0x3a1 + index * 977).toString(16)}…${(0x9b2 + index * 311).toString(16)}`,
    definition: { ...clone(definition), ...(index < count - 1 ? { reasoningEffort: null } : {}) },
  }));
}

function seed() {
  const people = {
    'user-lin': { id: 'user-lin', username: 'linzhou', name: '林舟', hue: 0 },
    'user-chen': { id: 'user-chen', username: 'chenyu', name: '陈雨', hue: 1 },
    'user-zhou': { id: 'user-zhou', username: 'zhoubei', name: '周北', hue: 2 },
    'user-xu': { id: 'user-xu', username: 'xuqing', name: '许清', hue: 3 },
  };
  return {
    me: 'user-lin', people, firstRun: false,
    environments: [
      { id: 'cred-w-01', kind: 'browser', label: '当前浏览器', current: true, lastUsedAt: NOW, revoked: false },
      { id: 'cred-c-07', kind: 'cli', label: '林舟的 MacBook Pro', current: false, lastUsedAt: ago.minutes(2), revoked: false },
      { id: 'cred-c-03', kind: 'cli', label: '构建服务器 bj-04', current: false, lastUsedAt: ago.days(3), revoked: false },
      { id: 'cred-w-02', kind: 'browser', label: '另一个浏览器', current: false, lastUsedAt: ago.hours(16), revoked: false },
    ],
    spaces: [
      { id: SPACE, name: '产品协作', members: [
        { userId: 'user-lin', role: 'owner', joinedAt: ago.days(41) }, { userId: 'user-chen', role: 'admin', joinedAt: ago.days(33) },
        { userId: 'user-zhou', role: 'member', joinedAt: ago.days(12) }, { userId: 'user-xu', role: 'member', joinedAt: ago.days(3) }],
      invitations: [{ id: 'inv-41d2', role: 'member', createdBy: 'user-lin', expiresAt: later.hours(18) }, { id: 'inv-8a0c', role: 'admin', createdBy: 'user-lin', expiresAt: later.hours(5) }] },
      { id: LAB, name: '个人实验', members: [{ userId: 'user-lin', role: 'owner', joinedAt: ago.days(60) }], invitations: [] },
    ],
    machines: [
      { id: 'machine-3f8a', name: '林舟的 MacBook Pro', ownerId: 'user-lin', registered: true, connection: 'online', credential: { id: 'cred-m-91a2', status: 'active' }, spaceIds: [SPACE, LAB], blockedSpaceIds: [], lastActiveAt: ago.minutes(1) },
      { id: 'machine-b210', name: '构建服务器 bj-04', ownerId: 'user-lin', registered: true, connection: 'online', credential: { id: 'cred-m-4c77', status: 'active' }, spaceIds: [SPACE], blockedSpaceIds: [], lastActiveAt: ago.minutes(9) },
      { id: 'machine-0c19', name: '测试机 lab-02', ownerId: 'user-lin', registered: true, connection: 'pending', credential: { id: 'cred-m-6e05', status: 'active' }, spaceIds: [], blockedSpaceIds: [], lastActiveAt: null },
      { id: 'machine-6d4e', name: '陈雨的工作站', ownerId: 'user-chen', registered: true, connection: 'online', credential: { id: 'cred-m-2f18', status: 'active' }, spaceIds: [SPACE], blockedSpaceIds: [], lastActiveAt: ago.minutes(26) },
    ],
    runtimes: [
      { id: 'runtime-1a7c', name: 'MacBook · Codex', machineId: 'machine-3f8a', flavor: 'codex', ownerId: 'user-lin', registered: true, shareSpaceIds: [SPACE], blockedSpaceIds: [], version: '示例版本 0.9.2', inspectedAt: ago.minutes(2) },
      { id: 'runtime-2b4e', name: 'MacBook · Claude Code', machineId: 'machine-3f8a', flavor: 'claude', ownerId: 'user-lin', registered: true, shareSpaceIds: [], blockedSpaceIds: [], version: '示例版本 2.1.0', inspectedAt: ago.minutes(2) },
      { id: 'runtime-5e90', name: 'bj-04 · Codex', machineId: 'machine-b210', flavor: 'codex', ownerId: 'user-lin', registered: true, shareSpaceIds: [SPACE], blockedSpaceIds: [], version: '示例版本 0.9.0', inspectedAt: ago.hours(5) },
      { id: 'runtime-8c33', name: '陈雨 · Claude Code', machineId: 'machine-6d4e', flavor: 'claude', ownerId: 'user-chen', registered: true, shareSpaceIds: [SPACE], blockedSpaceIds: [], version: '示例版本 2.0.8', inspectedAt: ago.minutes(30) },
    ],
    agents: [
      { id: 'agent-review', spaceId: SPACE, ownerId: 'user-lin', version: 3, registered: true, blockedSpaceIds: [], access: { mode: 'space', memberIds: [] }, definition: clone(definitions.review), versions: versions(definitions.review, 3, 20) },
      { id: 'agent-build', spaceId: SPACE, ownerId: 'user-lin', version: 1, registered: true, blockedSpaceIds: [], access: { mode: 'members', memberIds: ['user-chen'] }, definition: clone(definitions.build), versions: versions(definitions.build, 1, 9) },
      { id: 'agent-remote', spaceId: SPACE, ownerId: 'user-chen', version: 2, registered: true, blockedSpaceIds: [], access: { mode: 'space', memberIds: [] }, definition: clone(definitions.remote), versions: versions(definitions.remote, 2, 14) },
      { id: 'agent-release', spaceId: SPACE, ownerId: 'user-chen', version: 4, registered: true, blockedSpaceIds: [], access: { mode: 'private', memberIds: [] }, definition: clone(definitions.release), versions: versions(definitions.release, 4, 30) },
      { id: 'agent-legacy', spaceId: SPACE, ownerId: 'user-lin', version: 2, registered: false, blockedSpaceIds: [], access: { mode: 'private', memberIds: [] }, definition: clone(definitions.legacy), versions: versions(definitions.legacy, 2, 50) },
    ],
    repositories: [
      { id: 'repo-web', spaceId: SPACE, name: 'runweft-web', ownerId: 'user-lin', registered: true, aliases: ['git@github.com:example/runweft-web.git', 'https://github.com/example/runweft-web'] },
      { id: 'repo-hub', spaceId: SPACE, name: 'hub-service', ownerId: 'user-chen', registered: true, aliases: ['git@git.example.com:team/hub-service.git'] },
      { id: 'repo-design', spaceId: SPACE, name: '设计稿归档', ownerId: 'user-lin', registered: false, aliases: [] },
    ],
    checkouts: [
      { repositoryId: 'repo-web', machineId: 'machine-3f8a', cwd: '/Users/lin/code/runweft-web', commonDir: '/Users/lin/code/runweft-web/.git' },
      { repositoryId: 'repo-hub', machineId: 'machine-3f8a', cwd: '/Users/lin/code/hub-service', commonDir: '/Users/lin/code/hub-service/.git' },
      { repositoryId: 'repo-hub', machineId: 'machine-b210', cwd: '/srv/work/hub-service', commonDir: '/srv/work/hub-service/.git' },
    ],
    selections: [
      { spaceId: SPACE, repositoryId: null, agentId: 'agent-review', runtimeId: null },
      { spaceId: SPACE, repositoryId: 'repo-web', agentId: 'agent-build', runtimeId: null },
      { spaceId: SPACE, repositoryId: 'repo-hub', agentId: 'agent-legacy', runtimeId: 'runtime-5e90' },
    ],
    tasks: { [SPACE]: seedTasks(), [LAB]: [] },
  };
}

export const roleLabels = { owner: '所有者', admin: '管理员', member: '成员' };
export const flavorLabels = { codex: 'Codex', claude: 'Claude Code' };
export const accessLabels = { private: '私有', members: '指定成员', space: '空间成员' };
export const phaseLabels = { queued: '排队中', starting: '启动中', running: '执行中', finished: '已结束', failed: '失败' };

export function createDemo() {
  let db = seed();
  const settings = { scenario: 'normal', role: 'owner', spaceId: SPACE, refreshing: false };
  let serial = 40;
  const id = prefix => `${prefix}-${((++serial * 2654435761) % 0xffff).toString(16).padStart(4, '0')}`;

  const me = () => db.people[db.me];
  const person = userId => db.people[userId] ?? { id: userId, name: '已离开的成员', username: userId, hue: 5 };
  const space = (spaceId = settings.spaceId) => db.spaces.find(s => s.id === spaceId);
  // The demo role replaces the viewer's role in the main space so reviewers can compare permissions.
  function members(spaceId = settings.spaceId) {
    const current = space(spaceId);
    if (!current) return [];
    if (spaceId !== SPACE || settings.role === 'owner' || db.firstRun) return current.members;
    return current.members.map(m => (m.userId === db.me ? { ...m, role: settings.role } : m.userId === 'user-chen' ? { ...m, role: 'owner' } : m));
  }
  const myRole = (spaceId = settings.spaceId) => members(spaceId).find(m => m.userId === db.me)?.role ?? 'member';
  const manager = () => ['owner', 'admin'].includes(myRole());
  const empty = () => settings.scenario === 'empty';
  const offline = () => settings.scenario === 'offline';

  async function read(fn) {
    if (settings.scenario === 'error') throw unreachable();
    if (settings.scenario === 'refresh-error' && settings.refreshing) throw unreachable();
    if (settings.scenario === 'expired') throw expiredSession();
    return clone(fn());
  }
  async function write(fn) {
    if (settings.scenario === 'offline' || settings.scenario === 'refresh-error') throw writeUnknown();
    if (settings.scenario === 'error') throw unreachable();
    if (settings.scenario === 'expired') throw expiredSession();
    return clone(fn());
  }

  const connection = machine => (offline() && machine.connection === 'online' ? 'offline' : machine.connection);
  function machineView(machine) {
    const owner = machine.ownerId === db.me;
    const view = { ...clone(machine), connection: connection(machine), owner, ownerName: owner ? '你' : person(machine.ownerId).name,
      associated: machine.spaceIds.includes(settings.spaceId), blocked: machine.blockedSpaceIds.includes(settings.spaceId),
      permissions: { manage: owner, govern: manager() && machine.spaceIds.includes(settings.spaceId) } };
    if (!owner) { delete view.credential; view.spaceIds = view.spaceIds.filter(s => s === settings.spaceId); }
    return view;
  }
  function machineVisible(machine) {
    if (machine.ownerId === db.me) return true;
    if (!machine.spaceIds.includes(settings.spaceId)) return false;
    return manager() || db.runtimes.some(r => r.machineId === machine.id && r.shareSpaceIds.includes(settings.spaceId));
  }
  function eligibility(runtime) {
    const machine = db.machines.find(m => m.id === runtime.machineId), state = connection(machine);
    const hit = [
      [!runtime.registered, 'Runtime 已取消登记', '恢复登记后才能选用。'],
      [runtime.blockedSpaceIds.includes(settings.spaceId), '已在此空间停用', '空间所有者或管理员解除停用后才能选用。'],
      [!machine.registered, '机器已取消登记', '恢复机器登记后才能选用。'],
      [machine.blockedSpaceIds.includes(settings.spaceId), '机器已在此空间停用', '空间所有者或管理员解除停用后才能选用。'],
      [machine.credential.status !== 'active', '机器凭据已撤销', '在这台机器上让 Agent 轮换凭据并重启 Runner。'],
      [state === 'pending', '机器尚未首次连接', '在这台机器上让 Agent 完成接入。'],
      [state === 'offline', '机器离线', '机器恢复连接后会重新可用。'],
      [!machine.spaceIds.includes(settings.spaceId), '机器没有关联此空间', '机器所有者把它关联到此空间后才能选用。'],
      [runtime.ownerId !== db.me && !runtime.shareSpaceIds.includes(settings.spaceId), '没有共享到此空间', '请 Runtime 所有者共享到此空间。'],
    ].find(([condition]) => condition);
    return hit ? { eligible: false, reason: hit[1], hint: hit[2] } : { eligible: true };
  }
  function runtimeView(runtime) {
    const owner = runtime.ownerId === db.me, machine = db.machines.find(m => m.id === runtime.machineId), verdict = eligibility(runtime);
    return { ...clone(runtime), owner, ownerName: owner ? '你' : person(runtime.ownerId).name, machineName: machine.name, machineConnection: connection(machine),
      machineAssociated: machine.spaceIds.includes(settings.spaceId), shared: runtime.shareSpaceIds.includes(settings.spaceId), blocked: runtime.blockedSpaceIds.includes(settings.spaceId), eligibility: verdict,
      shareSpaceIds: owner ? [...runtime.shareSpaceIds] : [], machineSpaceIds: owner ? [...machine.spaceIds] : [],
      permissions: { manage: owner, share: owner, govern: manager() && machine.spaceIds.includes(settings.spaceId), use: verdict.eligible } };
  }
  const runtimeVisible = runtime => runtime.ownerId === db.me || runtime.shareSpaceIds.includes(settings.spaceId);

  function agentView(agent) {
    const owner = agent.ownerId === db.me;
    const shared = agent.access.mode === 'space' || (agent.access.mode === 'members' && agent.access.memberIds.includes(db.me));
    const blocked = agent.blockedSpaceIds.includes(settings.spaceId);
    const ownerPresent = members().some(m => m.userId === agent.ownerId);
    const base = { id: agent.id, ownerId: agent.ownerId, ownerName: owner ? '你' : person(agent.ownerId).name, version: agent.version, registered: agent.registered, blocked, ownerPresent,
      name: agent.definition.name, repositoryId: agent.definition.repositoryId, accessMode: agent.access.mode,
      invocable: agent.registered && !blocked && ownerPresent && (owner || shared),
      permissions: { edit: owner, share: owner, history: owner, govern: manager() } };
    if (owner || shared) return { ...base, view: 'definition', definition: clone(agent.definition), memberIds: owner ? [...agent.access.memberIds] : [], contentHash: agent.versions.at(-1).contentHash };
    return { ...base, view: 'governance' };
  }
  const agentVisible = agent => agent.spaceId === settings.spaceId && (agent.ownerId === db.me || agent.access.mode === 'space' || agent.access.memberIds.includes(db.me) || manager());

  const repositoryView = repo => ({ ...clone(repo), ownerName: repo.ownerId === db.me ? '你' : person(repo.ownerId).name, permissions: { manage: repo.ownerId === db.me || manager() },
    checkouts: db.checkouts.filter(c => c.repositoryId === repo.id).map(c => ({ ...c, machineName: db.machines.find(m => m.id === c.machineId)?.name ?? c.machineId })) });

  function overviewItem(task) {
    const current = task.rounds.find(r => !['finished', 'failed'].includes(r.phase)) ?? task.rounds.at(-1);
    const machine = db.machines.find(m => m.id === task.machine.id);
    const online = machine ? connection(machine) === 'online' : null;
    return { id: task.id, round_id: current.id, round: current.ordinal, updated_at: task.updated_at, parent: task.parent, agent: { id: task.agent.id, name: task.agent.name },
      runtime: task.runtime, machine: { ...task.machine, online }, cwd: task.cwd, workspace_mode: task.workspace_mode, status: task.status, phase: current.phase, stop: task.stop,
      possibly_stale: !['finished', 'failed'].includes(current.phase) && online !== true, attention: task.attention ?? null,
      summary: current.report.slice(0, 1000), summary_truncated: current.report.length > 1000, code: task.code, files: task.files };
  }

  const api = {
    // ---- account -----------------------------------------------------
    account: () => read(() => ({ user: me(), environments: db.environments })),
    async login(username) { if (!username.trim()) throw invalid('请输入用户名。'); if (db.firstRun || db.me !== 'user-lin') { db = seed(); settings.spaceId = SPACE; } return clone(me()); },
    async register(username) {
      const name = username.trim();
      if (!name) throw invalid('请输入用户名。');
      if (Object.values(seed().people).some(p => p.username === name.toLowerCase())) throw invalid('这个用户名已被使用', '换一个用户名，或者直接登录。');
      db = seed();
      db.firstRun = true;
      db.people['user-new'] = { id: 'user-new', username: name, name, hue: 4 };
      db.me = 'user-new';
      db.spaces = [{ id: 'space-new', name: '我的空间', members: [{ userId: 'user-new', role: 'owner', joinedAt: NOW }], invitations: [] }];
      db.tasks = { 'space-new': [] };
      db.environments = [{ id: 'cred-w-new', kind: 'browser', label: '当前浏览器', current: true, lastUsedAt: NOW, revoked: false }, { id: 'cred-c-new', kind: 'cli', label: '我的开发电脑', current: false, lastUsedAt: NOW, revoked: false }];
      db.selections = []; db.repositories = []; db.agents = []; db.checkouts = [];
      settings.spaceId = 'space-new';
      return clone(me());
    },
    async resetPassword(username, code) { if (code.trim() !== 'demo') throw invalid('重置码不正确', '演示中请输入 demo；实际重置码由这个 Hub 的部署者提供。'); return { username }; },
    updateDisplayName: name => write(() => { if (!name) throw invalid('显示名称不能为空。'); me().name = name; return me(); }),
    revokeEnvironment: credentialId => write(() => { db.environments.find(e => e.id === credentialId).revoked = true; return {}; }),
    changePassword: (current, next) => write(() => { if (!current || !next) throw invalid('请填写当前密码和新密码。'); return {}; }),
    logoutAll: password => write(() => { if (!password) throw invalid('请输入当前密码。'); return {}; }),

    // ---- spaces & members ------------------------------------------------
    spaces: () => read(() => db.spaces.map(s => ({ id: s.id, name: s.name, role: myRole(s.id), memberCount: members(s.id).length }))),
    createSpace: name => write(() => { const s = { id: id('space'), name, members: [{ userId: db.me, role: 'owner', joinedAt: NOW }], invitations: [] }; db.spaces.push(s); db.tasks[s.id] = []; return s; }),
    acceptInvitation: token => write(() => {
      if (token.trim() !== 'demo') throw invalid('邀请无效或已过期', '演示邀请为 demo。实际邀请 24 小时内有效，只能由一人使用。');
      if (db.spaces.some(s => s.name === '设计评审')) throw invalid('你已经是这个空间的成员', '已从其他途径加入，邀请没有被消耗。');
      const s = { id: id('space'), name: '设计评审', members: [{ userId: 'user-chen', role: 'owner', joinedAt: ago.days(20) }, { userId: db.me, role: 'member', joinedAt: NOW }], invitations: [] };
      db.spaces.push(s); db.tasks[s.id] = []; return s;
    }),
    renameSpace: name => write(() => { if (!manager()) throw invalid('只有所有者和管理员可以修改空间名称。'); space().name = name; return {}; }),
    leaveSpace: () => write(() => {
      const owners = members().filter(m => m.role === 'owner');
      if (myRole() === 'owner' && owners.length === 1) throw invalid('你是最后一位所有者', '先把另一位成员设为所有者，再退出空间。');
      if (db.spaces.length === 1) throw invalid('这是你唯一的空间', '演示中至少保留一个空间。');
      db.spaces = db.spaces.filter(s => s.id !== settings.spaceId); settings.spaceId = db.spaces[0].id; return {};
    }),
    members: () => read(() => {
      const list = members().map(m => ({ ...m, ...person(m.userId), userId: m.userId }));
      return { role: myRole(), members: empty() ? list.filter(m => m.userId === db.me) : list };
    }),
    setMemberRole: (userId, role) => write(() => {
      if (myRole() !== 'owner') throw invalid('只有所有者可以修改成员角色。');
      const list = space().members, target = list.find(m => m.userId === userId);
      if (target.role === 'owner' && role !== 'owner' && list.filter(m => m.role === 'owner').length === 1) throw invalid('空间至少保留一位所有者', '先把另一位成员设为所有者。');
      target.role = role; return {};
    }),
    removeMember: userId => write(() => {
      const target = members().find(m => m.userId === userId);
      if (myRole() === 'member') throw invalid('成员不能移除其他人。');
      if (myRole() === 'admin' && target.role !== 'member') throw invalid('管理员只能移除普通成员。');
      const s = space(); s.members = s.members.filter(m => m.userId !== userId); return {};
    }),
    invitations: () => read(() => (empty() || !manager() ? [] : space().invitations.filter(i => myRole() === 'owner' || i.role === 'member').map(i => ({ ...i, creator: person(i.createdBy).name })))),
    createInvitation: role => write(() => {
      if (!manager() || (role !== 'member' && myRole() !== 'owner')) throw invalid('当前角色不能创建这类邀请。');
      const invitation = { id: id('inv'), role, createdBy: db.me, expiresAt: later.hours(24) };
      space().invitations.unshift(invitation);
      return { ...invitation, token: `rw_inv_demo${invitation.id.slice(4)}Q7m2Xk9pLw` };
    }),
    revokeInvitation: invitationId => write(() => { const s = space(); s.invitations = s.invitations.filter(i => i.id !== invitationId); return {}; }),

    // ---- tasks ----------------------------------------------------------
    taskOverview: ({ status = '', workspace = '', parent = '', page = 1, limit = 50 }) => read(() => {
      const rank = item => (item.attention || item.status === 'unknown' ? 0 : item.status === 'running' ? 1 : 2);
      const all = empty() ? [] : (db.tasks[settings.spaceId] ?? []).map(overviewItem);
      const rows = all.filter(t => t.parent.cwd.toLowerCase().includes(workspace.toLowerCase())
        && [t.parent.kind, t.parent.machine_id, t.parent.cwd, t.parent.host].some(v => v?.toLowerCase().includes(parent.toLowerCase())))
        .filter(t => !status || t.status === status)
        .sort((a, b) => rank(a) - rank(b) || b.updated_at - a.updated_at);
      const pages = Math.max(1, Math.ceil(rows.length / limit));
      return { total: rows.length, page: Math.min(page, pages), pages, limit, inventory: offline() ? { available: false, error: { message: '机器状态暂时无法读取' } } : { available: true },
        items: rows.slice((Math.min(page, pages) - 1) * limit, Math.min(page, pages) * limit) };
    }),
    taskDetail: (taskId, { roundId, offset = 0 } = {}) => read(() => {
      const task = (db.tasks[settings.spaceId] ?? []).find(t => t.id === taskId);
      if (!task) throw invalid('找不到这个任务', '它可能属于其他空间。');
      const overview = overviewItem(task);
      const round = task.rounds.find(r => r.id === (roundId ?? overview.round_id)) ?? task.rounds.at(-1);
      const latest = round.id === overview.round_id;
      const text = round.report.slice(offset, offset + 16000);
      const agent = db.agents.find(a => a.id === task.agent.id);
      const snapshot = { ...(agent ? clone(agent.definition) : { name: task.agent.name }), hub: { version: task.agent.version, contentHash: task.agent.contentHash } };
      return { ...overview, rounds: task.rounds.map(r => ({ id: r.id, ordinal: r.ordinal, phase: r.phase })), round: round.ordinal, round_id: round.id, phase: round.phase,
        status: latest ? task.status : round.phase === 'failed' ? 'failed' : 'completed', attention: latest ? task.attention ?? null : null,
        observed_at: offline() ? ago.minutes(14) : ago.minutes(1), agent_config: snapshot,
        report: { text, offset, total: round.report.length, next_offset: offset + text.length < round.report.length ? offset + text.length : null, structured: round.structured, incomplete: task.status === 'interrupted' && latest },
        native: { session_id: `hapi-${task.id.slice(5)}-${round.ordinal}` },
        environment: { mode: task.workspace_mode, cwd: task.cwd, source: task.workspace_mode === 'worktree' ? '从主宿主的当前提交准备独立 worktree' : '直接使用主宿主的工作目录' },
        delivery: { files: task.files.items ?? [] } };
    }),

    // ---- machines & runtimes ---------------------------------------------
    machines: () => read(() => (empty() ? [] : db.machines.filter(machineVisible).map(machineView))),
    renameMachine: (machineId, name) => write(() => { db.machines.find(m => m.id === machineId).name = name; return {}; }),
    setMachineRegistered: (machineId, on) => write(() => { db.machines.find(m => m.id === machineId).registered = on; return {}; }),
    revokeMachineCredential: machineId => write(() => { db.machines.find(m => m.id === machineId).credential.status = 'revoked'; return {}; }),
    discoverTools: machineId => read(() => {
      const machine = db.machines.find(m => m.id === machineId);
      if (connection(machine) !== 'online') throw invalid('机器不在线，无法探测', '机器恢复连接后再试。');
      return { tools: [{ flavor: 'codex', found: true, version: '示例版本 0.9.2' }, { flavor: 'claude', found: true, version: '示例版本 2.1.0' }] };
    }),
    setMachineSpace: (machineId, spaceId, on) => write(() => {
      const machine = db.machines.find(m => m.id === machineId);
      machine.spaceIds = machine.spaceIds.filter(s => s !== spaceId);
      if (on) machine.spaceIds.push(spaceId);
      else for (const runtime of db.runtimes.filter(r => r.machineId === machineId)) runtime.shareSpaceIds = runtime.shareSpaceIds.filter(s => s !== spaceId);
      return {};
    }),
    setMachineBlocked: (machineId, on) => write(() => { const m = db.machines.find(x => x.id === machineId); m.blockedSpaceIds = m.blockedSpaceIds.filter(s => s !== settings.spaceId); if (on) m.blockedSpaceIds.push(settings.spaceId); return {}; }),
    runtimes: () => read(() => (empty() ? [] : db.runtimes.filter(runtimeVisible).map(runtimeView))),
    ownMachines: () => read(() => (empty() ? [] : db.machines.filter(m => m.ownerId === db.me && m.registered).map(machineView))),
    registerRuntime: ({ machineId, flavor, name }) => write(() => {
      const machine = db.machines.find(m => m.id === machineId);
      if (connection(machine) !== 'online') throw invalid('机器不在线，无法登记', '登记会在机器上确认工具存在，请在机器在线时重试。');
      let runtime = db.runtimes.find(r => r.machineId === machineId && r.flavor === flavor);
      if (runtime) runtime.registered = true;
      else {
        runtime = { id: id('runtime'), name: name || `${machine.name} · ${flavorLabels[flavor]}`, machineId, flavor, ownerId: db.me, registered: true, shareSpaceIds: [], blockedSpaceIds: [], version: '示例版本 1.0.0', inspectedAt: NOW };
        db.runtimes.push(runtime);
      }
      return runtimeView(runtime);
    }),
    renameRuntime: (runtimeId, name) => write(() => { db.runtimes.find(r => r.id === runtimeId).name = name; return {}; }),
    setRuntimeRegistered: (runtimeId, on) => write(() => { db.runtimes.find(r => r.id === runtimeId).registered = on; return {}; }),
    checkRuntime: runtimeId => read(() => {
      const runtime = db.runtimes.find(r => r.id === runtimeId);
      if (connection(db.machines.find(m => m.id === runtime.machineId)) !== 'online') throw invalid('机器不在线，无法检查', '显示的是上一次观察到的版本。');
      runtime.inspectedAt = NOW; return { toolFound: true, version: runtime.version };
    }),
    setRuntimeShare: (runtimeId, spaceId, on) => write(() => {
      const runtime = db.runtimes.find(r => r.id === runtimeId), machine = db.machines.find(m => m.id === runtime.machineId);
      if (on && !machine.spaceIds.includes(spaceId)) throw invalid('先把机器关联到这个空间', `在“机器”里把 ${machine.name} 关联到该空间，再共享 Runtime。`);
      runtime.shareSpaceIds = runtime.shareSpaceIds.filter(s => s !== spaceId); if (on) runtime.shareSpaceIds.push(spaceId); return {};
    }),
    setRuntimeBlocked: (runtimeId, on) => write(() => { const r = db.runtimes.find(x => x.id === runtimeId); r.blockedSpaceIds = r.blockedSpaceIds.filter(s => s !== settings.spaceId); if (on) r.blockedSpaceIds.push(settings.spaceId); return {}; }),

    // ---- agents ---------------------------------------------------------
    agents: () => read(() => (empty() ? [] : db.agents.filter(agentVisible).map(agentView))),
    agentVersions: agentId => read(() => db.agents.find(a => a.id === agentId).versions.slice().reverse()),
    createAgent: definition => write(() => {
      const agent = { id: id('agent'), spaceId: settings.spaceId, ownerId: db.me, version: 1, registered: true, blockedSpaceIds: [], access: { mode: 'private', memberIds: [] }, definition: clone(definition), versions: [{ version: 1, createdAt: NOW, contentHash: 'sha256:0d4e…71aa', definition: clone(definition) }] };
      db.agents.push(agent); return agentView(agent);
    }),
    updateAgent: (agentId, expectedVersion, definition) => write(() => {
      const agent = db.agents.find(a => a.id === agentId);
      if (agent.version !== expectedVersion) throw invalid(`这个 Agent 已更新到 v${agent.version}`, '刷新后在最新版本上修改，不会覆盖别人的更新。');
      agent.version++; agent.definition = clone(definition);
      agent.versions.push({ version: agent.version, createdAt: NOW, contentHash: `sha256:${(0x7a0 + agent.version * 131).toString(16)}…${(0x1c4 + agent.version * 57).toString(16)}`, definition: clone(definition) });
      return agentView(agent);
    }),
    setAgentRegistered: (agentId, on) => write(() => { db.agents.find(a => a.id === agentId).registered = on; return {}; }),
    setAgentAccess: (agentId, mode, memberIds) => write(() => { db.agents.find(a => a.id === agentId).access = { mode, memberIds: mode === 'members' ? memberIds : [] }; return {}; }),
    setAgentBlocked: (agentId, on) => write(() => { const a = db.agents.find(x => x.id === agentId); a.blockedSpaceIds = a.blockedSpaceIds.filter(s => s !== settings.spaceId); if (on) a.blockedSpaceIds.push(settings.spaceId); return {}; }),

    // ---- repositories ------------------------------------------------------
    repositories: () => read(() => (empty() ? [] : db.repositories.filter(r => r.spaceId === settings.spaceId).map(repositoryView))),
    createRepository: (name, aliases) => write(() => { const repo = { id: id('repo'), spaceId: settings.spaceId, name, ownerId: db.me, registered: true, aliases }; db.repositories.push(repo); return repositoryView(repo); }),
    renameRepository: (repoId, name) => write(() => { db.repositories.find(r => r.id === repoId).name = name; return {}; }),
    addAlias: (repoId, alias) => write(() => {
      const value = alias.trim();
      if (!/^(https?:\/\/|ssh:\/\/|git:\/\/|[\w.-]+@[\w.-]+:)/.test(value)) throw invalid('这不是可识别的 Git 地址', '支持 HTTP(S)、ssh、git 地址和 git@host:path 形式。');
      if (db.repositories.some(r => r.spaceId === settings.spaceId && r.aliases.includes(value))) throw invalid('这个地址已经是某个仓库的别名', '同一空间里一个地址只能对应一个仓库。');
      db.repositories.find(r => r.id === repoId).aliases.push(value); return {};
    }),
    removeAlias: (repoId, alias) => write(() => { const repo = db.repositories.find(r => r.id === repoId); repo.aliases = repo.aliases.filter(a => a !== alias); return {}; }),
    setRepositoryRegistered: (repoId, on) => write(() => { db.repositories.find(r => r.id === repoId).registered = on; return {}; }),

    // ---- selections ----------------------------------------------------------
    selections: () => read(() => (empty() ? [] : db.selections.filter(s => s.spaceId === settings.spaceId))),
    saveSelection: selection => write(() => {
      db.selections = db.selections.filter(s => !(s.spaceId === settings.spaceId && s.repositoryId === selection.repositoryId));
      db.selections.push({ spaceId: settings.spaceId, ...selection }); return {};
    }),
    clearSelection: repositoryId => write(() => { db.selections = db.selections.filter(s => !(s.spaceId === settings.spaceId && s.repositoryId === repositoryId)); return {}; }),
    resolve: ({ repositoryId = null, agentId = '', runtimeId = '' }) => read(() => {
      const mine = db.selections.filter(s => s.spaceId === settings.spaceId);
      const repoChoice = repositoryId ? mine.find(s => s.repositoryId === repositoryId) : null, spaceChoice = mine.find(s => s.repositoryId === null);
      const decided = agentId ? { agentId, source: '本次显式指定' } : repoChoice ? { ...repoChoice, source: '我的仓库选择' } : spaceChoice ? { ...spaceChoice, source: '我的空间默认' } : null;
      if (!decided) throw invalid('没有确定的 Agent', '保存空间默认或仓库选择，或者本次显式指定 Agent。');
      const agent = db.agents.find(a => a.id === decided.agentId), view = agent && agentView(agent);
      if (!view?.invocable) throw invalid(`${decided.source}里的 Agent 当前不可调用`, `${view ? `${view.name} · ${!view.registered ? '已取消登记' : view.blocked ? '已在此空间停用' : '所属人已离开空间'}` : decided.agentId}。修改这条选择，或本次显式指定 Agent；不会自动换成其他选择。`);
      if (agent.definition.repositoryId && agent.definition.repositoryId !== repositoryId) throw invalid('这个 Agent 只用于指定仓库', '选择与它匹配的仓库，或换一个适用于整个空间的 Agent。');
      const sameAgent = s => s && s.agentId === agent.id && s.runtimeId;
      const runtimeDecided = runtimeId ? { id: runtimeId, source: '本次显式指定' } : sameAgent(repoChoice) ? { id: repoChoice.runtimeId, source: '仓库选择里的 Runtime' }
        : sameAgent(spaceChoice) ? { id: spaceChoice.runtimeId, source: '空间默认里的 Runtime' } : agent.definition.runtimeId ? { id: agent.definition.runtimeId, source: 'Agent 定义' } : null;
      if (!runtimeDecided) throw invalid('没有确定的 Runtime', '在 Agent 定义或个人选择中指定一个 Runtime。');
      const runtime = db.runtimes.find(r => r.id === runtimeDecided.id);
      const verdict = runtime ? eligibility(runtime) : { eligible: false, reason: '原 Runtime 不可见', hint: '' };
      if (!verdict.eligible) throw invalid(`Runtime 不可用：${verdict.reason}`, verdict.hint);
      if (agent.definition.flavor && agent.definition.flavor !== runtime.flavor) throw invalid('Runtime 类型与 Agent 不匹配', `Agent 需要 ${flavorLabels[agent.definition.flavor]}，所选 Runtime 是 ${flavorLabels[runtime.flavor]}。`);
      return { agent: { name: agent.definition.name, version: agent.version }, agentSource: decided.source, runtime: { name: runtime.name, flavor: runtime.flavor }, runtimeSource: runtimeDecided.source,
        machine: db.machines.find(m => m.id === runtime.machineId).name, fingerprint: `sha256:${(agent.version * 4099 + runtime.name.length * 131).toString(16)}…e19c` };
    }),

    peers: () => read(() => members().filter(m => m.userId !== db.me).map(m => ({ ...person(m.userId), role: m.role }))),
  };

  return {
    api, settings,
    get user() { return clone(me()); },
    get firstRun() { return db.firstRun; },
    space: () => clone(space()),
    role: () => myRole(),
    isManager: () => manager(),
    reset() { db = seed(); Object.assign(settings, { scenario: 'normal', role: 'owner', spaceId: SPACE, refreshing: false }); },
  };
}
