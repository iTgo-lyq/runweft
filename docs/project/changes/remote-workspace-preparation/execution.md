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

## T3 中心准备编排与诊断 CLI

- 结果：state v5 以新增五张表保存快照、目标导入、消费者、LFS 内容索引及诊断准备。`RemoteBaselines` 只编排固定源 → 中心恢复文件 → 目标缓存；沿用 HAPI repository、文件传输与公共 workspace 回执，TaskCoordinator 无改动。没有新 runtime adapter、任务轮次或原生执行路径。
- CLI：`workspace prepare --agent --base`、`workspace preparations [--all]`、`workspace inspect`；稳定 request ID、明确 SHA/dirty 排除、分阶段与字节提示、原操作对账。使用已有 Agent/runtime 绑定，不要求手填 Git URL 或源/目标绝对路径；同机目标提示本地 worktree 委派。无 Runner 的 Hub 操作者也可查询当前 namespace 的诊断记录。
- 复用与失败：同 namespace/源仓库/SHA 共享 snapshot，子目录与发起归属留在 consumer；LFS 按 oid/size 复用。确定的 ≤100 项批次和文件 ID 在执行前保存，全部文件取得 recovery pin 才 available；目标导入独立保留代次，失败不改写中心可用性。部分交付只释放已发布候选；下载/导出成功副本及时回收，清理失败单独显示并对账。未知原操作不换 ID 重做，已删除中心对象使用新快照代次。
- 聚焦：`test/remote.test.ts` **7 pass / 144 assertions**（`.dev-smoke/c9-t3-remote-fourth.log`），真实 HTTP/SQLite、模拟 HAPI 故障覆盖 103 文件批次、并发/归属、同 SHA/LFS 复用、请求冲突、配额、丢响应/重启、目标离线、导入失败新代次、部分发布释放及 child 委派拒绝。这组测试不作为真实 Git 磁盘副作用证据。
- 根项目：`bun run typecheck` 通过（`c9-t3-types-commit.log`）；`bun test ./test` **136 pass / 0 fail / 2751 assertions**（`c9-t3-root-final.log`）。配套构建通过（`c9-t3-build-final.log`）。HAPI 源码、revision 和二进制沿 T2，本任务未重复无改动的 HAPI 全量检查。
- 实际配套 CLI：`bun run test:workspace-preparation`，`.dev-smoke/workspace-preparation-M6ji4H/evidence.json` **success=true / cleanupErrors=[]**。Hub 无 Runner、两个独立身份/数据根的 Runner：接受后立即重启 Hub，原 ID 继续；真实 102 个 LFS 实体和 bundle 分批传输，准确准备脏源子目录，三次准备验证同 SHA/cache 复用及新 commit 的 LFS pin 复用。隐藏源路径并停止源 Runner 后再重启中心，所有记录可查，原生 session 数为 0；独立 local 部署拒绝同机诊断且没有准备记录。仅注册/查询 Codex 版本，不是原生模型验收，也不是物理跨机验证。
- 使用说明补齐诊断路径、中心 v5 归属及 exports/imports/repositories 的保留规则；`paths` 显示受控目录。根 README/使用说明修正已完成附件能力的旧进度文字。四平台安装候选仍在 T5 更新，正式远端 task/MCP 仍未开放，显式释放按 T4 继续。
- 升级实验：用 T2 的原 state 实现建立 v4，写入机器/runtime、任务、轮次及附件清单后执行当前迁移；旧表/索引定义与全部旧行保持不变，只新增五张表，外键检查通过（`.dev-smoke/c9-t3-migration-M8EgFi/evidence.json`）。最终路径文案更新后重建通过（`c9-t3-build-docs.log`），编译 CLI 的 `paths`/prepare help 检查、Change 结构校验及 8 份修改文档本地链接检查通过，diff 无空白错误。
- Commit：`remote-workspace-preparation T3: orchestrate shared baselines and diagnostic preparation`。

## T4 准备留存与显式释放

- 结果：新增 `workspace release <id>` 与明确的 `--discard-ignored`，同一准备保存 finalize/remove 身份，未知结果沿原操作对账，明确失败后显式重试。工作区移除前不解除 consumer，最后消费者释放才逐对象 unpin；其他环境及跨快照 LFS 引用保留。详情展示环境、基线、导入与缓存留存，以及剩余清理错误。已释放请求保持历史结果，新准备使用新快照代次。
- HAPI：可选 `unchangedHead` 让 finalize 在任何 staging/checkpoint 前拒绝脏文件或新增提交；默认任务封存不变。import release 核对公共环境/操作/成果，再检查全部 cache refs 和 Git worktree。其他 imports 保留共享缓存；未知 ref、外部 worktree 和未回收结果明确保留。删除先原子移到本 import 的 `data/released-cache`，旧删除恢复不会误删相同路径后来新建的 cache；不增加原生执行/停止实现。
- HAPI 本地提交 `0d7618c3fe7d20ac10be2954e57a00d59431bba9`，根 pin 同步，版本仍 0.30.7。聚焦 **35 pass**（`.dev-smoke/c9-t4-focused.log`），覆盖双环境/双导入、无变化封存、脏文件不 checkpoint、新结果 refs 保护、停止证明、外部 worktree/未知 ref、删除恢复保护新导入。停止回调探针不是原生模型进程验收；后者归 T5。
- HAPI 全类型检查通过（`c9-t4-hapi-types.log`），Web **3249 pass**、Shared **323 pass**、Relay **118 pass**。全量 CLI **3014 pass / 11 skip / 2 fail**：既有 `/tmp/.git` 导致的 skills 非 Git 假设失败，以及 Claude seam 的 5 秒超时；seam 单独复核 **3 pass**（`c9-t4-cli-recheck.log`）。Hub **1411 pass / 3 skip / 1 fail**：通知节流用例在并行负载下越过计时窗口，单独复核 **4 pass**（`c9-t4-hub-recheck.log`）。未改无关运行代码或删除 `/tmp/.git`；完整原始日志保留 `c9-t4-hapi-{cli,hub,web,shared,relay}.log`。`gen:fixtures` 无漂移。
- 根项目：全量 **140 pass / 0 fail / 2821 assertions**（`c9-t4-root-tests.log`）；最终类型检查通过，最后的释放前置条件及 CLI 提示调整后聚焦 **11 pass / 213 assertions**（`c9-t4-root-{types,focused}-final.log`）。HTTP/SQLite 故障测试覆盖多消费者和 LFS pin、dirty/ignored/cache 占用、目标离线、丢 remove/unpin 回执、重启与部分发布失败清理；未修改 TaskCoordinator。
- 实际配套：原始编译 probe `.dev-smoke/workspace-preparation-qyyAAk/evidence.json` 通过；固定 revision 后 `build:hapi`/`build` 通过（`c9-t4-hapi-build.log`、`c9-t4-build.log`），正式配套 `dist/runweft`/`dist/hapi` 再验 `.dev-smoke/workspace-preparation-fbczK7/evidence.json` **success=true / cleanupErrors=[]**。真实检查 dirty 内容与 HEAD 未变、ignored 明确放弃、释放接受后 Hub 重启、另一 checkout 保留、目标离线 pin 不丢、跨快照 LFS 引用及最后实际磁盘缓存删除；中心对象仍 available，历史记录保留，全程 0 原生 session。仍是同物理机器的双 Runner，不是跨机验收。
- 使用说明与 HAPI API 契约已更新；本机配套构建完成，四平台候选更新及 Codex/Claude 原生两轮组合探针继续由 T5 完成。
- 最后复核：新准备跳过已释放 import 的有效性探测，保留旧成功/释放事实；聚焦增加该历史状态断言后 **11 pass / 214 assertions**，类型检查和重建通过（`c9-t4-root-{types,focused}-commit.log`、`c9-t4-build-commit.log`）。release help、Change 结构、7 份修改文档本地链接和两仓库 diff 检查通过。
- Commit：`remote-workspace-preparation T4: release diagnostic workspaces and baseline references`。
