# HAPI 复用与项目重建依据

> 调查日期：2026-09-28；执行入口复核与真实探测：2026-09-29
> 用途：区分上游事实、旧实现与新项目决策；不代替需求或技术方案。

## 当前基线与真实探测

本 Change 调查基线 HAPI 为 `86c88df93baf5d1f738dd4b202078bdf6dec376e`、版本 `0.30.7`，与下文旧快照的 `2f72a80` 分开。Runweft 统一 CLI 已验收；本节直接使用其编译程序、原有 Hub/Runner 和未修改的内置适配。

2026-09-29 04:37–04:39（Asia/Shanghai），在 `.dev-smoke/hapi-execution-X0KVCh/` 的专用 HAPI home 和两个专用 cwd 进行原型验证。Codex CLI 为 `0.156.1`，Claude Code 为 `2.1.283`；Claude 沿现有 `HAPI_CLAUDE_PATH` 选择本机 iclaude，模型配置与认证沿已有原生环境，不复制凭据或修改全局配置。未传 yolo、permissionMode 或模型覆盖参数。

| 操作 | 实际观察 |
| --- | --- |
| 机器 spawn | 两种 runtime 都返回 HAPI sessionId，分别启动到指定 cwd |
| 投递与查询 | 使用自定义 localId 投递短标记请求；消息页保留 localId，queued-state 返回 invokedAt；两种 runtime 都返回真实模型标记回复 |
| 完成相关输出 | Claude 有 `turn_duration/resultSummary` 和 `ready`；Codex 有原生回复、用量与 `ready`，metadata 含 localId → native turnId 映射。这些字段不足以单独宣告可靠成功终态，见下节 |
| archive | HAPI 行变为 inactive/archived，对应 HAPI wrapper PID 已退出 |
| 停止后续接 | 重启测试服务后调用既有 resume，两种 runtime 本次都保留原 HAPI ID 和原生 session ID；新请求未重述标记，模型仍正确复述上一轮标记，并产生新的 ready |
| 再次关闭 | 续接后的 wrapper 均退出；测试结束后 `/proc` 中无使用该专用 HAPI home 的进程，服务定位文件已移除 |

原型及白名单字段摘要在 `.dev-smoke/hapi-execution-X0KVCh/{evidence,resume-evidence}.json`；不提交测试 home、凭据或完整 prompt。该结果验证了既有执行、关闭与原生续接链路，未覆盖审批、中断竞态、回执丢失、共享 runtime 的兄弟会话、首次 MCP 身份或真实远端协作，不代替本 Change 正式验收。

## 当前入口映射与待解决缺口

| 能力 | 当前 HAPI 入口及事实 | 下一步 |
| --- | --- | --- |
| 启动关联 | `POST /api/machines/:id/spawn` 在 Hub 内预分配 ID；[spawnSession](../../../../hapi/hub/src/sync/syncEngine.ts) 保留不确定启动的 stub，但公开请求没有调用方 requestId/预分配 ID，模糊异常也未返回关联 ID | 核对现有 CLI 会话创建/保留入口能否组合使用；否则只补可重查的启动关联，不另造启动器，也不通过同 cwd/时间猜测唯一会话 |
| 输入消费 | `/messages` 接受 localId，`/messages/queued-state` 返回 queued、indeterminate 和 invoked；Codex [queue](../../../../hapi/cli/src/codex/shared/queue.ts) 结合原生 clientUserMessageId/history 对账 | Claude [MessageQueue2](../../../../hapi/cli/src/utils/MessageQueue2.ts) 在出队时触发 consumed，不能把 invokedAt 一概解释为原生客户端已接受；继续核对原生 echo/result 关联和异常恢复语义 |
| 原生结果 | Claude [结果转换](../../../../hapi/cli/src/claude/utils/sdkToLogConverter.ts) 把 SDK result 转为 turn_duration，只保存用量、耗时和轮次数，未保存 subtype/is_error；Codex [projection](../../../../hapi/cli/src/codex/shared/projection.ts) 不向根会话持久投影 turn/completed 的 status，[root](../../../../hapi/cli/src/codex/shared/root.ts) 只发布无轮次身份的 ready | 缺口已由源码和实际返回字段共同确认；继续核对现有原生历史查询入口。若必须增补，应保留已有原生事实及输入关联，不由 Runweft 推断或维护竞争状态机 |
| 定向中断 | `POST /sessions/:id/abort` 不接受预期输入/轮次；[RpcGateway](../../../../hapi/hub/src/sync/rpcGateway.ts) 只发送 reason，Codex 收到后中断当时 currentTurn | 不能用调用前查询消除竞态；需核对可用的既有原子前置条件，必要时增补预期轮次校验，再测试迟到中断不会命中下一轮 |
| 关闭与续接 | 既有 archive 确认 StopSession，遇 still_alive/unknown 拒绝；resume 已实测保留原生历史 | 优先直接复用；后续验证同进程兄弟会话不受影响、缺失 session 和失败路径，不预设改造 |
| 无会话机器操作 | `apiMachine.ts` 已注册 common handlers，含 Git/文件/bash；Hub 的机器 REST 和私有 machineRpc 当前只暴露指定操作，不能直接把内部处理器存在视为上层已可调用 | 继续核对管理入口；公共 Git 与对象传输仍归对应 Change，不在这里新增另一套机器执行器 |

这些缺口的最小增补方案已记录在 [Technical](technical.md)；以下基线证据均来自未修改 HAPI。不得因为普通回复与 resume 成功，就把可靠轮次、初次工具发现身份或精确中断写为已验证。

## 故障复现与基线检查

2026-09-29 04:51，在独立 home/cwd 通过 `HAPI_CLAUDE_PATH` 运行可控 stream-json 测试客户端；它接收一次输入，输出 init 和根 assistant 片段后以 23 退出。一次 localId 投递实际启动了三个客户端进程、产生三个输出片段，证实 launcher 会重新投递消费状态不明的输入。archive 和测试清理后无残留进程。证据为 `.dev-smoke/hapi-failure-HZdvnI/evidence.json`；这是协议故障实验，不是真实模型验证，不使用凭据。

修改前 HAPI 全量 typecheck 通过。全量测试首次在 CLI 停止：2,945 通过、11 跳过、1 失败；唯一失败的 skills 用例要求临时 cwd 不在 Git 中，但测试 TMPDIR 位于本仓库 `.dev-smoke`。改用 `/home/tiger/.dev-smoke/` 下的独立临时目录后，该文件 28 项全部通过，目录已清理。Hub 1,371、Web 3,249、shared 323、relay 118 项分别通过。日志保留在 `.dev-smoke/hapi-foundation-baseline/`；这是组合基线证据，不宣称首次全量命令退出成功。

## Claude 原生输入关联

T2 前置试验在专用 cwd 使用 Claude Code 2.1.283 连续发送两条带 UUID 的 stream-json 输入，均正常结束。即使不启用 `--replay-user-messages`，原生 `command_lifecycle.command_uuid`、assistant/result 的 `user_message_uuid` 与 `user_message_uuids` 仍与传入 UUID 精确相同；每轮还发出独立 init。证据位于 `.dev-smoke/claude-correlation-probe/evidence.json`，只记录字段名称、关联 ID 和状态，不保存 prompt 或输出正文。可在既有 SDK 输入对象加 UUID 并保留这些原生关联，不需文本匹配或额外原生协议。

## T2 执行事实验证

2026-09-29 在专用 home/cwd 使用修改后的 HAPI 编译程序验证：

- Codex 正常完成、原生输出关联、拒绝上一轮中断、当前轮中断及 archive 后历史查询通过，证据 `.dev-smoke/execution-facts-bgLNPB/evidence.json` 的 Codex 项。该次 Claude 启动回执早于 capability metadata 更新，未通过首次就绪判断；Runweft 增加明确的就绪等待，超时保留 sessionId，不重新派生。随后 Claude 同组用例全部通过，见 `.dev-smoke/execution-facts-5I91Fl/evidence.json`。不把首次混合实验写为全部通过。
- 用不存在的测试模型触发真实原生错误；不修改模型配置文件或凭据。Codex 的 failed 已在 `.dev-smoke/native-failures-l5vWs7/evidence.json` 验证。Claude 原生实际返回 `subtype: success`、`is_error: true`、`terminal_reason: api_error`；据此修正已知 subtype 的映射，以 is_error 区分失败。修正后 Claude 失败及关闭通过，见 `.dev-smoke/native-failures-sRNYIj/evidence.json`。未知 subtype 继续保留未知。
- 原来“回复片段后退出 23”的同一可控故障实验，修改后仅启动一次客户端，不自动重投；持久事件为 submitted → accepted → unknown，证据 `.dev-smoke/hapi-failure-csyu2Y/evidence.json` 及其专用 HAPI 消息库。该实验仍是测试客户端，不能替代真实原生结果证据。
- 上述专用 HAPI home 对应进程均已清理。完成、失败、中断记录与现有输入消费信息分开保存；模型认证与默认权限继承路径未改动。

## T3 原生缺失复现

专用 HAPI home 写入两条仅用于试验的 archived 行，其原生 ID 为从未创建的 UUID；未修改现有原生历史。既有 resume 对 Claude 返回 success/active，对 Codex 返回 resume_failed 及 thread-not-loaded，见 `.dev-smoke/native-missing-LzLUJ8/evidence.json`。因此普通 resume 响应与错误不足以作为原生历史缺失依据。

Codex 0.156.1 的直接 JSON-RPC 试验显示，thread/read（includeTurns 真/假）对不存在 ID 返回 `code: -32600`、`thread not loaded: <id>`；thread/resume 才返回 `code: -32600`、`no rollout found for thread id <id>`。它没有专门的 not-found 数字码，不能把所有 -32600 或 not-loaded 都判为缺失。证据 `.dev-smoke/native-missing-rpc/evidence.json`；未发送 turn/start、输入或模型请求，查询进程已退出。采用精确错误组合，并使用与正式启动相同的 Codex 程序；其他协议版本若错误变化则保留失败，不自动构造新会话。

## T3 关闭与审批验证中的修正

- `.dev-smoke/native-missing-1ersGx/evidence.json`：修正后两种 runtime 都经实际 Runner/Hub 返回 native_session_missing，HAPI 行保留 inactive/archived；没有创建替代执行。
- `.dev-smoke/native-lifecycle-FfRAI0/evidence.json` 已证明 Codex 能读取专用项目说明与 skill 中未放进 prompt 的标记，但 fork 时 HAPI thinking 尚未刷新；等待现有空闲条件后又被“有排队消息”拒绝。调查确认新增 execution 事件的稳定 localId 缺少已有 agent 消息的 consumed 回执，将观察误当作输入。补齐同一回执路径，不改队列数据库或新增调度机制。
- `.dev-smoke/native-permissions-3dU4h3/evidence.json` 的 Codex 项通过 default 模式真实批准/拒绝：批准才生成指定测试文件。Claude 批准通过，拒绝后走既有 tool-result 提前退出，未取得原生终态。调查确认 SDK 迭代结束不会自行关闭进程；补齐已有 cleanup 的显式等待，停止得到确认后投影受控 interrupted，无法确认则保留 unknown。修正后 Claude 两种决策及目标文件副作用均通过，见 `.dev-smoke/native-permissions-7JKyFa/evidence.json`。

## T3 实际关闭、配置继承与续接

`.dev-smoke/native-lifecycle-gPHn0n/evidence.json` 记录两种 runtime 全部通过：由指定 cwd 自动读取项目说明及项目 skill，回复未出现在输入中的随机标记；archive 后对应 wrapper 退出；resume 保留原生 ID，未重述标记的第二轮仍能复述原标记；最后再次关闭并确认进程退出。Codex 在同一共享 wrapper 中 fork 后，关闭原会话仍可在兄弟会话执行真实输入，最后关闭兄弟才退出 wrapper。

该试验没有传权限覆盖或替换原生模型配置；认证、全局配置继承路径仍是现有启动器。审批试验单独显式选择 HAPI default 模式，既未扩大权限，也未修改全局配置。机器到原生会话的身份由实际 metadata、resume 返回 ID 和原生结果共同验证；Claude 的环境导出及 Codex 的按线程注入仍是源码证据，首次 MCP 角色发现按下一 Change 进行，不能提前声称已验证。

所有 T3 试验专用 HAPI home 已停止，按 `/proc` 环境中的专用 HAPI_HOME 查验无残留进程。全量回归和本任务提交见 [Execution](execution.md#t3-关闭续接与运行能力验证)。

## 仓库起点

旧 Runweft 主分支快照为 `0cbfa01f522488b2ede60e47adc1117698b54748`。新仓库独立初始化，仅迁入项目工作流并清除其不存在的委派 skill 依赖；不迁入旧应用代码、运行数据、HAPI 补丁、锁文件或认证产物。

旧仓库的三个 review 分支已保存在 GitHub 存档，其改动已以等价提交进入旧主分支；本地 review 工作区已清理。隐私验证副本的试验差异和恢复基线保存在存档 checkout 的 `.dev-smoke/review-worktree-snapshots/`，未上传，也不进入新项目。

## 已核对的 HAPI 能力

调查对象是旧仓库锁定的 HAPI `0.30.7`，提交 `2f72a8012ebe8632eb6a7ac697264ba970e7edde`。这是历史证据锚点，不是新项目已选择的依赖版本。

| 事实 | 一手证据 | 对需求的影响 |
| --- | --- | --- |
| CLI 和 Hub 使用 TypeScript / Bun | [CLI package](https://github.com/tiann/hapi/blob/2f72a8012ebe8632eb6a7ac697264ba970e7edde/cli/package.json)、[Hub package](https://github.com/tiann/hapi/blob/2f72a8012ebe8632eb6a7ac697264ba970e7edde/hub/package.json) | 扩展成本主要来自接口和生命周期耦合，不能归因于 Go |
| 有通用 backend 和 ACP 复用层 | [AgentBackend](https://github.com/tiann/hapi/blob/2f72a8012ebe8632eb6a7ac697264ba970e7edde/cli/src/agent/types.ts)、[DSH backend](https://github.com/tiann/hapi/blob/2f72a8012ebe8632eb6a7ac697264ba970e7edde/cli/src/dsh/utils/dshBackend.ts) | 新 runtime 可按现有源码结构接入并复用公共组件 |
| runtime 在命令、共享类型和 Runner 中静态注册 | [命令](https://github.com/tiann/hapi/blob/2f72a8012ebe8632eb6a7ac697264ba970e7edde/cli/src/commands/registry.ts)、[类型](https://github.com/tiann/hapi/blob/2f72a8012ebe8632eb6a7ac697264ba970e7edde/shared/src/modes.ts)、[Runner](https://github.com/tiann/hapi/blob/2f72a8012ebe8632eb6a7ac697264ba970e7edde/cli/src/runner/run.ts) | 当前采用源码内扩展，不宣称已有动态插件加载 |
| 原生恢复依赖各 runtime 的实现 | [DSH 会话](https://github.com/tiann/hapi/blob/2f72a8012ebe8632eb6a7ac697264ba970e7edde/cli/src/dsh/session.ts) | 接入协议成功不代表自动具备历史恢复或可靠任务终态 |
| 旧 Runweft 为可靠执行增加了 managed-v1 补丁 | [旧集成说明](https://github.com/iTgo-lyq/runweft-archive/blob/0cbfa01f522488b2ede60e47adc1117698b54748/integrations/hapi/README.md) | 后续逐项评估所需语义，不整体继承补丁与认证模型 |

HAPI 的本地/远程交互模式不直接等价于本项目的同机/跨主机执行目标；跨主机文件准备与 Git 结果取回必须单独验证。

## 关联调查

[远端工作区调查](../remote-workspace-preparation/research.md)保存 HAPI 多机/工作树与 Multica 准备、执行和成果分工的源码证据。[代码回收实验](../remote-result-delivery/research.md)保存 Git bundle 的本地验证，避免在各 Change 复制同一份证据。

## 远端设计补充证据

2026-09-28 在上述 HAPI 锚点继续核对：

- [SyncEngine.spawnSession](https://github.com/tiann/hapi/blob/86c88df93baf5d1f738dd4b202078bdf6dec376e/hub/src/sync/syncEngine.ts#L2165)已为新机器会话预分配 ID；启动后发生不确定错误时保留记录，只有明确没有启动子进程才清理。可复用这一基础，但公开 API 尚不等于具备 Runweft 的客户端请求去重和准备回执。
- [目录预检查](https://github.com/tiann/hapi/blob/86c88df93baf5d1f738dd4b202078bdf6dec376e/cli/src/runner/validateWorkspaceDirectory.ts)负责目录存在性、创建和 symlink 异常，不负责仓库基线准备。
- [会话 upload](https://github.com/tiann/hapi/blob/86c88df93baf5d1f738dd4b202078bdf6dec376e/hub/src/web/routes/sessions.ts#L287)要求活跃会话，经 RPC 向会话提供文件；[scratchlist 上传](https://github.com/tiann/hapi/blob/86c88df93baf5d1f738dd4b202078bdf6dec376e/hub/src/sync/syncEngine.ts#L815)已有 Hub 侧文件存储与配额检查。上游并非没有集中存储；待补的是启动前输入和独立于子会话的委派成果生命周期。

## 社区插件提案跟踪

| 材料 | 核对结果 |
| --- | --- |
| [Issue #653](https://github.com/tiann/hapi/issues/653) | 2026-05-20 提出；维护者作出积极回应；2026-05-27 由作者关闭 |
| [PR #689](https://github.com/tiann/hapi/pull/689) | 同一作者提交的插件实现，关闭且未合并 |
| [PR #695](https://github.com/tiann/hapi/pull/695) | 包含插件 runtime、管理与 marketplace；2026-05-29 由作者关闭，未合并 |

作者的 [关闭留言](https://github.com/tiann/hapi/pull/695#issuecomment-4569605561)仅表示暂时关闭草稿，没有给出技术或维护方面的原因。不能据此推断方案被维护者拒绝或已验证不可行。

本项目决策是继续源码内扩展。后续相关调研可复查这些入口；不安装、不移植这些 PR，也未设置自动监控。若上游方向改变，先评估其对现有职责边界的影响。
