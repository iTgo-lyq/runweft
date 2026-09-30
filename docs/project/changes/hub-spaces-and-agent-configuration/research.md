# 现有身份边界与 Multica 参考

> 调查：2026-09-30。方法：只读代码与官方文档，未运行 Multica，未对运行中 Hub 实施越权实验。

## 证据版本

- 本地 Runweft 调查期间，独立的 HAPI 默认中文 Change 已完成到提交 `b93002a`；本文引用的身份/资源实现未由本 Change 修改。
- 当前 HAPI 子模块：`3ac8b08b2aead13e9eaae459de62d9a5d5df7395`。
- Multica 固定源码：[`43b0571f992567a919c7f1f699ff160922594b94`](https://github.com/multica-ai/multica/tree/43b0571f992567a919c7f1f699ff160922594b94)。研究 checkout 位于忽略的 `.dev-smoke/multica-hub-design/source`，不加入项目依赖。
- 先前 `.dev-smoke/multica-67d61a2` 是部分研究文件，不是独立 Git checkout；没有将父仓库的 revision 误写为 Multica revision。本次上游 API 遇到限流，改用只读 Git checkout 获取固定版本。

## Runweft 当前是否存在空间

**结论：没有面向用户的空间模型。** 已有 HAPI namespace 分区、本机 workspace 目录绑定，以及全局/项目 Agent 来源；三者都不是空间成员和用户授权体系。

| 当前事实 | 代码证据 | 对新目标的影响 |
| --- | --- | --- |
| access token 可拆为基础 token 与 namespace 后缀；默认 namespace 为 default | [parseAccessToken](../../../../hapi/hub/src/utils/accessToken.ts) | namespace 的选择没有经过空间成员资格检查 |
| token 登录校验同一基础 token，JWT 的 uid 来自服务级 ownerId；Telegram 登录也沿该 ownerId | [HAPI auth](../../../../hapi/hub/src/web/routes/auth.ts)、[ownerId](../../../../hapi/hub/src/config/ownerId.ts) | 多人共用 token 不会成为多个可区分的配置所有者；不是说 HAPI 没有任何 users 表 |
| Runweft 读取 uid/ns，但资源服务只获得 ns | [API](../../../../src/api.ts)、[ResourceService](../../../../src/resources/service.ts) | 同 namespace 资源登记没有按实际用户/owner 区分修改权 |
| 机器、runtime 以 namespace 限定查询；runtime 按 machine/flavor 定位 | [ResourceStore](../../../../src/resources/store.ts)、[资源规格](../../specs/resources/scope/spec.md) | 可复用中心资源库，但需要增加所有者、空间和共享授权 |
| 全局/项目定义在客户端文件，绑定在 client.sqlite | [Agent 定义](../../../../src/agents/definitions.ts)、[绑定](../../../../src/agents/bindings.ts) | Hub 没有权威 Agent 目录；单加页面无法满足集中配置 |
| workspace 绑定记录真实目录和 repositoryRoot | [workspace](../../../../src/workspaces.ts) | 不是跨 clone 的 Git 仓库身份，也没有每个用户的仓库配置 |
| 任务路由使用 namespace 与父宿主信息，总览跨该 namespace 的父会话 | [任务 API](../../../../src/tasks/api.ts) | 父会话权限与用户/成员权限不是同一个层次；需保留原生身份并增加账户维度 |
| 未处理的 HTTP 路由及所有 upgrade 转发至 HAPI | [网关](../../../../src/proxy.ts) | 不能只保护 Runweft 自有页面或接口 |
| Runner Socket 校验基础 token；终端 Socket 校验 uid/ns JWT | [Socket 认证](../../../../hapi/hub/src/socket/server.ts) | 新 Runner 凭据与长连接授权需要衔接，不能分发 HAPI 根 token 后宣称对象隔离 |
| 原生 session 与 artifact 接口主要按 namespace 取数 | [会话](../../../../hapi/hub/src/web/routes/sessions.ts)、[附件](../../../../hapi/hub/src/web/routes/artifacts.ts) | 原生 UI/成果回收也必须遵守实际用户和对象授权 |

这些是源码证据，不是对已部署系统做攻击验证；当前版本适用的单信任域假设与新多用户要求不同。

## Multica 的空间与成员

[官方空间文档](https://multica.ai/docs/workspaces)把成员、Agent、runtime、项目与历史归于空间；一个账户可以加入多个空间。[角色文档](https://multica.ai/docs/members-roles)区分 owner/admin/member，角色管理不替代 Agent 调用授权。

固定源码的 [workspace middleware](https://github.com/multica-ai/multica/blob/43b0571f992567a919c7f1f699ff160922594b94/server/internal/middleware/workspace.go)在解析空间 ID/slug 后校验 membership，注入成员上下文；任务凭据的空间绑定不能被调用方换 header 扩大。

**采用建议：** 用显式 Space 和 Membership 表达用户关系；不要把 Git worktree 叫作权限空间，也不要让调用方拼接 namespace 就取得空间资格。

## Multica runtime 的 public/private

[官方 runtime 文档](https://multica.ai/docs/daemon-runtimes#private-and-public-runtimes)中的 public 是向同一 workspace 成员开放选择 runtime，不是向互联网匿名开放。私有 runtime 默认只允许其 owner 绑定 Agent，空间 owner/admin 不例外；共享由 runtime owner 决定。

固定源码 [runtime.go](https://github.com/multica-ai/multica/blob/43b0571f992567a919c7f1f699ff160922594b94/server/internal/handler/runtime.go#L864)的 `canUseRuntimeForAgent` 与 `canSetRuntimeVisibility` 分别实现使用和分享判断；管理员能见到治理概要不等于能读取运行数据或控制机器。

**采用建议：** 同样区分使用、编辑、分享和机器控制，不把“管理员”解释成可以消耗所有成员的个人模型资源。保留 Runweft 原来的机器/runtime 分离，不照搬全部 runtime profile 或 daemon 执行框架。

## Multica Agent 的调用范围

[官方 Agent 文档](https://multica.ai/docs/agents-create#access)提供仅自己、整个空间、指定成员三种调用范围；只有 Agent owner 可改变调用范围。空间 owner/admin 可管理其他普通配置，但不因此获得调用权。

源码 [agent.go](https://github.com/multica-ai/multica/blob/43b0571f992567a919c7f1f699ff160922594b94/server/internal/handler/agent.go#L102)表明当前主要授权字段已是 `permission_mode` 和 invocation targets，旧 `visibility` 只是兼容字段。[agent_invocation.go](https://github.com/multica-ai/multica/blob/43b0571f992567a919c7f1f699ff160922594b94/server/internal/service/agent_invocation.go)对用户 owner、workspace/member targets 分别判定。

需要区分另一层：[agent_ready.go](https://github.com/multica-ai/multica/blob/43b0571f992567a919c7f1f699ff160922594b94/server/internal/service/agent_ready.go#L155)判断私有 runtime 时比较的是 Agent owner 与 runtime owner。**源码推断：** 同 owner 的 Agent 可以被分享给其他成员调用，并不等于这些成员能直接绑定该私有 runtime。本次没有实测其所有触发路径，不能宣称一个字段即可概括全部共享语义。

**Runweft 草案差异：** 私有配置是否允许空间管理员编辑需要用户选择；建议共享 Agent 的调用还要求调用者被 runtime 所有者允许，避免隐式扩大执行范围。这两项是 Runweft 提案，不冒充 Multica 现状。

## Multica 账户与 CLI 授权

[登录文档](https://multica.ai/docs/auth-setup)采用邮箱验证码，可选 Google，支持邮件服务和注册限制；邀请与创建账户、加入空间分别处理。没有邮件服务时的日志验证码是开发用行为，不作为 Runweft 正式部署方案。

[凭据文档](https://multica.ai/docs/auth-tokens)区分浏览器会话、用户 PAT 与任务凭据。CLI 可以经浏览器完成登录，用户 PAT 按账户访问空间，任务凭据绑定执行上下文；日志退出与服务端撤销并非同一动作。对应 [auth middleware](https://github.com/multica-ai/multica/blob/43b0571f992567a919c7f1f699ff160922594b94/server/internal/middleware/auth.go)校验凭据并设置实际身份，再由空间/对象规则继续授权。

**采用建议：** 复用“账户登录 → CLI 获得本人授权 → 空间与资源检查”的交互；不要求用户学习 HAPI token，不把用户级/Hub 根凭据放进 subagent prompt。具体登录提供方和邮件依赖需在部署方案中落实。

## 仓库关联与保留边界

[项目资源文档](https://multica.ai/docs/project-resources)将 Git 仓库作为中心资源关联项目，同时单独记录机器上的目录。Runweft 可参考中心关联，但不引入 issue/project 管理，也不改变从主仓库派生、启动前准备、保留 worktree 和主 Agent 合码的既定流程。

[安全文档](https://multica.ai/docs/security-model)明确执行进程仍受 daemon 所在 OS 用户的能力约束。**产品约束：** Hub 对象权限可以阻止 API 越权，但不承诺共享同一 OS 用户的执行进程彼此隔离；Runweft 保持原生默认权限，不照搬 Multica 的审批绕过设置。

## 结论与技术验证范围

当前可直接确定产品需要账户、成员、资源 owner、集中配置及仓库身份；不能把这些说成现有 namespace 已提供。既有 HAPI 执行、工作区和成果能力可继续使用，但多用户访问的连接方式尚未验证。

后续 Technical 应针对原生 HTTP、SSE、Socket.IO/终端、Runner 注册与回报分别列出当前鉴权入口和最小缺口，决定网关封装是否足够。若必须补 HAPI 通用认证入口，按独立仓库维护；不将其扩大为重写 runtime launcher。此判断须先完成小范围验证，再排实现计划。
