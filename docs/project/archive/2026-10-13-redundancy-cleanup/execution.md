# 执行与验证

## Plan 评审

iclaude 返回 `error_during_execution`、`is_error: true`，未形成评审结论。用户确认暂无额度并要求启动新 subagent；独立只读评审由 `cleanup_plan_review` 完成，结论为可执行、无必须修正项。

主 Agent 复核采纳其精简检查项：保留 N1–N6/C/R、专项授权、输入指纹及证据复用、未知结果不重发、发布门禁与模型/托管安装/物理远端证据边界；详细候选 hash、计数和失败过程由既有归档提供。原辅助无调用方、十处历史链接和固定提交的源文件均已核对。

## T1 修正归档中的历史文件引用

十份历史 Markdown 各修正一处链接：八处 architecture、一处 delivery-structure、一处 remote-task-probe，均定位清理前固定提交。逐字对照原 Git blob 验证差异只有链接目标，十处目标由 `git cat-file -e` 确认存在；归档 JSON 无差异。`node scripts/check-workflow.mjs` 校验 41 个 Change 通过，`git diff --check` 通过。

## T2 删除冗余内容并收敛当前文档入口

删除三份旧规划/评审文档及 remote-task-probe，在 AGENTS.md 承接业务编排原则，根 README 切换到当前 SpecTrail/工作流检查入口。docs/README 保留操作、能力与历史导航及发布提速暂缓说明，由 21,528 字节缩为 3,335 字节；发行验收 Spec 由 7,216 字节缩为 4,759 字节，保留主链、复用、发布与实测边界，候选流水指向既有归档。

本地验证：

- `bun run typecheck` 通过；`bun run test` 显式运行 `./test`，260 项通过、0 失败，耗时 64.43 秒。
- 当前非归档 Markdown 的 207 处本地链接目标存在；活跃入口无旧规划/工作流引用，src/scripts/test/package/CI 无失效辅助引用。
- 再次核对十处历史链接仅改目标；HAPI、原型、生产源码、Skill、使用说明、依赖、发布配置及冻结包输入无差异。
- `node scripts/check-workflow.mjs` 与 `git diff --check` 通过。临时日志/摘要在 `.dev-smoke/redundancy-cleanup/`，未提交。

仅删除未调用辅助和维护既有事实，未重复构建产品、运行模型或追加远端实测。原有物理机器/模型证据缺口继续由发行 Spec 与归档保留。
