# 本地共享委派验收

本表核对本 Change 的范围，不代表整个 Runweft 已完成。验收沿用户已授权的本地自主闭环执行；真实远端仍留在远端 Changes。

## 需求与证据

| 验收项 | 结果与证据 |
| --- | --- |
| 非空模型/推理参数 | T2 `task-controls-7etrzQ`：Codex gpt-6-sol/xhigh、Claude claude-opus-5-5/high 实际执行，HAPI 生效字段匹配；不是仅做参数映射 |
| 两宿主 × 两 runtime，CLI/MCP 协作 | T1/T2 编译 CLI 接受、读取、等待和控制；T3 两原生宿主 spawn→wait→read；T4 `collaboration-859Dxz` 在 local/同机 Hub 各四组合通过，`lt1Y4J`/`5B8eS8` 补齐实际 MCP 控制 |
| 非 Git 共享 cwd，无自动 Git 动作 | T4 实际 Git 搜索上界下的非仓库解析；子执行写入主 cwd 目标文件，纯报告轮次不改 mtime，目录只保留该目标文件；启动/续接核对真实 machine/path/flavor，错误目标 fixture 拒绝输入 |
| 连接断开不重复执行 | T4 两个真实宿主的 MCP stdio 在持久接受第三轮后关闭，中心获得原生完成并收尾；仅一个 delegation、三个单输入轮次，无重发；T3 SDK 取消/断线与 HTTP 认证取消回归 |
| steer、下一轮、迟到中断 | T2/T4 Codex 实际 steered、两个输入同业务轮次完成，Claude 明确不支持；中断 executionId 对应当次读到的输入；T2 迟到轮次不影响后轮，HTTP fixture 覆盖取消排队轮次 |
| 固定环境与准备/收尾门禁 | T2 实际修改 YAML 后继续沿旧目标/定义/native session；fixture 覆盖关闭未知阻止后轮、resume 返回错误机器/目录时先关闭且不投递、串行轮次与保存旧身份 |
| 执行、交付、接纳分离 | detail/overview 区分原生状态、stop、finish、报告和外部接纳；共享 Git/附件为 not_applicable。T1/T2 fixture 验证未知终态和关闭失败不冒充完成；上传不存在于本 Change，未声称上传重试已验收 |
| 纯报告独立完成 | T1 目录不新增文件；T4 续接轮次只从原生历史回忆标记，文件内容及 mtime 保留，无提交/bundle/PR 前置 |
| 受控子限制和原生能力保留 | T3 两 runtime 子 CLI 的 spawn/send 均实际返回 subagent_delegation_denied；T4 启动/续接原生目录无 Runweft 工具，其他 MCP 被实际调用，Claude 原生 Agent/Task 保留；原生递归不受 Runweft 管理 |
| 每轮关闭，优先 resume，精确缺失重建 | T2/T4 可靠原生终态、inactive/archived 与 PID 退出，真实 resume 保留 native ID/记忆；[前置执行验收](../../archive/2026-09-29-hapi-subagent-foundation/execution.md#t3-关闭续接与运行能力验证)已验证两 runtime 的原生缺失诊断。此 Change 的缺失重建/未知不重放通过真实 HTTP + SQLite fixture 验证，不冒充真实删除历史后的模型验收 |

对应新增能力：`delegation/interface` 由 CLI/MCP 工具及安装验证覆盖；`local-workspace/shared` 由八组合共享文件证据覆盖；`delegation/lifecycle`/`delegation/rounds` 由中心事务、原生完成/关闭、续接和控制覆盖；`delegation/results`/`delegation/context` 由有界报告、历史构造、缺失结构化结果及分页用例覆盖。正式实现见 [coordinator](../../../../src/tasks/coordinator.ts)、[store](../../../../src/tasks/store.ts)、[MCP](../../../../src/mcp/tasks.ts)、[视图](../../../../src/tasks/views.ts)及 [rounds 测试](../../../../test/task-rounds.test.ts)。

## 最终核对

- `bun run typecheck`、`bun test ./test`：85 项、1509 次断言通过，日志 `.dev-smoke/delegation-final-unit.log`。
- 四平台候选包由 `bun run package --all` 生成，索引 `dist/packages/index.json`，包含固定 HAPI 许可和源码。首次 `--reuse-hapi` 明确拒绝缺失的 macOS 缓存，随后从同一干净固定版本重新构建全部平台，没有混用旧二进制。
- 当前 Linux x64 的 `bun run test:install` 在 `.dev-smoke/install-jQUdtx/evidence.json` success=true；npm 平台依赖安装、无 Bun/source PATH 的 task 命令与九工具 MCP 目录、无副作用发现、服务/信号及卸载保留数据均通过。其服务证据 `.dev-smoke/install-jQUdtx/services/service-AfqK7i/evidence.json` success=true。
- T3/T4 实际模型证据和失败测试的修正记录见 [Execution](execution.md)。所有成功 smoke 的 cleanupErrors 为空；T3 首次测试的 Claude 结果文件读取审批范围不足已修正并单独通过重测。
- 数据集中在既有 home；schema v1→v2 事务保留资源 ID，更新 JWT 但不重放业务 POST；真实 SQLite/HTTP 用例覆盖并发重复接受、丢响应和重启。普通日志不保存完整任务输入，原生完整 transcript 仍归 HAPI/原生工具。

本轮四平台均重新构建，新增委派的实际运行证据来自当前 Linux x64；前置模块的其他平台运行证据保持其原范围，未称为本轮全平台模型协作验收。远端、独立 worktree、附件、看板和最终公开发行尚未实现，不阻塞本 Change 的本机共享范围关闭，也不从完整项目目标中删除。
