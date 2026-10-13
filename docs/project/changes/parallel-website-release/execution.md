# 执行证据

## T1 官网短暂旧内容与仅复验恢复

在独立 worktree `/home/tiger/workspace/runweft-parallel-website` 实施。每地址三分钟共享预算内重新确认 HTTP 200 旧摘要，单次请求不超过剩余预算；持续错误、错误 MIME/鉴权/外部跳转不能通过。新增 `website-pages.yml` 的 `verify-run-id`，从同仓库原官网 job 日志恢复上传 URL，先核对版本、源码记录、分支/环境与当前十文件，再执行原 URL/正式域名与浏览器检查，跳过所有上传步骤。

`node --test ./scripts/tests/*.test.mjs ./website/publish.test.mjs`：66 通过、0 失败；包含短暂旧内容收敛、持续旧内容预算耗尽、鉴权不重试、回执缺失/版本/文件/源码/环境/工作流/分支不一致拒绝。`actionlint v1.7.12`、文档、workflow 和 diff 检查通过。

真实只读复验原失败官网 run `38378272259/1`：从其 GitHub 日志恢复 `https://42e28b6b.runweft.pages.dev/`，当前 1.1.6 静态构建与原记录完全一致；唯一 URL 和正式域名各十文件首次读取即匹配，随后三页 1440/390px 浏览器检查 6 项通过。原 npm/Pages 均未写入；这是本地执行新恢复入口与在线验收，不冒充新版本发布或托管 workflow 运行。原始证据在 `.dev-smoke/parallel-website/t1-*` 与 `.dev-smoke/website-pages/`。
