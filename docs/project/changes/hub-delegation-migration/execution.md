# 委派接入与迁移执行记录

## Plan 评审

2026-10-01 在当前工作区运行 iclaude，只读、不委派、不修改用户配置。会话 `206019f7-96f4-49bd-8ffb-8f9ea3efd3f1`，约 347 秒；完整结果保存在 `.dev-smoke/reviews/hub-delegation-migration/review.json`。

主 agent 独立核对源码后采纳：WorkspacePreparations 同步迁移及全部后台扫描隔离；task 绑定目标机器、源操作与 baseline 按 scope；后台按 owner/space 鉴权；公开 API 隔离与 OS 账户信任区分；当前机器凭据和传输授权收回；SQLite WAL/备份与多库 journal；对端旧 machineId 接入恢复；先验证消费实现再统一切换默认服务；交接确认和 HTTPS 限制。

WorkspacePreparations 的遗漏由主 agent 同步复核发现并已在评审结束前补入文档，其余结论已落实到契约与 Plan。对输入/输出 grant 收回补充并行传输引用计数：不能因一个操作完成而撤掉其他操作仍需的同一 artifact 权限。无需新增 runtime 或人工产品门禁。

本次文档提交：`hub-delegation-migration: define reviewed delegation and migration plan`。尚未执行本阶段生产改动或在线迁移。

## T1 可信协调器到 HAPI 的桥接

- 结果：私有 DelegationNativeClient 复用原生 HTTP、dispatch intent、对象/预约账本；限定 source/target 和 task session，派发及 ack 策略收到 task binding，重复 spawn 只取原回执。现有 helper 仅将依赖收窄为 HapiHttp，默认服务尚未切换。
- 结果：输入 materialize 前授予当前机器凭据 read，确认完成后按操作释放；输出 permit/lookup 归 task caller，发布后显式释放。schema 16 给 grant 增加 leaseKey，保留旧手工授权；并行同文件传输独立释放。成员移除清除其文件及其机器在该空间的传输 grant，重入不复活。
- 验证：typecheck、build 通过；全仓测试 236 pass/0 fail（35 文件、4764 断言，约 51 秒）；随后增加凭据轮换和 RPC ack 撤权用例，聚焦 7 pass/0 fail。新 schema 从 15 的手工 grant 保留有独立验证。
- 真实验证：编译并运行 scripts/smoke-hub-delegation-native.ts，6 组全部通过。未改造 dist/hapi 和 Runner 完成共享机器私有 API 边界、实际输入字节下载、Git worktree/输入准备、输出上传和按请求恢复、无效准备拒绝真实 spawn RPC、共享撤回与日志秘密检查；无模型执行。证据 `.dev-smoke/hub-delegation-native-Y2J4an/evidence.json`，配套日志 `.dev-smoke/reviews/hub-delegation-migration/t1-*.log`。首次 smoke 发现 adapter 缺少 ExecutionClient 的 /health 能力查询，补齐后重跑通过。
- 边界：释放输出授权由持久清单发布点调用，中心 Task/Round 和独立准备接线在 T2；仍未更新在线 Hub 或用户配置，HAPI 子模块无改动。
- Commit：`hub-delegation-migration T1: bridge trusted task execution and scoped native transfers`。

## 用户调整（T2 进行中）

2026-10-01 用户明确项目尚未上线：破坏性更新直接清理历史，不为数据迁移过度编写逻辑，并清理过度封装。原 T6 的 YAML/多库归属转换、staging/journal、resume/rollback 设计撤销，改为简单历史清理和实现简化；相关 Requirement、Technical、Plan 与清理契约已同步。这一部分尚未实现，因此没有迁移代码需要保留。此前 iclaude 的迁移建议仅保留为历史评审事实，不再构成实施要求。

用户另确认：整个第五阶段完成并归档后，在当前工作区驱动 traex（astra）接手整体第六、七阶段；确认启动后无需等待其完成，并结束本 goal。

## T2 中心 Task/Round 与独立工作区准备

- 结果：新增组合 DelegationGateway；服务器解析选择器、真实 Git 观察和中心 Agent，不接收客户端快照。每轮保存独立版本/内容；next 重取当前定义并保留显式 runtime，固定目标不兼容时拒绝；启动参数变化新建 session 并带业务历史，兼容配置复用已停止 session。任务记录与授权绑定共用同一 SQLite 事务。
- 结果：TaskCoordinator 和 WorkspacePreparations 复用原执行/基线流程，通过可信上下文接原生桥接；schema 17 记录业务 scope，所有任务、输入意图、基线、导入和准备扫描隔离旧无中心归属数据。baseline 机器请求匹配持久 operation 与实际消费者，不授予公开机器 API。
- 结果：后台用稳定 owner/space，token 轮换取消旧请求但不取消已接受任务；Agent/资源/成员撤回后停止准确 session，保留真实停止/未确认状态。历史读取不要求 Agent 仍共享。受管 session 的启动/输入/模型变更经任务入口，HAPI 原生读取与审批继续复用。递归查重跨业务 scope，并覆盖已经绑定、尚未回写业务状态的 HAPI session ID。
- 结果：TaskOutputs 从持久发布清单释放可用输出授权，SnapshotPublisher 在恢复引用落盘后释放输出授权；未交付条目不假装可用。只读 queued-state 在撤权收尾时仍可查询，wait 取消保留原授权错误码。
- 验证：typecheck、build 通过；全仓 243 pass/0 fail（36 文件、4955 断言、约 52 秒）。随后补充输出清单授权释放回归，中心与输出聚焦 22 pass/0 fail（594 断言）。中心 7 组覆盖双 runtime 快照/续接、配置并发与事务回滚、显式目标、丢回执、跨用户/空间、token 轮换长等待、撤权不确定停止、成员移除及旧数据扫描隔离。日志 `.dev-smoke/reviews/hub-delegation-migration/t2-*.log`。
- 真实验证：编译 scripts/smoke-hub-delegation-preparation.ts 并运行，5 组通过；真实未改造 HAPI、两个独立 Runner、中心 Agent/仓库解析、已提交基线实际字节导出上传导入、独立 worktree、相同 owner/space 内复用及两端授权收回。证据 `.dev-smoke/hub-delegation-preparation-4796tH/evidence.json`。该 smoke 不启动模型；协调器会话行为本任务由可控原生 HTTP fixture 验证，完整真实模型组合由 T4/T7 验收。
- 边界：默认 serve、CLI/MCP 尚未统一切换，按 T4/T5 顺序推进；旧数据按用户最新决策在 T6 清理/简化，不编写迁移框架。未修改在线服务、用户配置或 HAPI 子模块。
- Commit：`hub-delegation-migration T2: resolve central task rounds and workspace preparations`。
