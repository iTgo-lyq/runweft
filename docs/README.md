# 项目文档

Runweft 1.0.0 已完成十二个 Change 的实现、自动验收、Specs 同步与归档。安装、配置、部署与数据维护见[使用说明](usage.md)，源码构建和验证见[开发说明](development.md)。

[最终交付验收](project/archive/2026-09-30-integrated-release/acceptance.md)汇总四平台产物、校验和、需求对应及原始证据。Linux x64 完成真实安装、20 组核心协作、8 组附件、2 组 MCP 控制、原生历史重建、升级回退和 Playwright；Mac 实机由用户验证，Linux arm64 为 QEMU CLI/配置验证，物理远端延期。远端功能已通过同机独立 Hub/多 Runner 真实链路。早期四平台基础安装证据不代替最终原生协作。

实现以当前 HAPI 为第一依据，Runweft 尽量只做上层流程封装与 MCP；旧工程技术方案不直接沿用。

整体方案与各 Change 均完成 iclaude 辅助评审；[整体复核记录](project/architecture-review.md)和各归档的 Execution 保存采纳依据。模块分工与依赖见[项目架构](project/architecture.md)。

本次按[六阶段交付结构](project/delivery-structure.md)完成十一个领域 Change 和一个集成发行 Change；当前事实见 Specs，历史需求和验收见下列归档。

全部 Change 按独立交付结果拆分并声明依赖，归档入口如下：

| Change | 需求入口 | 方案与依据 |
| --- | --- | --- |
| HAPI 内置能力验证与调用封装（已归档） | [Requirement](project/archive/2026-09-29-hapi-subagent-foundation/requirement.md) | [Research](project/archive/2026-09-29-hapi-subagent-foundation/research.md) |
| 统一 CLI 与部署（已归档） | [Requirement](project/archive/2026-09-29-unified-cli-and-deployment/requirement.md) | [Design](project/archive/2026-09-29-unified-cli-and-deployment/design.md) |
| 本地共享委派与生命周期（已归档） | [Requirement](project/archive/2026-09-29-delegation-lifecycle/requirement.md) | [Technical](project/archive/2026-09-29-delegation-lifecycle/technical.md)、[Plan](project/archive/2026-09-29-delegation-lifecycle/plan.md)、[验收](project/archive/2026-09-29-delegation-lifecycle/acceptance.md) |
| 任务附件交付（已归档） | [Requirement](project/archive/2026-09-29-task-artifact-delivery/requirement.md) | [Technical](project/archive/2026-09-29-task-artifact-delivery/technical.md)、[Plan](project/archive/2026-09-29-task-artifact-delivery/plan.md)、[契约](project/archive/2026-09-29-task-artifact-delivery/artifact-contract.md) |
| 远端工作区准备（已归档） | [Requirement](project/archive/2026-09-30-remote-workspace-preparation/requirement.md) | [Technical](project/archive/2026-09-30-remote-workspace-preparation/technical.md)、[Plan](project/archive/2026-09-30-remote-workspace-preparation/plan.md)、[基线契约](project/archive/2026-09-30-remote-workspace-preparation/baseline-contract.md)、[Research](project/archive/2026-09-30-remote-workspace-preparation/research.md) |
| 远端代码回收（已归档） | [Requirement](project/archive/2026-09-30-remote-result-delivery/requirement.md) | [Technical](project/archive/2026-09-30-remote-result-delivery/technical.md)、[Plan](project/archive/2026-09-30-remote-result-delivery/plan.md)、[结果契约](project/archive/2026-09-30-remote-result-delivery/result-contract.md) |
| 宿主身份与 MCP 适配（已归档） | [Requirement](project/archive/2026-09-29-host-mcp-adapter/requirement.md) | [Technical](project/archive/2026-09-29-host-mcp-adapter/technical.md)、[Plan](project/archive/2026-09-29-host-mcp-adapter/plan.md)、[Research](project/archive/2026-09-29-host-mcp-adapter/research.md) |
| 本地独立工作区与公共 Git 能力（已归档） | [Requirement](project/archive/2026-09-29-local-workspace-execution/requirement.md) | [Technical](project/archive/2026-09-29-local-workspace-execution/technical.md)、[验收](project/archive/2026-09-29-local-workspace-execution/acceptance.md) |
| 全局机器与 Runtime 注册（已归档） | [Requirement](project/archive/2026-09-29-execution-resource-registry/requirement.md) | [Technical](project/archive/2026-09-29-execution-resource-registry/technical.md)、[Plan](project/archive/2026-09-29-execution-resource-registry/plan.md)、[Research](project/archive/2026-09-29-execution-resource-registry/research.md) |
| Agent 定义（已归档） | [Requirement](project/archive/2026-09-29-agent-definition/requirement.md) | [Technical](project/archive/2026-09-29-agent-definition/technical.md)、[Plan](project/archive/2026-09-29-agent-definition/plan.md)、[Research](project/archive/2026-09-29-agent-definition/research.md) |
| Subagent 看板（已归档） | [Requirement](project/archive/2026-09-30-subagent-dashboard/requirement.md) | [验收](project/archive/2026-09-30-subagent-dashboard/acceptance.md)、[规格](project/specs/dashboard/subagents/spec.md) |
| 完整版本集成与发布（已归档） | [Requirement](project/archive/2026-09-30-integrated-release/requirement.md) | [验收](project/archive/2026-09-30-integrated-release/acceptance.md)、[发行规格](project/specs/release/distribution/spec.md)、[验证范围](project/specs/release/acceptance/spec.md) |

当前没有未关闭 Change。每个 Change 均经一次 iclaude Plan 评审、逐任务实现提交、自动本地验收及 Specs 同步后归档；明确由用户承担或延期的实测范围见最终验收。`design.md` 保存前期讨论，不代替正式 Technical 或 Plan。

按照 [project-workflow](../.agents/skills/project-workflow/SKILL.md)：

- 新的未关闭目标、技术方案和计划放在 `project/changes/`；当前无活跃变更。
- 已验收 Specs：[CLI 安装](project/specs/installation/cli/spec.md)、[MCP 安装](project/specs/installation/mcp/spec.md)、[宿主 MCP](project/specs/host-mcp/spec.md)、[部署与数据](project/specs/deployment/spec.md)、[工作区绑定](project/specs/workspaces/bindings/spec.md)、[执行事实](project/specs/execution/lifecycle/spec.md)、[执行恢复](project/specs/execution/recovery/spec.md)、[执行兼容](project/specs/execution/compatibility/spec.md)、[机器](project/specs/resources/machines/spec.md)、[Runtime](project/specs/resources/runtimes/spec.md)、[资源范围](project/specs/resources/scope/spec.md)、[Agent 定义](project/specs/agents/definition/spec.md)、[来源与绑定](project/specs/agents/scope/spec.md)、[原生继承边界](project/specs/agents/inheritance/spec.md)。
- 已验收协作 Specs：[委派入口](project/specs/delegation/interface/spec.md)、[持久协调](project/specs/delegation/lifecycle/spec.md)、[业务轮次](project/specs/delegation/rounds/spec.md)、[结果与等待](project/specs/delegation/results/spec.md)、[上下文](project/specs/delegation/context/spec.md)、[本机共享工作区](project/specs/local-workspace/shared/spec.md)。
- 已验收附件 Specs：[持久文件](project/specs/artifacts/spec.md)、[启动前输入](project/specs/artifacts/inputs/spec.md)、[输出交付](project/specs/artifacts/delivery/spec.md)、[留存与清理](project/specs/artifacts/retention/spec.md)。
- 已验收独立工作区 Specs：[模式](project/specs/local-workspace/mode/spec.md)、[准备与启动](project/specs/local-workspace/readiness/spec.md)、[成果与留存](project/specs/local-workspace/finish/spec.md)、[机器 Git 生命周期](project/specs/git-workspace/lifecycle/spec.md)。
- 已验收远端准备 Specs：[诊断入口](project/specs/remote-workspace/spec.md)、[固定基线](project/specs/remote-workspace/baseline/spec.md)、[独立环境与留存](project/specs/remote-workspace/isolation/spec.md)、[启动校验](project/specs/remote-workspace/readiness/spec.md)。
- 已验收代码回收 Specs：[固定成果](project/specs/remote-results/snapshot/spec.md)、[中心交付](project/specs/remote-results/delivery/spec.md)、[取回合入](project/specs/remote-results/fetch/spec.md)、[恢复留存](project/specs/remote-results/retention/spec.md)。
- 已验收交付 Specs：[全局看板](project/specs/dashboard/subagents/spec.md)、[发行产物](project/specs/release/distribution/spec.md)、[组合验收范围](project/specs/release/acceptance/spec.md)。
- `project/archive/` 保存已关闭 Change 的完整过程与验收记录。

新仓库不迁入旧实现、旧 Changes 或运行认证。历史证据定位到 [runweft-archive](https://github.com/iTgo-lyq/runweft-archive)。
