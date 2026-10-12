# 项目文档

当前行为与长期契约以 [Specs](project/specs/) 为准；开发约束见 [AGENTS.md](../AGENTS.md)，流程使用 [SpecTrail](../.agents/skills/spec-trail/SKILL.md)。

## 操作入口

| 用途 | 文档 |
| --- | --- |
| 安装、连接、配置、委派与维护 | [使用说明](usage.md)、[产品 Skill](../skills/runweft/SKILL.md) |
| 源码构建、测试、发行与工作流校验 | [开发说明](development.md) |
| 官网构建、预览与部署 | [官网说明](../website/README.md) |
| 八入口、三设备的独立交互原型与固定发布 | [原型说明](../packages/prototype/README.md) |

## 能力导航

| 能力 | 规格入口 |
| --- | --- |
| 安装与宿主接入 | [CLI](project/specs/installation/cli/spec.md)、[MCP 安装](project/specs/installation/mcp/spec.md)、[Skill](project/specs/installation/skill/spec.md)、[宿主 MCP](project/specs/host-mcp/spec.md) |
| Hub 身份与中心配置 | [身份](project/specs/identity/tokens/spec.md)、[空间](project/specs/spaces/membership/spec.md)、[连接](project/specs/identity/connection/spec.md)、[仓库](project/specs/repositories/association/spec.md)、[Agent](project/specs/agents/central/spec.md) |
| 部署、资源与原生执行 | [部署与数据](project/specs/deployment/spec.md)、[机器](project/specs/resources/machines/spec.md)、[Runtime](project/specs/resources/runtimes/spec.md)、[执行事实](project/specs/execution/lifecycle/spec.md)、[恢复](project/specs/execution/recovery/spec.md)、[配套版本](project/specs/execution/compatibility/spec.md) |
| 委派协作 | [入口](project/specs/delegation/interface/spec.md)、[中心协调](project/specs/delegation/central/spec.md)、[生命周期](project/specs/delegation/lifecycle/spec.md)、[轮次](project/specs/delegation/rounds/spec.md)、[结果与等待](project/specs/delegation/results/spec.md) |
| 工作区与代码交付 | [本机模式](project/specs/local-workspace/mode/spec.md)、[Git 生命周期](project/specs/git-workspace/lifecycle/spec.md)、[远端准备](project/specs/remote-workspace/spec.md)、[代码交付](project/specs/remote-results/delivery/spec.md)、[取回合入](project/specs/remote-results/fetch/spec.md) |
| 附件、后台与官网 | [持久文件](project/specs/artifacts/spec.md)、[后台](project/specs/dashboard/subagents/spec.md)、[官网产品](project/specs/website/product/spec.md)、[指南](project/specs/website/guide/spec.md) |
| 发行与验收 | [发行产物](project/specs/release/distribution/spec.md)、[验证规则与实测边界](project/specs/release/acceptance/spec.md) |

## Change 与历史

`project/workflow.json` 保存守护分支与原型接入配置；新目标、方案和计划放在 `project/changes/`，流程状态只写 `change.json`。已关闭的完整过程和验证证据保存在 [归档](project/archive/)，对应候选、hash 和实测限制以各自验收为准。

[发布流程提速](https://github.com/iTgo-lyq/runweft/tree/codex/release-throughput/docs/project/changes/release-throughput)保存在独立规划分支，按用户 2026-10-12 的要求暂缓实施；调研、方案草稿和评审结论保留，恢复需用户明确提出。

更早的旧工程材料在 [runweft-archive](https://github.com/iTgo-lyq/runweft-archive)，仅作研究参考。
