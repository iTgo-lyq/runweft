# 输出文件交付

spawn/next 可声明 outputs[{name,relativePath}]，最多 100 项且逻辑名唯一；CLI 使用可重复 --output path 或 --output name=path。路径是工作区内明确的普通文件，拒绝绝对路径、点目录、目录和逃逸 symlink，不递归扫描。每轮独立声明；worktree 中未忽略的输出也会随原有 Git 收尾进入成果。

原生执行确认停止、worktree Git 封存后才 capture。Runner 从同一打开文件流式复制到受控 spool，记录大小、SHA-256 和捕获时间，并检查采集期间变化；不承诺共享目录对其他写入者的文件系统快照隔离。逐项捕获错误不隐藏其他成功候选。

deliver 只上传固定候选，使用预先保存的 upload request ID 和 output pin。中心核对可用对象及引用后，事务发布不可变清单版本，再释放成功 spool；未交付候选保留。源文件后改、工作区删除、Runner 重启不改变旧候选或已发布对象。

## 状态与恢复

read_agent/task show 分别返回原生、Git 和 artifacts 事实。文件状态为 none/pending/delivered/incomplete；部分失败保留原轮次的执行结论和已交付文件，附 artifacts attention。传输进行或结果未知时保持收尾并阻止下一轮，确认部分失败后可结束本轮并接受下一轮。

`task artifacts retry` / retry_artifacts 只重传该轮失败候选，不重读工作区、不重启模型。缺失文件没有候选时明确返回 artifact_no_retry_candidate，不能把它当作已重传。

`task artifacts collect` / collect_artifacts 在本任务所有轮次和文件操作静止后显式补收 files[{name,relativePath}]，记录新的捕获时间并发布新版本；已删除或未准备成功的 worktree 不能从主目录代收。补交不修改旧清单和对象。

两类操作使用稳定 requestId；原生调用重传幂等。响应不明时从 list_agents 的 accepted_requests 查询原 request_id/artifact_operation_id，再 read_agent 查看 pending；保留原参数重试。CLI `task artifacts show --round` 可查全部或指定 --version 清单。

发布与留存变化通过 artifacts_revision 通知，completed_revision 不变；已结束轮次的待处理文件操作仍进入协调器恢复扫描。成果 hash/下载以中心对象为准，执行机离线不影响已发布文件读取。留存状态与清单内容分开，见[引用释放](../retention/spec.md)。
