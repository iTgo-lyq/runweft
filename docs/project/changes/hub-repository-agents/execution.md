# 仓库关联与中心 Agent 执行概况

## Plan 评审

- 当前工作区 iclaude 只读评审，无委派/修改/测试。首次会话 `0dbf2e87-ed38-4caa-a286-e8722f50db30` 在结论前遇到 API 503，不计为有效结果；聚焦重试 `3e521617-7826-4a58-a8d9-9cdb3782bccd` 成功，约 260 秒，结果 `.dev-smoke/reviews/hub-repository-agents/retry-review.json`。
- 结论：架构可实施。主 agent 采纳空间默认的 SQLite NULL 唯一性修正、成员退出同事务删除 checkout、只有选中层的失效阻止解析、能力按交付声明、固定规范字段顺序以及原生映射共用。
- 独立判断：SSH 摘要一致性须验证，但不采用“必须传明文用户名”的建议；共用固定 UTF-8 SHA-256 无盐规范化函数及路径等价测试即可，客户端描述不授予权限。Plan 状态沿项目流程使用“待执行”，不是评审建议的“已确认”。
- 主 agent 补充请求回执查询、服务端重算规范键、Hub 与原生 repositoryId 分层和 Git insteadOf 实验。既有授权覆盖细节与本地验收，无新增人工门禁。

## T1 Repository、checkout 与 Git 观察

- 实现：`state.sqlite` v13 增加 Repository、空间内唯一规范别名、本人 checkout；Git commonDir 保持同 clone/worktree 关联，跨 clone 用显式别名匹配。支持多 remote 歧义、指定 remote、无 remote 显式绑定及 remote 集合漂移；观察只读、不访问网络、不作为执行授权。
- 接口：独立 createConfigurationGateway 与同一 `hub repository` CLI，包含创建请求回执、登记、别名和本人 checkout；共用 HubClient 认证/脱敏/能力探测，既有资源客户端接口保持。仅声明 hubRepositories，不提前声明 Agent 解析可用。
- 权限：当前空间成员可见目录，owner/admin 管理；本人机器上的 checkout 只对本人返回。成员退出同事务移除其 checkout；URL、查询参数或自报字段不能改变身份/权限。
- 验证：真实 Git clone/worktree、insteadOf、本机先脱敏、SCP/SSH 用户/路径区别、跨路径规范键、HTTP 权限、跨进程编译 CLI 创建重放及无隐式原生调用。typecheck/build 通过；聚焦 35 pass，原资源客户端和凭据回归通过。全仓首次发现两处旧迁移夹具未删除新表；修正后相关 12 项通过，完整复跑 216 pass、0 fail、4436 expectations、32 文件通过（`t1-tests-final.log`）。
- 证据：`.dev-smoke/reviews/hub-repository-agents/t1-*.log`；HAPI 子模块无修改。未启动模型或默认新服务，原生 Runner 组合验收在 T4。
- Commit：`hub-repository-agents T1: centralize repository aliases and private checkout association`

## T2 中心 Agent 版本、共享与治理

- 实现：v14 增量表保存稳定 Agent、不可变定义版本、成员授权与独立治理禁用。完整 definition 条件更新、创建请求去重和回执不会重写后续版本、登记或分享；同名不同 owner 保持独立 ID。
- 授权：仅 owner 改写/登记/分享/读取历史；分享者可读当前内容；非 owner 管理员只见显式治理字段，不含 instructions、model、runtime 或内容摘要。当前空间角色实时查询，降级立即失去治理权限。
- 退出：删除成员时 FK 同事务清除对其显式分享；其本人 Agent 撤回所有共享为 private，保留内容版本、登记与治理事实；重入不自动恢复旧分享。runtime 新绑定同步复用资源授权，原绑定失效仍允许修改指令，解析权限交集留给 T3。
- 接口：独立 Hub `/agents` 与 `hub agent` 管理命令；JSON 文件仅本次完整定义输入。管理能力 hubAgentDefinitions:1 独立可用，完整解析 hubAgents:1 尚未声明。
- 验证：typecheck/build 通过；全仓 223 pass、0 fail、4547 expectations、33 文件（`t2-tests.log`）。编译 CLI 验证并发创建和版本 CAS、分享/治理/历史权限；API 覆盖私有摘要、严格字段/体积、角色撤销、成员退出/重入、v13 升级和旧 Agent 路径回归。共享客户端内部认证方法与业务 access 同名冲突在类型检查中发现，已改为 userJwt 并经真实 HTTP/CLI 回归。
- 证据：`.dev-smoke/reviews/hub-repository-agents/t2-*.log`。无模型调用、用户配置或 HAPI 源码更改。
- Commit：`hub-repository-agents T2: version owned Agent definitions and enforce sharing governance`

## T3 个人选择、授权交集与固定解析

- 实现：v15 个人选择按 user/space/COALESCE(repositoryId, '') 唯一；成员移除在同事务通过 FK 删除选择。显式 Agent、仓库选择、空间默认按固定顺序；runtime override 仅用于同一 Agent，选中项失效不回退。
- 解析：先检查中心 Agent 当前权限/仓库/版本，再复用 HubResourceService 的当前 native 探测。RequestLease 在探测期间重查内容、决定层选择和授权；版本变化返回 agent_configuration_changed，撤销返回当前具体原因。输出固定内容摘要/版本、来源、裁剪目标与原生参数，不创建 Task/session，不代管模型认证。
- 复用：Codex/Claude launchOptions 纯映射供旧和新路径共用；继续移除 Runweft MCP、使用原生权限默认值。完整解析能力 hubAgents:1 正式声明，CLI select/selection/unselect/resolve 与管理共用 Hub 身份；不接受他人的 userId 或客户端伪造快照。
- 消费者边界：同次异步解析使用 validateSelection；已被服务端接受的任务保留原内容/目标，在派发时复核当前 invocable/usable，而不因编辑偷偷重定向。任务接收、新轮次和持久快照由阶段 5 实装。
- 验证：typecheck/build 通过；全仓 230 pass、0 fail、4724 expectations、34 文件（`t3-tests.log`）。编译 CLI 并发 PUT 空间默认始终一行；覆盖确定选择、失效不回退、类型匹配、两用户选择隔离、私有 runtime/Agent 权限交集与模型未调用。7 种探测期间变更均拒绝过时结果；固定快照和 resolvedVersion 不受探测时间影响。
- 证据：`.dev-smoke/reviews/hub-repository-agents/t3-*.log`。旧 Agent 原生映射测试保留并通过；真实 Runner/组合 smoke 在 T4。
- Commit：`hub-repository-agents T3: resolve personal choices with fixed Agent snapshots and current access`

## T4 组合验收与下游交付

- 新增 `test:hub-configuration` 与可编译 smoke，组合完整领域网关、实际 CLI、未改造 HAPI/Runner、原生 Codex/Claude 版本探测和真实 Git clone/worktree。6 组通过，证据 `.dev-smoke/hub-configuration-pF0Xrp/evidence.json`；smoke 编译与执行日志 `t4-native.log`。
- 交付 [消费者契约](consumer-contract.md) 和 [需求验收矩阵](acceptance.md)。typecheck 与编译 smoke 通过；生产代码沿 T3 已通过 230 项全仓测试及构建，此任务未修改生产代码，不重复无变化检查。结构/差异校验通过。
- 按既有授权自动验收通过。仍未切换默认服务、发起模型/任务或添加 Web 配置页面；明确归后续领域。未改用户配置或在线 Hub，测试进程正常清理。
- Commit：`hub-repository-agents T4: verify central configuration against native Runner and real Git`
