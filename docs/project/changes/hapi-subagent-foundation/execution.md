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

- 进展：评审与基线证据已完成，正在实施持久回执与类型化调用。
- 验证：实现检查尚未运行；基线和故障复现见 [Research](research.md#故障复现与基线检查)。
