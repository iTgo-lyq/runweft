# 本机共享工作区

shared 使用发起宿主真实、已存在的同一 cwd；可以是 Git 目录，也可以是非 Git 目录。所选 runtime 必须位于发起机器，Hub 模式不豁免；另一机器的同名路径不是共享工作区。

准备阶段核对资源与目录事实，实际原生执行就绪后再次核对 machineId/path/flavor，匹配后才输入任务。每轮保持原环境与定义快照；复用 session 不改变工作目录。

Runweft 不在共享目录自动初始化 Git、stash/reset、提交、创建隔离目录或清理文件。并发写入由主 agent 安排；子任务结束后文件留在原处，停止和收尾规则见[业务轮次](../../delegation/rounds/spec.md)。

纯报告任务不需要 Git 成果。需要隔离改动时可显式选择[独立 worktree](../mode/spec.md)，远端工作区尚未开放；不支持的模式明确拒绝，不能静默回退 shared。工作区说明、skills 和原生配置按执行账户及实际 cwd 的原生加载规则生效。
