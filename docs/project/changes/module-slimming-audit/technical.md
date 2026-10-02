# Runweft 模块瘦身技术方案

> 来源：./requirement.md
> 状态：已确认
> 更新：2026-10-02
> 确认依据：用户及 AGENTS.md 已授权主 agent 制定工程方案与本地自动验收；实施前仍由主 agent 内部复核。

## 方案与就绪性

采用先扩展测试接线、迁移有效保障、再退役旧入口的顺序。Research 的 S01–S12 是候选，只有新实现更直接且行为等价才实施；U01–U06 不预设删除。新增数据约束已经由用户明确确认，不再保留旧审计兼容约束；其他没有新的产品契约或用户决策，实施细节通过现有代码及定向实验确定。fixture 必须经过当前 gateway/授权 bridge 的实际 HTTP；只提取 native fake，不造模拟 Hub 授权或旧 API 翻译框架。T1 暂留旧测试接线，T2–T4 原故障断言迁入之前不删。

HAPI 固定内置能力已经提供原生执行、操作回执、文件及 Git 工作区；本轮具体缺口在 Runweft 自身：中心 fixture 反向依赖旧服务，旧消费与烟测接线仍被维护，同一调用内有少量纯计算/传输样板重复。复用现有 HAPI，保留 TaskCoordinator、WorkspacePreparations、授权桥与持久协调，不新增 runtime 或通用状态框架。

## 保留契约

现行 CLI/MCP 名称、参数、响应字段、HTTP/Socket/SSE 路径和错误语义不变，必连 Hub 和 owner×space 范围不变。当前已拒绝的 YAML/local-only 模式不恢复。HapiClient 保留私有 native 与透传职责；HubClient 保留用户主体职责。

原始输入校验、异步后 lease/配置重查、事务内幂等与排他、实际 RPC/ack 撤权检查保留。失去响应只查询固定请求，不盲目重发；仅明确 native_session_missing 才重建。每轮关闭证明、session 保留、输入输出 pins、capture 不重读、交付及清理恢复各自保留。

数据库仅支持唯一当前schema19结构：不存在文件一次CREATE当前最终结构；已存在文件先readonly验证version/表字段，拒绝旧/未知/损坏而不chmod/开启WAL/写入。验证通过才正常读写，不含任何版本范围判断、ALTER/拷贝/DROP升级。新建schema19不定义旧machine/runtime登记表；旧18及其他格式只拒绝不DROP/清理。该任务在旧消费者退役之后执行，不建过渡兼容层。Task.version=2和Round.agent必须真实存在，移除旧快照fallback；现行可选状态仍保留。config省略schemaVersion是当前公开简写默认，继续允许；显式非1拒绝，不把默认/optional当迁移。专门data reset删除，不清扫旧文件或建议重置。具体全部调用及验收见data-format-research.md。

## 候选处理

| 候选 | 决策与实现边界 | 依赖与保障 |
| --- | --- | --- |
| S01 | 提取现有 native fake 为小型独立 fixture；中心直接组装网关，保留 HTTP 与 fault hooks | 中心 fixture 先迁，再分业务家族迁；每个有效旧断言继续执行 |
| S02 | 按场景迁移到中心入口，兼容 test:* 参数转发必须真实执行对应场景 | 不把新 smoke 存在当等价证明；保留原生/恢复/留存/升级独有窗口 |
| S03 | Hub MCP context 必需，移除旧 client/YAML discovery 和无 Hub 分支 | 先搬 contentVersion、schema/类型及 launch/native 共享依赖；保障已迁完 |
| S04 | 删除旧 handler/namespace 资源路由与只服务旧路径的 store 接线 | 共享 List/Read/Wait schema 先迁；保留协调，删除历史迁移/兼容，保留当前格式检查 |
| S05 | 删除旧看板，移动 CSS declaration；迁 open 与有效渲染/竞态断言 | 当前 console/Playwright 与 open 安全用例已执行 |
| S06 | 单一 fixture root 所有者，全部清理独立尝试、聚合失败 | 不清理别人的目录或恢复现场；构造中途失败也回收 |
| S07 | 两份真实 Hub smoke 复用窄启动/退出 helper | 各自配置/权限/心跳业务断言保留；失败证据不能报成功 |
| S08 | 实验 Bun 生命周期后准备一次只读 compiled CLI | 各文件可独跑；独立 home/server；无长期缓存或锁服务 |
| S09 | detail 局部复用 overview 纯投影 | 保留所有别名/交付字段和报告分页 |
| S10 | Hub service 解析后内部 send 使用已解析类型 | 仅同层同值再解析；旧入口退役后做，不删除权限重查 |
| S11 | 窄 artifact RPC helper 共用 POST 与 operationId 检查 | 原错误 code/status/hint 和各恢复策略保留；若抽象更复杂则排除 |
| S12 | 只有现有根测试能力可验证实际脚本行为并维持CI自动覆盖才删拼写断言；需DOM框架/新增浏览器CI则排除S12，原断言保留 | 根 JWT purpose/expiry/rotation 与CI层级保持；真实Playwright继续执行 |

## 待验证事项处理

U01 先在固定 HAPI 对 capture 中断/丢响应及持久旧回执核对，证明无恢复作用才删除 unknown 分支。U02 只画同一次 run 的产物 DAG；独立 CI 候选与 standalone package 校验保留，本轮只记录DAG与排除结论，不改workflow。U03 列 root 的进程/凭据副本/证据/消费者后只收回可再生和秘密副本，恢复现场显式保留。U04 旧入口退役后复查 Round 默认值，只有局部函数更直接才提取，两个 retention 状态不合并。U05 旧 client 退役后核对 TaskOperations 单继承及错误/请求 equality；不统一 auth scope 或 mutation 重试。U06 保留现行十二组 native MCP 与十组 consumers，不预设缩减，完全等价场景须有必跑断言和实测才合并重复环境。

## 测试迁移与删除条件

Research 的“测试删除、合并与继续保障”表是逐项检查清单。迁移维护原有效断言，不以数量判断。YAML 优先级/旧 namespace CRUD/旧登录流程随对应已下线路径退役；其中原生映射、错误隔离、preflight、快照、探测竞态和错误不重放必须在中心或独立 native 测试保留。task/round/workspace/file/output/result/remote 家族保留全部现行行为用例，换接线；历史数据迁移/兼容专属用例按用户新增约束删除；旧 Agent 文件重试场景换为中心配置撤回后的固定请求查询。

tasks-mcp 重复 happy path 只有 compiled consumers 等价且审批、等待取消/EOF不停止工作、repair-finish、worktree 续轮已经迁入才合并。overview 的只读/严格过滤/库存超时/千任务有界页保留。hub.test 身份/邀请并发迁中心。open 用例移动不删。有效 browser 渲染转义、迟到请求、token 清除、短凭据请求验证先迁后删静态拼写或旧 UI 壳。每次删测在 execution 记录原保障、替代位置和实际命令。

## 环境、失败与回退

实现与验收仅在独立 worktree。临时产物放 .dev-smoke；专用 home/server/DB，不改用户配置、HAPI 数据和凭据。真实验收仅使用已有授权的专用凭据环境，证据不含 prompt、源码或秘密。主 agent 已准备实际复制的依赖目录及固定 HAPI build manifest、核对 SHA 的四平台缓存；不安装或改依赖。现行 CLI 命令树与17项 MCP 工具/schema 基线在 `.dev-smoke/slimming-acceptance/baseline-contract.json`，逐项比较。Playwright 使用已有 headless shell，通过 RUNWEFT_SMOKE_CHROMIUM 显式指定；修改前 console 验收仅作基线。物理远端缺少访问时保留缺口，同机 Runner 不冒充跨机。

每任务保持可运行且由主 agent review/验收/commit；失败不继续受影响退役。通过逐任务提交回退代码；数据库不执行迁移/清理，旧格式拒绝不写入。构造和退出失败聚合报告，不吞错、不以半清理成功覆盖失败。

## 验证策略

聚焦 bun test ./test/文件先行，根 typecheck/test/build 按任务风险检查。compiled 黑盒、真实 HAPI HTTP/Socket/SSE、当前格式重开/不匹配拒绝、安装包与 Playwright 必须覆盖对应修改。最终使用同一候选 hash 完成现行发行组合；历史通过仅是依据，新的 execution 只记录实际运行。Specs 只在主 agent 整体验收后同步。

用户授权例外精确为CLI data/reset、专门历史数据升级回滚的scripts/smoke-upgrade.ts（当前package不存在test:upgrade入口）；不忽略oldBinary参数伪转发。smoke-hub-upgrade当前数据程序替换场景保留，但只能用同schema19输入。package版本/lock/HAPI pin不变，STATE_SCHEMA_VERSION可按唯一格式改为19。

T14格式核验先做WAL/SHM与并发创建定向实验，禁止将readonly打开等同无写入。方案为临时新库不覆盖原子落位，已有库用不写原文件的核验方式，检查表/索引/FK；拒绝主DB与已有sidecar字节/mode/文件集不变。文件不匹配state_format_unsupported、损坏state_format_invalid，503提示独立新--home，不建议reset。schema19单任务记录state_record_invalid只拒绝该项、不补字段，扫描日志报ID/错误码并继续有效任务。具体实验与退出条件在Plan T14。

T14 启动入口补充：services.serve 在 serverToken 创建、目录初始化和 HAPI 启动之前预检已有 Runweft state；不能先启动 HAPI 再拒绝旧业务格式。编译 CLI 的旧格式拒绝验收同时检查业务库与 HAPI 数据不变。页面的旧 Agent 版本显示回退一并按当前 DTO 核对；外来原生对象不认领仍是权限边界。用户长期约束同步 AGENTS.md，不改独立 HAPI 实现。

T2 迁接线实际复现中心 overview 库存请求没有原入口的3秒截止时间：`hub/delegation/api.ts`直接用request lease请求库存，原`tasks/coordinator.ts`另设3秒截止；真实RequestLease无deadline，显式signal覆盖fetch默认timeout，库存挂起可一直等待断联。经主agent确认，T2允许窄修复：`resources.machines`内部可选signal默认lease.signal，overview传入lease.signal与3秒timeout的组合；继续保留库存完成与失败降级后的lease.check，撤权/断联不能转换为成功降级。不新增重试或通用deadline框架。

T3 中心接线复现本机省略baseRef/显式HEAD同requestId冲突：TaskStore.semantic虽然补HEAD，但Hub绕过旧AcceptSchema重排，taskIntent中hubRequest在baseRef之前或之后；contentVersion按JSON键序摘要，因此同值得到不同指纹。主agent确认窄修semantic：worktree先取出baseRef，按固定同一位置重建含baseRef ?? HEAD的意图。保留本机spawn/lookup等价与远端缺显式base拒绝，不改通用hash/validateWorkspaceTarget、不兼容旧hash、不迁移历史指纹；最终schema19仅新格式。

### T6 批次A：正常停服与撤权的 Socket 关闭差异

真实workspace-preparation在完整Hub重启且外部Runner存活的窗口复现：固定snapshot转unknown/machine_offline，Runner只记录Disconnected from bot、不重新注册RPC。最小实证根gWwAUQ及t6a-workspace-preparation-final.log；固定HAPI apiMachine的disconnect只清RPC注册和keepalive，Socket.IO收到server DISCONNECT不自动重连。Runweft sockets.close原先对所有连接down.disconnect(true)，混同了正常整体停服和权限撤销。

本轮授权窄修：仅整体close预先置shuttingDown，连接清理仍幂等清timer/abort/up.disconnect，正常停服关闭Engine.IO transport；撤权、旋转、上游孤立断联继续显式Socket.IO disconnect。使用HAPI/Socket.IO既有重连，不新增重连器/业务重试，不模拟断网取代原正常重启。根测试区分正常transport关闭后既有客户端自动恢复、原RPC不重放、旋转io server disconnect且旧凭据新握手拒绝；实际无模型诊断继续完整Hub/私有HAPI重启与存活Runner。产品变化后build更新候选并重跑受影响compiled场景。

### T6 批次C：高层Task接线与终止消费所有权

六Task入口使用compiled当前Hub/CLI与真实coordinator，不借低层finished种子。当前observeRepository清GIT_CEILING，仓库下.dev-smoke不是non-Git；真实空工程放本次系统tmpRoot/.dev-smoke/project、先核验non_git并独立回收。Git工程包括shared真实create/bind；controls next仅更新当前instructions并重新resolve，首轮snapshot、固定target/launch/nativehistory保留。

outputs→retention仅消费当前专属格式和同候选hash，producer关闭模型/Runner/服务并清模型认证副本，当前业务/连接凭据留给唯一consumer。仅只读当前公开manifest对应Runner receipt/spool作物理证明；不创建第二coordinator或公开机器RPC。consumer在场实查release保留Git/history、discard删spool、零重放后，确认停进程/恢复quota，回收本次可再生数据，留下紧凑两家evidence/log；失败保留诊断并清已可安全移除的本次秘密。

### T6D 当前远端成果接线与验证环境

- result-export/default、fetch 与 TaskResults 使用完整当前源码 gateway、真实中心身份/空间及受理领域记录的私有 taskClient；compiled CLI 对同进程源码 gateway 使用异步子进程，避免同步等待阻塞 HTTP。TaskResults 种子从真实中央 Agent snapshot/当前仓库关联创建，dispatcher 明确静止；持久终态和真实 HAPI seal 后完整重建 gateway 开启现行扫描，不能重启已 close 的协调器。重建后的 discovery 只确认后续 RPC 可用，不承诺 startup 初次 scan 已等 Runner。未知成果回执沿既有固定 operation 查询，不发新 export。
- remote-native/default 保留两 runtime prepared 原生执行与独立当前域 Round；remote-tasks 为 compiled serve+CLI+真实 Task 协调器，无终态种子。显式第二 HAPI argv 真实配置到中心和每 Runner，候选 hash 使用实际二进制。
- 当前 Claude 在 cwd 编码超过200字符时把 projects 名截断加 hash；固定 HAPI getProjectPath 仅替换字符，nativeResume 查不到真实 transcript。本次 Y8ptBq 的 cwd/期望编码长218，实际目录207且原 native jsonl 存在，第二轮确认 missing 并重新创建会话；该固定依赖长路径恢复缺口未修复，不改 HAPI、不复制历史目录。远端 smoke 使用本次唯一系统 tmpRoot/.dev-smoke 短运行目录，工作区 .dev-smoke 仅存 evidence/log；两个 runtime 仍须真实同 nativeID 续轮。
- 当前 handoff 明确 ownedRoot/ownedTempRoot/evidenceDir、server/source/target home、连接身份/机器事实、当前库和真实案例 IDs；只有 current-remote-tasks-1 全双 runtime×两轮成功且清理无误的生产者可被 retention 消费。生产者先确认模型、Runner、中心退出再移除模型认证副本，保连接和业务现场；最终 retention 成功后回收精确 ownedTempRoot。remote-package 由 E 的 collaboration producer 同步迁，不在 D 假验收。
