# 项目文档

基础入口的安装、配置、部署与数据维护见[使用说明](usage.md)；完整协作功能仍按下列 Change 推进。

[统一 CLI 与部署](project/archive/2026-09-29-unified-cli-and-deployment/execution.md#t5-实际平台与整体验收)已验收归档，macOS 与 Linux 的 arm64/x64 已通过真实安装和服务验证；[HAPI 执行契约](project/archive/2026-09-29-hapi-subagent-foundation/execution.md#t4-配套构建与整体验收)已完成两种 runtime 的本地真实执行验收，[宿主 MCP 适配](project/archive/2026-09-29-host-mcp-adapter/execution.md#t4-配套构建与宿主整体验收)通过真实安装、身份及子工具禁用验收，[全局资源登记](project/archive/2026-09-29-execution-resource-registry/execution.md#t4-配套注册整体验收)通过配套 CLI、原生探测、离线与恢复验收。[Agent 定义](project/archive/2026-09-29-agent-definition/execution.md#t3-配套定义验收与使用说明)已通过作用域、个人绑定与真实 Hub/Runner 解析验收。[本地共享委派](project/archive/2026-09-29-delegation-lifecycle/acceptance.md)已通过两宿主 × 两 runtime 的 local/同机 Hub 真实协作、续接、控制与候选包安装验收。[本地独立工作区](project/archive/2026-09-29-local-workspace-execution/acceptance.md)已通过真实 CLI/MCP 准备、封存、续接、清理和候选安装验收。[任务附件交付](project/archive/2026-09-29-task-artifact-delivery/acceptance.md)已通过两宿主 × 两 runtime 的 local/同机 Hub 输入、成果、补交、续接及候选安装验收。远端工作区准备已进入实现，当前已完成固定基线导出、目标共享缓存导入与独立 worktree 准备切片；完整协作产品尚未交付。本地验收由 agent 自动完成，真实远端验收单独记录。先读[项目能力边界与讨论地图](project/architecture.md)，查看模块分工和 Change 依赖。

实现以当前 HAPI 为第一依据，Runweft 尽量只做上层流程封装与 MCP；旧工程技术方案不直接沿用。

当前整体方案已由 iclaude 辅助评审，主 agent 的[复核与采纳记录](project/architecture-review.md)保留事实修正和前置验证安排。

最终目标是交付完整可运行版本，不以 MVP 或演示链路结项。当前十一个领域 Change 加一个集成与发布 Change，按[六阶段交付结构](project/delivery-structure.md)推进；完整交付标准与尚需落实的技术架构见[项目架构](project/architecture.md#完整版本的交付目标)。

原初始 Change 已按独立交付结果拆分；各 Requirement 内声明前置能力与验收边界，已确认结论继续有效：

| Change | 需求入口 | 方案与依据 |
| --- | --- | --- |
| HAPI 内置能力验证与调用封装（已归档） | [Requirement](project/archive/2026-09-29-hapi-subagent-foundation/requirement.md) | [Research](project/archive/2026-09-29-hapi-subagent-foundation/research.md) |
| 统一 CLI 与部署（已归档） | [Requirement](project/archive/2026-09-29-unified-cli-and-deployment/requirement.md) | [Design](project/archive/2026-09-29-unified-cli-and-deployment/design.md) |
| 本地共享委派与生命周期（已归档） | [Requirement](project/archive/2026-09-29-delegation-lifecycle/requirement.md) | [Technical](project/archive/2026-09-29-delegation-lifecycle/technical.md)、[Plan](project/archive/2026-09-29-delegation-lifecycle/plan.md)、[验收](project/archive/2026-09-29-delegation-lifecycle/acceptance.md) |
| 任务附件交付（已归档） | [Requirement](project/archive/2026-09-29-task-artifact-delivery/requirement.md) | [Technical](project/archive/2026-09-29-task-artifact-delivery/technical.md)、[Plan](project/archive/2026-09-29-task-artifact-delivery/plan.md)、[契约](project/archive/2026-09-29-task-artifact-delivery/artifact-contract.md) |
| 远端工作区准备 | [Requirement](project/changes/remote-workspace-preparation/requirement.md) | [Technical](project/changes/remote-workspace-preparation/technical.md)、[Plan](project/changes/remote-workspace-preparation/plan.md)、[基线契约](project/changes/remote-workspace-preparation/baseline-contract.md)、[Research](project/changes/remote-workspace-preparation/research.md) |
| 远端代码回收 | [Requirement](project/changes/remote-result-delivery/requirement.md) | [Design](project/changes/remote-result-delivery/design.md)、[Research](project/changes/remote-result-delivery/research.md) |
| 宿主身份与 MCP 适配（已归档） | [Requirement](project/archive/2026-09-29-host-mcp-adapter/requirement.md) | [Technical](project/archive/2026-09-29-host-mcp-adapter/technical.md)、[Plan](project/archive/2026-09-29-host-mcp-adapter/plan.md)、[Research](project/archive/2026-09-29-host-mcp-adapter/research.md) |
| 本地独立工作区与公共 Git 能力（已归档） | [Requirement](project/archive/2026-09-29-local-workspace-execution/requirement.md) | [Technical](project/archive/2026-09-29-local-workspace-execution/technical.md)、[验收](project/archive/2026-09-29-local-workspace-execution/acceptance.md) |
| 全局机器与 Runtime 注册（已归档） | [Requirement](project/archive/2026-09-29-execution-resource-registry/requirement.md) | [Technical](project/archive/2026-09-29-execution-resource-registry/technical.md)、[Plan](project/archive/2026-09-29-execution-resource-registry/plan.md)、[Research](project/archive/2026-09-29-execution-resource-registry/research.md) |
| Agent 定义（已归档） | [Requirement](project/archive/2026-09-29-agent-definition/requirement.md) | [Technical](project/archive/2026-09-29-agent-definition/technical.md)、[Plan](project/archive/2026-09-29-agent-definition/plan.md)、[Research](project/archive/2026-09-29-agent-definition/research.md) |
| Subagent 看板 | [Requirement](project/changes/subagent-dashboard/requirement.md) | 简单全局状态；详情优先复用 HAPI |
| 完整版本集成与发布 | [Requirement](project/changes/integrated-release/requirement.md) | 组合验收、正式安装及完整交付证据 |

各 Change 的实际状态以其 Requirement/Technical/Plan 为准；用户已授权按顺序自主落实，每个 Change 的 Plan 经一次 iclaude 评审后执行。`design.md` 保存前期讨论，不代替正式 Technical 或 Plan。

按照 [project-workflow](../.agents/skills/project-workflow/SKILL.md)：

- `project/changes/` 保存未关闭的目标、技术方案和计划。
- 已验收 Specs：[CLI 安装](project/specs/installation/cli/spec.md)、[MCP 安装](project/specs/installation/mcp/spec.md)、[宿主 MCP](project/specs/host-mcp/spec.md)、[部署与数据](project/specs/deployment/spec.md)、[工作区绑定](project/specs/workspaces/bindings/spec.md)、[执行事实](project/specs/execution/lifecycle/spec.md)、[执行恢复](project/specs/execution/recovery/spec.md)、[执行兼容](project/specs/execution/compatibility/spec.md)、[机器](project/specs/resources/machines/spec.md)、[Runtime](project/specs/resources/runtimes/spec.md)、[资源范围](project/specs/resources/scope/spec.md)、[Agent 定义](project/specs/agents/definition/spec.md)、[来源与绑定](project/specs/agents/scope/spec.md)、[原生继承边界](project/specs/agents/inheritance/spec.md)。
- 已验收协作 Specs：[委派入口](project/specs/delegation/interface/spec.md)、[持久协调](project/specs/delegation/lifecycle/spec.md)、[业务轮次](project/specs/delegation/rounds/spec.md)、[结果与等待](project/specs/delegation/results/spec.md)、[上下文](project/specs/delegation/context/spec.md)、[本机共享工作区](project/specs/local-workspace/shared/spec.md)。
- 已验收附件 Specs：[持久文件](project/specs/artifacts/spec.md)、[启动前输入](project/specs/artifacts/inputs/spec.md)、[输出交付](project/specs/artifacts/delivery/spec.md)、[留存与清理](project/specs/artifacts/retention/spec.md)。
- 已验收独立工作区 Specs：[模式](project/specs/local-workspace/mode/spec.md)、[准备与启动](project/specs/local-workspace/readiness/spec.md)、[成果与留存](project/specs/local-workspace/finish/spec.md)、[机器 Git 生命周期](project/specs/git-workspace/lifecycle/spec.md)。
- `project/archive/` 保存已关闭 Change 的完整过程与验收记录。

新仓库不迁入旧实现、旧 Changes 或运行认证。历史证据定位到 [runweft-archive](https://github.com/iTgo-lyq/runweft-archive)。
