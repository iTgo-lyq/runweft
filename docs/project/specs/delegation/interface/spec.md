# 委派入口

CLI 与 MCP 使用同一 TaskClient、认证和中心协调能力。支持 Codex/Claude Code 主宿主，执行 flavor 由 Agent 定义所选 runtime 决定，两者可以不同。工作区支持[本机 shared/worktree](../../local-workspace/mode/spec.md)。

## MCP 工具

| 工具 | 契约 |
| --- | --- |
| `list_agent_definitions` | 当前工作区的有效定义、来源和在线目标资格，不启动执行 |
| `spawn_agent` | `agent_type`、`message`、可选 UUID `request_id`、`workspace_mode`（默认 shared）；worktree 可指定 `base_ref`（默认 HEAD）；持久接受后立即返回 agent_id、round_id、request_id、revision、accepted |
| `list_agents` | 当前原生父会话的任务概览和最近 20 条接受记录 |
| `read_agent` | `id`、可选 `round_id`、`offset`、`limit`；读取轮次事实、报告和待审批请求 |
| `wait` | `ids` 为 1–8 个任务；`timeout_ms` 为 0–540000，默认 30000；可传各任务的 `after_revision`，语义见[结果](../results/spec.md) |
| `send_input` | `id`、`message`、可选 request_id；默认 `mode=next`，`mode=steer` 要求 `round_id` |
| `interrupt_agent` | `id`、`round_id`；请求取消固定轮次，不把 requested 当作已停止 |
| `retry_finish` | `id`、`round_id`；修复工作区错误后显式重试 Git 封存，不重发原生任务 |
| `retry_artifacts` | `id`、`round_id`、可选 request_id；重传已捕获的失败文件候选 |
| `collect_artifacts` | `id`、`round_id`、files、可选 request_id；静止任务补收文件并生成新清单版本 |
| `respond_to_permission` | `id`、`round_id`、原生 `request_id`、`decision=approved/denied/abort`、可选原生 answers |

保留 runweft_status。一次工具取消、超时或 stdio 关闭仅取消该次请求/等待，已接受任务由中心继续处理；返回工具结果是主上下文取得报告的路径，不承诺后台唤醒或新宿主自动接回已关闭的原父身份。

spawn/next 可传 inputs[{artifactId,name?}] 和 outputs[{name,relativePath}]，每轮独立，steer 不接受附件。upload_artifact/read_artifact/download_artifact 见[持久文件](../../artifacts/spec.md)；文件操作接受记录同样进入 list_agents，read_agent/wait 展示文件交付与留存事实。

## CLI

`task spawn/list/show/wait/send/interrupt/permission/retry-finish` 对应上述能力。spawn 可选 `--workspace-mode worktree --base <ref>`；`task workspace remove` 是显式操作者清理入口，不提供 MCP 删除工具。任务文本来自 `--message` 或 `--message-file`，`-` 读 stdin；派生/追加先向 stderr 输出 request ID，JSON 模式为进度 JSON 行，接受结果在 stdout。重试使用 `--request-id`，不维护额外客户端任务数据库。

列表默认当前发起机器和 cwd，包含 MCP 来源；`--all` 列当前 namespace。show 默认最新接受轮次，可指定 `--round` 与报告 `--offset/--limit`；wait 支持 `--timeout/--after-revision`。send 默认下一轮，`--steer --round` 才追加本轮。interrupt 和 permission 必须指定轮次；permission 还需原生请求 ID，可附 `--answers`。

CLI 使用当前连接的本机 Runner 身份作为操作者来源，不伪装原生父会话；没有本机身份时提示先 start。MCP 只能操作自己的父会话任务，CLI 操作者可操作同 namespace 的既有任务。完整示例见[使用说明](../../../../usage.md#本机任务)。

spawn/send 支持可重复 --input/--output；`task artifacts show/retry/collect/release` 提供历史版本、传输恢复、补收及显式留存释放。清理仍是 CLI 操作者入口，不新增 MCP 删除工具。
