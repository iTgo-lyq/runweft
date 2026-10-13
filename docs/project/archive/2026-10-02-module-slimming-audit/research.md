# 逐模块瘦身审计报告

调查日期：2026-10-02。范围与约束见 [Requirement](requirement.md)，完整文件归属及模块判断见 [覆盖表](coverage.md)。这是调查结论和实施候选，不是已实施行为或实施 Plan。

以下保留首次只读审计事实。后续用户授权实施，并明确取消全部历史数据迁移/兼容且不清理旧数据；文中的迁移保留建议不再适用，已由[Technical](technical.md)、[Plan](plan.md)的T14取代。实际采纳、排除和验证见[Execution](execution.md)。

## 结论与证据口径

最大可收敛部分是 Hub 切换后由旧测试维持的并行服务/客户端路径，以及与当前 CLI 不兼容的验收入口。先迁移测试接线与故障注入，再删除旧路径，能同时减少源码、fixture 和验收维护面。当前中心权限、Task/Round 恢复、附件与 Git 留存有不同责任，不应一起压成通用状态机。

共记录 **12 项已证实候选**和 **6 项待验证事项**。已证实指冗余、旧调用或保障缺口有具体证据；不表示删除方案已经通过运行验收。收益是减少维护面/重复工作量的定性排序，没有估算删除比例、包体或执行速度。

基线为 Runweft `36257dfb3aae2da85289539b11ba8ac857bdbb10`，package version `1.1.1`；HAPI 为干净子模块 `3ac8b08b2aead13e9eaae459de62d9a5d5df7395` / `0.30.7`。调查时另有 npm-patch-release 的 Plan/Execution 未提交编辑，本次未改动。文件位置的行号均指这份基线。

调查方法是 tracked 文件清点、TS/JS 导入/声明/测试/异常处理扫描、逐模块入口与关键分支追踪，以及针对性实验。扫描覆盖不等于每行人工审读或全部链路实测；导入图也不等于运行调用图。浏览器文本导入、全局声明、类型共享和 fixture 直调都另行核对，未以“主入口没有 import”作为唯一删除依据。

## 当前入口与 HAPI 分工

| 入口 | 实际调用链 | 审计结论 |
| --- | --- | --- |
| CLI 服务 | `src/cli.ts` → `service-commands.ts` → `services.ts:159` → `createDelegationGateway` → configuration/resources/access gateways | 当前生产服务没有组装 `createRunweftHandler`。这些网关分别挂接权限、业务路由和关闭资源，不按薄包装一概删除。 |
| CLI 业务 | `cli.ts:91` 起的中心 Agent/资源命令、`HubTaskClient`、`HubPreparationClient` | 已必连显式 Hub；local 是托管角色，不限制中心任务只能在本机执行。 |
| MCP | `mcp/commands.ts` → `serveMcp`，传入 `hubOptions` → `HubTaskClient`/`HubClient` | 产品入口使用 Hub；server/tasks/artifacts 内仍保留无 Hub 分支，主要被旧测试使用。 |
| 看板 | `hub/access/http.ts` → `hubPage`、中心任务接口及授权后的 HAPI UI | `/hub` 是现行入口；旧 `/runweft` 看板及 HAPI root 登录模型已退出产品入口。 |
| 任务执行 | `HubDelegationService` → `TaskCoordinator.acceptResolved/send` → 私有 NativeTransport → HAPI → 原生 Runner | 中心保存 owner×space、业务轮次、声明附件和交付状态；HAPI 保存执行/会话/操作回执。两种状态不是同一权威事实的重复副本。 |

已对照下列 HAPI 实现，未提出新增 runtime 协议或改造 launcher：

| HAPI 具体能力与源码位置 | Runweft 应保留的上层职责 |
| --- | --- |
| `hapi/hub/src/web/routes/machines.ts:130` 的 spawn receipt 与 `:183` 的按 requestId 查询；`hapi/cli/src/runner/run.ts:1128` 起的去重及 preparedWorkspace 校验 | `execution.ts` 接受不明确时查原回执、不重发新任务；Task/Round 的父子关系、业务请求幂等与授权映射。 |
| `hapi/hub/src/web/routes/messages.ts` 的 queued-state，`sessions.ts` 的 resume/interrupt；Codex projection 与 Claude execution 的事实投影 | 保留 localId 精确关联、分页读事实、仅 `native_session_missing` 时重建、确认 archived/inactive 后才收尾；不能用 ready/在线推断执行成功。 |
| `hapi/cli/src/runner/artifacts/manager.ts:29` 的持久回执恢复，`:59` 的操作请求，`:94` 对 capture 原回执直接返回 | 文件 RPC 可合并传输样板；capture 不重新读文件，materialize/deliver 的同 ID 恢复仍必要。不能统一成无条件重试。 |
| `hapi/cli/src/runner/workspaces/manager.ts:143,207,520,533` 的回执、停止证明、启动重查与仓库锁；`repositories/manager.ts:56` 起的 export/import/result 操作 | Runweft 只编排基线、消费者、中心 pins、轮次和交付，不重建 Git 操作器。启动前及锁内重查不是冗余。 |

上述为源码证据。本次没有运行 HAPI 全量测试、真实模型或远端机器；不能用源码核对替代原生能力实测。

## 按收益与风险排序的已证实清单

前八项优先减少维护面与重复环境。后四项收益较小，只有实现比现状更直观才实施。顺序同时考虑风险；实际依赖顺序见文末。

| 排名/编号 | 候选 | 收益 | 风险与依赖 |
| --- | --- | --- | --- |
| 1 / S01 | 拆除中心 fixture 对旧服务的反向依赖 | 高：解锁旧路径退役，少起一套服务 | 中：必须保留原生故障注入与测试隔离 |
| 2 / S02 | 将过期 smoke 迁到有效入口，收敛重复场景 | 高：恢复验收可信度、减少两套流程 | 中：逐场景建立替代，不删唯一恢复证据 |
| 3 / S03 | 移除产品不可达的 YAML Agent/旧客户端/MCP 分支 | 高：一套入口、schema、配置来源 | 中：S01/S02 和有效测试迁移在前 |
| 4 / S04 | 退役旧公开 handler 与 namespace 资源服务 | 高：去掉第二套业务路由/资源库接线 | 中高：共享 schema、数据迁移和核心协调器不能误删 |
| 5 / S05 | 删除旧看板实现，保留有效 UI/CLI 保障 | 中：减少第二套认证与展示代码 | 低至中：需先救出 open 和仍有用的浏览器断言 |
| 6 / S06 | 明确测试临时目录所有者，清理失败仍完成其他清理 | 中：避免文件/端口/进程残留与重复清理代码 | 低至中：不能清除可恢复现场或其他测试目录 |
| 7 / S07 | 合并两份真实 Hub 探测 smoke 的启动/退出样板 | 中：一个固定启动路径 | 低至中：保留独立权限/配置/心跳场景 |
| 8 / S08 | 根测试内相同 CLI 编译只做一次 | 中：减少重复构建；收益尚未计时归因 | 低至中：须保持单文件运行与二进制测试隔离 |
| 9 / S09 | 任务详情纯投影只计算一次 | 小 | 低：字段、分页、别名全部保留 |
| 10 / S10 | 收敛 send 的同层 schema 重复解析 | 小 | 低至中：只移除已解析值的再解析，不动授权重查 |
| 11 / S11 | 合并四处文件 RPC 传输样板 | 小至中 | 中：只合并 POST/回执 ID 检查，恢复策略不合并 |
| 12 / S12 | 用行为保障替代对编译后 JS 拼写的断言 | 小：减少无意义失败 | 中：现有真实浏览器保障不在默认根测试内 |

### S01 — 中心 fixture 先启动旧系统再关闭旧协调器

- **位置/证据**：`test/hub-delegation-fixture.ts:10` 调用 `taskFixture` 后立刻 `await h.tasks!.close()`，`:15` 再创建中心委派网关；`test/tasks-fixture.ts:25,123,132` 构造旧资源 fixture、登记旧 runtime、启动旧协调器；`test/resources-fixture.ts:29–89` 同时创建原生假服务、namespace JWT、旧协调器/工作区服务和 `createRunweftHandler`。关闭旧协调器并没有关闭旧 gateway，后者仍等 teardown。新链路因此一直依赖旧 API、资源模型和 Agent 数据。
- **具体改法**：把已有 native fake 的机器、sessions、receipts、message queue、故障开关及实际 HTTP 服务独立成一个小 fixture；中心 fixture 直接在它上面组装 `createDelegationGateway`。将 task/workspace/remote 的业务初始化改为中心身份、空间、Agent 和 target；不要做可配置模拟平台，不要跨测试共享可变服务器。
- **能力保持**：变的是测试接线；丢回执、并发、重启、原生错误和停止证明继续由同一故障开关驱动。不能把现有 HTTP 行为断言全部改成直接调用内部方法。
- **验证**：先迁 `hub-delegation`/`hub-consumers`，核对实际请求均走中心网关；再分批迁 `tasks`、`task-rounds`、`task-workspaces`、`task-files`、`task-outputs`、`remote`、`remote-tasks`、`task-results`、`tasks-mcp`。每批运行对应 `bun test ./test/<file>`，最后根测试；保留重启及两 runtime 用例。原先唯一故障场景尚未迁完时不得做 S03/S04。

### S02 — 多个 smoke 仍使用已移除的命令或旧客户端

- **位置/证据**：下表列出直接依赖。`package.json` 仍公开其中多个 `test:*` 脚本。专用 home 中执行当前 `bun src/cli.ts … agent init review` 和 `workspace bind …` 均退出 1 / unknown command；无 Hub 的 `machine list` 返回 `hub_connection_required`。这是前置命令不兼容的实测，不是宣称完整 smoke 已运行失败。

| 旧依赖 | 已定位文件 |
| --- | --- |
| `agent init` | `scripts/smoke-agents.ts:42`、`smoke-artifact-mcp.ts:217`、`smoke-collaboration.ts:379`、`smoke-reconstruction.ts:135`、`smoke-remote-native.ts:95`、`smoke-task-controls.ts:92`、`smoke-task-inputs.ts:56`、`smoke-task-mcp.ts:154`、`smoke-task-outputs.ts:73`、`smoke-tasks.ts:50`、`smoke-workspace-preparation.ts:57,131`、`smoke-worktree-tasks.ts:111`、`remote-task-probe.ts:31` |
| `workspace bind` / 旧升级种子 | `scripts/smoke-upgrade.ts:123,124` 明确用于 oldBinary，不能据此判废；真正与当前候选冲突的是 `:146` 对 newBinary 的 `agent init` |
| `new TaskClient` / `new PreparationClient` | `scripts/smoke-remote-package.ts:52`、`smoke-result-retention.ts:53`、`task-results-probe.ts:119`、`smoke-remote-native.ts:97` |

- **具体改法**：以 `smoke-hub-native-mcp`、`smoke-hub-consumers`、`smoke-hub-console`、`smoke-hub-connect`、`smoke-hub-service`、`smoke-hub-upgrade` 为当前接线，建立“场景→现行入口→证据文件”的对应。先迁旧流程独有的故障注入与留存/升级断言，再删除被完全覆盖的旧启动流程。现有 `test:*` 名称保留为有实际对应场景的入口或兼容转发，不能改为无操作成功；旧升级种子明确指定旧版本输入。
- **能力保持**：十二组宿主×runtime×工作区组合、真实模型失败/权限、输入输出、继续/重建、取回/清理和安装升级的保障按语义保留。当前消费者脚本并未证明覆盖所有旧故障，不能据“新 smoke 已有”整批删旧脚本。
- **验证**：每个保留 `test:*` 在专用环境能够到达实际业务场景；证据写明候选 binary/hash、场景、清理和结果。迁移涉及的原生/浏览器流程逐项运行，再按发行 Specs 做同候选集成验证。源代码层 HAPI 操作测试如 `smoke-inputs/outputs/repository-*` 需单独判定，不能因命名旧就删除。

### S03 — 产品已必连 Hub，内部仍保留旧客户端和 YAML Agent 选择

- **位置/证据**：`src/cli.ts` 接中心命令及 `HubTaskClient`；`src/mcp/commands.ts:46` 给服务传入 Hub options。但 `mcp/tasks.ts:10,25–36`、`mcp/server.ts:15,31–44,53,59–66`、`mcp/artifacts.ts:33` 仍以可选 Hub 切换旧客户端、诊断和 schema。`tasks/client.ts:64` 自称等待默认入口切换的 Legacy consumer，调用 `AgentClient`；`remote/client.ts:11` 同类。`agents/client.ts`、`agents/bindings.ts` 和 `agents/definitions.ts:49` 起仍实现项目/全局 YAML、旧 namespace 绑定与文件 init。当前入口探针和 [中心委派 Spec](https://github.com/iTgo-lyq/runweft/blob/d7bc66b9ffd7c4c07fbb940280424b11feffc58a/docs/project/specs/delegation/central/spec.md) 已排除这些产品路径。
- **具体改法**：MCP 产品 context 必须携带 Hub connection；移除旧分支与 `taskTools(hub=false)` 的双套定义，使公开 schema 保持当前 Hub 版本。删除无现行消费者的 `TaskClient`、旧 `PreparationClient`、`AgentClient`/bindings/YAML discovery。只在测试 seam 中保留必要可注入工具，不留“无 Hub 产品模式”。旧 TaskClient 去除后，评估把唯一继承的 `TaskOperations` 直接并入 HubTaskClient，保持方法签名，不另建客户端抽象。
- **不能整目录删除**：`agents/definitions.ts:35` 的 `contentVersion` 被中心 resolver/selections 使用；`AgentDefinition`/`AgentSource`/schema 仍是持久快照和类型依赖，应迁到现有领域类型模块后再删文件读写部分。`agents/launch.ts` 仍承载原生参数与 MCP 禁用映射。`PreparationView` 等被中心客户端使用的类型应搬迁保留。`resources/native.ts`、`resources/types.ts` 仍被中心资源模块使用。
- **能力保持**：npm 包对外提供二进制，`scripts/package.ts` 没有发布旧 TypeScript SDK exports；这里清理的是内部旧实现。CLI/MCP 名称、当前参数/返回字段、身份校验、stderr/协议 stdout、错误提示及显式 Hub 要求不变。`HapiClient` 仍服务私有 HAPI 和透传命令，不能因删旧客户端一并移除。
- **验证**：保留 `resource-commands.test.ts` 的无 Hub 拒绝；中心 Agent 版本/选择/异步撤权测试；`mcp.test.ts` 的宿主精确身份、取消、EOF/协议输出；`artifact-mcp` 的路径限制/丢回执；compiled `hub-consumers` 和十二组原生 MCP。静态检查剩余源码和活跃脚本不再依赖旧构造器；不是只以 typecheck 通过验收。

### S04 — 旧公开路由与旧资源服务只由旧接线维持

- **位置/证据**：`src/api.ts:21` 的 `createRunweftHandler` 只由 `test/hub.test.ts` 和 `test/resources-fixture.ts` 导入，当前 `services.ts:159` 组装新网关。旧 handler 仍用 HAPI uid/ns JWT，接 `resources/api.ts`、`tasks/api.ts`、`remote/api.ts` 与旧看板。`tasks/coordinator.ts:42`、`remote/service.ts:25` 在中心模式仍无条件打开 `ResourceStore`；它们的旧 `accept` 与旧 `overview` 才需要 namespace `ResourceService`。中心 `HubDelegationService` 总是传入 policy，调用 `acceptResolved`，中心 overview 在 `hub/delegation/api.ts` 直接使用中心资源服务。
- **具体改法**：S01/S03 完成后删除旧 handler、资源/准备路由和只服务旧分支的 `ResourceStore/ResourceService`；让协调器及准备服务明确接中心 policy，去掉仅旧入口需要的 accept/overview/client cache 和额外旧资源 DB 连接。保留现有 TaskCoordinator、WorkspacePreparations 的业务执行/恢复主体，不重写协调框架。
- **必须先拆共享依赖**：`tasks/api.ts:18–22` 的 List/Read/WaitSchema 由 `hub/delegation/api.ts:4` 使用，移到现有任务类型/请求模块；不能整文件直接删。`resources/types.ts` 的 Flavor/Inspection/error 等与 `native.ts` 的原生探测继续使用。现有 `state.ts` 的增量迁移、旧行保留和更高版本拒绝不属于本项删除范围。
- **能力保持**：现行公开 HTTP 的路径/方法/状态码/字段/owner×space 隔离不变，旧 HAPI/root token 继续被拒绝；不“认领”旧任务，也不修改用户数据库。旧 `test/hub.test.ts` 应接当前身份网关，仍测身份/空间/邀请/原子并发。
- **验证**：当前公开 HTTP 及权限测试、真实 outgoing RPC 撤权测试、存量 schema 升级/隔离测试、所有迁移后的协调器故障测试；编译后服务启动与 Hub upgrade smoke。确认中心构造不再额外创建旧资源 store，且 native 请求仍经过授权桥；不能用删除安全测试换取通过。

### S05 — 旧看板具有第二套认证与展示实现

- **位置/证据**：`src/dashboard/server.ts` 仅由旧 `src/api.ts:23` 调用；app/page/style 对应 `/runweft` 及旧 HAPI 登录。当前 `hub/access/http.ts:64` 起及 [看板 Spec](https://github.com/iTgo-lyq/runweft/blob/d7bc66b9ffd7c4c07fbb940280424b11feffc58a/docs/project/specs/dashboard/subagents/spec.md) 只开放新后台。`test/dashboard.test.ts:18–106` 测旧界面，`:109` 起却是仍有效的 `open` 命令安全行为；`scripts/smoke-dashboard.ts`、`dashboard-browser.ts` 也接旧数据/页面。
- **具体改法**：将 `open` 用例移动到 `service-commands.test.ts`，把仍适用的旧请求竞态、渲染转义、状态可读性保障移入当前 console 测试，再删除旧 app/page/style/server 与对应认证流程测试。`src/dashboard/assets.d.ts` 是全局 CSS 模块声明，当前 `hub/page.ts` 仍需要它，应移动到公共声明位置，而非删除。
- **能力保持**：当前后台的身份/空间切换、任务详情、原生会话跳转、撤权、浏览器存储与无凭据 URL 均保留；旧 localStorage/HAPI root 登录不是恢复目标。
- **验证**：`hub-console`、`service-commands`、`hub-access` 根测试；当前 `smoke-hub-console` 的 Playwright 页面/弹窗/移动端流程。`scripts/fixtures/hub-console-tasks.ts:89–91` 已断言含 HTML 的报告不生成 img，继续保留；旧 UI 的“过期请求不得覆盖新筛选”需确认当前等价自动保障，没有则先补到既有 Playwright 流程，未补不算替代完成。

### S06 — 部分测试目录没有清理所有者，清理列表遇错会中断

- **位置/证据**：`test/helpers.ts:4–8` 仅 mkdtemp；`config.test.ts`、`cli.test.ts`、`resource-commands.test.ts`、`website-build.test.ts`、`release-inputs.test.ts`、`release-assembly.test.ts`、`reset.test.ts` 的 fixture 根没有对应全根删除，部分仅删根下中间目录。`dashboard.test.ts:115` 和 `hub-connect.test.ts:44` 也有单独创建的目录未登记。多数已登记的 afterEach 采用 `for (...) await fn()`，首个拒绝会跳过剩余关闭/删除。
- **具体改法**：一个小测试 helper 创建目录并立即登记到该测试的 cleanup 列表；已有服务 fixture 统一遵循“后创建先关闭，进程/DB 关闭后删除”。清理循环尝试所有项并最终报告收集到的失败，不吞错，不用全局扫描删除 `.dev-smoke`。无需通用资源管理框架。
- **能力保持**：普通单测可再生目录按所有者删除；专门跨重启使用的目录由完整用例持有至结束。真实 smoke 的证据/故障恢复现场不按此规则一律删除，见 U03。
- **验证**：运行涉及的单文件和根测试，对比本次产生的目录/监听进程，不能依赖仓库历史残留数量；向 cleanup 中注入一次失败，确认之后的 DB/server 关闭仍执行、测试仍报失败。这是资源释放的有意义故障测试，不是重复断言 helper 实现。

### S07 — 两份现行 smoke 复制了相同启动和退出流程

- **位置/证据**：`scripts/smoke-hub-resources.ts:12–64` 与 `smoke-hub-configuration.ts:12–64` 重复环境清洗、独立模型 home、启动 HAPI、健康轮询、身份备份、CLI 执行/凭据检查、Runner 启停；差别主要是 gateway factory、配置用例和参数。末尾 finally 串联 stopRunner → gateway.close → store.close → kill HAPI → 写证据，前一步抛错就跳过余项。
- **具体改法**：提取一个固定用途的 Hub 原生探测 fixture，参数限 binary/cli 路径、专用 root 和 gateway factory；返回现有 cli/start/stop 等少数操作。负责所有退出尝试及最终证据，保留主失败和 cleanup 失败。不同业务脚本仍是独立场景，不创建 scenario DSL 或可插拔测试框架。
- **能力保持**：resources 的真实心跳过期/机器凭据撤销和 configuration 的仓库/Agent/本人选择、零模型断言不同，不能删其中一套业务测试。保留独立 home、无模型认证复制、日志秘密检查。
- **验证**：运行两份真实 HAPI/Runner、仅版本探测的 smoke；分别模拟启动失败及关闭失败，确认无遗留进程且 evidence 标失败。持续等待健康是启动同步，不按多余重试删除。

### S08 — 根测试重复编译同一 CLI 三次

- **位置/证据**：`test/hub-resource-cli.test.ts:14–20`、`hub-connect.test.ts:17–23`、`hub-consumers.test.ts:18–23` 各自在 beforeAll 对同一 `src/cli.ts` 执行相同 Bun compile，无编译参数差异。基线根测试执行了三次独立编译；51.50 秒总耗时不能全归因于构建。
- **具体改法**：集中为一次测试进程级 binary 准备，三个测试组复用只读产物，各自仍使用独立 home/server。优先一个明确负责 build/cleanup 的 suite 入口或既有 runner 的 preload/teardown；单文件模式没有传入 binary 时仍准备一次。不要加长期构建缓存、内容寻址或锁服务。具体 Bun hook 生命周期在实施前做小实验，不能让某文件 afterAll 提前删除其他文件仍在用的产物。
- **能力保持**：保留所有 compiled CLI/stdio MCP 黑盒测试；不能替换成只调用源函数，也不能复用未经候选核对的 dist/runweft。
- **验证**：全套记录本次实际编译次数为 1、逐个文件可独立执行；各测试 home 独立、构建失败明确失败、完成后删除本次编译产物。计时前后只作为收益观察，无速度门槛。

### S09 — 同一次详情构造重复纯投影

- **位置/证据**：`src/tasks/views.ts:40–58` 的 `detail` 对同一 bundle/round 三次调用 `overview`，还重复调用其内部已计算的 `codeView`、`gitDelivery`；期间无 await 或状态修改。
- **具体改法**：局部 `const summary = overview(bundle, round)`；展开 summary，report 扩展 summary.report，delivery 引用其 code/git/artifacts。只在函数局部复用结果，不加跨请求缓存。
- **能力保持**：当前 `code`/`git` 与 `delivery.*` 的对外字段即便重复也全部保留；详情分页继续覆盖报告 text/next_offset，不返回第二份无界报告。
- **验证**：现有 `task-rounds.test.ts:149,154`、`tasks-overview.test.ts:66,95`、`hub-console.test.ts:70` 的报告、交付和详情断言；迁移后的同组测试继续运行。无需为调用次数写实现镜像测试。

### S10 — Hub send 将同一已解析请求再次送入同一 schema

- **位置/证据**：`src/hub/delegation/service.ts:159` `parseTask(SendSchema, value)` 后将 input 直接传入 coordinator；`src/tasks/coordinator.ts:231` 立即再次 `parseTask(SendSchema, value)`。这里没有新增网络、文件或权限边界，也未修改 input。旧 API 直调协调器是保留第二次解析的历史原因。
- **具体改法**：S04 消除旧入口后，以 `z.infer<typeof SendSchema>` 作为内部 send 输入，公共 Hub service 负责原始请求解析。只做该明确重复；其他 action 是否同样重复需逐条确认，不批量删除 parse/strictObject。
- **能力保持**：MCP/CLI/HTTP 的原始数据校验、未知字段拒绝、parent 校验、resolver await 后 lease.check、TaskStore 事务内排他/幂等重查都保留。消除形状再解析不等于跳过执行授权。
- **验证**：`hub-delegation` 的配置竞态/撤权/新轮次快照；`task-rounds` 的 next/steer；`task-files/outputs` 的非法附件与 steer 拒绝；`task-workspaces:173` 的删除与续轮互斥。通过现行 HTTP 传非法 send，仍在副作用前失败。

### S11 — 文件 RPC 的传输与 operationId 校验有四份

- **位置/证据**：`src/tasks/files.ts:57–62`、`outputs.ts:28–34`、`retention.ts:22–28`、`src/remote/transfers.ts:43–48` 均 POST `/api/machines/<id>/artifacts`、JSON 序列化、核对返回 operation.request.operationId。已经使用同一 HAPI 文件协议。
- **具体改法**：保留一个窄函数，接受现有授权后的 HapiHttp、machineId、ArtifactTransferRequest，返回回执；复用现有领域文件位置或一个文件 RPC helper。各调用方仍提供原 client，保留现有错误 code/status/hint 差异；不引入泛型操作总线或回执状态机。
- **能力保持**：files.prepare、outputs.step、transferReceipt 的 unknown/inspect/retry 分支不在本项合并范围。HAPI capture 的不可重复读取语义、deliver/materialize 恢复、输出授权 grant 回收、Task/Round pins 与持久状态都保持。授权桥不会被公共 HTTP helper 绕开。
- **验证**：`task-files`、`task-outputs`、`remote`、`task-results` 丢回执/部分失败/重启/清理测试，以及 `hub-delegation-native` 的转移 grants 测试；回执 ID 不一致和机器离线仍返回原有可操作错误。若为了保留四种错误而必须增加复杂配置，宁可保留小段重复。

### S12 — 编译后 JavaScript 字符串断言对拼写敏感

- **位置/证据**：`test/hub-console.test.ts:65–67` 检查 `runweft.native.access`、精确 `url.searchParams.delete("token")` 和 header 表达式等源码片段；重命名局部变量或转译形式就会失败，且片段存在不证明代码执行。`scripts/fixtures/hub-console-tasks.ts:99–110` 已有真实弹窗、sessionStorage 清除、opener、URL、SSE/原生页面等行为验证。
- **具体改法**：保留静态脚本可提供/内容类型断言和 JWT purpose/有效期/轮换服务测试；把与清 token/header 相关的断言挂到当前 Playwright 原生页面行为，确认请求使用短期 native 凭据且地址无 token，再删除精确拼写断言。若需要默认测试覆盖，应让该小行为用例进入明确执行的既有浏览器验证入口，不引入新的 DOM/mock 框架。
- **能力保持**：不能仅因为旧 smoke 有类似描述就删根测试。真实 browser smoke 不在 `bun test ./test` 中；实施必须记录执行层级变化并保证必跑入口，不能让安全保障变为手工可选。
- **验证**：Playwright 实际观察 URL、存储、授权请求、身份轮换后拒绝；保留根测试的 purpose/expiry/错误 credential 类型断言。编译形式变化不应再导致业务未变的失败。

## 测试删除、合并与继续保障

下表的“继续保障”区分现有保障和必须迁入的保障。没有完成后者之前，删除条件不成立。测试数量不作为是否等价的依据。

| 原测试/流程 | 建议 | 继续保障及删除条件 |
| --- | --- | --- |
| `agents.test.ts` 的项目/全局 YAML 优先级、影子文件、目录发现；`agent-targets.test.ts` 的旧 bindings/local routing | 旧配置专属用例随 S03 删除；原生默认值/错误隔离/快照/探测竞态提取保留 | 现有 `hub-agents` 的版本/CAS/共享权限，`hub-agent-resolution:31,49,101,115` 的中心选择/不回退/不可变快照/异步重查；原生 launch mapping 单独保留原断言，不靠中心选择测试代替。`resource-commands` 继续证明默认不读 YAML。 |
| `resources.test.ts` | 旧 namespace registry CRUD 和旧 local-only 路由删除；错误传播/探测约束迁移 | `hub-resources:138,176,246,294,338`、`hub-resource-cli` 已保障当前 CRUD、DTO、在途撤权、单机失败隔离；原来 `:105` 的 native preflight 与实际命令错误、`:224` 的错误 code/hint/status 不重放，须确认在中心测试中等价，缺少则迁入。 |
| `tasks.test.ts`、`task-rounds/workspaces/files/outputs/results`、`remote/remote-tasks` | 保留行为用例，替换 S01 fixture/旧客户端；不因重复两 runtime 就删 | 丢 spawn/send 回执、unknown、不重放、仅确认原生缺失才重建、输入 pin 意图、Git seal、输出 capture/deliver、部分发布和 cleanup/release 重启是不同失败窗口；迁到中心入口后原断言继续保障。旧 Agent 文件被删除后的接受重试改为中心 Agent 编辑/撤销后的原 request 查询。 |
| `task-workspaces.test.ts:12`、`tasks.test.ts:20`、`task-results.test.ts:95` 及 hub 系列迁移用例 | 保留数据读取/迁移用例，区分旧协调器可继续与当前中心隔离 | `hub-delegation.test.ts:124` 继续保障不扫描/认领旧无 owner 任务；迁移测试继续证明旧行/十四张历史表等未被删除。不能用“不再公开执行旧任务”推出“删除旧库升级”。 |
| `tasks-mcp.test.ts` 与 `hub-consumers.test.ts` | 合并已等价的发现/接受/幂等/隔离 happy path | 保留 compiled `hub-consumers:89` 的 2×2 宿主/runtime 入口；旧 `tasks-mcp:69,95,113` 的精确审批、取消/断联等待不停止工作、repair-finish 与 worktree 续轮迁入后才删重复壳。Claude hook 的一次消费与 Codex fork 身份继续由 `mcp.test.ts` 保证。 |
| `artifact-mcp.test.ts`、`task-outputs.test.ts:182` | 改 Hub context，保留文件和调用幂等场景 | 工作区路径/符号链接约束、上传丢回执、不覆写、取消清理、retry 固定候选与 collect 新版本不能用普通 spawn smoke 替代。 |
| `tasks-overview.test.ts` | 保留 query/views 的纯读与分页行为；旧 namespace HTTP 外壳迁中心 | `hub-console.test.ts:70` 已测 owner scoped details/pagination，但不等价于 `tasks-overview:131,156,165,178` 的只读、严格过滤、库存超时与千任务有界页，需迁入后再删旧请求。 |
| `hub.test.ts` | 切换当前身份 API fixture，保留身份/角色/邀请并发 | 其身份摘要/轮换、跨空间权限、单消费者邀请和持久化仍是产品能力；不是旧 handler 删除时的连带删除对象。 |
| `dashboard.test.ts:18–106` 与 `smoke-dashboard/dashboard-browser` | 删除旧登录/storage 流程，迁移有效渲染/竞态；`:109` 起移动而非删 | 当前 `hub-console`/`smoke-hub-console` 保障后台与 native scope，`hub-console-tasks:89–91` 保留报告转义保障；`service-commands` 接住 open 无 token/公开地址。过期请求覆盖无等价自动断言时先补。 |
| `hub-console.test.ts:65–67` | 删除源码拼写断言的条件见 S12 | JWT scope/expiry/rotation 的根测试保留，Playwright token 清理/请求行为必须在明确必跑的验证入口中。 |
| 三份 CLI compile beforeAll | 合并构建，不合并身份/资源/消费者业务用例 | 编译二进制、真实子进程 argv/exit/stdio/0600/CAS/并发仍逐例运行。 |
| S02 列出的旧 smoke | 按场景迁移后合并环境与重复 happy path，保留命令入口 | 当前十二组 native MCP 和 consumers/console/connect/service/upgrade 是接线基础；权限、故障窗口、结果留存、原生历史重建、模型失败等逐项保留，不能按文件名或组合数决定删除。 |
| `execution.test.ts`、`hub-access/resources/resource-dispatch/sockets`、`mcp-install`、`artifacts`、`reset`、发行/官网测试 | 本轮无明确整组删除建议 | 分别覆盖真实边界协议、异步撤权、配置无损编辑、字节校验/幂等、安全重置、候选一致性和发布回执；文件较长或例子相似不足以证明重复。 |

## 明确保留的校验、状态和恢复

| 看起来重复的部分 | 不作为瘦身候选的依据 |
| --- | --- |
| config 原始 YAML 与环境覆盖后结果两次校验 | `config.ts` 先拒绝损坏持久配置，`config.test.ts:46` 专测覆盖值不能掩盖它；删除会改变可诊断性。 |
| HTTP/MCP/schema、存储事务、HAPI Runner 校验 | 分别面对不可信输入、并发数据、另一台机器与真实文件系统；不能以客户端已校验为由省略后端。 |
| lease.check、多次 parent/target 校验 | `hub/access/transport.ts` 的流式检查，`sockets.ts` 的真正 RPC/ack 出口检查，以及 resolver await 后检查面对撤权竞态。`hub-resource-dispatch`、`hub-resources:176,294`、`hub-agent-resolution:115` 有针对性保障。 |
| 请求接入 lookup 与事务内幂等检查 | 前者在依赖变化后仍恢复原请求；后者保护并发首次接受。故障或并发重查不是相同纯计算。 |
| Task/Round/inputs 与原生 session/message/receipts | 一个是业务编排和对外完成，另一个是执行事实。Git/附件交付可能继续处理，不能把 native 完成等同任务已交付。 |
| 文件 hash/size、prepared files/workspace 重查 | 上传、中心存储、跨机传输、落盘与实际启动跨越不同信任边界；路径和文件在异步期间也可能变化。 |
| unknown、inspect、固定 ID 重试 | 丢回执不能推断失败；HAPI 已提供回执与恢复语义。删除会造成重复模型/commit、丢结果或错误清理。 |
| queue 的 rejection handler、optional structured report fallback | serial 的 rejection handler 只隔离队列尾链，调用结果仍报错；`tasks/reports.ts` 原文保留是可选报告格式契约。不是静默业务成功。 |
| inventory/单 Agent 探测失败保留其他项 | DTO 明确带 error/历史标记；避免一个离线机器掩盖全部持久任务。不能改成吞掉错误，也不应一错清空。 |
| HubClient 与私有 HapiClient | 公开主体/空间/JWT 与私有 namespace/native transport 不同；没有证据支持为几行 request 样板混成一个认证客户端。 |
| schema 升级、旧库隔离、输入/输出/result pin | 旧数据可读/不认领、不同消费者与恢复事实有明确 Specs；不删表、不隐式回收现场、不自动导入 YAML。 |

## 待验证事项

| 编号 | 怀疑与位置 | 当前证据不足之处 | 建议验证与判定 |
| --- | --- | --- | --- |
| U01 | `tasks/outputs.ts:35–50` 对 unknown capture 再调用 request 可能无意义，和 `remote/transfers.ts` 的恢复不同 | 当前 HAPI 将中断 capture 记 failed，重复 capture 仅返回原回执；尚未证明所有受支持远端版本和持久旧回执都不会有 unknown capture | 用固定 HAPI 构造 capture 过程中 Runner 中断/丢响应，查询原回执；核对受支持 capability 与旧回执来源。只有无业务/恢复作用才删此动作；materialize/deliver 同 ID 恢复保留。 |
| U02 | 两条 CI 的平台构建、freeze/hash 检查可能重复，见 `.github/workflows/cli-install.yml`、`npm-publish.yml`、`scripts/build-hapi.ts`、`package.ts` | 不同触发器各自独立候选，package 可独立运行；当前没有同一次发布内完全重复、且可安全复用产物的证明 | 画同一 run 的产物 DAG、记录实际构建次数/来源 SHA/manifest，复用只允许同候选；不能因相同脚本在两个 workflow 出现就删校验或降低四平台保障。 |
| U03 | 多个 native smoke 的 root、复制的模型 home 长期残留，初始化在 try 前 | 一部分是明确用于重启、结果回收和发行证据的现场；本次没跑真实模型，不知哪些可直接删 | 列每个 root 的进程、秘密文件、可再生缓存、证据、后续消费者；在进程确认关闭后删可再生/凭据副本，保留脱敏证据，恢复现场另有显式策略。不能把整个 `.dev-smoke` 当垃圾清空。 |
| U04 | 旧 Task.accept/next 的 Round 字面量、artifact/result retention 状态看似重复 | Round 默认值相似不等于需要抽象；两种 retention 的 pins、discard、cleanup、revision 不同 | 在旧路径退役后重新看剩余重复；仅多个独立维护点确实引发默认值漂移且简单局部函数更清楚时提炼。拒绝通用状态机/可配置 schema 工厂。 |
| U05 | `TaskOperations`、多套 error/JSON 处理、传输 request equality 可继续合并 | 单继承可能消失，但具体错误 code/hint、取消、auth scope 和 `JSON.stringify` 对比与 deep equality 不完全等价 | S03 后列全部方法调用及错误契约；用同一请求的字段顺序/默认值/冻结回执验证。没有等价证明就保留差异，尤其不统一 HTTP mutation 重试。 |
| U06 | 现行十二组 native MCP、十组 consumers 与旧大矩阵含重复组合 | 接入宿主与执行 runtime 的身份/MCP/审批/恢复语义不同；未测得哪组只重复另一组已覆盖的边界 | 场景×宿主×runtime×模式×故障窗口建立映射；只有完全相同入口和风险且已有必跑等价断言才合并。保持现行发行 Specs 的十二组；要调整正式验收契约须另有证据，不能本轮预设缩减。 |

## 建议实施顺序与完成判断

以下是后续 Technical/Plan 的任务边界建议，本次不执行。沿用现有授权，Plan 形成后按 AGENTS.md 在当前工作区做一次 iclaude 评审，主 agent 独立采纳；不新增人工门禁。

1. **冻结当前接口与保障映射**：记录现行 CLI/MCP schema、HTTP 路由/错误、权限与恢复测试，以及 S02 旧场景迁移目标。不会为了保持旧源码恢复已下线产品路径。核对 npm-patch-release 已结束或在独立工作区实施，避免改动正在发行的候选。
2. **先整理 fixture 与清理**（S01/S06）：先中心委派，再核心任务与 remote 家族；保留行为断言和 fault hooks，分批提交。每批只在对应测试和根基线通过后继续。
3. **迁移并收敛 smoke**（S02/S07）：先无模型配置/服务/连接，再工作区/附件/结果，最后真实模型/十二组合/后台 Playwright。逐项填补替代矩阵，不要求用户代做本地验收；需物理远端时单列条件与缺口。
4. **退役旧客户端与服务**（S03/S04/S05）：先搬共享 schema/hash/type/CSS 声明，再使 Hub 接入必需、删除旧分支和旧 UI；保留数据库迁移、旧数据隔离与原生私有 client。类型检查、根测试、构建、服务/升级/compiled consumers/浏览器全部覆盖相关行为。
5. **小范围实现收敛**（S09/S10/S11）：纯投影先做；同层解析依赖旧入口已移除；RPC 仅去样板。每项独立验证，不和权限/恢复策略修改混在一起。S08 在确认测试 runner 生命周期后执行；S12 在浏览器保障成为必跑后执行。
6. **同候选整体验收**：按现行发行 Specs 验证全部能力；保存实际执行结果与缺口，再同步已验证的实现事实、归档。U01–U06 按实验结论决定另加任务或明确排除，不自动变成删除目标。

删除的完成标准：没有当前产品/活跃验收调用方；共享类型和数据读取未丢；原有有效行为断言能指向现行入口并已执行；权限/恢复测试未减弱；公开接口、错误、输出和安装发行不变。仅 root tests 通过不足以完成涉及模型、原生 Runner 或浏览器的验收。

## 本次实际执行与未验证范围

| 检查 | 实际结果 |
| --- | --- |
| `bun run typecheck` | 退出 0，`tsc --noEmit`。 |
| `bun run test`（`bun test ./test`） | 退出 0；265 pass、0 fail、5305 expect，43 个测试文件，51.50 秒。包括测试自己的专用 CLI compile，不等于产品发行构建。 |
| 专用 home 的旧 CLI 入口探针 | `agent init`、`workspace bind` 均 unknown command / 退出 1；无 Hub 的 machine list 返回 hub_connection_required；agent help 列出现行中心命令。 |
| 文件覆盖与调用核对 | tracked 范围 268 文件，加 6 个根构建/配置文件；模块及清点方式见 coverage。只读核对当前 HAPI 实现与固定 revision。 |

本次没有运行 `bun run build`、全部 smoke、Playwright、真实模型、HAPI 全量测试、物理跨机、平台发行构建、npm 上传或官网部署。已有 Specs/归档的通过记录只是历史证据，不在此重复宣称通过。现有根测试包含大量旧接线，通过不代表旧 smoke 或中心入口已覆盖全部故障。

临时清点脚本/原始输出保存在未跟踪的 `.dev-smoke/module-slimming-audit/`：`inventory.ts`、`inventory.json`、`typecheck.log`、`test.log`、`entry-probes.json`。可复核结论与限制已写入本报告，不依赖这些临时文件长期保留。
