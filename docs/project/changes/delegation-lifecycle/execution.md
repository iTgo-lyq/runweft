# 委派生命周期执行概况

## 一次 Plan 评审与采纳

- 评审：当前工作区 iclaude，2026-09-29 14:35–14:46（Asia/Shanghai），原生会话 `e9d56c13-0a7d-4ee7-82b0-3cc94c694b7a`；只读完成，退出 0，result success，无额度错误。原始结果 `.dev-smoke/reviews/delegation-lifecycle/review.md`。
- 采纳：Codex 受管 MCP 超时 600 秒、wait 上限 540 秒并留返回余量；原始意图去重与 list_agents 接受记录；删除 CLI request 命令/本地接受记录库，发送前 stderr 输出 ID；概览顶层 status/attention 与有界报告；角色只按中心 child 关联；T1/T2 提前交付对应 CLI，T3 即做真实宿主 smoke；按 round 起点读取 HAPI 既有历史分页。
- 独立判断：保留客户端只读查已接受 requestId，再解析本地定义的步骤。Agent 文件不在中心，若省掉此步骤，重试会在文件已被删除/损坏时先失败；中心同 ID 比较只依据原始意图，不依据新快照。语义去重不猜测相似文本；未知结果先查父会话接受记录。
- 补充：默认 wait 以调用时最新 round 为目标，有游标则保留后续完成 revision，避免旧结果立即满足新一轮等待；未知原生事实允许明确取消并关闭原 session，必须确认停止，不能伪造 interrupted。
- 依据：HAPI JWT 4 小时，需要按 exp 更新认证；resume 返回后再核对真实 machineId/path/flavor。均复用现有入口，无预设 runtime 改造。
- 确认：按用户自主推进授权采用修订后的 Requirement/Technical/Plan；五个任务由主 agent 逐项实现、验证和提交，不重复评审。

## T1 中心接受与单轮执行闭环

- 结果：中心业务库事务升级到 v2，保留原机器/runtime ID；serve 内协调器承担持久接受、请求去重、固定目标核对、原生查询及自动关闭。CLI 提供 task spawn/list/show/wait，发请求前 stderr 输出 request ID；未知接受先查询，已接受请求不依赖后来修改或删除的 Agent 文件。受控 HAPI/native 子身份在输入前保存，子 CLI 拒绝递归委派。
- 结果：JWT 按 exp 提前续期，副作用请求不自动重放；轮次保存 HAPI 历史起点并使用原有正向分页。概览区分原生执行、进程停止与共享收尾，报告有界返回并支持分页。等待取消不归档任务，CLI 列表默认当前发起机/cwd（含 MCP 来源），--all 限当前 namespace。
- 验证：`bun test ./test` 71 项、1035 次断言通过；涵盖真实 SQLite v1 升级、并发请求、中心接受响应丢失、HAPI spawn/send 响应丢失、已尝试步骤重启查询、关闭重试、父/namespace/共享目标约束和输入前子角色登记。`bun run typecheck`、`bun run build`、Change 校验和 git diff --check 通过。
- 真实验证：`bun run test:tasks` 使用最终编译程序、专用模型配置及非 Git 目录，通过 Codex 单轮原生完成、CLI 退出后自动收尾、HAPI archived/inactive、唯一 root 的实际 host PID 退出、目录无新增文件、服务重启与相同 request ID 不重复执行；证据 `.dev-smoke/tasks-ZT1GjG/evidence.json` success=true、cleanupErrors=[]。首次通过证据 `.dev-smoke/tasks-exeFpQ/evidence.json` 保留。
- 配套验证：`bun run test:service` 通过 local/Hub、网关 SSE/WebSocket、Runner、重启与 SIGTERM 清理；证据 `.dev-smoke/service-NLa7vo/evidence.json` success=true。该验证是同机服务组合，不是实际跨机执行。
- 后续：续接/多轮/控制/格式化报告属 T2，MCP 业务入口属 T3，两宿主两 runtime 完整矩阵属 T4；本任务不代替这些验收。
- Commit：`delegation-lifecycle T1: persist and execute shared tasks through CLI and HAPI`

## T2 串行续接与定向控制

- 结果：CLI 新增 task send/interrupt/permission。next 持久排队并等待前轮关闭，沿固定环境/定义优先 resume；仅 native_session_missing 构造有界业务历史，保留实际新旧 HAPI/native 身份。Codex steer 在本轮串行接受，原生排队/注入/消费/未知分别展示；Claude 明确拒绝 steer。中断绑定轮次，明确取消可关闭未知执行但不伪造原生 interrupted；审批仅响应当前真实请求。
- 结果：格式化报告可选，解析失败保留原文；Claude 原生结果中的完整报告不通过事实字段重复返回。列表展示仍在处理的轮次，历史完成 revision 可逐次消费，排队轮次显示前轮阻塞原因。原生可靠终态和已读输出不会被后来的未知传输或关闭后查询失败覆盖。
- 真实验证：`bun run test:task-controls` 在 `.dev-smoke/task-controls-7etrzQ/evidence.json` success=true、cleanupErrors=[]。配套 CLI/HAPI 实际验证 Codex gpt-6-sol/xhigh、Claude claude-opus-5-5/high 的非空参数、原生完成、续接首轮记忆、改定义后仍用既有目标、每种 runtime 各一次批准/拒绝及对应文件效果、迟到中断不影响当前轮次、定向原生 interrupted、HAPI archived/inactive 和 host PID 退出。Codex 实际返回 steered，同一业务 round 两个输入均完成；Claude steer 返回不支持。
- 修正依据：首次 `.dev-smoke/task-controls-Twbjtz` 复制了原生无审批配置，模型正确拒绝发起 require_escalated；测试改为仅在专用 Codex 副本启用 on-request/workspace-write，产品不覆盖用户默认。第二次 `.dev-smoke/task-controls-teHsIX` 暴露 Claude 回填旧历史导致 epoch 改变，已依据 HAPI 源码修复按 localId 重新核对并恢复正常游标；没有修改 HAPI 或重发原任务。两次失败进程均已退出、cleanupErrors=[]，不计为通过。
- 验证：最终 `bun test ./test` 80 项、1326 次断言通过，含串行门禁、改身份的 resume、未知续接、精确缺失重建、目录/机器不匹配、迟到控制、追加去重、审批约束、等待游标、已知事实保留和回填分页；`bun run typecheck`、`bun run build`、Change 校验、git diff --check 通过。真实远端、MCP 两宿主组合仍分别属于后续 Change/T3–T4。
- Commit：`delegation-lifecycle T2: resume rounds and expose targeted native controls`

## T3 CLI 与原生 MCP 协作入口

- 结果：MCP 保留 runweft_status，新增定义发现、派生、列表、读取、等待、下一轮/本轮追加、定向中断和原生审批响应八个工具，复用 TaskClient/AgentClient 与现有中心。原生调用身份生成稳定 request UUID，接受重试先查中心；工具描述说明模糊响应先查接受记录，不根据相似文本重新派生。父会话范围、角色拒绝、报告分页和 revision 游标沿中心契约。
- 结果：取消信号传递到定义解析、认证、资源检查和业务请求；等待取消/断线不取消已接受任务。Codex 受管 MCP 显式安装更新 tool_timeout_sec=600，wait 最长 540 秒、工具期限 570 秒；旧注册由 mcp check 提示更新，不自动改写原生配置。未新增运行进程、配置文件、客户端任务库或 HAPI 改造。
- 验证：`bun test ./test` 85 项、1509 次断言通过，含真实 MCP SDK 协议下两宿主身份、原接受重查、父隔离、受控子拒绝、报告分页、权限/定向取消、连接断开后中心继续完成及取消认证；旧 Codex 注册升级、语义保留和重复安装通过。`bun run typecheck`、`bun run build`、Change 校验、git diff --check 通过，HAPI 工作区无变更。
- 真实验证：`bun run test:task-mcp` 的 Codex 用例在 `.dev-smoke/task-mcp-42affB/evidence.json` 通过实际 spawn→wait→read、同父身份、子 CLI spawn/send 拒绝、原生 completed、HAPI archived/inactive 及 host PID 退出；带游标的 MCP wait 实际等待 65005ms 后返回 timed_out=true。该次整体 success=false：Claude 已执行拒绝检查，但随后 Read 测试结果文件触发了测试脚本未纳入范围的审批，测试主动停止；cleanupErrors=[]，不计为 Claude 通过。
- 修正与验证：仅扩大专用测试审批范围到其明确的结果文件读取，不修改产品默认权限。`RUNWEFT_SMOKE_HOST=claude bun run test:task-mcp` 在 `.dev-smoke/task-mcp-hYz93f/evidence.json` success=true、cleanupErrors=[]，通过相同真实委派、子 CLI 拒绝、结果/进程事实；实际 MCP wait 等待 65144ms 后返回 timed_out=true。脚本保留按宿主选择，已通过且代码未变的 Codex 用例不重复运行。
- 后续：当前证据是本机 Codex→Codex、Claude→Claude；完整交叉组合、共享编辑与其他控制集成仍由 T4 验收，候选包和完整使用说明由 T5 更新。工具禁用保留既有前置验收边界：其他 MCP 与原生 subagent 不受 Runweft 限制。
- Commit：`delegation-lifecycle T3: expose task collaboration through native MCP hosts`
