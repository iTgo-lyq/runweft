# 独立工作区成果与留存

中心确认本轮原生输入结果与执行停止后进入 finishing，HAPI 固定 Git 成果后继续对应模式收尾；远端还需固定代码候选并完成首次交付判定，见[中心交付](../../remote-results/delivery/spec.md)。每轮保留原生报告、session 和工作区，续接优先复用原生历史；执行、Git 交付和主 agent 接纳分别表达。

HAPI 保留 agent 已有提交，只在自有独立 worktree 内将遗留非 ignored 内容补为 checkpoint；无改动不产生空提交，共享主目录不自动提交。提交身份、hooks/签名与失败保留规则见[Git 生命周期](../../git-workspace/lifecycle/spec.md)。

read/show 返回 base/start/result SHA、resultRef、可选 checkpoint、变更数量/有界路径、partial 与目录留存状态。本机结果对象已位于源仓库；远端经[代码取回](../../remote-results/fetch/spec.md)进入原对象库，均不要求 push；主 agent/操作者审查 ref 后自行 merge 或选择提交 cherry-pick，冲突、推送和验收由其负责。程序不自动合码或推断“已合入”，合入不删除 worktree。

Git 收尾失败保留原生结果、报告与目录，返回 workspace attention 并阻止后轮。修复后通过 CLI `task retry-finish <id> --round <roundId>` 或 MCP `retry_finish` 显式重试；不重新启动模型/发送任务。未知操作先查原回执，不能反复执行 hook。finishing 的 interrupt 返回 execution_already_stopped，不伪造取消。

## 保留与清理

默认无限期保留 worktree、任务分支、依赖、原生历史和成果引用，无自动 TTL 清理。`paths` 与 `doctor` 的本机目录信息见[数据归属](../../deployment/spec.md#持久数据)。

CLI `task workspace remove <id>` 是显式操作者入口，MCP 只查询留存状态。中心在同一事务内确认全部轮次结束并标记 deleting，与追加轮次互斥；删除中/已删除环境拒绝新 send。机器侧检查归属、停止证据、挂起操作、成果引用、预期 HEAD 及干净状态。

tracked/untracked 脏内容拒绝删除；ignored 文件/依赖默认保留并提示，只有明确 `--discard-ignored` 才允许丢弃。子模块也执行对应检查；失败准备留下的目录仅在归属明确、没有唯一改动时可按基线删除，未知目录不享有豁免。

删除异步受理，用 show 确认最终 retained 状态。进行中重复命令/中心重启查询原操作；已确认失败恢复 retained 并保留原因，修复后允许显式新尝试。删除成功移除自有 checkout、树外输入及指向预期成果的任务分支，保留报告、原生历史和操作记录，本机仍保留 base/round 引用。远端按[代码留存](../../remote-results/retention/spec.md)核对已交付或已明确释放的成果后，释放目标自有成果 refs，并独立推进 task consumer 与缓存清理；中心恢复引用仍保留。已删除环境不自动重建或续接。

linked worktree 依赖源 Git common directory 与对象，备份须包含两侧和所需原生历史；当前不支持自动路径迁移。手工维护保留引用可能使报告指向的成果失去可用性，完整操作边界见[使用说明](../../../../usage.md#配置部署与数据)。
