# 执行证据

## T1 官网短暂旧内容与仅复验恢复

在独立 worktree `/home/tiger/workspace/runweft-parallel-website` 实施。每地址三分钟共享预算内重新确认 HTTP 200 旧摘要，单次请求不超过剩余预算；持续错误、错误 MIME/鉴权/外部跳转不能通过。新增 `website-pages.yml` 的 `verify-run-id`，从同仓库原官网 job 日志恢复上传 URL，先核对版本、源码记录、分支/环境与当前十文件，再执行原 URL/正式域名与浏览器检查，跳过所有上传步骤。

`node --test ./scripts/tests/*.test.mjs ./website/publish.test.mjs`：66 通过、0 失败；包含短暂旧内容收敛、持续旧内容预算耗尽、鉴权不重试、回执缺失/版本/文件/源码/环境/工作流/分支不一致拒绝。`actionlint v1.7.12`、文档、workflow 和 diff 检查通过。

文档检查首次在未初始化 HAPI 的新 worktree 中报告 54 条历史源码链接缺失；T1 检查记录提交时未正确区分该命令失败。随后初始化固定 HAPI 后定向重跑文档检查通过，源码与链接均未修改；完整输出保存在 `.dev-smoke/parallel-website/t1-docs.log`。此处保留该检查过程的勘误。

真实只读复验原失败官网 run `38378272259/1`：从其 GitHub 日志恢复 `https://42e28b6b.runweft.pages.dev/`，当前 1.1.6 静态构建与原记录完全一致；唯一 URL 和正式域名各十文件首次读取即匹配，随后三页 1440/390px 浏览器检查 6 项通过。原 npm/Pages 均未写入；这是本地执行新恢复入口与在线验收，不冒充新版本发布或托管 workflow 运行。原始证据在 `.dev-smoke/parallel-website/t1-*` 与 `.dev-smoke/website-pages/`。

## T2 官网与 npm 正式发行并行

npm-publish 的 website job 无 beta/promote 依赖，独立解析不可变 tag 的规范稳定版本并检查源码 package.json；预检、只读验证、Beta 不调度正式官网。官网显式 parallel 模式核对 main、目标版本与父 run/attempt，静态检查证据将 npm 标记为 deferred-to-release。父流程仍绑定真实子 run 并等待，最终汇总要求 beta、完整公共矩阵、晋级及官网均成功，失败/取消/意外跳过和缺失官网 run ID 均拒绝整体成功。普通官网入口的 npm 前置未改变。

补充夹具覆盖并行入口不访问尚不可见的 npm、普通入口仍等待/拒绝、来源/版本错误、无完整包描述时的早期调度、最终汇合失败以及只复验入口跳过上传；生产式环境变量下重复执行官网测试，避免再次发生父 release 环境污染 Beta 测试的问题。

## T3 独立复核与交付

实际 iclaude（claude-opus-5-5）在隔离配置、无工具及无会话持久化条件下完成完整差异评审和修正复核；问题、条件风险与修正见 [Review](review.md)。70 项 Node 测试通过；完整发行与仅复验环境变量下的 20 项官网测试通过；actionlint v1.7.12、文档、workflow 和 diff 检查通过。第二轮修正后定向补充手动发行模式/版本、缺少查询凭据/403、失败复验未上传及测试输出环境隔离检查。

0426dcf 的 [完整 Development checks](https://github.com/iTgo-lyq/runweft/actions/runs/38384222091) 成功，包括类型、根单测、Node、HAPI/程序构建和选定的四组集成；[官网预览](https://github.com/iTgo-lyq/runweft/actions/runs/38384222092) 成功。其 [托管仅复验](https://github.com/iTgo-lyq/runweft/actions/runs/38384345883) 成功，原上传来源为 38381293502/1，Upload 步骤明确 skipped，回执 success=true、uploaded=false、verificationOnly=true，保留原源码及来源 run。真实浏览器和 HTTP 验收通过，没有再次上传该部署。

最终代码再次只读恢复原生产失败 run 38378272259/1，唯一 URL 与正式域名各十文件匹配，回执仍为 uploaded=false，并通过新增的 URL 绑定。原始输出为 `.dev-smoke/parallel-website/t3-final-live-recovery.log`；源码文件与之前成功的三页双尺寸浏览器验收完全相同。

本 Change 没有发布新 npm 版本，不声称已获得并行正式发行的实际墙钟。父子并行和最终门禁由工作流及 API 夹具验证，真实在运行父 npm run 的并行来源查询仍待下一次正式版本覆盖。现网 npm/网站保持 1.1.6。

最终实现 bef67c8 的 [Development checks](https://github.com/iTgo-lyq/runweft/actions/runs/38385664733) 与 [官网预览](https://github.com/iTgo-lyq/runweft/actions/runs/38385664694) 均成功；本次增量按既有 scope 不重跑无关 runtime 集成，上一实现提交的完整四组集成结果保留。最终 head 的 [托管只读复验](https://github.com/iTgo-lyq/runweft/actions/runs/38385998555) 再次成功，覆盖新增 URL 绑定与复验 summary，仍以原实际上传 run 38381293502 为来源。
