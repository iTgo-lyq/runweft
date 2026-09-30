# 仓库与中心 Agent 调查

> 2026-09-30；本轮只读当前代码与已保存 Multica 固定版本调查。未运行 Multica，不改变 HAPI 或用户配置。

2026-10-01 本地 Git 2.39.5 实验：专用 `.dev-smoke/repo-observation-r1zzflqm` 中 `git remote get-url --all -- origin` 会把 `insteadOf` 展开为有效地址。观察应使用该入口，并在本机规范化输出；不执行 fetch/clone 或输出原始远端地址。WHATWG URL 会消除路径 `..`，因此需在解析前检查有歧义路径，不能只检查解析后的 pathname。

## 可直接复用

- [资源归属规格](../../specs/resources/ownership/spec.md)已验收稳定 machine/runtime、空间分享、同步 usable 与原生启动授权。新 Agent 解析调用该领域的受控目标解析，不复制可用性或私有路径裁剪。
- [HAPI 工作区管理](../../../../hapi/cli/src/runner/workspaces/manager.ts)的 resolveRepository 使用真实 Git 根/commonDir/objectFormat，并把 machineId/commonDir/objectFormat 摘要作为原生 repositoryId。该 ID 有明确的本机对象用途，不能换成跨 clone 的 Hub Repository UUID；远端基线、bundle 和 worktree 仍沿原契约。
- [原 Agent 定义](../../../../src/agents/definitions.ts)保存职责、instructions、runtime、flavor、model、reasoningEffort；[解析](../../../../src/agents/client.ts)映射 Codex modelReasoningEffort / Claude effort 并固定 disabledMcpServers=['runweft']。这些业务字段和原生参数映射可复用；文件路径、slug ID、同名遮蔽、namespace 绑定不是新中心权威。
- [资源 CLI 客户端](../../../../src/hub/resources/client.ts)已有显式 Hub、Web 备份 origin/身份检查、能力预检、身份交换和错误脱敏。仓库/Agent CLI 应抽取通用连接部分，不另造认证。
- [资源组合网关](../../../../src/hub/resources/gateway.ts)可继续组合业务回调及 RequestLease；同库事务、稳定身份与当前成员关系已经提供。

## HAPI 的具体缺口

当前原生接口管理真实会话、机器、Git 文件与工作区，没有按 Runweft 用户/空间保存业务 Agent 定义、个人仓库选择或跨 clone 配置身份。原本 Runweft 的定义/绑定在 YAML 和 client.sqlite，Hub 无法仅加页面得到这些数据。新增的中心表、URL 候选规范化与配置解析正好覆盖此缺口；不增加 runtime 适配、工程 skill/MCP 仓库或新的代码传输路径。

## Multica 采用边界

父 Change [固定版本调查](../hub-spaces-and-agent-configuration/research.md)已经记录 Agent 的 owner/访问范围、runtime 分离及中心 Git 资源。采用仅自己/指定成员/空间成员与中心配置对象；继续遵循已确认差异：共享 Agent 和 runtime 权限取交集、私有 Agent 非所有者管理员仅可治理、工作区从主仓库准备、非独立配置 repo。

## 推导

Git remote 只能提供已授权空间内的匹配线索。规范化须保留 host、端口、路径大小写和传输歧义；SSH/HTTPS 等价通过明确别名，不靠网络查询或猜测托管商。不能自动把 fork 的 upstream 当项目，不能存 URL 密码或把本地路径当跨机器键。

仓库与 checkout 关联解决配置选择，不证明磁盘目录存在于 Hub，也不授予读取代码权。真实 cwd/commonDir 的本机观察与 owner/machine 绑定可以保存为配置元数据；执行时阶段 5 仍从可信宿主和原生工作区接口验证真实源。

当前需求和已交付接口足以制定方案，无需新的用户选择；完整技术与 Plan 由主 agent 按既有授权确认，实施前交 iclaude 评审。
