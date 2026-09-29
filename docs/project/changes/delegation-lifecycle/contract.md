# 协作接口与用户流程

> 归属：[Technical](technical.md)。本文件描述待实现契约，不是当前 Spec。

## MCP

| 工具 | 输入与结果 |
| --- | --- |
| `list_agent_definitions` | 在线返回当前项目有效定义及各自目标可选状态，沿 AgentClient 批量解析 |
| `spawn_agent` | agent_type（定义 id）、message、可选 request_id；当前 workspace_mode 仅 shared。接受后立即返回 agent_id（delegation ID）、round_id、request_id、revision 与原生状态尚待确认的说明 |
| `list_agents` | 当前原生父会话派生的子任务及最近接受记录，带 request_id、轮次、顶层状态与需关注原因 |
| `read_agent` | id、可选 round_id；返回执行/收尾/交付/审批、报告与原生引用，长文本可按 offset/limit 读取 |
| `wait` | ids（1–8 个）、timeout_ms（0–540000，默认 30000）、可选每 id 的 after_revision；任一指定子任务进入终态或需要处理时返回，超时返回 timed_out=true 和最新概览；完成时内联有界报告，始终附 revision |
| `send_input` | id、message、mode=next（默认）或 steer、可选 request_id。next 串行排下一业务轮次；steer 需 round_id，只允许当前活跃 Codex round，不修改后续排队轮次 |
| `interrupt_agent` | id、round_id；取消指定业务轮次；执行中优先按输入/executionId 定向中断，再关闭本轮 session。未知原生结果也可显式请求关闭，仍保留原生 unknown；只有停止确认后才将业务轮次标为已中断。返回 requested 不冒充终态，不命中其他轮次 |
| `respond_to_permission` | id、round_id、原生 request_id、decision=approved/denied/abort、可选原生 answers；只响应仍属于该活跃 round 的真实请求，不改默认权限模式 |

保留 `runweft_status`。工具只返回当前调用结果，MCP 取消/断线仅终止当前等待；已接受任务由中心继续收尾。返回报告即为主 agent 获得结果的基础路径，不把内部通知或日志当成后台唤醒。

请求身份：显式 request_id 为 UUID；MCP 省略时由原生 host/nativeSessionId/callId/操作生成稳定 UUID。语义摘要只包含原始意图（agent_type/message、父身份/cwd 与模式），不包含后来解析的可变快照。中心在重新核对资源前先命中 request_id；同 ID 同意图返回原接受记录，冲突明确报错。重新发起的另一个原生 tool call 是新意图；遇到模糊接受结果先 list_agents 查看最近接受记录和 request_id，再用同 ID 重试读取原接受结果，不凭相似文本猜重试。客户端为支持 Agent 文件后来修改/删除的场景，会先只读查询已知 ID，再决定是否需要解析新定义；不维护额外客户端任务库。

## CLI

`runweft task` 提供 spawn/list/show/wait/send/interrupt/permission：

- `task spawn <agent> --message <text>`，或 `--message-file <path>`（`-` 读 stdin）；可传 `--request-id`，无则先生成并在发请求前输出到 stderr（JSON 模式为进度 JSON 行），丢响应提示用同一 ID 重试；不新增本地接受记录表。
- `task send <id> --message ...` 默认下一轮；`--steer --round <id>` 明确本轮追加。
- `task show <id> [--round <id>]`、`task list`；列表默认当前发起目录，可 `--all` 查看 namespace 全局概览，作为简单看板的后台基础。
- `task wait <ids...> [--timeout <ms>]`；JSON 支持游标，人工输出显示状态/报告与下一步，不每秒刷屏。
- `task interrupt <id> --round <id>`；`task permission <id> --round <id> --request <native-id> --decision ...`。

CLI 明确是操作者入口，来源由当前连接机器身份/cwd 得到，不提供任意 --host-session 冒充原生身份。两种入口使用同一委派客户端与服务端约束。受控子 shell 无论是否显式指定 task ID，都拒绝新增或追加 Runweft 委派；不会限制其原生内置 subagent。

Codex 受管 MCP 条目配置 tool_timeout_sec=600；wait 上限 540 秒，HTTP/工具自身留出返回余量。Claude 使用其原生超时行为并做真实验证。升级后旧注册若未更新，命令提示重新运行 mcp install，不静默修改原生配置。

当前共享模式要求所选 runtime 位于发起机，Hub 连接不豁免。发起目录必须真实存在，不创建目录、初始化 Git、提交或清理。未支持的 worktree/remote 模式明确返回 capability_unavailable，不能回退共享。续接绑定既有环境与目标，后来编辑 YAML、改绑 Agent 或切换 cwd 不重定向旧任务；想换目标需新派生。

## 查询与报告

概览提供顶层 status=running/needs_attention/completed/failed/interrupted/unknown 和 attention（原因、下一步、原生审批 ID），由以下事实推导；只有停止及模式收尾满足后才返回完成状态，不能把原生 completed 直接当业务完成。wait 完成时附有界报告、structuredMissing 和分页提示，详细维度保留在 read_agent/show：

- 接受/准备：排队、准备就绪、启动/续接中，或明确失败/结果未知。
- 原生执行：未投递、已储存、submitted、accepted、等待审批、completed/failed/interrupted/unknown；附 HAPI session、输入 localId、executionId 和观察来源。
- 收尾：未开始、关闭进程中、已确认停止、阻塞；共享目录不需要 Git 成果封存。
- 交付：报告待收集/可读/无最终文本；共享文件保留原处。Git/附件交付当前 not_applicable。
- 接纳：主 agent/用户外部决定，工具不将执行成功冒充代码已合并。

正常轮次完成须满足本轮全部实际投递输入已获可靠终态、受控执行已确认停止，以及当前模式的收尾条件。显式 interrupt 可以在未知原生结果下关闭同一 session 并取消业务轮次，但必须确认停止、保留原生 unknown 和不完整报告标记，不能伪造原生 interrupted。审批请求、未知状态、关闭失败及时返回需关注原因，不把它们当成功。输出附当前状态与 revision，不带游标的 wait 观察调用开始时已接受的最新 round，不能被上一轮的历史完成立即满足；带 after_revision 则读取其后新的完成/需关注结果，每个 round 保存完成 revision，后续排队启动不会抹掉前轮通知。游标仅抑制已交付通知，不删除结果。

任务 prompt 由职责、程序确认的 cwd/目标、轮次任务组成，说明共享写入由主 agent 调度、不使用 Runweft 递归委派，原生工具按现有规则使用。请求末尾报告 summary/changes/tests/remaining（可选 fenced `runweft-report` JSON）；解析失败保留全部原生最终文本并标记 structuredMissing，不据文本猜执行成功。

报告默认返回有界文本并提示完整内容分页；任务输入/报告允许集中存储作为委派业务数据，普通日志不记录完整 prompt、用户源码或凭据。不复制完整原生 transcript 或隐藏推理。
