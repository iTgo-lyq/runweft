# 固定代码成果

远端独立任务确认原生执行停止后，由 HAPI 公共工作区封存 Git。成果关联 namespace/task/round、发起仓库、目标 environment、初始 baseCommit、本轮 startHead/resultHead、partial 和 sealedAt；封存事实不从 agent 报告推测。原生失败或中断可交付已封存的部分代码，但执行结论不变。

HAPI repositoryResults:1 提供 export-result，按 environmentId/roundId 读取确切自有成果 ref，并核对归属、停止、祖先关系。完整捕获根 Git、递归模块及真实 LFS 后，在独立空库验证闭包、树、模块映射和摘要，再返回 sealed/snapshot。原任务子目录已删除时仍从 checkout 根导出；不另作 checkpoint。

操作身份先持久保存，inspect 核对原回执，unknown 不重新导出。候选固定前阻止下一轮写入；固定后候选不随后轮 checkout 变化。未封存、漂移或缺对象明确保留现场并报错。公共封存对脏模块/gitlink 变化的拒绝仍生效，见[Git 生命周期](../../git-workspace/lifecycle/spec.md)。

清单 version 1 内嵌初始基线与成果两份快照、文件映射、固定 Git facts、验证来源和发布时间。每轮清单不可变；传输、取回及留存状态独立记录。无改动不生成空提交，同 HEAD 可复用已验证快照，但轮次关联和恢复引用独立。
