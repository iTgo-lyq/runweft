# 模块覆盖表

本表与 [审计报告](research.md) 配套。调查对象是当前 Runweft 文件与它对固定 HAPI 的依赖，不把 HAPI 独立仓库内部全部模块计入 Runweft 覆盖率。

本表保留首次只读审计的基线、文件位置和当时判断。后续用户已授权实施，并明确不保留历史数据迁移/兼容、不清理旧数据；P04及其他“保留迁移”表述已被[技术方案](technical.md)的T14取代。实现、实际验证和排除项以[执行记录](execution.md)为准；下表“本轮未跑”仅指初次审计，不代表后续验收结果。

## 范围与完成口径

- 基线：Runweft `36257dfb3aae2da85289539b11ba8ac857bdbb10`；HAPI `3ac8b08b2aead13e9eaae459de62d9a5d5df7395`。
- 使用 `git ls-files src test scripts website skills .github` 得到 268 个文件：src 124、test 50、scripts 72、website 13、skills 6、.github 3；再纳入根目录 6 个构建/配置文件，共 **274 个文件**。其中 test 为 43 个测试文件和 7 个 helper/fixture。
- 以下 **49 个模块组**均已完成结构清点、有效入口/消费者与关键保障调查。清单末尾给出互不重叠的完整文件归属；文件级静态扫描和模块追踪不等于所有代码行人工审读或每条分支运行。
- 对 TS/JS 检查导入、声明、测试与异常分支；对页面/样式、声明文件、YAML/JSON/锁文件检查加载入口与用途。源码地图没有调用方的结论同时核对 CLI/server wiring、浏览器文本资源及共享类型。
- 搜索不以 node_modules、dist、历史 archive 作为现行调用方。历史 Change 仅按明确入口读取迁移/验收依据。临时分析文件在 .dev-smoke，未纳入交付。
- 本次只运行根 typecheck、43 文件根测试和专用 home 入口探针。表内 smoke/Playwright/原生验收名称表示现有保障位置，不表示本次执行通过；具体结果见报告末尾。

## 产品模块

| 编号/模块（文件数） | 职责、有效入口与调用链 | 现有保障 | 判断 |
| --- | --- | --- | --- |
| P01 CLI、配置与错误（3） | CLI 解析 → 配置原文校验/环境覆盖 → 业务命令；统一 JSON/stderr 错误。 | cli/config/resource-commands；不写默认配置、坏 YAML 不被覆盖掩盖。 | 配置与错误无明确瘦身项；当前 wiring 为 S03/S04 的入口证据。 |
| P02 服务、Runner、代理与重置（5） | start/serve/runner/doctor/open/reset → 独立 HAPI 子进程、中心 gateway、连接 Runner；代理 HTTP/SSE/WS。 | service-commands/proxy/reset；服务 instanceId/进程核验；service/upgrade smoke 为现有保障，未在本轮执行。 | 未发现可删除的生命周期/停止检查；S05 仅迁入 open 测试。 |
| P03 私有 HAPI 与执行适配（2） | 协调器/私有 bridge → HapiHttp、spawn/receipt、messages、resume、stop、permission。 | execution 的丢回执、不重放、只在确认缺失后重建、权限 ID、分页事实；实际 HAPI 源码已核对。 | 无明确问题；不合并公开/私有认证，不改原生 launcher。 |
| P04 SQLite 版本与迁移（1） | 各 store → openState → 增量 schema 18；本机 client.sqlite 另有用途。 | tasks/task-results、各 hub store 的升级/并发/reopen 用例。 | 无明确删除项；旧表/数据兼容与无主记录隔离继续保障。 |
| P05 旧 Agent 文件模型与原生 launch（4） | 旧 AgentClient → bindings/definitions；中心 resolver 仍使用内容 hash/类型，launch 映射仍有效。 | agents/agent-targets；中心 hub-agents/agent-resolution；保留原生默认值及 MCP tool filter。 | S03：只退役文件发现/绑定/旧客户端；先搬共享定义/hash。 |
| P06 旧资源模型及共享 native/types（6） | 旧 resources API/client/service/store；中心 HubResourceService 仍调用 nativeMachines/nativeInspections 并共享 types。 | resources 旧语义、hub-resources 当前语义；探测取消、独立错误、版本能力。 | S03/S04：旧注册及 local-only 分支候选；native/types 保留。 |
| P07 任务接口、客户端及请求类型（4） | 当前 commands → HubTaskClient/TaskOperations → Hub API；旧 API 仍贡献 List/Read/WaitSchema。 | tasks-mcp、hub-consumers、task-rounds；当前对外参数、报告/错误格式。 | S03/S04：去旧 TaskClient/API，搬共享 schema；不删现行命令。 |
| P08 任务协调与持久接受（2） | HubDelegationService → acceptResolved/send → 事务请求/Task/Round → 原生执行/交付恢复。 | tasks、task-rounds、hub-delegation；故障窗口、异步撤权与事务互斥。 | S04 旧资源构造/accept/overview；S10 同层解析；U04 不预设抽象 Round。 |
| P09 任务查询、视图和报告（3） | 中心 overview/details/read/wait → 纯查询和受限报告投影。 | tasks-overview、task-rounds 的分页/可选报告、hub-console 的 owner scoped detail。 | S09 纯投影重复；查询只读/有界页及原文 fallback 保留。 |
| P10 本机独立工作区编排（1） | 协调器 → HAPI prepare/seal/remove 回执；记录操作 ID 与确认状态。 | task-workspaces；seal/delete 丢回复、活动互斥、明确 discard。 | 无明确问题；已有 HAPI 管理 worktree，不能省略回执核对。 |
| P11 任务输入、输出与附件留存（4） | 接受前 pins → materialize → 原生停止后 capture/deliver → manifest/retry/collect/release。 | task-files/task-outputs；artifact-mcp；部分失败、pin 意图、清理、重启。 | S11 文件 RPC 样板；U01 capture 重试；留存/故障状态不合并。 |
| P12 代码成果、fetch 与留存（3） | Git sealed result → repository export → 中心 publication → fetch/release 与 revision。 | task-results/remote-tasks；固定字节、quota retry、不重封存、跨消费者 pins。 | 无明确安全删减；U04/U05 只作进一步调查，不抽通用 retention。 |
| P13 文件客户端及 CLI（2） | artifact CLI/MCP → ArtifactClient → 中心流式上传/下载/引用/清理。 | artifacts/artifact-mcp；大小/hash、覆盖保护、丢上传回执、取消清理、413 提示。 | 无明确问题；跨边界校验、临时文件原子落盘及 idle timeout 保留。 |
| P14 远端准备、基线和发布（9） | 中心 workspace prepare → acceptResolved → baseline/store/publication/transfers → HAPI export/import；任务复用消费者。 | remote/remote-tasks/task-results；100+ 批次、LFS/子模块、离线/丢回复、共享 pins。 | S03/S04 旧 client/api/accept/resource store；S11 transport；其余恢复必要。 |
| P15 MCP 协议和业务工具（4） | mcp serve → SDK stdio → tool schema/identity → Hub 客户端；取消/断联传递。 | mcp/tasks-mcp/artifact-mcp、compiled hub-consumers；协议 stdout、子任务禁止递归、路径边界。 | S03 去可选 Hub 分支；tool 的响应封装/取消承担协议职责，保留。 |
| P16 宿主身份与 Claude hook（2） | Codex per-call metadata/原生环境交叉核验；Claude hook 记录精确调用并一次消费。 | mcp 的 fork/clear/resume、等待审批过期、cwd、一对一消费。 | 未发现可删冗余；两个宿主有不同原生身份机制。 |
| P17 MCP 安装与 TOML 编辑（3） | 显式 install/update/uninstall/check/restore → 语义 TOML/JSON 修改、备份与变更校验。 | mcp-install；已有配置无损、后续修改保护、hook home、二进制路径。 | 无明确问题；备份/CAS/原生字段保留不是重复配置框架。 |
| P18 Hub 身份、空间与邀请（3） | Hub HTTP → 身份摘要/轮换、空间成员与邀请事务；其他 store 引用主体。 | hub、hub-access、hub-console；角色/最后 owner、并发邀请、身份撤销。 | 当前业务无明确冗余；hub.test 旧接线需 S04 更换，业务用例保留。 |
| P19 Hub 客户端与连接交接（6） | CLI/MCP/browser begin/confirm/complete → RSA 密文、短期请求、0600 连接记录、身份/空间。 | hub-connect、hub-consumers；丢 ack 恢复、旧响应 CAS、origin、防秘密泄露。 | 无明确冗余；S08 仅合并测试编译。加密与不同 credential checks 是边界。 |
| P20 认证 lease 与私有 transport（3） | 公开 identity/machine/task token → purpose JWT/lease → 私有 native 请求、流/ack 再检查。 | hub-access、hub-resource-dispatch、hub-delegation-native；异步撤权与请求 scope。 | 无明确冗余；检查跨 await/stream 边界，不批量删 lease.check。 |
| P21 原生对象归属和会话映射（2） | 业务 owner×space 与机器 → 原生 session/native ID 映射、intent/receipt 持久化。 | hub-access；双进程抢占、跨机器 history、重启/轮换后映射、旧行不认领。 | 无明确冗余；原生 namespace 不能替代产品权限映射。 |
| P22 HTTP、SSE 和 Socket 边界（3） | 公开路由白名单 → 对象筛选/字段转译 → HAPI HTTP/SSE/Socket 及实际 RPC 出口。 | hub-sockets、hub-access、hub-resource-dispatch；realtime/access smoke 提供原生链路保障（本轮未跑）。 | 无明确可删除的重复授权；不同通道不能只在初始握手校验。 |
| P23 Hub 文件归属与传输授权（2） | 用户/任务文件发布 namespace → 方向性 grant/permit → native store/机器传输。 | hub-access、hub-delegation-native、task-outputs；撤权/重入、并发读授权、恢复后释放。 | 无明确问题；机器控制权不等于用户内容所有权。 |
| P24 中心机器/runtime 资源（8） | enroll/rotate/register/access/governance → store/service → native inventory/tool probe；独立本机 connection。 | hub-resources/resource-cli/resource-dispatch；并发 CAS、主体切换、单机探测、异步撤权。 | 未发现现行模块可删职责；S07/S08 整理它的测试与 smoke。 |
| P25 仓库身份、观察与关联（6） | 本机 Git remote 规范化/观察 → 当前 Hub repository 配置；只上传脱敏身份，工作区路径私有。 | hub-repositories/resource-cli；真实 clone/worktree、insteadOf、多 remote、fork/transport 区分。 | 无明确冗余；本机观察与中心校验关注不同事实。 |
| P26 中心 Agent、本人选择与解析（9） | 定义/版本/共享治理 → 个人 repository/space selection → resolver 快照+当前 runtime；gateway 组合。 | hub-agents/agent-resolution/resource-cli；CAS/版本、禁止选中层失败后回退、异步撤权。 | 当前机制无明确重复；S03 需迁入旧 definitions 中共享 hash/类型。 |
| P27 中心委派、context 与 native bridge（7） | Hub API/client/context → parent/资源/Agent 权限 → policy-aware coordinator/preparations → native bridge。 | hub-delegation/native/consumers；owner×space、固定目标、旧数据隔离、output grants。 | S10 仅同层 SendSchema；S04 搬共享 schemas；private bridge 与协调器权限不可互相替代。 |
| P28 当前 Hub 浏览器界面（11） | /hub → app/console → 资源/仓库/Agent/selection/task 页面；native popup 使用短期 purpose token。 | hub-console 根测试；smoke-hub-console/fixtures 的 Playwright 真实 DOM、弹窗、SSE（本轮未跑）。 | S12 精确 JS 字符串断言；S05 迁入旧 UI 中仍有效的行为保障。 |
| P29 旧公开 handler 与看板（6） | 生产入口未调用；旧 fixture/hub.test → createRunweftHandler → resources/tasks/workspaces/dashboard。 | 旧 dashboard/hub 测试；当前 /hub/入口拒绝由中心权限路径承担。 | S04/S05；assets.d.ts 全局声明和 open 测试必须搬迁保留。 |

## 测试、验收、发行和产品资源

| 编号/模块（文件数） | 职责、入口与调用链 | 现有保障 | 判断 |
| --- | --- | --- | --- |
| T01 基础 CLI/服务测试（5） | 通过 src CLI 子进程或服务函数验证配置、透传、代理、重置。 | 根测试已运行；各例具体保障见 P01/P02。 | S06 临时目录；不删除真实子进程/信号/路径检查。 |
| T02 旧 Agent/资源及当前拒绝测试（4） | 旧 fixture/YAML/client 行为与当前无 Hub 拒绝并存。 | 根测试已运行；与当前 hub-agents/resolution/resources 逐项映射。 | S03/S04；退役专属语义可删，现行安全/原生参数保障先迁。 |
| T03 任务与轮次家族测试（8） | tasks/rounds/workspaces/files/outputs/results/overview/mcp → 混合旧 fixture 和共享核心。 | 根测试已运行；原生故障多为 fake 注入，不冒充真实模型。 | S01；报告测试迁移表明确保留故障窗口与查询保障。 |
| T04 执行、文件与 MCP 测试（5） | 协议模拟服务、stdio SDK、专用安装配置、文件传输故障。 | 根测试已运行；身份、响应未知、取消、备份/restore、路径/hash。 | S03 接入中心 context；有效行为保留，未见可整组删除。 |
| T05 Hub 领域与 compiled 消费者测试（14） | 身份/访问/资源/配置/委派/console/连接；部分启动编译 CLI。 | 根测试已运行；并发、撤权、scope、接线与私有 bridge。 | S01、S08、S12；旧 hub.test 接线替换，权限用例保留。 |
| T06 远端准备与任务测试（2） | remote fixture → export/import/capture/publication/release 与远端任务轮次。 | 根测试已运行；多资产/部分失败/离线/重启/消费者保留。 | S01 迁移 fixture，不能以当前 consumers happy path 替代失败覆盖。 |
| T07 构建发行与官网根测试（4） | 临时仓库/包/registry fake 验证候选固定、归档、发布回执与静态构建。 | 根测试已运行；不包含真实 npm upload/四平台安装或 website/publish.test.mjs。 | S06 目录清理；其余无明确可删保障。 |
| T08 旧看板与当前 open 测试（1） | 旧 dashboard 模拟浏览器与当前 browserAddress/open；同文件混合历史/现行职责。 | 根测试已跑；旧 login/filter/labels 与 open 无凭据参数。 | S05：先迁有效行为与 open，再删旧 UI 专属测试。 |
| T09 全部根测试 fixture/helpers（7） | helpers、resources/tasks/workspaces/remote fixture、hub-resources/hub-delegation fixture。 | 调用方已列 T01–T07；fake 的 fault hooks、HTTP 断言、独立根目录。 | S01/S06；原生假服务与业务网关拆分，不做可插拔 mock 平台。 |
| V01 Hub 系列验收（13） | 身份/访问/实时/资源/配置分层网关 smoke；最终 native MCP/consumer/service/connect/console/upgrade 产品入口。 | 真实 Runner/版本探测、真实模型矩阵、Playwright 各有不同范围；本轮均未执行。 | S02 当前接线迁移目标；S07 两个探测 bootstrap 重复；U03/U06。 |
| V02 直接 HAPI 能力及文件/Git 验收（10） | 独立 native 执行/文件/Git API 操作探针；result-export 还有 task/fetch 模式，应分别判定。 | 原生回执、字节、Git 对象/子模块/LFS、quota/cleanup 是上层 fake 不能替代的保障；本轮未执行。 | 无整组删除依据；含旧 task 模式先核对入口，再按 S02 迁移；不能将 HAPI 原生操作脚本一律判废。 |
| V03 旧业务 smoke 与附属探针（21） | 旧 CLI/Agent/YAML/resource 或旧 root auth 启动；具体已证实失效位置见 S02，其他脚本按调用链分类，未宣称全部跑失败。 | 原有模型/审批/断联/文件/成果/重建场景需逐项迁移；历史 evidence 不作为本轮结果。 | S02/S05；按分支/旧二进制 vs 当前二进制判定，不整文件盲删。 |
| V04 安装与平台包验收（8） | npm/归档安装、四平台 binary、QEMU/本机、service/MCP、包内调用其他 smoke。 | 安装来源/hash/版本/隔离 prefix、原生 executable 和协议接线；本轮未执行。 | S02 remote-package 旧 TaskClient 必迁；其他包级与源级验证责任不同，不按包装层删除。 |
| V05 验收与发行辅助 fixture（11） | Codex model/catalog、Claude observer、MCP probe/cut、console tasks、installed binary/release-input/source archive。 | MCP 故障切断、工具 schema、模型可观测性、同候选约束；.d.mts 为 JS 类型声明。 | S02/S12 更新消费者；没有证据删 observer/probe 或声明文件。 |
| B01 构建、HAPI 固定与整包组装（6） | 固定 submodule → 独立 HAPI build → Bun compile → 四平台/npm/Skill → source/bundle/hash/evidence release。 | release-inputs/release-assembly 根测试；安装/发行 smoke（本轮未跑）。 | 无已证实重复建设；U02 仅调查同候选构建 DAG，不动当前 npm 发行。 |
| B02 npm 启动、预演与发布（3） | 平台 binary 选择；五包可信发布校验、OIDC、持久 receipts、先平台后主包。 | npm-publish 根测试；未知上传不盲重发、integrity/source/依赖核对。 | 无明确瘦身项；检查跨 registry/候选/权限边界，必须保留。 |
| B03 持续集成 workflow（3） | cli-install、npm-publish、website-pages 各自触发/权限/构建/验收/发布。 | 四平台/公开包与站点 SHA/environment 守卫；本轮只静态核对。 | U02；独立运行的 workflow 不是天然重复。 |
| W01 官网页面、交互与构建部署（13） | 三页 HTML、SVG/CSS/JS → build/serve → publish/verify；README 运行文档，publish.test.mjs 聚焦部署。 | website-build 根测试已跑；publish.test/在线 MIME/hash/Playwright 本轮未跑。 | 无明确问题；静态可读/复制失败/原子构建/版本公开检查/有限部署重试均有产品或故障依据。 |
| K01 随包产品 Skill（6） | runweft SKILL.md + agents/openai.yaml + onboarding/configuration/delegation/maintenance 按阶段指导。 | 包组装与官网/Skill 验收；显式授权安装、用户配置/原生边界文档。 | 无明确重复可删；按需读取的领域说明不同，不把指南复述简单视为代码重复。 |
| R01 根构建与配置输入（6） | package scripts/锁依赖、TS 编译、HAPI gitlink、npm 配置和临时文件忽略。 | typecheck/根测试；release freeze、HAPI revision 核对。 | S02 script 名称保留映射；锁文件/显式 ./test/固定版本不删。 |

## 全部文件归属

每个范围文件只列一次；模块调查结论在上表，S/U 编号在审计报告中。根 AGENTS.md、项目入口/架构/开发说明、相关 Change 和 Specs 为规范依据，不混入产品文件计数。

### P01 CLI、配置与错误

- [src/cli.ts](../../../../src/cli.ts)
- [src/config.ts](../../../../src/config.ts)
- [src/errors.ts](../../../../src/errors.ts)

### P02 服务、Runner、代理与重置

- [src/proxy.ts](../../../../src/proxy.ts)
- `src/reset.ts`（审计基线文件，现已退役）
- [src/runner.ts](../../../../src/runner.ts)
- [src/service-commands.ts](../../../../src/service-commands.ts)
- [src/services.ts](../../../../src/services.ts)

### P03 私有 HAPI 与执行适配

- [src/execution.ts](../../../../src/execution.ts)
- [src/hapi.ts](../../../../src/hapi.ts)

### P04 SQLite 版本与迁移

- [src/state.ts](../../../../src/state.ts)

### P05 旧 Agent 文件模型与原生 launch

- `src/agents/bindings.ts`（审计基线文件，现已退役）
- `src/agents/client.ts`（审计基线文件，现已退役）
- `src/agents/definitions.ts`（审计基线文件，现已退役）
- [src/agents/launch.ts](../../../../src/agents/launch.ts)

### P06 旧资源模型及共享 native/types

- `src/resources/api.ts`（审计基线文件，现已退役）
- `src/resources/client.ts`（审计基线文件，现已退役）
- [src/resources/native.ts](../../../../src/resources/native.ts)
- `src/resources/service.ts`（审计基线文件，现已退役）
- `src/resources/store.ts`（审计基线文件，现已退役）
- [src/resources/types.ts](../../../../src/resources/types.ts)

### P07 任务接口、客户端及请求类型

- `src/tasks/api.ts`（审计基线文件，现已退役）
- `src/tasks/client.ts`（审计基线文件，现已退役）
- [src/tasks/commands.ts](../../../../src/tasks/commands.ts)
- [src/tasks/types.ts](../../../../src/tasks/types.ts)

### P08 任务协调与持久接受

- [src/tasks/coordinator.ts](../../../../src/tasks/coordinator.ts)
- [src/tasks/store.ts](../../../../src/tasks/store.ts)

### P09 任务查询、视图和报告

- [src/tasks/query.ts](../../../../src/tasks/query.ts)
- [src/tasks/reports.ts](../../../../src/tasks/reports.ts)
- [src/tasks/views.ts](../../../../src/tasks/views.ts)

### P10 本机独立工作区编排

- [src/tasks/workspaces.ts](../../../../src/tasks/workspaces.ts)

### P11 任务输入、输出与附件留存

- [src/tasks/files.ts](../../../../src/tasks/files.ts)
- [src/tasks/output-types.ts](../../../../src/tasks/output-types.ts)
- [src/tasks/outputs.ts](../../../../src/tasks/outputs.ts)
- [src/tasks/retention.ts](../../../../src/tasks/retention.ts)

### P12 代码成果、fetch 与留存

- [src/tasks/result-retention.ts](../../../../src/tasks/result-retention.ts)
- [src/tasks/result-types.ts](../../../../src/tasks/result-types.ts)
- [src/tasks/results.ts](../../../../src/tasks/results.ts)

### P13 文件客户端及 CLI

- [src/artifacts/client.ts](../../../../src/artifacts/client.ts)
- [src/artifacts/commands.ts](../../../../src/artifacts/commands.ts)

### P14 远端准备、基线和发布

- `src/remote/api.ts`（审计基线文件，现已退役）
- [src/remote/baselines.ts](../../../../src/remote/baselines.ts)
- `src/remote/client.ts`（审计基线文件，现已退役）
- [src/remote/commands.ts](../../../../src/remote/commands.ts)
- [src/remote/publication.ts](../../../../src/remote/publication.ts)
- [src/remote/service.ts](../../../../src/remote/service.ts)
- [src/remote/store.ts](../../../../src/remote/store.ts)
- [src/remote/transfers.ts](../../../../src/remote/transfers.ts)
- [src/remote/types.ts](../../../../src/remote/types.ts)

### P15 MCP 协议和业务工具

- [src/mcp/artifacts.ts](../../../../src/mcp/artifacts.ts)
- [src/mcp/server.ts](../../../../src/mcp/server.ts)
- [src/mcp/tasks.ts](../../../../src/mcp/tasks.ts)
- [src/mcp/tool.ts](../../../../src/mcp/tool.ts)

### P16 宿主身份与 Claude hook

- [src/mcp/claude-hook.ts](../../../../src/mcp/claude-hook.ts)
- [src/mcp/identity.ts](../../../../src/mcp/identity.ts)

### P17 MCP 安装与 TOML 编辑

- [src/mcp/commands.ts](../../../../src/mcp/commands.ts)
- [src/mcp/install.ts](../../../../src/mcp/install.ts)
- [src/mcp/toml.ts](../../../../src/mcp/toml.ts)

### P18 Hub 身份、空间与邀请

- [src/hub/api.ts](../../../../src/hub/api.ts)
- [src/hub/store.ts](../../../../src/hub/store.ts)
- [src/hub/types.ts](../../../../src/hub/types.ts)

### P19 Hub 客户端与连接交接

- [src/hub/client.ts](../../../../src/hub/client.ts)
- [src/hub/connect/api.ts](../../../../src/hub/connect/api.ts)
- [src/hub/connect/client.ts](../../../../src/hub/connect/client.ts)
- [src/hub/connect/record.ts](../../../../src/hub/connect/record.ts)
- [src/hub/connect/store.ts](../../../../src/hub/connect/store.ts)
- [src/hub/connect/types.ts](../../../../src/hub/connect/types.ts)

### P20 认证 lease 与私有 transport

- [src/hub/access/auth.ts](../../../../src/hub/access/auth.ts)
- [src/hub/access/transport.ts](../../../../src/hub/access/transport.ts)
- [src/hub/access/types.ts](../../../../src/hub/access/types.ts)

### P21 原生对象归属和会话映射

- [src/hub/access/sessions.ts](../../../../src/hub/access/sessions.ts)
- [src/hub/access/store.ts](../../../../src/hub/access/store.ts)

### P22 HTTP、SSE 和 Socket 边界

- [src/hub/access/events.ts](../../../../src/hub/access/events.ts)
- [src/hub/access/http.ts](../../../../src/hub/access/http.ts)
- [src/hub/access/sockets.ts](../../../../src/hub/access/sockets.ts)

### P23 Hub 文件归属与传输授权

- [src/hub/access/file-store.ts](../../../../src/hub/access/file-store.ts)
- [src/hub/access/files.ts](../../../../src/hub/access/files.ts)

### P24 中心机器/runtime 资源

- [src/hub/resources/api.ts](../../../../src/hub/resources/api.ts)
- [src/hub/resources/client.ts](../../../../src/hub/resources/client.ts)
- [src/hub/resources/commands.ts](../../../../src/hub/resources/commands.ts)
- [src/hub/resources/connection.ts](../../../../src/hub/resources/connection.ts)
- [src/hub/resources/gateway.ts](../../../../src/hub/resources/gateway.ts)
- [src/hub/resources/service.ts](../../../../src/hub/resources/service.ts)
- [src/hub/resources/store.ts](../../../../src/hub/resources/store.ts)
- [src/hub/resources/types.ts](../../../../src/hub/resources/types.ts)

### P25 仓库身份、观察与关联

- [src/hub/repositories/api.ts](../../../../src/hub/repositories/api.ts)
- [src/hub/repositories/client.ts](../../../../src/hub/repositories/client.ts)
- [src/hub/repositories/commands.ts](../../../../src/hub/repositories/commands.ts)
- [src/hub/repositories/identity.ts](../../../../src/hub/repositories/identity.ts)
- [src/hub/repositories/observation.ts](../../../../src/hub/repositories/observation.ts)
- [src/hub/repositories/store.ts](../../../../src/hub/repositories/store.ts)

### P26 中心 Agent、本人选择与解析

- [src/hub/agents/api.ts](../../../../src/hub/agents/api.ts)
- [src/hub/agents/client.ts](../../../../src/hub/agents/client.ts)
- [src/hub/agents/commands.ts](../../../../src/hub/agents/commands.ts)
- [src/hub/agents/resolver.ts](../../../../src/hub/agents/resolver.ts)
- [src/hub/agents/selection-api.ts](../../../../src/hub/agents/selection-api.ts)
- [src/hub/agents/selections.ts](../../../../src/hub/agents/selections.ts)
- [src/hub/agents/store.ts](../../../../src/hub/agents/store.ts)
- [src/hub/agents/types.ts](../../../../src/hub/agents/types.ts)
- [src/hub/configuration/gateway.ts](../../../../src/hub/configuration/gateway.ts)

### P27 中心委派、context 与 native bridge

- [src/hub/delegation/api.ts](../../../../src/hub/delegation/api.ts)
- [src/hub/delegation/client.ts](../../../../src/hub/delegation/client.ts)
- [src/hub/delegation/context.ts](../../../../src/hub/delegation/context.ts)
- [src/hub/delegation/gateway.ts](../../../../src/hub/delegation/gateway.ts)
- [src/hub/delegation/native.ts](../../../../src/hub/delegation/native.ts)
- [src/hub/delegation/service.ts](../../../../src/hub/delegation/service.ts)
- [src/hub/delegation/types.ts](../../../../src/hub/delegation/types.ts)

### P28 当前 Hub 浏览器界面

- [src/hub/agents-page.ts](../../../../src/hub/agents-page.ts)
- [src/hub/app.ts](../../../../src/hub/app.ts)
- [src/hub/console.ts](../../../../src/hub/console.ts)
- [src/hub/native-page.ts](../../../../src/hub/native-page.ts)
- [src/hub/page.html](../../../../src/hub/page.html)
- [src/hub/page.ts](../../../../src/hub/page.ts)
- [src/hub/repositories-page.ts](../../../../src/hub/repositories-page.ts)
- [src/hub/resources-page.ts](../../../../src/hub/resources-page.ts)
- [src/hub/selections-page.ts](../../../../src/hub/selections-page.ts)
- [src/hub/style.css](../../../../src/hub/style.css)
- [src/hub/tasks-page.ts](../../../../src/hub/tasks-page.ts)

### P29 旧公开 handler 与看板

- `src/api.ts`（审计基线文件，现已退役）
- `src/dashboard/app.ts`（审计基线文件，现已退役）
- `src/dashboard/assets.d.ts`（审计基线文件，现已退役）
- `src/dashboard/page.html`（审计基线文件，现已退役）
- `src/dashboard/server.ts`（审计基线文件，现已退役）
- `src/dashboard/style.css`（审计基线文件，现已退役）

### T01 基础 CLI/服务测试

- [test/cli.test.ts](../../../../test/cli.test.ts)
- [test/config.test.ts](../../../../test/config.test.ts)
- [test/proxy.test.ts](../../../../test/proxy.test.ts)
- `test/reset.test.ts`（审计基线文件，现已退役）
- [test/service-commands.test.ts](../../../../test/service-commands.test.ts)

### T02 旧 Agent/资源及当前拒绝测试

- `test/agent-targets.test.ts`（审计基线文件，现已退役）
- `test/agents.test.ts`（审计基线文件，现已退役）
- [test/resource-commands.test.ts](https://github.com/iTgo-lyq/runweft/blob/4d9c08c3b0dc672096baa7e8db4ad44155db877d/test/resource-commands.test.ts)
- `test/resources.test.ts`（审计基线文件，现已退役）

### T03 任务与轮次家族测试

- [test/task-files.test.ts](../../../../test/task-files.test.ts)
- [test/task-outputs.test.ts](../../../../test/task-outputs.test.ts)
- [test/task-results.test.ts](../../../../test/task-results.test.ts)
- [test/task-rounds.test.ts](../../../../test/task-rounds.test.ts)
- [test/task-workspaces.test.ts](../../../../test/task-workspaces.test.ts)
- [test/tasks-mcp.test.ts](../../../../test/tasks-mcp.test.ts)
- [test/tasks-overview.test.ts](../../../../test/tasks-overview.test.ts)
- [test/tasks.test.ts](../../../../test/tasks.test.ts)

### T04 执行、文件与 MCP 测试

- [test/artifact-mcp.test.ts](../../../../test/artifact-mcp.test.ts)
- [test/artifacts.test.ts](../../../../test/artifacts.test.ts)
- [test/execution.test.ts](../../../../test/execution.test.ts)
- [test/mcp-install.test.ts](../../../../test/mcp-install.test.ts)
- [test/mcp.test.ts](../../../../test/mcp.test.ts)

### T05 Hub 领域与 compiled 消费者测试

- [test/hub-access.test.ts](../../../../test/hub-access.test.ts)
- [test/hub-agent-resolution.test.ts](../../../../test/hub-agent-resolution.test.ts)
- [test/hub-agents.test.ts](../../../../test/hub-agents.test.ts)
- [test/hub-connect.test.ts](../../../../test/hub-connect.test.ts)
- [test/hub-console.test.ts](../../../../test/hub-console.test.ts)
- [test/hub-consumers.test.ts](../../../../test/hub-consumers.test.ts)
- [test/hub-delegation-native.test.ts](../../../../test/hub-delegation-native.test.ts)
- [test/hub-delegation.test.ts](../../../../test/hub-delegation.test.ts)
- [test/hub-repositories.test.ts](../../../../test/hub-repositories.test.ts)
- [test/hub-resource-cli.test.ts](../../../../test/hub-resource-cli.test.ts)
- [test/hub-resource-dispatch.test.ts](../../../../test/hub-resource-dispatch.test.ts)
- [test/hub-resources.test.ts](../../../../test/hub-resources.test.ts)
- [test/hub-sockets.test.ts](../../../../test/hub-sockets.test.ts)
- [test/hub.test.ts](../../../../test/hub.test.ts)

### T06 远端准备与任务测试

- [test/remote-tasks.test.ts](../../../../test/remote-tasks.test.ts)
- [test/remote.test.ts](../../../../test/remote.test.ts)

### T07 构建发行与官网根测试

- [test/npm-publish.test.js](https://github.com/iTgo-lyq/runweft/blob/fe6017e531f06c0c01980d362b8b5b32bc6fde71/test/npm-publish.test.js)
- [test/release-assembly.test.ts](https://github.com/iTgo-lyq/runweft/blob/d7bc66b9ffd7c4c07fbb940280424b11feffc58a/test/release-assembly.test.ts)
- [test/release-inputs.test.ts](../../../../test/release-inputs.test.ts)
- [test/website-build.test.ts](../../../../test/website-build.test.ts)

### T08 旧看板与当前 open 测试

- `test/dashboard.test.ts`（审计基线文件，现已退役）

### T09 全部根测试 fixture/helpers

- [test/helpers.ts](../../../../test/helpers.ts)
- [test/hub-delegation-fixture.ts](../../../../test/hub-delegation-fixture.ts)
- [test/hub-resources-fixture.ts](../../../../test/hub-resources-fixture.ts)
- [test/remote-fixture.ts](../../../../test/remote-fixture.ts)
- `test/resources-fixture.ts`（审计基线文件，现已退役）
- `test/tasks-fixture.ts`（审计基线文件，现已退役）
- [test/workspaces-fixture.ts](../../../../test/workspaces-fixture.ts)

### V01 Hub 系列验收

- [scripts/smoke-hub-access.ts](../../../../scripts/smoke-hub-access.ts)
- [scripts/smoke-hub-configuration.ts](../../../../scripts/smoke-hub-configuration.ts)
- [scripts/smoke-hub-connect.ts](../../../../scripts/smoke-hub-connect.ts)
- [scripts/smoke-hub-console.ts](../../../../scripts/smoke-hub-console.ts)
- [scripts/smoke-hub-consumers.ts](https://github.com/iTgo-lyq/runweft/blob/431d2e9ad16a1b7c9368bb03da0647b960a4888b/scripts/smoke-hub-consumers.ts)
- [scripts/smoke-hub-delegation-native.ts](../../../../scripts/smoke-hub-delegation-native.ts)
- [scripts/smoke-hub-delegation-preparation.ts](../../../../scripts/smoke-hub-delegation-preparation.ts)
- [scripts/smoke-hub-native-mcp.ts](https://github.com/iTgo-lyq/runweft/blob/431d2e9ad16a1b7c9368bb03da0647b960a4888b/scripts/smoke-hub-native-mcp.ts)
- [scripts/smoke-hub-realtime.ts](../../../../scripts/smoke-hub-realtime.ts)
- [scripts/smoke-hub-resources.ts](../../../../scripts/smoke-hub-resources.ts)
- [scripts/smoke-hub-service.ts](https://github.com/iTgo-lyq/runweft/blob/d7bc66b9ffd7c4c07fbb940280424b11feffc58a/scripts/smoke-hub-service.ts)
- [scripts/smoke-hub-upgrade.mjs](https://github.com/iTgo-lyq/runweft/blob/7eaa27efc0a4a239c96ea07c9774353145b23e89/scripts/smoke-hub-upgrade.mjs)
- [scripts/smoke-hub.ts](../../../../scripts/smoke-hub.ts)

### V02 直接 HAPI 能力及文件/Git 验收

- [scripts/smoke-artifact-prune.ts](../../../../scripts/smoke-artifact-prune.ts)
- [scripts/smoke-artifacts.ts](../../../../scripts/smoke-artifacts.ts)
- [scripts/smoke-execution.ts](../../../../scripts/smoke-execution.ts)
- [scripts/smoke-inputs.ts](../../../../scripts/smoke-inputs.ts)
- [scripts/smoke-outputs.ts](../../../../scripts/smoke-outputs.ts)
- [scripts/smoke-repository-export.ts](../../../../scripts/smoke-repository-export.ts)
- [scripts/smoke-repository-import.ts](../../../../scripts/smoke-repository-import.ts)
- [scripts/smoke-result-export.ts](../../../../scripts/smoke-result-export.ts)
- [scripts/smoke-workspaces.ts](https://github.com/iTgo-lyq/runweft/blob/431d2e9ad16a1b7c9368bb03da0647b960a4888b/scripts/smoke-workspaces.ts)
- [scripts/smoke-worktree-lifecycle.ts](https://github.com/iTgo-lyq/runweft/blob/431d2e9ad16a1b7c9368bb03da0647b960a4888b/scripts/smoke-worktree-lifecycle.ts)

### V03 旧业务 smoke 与附属探针

- `scripts/dashboard-browser.ts`（审计基线文件，现已退役）
- [scripts/remote-task-probe.ts](https://github.com/iTgo-lyq/runweft/blob/e85ef3af1b9fed9cc9ac00bcd764d3954bb283da/scripts/remote-task-probe.ts)
- [scripts/smoke-agents.ts](https://github.com/iTgo-lyq/runweft/blob/b3287e7b066dc7410d1dc392a4b4a0563a54438a/scripts/smoke-agents.ts)
- [scripts/smoke-artifact-mcp.ts](https://github.com/iTgo-lyq/runweft/blob/431d2e9ad16a1b7c9368bb03da0647b960a4888b/scripts/smoke-artifact-mcp.ts)
- [scripts/smoke-collaboration.ts](../../../../scripts/smoke-collaboration.ts)
- [scripts/smoke-dashboard.ts](https://github.com/iTgo-lyq/runweft/blob/a9434db4cc0ee6b7c519405af697883a882634f4/scripts/smoke-dashboard.ts)
- [scripts/smoke-mcp.ts](https://github.com/iTgo-lyq/runweft/blob/431d2e9ad16a1b7c9368bb03da0647b960a4888b/scripts/smoke-mcp.ts)
- [scripts/smoke-reconstruction.ts](../../../../scripts/smoke-reconstruction.ts)
- [scripts/smoke-remote-native.ts](https://github.com/iTgo-lyq/runweft/blob/431d2e9ad16a1b7c9368bb03da0647b960a4888b/scripts/smoke-remote-native.ts)
- [scripts/smoke-resources.ts](https://github.com/iTgo-lyq/runweft/blob/b3287e7b066dc7410d1dc392a4b4a0563a54438a/scripts/smoke-resources.ts)
- [scripts/smoke-result-retention.ts](https://github.com/iTgo-lyq/runweft/blob/7eaa27efc0a4a239c96ea07c9774353145b23e89/scripts/smoke-result-retention.ts)
- [scripts/smoke-task-controls.ts](../../../../scripts/smoke-task-controls.ts)
- [scripts/smoke-task-inputs.ts](https://github.com/iTgo-lyq/runweft/blob/431d2e9ad16a1b7c9368bb03da0647b960a4888b/scripts/smoke-task-inputs.ts)
- [scripts/smoke-task-mcp.ts](https://github.com/iTgo-lyq/runweft/blob/431d2e9ad16a1b7c9368bb03da0647b960a4888b/scripts/smoke-task-mcp.ts)
- [scripts/smoke-task-outputs.ts](https://github.com/iTgo-lyq/runweft/blob/c649d5400955946189609727280c91b1095e0aa7/scripts/smoke-task-outputs.ts)
- [scripts/smoke-task-retention.ts](https://github.com/iTgo-lyq/runweft/blob/7eaa27efc0a4a239c96ea07c9774353145b23e89/scripts/smoke-task-retention.ts)
- [scripts/smoke-tasks.ts](https://github.com/iTgo-lyq/runweft/blob/431d2e9ad16a1b7c9368bb03da0647b960a4888b/scripts/smoke-tasks.ts)
- `scripts/smoke-upgrade.ts`（审计基线文件，现已退役）
- [scripts/smoke-workspace-preparation.ts](../../../../scripts/smoke-workspace-preparation.ts)
- [scripts/smoke-worktree-tasks.ts](https://github.com/iTgo-lyq/runweft/blob/431d2e9ad16a1b7c9368bb03da0647b960a4888b/scripts/smoke-worktree-tasks.ts)
- [scripts/task-results-probe.ts](https://github.com/iTgo-lyq/runweft/blob/d7bc66b9ffd7c4c07fbb940280424b11feffc58a/scripts/task-results-probe.ts)

### V04 安装与平台包验收

- [scripts/smoke-arm64.mjs](https://github.com/iTgo-lyq/runweft/blob/d7bc66b9ffd7c4c07fbb940280424b11feffc58a/scripts/smoke-arm64.mjs)
- [scripts/smoke-artifact-package.mjs](https://github.com/iTgo-lyq/runweft/blob/431d2e9ad16a1b7c9368bb03da0647b960a4888b/scripts/smoke-artifact-package.mjs)
- [scripts/smoke-install.mjs](../../../../scripts/smoke-install.mjs)
- [scripts/smoke-mcp-install.mjs](https://github.com/iTgo-lyq/runweft/blob/d7bc66b9ffd7c4c07fbb940280424b11feffc58a/scripts/smoke-mcp-install.mjs)
- [scripts/smoke-remote-package.ts](../../../../scripts/smoke-remote-package.ts)
- [scripts/smoke-service.mjs](../../../../scripts/smoke-service.mjs)
- [scripts/smoke-worktree-package.mjs](../../../../scripts/smoke-worktree-package.mjs)
- [scripts/verify-packages.mjs](../../../../scripts/verify-packages.mjs)

### V05 验收与发行辅助 fixture

- [scripts/fixtures/claude-observer.mjs](../../../../scripts/fixtures/claude-observer.mjs)
- [scripts/fixtures/codex-catalog.ts](../../../../scripts/fixtures/codex-catalog.ts)
- [scripts/fixtures/codex-model.ts](../../../../scripts/fixtures/codex-model.ts)
- [scripts/fixtures/hapi-source-archive.mjs](../../../../scripts/fixtures/hapi-source-archive.mjs)
- [scripts/fixtures/hub-console-tasks.ts](../../../../scripts/fixtures/hub-console-tasks.ts)
- [scripts/fixtures/installed-binaries.d.mts](../../../../scripts/fixtures/installed-binaries.d.mts)
- [scripts/fixtures/installed-binaries.mjs](../../../../scripts/fixtures/installed-binaries.mjs)
- [scripts/fixtures/mcp-cut.mjs](../../../../scripts/fixtures/mcp-cut.mjs)
- [scripts/fixtures/mcp-probe.mjs](../../../../scripts/fixtures/mcp-probe.mjs)
- [scripts/fixtures/release-inputs.d.mts](../../../../scripts/fixtures/release-inputs.d.mts)
- [scripts/fixtures/release-inputs.mjs](../../../../scripts/fixtures/release-inputs.mjs)

### B01 构建、HAPI 固定与整包组装

- [scripts/assemble-release.mjs](https://github.com/iTgo-lyq/runweft/blob/d7bc66b9ffd7c4c07fbb940280424b11feffc58a/scripts/assemble-release.mjs)
- [scripts/build-hapi.ts](../../../../scripts/build-hapi.ts)
- [scripts/build.ts](../../../../scripts/build.ts)
- [scripts/hapi-source.ts](../../../../scripts/hapi-source.ts)
- [scripts/package.ts](../../../../scripts/package.ts)
- [scripts/platforms.ts](../../../../scripts/platforms.ts)

### B02 npm 启动、预演与发布

- [scripts/check-npm-trust.mjs](../../../../scripts/check-npm-trust.mjs)
- [scripts/npm-launcher.cjs](../../../../scripts/npm-launcher.cjs)
- [scripts/npm-publish.mjs](../../../../scripts/npm-publish.mjs)

### B03 持续集成 workflow

- [.github/workflows/cli-install.yml](../../../../.github/workflows/cli-install.yml)
- [.github/workflows/npm-publish.yml](../../../../.github/workflows/npm-publish.yml)
- [.github/workflows/website-pages.yml](../../../../.github/workflows/website-pages.yml)

### W01 官网页面、交互与构建部署

- [website/README.md](../../../../website/README.md)
- [website/assets/icons.svg](../../../../website/assets/icons.svg)
- [website/assets/mark.svg](../../../../website/assets/mark.svg)
- [website/assets/site.js](../../../../website/assets/site.js)
- [website/assets/style.css](../../../../website/assets/style.css)
- [website/build.mjs](../../../../website/build.mjs)
- [website/guide.html](../../../../website/guide.html)
- [website/index.html](../../../../website/index.html)
- [website/manual.html](../../../../website/manual.html)
- [website/publish.mjs](../../../../website/publish.mjs)
- [website/publish.test.mjs](../../../../website/publish.test.mjs)
- [website/serve.mjs](../../../../website/serve.mjs)
- [website/verify.mjs](../../../../website/verify.mjs)

### K01 随包产品 Skill

- [skills/runweft/SKILL.md](https://github.com/iTgo-lyq/runweft/blob/64df00254894b718cf8737ab2730c6d0ea56d38d/skills/runweft/SKILL.md)
- [skills/runweft/agents/openai.yaml](https://github.com/iTgo-lyq/runweft/blob/64df00254894b718cf8737ab2730c6d0ea56d38d/skills/runweft/agents/openai.yaml)
- [skills/runweft/references/configuration.md](https://github.com/iTgo-lyq/runweft/blob/64df00254894b718cf8737ab2730c6d0ea56d38d/skills/runweft/references/configuration.md)
- [skills/runweft/references/delegation.md](https://github.com/iTgo-lyq/runweft/blob/64df00254894b718cf8737ab2730c6d0ea56d38d/skills/runweft/references/delegation.md)
- [skills/runweft/references/maintenance.md](https://github.com/iTgo-lyq/runweft/blob/64df00254894b718cf8737ab2730c6d0ea56d38d/skills/runweft/references/maintenance.md)
- [skills/runweft/references/onboarding.md](https://github.com/iTgo-lyq/runweft/blob/64df00254894b718cf8737ab2730c6d0ea56d38d/skills/runweft/references/onboarding.md)

### R01 根构建与配置输入

- [.gitignore](../../../../.gitignore)
- [.gitmodules](../../../../.gitmodules)
- [.npmrc](../../../../.npmrc)
- [bun.lock](../../../../bun.lock)
- [package.json](../../../../package.json)
- [tsconfig.json](../../../../tsconfig.json)


## 实施后新增/移动文件覆盖

前文保留基线模块调查；退役文件的链接改为基线名称，仍可按基线提交定位。下列新增或移动文件接回同一职责树，并非新增产品框架。当前范围为278文件（src110、test54、scripts85、website13、skills6、workflow3、根配置7），其中根测试42文件。文件数只用于覆盖核验，不作为瘦身目标。原有仍在范围的文件全部由基线表覆盖，新文件全部如下；实际验证及未执行范围见[验收](acceptance.md)。

### P05 共享定义与内容身份

- [src/agents/types.ts](../../../../src/agents/types.ts)
- [src/content-version.ts](../../../../src/content-version.ts)

### P08 当前任务记录边界

- [src/tasks/records.ts](../../../../src/tasks/records.ts)

### P28 页面资源声明

- [src/assets.d.ts](../../../../src/assets.d.ts)

### T01/T09 单测编译、接线与清理

- [test/compiled-cli.ts](../../../../test/compiled-cli.ts)
- [test/fixture-cleanup.test.ts](../../../../test/fixture-cleanup.test.ts)
- [test/fixture-cleanup.ts](../../../../test/fixture-cleanup.ts)
- [test/hub-workspace-fixture.ts](../../../../test/hub-workspace-fixture.ts)
- [test/native-fixture.ts](../../../../test/native-fixture.ts)
- [test/preload.ts](../../../../test/preload.ts)
- [test/remote-native-fixture.ts](../../../../test/remote-native-fixture.ts)
- [test/smoke-lifecycle.test.ts](../../../../test/smoke-lifecycle.test.ts)
- [test/task-native-fixture.ts](../../../../test/task-native-fixture.ts)

### T01/T03 当前格式与坏记录隔离

- [test/state.test.ts](../../../../test/state.test.ts)
- [test/task-records.test.ts](../../../../test/task-records.test.ts)

### V05 当前验收辅助与所有权

- [scripts/fixtures/collaboration-package.d.mts](../../../../scripts/fixtures/collaboration-package.d.mts)
- [scripts/fixtures/collaboration-package.mjs](../../../../scripts/fixtures/collaboration-package.mjs)
- [scripts/fixtures/hub-console-history.ts](../../../../scripts/fixtures/hub-console-history.ts)
- [scripts/fixtures/hub-console-smoke.ts](../../../../scripts/fixtures/hub-console-smoke.ts)
- [scripts/fixtures/mcp-protocol.ts](../../../../scripts/fixtures/mcp-protocol.ts)
- [scripts/fixtures/model-homes.ts](../../../../scripts/fixtures/model-homes.ts)
- [scripts/fixtures/native-file-smoke.ts](../../../../scripts/fixtures/native-file-smoke.ts)
- [scripts/fixtures/native-user-smoke.ts](../../../../scripts/fixtures/native-user-smoke.ts)
- [scripts/fixtures/non-git-smoke-project.ts](../../../../scripts/fixtures/non-git-smoke-project.ts)
- [scripts/fixtures/service-version-probe.mjs](../../../../scripts/fixtures/service-version-probe.mjs)
- [scripts/fixtures/smoke-lifecycle.ts](../../../../scripts/fixtures/smoke-lifecycle.ts)
- [scripts/fixtures/task-capture-receipt.ts](https://github.com/iTgo-lyq/runweft/blob/431d2e9ad16a1b7c9368bb03da0647b960a4888b/scripts/fixtures/task-capture-receipt.ts)
- [scripts/fixtures/task-smoke.ts](../../../../scripts/fixtures/task-smoke.ts)
- [scripts/fixtures/worktree-task-smoke.ts](https://github.com/iTgo-lyq/runweft/blob/431d2e9ad16a1b7c9368bb03da0647b960a4888b/scripts/fixtures/worktree-task-smoke.ts)
- [scripts/smoke-mcp-install.d.mts](https://github.com/iTgo-lyq/runweft/blob/d7bc66b9ffd7c4c07fbb940280424b11feffc58a/scripts/smoke-mcp-install.d.mts)

### R01 Bun测试清理入口

- [bunfig.toml](../../../../bunfig.toml)
