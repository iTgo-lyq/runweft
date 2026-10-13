# 工作区

CLI/MCP 支持 shared 和 worktree，默认 shared。shared 要求 runtime 位于发起机器；远端只接受显式 worktree 和已提交 base，不能静默回退 shared。

shared 使用发起目录。worktree 要求发起目录属于 Git 仓库，本机 `--base` / `base_ref` 默认 HEAD，远端必须明确指定（可显式使用 HEAD），接受已有 commit、分支或 tag；接受任务前解析为准确 commit 并持久保存。shared 禁止指定基线，Git 解析失败不接受任务。重复请求先读取已接受意图，不随可变 ref 重新解析；相同请求 ID 配不同参数拒绝。

独立目录来自已提交基线，不迁入主目录未提交、未跟踪或 ignored 内容，不在主目录 stash/add/commit。发起 cwd 位于子目录时，基线必须包含该目录，子执行在 checkout 的对应相对目录启动。

一个 delegation 固定仓库、环境、cwd 与执行目标，每轮保存自己的中心定义快照；并行 delegation 各自创建独立 worktree，同一任务后续轮次保留原目录/依赖，不自动跟进主分支。

## 本机共享工作区

shared 使用发起宿主真实、已存在的同一 cwd；可以是 Git 目录，也可以是非 Git 目录。所选 runtime 必须位于发起机器，Hub 模式不豁免；另一机器的同名路径不是共享工作区。

准备阶段核对资源与目录事实，实际原生执行就绪后再次核对 machineId/path/flavor，匹配后才输入任务。每轮保持原环境与定义快照；复用 session 不改变工作目录。

Runweft 不在共享目录自动初始化 Git、stash/reset、提交、创建隔离目录或清理文件。并发写入由主 agent 安排；子任务结束后文件留在原处，停止和收尾规则见[业务轮次](../delegation/spec.md)。

纯报告任务不需要 Git 成果。

## 独立工作区准备与启动

中心先持久化任务环境和本轮 preparationId，再请求 HAPI 准备固定基线的独立目录。准备进行中不启动模型；明确失败保留现场和诊断，未知结果按原操作身份查询，不换目录或重发模型任务。

首次准备核对源仓库、路径、归属、分支和 commit，初始化子模块并验证 LFS 实体；后续轮次要求上一轮已经封存、HEAD 等于其成果且工作树无未封存改动，ignored 依赖保留。启动前的详细检查由机器 Git 能力提供。

spawn/resume 都携带环境和准备引用。Runner 在任何自动目录创建前核对当前引用，再在实际启动点复核 cwd、HEAD 与准备输入；旧引用、目录缺失或漂移明确拒绝，不能重新创建空目录。中心还核对返回的 machine/path/flavor 后才发送任务。

原生客户端从准备完成的 cwd 加载工程指令、skill 和项目 MCP，继续使用执行账户已有全局配置、认证、默认权限及路径信任。版本化工程配置来自所选基线，未进入基线的 ignored/本地配置不自动复制。Runweft 不集中同步其他 MCP/skills、不创建空白原生 home、不自动安装项目依赖；依赖由 agent 按需安装。

任务上下文说明实际 cwd、固定基线、主目录未提交内容不包含以及成果规则，不替代工程指令。Git prepare 可接收已解析本地输入并校验 hash/长度后放到源码树外；此能力本身不提供附件上传服务。

声明任务附件时，Runweft 先通过[机器输入准备](../artifacts/spec.md)下载并核验，再交 Git prepare 复制到最终树外路径；成功复制后回收中间下载，工作区中的输入随环境保留。

准备期间取消等待原准备操作明确；已准备但未启动的轮次直接封存部分结果，不为收尾启动模型。启动明确拒绝同样先结束该准备；已经关联且停止未知的执行不能走“未启动”捷径。

## 机器 Git 工作区生命周期

公共 Git 能力位于 HAPI Runner，复用机器认证、namespace、路径策略、RPC 和原有执行关联；Runweft 不另建 Git 服务或 runtime 框架。机器 capability `managedWorkspaces:1` 是调用前提，接口为 `POST /api/machines/:machineId/workspaces`，不支持时明确要求配套版本。

### 身份、准备与操作

repositoryId 由 machineId、真实 Git common directory 和对象格式确定，不用 remote URL 推断同一仓库。environmentId 对应一个独立任务，preparationId 对应一轮准备；输入身份与基线在操作前固定。支持源 cwd 自身为 linked worktree 或仓库子目录。

| 操作 | 契约 |
| --- | --- |
| resolve | cwd、baseRef 解析为准确 commit、仓库根/commonDir、相对 cwd、对象格式和主目录脏状态；拒绝歧义 ref、非 commit、未提交子目录和越界 |
| prepare | environmentId、preparationId、roundId、固定 source、expectedHead 与可选本地 inputs；持久准备并返回 cwd/startHead/输入证据 |
| inspect | environmentId 查询环境、准备、成果和操作回执；对中断操作核对现场，不创建 checkout |
| finalize | environmentId、preparationId、roundId、attemptId、sessionId、partial 与可选 unchangedHead；核实停止后封存成果 |
| remove | environmentId、attemptId、expectedHead、discardIgnored、可选 releaseResults[{roundId,resultHead}]；仅删除符合公共检查的自有环境与明确选定成果 refs |

prepare/finalize/remove 快速持久受理，副作用异步执行，通过 inspect 读取 accepted/running/succeeded/failed/unknown。同一操作身份和参数返回原回执，参数冲突拒绝；已有 unknown/pending 操作阻止新操作。Git 元数据动作在进程内按 commonDir 串行，最终仍依赖 Git 原生锁。

首次准备在 `HAPI_HOME/workspaces/environments/<id>/checkout` 创建准确基线的任务分支 `hapi-task/<id>`；先保存归属，拒绝未知既存目录和配置 roots 外路径。输入放在源码树外并校验 hash/长度，任务依赖不由准备程序安装。

Git 需 2.31+，对象格式接受 sha1/sha256。有子模块时初始化对应 commit 并核对递归状态，有 LFS 时验证真实实体 oid/size，不能用指针文件代替内容。沿已有执行账户凭据取得缺少对象；同仓库本地对象优先复用。原生子模块初始化可能登记共享 Git config 中缺失的 URL/active，不改已有设置或全局配置，不把源 Git 元数据绝对不变作为承诺。

### 封存与副作用对账

启动消费当前准备引用；旧准备、丢失目录或漂移不自动修复成新工作区。finalize/remove 先检查 checkout 范围的活跃/未决会话，再核对 Runner 停止记录和进程身份；共享 Codex root 不用公共 PID 代替单会话退出。省略 finalize.sessionId 仅限该准备没有执行关联，或所有关联明确 childStarted=false；不能绕过已有/未知执行的停止证明。

封存核对实际归属、分支、HEAD 与 startHead 祖先关系，拒绝冲突、未结束 Git 操作和索引锁。保留 agent 已有提交后，为遗留非 ignored 修改执行 add/commit；无修改不创建空提交。补交使用本次命令的 `HAPI Checkpoint <checkpoint@hapi.local>` 身份，保留 hooks、签名与过滤器策略。

显式 unchangedHead 在任何 staging/checkpoint 前要求 HEAD 精确相等且工作树干净，用于只允许无改动封存的调用；省略该字段保留上述通常行为。它不绕过已有执行的停止证明。

子模块脏状态或相对 startHead 改变的 gitlink 拒绝封存，包括候选 index 中新增的嵌套仓库。封存再次核对 HEAD、干净状态及 LFS 实体后固定结果 ref，返回 baseCommit、startHead、resultHead、resultRef、可选 checkpoint、partial、fileCount 和最多 100 个变更路径。

提交前保存 expectedHead，checkpoint 带 HAPI-Round/HAPI-Finalize trailer。丢响应后按提交父节点、机器身份、trailer 与现场核对，允许 hook 格式化后重新暂存；不能确认时不自动重跑 hook。Git 子进程关闭 stdin/交互提示，默认限时 15 分钟，超限停止本次进程组并核对结果；停止未知仍保留阻塞，不删外部锁。已停止且明确失败后才允许修复并显式重试，也接受操作者手动提交后的干净成果。

### 引用与清理边界

基线引用为 `refs/hapi/workspaces/<id>/base`，成果引用为 `refs/hapi/workspaces/<id>/rounds/<roundId>`，使用 compare-and-set 防止覆盖不同成果。实际清理检查最新 resultHead，没有成果时检查 base；所有保留引用必须仍指向记录的对象。

清理拒绝未封存/脏改动，ignored 默认拒绝，明确 discardIgnored 后才允许移除；子模块和已初始化目录同样检查。成功只删除自有 checkout、树外输入与指向预期成果的任务分支，默认 base/round refs 和回执继续保留。明确 releaseResults 时，核对该环境 sealed facts 与精确 ref/SHA，持久保存删除意图后 CAS 释放所选 refs；resultRefReleases/releasedResults 记录部分进度和结果，inspect 继续已有意图，不覆盖变化后的 ref。部分删除或丢响应按原操作对账，不清空成果记录。

## 独立工作区成果与留存

中心确认本轮原生输入结果与执行停止后进入 finishing，HAPI 固定 Git 成果后继续对应模式收尾；远端还需固定代码候选并完成首次交付判定，见[中心交付](../results/spec.md)。每轮保留原生报告、session 和工作区，续接优先复用原生历史；执行、Git 交付和主 agent 接纳分别表达。

read/show 返回 base/start/result SHA、resultRef、可选 checkpoint、变更数量/有界路径、partial 与目录留存状态。本机结果对象已位于源仓库；远端经[代码取回](../results/spec.md)进入原对象库，均不要求 push；主 agent/操作者审查 ref 后自行 merge 或选择提交 cherry-pick，冲突、推送和验收由其负责。程序不自动合码或推断“已合入”，合入不删除 worktree。

Git 收尾失败保留原生结果、报告与目录，返回 workspace attention 并阻止后轮。修复后通过 CLI `task retry-finish <id> --round <roundId>` 或 MCP `retry_finish` 显式重试；不重新启动模型/发送任务。未知操作先查原回执，不能反复执行 hook。finishing 的 interrupt 返回 execution_already_stopped，不伪造取消。

### 保留与清理

默认无限期保留 worktree、任务分支、依赖、原生历史和成果引用，无自动 TTL 清理。`paths` 与 `doctor` 的本机目录信息见[数据归属](../deployment/spec.md#持久数据)。

CLI `task workspace remove <id>` 是显式操作者入口，MCP 只查询留存状态。中心在同一事务内确认全部轮次结束并标记 deleting，与追加轮次互斥；删除中/已删除环境拒绝新 send。机器侧检查归属、停止证据、挂起操作、成果引用、预期 HEAD 及干净状态。

tracked/untracked 脏内容拒绝删除；ignored 文件/依赖默认保留并提示，只有明确 `--discard-ignored` 才允许丢弃。子模块也执行对应检查；失败准备留下的目录仅在归属明确、没有唯一改动时可按基线删除，未知目录不享有豁免。

删除异步受理，用 show 确认最终 retained 状态。进行中重复命令/中心重启查询原操作；已确认失败恢复 retained 并保留原因，修复后允许显式新尝试。删除成功移除自有 checkout、树外输入及指向预期成果的任务分支，保留报告、原生历史和操作记录，本机仍保留 base/round 引用。远端按[代码留存](../results/spec.md)核对已交付或已明确释放的成果后，释放目标自有成果 refs，并独立推进 task consumer 与缓存清理；中心恢复引用仍保留。已删除环境不自动重建或续接。

linked worktree 依赖源 Git common directory 与对象，备份须包含两侧和所需原生历史；当前不支持自动路径迁移。手工维护保留引用可能使报告指向的成果失去可用性，完整操作边界见[使用说明](../../../usage.md#配置部署与数据)。
