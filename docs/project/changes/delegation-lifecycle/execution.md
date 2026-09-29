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

## T4 两宿主两 runtime 配套验收

- 结果：新增 `test:collaboration`，使用编译 CLI/HAPI、专用原生配置和实际模型，在 local 与同机 Hub 各运行 Codex/Claude 宿主 × Codex/Claude runtime 的四种组合。每项由真实父会话经 MCP 派生并处理审批，子执行调用保留的其他 MCP、修改共享文件，随后父会话经 send_input 续接原生 session，子执行仅凭历史返回未写入文件的记忆标记；父会话实际读取两轮完成报告。
- 真实验证：`.dev-smoke/collaboration-859Dxz/evidence.json` success=true、八项均通过、cleanupErrors=[]。检查文件精确内容、纯报告轮次不改 mtime、共享目录仅保留任务写入的目标文件、原生 completed、session archived/inactive 和各轮 host PID 退出。专用 MCP 注册显式传入 Git 搜索上界，使实际 Git/Agent 解析确认为非仓库；未修改用户配置。启动/续接的原生工具目录验证无 Runweft 工具，其他 MCP 实际可调用，Claude 原生 Agent/Task 保留。
- 真实断线：Hub 的 Codex→Claude、Claude→Codex 各在第三轮持久接受后由测试代理关闭真实 MCP stdio 连接，父会话不重发任务；中心最终仍获得原生完成并关闭进程，只有一个 delegation、三个单输入轮次。脚本允许测试操作者经 CLI 响应断线后的固定 sleep 审批，本次两项均未出现该审批（approvals=[]）；没有自动提升默认权限或要求恢复主会话。
- 真实控制：`RUNWEFT_SMOKE_CASE=local-codex-codex RUNWEFT_SMOKE_CONTROLS=1 bun run test:collaboration` 在 `.dev-smoke/collaboration-lt1Y4J/evidence.json` success=true、cleanupErrors=[]，实际 MCP steer 返回 steered，同一业务轮次两个输入完成；后续 MCP 中断命中读到的同一原生 executionId，终态 interrupted 并退出进程。`RUNWEFT_SMOKE_CASE=hub-claude-claude RUNWEFT_SMOKE_CONTROLS=1 bun run test:collaboration` 在 `.dev-smoke/collaboration-5B8eS8/evidence.json` success=true、cleanupErrors=[]，Claude steer 明确返回 steer_unsupported，随后定向中断/退出通过。
- 验证边界：本任务无产品代码或 HAPI 修改；类型检查、测试代理语法检查、Change 校验与 git diff --check 通过。T3 的两 runtime 子 CLI 再委派拒绝、T2 的真实模型参数/权限拒绝及缺失恢复协议测试继续有效，不重复同范围模型调用；真实跨机器远端仍不在本 Change 内。
- Commit：`delegation-lifecycle T4: verify native collaboration across hosts and connection modes`

## T5 完整使用说明与阶段关闭

- 结果：使用说明补齐 MCP 工具、默认/带游标等待、模糊接受重查、共享目录边界、审批、中断、续接、数据与关闭流程，说明 Git/原生工具前提及旧 Codex MCP 注册升级。新增[验收映射](acceptance.md)，区分真实模型验证、HTTP/SQLite fixture、四平台构建和当前平台安装；复核并修正 T4 记录，断线用例本次没有发生 CLI sleep 审批。
- 候选包：`bun run package --all` 成功，`dist/packages/index.json` 包含主包与四个平台包，HAPI 固定 revision 不变、工作区干净。首次 `--reuse-hapi` 因缺失 darwin-arm64 缓存明确拒绝，随后完整重建成功；日志 `.dev-smoke/delegation-package.log`。
- 安装验证：`bun run test:install` 在 `.dev-smoke/install-jQUdtx/evidence.json` success=true。新增安装产物的 task 命令与九工具 MCP 目录验证，在无 Bun/source PATH 下可用且发现不创建数据；真实 npm 平台依赖、服务/信号、缺平台诊断和卸载保留数据通过。服务证据 `.dev-smoke/install-jQUdtx/services/service-AfqK7i/evidence.json` success=true，覆盖 local、Hub 客户端及不带 Runner 的 Hub 服务端。此轮实际安装平台为 Linux x64，不将跨平台编译称作其他平台原生协作验收。
- 最终回归：`bun run typecheck`、`bun test ./test` 85 项/1509 次断言、四平台构建、Change 校验及 git diff --check 通过。此前真实模型 smoke 的 HAPI/Runweft 产品代码未再修改，其证据继续有效；当前没有未解释失败或待清理测试进程。
- 关闭依据：用户已授权本地自主验收和归档，按 acceptance.md 逐项核对满足本 Change；T5 提交后按独立关闭流程同步 Specs、更新依赖引用并归档。本地独立工作区及其他下游能力继续按顺序推进，完整目标未完成。
- Commit：`delegation-lifecycle T5: document collaboration and verify installable candidate packages`
