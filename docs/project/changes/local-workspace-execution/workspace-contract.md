# 工作区与 Git 成果契约

本文件补充 [Technical](technical.md)，定义本地/远端共用的机器侧 Git 操作；以下是待实现契约。

## 身份与存储

repositoryId 由发起 machineId、canonical Git common directory 与对象格式确定，不按 remote URL/分支名推断同仓库；主工作区本身是 linked worktree 时仍可解析。远端将逻辑 repositoryId 映射到其已验证缓存，不重新产生业务仓库身份。

environmentId 为一个 delegation 的 UUID，preparationId 为一次轮次准备 UUID；开始前由中心固定。HAPI Runner 在 HAPI_HOME/workspaces 下保存环境记录、准备/成果回执及 `environments/<environmentId>/checkout`，输入/上下文在 checkout 外。Runweft 托管时该目录位于 connections/<connection>/hapi/workspaces，备份/清理可以统一定位；不写入系统临时目录。

任务分支为 `hapi-task/<environmentId>`，保留引用为 `refs/hapi/workspaces/<environmentId>/base`、`.../rounds/<roundId>`。工作树保存实际 common directory、根、相对 cwd、branch、baseCommit 和对象格式；结果引用创建时使用 Git compare-and-set，既有不同值拒绝覆盖。同机工作树共享源仓库对象，不复制完整仓库。

## 有限机器操作

| 操作 | 输入与结果 |
| --- | --- |
| resolve | source cwd、baseRef；只读返回准确 SHA、仓库根/commonDir、对象格式、仓库内相对 cwd、主目录脏状态摘要 |
| prepare | 固定环境描述、preparationId、roundId、expectedHead、可选已解析输入清单；创建/复核环境，返回目录、准备版本和 startHead |
| inspect | environmentId 与可选 preparationId/roundId；返回已保存回执及实际现场/归属，不创建目录 |
| finalize | environmentId、preparationId、roundId、停止依据；确认归属和停止后 checkpoint/固定引用，返回 base/start/resultHead、ref、checkpoint 与部分结果标记 |
| remove | environmentId、预期最终成果、显式 discardIgnored；只移除符合条件的自有目录/分支，保留结果引用和回执 |

这些操作沿 HAPI machine namespace、MachinePathPolicy 与既有 Runner 连接。相同身份/参数查询和重试命中原记录，不随机改名新建；已有路径没有匹配归属记录时拒绝。进程内按 common directory 串行 Git 元数据变更，各 worktree 内的 agent 开发不共用此锁；Git 原生锁仍为最终保护。跨重启的不确定副作用只做事实对账，不偷删 lock 文件。

prepare/finalize/remove 的 HTTP/RPC 只持久受理并立即返回 accepted/running/succeeded/failed/unknown 回执，副作用在 Runner 进程内运行，inspect 返回后续事实。固定操作键分别为 preparationId、roundId+finalizeAttemptId、environmentId+removeAttemptId；相同键同参数不再执行，冲突拒绝。prepare 丢受理响应可用相同 preparationId 查/重交受理，不能换目录；finalize 未知只查询，显式 retry-finish 才生成新 attempt。Runner 重启后先检查既有 Git/回执及本次 Git 进程组退出证据，不自动重跑未知 hook；确认进程已停止但无完整结果时记录中断失败，操作者修复后可用新 attempt 明确重试。

## 准备与真实启动

1. resolve 拒绝非 Git、unborn、歧义 ref、非 commit、越界/不在基线的子目录；保留源目录未提交内容未包含的提示。不在主目录 stash/add/commit。
2. 准备先保存归属意图，再按准确 commit 创建自有 branch/worktree，并固定 base 引用；路径已存在时检查记录、Git registration、真实路径与分支。创建过程中崩溃可按同一身份检查已完成步骤，不覆盖未知目录。
3. 初始化基线子模块并核对递归 status、所需 commit 与内容；按既有凭据取得缺少对象，有可用本机模块对象时使用 Git submodule update 支持的 --reference；缺少可用目录时省略。优先用单次命令配置复用已解析 URL/active；原生 init 若需保存新的子模块登记，会写入主仓库共享 Git config 的对应条目，不能声称 Git 元数据完全不变；不得覆盖已有用户设置/remote 或修改全局配置。对 LFS 先复用同仓库本地对象，必要时沿已有 LFS remote 下载，再检查 oid/size 与实际实体；缺内容不就绪，不接受指针占位。
4. 验证 inputs 的 hash/长度及源码树外的归属（如有），验证实际 cwd。未提交/ignored 工程 skill 不在新 checkout 时明确说明；不创建空白原生配置 home，不自动安装项目依赖。
5. 新轮次要求 HEAD 等于上轮固定结果、Git 工作区无遗留改动，ignored 依赖保留。记录 startHead 后得到准备证据。
6. prepare 先核对配置的 workspace roots，避免完成后才发现目标路径被禁用。spawn/resume 携带 preparedWorkspace，先于 validateWorkspaceDirectory 验证存在性与归属并强制 approvedNewDirectoryCreation=false，再在 Runner 真正启动前重查证据及 cwd/HEAD/必要输入。失效、丢失或旧轮次证据返回 childStarted=false；不重建空目录，不再调用 HAPI 默认 worktree 创建。中心仍核对实际会话 machine/path/flavor 后才发 prompt。

HAPI 的工作区变更与关联执行启动按环境串行；finalize/remove 先核对该 namespace 中 checkout 范围的活跃/未决会话，再复用 Runner 按 session 的停止、processStartMarker 和 verifiedExit 记录核实，Codex 共享 runtime 不以公共 PID 退出代替本 root 退出。不使用客户端一句“已停止”放行，不扫描/终止无关进程。已绑定受控环境的 HAPI resume/clear 同样需要当前有效准备；不新增对普通 HAPI 会话或原生内置子代理的控制。手工外来改动在下一次准备时报告 workspace_drift；停止无法证实时保留环境，不承诺同一账户任意进程间的安全隔离。

## 固定成果

每轮确认受控执行停止后检查自身 worktree、commonDir、分支、HEAD 与基线/开始 HEAD 的祖先关系；拒绝 merge/rebase 等未完成操作、冲突、锁或未知归属。执行失败/显式取消但已确认停止可固定部分成果，保留原生失败/unknown 字段。

准备完成后未启动就取消或被明确拒绝的轮次也需封存。此时 finalize 可省略 sessionId，Runner 从准备与启动记录核对没有执行关联，或所有关联都已标记 childStarted=false；否则拒绝省略。不能用该入口跳过已启动/未知执行的停止证明。封存后原准备失效，下一轮可复用原目录。

子模块必须处于基线指针对应的干净状态；相对 startHead 的 gitlink 变化及嵌套脏状态明确报错，不自动提交嵌套仓库。检查同时覆盖 HEAD 和候选 index 的 160000 条目，防止 git add 把新克隆的嵌套 repo 当作普通文件加入成果。LFS 成果必须保留实体对象；仅有指针不能报告完整可用。

保留 agent 已有提交，再对本 worktree 遗留文本、二进制、删除与非 ignored 新文件执行 add/commit；无改动不产生空提交。使用仅本次命令生效的作者/提交者 `HAPI Checkpoint <checkpoint@hapi.local>`，不冒充配置中的用户；不关闭 hooks、签名或 clean/smudge filter。不把初始化输入/元数据混入 Git。hook 或签名失败保留 index/目录，attention 提供失败原因。

封存提交前记录 expectedHead（此时已含 agent 提交）和 attemptId，提交说明带 HAPI-Round/HAPI-Finalize trailer。正常 hook 可格式化并重新暂存，因此不拿 hook 之前的候选树强行匹配最终树。丢响应后核对提交 parent=expectedHead、轮次/attempt trailer、机器提交身份及实际干净状态，再固定 ref/回执；不能确认则保留未知，不重跑 hook 或制造第二个 checkpoint。签名影响 commit 身份，但不作为放弃这些事实检查的理由。

Git/hook/签名等待超过进程期限后，先停止本次进程树并核对是否已提交；已退出且未产生提交为明确失败，存在匹配且干净的提交则可以完成固定，进程退出未知仍阻塞。错误提示 checkout 路径以及修复/手工提交后重试命令。retry-finish 允许操作者用自己的配置手工提交，或明确处理/丢弃遗留改动；HEAD 是 startHead 的后代且目录干净时直接固定，不强迫再次使用机器身份签名，不更改用户签名策略。prompt 可提示 agent 自行提交已完成改动，程序 checkpoint 仍负责遗留部分。

结果包含 baseCommit、startHead、resultHead、resultRef、checkpoint（若有）、变更数量/有界路径、dirty/partial、environmentId、roundId 和实际路径。CLI/MCP 显示可执行的 `git diff <start> <result>` 与合入参考；程序不自行 merge、cherry-pick、push 或创建 PR。只有封存成功才放行后续轮次。

## 留存与清理

默认保留 worktree、任务分支、依赖、session 及所有成果引用，没有 TTL/配额自动删除。主 agent 合入结果不触发清理。

显式 remove 要求同一中心权限、环境归属、所有业务轮次已结束、所有关联执行停止可证、无挂起封存/上传条件、实际 HEAD 与最近成功固定的结果一致（从未封存则用 base）、没有 tracked/untracked 脏文件。未启动的失败准备只可清理已确认自有、没有唯一改动的现场；未知目录不因“准备失败”豁免检查。ignored 文件单独列出数量/有界路径，默认拒绝；只有显式 discardIgnored 才可丢弃。子模块递归检查同样适用，不能因 git worktree remove 的默认限制而绕过检查。

确认 Git 注册及实际路径后删除自有 worktree，再删除仍指向预期结果的自有任务分支；base/round refs 与回执继续保留，不能删除用户分支或共享主目录。需要 Git --force 才能移除干净子模块/已批准 ignored 内容时，仅限上述全部条件已核对的自有环境。丢响应先 inspect 对账；部分删除保留记录，不清空成果数据。

环境状态 retained/deleting/removed 与原生执行、finish 分开。删除接受后拒绝新的 send；若已有排队或运行轮次则拒绝删除。远端 Change 只增加结果上传/对象保留条件，复用同一归属与安全删除规则。

task list/show 提供环境状态和路径，paths/doctor 提供根目录及可取得的保留数量。备份须同时保留源仓库 Git 对象和 Runweft 数据；linked worktree 的 .git 指回源仓库，换路径恢复不能声称自动修复。卸载保留数据，Git branch 中可见 hapi-task/*，剩余 refs/hapi/* 的手工维护边界写入使用说明；不把“已经合入”当成清理唯一条件。
