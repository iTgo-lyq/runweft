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
- 规划提交时仅完成方案、实验与 Plan 评审；后续实现与检查见各任务记录。
- Requirement/Technical 依据用户持续授权已确认；按 Plan 顺序执行，没有待用户确认项。
- 规划 Commit：`remote-workspace-preparation: confirm reviewed baseline and preparation plan`。


## T1 HAPI 固定基线导出（2026-09-30）

- 结果：HAPI 新增 `repositoryExport:1`、`POST /api/machines/:id/repositories` 与 export/inspect/release；固定 source/SHA、持久回执、原操作查询、停止核对及可选择释放候选。source identity 校验复用 WorkspaceManager，Git 进程控制复用既有工具。
- 导出：scratch bare/alternates 中创建根及递归子模块完整 bundle；LFS 在 scratch 枚举，从源对象库按 oid/size 固定实体，支持自定义 storage 和 linked worktree。无 remote/未 push 可用，源 refs/config/index/工作文件不改。shallow、缺 Git/LFS/module 对象、错误身份明确失败；无 LFS 仓库不要求 git-lfs。
- 文件闭环：新增 `test:repository-export` 专用无模型脚本。实际 HTTP 丢响应后用原 ID 查回，Hub/Runner 重启仍返回同一 snapshot；使用现有 capture/deliver 发布 bundle/LFS，释放 export/spool、移走源目录后，中心下载和空 bare 导入/fsck 成功；原生 session 数为 0。
- 配套 HAPI 本地提交：`20f10899c49db4f2ac431eb66bef45ba24a3d0fd`（`remote-workspace-preparation T1: export fixed repository baselines`），根 package pin 已同步，版本仍为 0.30.7。新增通用 API 文档，不新增 Runweft MCP 工具或正式远端任务入口。

验证：

- 导出与原工作区聚焦测试 **24 pass**（新导出 8，原 worktree 16），`.dev-smoke/c9-t1-focused.log`；HAPI 全类型检查通过（`c9-t1-types.log`）。
- HAPI 全量：Hub **1411 pass / 3 skip**，Web **3249 pass**，Shared **323 pass**，Relay **118 pass**。CLI **3004 pass / 11 skip / 1 fail**；唯一失败为既有 `skills.test.ts` 非 Git 目录用例，实际 `/tmp/.git` 使其读到 parent-skill。未改或删除该环境，也未修改无关 skills 行为。日志分别为 `.dev-smoke/c9-t1-{hub,web,shared,relay,cli}.log`。
- 根类型检查通过（`c9-t1-root-types-final.log`），**129 pass / 0 fail / 2608 assertions**（`c9-t1-root-tests.log`）。`gen:fixtures` 无漂移。
- 首次断线 fixture 的 `ServerResponse.destroy` 没有实际断 socket，两次 probe 因断线断言失败，未产生原生执行且服务均停止。改用 socket.destroy 并记录请求后，`.dev-smoke/repository-export-W1wcbQ/evidence.json` 成功、只有一次 export 转发、cleanupErrors=[]；原因与修正见 Research。
- 固定新 HAPI revision 后，`bun run build:hapi`、`bun run build` 通过（`c9-t1-hapi-build.log`、`c9-t1-build.log`）；当前 `dist/runweft`/`dist/hapi` 的正式配套再验 `.dev-smoke/repository-export-i3qiDt/evidence.json` **success=true / cleanupErrors=[]**。本任务仅构建/运行本机 Linux x64，其他平台与候选 npm 包随 T5 更新，不冒称已更新四平台包。
- 目标 import、缓存/worktree 对接、中心复用与诊断 CLI 尚属 T2–T4；本次没有真实跨机器或原生模型验收。
- Commit：`remote-workspace-preparation T1: export fixed baselines through HAPI`。


## T2 目标缓存导入与公共准备（2026-09-30）

- 结果：HAPI 增加 `repositoryImport:1` 与 import 请求；文件摘要固定后，在独立空 bare 验证单一 ref、对象格式、完整闭包、gitlink/LFS 清单，再写入按认证范围和来源身份共享的 cache。原操作、失败与停止后的中断回执均保留，不重发导入。
- 目标来源：`imported.source` 携带本机仓库身份和 `snapshot` 导入引用，relativePath 由消费者指定；公共 prepare/launch 核对自有回执、映射和 refs，拒绝去掉或伪造 marker。import 与公共 worktree 共用仓库锁，未增加 TaskCoordinator/轮次逻辑。
- 工作树：每个环境独立分支、checkout 与模块配置，逐层仅用本地 cache 初始化子模块；LFS 只从本地实体 checkout。准备完整校验字节，启动检查 clean/HEAD/inputs 和模块/LFS 状态；续接保留上一封存成果，包括改动后的 LFS。成功导入立即删除自有验证中间副本，下载材料由既有 artifacts release 释放。
- 配套 HAPI 本地 Commit：`1d55d5d91e05c6df31493b7425abe64babdf09a4`（`remote-workspace-preparation T2: import baselines into owned worktree caches`）。根 pin 同步；新增 `test:repository-import` 实际 Hub/双 Runner 无模型脚本。import/cache 的显式回收仍由 T4 落实，当前 candidate release 不会删除缓存。

验证：

- 最终聚焦 **30 pass**（导出 8、缓存 6、既有 worktree 16），`.dev-smoke/c9-t2-focused.log`；覆盖 sha1/sha256、并发导入/独立工作树、同源缓存、两层重名/空格模块、无全局 LFS 配置、LFS 变更续接、损坏文件/增量 bundle 拒绝、身份和 ref 漂移、停止中断回执。最后增加模块配置修正后，专项和真实 RPC 均再次通过。
- HAPI 全类型检查通过（`c9-t2-types-final.log`）；全量 Hub **1412 pass / 3 skip**、Web **3249 pass**、Shared **323 pass**、Relay **118 pass**；CLI **3010 pass / 11 skip / 1 fail**，仅仍为既有 `/tmp/.git` 导致的 skills 非 Git 目录假设失败。未删除该目录或改无关逻辑。日志 `.dev-smoke/c9-t2-{hub,web,shared,relay,cli}.log`；全量之后的模块配置修正由上述最终聚焦覆盖。`gen:fixtures` 无漂移。
- 根项目 **129 pass / 0 fail / 2609 assertions**（`c9-t2-root-tests.log`），类型检查通过。
- 原始编译 probe `.dev-smoke/repository-import-vfcKCF/evidence.json` **success=true / cleanupErrors=[]**；源目录隐藏及 Runner 停止后仍能从中心导入，两工作树准备、封存、目标重启、下一轮沿成果继续和独立移除通过；无原生会话。首个 probe 揭示的子模块初始化配置问题及修正见 Research。
- 固定新 revision 后，`bun run build:hapi` 与 `bun run build` 通过（`c9-t2-hapi-build.log`、`c9-t2-build.log`）；正式 `dist/runweft`/`dist/hapi` 配套再验 `.dev-smoke/repository-import-pQhZMb/evidence.json` **success=true / cleanupErrors=[]**。根最终类型检查 `c9-t2-root-types-commit.log` 通过。仅更新本机 Linux x64，四平台与 npm 候选仍在 T5 统一更新。
- Change 结构校验通过，7 份修改文档的本地文件链接无断链；两个仓库 diff 检查通过。
- 本任务不开放正式远端任务，不做跨物理机器或原生模型验收；中心基线服务、诊断 CLI、保留/释放与原生准备探针仍按 T3–T5 继续。
- Commit：`remote-workspace-preparation T2: prepare worktrees from imported baselines`。
