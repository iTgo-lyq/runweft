---
name: project-workflow
description: 管理 docs/project 下从需求澄清、技术澄清、计划、执行、合码、验收到 Specs 同步与归档的项目开发流程。用于梳理或评审需求、调研并确认技术方案、创建或调整 Plan、执行或修正活跃 Change、处理跨分支或工作区合码，以及完成、取消或归档 Change。
---

# 项目工作流

## 先判断是否进入工作流

先判断请求是否只是一次性微小修正。只有同时满足以下条件时，直接修改并完成必要验证，不创建 Change、Requirement 或 Plan，也不继续读取本 Skill 的后续流程：

- 不改变需要长期记录的线上产品行为；
- 修改局部、目标明确且没有产品或方案歧义；
- 不涉及架构方向、共享或跨系统契约、数据迁移、权限、重要依赖或难以回退的外部状态。

典型情况包括拼写、注释、纯格式和不改变行为的机械修正。不能确定时进入工作流；不要把产品行为变化描述成微小修正来绕过流程。

## 完整流程

进入工作流后，先检查当前任务是否与活跃 Change 重叠；有重叠时继续原 Change，不创建平行副本。合并活跃 Change 到另一分支或工作区不创建新 Change；若合码预检发现大量文本冲突或语义断点，在原 Change 目录新增独立 `merge-technical.md`，不得为记录合码改写原 Requirement、Technical、Plan 或 Execution。除非用户在需求确认前取消，每个 Change 都必须有经过确认的 Requirement、Technical 和 Plan。

1. **需求（Requirement）**：明确目标、范围、行为和验收标准，并通过 Research 穷尽可主动探索或可靠推理的相关事实。Requirement 经用户确认后才能进入技术澄清。
2. **技术澄清（Technical）**：基于已确认需求和 Research 结论推导技术方案，只向用户澄清无法主动探索、无法可靠推理、但实现必须依赖的契约。Technical 经用户确认后才能进入计划。
3. **计划（Plan）**：把已确认需求和技术方案拆成可执行、可验证的任务。用户确认整体 Plan 后才能进入执行，并授权逐任务创建本地 Commit，不逐任务审批。
4. **执行（Execute）**：每个 Plan 任务独立实现、验证并提交。发现技术缺口或用户修改需求时，立即停止受影响实现、反馈用户、同步对应文档，并从最早失效的人工门禁继续。
5. **关闭（Close）**：依次完成整体验证、人工验收、Specs 同步和 Change 归档。任一步失败都返回对应阶段，不得跳过或用状态修改掩盖偏差。

请求跨越多个阶段时，从最早未满足的阶段开始，在下一个人工门禁暂停。用户已经明确确认的阶段不重复确认。

## 用户确认必须在会话中提出

任何需要用户确认、取舍或补充的信息，都必须在用户会话的回复正文中转写为具体问题并直接提出。可以同步记录到 Requirement、Technical、Plan、Execution 或 Research，但不得只写入文档、只提供文档链接或只笼统提示“存在待确认项”。问题影响后续推进时，在获得用户明确答复前暂停受影响流程。

能主动探索或可靠推理的事实不作为待确认问题；按对应阶段完成调查或说明有依据的假设。

## 按阶段加载细节

进入工作流后，先完整阅读 [references/project-documents.md](references/project-documents.md)，再根据上述流程判断当前阶段并只加载该节点细节：

- **合码**：请求把 Change 合入、迁回、移植或同步到另一分支或工作区时，先读取 [references/merge-change.md](references/merge-change.md)。合码不改变原 Change 阶段；需要独立方案时，完成 `merge-technical.md` 的确认后再执行合并。
- **需求**：读取 [references/shape-requirement.md](references/shape-requirement.md)。
- **技术澄清**：读取 [references/clarify-technical.md](references/clarify-technical.md)。
- **计划**：读取 [references/plan-change.md](references/plan-change.md)。
- **执行**：读取 [references/execute-change.md](references/execute-change.md)。
- **关闭**：读取 [references/close-change.md](references/close-change.md)。

Change 规模、状态、人工门禁、并行和 Commit 策略只以项目文档中的流程矩阵为准。
