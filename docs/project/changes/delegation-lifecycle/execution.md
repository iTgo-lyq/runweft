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
