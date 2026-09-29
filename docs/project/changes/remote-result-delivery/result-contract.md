# 代码成果与取回契约

> 来源：[Technical](technical.md)；状态：待实现，字段在各切片以协议类型和验收结果落实。

## 身份与不变事实

结果以 namespace/taskId/roundId 关联原 parent、origin 仓库、目标 environment、原生执行和公共 WorkspaceResult。初始 baseCommit、本轮 startHead、resultHead、partial 与 sealedAt 来自封存回执，不能由 agent 报告或上传者自由填写。远端 snapshot 中的 baseCommit 表示所捕获的 commit，即本轮 resultHead；不会覆盖任务原始 base。

代码清单包含 version、固定 Git facts、初始基线与成果的 snapshot manifest、全部所需 bundle/LFS artifact ID/hash/size、验证来源和发布时间；报告/附件继续其原清单，不复制完整模型历史。没有变化可复用既有完整快照，但本轮关联和留存独立。同一版本只描述已发布事实，可变的传输/留存/可用性单独查询。

## 机器操作

| 操作 | 输入与返回 |
| --- | --- |
| export-result | operationId、environmentId、roundId；返回匹配的封存 facts、已独立验证的完整 snapshot 和自有候选目录 |
| fetch-result | operationId、原仓库目标身份/实际 cwd、environmentId/roundId、固定 Git facts、基线与成果 snapshot/本地验证材料；返回已导入 ref/head、各仓库对象/LFS 恢复事实 |
| inspect/release | 沿 repositories 原操作身份查询或释放自有候选/下载验证中间副本；不以 release 自动删除用户仓库对象 |
| workspaces.remove 可选 ref 释放 | 精确 roundId/resultHead 名单，持久核对本环境成果后才能释放自有 refs；默认省略保持原行为 |

两端要求 repositoryResults:1；export/fetch 的 accepted/running/succeeded/failed/unknown 继续原 repository 回执。操作请求和身份在副作用前固定，参数冲突拒绝；unknown 沿原记录核对，明确失败的显式重试可以新 attempt，但仍引用原封存 head，不重新运行模型或 checkpoint。

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
