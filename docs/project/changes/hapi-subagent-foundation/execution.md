# HAPI 执行契约执行概况

## Plan 评审与独立复核

当前工作区 iclaude 会话 `b5794bf8-b969-441e-9097-5bf8e8c808fa` 于 2026-09-29 04:49–05:00（Asia/Shanghai）完成一次只读评审，退出 0、result success；未重复评审。原始材料在 `.dev-smoke/reviews/hapi-subagent-foundation/`。按用户自主实施授权确认 Technical/Plan，保留 T1–T4 顺序。

| 意见 | 复核与处理 |
| --- | --- |
| Claude nextMessage 早于进程创建，不能直接等于原生接受 | 采纳区分 submitted/accepted，拒绝“无 init/assistant 就安全重发”的推论；缺少 stdout 不排除已处理。只有明确未创建进程或未写入的证据允许恢复；模糊退出保留未知。已有三次重复投递的实测要求回归 |
| 原生 session 缺失没有明确来源 | 采纳 T3 先复现，再复用原生 transcript/thread 查询并透传明确缺失码；认证与 IO 错误不能转为缺失 |
| 未知需要处理出口 | 采纳启动同 ID 显式重调、原 stub 经确认停止再决定新建；不采纳“回执不存在证明从未到达”，在途请求仍可到达。输入不因单次空 queued-state 自动重投；持久 invoked/indeterminate 禁止重复投递 |
| Claude 自主根轮次可误归输入 | 采纳；要求原生关联证据，未知不匹配给下一批，覆盖交错验证 |
| 排队取消、中断合并输入与 Claude 进程退出 | 采纳；复用 cancel-queued，返回受影响 localIds，受控中断不落入模糊崩溃 |
| 身份证据按 runtime 分开 | 采纳；明确 Codex 共享 engine 无全局 HAPI_SESSION_ID，最新 HAPI ID 以 resume 响应为准；首次 MCP 角色验证仍归下一 Change |

不采用以客户端 sessionId 替代持久回执的简化：删除 session 后旧请求仍不得再次启动。回执仅记录管理操作，独立小表比耦合 WorkGraph 的业务主体/事件语义更直接。

## T1 可重查的启动与调用入口

- 结果：HAPI 的可选 requestId 在 namespace 内持久去重；回执与原有预分配 session 原子写入，之后只调用一次既有 Runner。并发、参数冲突、模糊错误、删除 session 和重启均可重查，schema 27 与回退要求已说明。`spawnReceipts: 1` 仅声明已实现的管理能力。
- Runweft：新增内部 ExecutionClient 的 start/lookup；必须提供调用方 requestId，只支持 Codex/Claude，丢响应后查原 ID；未找到或不可达返回 unknown，不自动再 POST。HTTP 错误保留状态与服务 code。
- 验证：Runweft typecheck、17 项测试通过；HAPI typecheck 通过；`bun run gen:fixtures` 无漂移；全量 `bun run test` 退出 0（CLI 2,946、Hub 1,377、Web 3,249、shared 323、relay 118 通过，原有 CLI 11/Hub 3 跳过）。专门的回执/原预分配/机器路由/迁移合计 48 项通过。全量日志在 `.dev-smoke/hapi-foundation-t1/`，测试临时目录位于 Git 外并已清理。
- 真实 Runner：05:10–05:11（Asia/Shanghai），编译后的修改版 HAPI、既有 Runweft 服务和新 ExecutionClient 在专用 home/cwd 验证两 runtime 的并发同 ID、代理断开响应后的重查、archive 退出、删除后不重启、Hub 重启后不重启；全部通过，无 prompt 投递，不当作原生终态验收。证据 `.dev-smoke/hapi-spawn-mKfoYK/evidence.json`。
- Commit：HAPI `hapi-subagent-foundation T1: persist idempotent machine spawn receipts`；Runweft `hapi-subagent-foundation T1: expose recoverable HAPI startup calls`。

## T2 两种 runtime 的原生事实与定向中断

- 结果：在已有持久消息通道保留原生输入、结果和稳定标识，根/侧链与 Claude 自主轮次分开；定向中断在执行侧检查目标，拒绝迟到调用。Claude 模糊退出不自动重发，Hub 不重新投递已消费的重复 localId。Runweft 提供就绪等待、投递、分页事实查询、排队取消与定向中断；原生完成、交付回执和界面 ready 不相互替代。
- 真实验证：两种 runtime 的完成、原生输出、当前中断、迟到中断拒绝、原生失败与关闭后历史读取通过；Claude 控制故障从三次重复执行降为一次，所有专用进程已退出。[Research](research.md#t2-执行事实验证) 保留分次实验、失败原因和修正后的证据，默认权限及原生配置继承未改动。
- 回归：Runweft typecheck、20 项测试通过；HAPI 全量 typecheck 和 gen:fixtures 通过、无生成漂移。CLI 2,953、Hub 1,379、Web 3,249、shared 323、relay 118 项通过，原有 CLI 11/Hub 3 项跳过。全量命令曾依次暴露标题测试缺少新事件 mock、无 localId 的首次消息被重复投递保护拦截；均已修正。CLI 使用修正 mock 后的完整通过结果，Hub 修正后重跑全包及其余包全部通过，未将中途失败的总命令记为退出 0。日志 `.dev-smoke/hapi-foundation-t2/`，临时目录已清理。
- 契约：[HAPI 执行观察与定向中断](../../../../hapi/docs/api/execution-observations.md)。本任务不宣称完成后续宿主角色或业务委派。
- Commit：HAPI `hapi-subagent-foundation T2: correlate native execution and target interrupts`；Runweft `hapi-subagent-foundation T2: expose native facts and targeted control`。
