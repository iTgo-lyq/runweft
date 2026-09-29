# 宿主 MCP 适配执行概况

## Plan 评审与复核

- 评审：当前工作区 iclaude 会话 `10608b31-2df0-4755-88f0-0d483fb96229`，2026-09-29 10:59–11:06（Asia/Shanghai），退出 0、结果 success。只读源码和文档，未委派其他 agent；本 Change 的一次 Plan 评审已完成，不再重复。
- 原始材料：本机 `.dev-smoke/reviews/host-mcp-adapter/`；本文保存复核结论。

| 意见 | 主 agent 处置 |
| --- | --- |
| Codex 没有原 MCP 条目时 enabled=false 可能配置失败 | 采纳并实测复现 invalid transport；改为完整禁用定义，在原条目不存在、stdio、HTTP 三种情况核对启动与冷续接 |
| 原生参数实验不等于 HAPI 续接能力 | 原文描述的是原生实验，Research 已区分；进一步在 Technical 显式写明 HAPI 承载待 T1 验证 |
| resume 不需要重复传递禁用表 | 采纳。当前 Hub 使用 existingSessionId 重开原行；bootstrap 保留 metadata，launcher 从该 metadata 读取。保留恢复前 Runner 能力检查，不新增第二个 resume 配置来源 |
| Claude 默认 MCP 与 settings 路径不同 | 采纳，明确有/无 CLAUDE_CONFIG_DIR 两套路径，并加入临时 HOME 验证 |
| hook 短期记录需覆盖审批等待 | 采纳，用后删除；未消费记录保留 24 小时，并加入延迟审批验证 |
| 多 cwd 需覆盖同一 Codex app-server | 采纳，纳入 T2 真实宿主验证，不新增任务 |
| 文档入口及历史 revision 易混淆 | 采纳，补 Technical/Plan 入口，标明历史调查和当前固定版本，更新过时“工具分流”表述 |

评审同时确认 Change 独立边界、HAPI 原生落点、安装维护体验和结果通道可行。Claude remote 参数过滤的源码缺口已在评审期间修正为现有 SDK 选项合并；不改写 SDK 查询循环。

## T1 HAPI 受控执行的 MCP 工具禁用

- 结果：HAPI 新增逐执行 `disabledMcpServers`，沿原有 spawn 回执、Runner 和原生启动链路传递并保存 metadata；续接读取同一 metadata。Codex 配置只作用于目标 root，Claude 合并原生 disallowedTools。Hub/Runner 声明能力，Runweft 在不支持的 Hub 前拒绝请求；参数变化触发已有 requestId 冲突检查。未增加执行循环或修改权限默认值。
- 真实验证：Codex 0.156.1、iclaude/Claude Code 2.1.283，专用配置及数据目录。两者经真实 HAPI 源码启动、调用另一个 MCP、停止并续接相同原生 ID，均无 Runweft 工具；Codex 同一共享 runtime 中无关 root 仍有 Runweft 工具，原条目不存在时也通过启动/续接；Claude init 列表保留原生 Task 与 HAPI 工具。证据 `.dev-smoke/host-mcp-t1/run-vvoj9I/evidence.json`，清理无错误、无探针残留。此为源码链路验证，编译组合留给 T4。
- 回归：Runweft `bun run typecheck`、`bun test ./test`（25 项）通过；HAPI `bun run typecheck` 通过，完整 CLI/Web/Hub/Shared/Relay 分别通过 2965/3249/1383/323/118 项，CLI 11、Hub 3 项既有跳过；`bun run gen:fixtures` 无差异。对应日志集中在 `.dev-smoke/host-mcp-t1-*.log`。
- 修正：首次全量测试暴露旧 launcher mock 缺少 metadata getter 和 OpenCode 精确位置参数断言缺少新增可选位，均补齐。CLI 首次运行另有 worker 意外退出，限制 4 个 worker 的完整重跑通过。首轮真实 Codex 实验等待只读 MCP 审批而超时；按原生请求批准专用探针后完整重跑通过，未放宽默认权限。Bun `--tsconfig-override` 源码入口退出时打印其 directory mismatch 诊断；最终进程退出 0，未据此忽略执行状态或清理验证。
- 提交：HAPI 独立 Commit `feat: preserve per-session MCP tool filtering across spawn and resume`，随后固定 Runweft revision。
- Commit：`host-mcp-adapter T1: preserve MCP filtering across managed execution`
