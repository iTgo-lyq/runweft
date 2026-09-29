# 代码成果与取回契约

> 来源：[Technical](technical.md)；状态：T1–T5 已实现机器导出/取回、中心清单、CLI/MCP、正式远端委派及显式释放；完整原生 MCP 矩阵与候选安装在 T6 验收。

## 身份与不变事实

结果以 namespace/taskId/roundId 关联原 parent、origin 仓库、目标 environment、原生执行和公共 WorkspaceResult。初始 baseCommit、本轮 startHead、resultHead、partial 与 sealedAt 来自封存回执，不能由 agent 报告或上传者自由填写。远端 snapshot 中的 baseCommit 表示所捕获的 commit，即本轮 resultHead；不会覆盖任务原始 base。

代码清单包含 version、固定 Git facts、初始基线与成果的 snapshot manifest、全部所需 bundle/LFS artifact ID/hash/size、验证来源和发布时间；报告/附件继续其原清单，不复制完整模型历史。没有变化可复用既有完整快照，但本轮关联和留存独立。同一版本只描述已发布事实，可变的传输/留存/可用性单独查询。

## 机器操作

| 操作 | 输入与返回 |
| --- | --- |
| export-result | operationId、environmentId、roundId；返回 `sealed: { source, result, verifiedAt }`、已独立验证的完整 snapshot 和自有候选 directory；source 是准确 checkout 根/resultHead 的机器来源，result 保留原 base/start/head |
| fetch-result | `operationId`、`target: { machineId, repositoryId, commonDir, objectFormat, cwd }`、`result: WorkspaceResult`、`baseline/output: { snapshot, files: [{ name, path }] }`；返回 `fetched` 的 ref/head、target、repositories/LFS 恢复路径及 fetchedAt |
| inspect/release | 沿 repositories 原操作身份查询或释放自有候选/下载验证中间副本；不以 release 自动删除用户仓库对象 |
| workspaces.remove 可选 ref 释放 | 精确 roundId/resultHead 名单，持久核对本环境成果后才能释放自有 refs；默认省略保持原行为 |

两端要求 repositoryResults:1；export/fetch 的 accepted/running/succeeded/failed/unknown 继续原 repository 回执。操作请求和身份在副作用前固定，参数冲突拒绝；unknown 沿原记录核对，明确失败的显式重试可以新 attempt，但仍引用原封存 head，不重新运行模型或 checkpoint。

基线和成果材料分开映射，同名 bundle 不共用逻辑文件名空间。取回同时恢复两树需要的 LFS；根结果完整 Git 历史包含初始 base。机器候选/独立验证副本在 `HAPI_HOME/workspaces/fetches/<operationId>/data`，release 只清理该操作副本。

fetch 的专用引用为 `refs/hapi/results/<environmentId>/<roundId>`。调用方不能指定当前分支或任意 ref；同名不同 SHA 拒绝。目标身份按 machine/commonDir/format 核对，不依赖 URL、HEAD 或原 base 仍存在。完整结果包须包含初始 base/startHead 的可达关系，模块与 LFS 清单必须逐项匹配固定树；不能用目标已有对象掩盖坏包。

## 业务动作与状态

已有任务 phase/stop/finish/native_status 不另造一套。代码交付记录 pending、capturing、publishing、available、needs_attention、unknown 或 not_applicable；原生终态与代码状态独立，固定候选失败阻止下一轮写入，上传失败可以显式重试而不重跑 agent。ready/available 必须同时满足封存关联、Git 验证和全部中心恢复文件可用。

fetch 请求冻结指定清单/round 与发起仓库身份，保存 materialize 和机器操作 ID；HTTP 丢回执查询原 request。成功后同一 result ref 重取不改工作文件或创建不同引用。CLI 默认取最新接受轮次，MCP 复用同一规则；其成果尚未就绪则明确告知，不返回旧轮次冒充。

正常路径在 finishing 内完成首次 publish 后才形成 completed_revision；补交才通过 code_revision 通知。code.next 明确指出可执行的下一步；fetch 尚未就绪时返回状态，不静默取旧轮次。

retry 只推进原轮次确定失败的交付；unknown 先查询原操作，候选已经固定后不重新读 checkout。补交发布增加 code_revision/task revision，wait 可观察更新。没有第三方推送、PR 创建、自动 merge 或新的通知通道。

## 消费与释放

task consumer 同时保护输入 snapshot 和目标 import；不新增 result consumer，不改变 importId 格式。各代码清单内嵌基线/成果清单和文件映射，用自己的 recovery reference 直接 pin 二者所需文件的去重集合；初始基线的旧 LFS 实体不因完整 Git bundle 而被省略。不同结果共用文件时分别持有引用。

中心发布成功只是已可恢复，不是取回、业务验收或合入。fetch 成功也不自动释放任何结果或 worktree。明确 CLI release 只释放所选轮次自己的引用/候选并保存 tombstone；字节仍按 artifacts 策略删除，其他消费者不会被顺带解除。

worktree 的目标成果 refs 只有在调用方确认持久交付或明确放弃后才能随显式 remove 释放。HAPI 只验证自己的环境、停止、ref 和 SHA 事实；Runweft 负责中央清单、引用和用户释放意图。未决动作与未知 refs 始终保留，不用一个“已完成”状态替代两个系统的事实。

捕获明确失败但原生已停止、Git 已封存、相关操作已确定停止时，显式 discard-pending 可放弃尚未固定的候选；持久 tombstone 后结束该轮并解除后续已排队轮次的门控。它不会改写 resultHead 或跳过下一轮 prepare 校验；未知操作不能用此选项绕过。首次基线准备失败提示按原 SHA 重新 spawn，不复活旧请求。

## T3 业务记录与接口

state v6 新增 `delegation_code_manifests`、`delegation_code_fetches`；可变交付记录位于既有 round 的 `code`，请求复用 `delegation_requests` 的 namespace/requestId 指纹事务。初次完整发布是每轮 version 1，不因重试创建虚假的新内容版本；同 HEAD 的后续轮次仍有自己的清单与恢复引用。表与字段类型见 `src/tasks/result-types.ts`。

`POST /api/runweft/tasks/result/show|fetch|retry` 继续当前 parent 身份，show/fetch 可省略 roundId，retry 要求明确 roundId；fetch/retry 接受 requestId。fetch 第一次接受时保存选定轮次与原主库 target，相同请求即使已有新轮次也返回原操作。尚未发布时保存 waiting，发布后只消费这一轮的清单；本机 worktree 验证当前目录属于原仓库后直接返回既有引用。

read/wait 的 `code` 包含 status、round_id、result、ref、fetch、bytes 和 next；取回进行中 next 指向读取状态，成功后给出 diff，失败则保留可操作错误。`code_revision` 让原完成轮次的补交与取回结果沿既有 wait 游标可见。CLI show 返回清单和取回历史；MCP fetch_result/retry_result 只返回操作摘要，不复制整份文件映射和下载副本路径到模型上下文。

## T4 远端委派

远端 spawn 必须使用 worktree 并显式提供 base；本机省略 base 仍等价于 HEAD，相同 request ID 的旧指纹保持兼容。接受时在 parent.machineId 上解析 origin 并冻结 SHA，目标 Runner 的 source 只能来自该基线的导入回执。

environment.remote 保存 origin、snapshotId 和 consumerId。基线消费者按任务身份幂等查找，插入后崩溃不会重复创建；任务与诊断共享基线服务，停服先等待任务推进，再关闭基线依赖。准备完成才进入原有工作区、输入和模型启动流程。

首次收尾按 Git 封存、代码发布、附件发布、轮次完成顺序推进。捕获失败保留 finishing，retry_result 可修复；已经 sealed 的 Git facts 不因代码错误降为 unknown。下一轮沿原 worktree 和原生 session 续接。

无模型成果回归只使用真实 HAPI prepare/finalize facts；插入 fixture 时停止服务，避免 queued 行启动模型。正式委派另由公开 CLI 驱动 Codex/Claude Code 各两轮，验证工具过滤、进程停止、收尾修复及执行端离线后的取回合入；证据见 Execution。

## T5 留存记录与清理入口

`POST /api/runweft/tasks/result/release` 仅接受操作者 CLI parent，字段为 id、可选 roundId、apply 和 discardPending；默认只读预览。省略 roundId 选择已结束或收尾中的轮次，正在执行的任务仍拒绝释放。round.codeRetention 持久记录 releasing/released/discarded、逐项恢复引用/机器副本和错误；清单保持不变。已受理的释放沿原记录继续，不重新 pin 或发布；新 fetch/retry 拒绝，已取回主库引用不变。read/wait 的 code.retention 只返回状态和待处理数量，完整清理预览只经 CLI/API 返回。

捕获确定失败时，只有显式 discard-pending、停止证明、sealed facts 和相关操作均确定停止才可结束代码收尾。后续附件流程仍正常完成，再放行排队下一轮。未完成取回的副本也须核对原操作；没有机器写入的 waiting 取回会随 tombstone 明确失败。

远端 workspace remove 冻结各 sealed 轮次的 roundId/resultHead，HAPI 默认不删成果 refs，只有明确名单才删除。持久操作记录 resultRefReleases，环境记录 releasedResults；重启按既有删除意图核对精确 ref，恢复部分进度。cache release 认可这些事实，但重新出现的已释放 ref 视为外部占用并保留。基线 ref 随最终自有 cache 回收，不删除主仓库引用。

环境移除后，environment.remote.release 单独记录 pending/released 与错误，沿共享基线服务解除 task consumer。失败保留消费者与恢复引用；其他消费者继续保护 input/import，已发布轮次用各自 recovery pin 独立保留。候选与取回副本留在既有 HAPI workspaces 目录，paths/doctor 显示相应路径；不新增表或临时数据根。
