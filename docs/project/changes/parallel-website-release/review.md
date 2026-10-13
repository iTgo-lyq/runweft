# 独立复核

实际 `/home/tiger/.local/bin/iclaude`，模型 `claude-opus-5-5`，使用独立 CLAUDE_CONFIG_DIR、无工具及无会话持久化，提供完整需求/方案/实现和测试差异。首轮 696.924 秒；原始结果位于 `.dev-smoke/parallel-website/iclaude-review.json`。以下区分有条件风险与确定问题。

## R1 dispatch 输入的兼容性

首轮给出条件性 P1：JSON boolean 在某些 GitHub API 行为下可能被拒绝，评审未联网，不能据此认定当前平台确实拒绝。改为传字符串 `"true"`，与既有 dispatch 输入形式一致，接收端 boolean 输入仍转换为相同环境值。未通过触发必定失败的真实生产任务来证明条件风险。

## R2 仅复验来源不足

首轮 P2：仅核对 workflow 路径/分支，仍可能接受 fork PR 伪造回执或过时 Pages 项目。现拒绝非 push/workflow_dispatch、来源仓库不符、当前 Pages 项目不符；要求原 job 的实际上传步骤成功。增加相应拒绝夹具，URL 规范化后再写输出，gh 查询限时一分钟。

## R3 复验回执冒充本次上传

首轮 P2：原 verify 共用写法会把复验写为 uploaded=true。现仅复验写 uploaded=false/verificationOnly=true，保留原上传 run/attempt 和部署源码；恢复入口拒绝将仅复验 run 当作上传来源，要求始终指定实际原上传 run。

## 其他采纳项

并行入口查询真实父 npm-publish run，核对同仓库、正在运行、同一 attempt、来源事件及 tag/main；Beta 版本上显式复验直接失败；官网测试子进程清除所有发行/复验环境变量，生产式环境（含 VERIFY_RUN_ID）定向复验。文档说明父 run 重跑 website 仍会 dispatch，已有上传只使用网站 verify-run-id 入口。

既有 GET 轮询瞬时错误重试、并发 pending 替换、提前读取 npm latest 防倒退等建议不作为本 Change 的已实现能力。生产仍核对 main 当前提交和版本，npm 自身保留不可变候选及晋级防倒退；用户接受两端短暂不一致。

## R4 手动并行来源的模式与版本

第二轮实际 iclaude 复核耗时 383.188 秒，确认 R1–R3 已闭合；指出条件性 P2：workflow_dispatch 的父 run 仅绑定 main，会把正在运行的预检或只读验证当作发布来源。现 npm-publish 的 run-name 明确区分只读验证、正式 tag/恢复、空参数预检；官网要求手动父 run 的 display_title 精确等于目标版本的 publish vX.Y.Z，保留正式恢复能力。夹具验证恢复正例及预检、只读、异版和缺标题拒绝。

同时清空测试子进程的 Actions 输出路径与 Pages/查询环境，补充失败复验 uploaded=false，成功 summary 明确为复验，并核对复验 URL 与原恢复记录一致。sourceRevision 继续表示本次控制代码，deploymentSourceRevision 单独表示原部署源码。没有审批 environment 或 boolean 字符串 if 比较；Pages 项目名两入口均无隐式规范化。

## 最终定向复核

第三轮实际 iclaude 耗时 143.982 秒，结论为 R4 已闭合，没有确定的 P0/P1/P2。复核前提已逐项核对：npm-release 的 verify-run-id 优先且与发布参数互斥；其余仅依据非空 RELEASE_TAG 决定发布，source-run-id 不会降为预检；tag 经规范版本、真实 Git ref 和源码 package.json 一致性校验。recover.mjs 写入 recovery.url 前已通过 deploymentReference 并规范化为 URL.href，最终本地真实生产复验已通过严格 URL 绑定。

评审建议增加 npm preflight/verify 标题实测，但这会重跑与本改动无关的完整构建或公共矩阵；不为标题检查发起该组验收。网站仅复验工作流本身不使用 npm 的 run-name，不能把其标题冒充 npm 模式证据。新的正式并行来源查询与 publish 标题仍明确留待下一次正式版本实测；本次继续执行新版网站的托管只读复验。
