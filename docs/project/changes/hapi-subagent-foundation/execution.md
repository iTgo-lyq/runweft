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

## T3 关闭、续接与运行能力验证

- 结果：Runweft 复用原有 archive/resume 与审批入口；关闭须确认 inactive/archived，续接返回前后 HAPI/原生身份，未确认不自动重发或另开执行。HAPI Runner 只在原生缺失有确证时返回 native_session_missing；认证、离线、IO 与模糊失败不能进入历史重建分支。预检查不提交 prompt，拒绝后保留归档状态。
- 实测：两种 runtime 的项目说明/skill、关闭后的原生历史续接和再次退出通过；共享 Codex 关闭一个 root 后兄弟仍可真实执行。默认权限下原生允许/拒绝均控制了专用文件副作用。两种缺失历史都经实际 Runner/Hub 验证。[Research](research.md#t3-实际关闭配置继承与续接) 保存证据与源码验证边界。
- 修正：真实 fork/审批验证暴露 execution 事件缺少 consumed 回执、Claude 工具拒绝提前退出未关闭原生进程；复用已有确认及 cleanup 路径修复。仅清理确认后记录受控 interrupted；无法确认保留 unknown，不重新投递。
- 验证：Runweft typecheck、24 项测试通过；HAPI typecheck 与 gen:fixtures 通过；全量 bun run test 退出 0（CLI 2,959、Hub 1,380、Web 3,249、shared 323、relay 118，通过数不含原有 CLI 11/Hub 3 跳过）。日志 `.dev-smoke/hapi-foundation-t3/` 及同名前缀文件；专用测试进程和临时目录已清理。尚未完成配套固定版本的 T4 整体验收。
- Commit：HAPI `hapi-subagent-foundation T3: verify native resume and close controlled executions`；Runweft `hapi-subagent-foundation T3: expose stop resume and native permissions`。


## T4 配套构建与整体验收

- 结果：新增显式运行的 `scripts/smoke-execution.ts`，覆盖真实 Codex/Claude 执行与故障注入，不加入无凭据单元测试。使用已授权模型配置、独立 Runweft/HAPI home 和项目目录，审批用原生 default；未修改用户配置或凭据。
- 配套构建：HAPI revision `cb2810dc09b0eeb831f4ed81930a506397992967`（0.30.7），`bun run build:hapi` 与 `bun run build` 成功。Linux x64 HAPI SHA-256 `5a466f30901e40c9770655c3c6bea8c28d1dcc60e8b7bc2603f6080fca7c3a9d`，Runweft SHA-256 `c6cdd3949e580362bae1fa874b96d2470b1066845fd8b6e6ab89348b71a45130`；配套 manifest 与实际二进制一致。证据 `.dev-smoke/hapi-foundation-t4-build-evidence.json`。
- 编译验收：将验证脚本独立编译后调用 `dist/runweft`/`dist/hapi`，06:08–06:10（Asia/Shanghai）两种 runtime 全部通过。并发同 ID 与丢启动回执只保留一个 session；丢输入回执保留 unknown，随后读取同一执行的原生完成；项目说明与 skill 生效；迟到中断拒绝、当前中断成功；真实允许/拒绝影响文件副作用；停止后原生历史续接；Codex 共享 root 的兄弟仍可执行。证据 `.dev-smoke/execution-sZUDB8/evidence.json`，success=true、cleanupErrors 为空，按专用 HAPI_HOME 核对无残留进程。
- 服务回归：`node scripts/smoke-service.mjs dist/runweft` 全部通过，包括本地/独立 Hub 客户端、HTTP/SSE/WebSocket、身份与数据保留、前台退出；证据 `.dev-smoke/service-nxExVm/evidence.json`。这是本机部署协议验证，不冒充真实远端协作。
- 检查：Runweft typecheck 与 24 项测试通过；HAPI 源码保持 T3 全量检查通过后的版本，无需因文档/验证脚本再次重复全量测试。Change 结构、文档链接及 diff 检查通过。
- 验收方式：沿用用户逐 Change 自动本地验收授权，主 agent 核对下表后同步 Specs 并归档；不要求用户再次手工验收。
- Commit：`hapi-subagent-foundation T4: accept the pinned native execution contract`。

| Requirement 验收项 | 实现与证据 |
| --- | --- |
| 原生输入、终态与结果 | T2 实际完成/失败与 T4 编译版本分别验证 Codex/Claude；保留原生 session/turn 或消息 UUID，REST 成功不等于完成 |
| 丢回执与不重复执行 | T1 持久回执验证并发、重启和删除；T4 代理丢弃已成功的启动/输入响应并重查；T2 可控 Claude 模糊异常由三次调用降为一次 |
| 审批、中断与恢复 | T4 真实允许/拒绝文件副作用、旧目标中断拒绝、当前中断与原生历史续接；T3 单元测试覆盖返回实际新旧 HAPI 身份 |
| 不支持、认证和离线 | T1/T3 类型化错误与用例保留 HTTP/code；能力缺失明确拒绝，认证/离线/IO 不转为 session 缺失，无 runtime 切换分支 |
| 用户配置与专用环境 | T3/T4 用专用 home/cwd 与随机项目说明/skill 标记，继承已有原生模型认证和配置；未写入用户客户端设置 |
| 单执行关闭与续接 | T3/T4 记录宿主 PID 退出；Codex 共享进程只关闭一个 root 后兄弟仍执行；原生 session 相同且能复述历史标记 |
| 复用内置执行基础 | 启动、配置、会话、队列、审批、archive/resume 均调用 HAPI；Runweft 只有内部调用封装，未建第二套执行器或会话库 |
| 缺口增补有证据 | Research 保留启动去重/原生事实/定向中断、Claude 模糊重投、原生缺失诊断、事件消费与受控关闭的复现；各项仅在 HAPI 原路径增补，未照搬旧工程 |

本 Change 的执行契约已满足验收。首次 MCP 身份、动态工具列表与父子关系仍归宿主适配；工作区、附件、真实远端与最终多平台组合按后续 Change 验收，不宣称完整产品交付。
