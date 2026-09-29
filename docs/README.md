# 项目文档

基础入口的安装、配置、部署与数据维护见[使用说明](usage.md)；完整协作功能仍按下列 Change 推进。

[统一 CLI 与部署](project/archive/2026-09-29-unified-cli-and-deployment/execution.md#t5-实际平台与整体验收)已验收归档，macOS 与 Linux 的 arm64/x64 已通过真实安装和服务验证；[HAPI 执行契约](project/archive/2026-09-29-hapi-subagent-foundation/execution.md#t4-配套构建与整体验收)已完成两种 runtime 的本地真实执行验收，[宿主 MCP 适配](project/archive/2026-09-29-host-mcp-adapter/execution.md#t4-配套构建与宿主整体验收)通过真实安装、身份及子工具禁用验收，[全局资源登记](project/archive/2026-09-29-execution-resource-registry/execution.md#t4-配套注册整体验收)通过配套 CLI、原生探测、离线与恢复验收。下一项为 Agent 定义，完整协作产品尚未交付。本地验收由 agent 自动完成，真实远端验收单独记录。先读[项目能力边界与讨论地图](project/architecture.md)，查看模块分工和 Change 依赖。

实现以当前 HAPI 为第一依据，Runweft 尽量只做上层流程封装与 MCP；旧工程技术方案不直接沿用。

当前整体方案已由 iclaude 辅助评审，主 agent 的[复核与采纳记录](project/architecture-review.md)保留事实修正和前置验证安排。

最终目标是交付完整可运行版本，不以 MVP 或演示链路结项。当前十一个领域 Change 加一个集成与发布 Change，按[六阶段交付结构](project/delivery-structure.md)推进；完整交付标准与尚需落实的技术架构见[项目架构](project/architecture.md#完整版本的交付目标)。

原初始 Change 已按独立交付结果拆分；各 Requirement 内声明前置能力与验收边界，已确认结论继续有效：

| Change | 需求入口 | 方案与依据 |
| --- | --- | --- |
| HAPI 内置能力验证与调用封装（已归档） | [Requirement](project/archive/2026-09-29-hapi-subagent-foundation/requirement.md) | [Research](project/archive/2026-09-29-hapi-subagent-foundation/research.md) |
| 统一 CLI 与部署（已归档） | [Requirement](project/archive/2026-09-29-unified-cli-and-deployment/requirement.md) | [Design](project/archive/2026-09-29-unified-cli-and-deployment/design.md) |
| 本地共享委派与生命周期 | [Requirement](project/changes/delegation-lifecycle/requirement.md) | [Design](project/changes/delegation-lifecycle/design.md) |
| 任务附件交付 | [Requirement](project/changes/task-artifact-delivery/requirement.md) | [Design](project/changes/task-artifact-delivery/design.md) |
| 远端工作区准备 | [Requirement](project/changes/remote-workspace-preparation/requirement.md) | [Design](project/changes/remote-workspace-preparation/design.md)、[Research](project/changes/remote-workspace-preparation/research.md) |
| 远端代码回收 | [Requirement](project/changes/remote-result-delivery/requirement.md) | [Design](project/changes/remote-result-delivery/design.md)、[Research](project/changes/remote-result-delivery/research.md) |
| 宿主身份与 MCP 适配（已归档） | [Requirement](project/archive/2026-09-29-host-mcp-adapter/requirement.md) | [Technical](project/archive/2026-09-29-host-mcp-adapter/technical.md)、[Plan](project/archive/2026-09-29-host-mcp-adapter/plan.md)、[Research](project/archive/2026-09-29-host-mcp-adapter/research.md) |
| 本地独立工作区与公共 Git 能力 | [Requirement](project/changes/local-workspace-execution/requirement.md) | [Design](project/changes/local-workspace-execution/design.md) |
| 全局机器与 Runtime 注册（已归档） | [Requirement](project/archive/2026-09-29-execution-resource-registry/requirement.md) | [Technical](project/archive/2026-09-29-execution-resource-registry/technical.md)、[Plan](project/archive/2026-09-29-execution-resource-registry/plan.md)、[Research](project/archive/2026-09-29-execution-resource-registry/research.md) |
| Agent 定义 | [Requirement](project/changes/agent-definition/requirement.md) | 轻量定义；暂不集中管理 skill/MCP |
| Subagent 看板 | [Requirement](project/changes/subagent-dashboard/requirement.md) | 简单全局状态；详情优先复用 HAPI |
| 完整版本集成与发布 | [Requirement](project/changes/integrated-release/requirement.md) | 组合验收、正式安装及完整交付证据 |

各 Change 的实际状态以其 Requirement/Technical/Plan 为准；用户已授权按顺序自主落实，每个 Change 的 Plan 经一次 iclaude 评审后执行。`design.md` 保存前期讨论，不代替正式 Technical 或 Plan。

按照 [project-workflow](../.agents/skills/project-workflow/SKILL.md)：

- `project/changes/` 保存未关闭的目标、技术方案和计划。
- 已验收 Specs：[CLI 安装](project/specs/installation/cli/spec.md)、[MCP 安装](project/specs/installation/mcp/spec.md)、[宿主 MCP](project/specs/host-mcp/spec.md)、[部署与数据](project/specs/deployment/spec.md)、[工作区绑定](project/specs/workspaces/bindings/spec.md)、[执行事实](project/specs/execution/lifecycle/spec.md)、[执行恢复](project/specs/execution/recovery/spec.md)、[执行兼容](project/specs/execution/compatibility/spec.md)、[机器](project/specs/resources/machines/spec.md)、[Runtime](project/specs/resources/runtimes/spec.md)、[资源范围](project/specs/resources/scope/spec.md)。
- `project/archive/` 保存已关闭 Change 的完整过程与验收记录。

新仓库不迁入旧实现、旧 Changes 或运行认证。历史证据定位到 [runweft-archive](https://github.com/iTgo-lyq/runweft-archive)。
