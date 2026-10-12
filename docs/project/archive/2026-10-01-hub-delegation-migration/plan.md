# Hub 委派接入与迁移实施计划

> 来源：[Requirement](requirement.md)
> 技术方案：[Technical](technical.md)
> 执行模式：串行、逐任务提交；按既有授权实施，先完成当前工作区 iclaude Plan 评审。

## 交付目标

同一 Runweft CLI/MCP 必连 Hub，以用户/空间的中心 Agent 委派，完整复用工作区、会话和成果链路；旧试验历史可直接清理，集中配置切换不保留迁移框架。

### T1 可信协调器到 HAPI 的桥接

- 交付：受控 native client、任务 dispatch intent/object binding、文件 permit/read grant 与原生 namespace 映射；复用现有 AccessStore/NativeTransport。
- 验收：共享 runtime 能接受任务准备/派发但公开用户不能任意操作目标机器；Runner 自举和实际 spawn RPC 使用任务 owner；输入与输出文件归发起人，机器 owner 不得读取他人结果；丢回执不重复 spawn。
- 验证：聚焦授权/幂等/实际 RPC 测试及真实 HAPI/Runner workspace、文件传输 smoke，确保不用新增 runtime。

### T2 中心 Task/Round 接受与持续执行

- 交付：TaskCoordinator/Store 的中心策略注入，owner/space/repository、每轮不可变配置、服务端解析、next/steer/停止/结果权限和撤权处理；独立 WorkspacePreparations 同步使用中心解析与归属。
- 验收：客户端快照不能伪造；接受后编辑不改变排队内容，next 用当前内容且不能换已有环境目标；不兼容启动参数重建历史；任务归属提交无半成状态；跨空间递归拒绝。
- 验证：双用户/空间、配置并发、资源/成员撤销、启动未知和重启、输入/输出/代码传输、wait 取消与历史读取；保留现有协调器回归。

### T3 Web 凭据交接与明确连接记录

- 交付：begin/complete/取消、Web 身份与空间确认、加密交接和 0600 本机存储、origin 隔离与连接诊断。
- 验收：模型输出无秘密、Hub 不持久明文、过期/重复/撤权/并发可操作；换设备能经浏览器交给 Agent，用户无需手敲 CLI。
- 验证：API/编译 CLI、真实密码学交互及 Playwright；不修改用户已有配置。

### T4 CLI/MCP 与领域消费入口接入

- 交付：两宿主任务、中心 Agent/resource/Repository、附件与远端诊断的 Hub 消费实现，共用保存的身份连接；在独立组合网关中端到端验证。
- 验收：无 Hub/身份/空间时明确失败；正确 cwd 导入工程配置，远端 worktree 启动前准备；工具行为保持原生 Codex 风格；read/wait/注入/停止与结果下载归属一致。
- 验证：Codex/Claude 元数据、子会话拒绝、编译 CLI/MCP 双身份与真实两 runtime。中间提交保持原默认接线，T5 统一切换全部消费者和服务，避免默认客户端/服务失配。

### T5 默认服务和 Runner 统一切换

- 交付：serve 统一安全网关与 T4 消费端，业务 URL 与部署角色分离、持久机器凭据启动 Runner、status/doctor/paths；旧 YAML 权威和 root token 入口退出默认流程。
- 验收：首次服务可领取身份而无自动机器权限；root token 对公网拒绝；本地和远端 Hub 使用同一身份连接；机器登记不创建 runtime/Agent；全部启动扫描隔离未迁移记录。
- 验证：真实 HAPI Hub/Runner 生命周期、重启/失效凭据/退出清理、旧路由无旁路、配置和编译 CLI/MCP 默认路径回归。

### T6 历史清理与实现简化

- 交付：范围清楚的旧试验数据清理入口、重新接入说明；删除仅服务历史迁移/兼容和假设扩展的过度封装。
- 验收：按用户最新决定不实现 YAML 导入、身份映射、多库 journal、迁移继续或回退；不修改产品管理目录以外的仓库/worktree 和用户模型配置。
- 验证：专用数据根停服清理、首次启动与重新登记委派；基础回归证明简化没有破坏授权、幂等和 HAPI 复用。

### T7 组合自动验收

- 交付：两宿主 × 两 runtime、本地共享/独立/同机远端、中心权限、附件/代码/历史恢复、历史清理和无秘密接入的需求矩阵与证据。
- 验收：全部本地能力由 agent 自动完成；真实物理远端缺口单列；无在线部署或用户配置副作用。
- 验证：bun run typecheck、bun run test、bun run build、真实 smoke、Playwright；通过后同步 Specs，独立归档提交。全产品后台与四平台发行仍由阶段 6/7 交付。

## 执行顺序

按原任务依赖及既有 Plan 顺序迁入；未重新安排历史执行。

| 任务 | 前置任务 |
| --- | --- |
| T1 | 无 |
| T2 | T1 |
| T3 | T2 |
| T4 | T1、T2、T3 |
| T5 | T4 |
| T6 | T4、T5 |
| T7 | T1、T2、T3、T4、T5、T6 |
