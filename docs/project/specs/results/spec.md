# 固定代码成果

远端独立任务确认原生执行停止后，由 HAPI 公共工作区封存 Git。成果关联 namespace/task/round、发起仓库、目标 environment、初始 baseCommit、本轮 startHead/resultHead、partial 和 sealedAt；封存事实不从 agent 报告推测。原生失败或中断可交付已封存的部分代码，但执行结论不变。

HAPI repositoryResults:1 提供 export-result，按 environmentId/roundId 读取确切自有成果 ref，并核对归属、停止、祖先关系。完整捕获根 Git、递归模块及真实 LFS 后，在独立空库验证闭包、树、模块映射和摘要，再返回 sealed/snapshot。原任务子目录已删除时仍从 checkout 根导出；不另作 checkpoint。

操作身份先持久保存，inspect 核对原回执，unknown 不重新导出。候选固定前阻止下一轮写入；固定后候选不随后轮 checkout 变化。未封存、漂移或缺对象明确保留现场并报错。公共封存对脏模块/gitlink 变化的拒绝仍生效，见[Git 生命周期](../workspaces/spec.md)。

清单 version 1 内嵌初始基线与成果两份快照、文件映射、固定 Git facts、验证来源和发布时间。每轮清单不可变；传输、取回及留存状态独立记录。无改动不生成空提交，同 HEAD 可复用已验证快照，但轮次关联和恢复引用独立。

## 中心代码交付

远端任务收尾依次固定 Git、发布代码、交付声明附件，再形成轮次完成通知。捕获失败保留 finishing 并阻止下一轮；固定候选后上传明确失败可结束原生轮次，显示 needs_attention。执行、Git 封存、中心代码与附件状态分开，代码错误不把 sealed 改写为 unknown 或把原生成功改为失败。

默认使用中心持久文件传输完整 Git bundle、递归模块 bundle 及 LFS，无 Git remote 或未 push 的提交同样可交付。中心不运行 Git 或模型；发布必须核对可信 HAPI 导出/封存 facts、清单和全部 artifact 摘要、大小及恢复引用。主端取回仍独立验证内容。

基线与成果共用回执对账、100 项批次及配额逻辑；同 HEAD 完整快照、同 path/module/format/commit 的模块 bundle 和内容相同的 LFS 可复用。清单保存复用文件的真实 ref/摘要，不把新候选名当作旧文件内容。完整 Git 历史不包含 LFS 实体，因此基线旧 LFS 和成果新 LFS 一起保留。

CLI `task result show/retry`、MCP read_agent/retry_result 查询或修复当前轮次。retry 要求明确 round，持久 request ID 固定原意图；捕获确定失败可修复后重新捕获，候选已经固定则只重传。unknown 查询原机器操作，不重新执行模型、输入或 checkpoint。附件失败沿 retry_artifacts，不用代码重试代替。

read/wait 的 code 返回状态、固定成果、取回摘要、上传/复用/保留字节及具体下一步。初次交付先于 completed_revision，后续补交/取回/留存使用 code_revision 和既有 wait 游标；不提供后台宿主注入。配额不足给出 server.artifacts 配置键和显式释放/清理路径。

## 取回到原主仓库

CLI `task result fetch <id>` 和 MCP fetch_result 使用已有任务 ID，可指定轮次；省略时固定最新接受轮次，其成果未就绪则等待或明确报告，不能返回旧轮次。接受前固定 request ID、轮次和目标；同 ID 查询原操作，重启继续已有回执。

目标必须是原发起机器与同一 Git common directory/对象格式，可以从其 linked worktree 发起；相同 URL 的另一 clone 不算原仓库。原分支、HEAD 或 base 对象已不存在时仍能凭保留材料验证取回。原执行机无需在线。

HAPI fetch-result 先独立验证初始基线和成果材料、树、模块/LFS、base → start → result 关系，再向原主库追加对象。根/递归模块及两树必需 LFS 完整后，以 CAS 发布 `refs/hapi/results/<environmentId>/<roundId>`；重复相同 ref/SHA 可用，不覆盖不同 SHA。

取回不修改当前分支、HEAD、工作文件、index、FETCH_HEAD 或已有 Git 配置，不执行工程 hook、联网、递归 fetch 或自动维护；LFS 直接写入该库既有对象存储。新建模块对象库保留原生初始化所需布局，用户按需 submodule update；不自动改变工作区。

成功返回 ref/head、diff 与合入提示。主 agent/操作者自行审查、merge/cherry-pick、解决冲突及按需 push/PR，产品不自动接纳。部分追加失败可保留对象，但没有完整成果 ref 就不声明取回成功；未知先查原记录。机器中间副本在 HAPI workspaces/fetches，成功后释放副本，不删除用户对象或引用。

本机 worktree 结果已在原对象库，核对目标仓库后直接返回其已有封存引用，不重复走中心 bundle 传输。取回不触发成果或 worktree 清理。

## 代码恢复留存

轮次完成关闭原生执行，保留 worktree 和 session 历史供 next 续接。每轮清单独立持有初始基线与成果文件去重集合的 recovery pin；task consumer 保护输入快照和目标 import，二者独立。发布成果在目标 checkout/cache 消失后仍可从中心取回。

CLI `task result release <id>` 默认预览，省略 round 选择已有结束或收尾轮次；`--apply` 保存逐项副本/引用释放进度。未交付候选须 `--discard-pending` 明确放弃。活跃原生、未封存或未知操作不能绕过；不提供 MCP 清理工具。

释放先核对并回收受控机器副本，再解除本轮 recovery pin。部分进度、丢回执或服务重启沿原记录继续，不重新 pin 或运行模型。其他轮次/任务/基线/LFS 引用继续保护文件；解除引用不删中心字节，后续使用 artifact prune/remove。

清单、报告、Git facts 和主库已取回引用保留；codeRetention 保存 releasing/released/discarded 与错误，read/wait 展示有界摘要，释放后的结果不再宣称可取回。新 fetch/retry 拒绝；尚无机器写入的 waiting 取回随 tombstone 明确失败。

捕获确定失败但原生已停止、Git 已 sealed、相关操作均确定停止时，可显式 discard-pending 保存墓碑，继续正常附件收尾后放行排队下一轮；不跳过下一轮 prepare 或改写 resultHead。未知不能以放弃代替对账。

远端 task workspace remove 要求轮次/文件/代码动作确定，代码已交付且候选回收完成，或已显式释放。HAPI 仅按确切 round/head 删除该环境自有成果 refs；本机默认保留 refs。移除后沿基线服务释放 task consumer，错误和 pending 状态单独可见，其他消费者/外部引用保护缓存。中心恢复 pin 不依赖这个缓存，详见[独立环境](../workspaces/remote/spec.md)。
