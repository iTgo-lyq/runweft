# 远端工作区准备执行概况

## Plan 评审与确认

- iclaude：在当前工作区只读执行一次，session `3c11354b-fda3-4d1a-807c-474c69e8e799`，2026-09-29 23:21–23:31（Asia/Shanghai），exit 0 / result success；无 MCP、未修改代码、未委派子 agent。
- 本地原始记录：`.dev-smoke/reviews/remote-workspace-preparation/{meta.json,events.jsonl,review.md}`，不提交。结论为有条件可实现，以下条件均已在正式方案落实，无需重复评审。

| 建议 | 主 agent 判断与处理 |
| --- | --- |
| 避免独立准备服务复制 Task 轮次/上下文/收尾 | 采纳。RemoteBaselines 只交付 origin/targetSource；诊断是单独 consumer，C10 task 不接管其环境。TaskCoordinator 不在 C9 改造。 |
| 固定 snapshot 与 LFS 复用，明确配额 | 采纳。同 namespace/sourceRepositoryId/commit 共用 snapshot，LFS 按 oid/size 复用；不同 commit 暂用完整 bundle，已有大小/配额配置继续生效。 |
| scratch bare/alternates 导出、去掉源 ref 与重复导入 | 原建议为推断，补真实 full/shallow/partial 实验后采纳。源不改 refs/config/index，源导出禁止 transport；目标独立导入仍检查完整性。证据见 Research。 |
| 成功后及时释放 export/spool/materialize | 采纳。失败候选和未知操作保留，长期依据为中心 pin 与目标 cache，回收错误单列。 |
| cache 来源字段和离线 hydrate | 采纳显式 source.snapshot；逐层本地模块 URL，不使用 remote、不回退 lfs pull。LFS 准备时完整校验，启动时 Git clean 加实体标志，避免重复全量 hash。 |
| 同机测试遮蔽源路径 | 采纳，纳入 T2/T5；已有两层子模块原语实验验证源路径移走后仍成功。应用级证据待实现。 |
| 超大文件自动切片 | 不采纳。会引入新的拆分/拼接、保留与恢复契约；现有文件大小配置已经解决当前需求。CLI 显示具体大小与配置提示，不把这一偏好变成新文件协议。 |
| 合并列表/详情 CLI | 暂不采用。保留现有 CLI 常用的 list/inspect 风格；去掉准备说明、增加同机目标提示。 |

主 agent 另补清理边界：诊断有改动且尚无 C10 持久成果证据时不删除；不得自动 checkpoint 后丢掉只存在缓存中的成果。未执行且干净的准备才允许无改动封存后清理。

## 实施前验证

- Git 2.39.5 / Git LFS 3.3.0 的原语实验已通过：完整 bundle/sha256、共享 bare cache 多 worktree、固定 commit 的 LFS、两层离线子模块、scratch 导出及 shallow/partial 拒绝。详见 Research 的本地证据路径。
- `validate-change.mjs` 通过；修改文档的本地文件链接检查无断链、`git diff --check` 通过。文档变更不运行无关应用测试。
- 当前只完成方案、实验与 Plan 评审，尚未实现 C9 API、编排或 CLI；未运行本 Change 应用测试，也没有真实跨机执行证据。
- Requirement/Technical 依据用户持续授权已确认，Plan 待执行；下一个任务 T1。没有待用户确认项。
- 规划 Commit：`remote-workspace-preparation: confirm reviewed baseline and preparation plan`。
