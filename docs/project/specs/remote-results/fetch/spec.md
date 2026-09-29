# 取回到原主仓库

CLI `task result fetch <id>` 和 MCP fetch_result 使用已有任务 ID，可指定轮次；省略时固定最新接受轮次，其成果未就绪则等待或明确报告，不能返回旧轮次。接受前固定 request ID、轮次和目标；同 ID 查询原操作，重启继续已有回执。

目标必须是原发起机器与同一 Git common directory/对象格式，可以从其 linked worktree 发起；相同 URL 的另一 clone 不算原仓库。原分支、HEAD 或 base 对象已不存在时仍能凭保留材料验证取回。原执行机无需在线。

HAPI fetch-result 先独立验证初始基线和成果材料、树、模块/LFS、base → start → result 关系，再向原主库追加对象。根/递归模块及两树必需 LFS 完整后，以 CAS 发布 `refs/hapi/results/<environmentId>/<roundId>`；重复相同 ref/SHA 可用，不覆盖不同 SHA。

取回不修改当前分支、HEAD、工作文件、index、FETCH_HEAD 或已有 Git 配置，不执行工程 hook、联网、递归 fetch 或自动维护；LFS 直接写入该库既有对象存储。新建模块对象库保留原生初始化所需布局，用户按需 submodule update；不自动改变工作区。

成功返回 ref/head、diff 与合入提示。主 agent/操作者自行审查、merge/cherry-pick、解决冲突及按需 push/PR，产品不自动接纳。部分追加失败可保留对象，但没有完整成果 ref 就不声明取回成功；未知先查原记录。机器中间副本在 HAPI workspaces/fetches，成功后释放副本，不删除用户对象或引用。

本机 worktree 结果已在原对象库，核对目标仓库后直接返回其已有封存引用，不重复走中心 bundle 传输。取回不触发成果或 worktree 清理。
