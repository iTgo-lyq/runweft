# HAPI 通道授权执行概况

## Plan 评审

- 执行者：当前工作区 iclaude，只读；会话 `e081bfbb-9d2d-43ed-9a73-6a93c74c943b`，完成约 599 秒。原始结果 `.dev-smoke/reviews/hub-hapi-access/review.json`。
- 采纳：原生子进程持机器凭据，任务凭据仅 Runweft 使用；补派生意图支持 fork/clear 的提前登记；spawn 强制内部 requestId；机器 peer JWT 明确权限；按机器所有者与会话所有者不同的场景验收；SSE 禁用压缩并处理绑定后缺口。
- 调整采纳：恢复不能仅靠发起前在线检查阻止 HAPI 同 host 回退。网关实际发往 Runner 的 spawn RPC 再核对可信意图/会话机器绑定，拒绝后不把参数交给错误机器。T3 必须覆盖检查后掉线；若仍出现未受控通道，再复现并判断最小 HAPI 扩展。
- 不采纳：以可写 HAPI metadata 自动变更执行机器授权；授权库中 machineId 只能由可信业务操作变更。暂不采纳缓存 1 秒权限，先保持逐请求/事件检查，避免定义不一致的撤销窗口。
- 当前研究通过协议转接、真实 Runner 与 receipt 时序验证；完整授权尚未实现，默认 serve 尚未切换，未写入 Specs。
