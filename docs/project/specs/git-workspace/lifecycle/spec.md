# 机器 Git 工作区生命周期

公共 Git 能力位于 HAPI Runner，复用机器认证、namespace、路径策略、RPC 和原有执行关联；Runweft 不另建 Git 服务或 runtime 框架。机器 capability `managedWorkspaces:1` 是调用前提，接口为 `POST /api/machines/:machineId/workspaces`，不支持时明确要求配套版本。

## 身份、准备与操作

repositoryId 由 machineId、真实 Git common directory 和对象格式确定，不用 remote URL 推断同一仓库。environmentId 对应一个独立任务，preparationId 对应一轮准备；输入身份与基线在操作前固定。支持源 cwd 自身为 linked worktree 或仓库子目录。

| 操作 | 契约 |
| --- | --- |
| resolve | cwd、baseRef 解析为准确 commit、仓库根/commonDir、相对 cwd、对象格式和主目录脏状态；拒绝歧义 ref、非 commit、未提交子目录和越界 |
| prepare | environmentId、preparationId、roundId、固定 source、expectedHead 与可选本地 inputs；持久准备并返回 cwd/startHead/输入证据 |
| inspect | environmentId 查询环境、准备、成果和操作回执；对中断操作核对现场，不创建 checkout |
| finalize | environmentId、preparationId、roundId、attemptId、sessionId 与 partial；核实停止后封存成果 |
| remove | environmentId、attemptId、expectedHead、discardIgnored；仅删除符合公共检查的自有环境 |

prepare/finalize/remove 快速持久受理，副作用异步执行，通过 inspect 读取 accepted/running/succeeded/failed/unknown。同一操作身份和参数返回原回执，参数冲突拒绝；已有 unknown/pending 操作阻止新操作。Git 元数据动作在进程内按 commonDir 串行，最终仍依赖 Git 原生锁。

首次准备在 `HAPI_HOME/workspaces/environments/<id>/checkout` 创建准确基线的任务分支 `hapi-task/<id>`；先保存归属，拒绝未知既存目录和配置 roots 外路径。输入放在源码树外并校验 hash/长度，任务依赖不由准备程序安装。

Git 需 2.31+，对象格式接受 sha1/sha256。有子模块时初始化对应 commit 并核对递归状态，有 LFS 时验证真实实体 oid/size，不能用指针文件代替内容。沿已有执行账户凭据取得缺少对象；同仓库本地对象优先复用。原生子模块初始化可能登记共享 Git config 中缺失的 URL/active，不改已有设置或全局配置，不把源 Git 元数据绝对不变作为承诺。

## 封存与副作用对账

启动消费当前准备引用；旧准备、丢失目录或漂移不自动修复成新工作区。finalize/remove 先检查 checkout 范围的活跃/未决会话，再核对 Runner 停止记录和进程身份；共享 Codex root 不用公共 PID 代替单会话退出。省略 finalize.sessionId 仅限该准备没有执行关联，或所有关联明确 childStarted=false；不能绕过已有/未知执行的停止证明。

封存核对实际归属、分支、HEAD 与 startHead 祖先关系，拒绝冲突、未结束 Git 操作和索引锁。保留 agent 已有提交后，为遗留非 ignored 修改执行 add/commit；无修改不创建空提交。补交使用本次命令的 `HAPI Checkpoint <checkpoint@hapi.local>` 身份，保留 hooks、签名与过滤器策略。

子模块脏状态或相对 startHead 改变的 gitlink 拒绝封存，包括候选 index 中新增的嵌套仓库。封存再次核对 HEAD、干净状态及 LFS 实体后固定结果 ref，返回 baseCommit、startHead、resultHead、resultRef、可选 checkpoint、partial、fileCount 和最多 100 个变更路径。

提交前保存 expectedHead，checkpoint 带 HAPI-Round/HAPI-Finalize trailer。丢响应后按提交父节点、机器身份、trailer 与现场核对，允许 hook 格式化后重新暂存；不能确认时不自动重跑 hook。Git 子进程关闭 stdin/交互提示，默认限时 15 分钟，超限停止本次进程组并核对结果；停止未知仍保留阻塞，不删外部锁。已停止且明确失败后才允许修复并显式重试，也接受操作者手动提交后的干净成果。

## 引用与清理边界

基线引用为 `refs/hapi/workspaces/<id>/base`，成果引用为 `refs/hapi/workspaces/<id>/rounds/<roundId>`，使用 compare-and-set 防止覆盖不同成果。实际清理检查最新 resultHead，没有成果时检查 base；所有保留引用必须仍指向记录的对象。

清理拒绝未封存/脏改动，ignored 默认拒绝，明确 discardIgnored 后才允许移除；子模块和已初始化目录同样检查。成功只删除自有 checkout、树外输入与指向预期成果的任务分支，base/round refs 和回执继续保留。部分删除或丢响应按原操作对账，不清空成果记录。业务层的轮次、权限和留存规则见[独立收尾](../../local-workspace/finish/spec.md)。
