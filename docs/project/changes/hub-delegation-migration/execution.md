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

## T3 Web 凭据交接与明确连接记录

- 结果：增加 hub connect begin/complete/cancel/status 与匿名请求、浏览器确认、秘密轮询 API。Hub 只持久公钥、摘要和 RSA-OAEP SHA-256 密文；确认前后校验身份与空间，十分钟过期，取消或消费后不再领取密文。
- 结果：Web 展示 origin、机器、核对码和所选身份/空间，明确点击后用 WebCrypto 加密；只允许 HTTPS/localhost，地址不符不能确认。CLI 直接解密、向 Hub 验证后原子写入 0600 identity.json，再确认消费。私钥/轮询凭据保存在同连接目录的 0600 connect.json，完成后删除；输出不含秘密。
- 结果：HubClient 自动读取对应 origin 的身份与空间，仍支持显式备份/环境变量；不复用另一 origin 的 token。身份与机器文件分别保存，跨 owner 的机器记录阻止身份覆盖。现有短 SQLite 文件锁复用于并发保存；丢失确认响应可恢复，旧请求不能覆盖后来切换的身份。hub paths 显示固定位置。
- 验证：typecheck、build、git diff --check 通过；全仓 249 pass/0 fail（37 文件、5075 断言、约 55 秒）。新增 5 组测试覆盖编译 CLI 并发、真实 RSA 加密、响应丢失、替换身份、token/成员撤回、过期、密文错误、机器 owner 与 origin 隔离。日志 `.dev-smoke/reviews/hub-delegation-migration/t3-all-tests.log`。
- 浏览器验证：scripts/smoke-hub-connect.ts 通过 5 组，使用开发机已有 Chromium 与真实 Hub 身份 API/SQLite、WebCrypto、编译 CLI；桌面/窄屏、选择空间、退出/重入、取消和假 origin，检查输出/URL/控制台无秘密。证据 `.dev-smoke/hub-connect-fJ61eZ/evidence.json` 及同目录截图；未启动模型或修改用户配置。Playwright 默认浏览器版本缺失，改用已有的 headless shell；首次组合脚本缺少资源网关能力，接入实际 ResourceGateway 后重跑通过。
- 边界：此任务只接独立安全网关和 hub 命令。默认 serve 与任务/MCP 消费端仍按 T4/T5 切换，不宣称默认产品已完成集中身份接入。
- Commit：`hub-delegation-migration T3: hand off Hub identity securely through Web confirmation`。

## T4 CLI/MCP 与领域消费入口

- 结果：HubClient 提供既有 HapiHttp 形状的用户/空间 transport，支持取消和流式文件；能力探测后换取短期 JWT，业务响应不确定时不自动重发，拒绝跨 origin。HubTaskClient/HubPreparationClient 使用持久身份、独立机器记录和实际 Git 观察，只提交选择器；原任务读写/等待/审批/成果方法共用 TaskOperations，工作区和附件继续使用现有流程。
- 结果：显式 hub task/artifact/workspace 与 hub mcp serve 已可使用集中身份；默认 root 命令暂留原接线，T5 一次切换。任务可省略 Agent 使用本人仓库/空间选择，支持显式 runtime/remote。MCP 保留 Codex 元数据与 Claude 精确 hook 身份，已知受管 HAPI 子会话返回空工具列表，服务端递归拒绝仍覆盖直接工具调用和跨 scope；原生内置子会话不被泛化拒绝。
- 验证：typecheck、build、git diff --check 通过；全仓 252 pass/0 fail（38 文件、5307 断言、约 60 秒）。新增编译消费端 3 组覆盖两宿主 × 两 runtime、默认选择/版本更新/原请求重放、父会话隔离、子工具隐藏与绕过列表拒绝、连接/空间缺失、跨 origin 和取消长等待。最后补充机器未登记提示，聚焦 3 组再次通过。完整日志 `.dev-smoke/reviews/hub-delegation-migration/t4-*.log`。
- 真实验证：scripts/smoke-hub-consumers.ts 使用编译 CLI、未修改 HAPI、两个独立 Runner、专用模型配置副本。`.dev-smoke/hub-consumers-azHhRQ/evidence.json` 前三组通过，包含 Codex 两轮共享执行/原生 session 复用及本机 worktree 成果 ref；该次整体 success=false，因为脚本把 Claude 正常审批误作失败，已如实保留。
- 真实验证：修正脚本先处理专用验收审批后，仅重跑远端部分，`.dev-smoke/hub-consumers-AENAkD/evidence.json` 全部通过。真实 Claude 独立工作区、启动前输入、输出实际字节、机器 owner 用户不能读任务 owner 文件、Git bundle 取回专用 ref、主 HEAD/工作文件未改变，未 push/合并。额外 `.dev-smoke/hub-consumers-B9eHnL/evidence.json` 全部通过：编译工作区诊断准备/重放/列表/查询/释放，不启动模型。各运行 cleanupErrors 均为空。
- 边界：MCP 本任务通过真实编译 stdio 协议加原生 HTTP fixture 验证元数据组合；真实模型执行通过编译 CLI 接入。原生宿主自身发起 MCP 的完整组合在 T7 验收。此处的远端指同一物理 Linux 机器上的独立 Runner，未冒充物理远端。未改在线服务、原用户模型配置或 HAPI 源码。
- Commit：`hub-delegation-migration T4: connect CLI and MCP consumers to central Hub delegation`。

## T5 默认服务与 Runner 统一切换

- 结果：默认 serve 组合集中授权/资源/配置/委派网关，私有 HAPI root 不对公网认证。启动只创建服务，不创建用户、机器、runtime 或 Agent；启动恢复只扫描中心归属，附件未确认引用清理逐项失败保留并给出请求 ID。恢复前不接受新的委派业务。
- 结果：root CLI 的 Agent、machine/runtime、repository、task/artifact/workspace 和 MCP 接入集中消费端，与显式 hub 子命令共用实现。Web complete 同时保存所选 hub.url，保留部署 mode；移除配置 tokenEnv、auth token 和带 token 浏览器 URL。open 默认 /hub，可 --print。
- 结果：local 默认只托管 Hub，hub 模式管理当前连接 Runner；独立 runner start/stop/status 使用机器凭据，拒绝未登记和未完成轮换。显式 server.runner 可托管已登记 Runner；部署角色与业务 URL 独立。status/doctor 分别显示服务、身份/空间连接、机器登记与 Runner 在线事实；安装握手不依赖身份已连接。
- 验证：typecheck、build、git diff --check 通过；全仓 248 pass/0 fail，38 文件、5092 断言，约 52 秒。集中消费测试改为编译 CLI/MCP 默认入口；淘汰旧 YAML/root CLI 验收，保留领域回归。日志 `.dev-smoke/t5/all-tests-final.log`；聚焦 5 pass/0 fail。
- 真实验证：`scripts/smoke-hub-service.ts` 在专用目录通过 4 组，实际编译产品启动原 HAPI、两个 Runner、本地与 Hub 模式、root 拒绝、空登记、无秘密入口、失效凭据/轮换和托管重启，停止清理无错误。证据 `.dev-smoke/hub-service-PjYffV/evidence.json`。修正托管 Runner 正常停止误报意外退出的顺序，复测成功；未修改在线服务、用户配置或 HAPI 子模块。
- Commit：`hub-delegation-migration T5: switch default services and consumers to Hub identity`。

## T6 历史清理与实现简化

- 结果：`data reset` 默认预览固定清理清单，`--apply` 在首次删除前核对托管 Hub、所有连接 Runner 和路径链接；不依赖可解析旧配置。清除配置、旧全局 Agent、中心业务/原生库/附件、身份和机器记录；保留 workspaces 全树、Git 对象、未交付文件、原生配置与 MCP 备份。清理后重新 init/连接/登记，无导入、映射、journal、继续或回退框架。
- 结果：删除旧 Agent/资源 CLI 命令生成器、消费命令中的旧客户端回退，以及 MCP 调用的本机工作区绑定持久化。paths 用 clientState 表示实际的 hook/连接协调库，不再宣称本地 Agent 配置权威。纯业务协调器及原生 HTTP fixture 的领域回归保留。
- 验证：typecheck、build 通过；全仓 249 pass/0 fail，38 文件、5143 断言，约 49 秒。新增 3 组清理测试覆盖预览/重复执行、进程拒绝、符号链接、损坏旧配置和保留字节。最后进行路径字段统一并复查 MCP/Agent 领域聚焦测试，21 pass/0 fail、484 断言，typecheck/build 再次通过。日志 `.dev-smoke/t5/t6-*.log`。
- 真实验证：编译 CLI + 原 HAPI/Runner 的 5 组通过，`.dev-smoke/hub-service-MI3IfS/evidence.json` success=true、cleanupErrors=[]；先启动验证运行中清理拒绝，再停服清理，保留 worktree 字节，重新启动领取身份并登记新机器，旧身份被拒绝。本任务不启动模型；清理后新委派在 T7 验证。
- Commit：`hub-delegation-migration T6: reset prerelease records and simplify consumer entry points`。
