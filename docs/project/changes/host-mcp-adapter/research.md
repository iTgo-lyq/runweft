# 宿主身份、会话读取与旧交互核对

> 调查日期：2026-09-29
> 证据分为官方文档、当前 HAPI 源码和旧工程记录；未执行真实模型任务或修改用户配置。

## Claude Code

[官方环境变量](https://code.claude.com/docs/en/env-vars)说明 `CLAUDE_CODE_SESSION_ID` 提供给 stdio MCP 子进程；显式 `--resume <id>` 使用恢复的 ID。MCP 进程保留启动时的值，`--continue`、无 ID 的 resume 可能先给初始 ID，不能据此断言后续会话身份永远不变。

[Hooks](https://code.claude.com/docs/en/hooks)提供 session_id、cwd、transcript_path；原生子 agent 的相关工具事件另有 agent_id。它们可补充绑定与角色判定，但 hook 事件不自动变成每个 MCP 请求的元数据。transcript 异步写入，不用文件暂未更新推断任务结束。

[会话 SDK](https://code.claude.com/docs/en/agent-sdk/sessions)公开会话枚举、消息读取与 resume；缺少原生 session 时，也可把已有结果和上下文交给新 session。优先核对 HAPI 已有扫描和恢复路径，不在 Runweft 再维护一套原生会话索引。

[MCP 文档](https://code.claude.com/docs/en/mcp)说明 stdio 可得项目根且支持工具列表更新。MCP 传输会话不等于 Claude 对话 ID；多个原生子 agent 是否共享一条工具连接、能否得到不同工具列表仍需协议验证。仅通过 hook 拦截子调用，不等于已经做到按角色返回列表。

本机只运行版本查询：Claude Code `2.1.269`。未启动真实 agent，未验证 `/clear`、原生子 agent 或 MCP 动态列表。

## Codex

旧工程 `apps/runweft/src/gateway.ts` 从调用 `_meta["x-codex-turn-metadata"]` 读取 session_id/thread_id，并与顶层 threadId/callId 校验。旧 `codex-task-result-loop/execution.md` 记录曾在 Codex `0.154.0` 实测该结构；这是历史版本证据，本机 `0.156.1` 只查询了版本。

[当前 App Server 文档](https://learn.chatgpt.com/docs/app-server)提供 thread/read、thread/resume 和 thread/fork，并说明 thread/session 身份。普通 fork 也可能沿用根 sessionId；不能照搬旧 `threadId !== sessionId` 就拒绝的规则，把所有 fork 一概当作 subagent。应结合原生来源及 Runweft/HAPI 的创建关联判定。

[当前 MCP 文档](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)未明确承诺上述调用元数据就是 tools/list 的身份载体。调用身份与首次工具发现需分别验证；Runweft 受控子进程可在发现工具前绑定角色，宿主原生子线程共享连接的情形不可想当然。

## 旧工程可参考的行为

核对本地存档 `apps/runweft/src/gateway.ts`、`packages/coordinator/src/coordinator.ts` 及历史执行记录：

- 派生持久接受后返回任务身份，list/wait 读取状态与结果，follow-up 串行处理。
- 结果随工具响应返回；旧 Gateway 明示不能在主 agent 结束 turn 后自动唤醒它。内部事件通知 waiter 不是宿主消息注入。
- 旧实现注册固定七个工具，并以 Codex 调用元数据识别 root；没有证明 Claude 宿主或按角色动态工具列表已实现。
- 旧 daemon、owner/token 模型、managed-v1、锁和 HAPI 补丁不成为新方案前置。

## 当前 HAPI 可复用入口

源码基于 `86c88df93baf5d1f738dd4b202078bdf6dec376e`：

| 入口 | 已见行为 | 本项目处理 |
| --- | --- | --- |
| `cli/src/claude/runClaude.ts` | 原生 session hook 与会话关联 | 优先复用，按 MCP 需要暴露已有身份 |
| `cli/src/claude/claudeLocal.ts`、`sdk/query.ts` | cwd、resume、附加 MCP/settings 与环境继承 | 不重写 Claude launcher，核对最小角色绑定入口 |
| `cli/src/codex/shared/root.ts` | 原生 thread 读取、resume 和共享 runtime 管理 | 会话读取沿 HAPI；结束子任务不能杀掉承载其他会话的共享进程 |
| Hub 会话、消息与事件接口 | 现有状态、结果展示及执行控制基础 | MCP 和看板以这些事实为来源，不另建执行状态机 |

需要补充的调查是：HAPI 哪个已有入口可在首次 MCP tools/list 前带出受控子身份，以及每种宿主原生子会话如何实现工具可见性。只给这些具体缺口增加适配，不先定义另一套 runtime/会话协议。
