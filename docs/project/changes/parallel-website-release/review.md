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
