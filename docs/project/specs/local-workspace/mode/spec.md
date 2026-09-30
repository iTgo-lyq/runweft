# 任务工作区模式

CLI/MCP 支持 shared 和 worktree，默认 shared。shared 要求 runtime 位于发起机器；远端只接受显式 worktree 和已提交 base，不能静默回退 shared。

shared 使用[发起目录](../shared/spec.md)。worktree 要求发起目录属于 Git 仓库，本机 `--base` / `base_ref` 默认 HEAD，远端必须明确指定（可显式使用 HEAD），接受已有 commit、分支或 tag；接受任务前解析为准确 commit 并持久保存。shared 禁止指定基线，Git 解析失败不接受任务。重复请求先读取已接受意图，不随可变 ref 重新解析；相同请求 ID 配不同参数拒绝。

独立目录来自已提交基线，不迁入主目录未提交、未跟踪或 ignored 内容，不在主目录 stash/add/commit。发起 cwd 位于子目录时，基线必须包含该目录，子执行在 checkout 的对应相对目录启动。

一个 delegation 固定仓库、环境、cwd 与执行目标，每轮保存自己的中心定义快照；并行 delegation 各自创建独立 worktree，同一任务后续轮次保留原目录/依赖，不自动跟进主分支。公共 Git 身份与操作见[Git 生命周期](../../git-workspace/lifecycle/spec.md)，启动规则见[准备](../readiness/spec.md)，结果与清理见[收尾](../finish/spec.md)。
