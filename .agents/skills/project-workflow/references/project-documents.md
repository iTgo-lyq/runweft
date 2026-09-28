# 项目文档体系

所有持续维护的 Spec、过程文档和归档默认位于 `docs/project/`。

如果项目已有其他文档结构，先读取并说明映射，不擅自迁移、复制或删除旧文档。

```text
docs/project/
├── specs/
│   └── <capability-path>/
│       ├── spec.md
│       └── <child-capability>/
│           └── spec.md
├── changes/
│   └── <change-slug>/
│       ├── requirement.md
│       ├── technical.md
│       ├── merge-technical.md
│       ├── plan.md
│       ├── execution.md
│       └── research.md
└── archive/
    └── YYYY-MM-DD-<change-slug>/
```

`merge-technical.md`、`execution.md` 和 `research.md` 均按需创建。不要默认创建 README、索引、通用日志、会议记录或空占位文件。

## 三类文档

### Specs

`specs/` 是项目当前事实的唯一来源，只描述当前仓库代码中已经实现且仍然有效的行为。

- 按稳定的业务能力树组织；每个 capability 使用目录作为稳定边界，入口固定为 `spec.md`。
- `<capability-path>` 是相对 `specs/` 的完整路径，由一个或多个路径段组成。包含 `spec.md` 的目录是 capability；不包含时只是命名空间。
- capability 目录可继续包含子 capability。父级 Spec 只记录共同行为和边界，不重复子级 Spec 的具体行为。
- 使用当前时态描述最终行为，不保留变更过程、Review 提示或 Delta 标记。
- 不记录尚未实现的目标；Git 历史负责版本追踪，不在 Spec 内维护变更日志。
- 仅为修正对当前实现的错误描述或补录既有行为时，才直接编辑 Spec。

### Changes

`changes/` 保存尚未关闭的工作。一个目录对应一个内聚、可独立判断结果的变更。

- `requirement.md`：供人 Review 的目标行为；相对当前 Specs 和已验证实现的变化按 `ADDED`、`MODIFIED`、`REMOVED` 分类。
- `technical.md`：需求确认后的技术方案、不可发现但实现必需的契约与就绪性结论；所有 Change 在规划前都必须创建并通过确认。
- `merge-technical.md`：同一 Change 跨分支或工作区合码出现大量文本冲突、语义断点或两侧方案分歧时，单独记录主干、工作区、merge base、冲突决策、合并顺序、回退和验证。不创建新 Change，不改写原追踪文档，不替代 `technical.md` 或 `plan.md`。
- `plan.md`：根据已确认需求和技术方案拆出的执行计划；所有 Change 在执行前都必须创建并通过确认。
- `execution.md`：逐任务执行概况、验证结果、未解决事项与 Commit 标题；大型或委托执行的 Change 必须创建，其余按需。发生委托时在该文件记录执行者或会话标识，任务状态仍以 Plan 为准。
- `research.md`：只有代码调查、构建验证、必要实验或外部搜索等证据较多且需要保留时才创建；影响目标行为的结论进入 `requirement.md`，实现依据进入 `technical.md`，不能用 `research.md` 替代任一阶段文档。
- 未实现的需求即使已经确认，也继续留在 Change 中，不合入 Spec。

`requirement.md` 中可选的“协作资源”是当前 Change 的会话外资源登记入口，用于跨会话恢复输入依据、定位已生成的外部文档并避免重复创建。外部输出仍以仓库文档为内容来源；Requirement、Technical 或 Plan 变化会影响已登记的外部文档时，先将其标记为“待确认是否同步”并询问用户，不自动同步或另建副本。具体记录格式和阶段操作按对应流程文档执行。

### 流程矩阵

| 规模 | 判断                                     | 文档                                    | 人工门禁                   | Commit                           |
| ---- | ---------------------------------------- | --------------------------------------- | -------------------------- | -------------------------------- |
| 小型 | 一句话可无歧义描述，改动少且局部         | Requirement、Technical、Plan            | 需求、技术、Plan、最终验收 | 逐任务创建本地 Commit            |
| 中型 | 多个相关任务，但可作为一次连贯交付       | Requirement、Technical、Plan            | 需求、技术、Plan、最终验收 | 逐任务创建本地 Commit            |
| 大型 | 跨多个实质任务或工作会话，需要持久检查点 | Requirement、Technical、Plan、Execution | 需求、技术、Plan、最终验收 | 逐任务及归档分别创建本地 Commit |

小型不得涉及架构方向、跨系统契约、数据迁移、权限或难以回退的外部状态。无法确定时按较大一级处理，并在 Plan 后校准。执行中升级规模时，补齐新增文档和检查点后再继续。

并行边界按 Change 当前阶段判断：

- 需求梳理、调查和规划不属于开发实现；多个 Change 可以并行，不受最终规模限制。
- 修改主工程、共享包、服务、数据库或其他最终交付实现后，Change 进入开发实现阶段。
- 同一工作区只执行一个中型或大型开发 Change。
- 两个中型或大型开发 Change 功能耦合较低、修改范围互不重叠且共享契约已经稳定时，推荐分别使用独立 Git worktree 并行；每个 worktree 只承载一个 Change。
- 多个 Change 会修改同一用户行为、Spec、共享契约、数据库迁移或同一组核心文件时，即使使用不同 worktree 也保持串行。
- 小型开发 Change 仅在修改范围互不重叠时并行。

Requirement 状态使用：`草稿`、`已确认`、`进行中`、`待验收`、`已完成`、`已取消`。Technical 状态使用：`草稿`、`待确认`、`已确认`、`已取消`。Plan 状态使用：`待确认`、`待执行`、`执行中`、`已完成`、`已取消`；任务状态使用：`待开始`、`进行中`、`已完成`、`已阻塞`。不要创建额外状态文件。

执行中发现的新事实或用户反馈先写入其事实来源：目标行为变化更新 Requirement，方案或契约变化更新 Technical，任务拆解变化更新 Plan。上游变化使下游结论失效时，立即回退受影响文档的状态并重新经过对应门禁；不得等到执行结束再补写。

确认 Plan 即授权逐任务创建本地 Commit；大型 Change 同时授权归档 Commit。不授权推送、发布、创建 PR 或改写历史。

### Archive

`archive/` 保存已关闭 Change 的完整目录。归档后不再作为当前需求来源，也不继续追加执行记录。

- 已完成：先验证实现并通过人工验收，再将最终行为合入 Spec，最后移动整个 Change 目录。
- 已取消：将状态改为“已取消”后直接归档，不修改 Spec。
- 目标路径使用 `archive/YYYY-MM-DD-<change-slug>/`；目标已存在时停止并解决命名冲突。

## 写入路由

1. 已经实现的真实行为写入 `specs/<capability-path>/spec.md`。
2. 未来行为写入 `changes/<change-slug>/requirement.md`。
3. 未来行为的实现方案写入同一 Change 的 `technical.md`，执行拆解写入 `plan.md`。
4. 与活跃 Change 重叠的目标更新原 Change，不创建平行副本。
5. 合并同一 Change 到另一分支或工作区时，原追踪文档保持其已确认目标、方案和执行事实；达到合码方案门槛时，在同一目录新增 `merge-technical.md`。

新项目同样从 Change 开始。初始需求实现并验证后，再生成第一批 Specs。

## 命名与粒度

- 目录和文件使用小写 kebab-case；标题使用面向人的自然语言。
- `<capability-path>` 的每个路径段使用长期稳定的业务能力名称，完整路径是 capability 的身份。
- 嵌套表达稳定的业务包含关系，不复制技术分层或源码目录；不限制层级深度。
- 移动或重命名 capability 时按身份变更处理，同步更新引用，不将新旧路径当作两个无关 Specs。
- `<change-slug>` 描述本次用户结果。不要使用模糊名称或纯日期。
- 一个 Change 可以更新多个 Specs；多个无关目标应拆开。

## Specs 同步保护

1. 合并前重新读取当前 Spec，不能假定它仍和起草 Change 时一致。
2. 先确定受影响的完整 capability paths 和 Spec 段落，再写入最终行为；新增、修改、删除、移动和重命名都只作用于该范围。
3. 检查 diff，保留未涉及内容，避免重复条目或意外删除仍有效的场景和约束。
4. 移除草稿假设、Review 导读、任务状态、调查过程和其他 Change 专属内容。
5. 如果实现改变 API、数据结构或共享契约，确认仓库中的对应契约文档与代码一致。
6. 多个活跃 Change 触及同一行为时先协调，不能用后完成的内容覆盖当前事实。
7. 验证未通过、结论未确认或实现与需求不一致时，不同步、不归档为已完成。
