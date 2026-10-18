// Fictional prototype data. Edits live only in memory and reset on refresh.
export function seed() {
  return {
    user: { name: '林舟', role: '空间所有者' }, spaces: ['产品协作', '个人实验'],
    tasks: [
      ['t1', '审阅身份切换与权限边界', 'attention', '代码审阅助手', 'Codex', '需要确认敏感文件的访问权限', '刚刚', '身份与权限', 3],
      ['t2', '优化 Hub 任务列表交互', 'running', '前端协作助手', 'Claude Code', '正在检查移动端布局与键盘操作', '2 分钟前', 'Runweft Hub', 2],
      ['t3', '补齐资源离线状态提示', 'running', '代码审阅助手', 'Codex', '正在核对机器与 Runtime 的状态映射', '8 分钟前', 'Runweft Hub', 1],
      ['t4', '梳理仓库接入文档', 'completed', '文档整理助手', 'Claude Code', '已整理接入步骤与常见问题', '23 分钟前', '接入文档', 2],
      ['t5', '验证成员邀请流程', 'completed', '代码审阅助手', 'Codex', '邀请创建、接受与撤销流程已验证', '45 分钟前', '身份与权限', 1],
      ['t6', '检查 Agent 配置一致性', 'completed', '代码审阅助手', 'Codex', '配置与历史快照一致，无需处理', '1 小时前', 'Agent 配置', 1],
      ['t7', '分析构建失败原因', 'failed', '前端协作助手', 'Claude Code', '依赖下载中断，等待检查网络后续接', '2 小时前', 'Runweft Hub', 2],
      ['t8', '补充测试覆盖与验收记录', 'completed', '文档整理助手', 'Claude Code', '已补充 12 项交互检查与验证记录', '3 小时前', '测试与验收', 2]
    ].map(([id, title, status, agent, runtime, summary, time, project, rounds]) => ({ id, title, status, agent, runtime, summary, time, project, rounds })),
    machines: [
      { id: 'm1', name: 'Studio 工作站', description: '主要开发环境', type: 'Mac mini · macOS', status: 'online', owner: '林舟', runtime: '2 个 Runtime', icon: 'monitor' },
      { id: 'm2', name: 'Build Server', description: '构建与验证环境', type: 'Ubuntu · Linux', status: 'online', owner: '陈雨', runtime: '1 个 Runtime', icon: 'server' },
      { id: 'm3', name: 'MacBook Pro', description: '移动开发环境', type: 'MacBook Pro · macOS', status: 'offline', owner: '林舟', runtime: '1 个 Runtime', icon: 'laptop' }
    ],
    runtimes: [
      { id: 'r1', name: 'Studio Codex', description: 'Codex', machine: 'Studio 工作站', status: 'online', version: '0.132.0', owner: '林舟', icon: 'code' },
      { id: 'r2', name: 'Studio Claude', description: 'Claude Code', machine: 'Studio 工作站', status: 'online', version: '2.1.0', owner: '林舟', icon: 'sparkles' },
      { id: 'r3', name: 'Build Codex', description: 'Codex', machine: 'Build Server', status: 'online', version: '0.132.0', owner: '陈雨', icon: 'code' },
      { id: 'r4', name: 'Portable Claude', description: 'Claude Code', machine: 'MacBook Pro', status: 'offline', version: '2.1.0', owner: '林舟', icon: 'sparkles' }
    ],
    agents: [
      { id: 'a1', name: '代码审阅助手', description: '检查代码差异、识别风险，给出可执行的修改建议。', runtime: 'Studio Codex', tag: '代码质量', version: 'v3', owner: '林舟', icon: 'shield', shared: true },
      { id: 'a2', name: '前端协作助手', description: '完善页面交互、布局与可访问性，让体验更进一步。', runtime: 'Studio Claude', tag: '前端开发', version: 'v2', owner: '林舟', icon: 'layout', shared: false },
      { id: 'a3', name: '文档整理助手', description: '梳理上下文与使用流程，让文档清晰、准确、好维护。', runtime: 'Studio Claude', tag: '文档维护', version: 'v1', owner: '陈雨', icon: 'file', shared: true }
    ],
    repositories: [
      { id: 'p1', name: 'Runweft', description: 'Agent 协作与委派工具', url: 'example.com/studio/runweft', branch: 'develop', checkouts: 2, owner: '林舟', icon: 'git' },
      { id: 'p2', name: 'Design System', description: '工作台基础组件与设计规范', url: 'example.com/studio/design-system', branch: 'main', checkouts: 1, owner: '陈雨', icon: 'git' }
    ],
    members: [
      { id: 'u1', name: '林舟', initial: '林', email: 'linzhou@example.com', role: '所有者', color: 'blue' },
      { id: 'u2', name: '陈雨', initial: '陈', email: 'chenyu@example.com', role: '管理员', color: 'purple' },
      { id: 'u3', name: '许宁', initial: '许', email: 'xuning@example.com', role: '成员', color: 'green' }
    ], invitations: [], selection: { agent: '代码审阅助手', runtime: '跟随 Agent 配置' }
  };
}
