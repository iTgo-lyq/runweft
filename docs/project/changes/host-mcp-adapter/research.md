# 宿主身份、会话读取与旧交互核对

> 调查日期：2026-09-29
> 证据区分官方资料、源码、历史记录与以下本机协议实验；后续实验已执行真实模型任务，未修改用户全局配置。

## Claude Code

[官方环境变量](https://code.claude.com/docs/en/env-vars)说明 `CLAUDE_CODE_SESSION_ID` 提供给 stdio MCP 子进程；显式 `--resume <id>` 使用恢复的 ID。MCP 进程保留启动时的值，`--continue`、无 ID 的 resume 可能先给初始 ID，不能据此断言后续会话身份永远不变。

[Hooks](https://code.claude.com/docs/en/hooks)提供 session_id、cwd、transcript_path；原生子 agent 的相关工具事件另有 agent_id。它们可补充绑定与角色判定，但 hook 事件不自动变成每个 MCP 请求的元数据。transcript 异步写入，不用文件暂未更新推断任务结束。

[会话 SDK](https://code.claude.com/docs/en/agent-sdk/sessions)公开会话枚举、消息读取与 resume；缺少原生 session 时，也可把已有结果和上下文交给新 session。优先核对 HAPI 已有扫描和恢复路径，不在 Runweft 再维护一套原生会话索引。

[MCP 文档](https://code.claude.com/docs/en/mcp)说明 stdio 可得项目根且支持工具列表更新。MCP 传输会话不等于 Claude 对话 ID；多个原生子 agent 是否共享一条工具连接、能否得到不同工具列表仍需协议验证。仅通过 hook 拦截子调用，不等于已经做到按角色返回列表。

初次调查只查询 Claude Code `2.1.269` 版本；后续真实实验见下文，不以该初次记录作为当前验证范围。

## Codex

旧工程 `apps/runweft/src/gateway.ts` 从调用 `_meta["x-codex-turn-metadata"]` 读取 session_id/thread_id，并与顶层 threadId/callId 校验。旧 `codex-task-result-loop/execution.md` 记录曾在 Codex `0.154.0` 实测该结构；这是历史版本证据。本机 `0.156.1` 的后续协议实验见下文。

[当前 App Server 文档](https://learn.chatgpt.com/docs/app-server)提供 thread/read、thread/resume 和 thread/fork，并说明 thread/session 身份。普通 fork 也可能沿用根 sessionId；不能照搬旧 `threadId !== sessionId` 就拒绝的规则，把所有 fork 一概当作 subagent。应结合原生来源及 Runweft/HAPI 的创建关联判定。

[当前 MCP 文档](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)未明确承诺上述调用元数据就是 tools/list 的身份载体。调用身份与首次工具发现需分别验证；Runweft 受控子进程可在发现工具前绑定角色，宿主原生子线程共享连接的情形不可想当然。

## 旧工程可参考的行为

核对本地存档 `apps/runweft/src/gateway.ts`、`packages/coordinator/src/coordinator.ts` 及历史执行记录：

- 派生持久接受后返回任务身份，list/wait 读取状态与结果，follow-up 串行处理。
- 结果随工具响应返回；旧 Gateway 明示不能在主 agent 结束 turn 后自动唤醒它。内部事件通知 waiter 不是宿主消息注入。
- 旧实现注册固定七个工具，并以 Codex 调用元数据识别 root；没有证明 Claude 宿主或按角色动态工具列表已实现。
- 旧 daemon、owner/token 模型、managed-v1、锁和 HAPI 补丁不成为新方案前置。

## 当前 HAPI 可复用入口

本节是基于 `86c88df93baf5d1f738dd4b202078bdf6dec376e` 的初次调查；当前固定版本为 `cb2810dc09b0eeb831f4ed81930a506397992967`，后续核对见下文：

| 入口 | 已见行为 | 本项目处理 |
| --- | --- | --- |
| `cli/src/claude/runClaude.ts` | 原生 session hook 与会话关联 | 优先复用，按 MCP 需要暴露已有身份 |
| `cli/src/claude/claudeLocal.ts`、`sdk/query.ts` | cwd、resume、附加 MCP/settings 与环境继承 | 不重写 Claude launcher，核对最小角色绑定入口 |
| `cli/src/codex/shared/root.ts` | 原生 thread 读取、resume 和共享 runtime 管理 | 会话读取沿 HAPI；结束子任务不能杀掉承载其他会话的共享进程 |
| Hub 会话、消息与事件接口 | 现有状态、结果展示及执行控制基础 | MCP 和看板以这些事实为来源，不另建执行状态机 |

需要补充的调查是：HAPI 哪个已有入口可在首次 MCP tools/list 前带出受控子身份，以及每种宿主原生子会话如何实现工具可见性。只给这些具体缺口增加适配，不先定义另一套 runtime/会话协议。


## 首次发现与原生子会话实测

2026-09-29 在专用 cwd 测试 Codex `0.156.1`、iclaude/Claude Code `2.1.283`。只开放无副作用 MCP 探测工具，真实主会话各派生一个原生子会话；Codex 使用专用 CODEX_HOME 及既有模型配置副本，Claude 通过本次启动参数加载专用 MCP/hooks，不写全局设置。日志只记录协议方法、身份白名单和工具名，不保存凭据、完整环境、源码或任务 prompt。汇总 `.dev-smoke/host-probe/evidence.json`，详细协议在各实验目录。

| 场景 | 实测结论 | 证据 |
| --- | --- | --- |
| Codex 首次 initialize/tools/list | stdio 环境没有当前线程 ID；initialize 只有版本/能力/客户端信息，tools/list 只有 progressToken，没有线程/角色 | `a0639bc1/codex/protocol.jsonl` |
| Codex tools/call | 同时携带顶层 threadId/sessionId/callId 与 x-codex-turn-metadata；本版本 nested metadata 是对象，不能只接受字符串。父为 thread_source=user；子为 subagent，带 parent_thread_id，root session_id 相同而 thread_id 不同 | 同上 |
| Codex 原生子发现 | 子使用新的 MCP stdio 进程，但首次发现同样无身份；仅根据父进程、cwd 或继承环境不能区分并发 root/child | 同上，两个 MCP PID 均已退出 |
| Claude 首次发现 | stdio 环境有 CLAUDE_CODE_SESSION_ID；initialize/tools/list 不含逐工具调用身份 | `a0639bc1/claude/protocol.jsonl` |
| Claude 原生子调用 | 父 probe_parent 与子 probe_report 到达同一个 MCP PID，期间无新的 tools/list。子报告看到了 probe_parent；逐调用只有 claudecode/toolUseId/progressToken，没有 agent_id | 同上，进程已退出 |
| Claude hook 关联 | PreToolUse 在父调用无 agent_id，子调用有 agent_id/type；tool_use_id 分别与实际 MCP claudecode/toolUseId 相同，可建立可信逐调用角色；同 cwd 无需猜会话 | `019c9b58/claude/hooks.jsonl` 与 `protocol.jsonl`，进程已退出 |
| Claude 子调用拒绝 | 子会话一次 probe_parent 在 PreToolUse 被拒绝，该 tool_use_id 未到达 MCP；父 probe_parent 和随后父 probe_report 正常。未将它描述为工具隐藏或子汇报成功 | `fb561a83/claude/`，进程已退出 |
| Codex 动态列表候选 | 初始只给 probe_context；调用后按真实 metadata 判主/子并发送 tools/list_changed，客户端没有重新 tools/list，后续能力没有变为可用。两会话仅各调用 probe_context | `0f324abe/codex/protocol.jsonl`，进程已退出；不把 exit 0 或模型 DONE 当作流程成功 |

动态列表候选第一次 `65f16809` 的探测服务误将对象 metadata 直接 JSON.parse，导致退出；修正为兼容对象/字符串后重新测试得到上表限制。该失败不作为宿主限制证据。实验曾声明 `codex/tool-catalog-cache: {cacheable:false}`；本地 Codex 源码明确其为测试实验能力、非生产接口，因此不以它作为产品依赖。

### 官方资料与源码核对

- [Claude subagent](https://code.claude.com/docs/en/sub-agents#scope-mcp-servers-to-a-subagent)：按名称引用 MCP 会共享父连接；inline server 可建立独立连接，工具过滤可写入具体 agent 定义。后者要求控制这些定义，不能替代所有用户自定义及内置原生子会话的统一按角色过滤。
- [Claude hooks](https://code.claude.com/docs/en/hooks#common-input-fields)：agent_id 仅出现在子调用；PreToolUse 能拒绝调用。SubagentStart 可注入上下文，没有单独修改其 MCP 工具列表的契约。
- [Claude MCP](https://code.claude.com/docs/en/mcp#dynamic-tool-updates)：列表更新针对连接；共享连接不因此获得每个子会话的独立视图。
- [Claude 环境变量](https://code.claude.com/docs/en/env-vars)：stdio 保留初始 session ID；`/clear` 与交互续接需以 hook 最新身份为准，不能按启动环境永久绑定。
- Codex 本地源码研究样本 `/home/tiger/workspace/codex-multiruntime` revision `f8843555e`，`codex-rs/codex-mcp/src/rmcp_client.rs` 的 initialize/list 与本机协议证据一致。研究样本不是本项目执行依赖，也不声称与已安装程序构建完全相同；运行结论以真实二进制实验为准。

### 工具可见性边界的确认

用户既定要求是子会话隐藏派生工具并在调用时再次拒绝；整体评审曾明确不能用调用拒绝假称可见性已完成。现有两宿主的公开路径没有满足所有原生子会话首次工具发现分流的证据，且本次实验给出了具体限制。

用户后续明确选择更简单的边界：HAPI 调度的 Runweft subagent 移除全部 Runweft MCP 工具；subagent 自己调用原生内置 subagent 不管控。该决定取代此前所有原生子会话动态工具列表分流与子端 MCP 汇报的要求，原阻塞已解除。以上实验保留为历史依据，不再作为需补齐的能力。

## 受控启动入口核对

当前固定 HAPI `cb2810dc` 的机器 spawn 可指定 cwd、runtime、模型和权限等，但没有逐执行附加 MCP 配置/环境参数。Claude 原生 SDK 已接受 mcpServers，HAPI 已有 HAPI_SESSION_ID；Codex 共享 root 已在原生 thread 配置注入自己的 hapi MCP 和 shell 的 HAPI_SESSION_ID，但 engine 全局环境明确删除该 ID。因此不能假定全局 Runweft MCP 进程在首次发现时已经拿到 HAPI 子身份。

受控子列表的候选最小增补是复用上述已有原生配置入口，在管理层承载逐执行的 MCP 启动上下文，而非重写 runtime。业务方先提供子角色，不能让模型自报，也不能依赖尚未创建的 delegation 记录猜测。

## 全局安装隔离实验

`.dev-smoke/host-install-probe-7xompx2s/` 使用完全独立 CODEX_HOME/CLAUDE_CONFIG_DIR，原生命令均未接触真实客户端设置：

- Codex mcp add 同名会更新，remove 只删除该 server；其他 MCP、model 与原有注释保留。
- Claude mcp add-json --scope user 首次成功、同名第二次退出 1；remove 成功。CLAUDE_CONFIG_DIR 下的全局文件为 `.claude.json`；原生命令还写入 firstStart/machineID/migration 等字段并创建备份。
- 安装封装不能简单盲调两类客户端 add 当作幂等。候选做法：Codex 使用专用 staging 目录复用原生编辑器并核对差异；Claude 对 JSON 仅合并自身 MCP/hook 条目。原文件写入前备份至 Runweft 持久目录，变更后重新校验；不将暂存过程的原生迁移字段带回用户配置。

## 结果通知边界

[Claude MCP channels](https://code.claude.com/docs/en/mcp#push-messages-with-channels)要求启动时通过 channels 明确启用；普通全局 MCP 注册不等于获得推送能力。[asyncRewake hook](https://code.claude.com/docs/en/hooks#run-hooks-in-the-background)提供在线唤醒候选，但需单独实测；普通异步 hook 结果等下一轮交互。本 Change 先保证工具响应、等待与取消传递，主动唤醒仅对实际接通路径声明，不把列表刷新作为完成通知。


### 逐线程配置与续接承载

`.dev-smoke/host-probe/per-thread-nkDvYo/evidence.json` 使用 HAPI 现有 CodexAppServerClient 启动一个原生 app-server，在同一 cwd 创建两条线程，分别传入不同 `mcp_servers.runweft_probe` 启动配置。没有提交 prompt 或执行模型请求：

- parent 的首次 tools/list 返回 probe_parent/probe_report；child 的首次 tools/list 仅返回 probe_report。
- 两个 MCP 进程收到各自独立 contextId，均早于任何工具调用取得正确配置；配置没有跨线程覆盖。关闭原生 app-server 后两个 MCP 进程均退出。
- 这是底层原生配置入口的真实验证，不是 Runweft/HAPI spawn 已支持该参数，更不证明原生自行派生的子会话会自动获得不同配置。
- 验证命令退出 0、证据 success=true；Bun 在退出后额外报告 tsconfig-override directory mismatch 的内部诊断，不影响已收到并核对的两条真实协议结果，未忽略此诊断。

源码定位进一步明确了后续增补范围：机器 REST SpawnSessionRequestSchema、Runner SpawnSessionOptions/buildCliArgs 和 Hub resumeSession 都没有传入附加 MCP 配置；Codex root.config 已经在 thread start/resume/fork 处注入 HAPI 自身 MCP，Claude runClaude 已把 mcpServers 交给既有 loop/SDK。不能只给首次启动加进程级环境，否则共享 Codex root 会混用，停止后由 Hub 重启也可能丢角色。

候选管理契约应在已有 HAPI 会话元数据中保留非秘密的启动上下文，spawn 与 resume 沿原有管理路径转交，在各 root/Claude session 的原生配置位置应用；工具条目只覆盖显式附加的同名入口，其他用户配置继承。上下文不携带模型凭据、不重新实现原生身份或执行状态。最新确认将管理需求收敛为逐执行禁用 Runweft MCP，具体方案纳入本 Change Technical/Plan；当前未修改 HAPI 源码。

## 指定 MCP 工具禁用的启动与续接验证

按最新边界，在专用环境验证 Codex `0.156.1`、iclaude/Claude Code `2.1.283`：

| 场景 | 原生入口与实际结果 | 本机证据 |
| --- | --- | --- |
| Codex 同一 app-server 的两个 root | 各线程分别设置 `mcp_servers.runweft_probe.enabled`；parent 正常发现探测工具，child 不启动该 server。另一个 keep_probe 在两线程均正常发现 | `.dev-smoke/host-probe/disabled-server-94nOob/evidence.json` |
| Codex 停止进程后恢复同一线程 | 先完成真实原生 turn，再关闭 app-server，重新启动并通过 thread/resume 重施禁用配置；原 thread ID 不变，keep_probe 正常发现，runweft_probe 未启动 | `.dev-smoke/host-probe/disabled-resume-rcH0xm/evidence.json` |
| Claude 首次启动 | 原生 `--disallowedTools mcp__runweft_probe__*`；system/init.tools 无该 server 工具，仍有 keep_probe 和内置 Task（Agent）工具；实际成功调用 keep_probe | `.dev-smoke/host-probe/0dd4a623/claude/evidence.json` |
| Claude 退出后显式 resume | 重施相同过滤参数，恢复原 session ID；原生工具列表继续无 runweft_probe，其他 MCP 调用成功，内置 Agent 仍在 | `.dev-smoke/host-probe/59c05f9c/evidence.json` |

Claude 仍会连接被过滤工具的 MCP server；验证的是模型不可见、不可调用这些工具，不宣称 server 进程未启动。上述实验没有限制内置 agent 工具；也没有测试或管控原生子 agent 的后续行为。

四次验证均退出 0，工具进程均已退出；两次 Codex 探测仍有上节记录的 Bun tsconfig-override 内部诊断。没有修改用户全局配置。原生入口的可行性已确认，HAPI spawn/resume 的持久参数传递尚未实现，不能把原型证据描述成完整产品验收。

实施前再核对固定 HAPI 源码：`claudeRemote.ts` 的 additionalArgs 经过 metadataExtractor 的 catalog 白名单，当前不保留 `--disallowedTools`；SDK 同时已有逐轮 EnhancedMode.disallowedTools。实现必须在 launcher 的现有 SDK 选项中合并持久禁用项，覆盖首次、原生重启和扫描，不能仅追加 claudeArgs。Codex 的 shared runtime 已把初始创建与 native `/new` 分开，禁用表应只交给对应 root 的 bootstrap，不写共享 launch.serverArgs。

## Plan 评审后的配置形态核对

iclaude 指出先前 Codex 探测传入完整定义，不能证明缺少原条目时只写 enabled=false 有效。`.dev-smoke/host-probe/disabled-definition-bgpy3F/definition-evidence.json` 已在真实 Codex 0.156.1 复现：缺条目时叶字段禁用报 invalid transport；已有 stdio 或 HTTP 条目时可用。改为整个 server 的 `{command:'hapi-disabled-mcp-placeholder', enabled:false}` 配置后，三种情况均成功启动，不需要读取用户配置来猜 transport。

冷续接第一次探测试图用空 gitInfo 物化无输入线程，被原生明确拒绝；第二次填写 gitInfo 后仍未产生可恢复 rollout。没有把这两次当成功或重复提交任务；后续用真实的无工具简短 turn 生成历史，再验证冷续接。HAPI 已有执行验收覆盖有输入历史的续接，不能由此次空历史探测推断该能力失效。

最终 `.dev-smoke/host-probe/disabled-definition-resume-OZDQDF/definition-evidence.json` 为 success=true：三种完整禁用定义各完成真实 turn，关闭 app-server 后重启，逐一恢复相同 thread ID 成功。命令退出 0，仍附带已记录的 Bun tsconfig-override 内部诊断。原生可行性缺口关闭；HAPI 产品承载仍由 T1 验收。
