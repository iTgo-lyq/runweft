# 关闭 Change

关闭包含四个有序阶段：验证实现、人工验收、同步当前 Specs、归档完整 Change。任何阶段失败都停止后续操作。

## 1. 验证实现

读取 Requirement、Technical、Plan、相关 Specs、实现和工作区状态。

运行 `bun <skill-dir>/scripts/validate-change.mjs <change-dir>`；先修复结构错误，再继续语义验证。

1. 确认 Technical 为“已确认”，Plan 中所有必要任务为“已完成”，不存在未解释的阻塞。
2. 确认每个任务都有对应的独立本地 Commit，并按项目文档体系核对适用的 `execution.md`。
3. 将每项需求和验收标准映射到可观察实现或测试证据。
4. 运行项目已有的聚焦测试、类型检查、构建及必要的端到端验证。
5. 检查实现没有遗漏失败路径、扩大范围或破坏现有行为。

验证失败时返回执行流程；实现偏离已确认技术方案时返回技术澄清，目标行为需要改变时返回需求流程。不要通过修改 Spec 来掩盖实现偏差。

验证通过后，将 Plan 状态改为“已完成”，将 Requirement 状态改为“待验收”。

## 2. 人工验收

向用户提交实现摘要、需求逐项对应结果、验证证据、已知限制和未阻塞但应知事项，等待明确验收。不要把测试通过等同于用户已经验收。

- 用户验收：继续同步 Specs 和归档，不再重复询问。
- 用户要求在已确认需求内修正：将 Requirement 改为“进行中”、Plan 改为“执行中”，追加或重新打开必要任务后返回执行流程；每个任务继续独立提交。
- 用户要求改变已确认需求：将 Requirement 改为“草稿”，返回需求流程；Requirement 重新确认后重新完成 Technical 与 Plan 门禁。
- 用户暂不验收：保留“待验收”状态，不同步、不归档。

## 3. 同步 Specs

人工验收后，按项目文档中的 Specs 同步保护更新 `docs/project/specs/`。使用 Requirement 的 `ADDED`、`MODIFIED`、`REMOVED` 确定预期范围，但以验收后的实现和当前 Specs 重新核对，不机械复制 Requirement。使用完整 `<capability-path>` 定位 `spec.md`，保留已有嵌套关系，不将路径拍平。处理新增、修改、删除、移动或重命名后检查 diff，确认只包含预期的当前行为；发现冲突或契约不一致时停止归档。

## 4. 归档

完成的 Change：

1. 将 Requirement 状态改为“已完成”；确认 Plan 已为“已完成”。
2. 计算目标 `docs/project/archive/YYYY-MM-DD-<change-slug>/`。
3. 目标已存在时停止，先解决命名冲突，不覆盖现有归档。
4. 将整个 Change 目录从 `changes/` 移入 Archive。
5. 确认源目录不存在、目标目录完整，且 Specs 已同步。
6. 大型 Change 只暂存同步后的 Specs 和本次归档变更，创建 `<change-slug>: sync specs and archive` 本地 Commit。

取消的 Change：将 Requirement 状态改为“已取消”，存在 Technical 或 Plan 时也改为“已取消”；不同步 Specs，直接归档整个目录。大型 Change 同样为归档创建一个聚焦的本地 Commit。Archive 视为只读历史，不继续追加过程记录。

不要把任务未完成或验证失败的 Change 归档为“已完成”。如果用户决定放弃剩余工作，应按“已取消”处理，不能使用完成状态绕过验证。

## 结果报告

简要报告：

- Change 的最终状态和归档路径；
- 执行过的验证及结果；
- 新建、修改、删除或重命名的 Specs；
- 任务 Commit；大型 Change 同时报告归档 Commit；
- 仍需用户知晓但不阻碍关闭的事项。
