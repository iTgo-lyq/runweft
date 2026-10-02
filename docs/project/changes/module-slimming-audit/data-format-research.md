# 当前数据格式与历史逻辑专项调查

2026-10-02 用户新增明确要求：代码不保留新旧数据迁移/兼容，不尝试清理旧数据。此文替代 research.md 中要求保护历史兼容的实施结论；原审计仍保留历史口径。本次只读核对，不宣称实现或运行验证。

## 入口与格式

| 数据 | 当前入口/格式 | 历史逻辑及处理 |
| --- | --- | --- |
| 中心 SQLite | src/state.ts openState，PRAGMA user_version=18，所有领域 store 共用 | version<1…18逐级CREATE/ALTER/INSERT SELECT/DROP；v16复制grants；开库前chmod/WAL会写。改新文件一次创建唯一当前schema19结构，已有文件先只读核验当前版本与表结构，旧/未知/损坏拒绝，不chmod/建WAL/写库/删文件 |
| Task/Round JSON | src/tasks/store.ts require/append/update；Task.version=2；当前accept/next已保存round.agent | require凭空注入version:2；append:163及coordinator:480/635/693、views:44回退task.agent。移除版本注入及旧快照回退；当前记录版本/中心归属/必需round快照不匹配明确报错，不能认领或补写 |
| 基线/导入/消费者/准备、成果/附件JSON | src/remote/store.ts、tasks/store.ts，按当前CREATE表及各类型写入 | 直接JSON.parse，无显式历史升级；正常异步阶段的optional字段、未发布/未释放默认投影是现行状态，不能把全部??当兼容删除 |
| config.yaml | src/config.ts ConfigSchema schemaVersion=1，持久readConfig与生成默认共用schema | schemaVersion.default(1)接受当前简写持久文件；省略版本是当前正式简写默认，保留；只有显式非当前版本拒绝，不把合法默认当历史兼容 |
| identity.json、machine.json | hub/connect/record.ts IdentityConnectionSchema、resources/connection.ts RecordSchema，都literal(1) | 已明确版本拒绝，不迁移；保持origin/owner与权限检查 |
| connect.json | hub/connect/client.ts PendingSchema，当前一次握手记录 | 核对现字段，不增加历史转换；损坏/不匹配明确拒绝 |
| process.json、runner.state.json | services.ts:21、runner.ts:12；当前运行进程/连接状态 | 没有版本迁移；PID/实际运行版本与健康诊断是现行事实，不是旧数据兼容。HAPI runner state读写归HAPI，不改其source |
| client.sqlite、YAML Agent | agents/bindings.ts单表IF NOT EXISTS、definitions.ts schema default/文件发现 | 已下线旧消费，随S03删除，不遍历/删除已有文件或数据库 |
| MCP备份、宿主配置、浏览器身份 | mcp/install.ts backupSchema和原子编辑；hub/app.ts存储当前身份；hapi.ts读取私有settings | 显式安装与备份恢复保护当前用户配置，协议用途/当前格式校验保留；不迁移旧Runweft业务数据。原生HAPI文件归HAPI，不改独立source |

state.ts当前完整表结构分组：旧登记machine_registrations/runtime_registrations；delegation_tasks/rounds/inputs/requests/sessions/artifact_intents/artifact_manifests/code_manifests/code_fetches；repository_snapshots/imports/consumers/lfs、workspace_preparations；hub_users/spaces/memberships/invitations；hub_execution_objects/credentials/grants/intents、hub_file_reservations/native_session_claims；hub_resource_machines/machine_spaces/resource_runtimes/runtime_shares/resource_blocks；hub_repositories/repository_aliases/checkouts；hub_agents/agent_versions/agent_members/agent_blocks/agent_selections；hub_delegation_scopes/connection_requests。v16 grants最终主键含leaseKey。最终schema19只创建现行所需表，machine_registrations/runtime_registrations不创建。旧18库只读拒绝，既不转换也不DROP/清理。必须在旧fixture/store消费者退役后切换；schema19已有库与新建库同结构。

## 删除的旧清理入口与调用

src/reset.ts resetData删除固定配置/身份/业务与HAPI库/字节；src/cli.ts import及data reset注册删除。test/reset.test.ts整组仅保障这一用户明确移除的能力，随接口删除，不迁成其他清理接口。state_version_newer提示的reset建议删除。

T5/T6已移除smoke-hub-service、smoke-service、smoke-hub-native-mcp中的reset场景，当前残留为scripts/smoke-arm64.mjs:42调用与smoke-install.mjs:84指南断言。移除剩余reset场景，以专用新home准备正常验收；保留服务关闭、工作区/待交付留存、身份撤销和新身份创建等独立现行保障。普通fixture清理、task workspace remove、artifact prune、artifacts/result release继续保留，不清扫旧版本数据。src/hapi.ts的machine_native_identity_mismatch仍提示清理旧试验数据，改为独立新home并自行保管原目录；当前machineId/token向HAPI settings传播属于现行凭据同步，保留。

## 测试与smoke变更

迁移专属测试定位：tasks.test.ts v1；task-workspaces.test.ts v2；task-results.test.ts v5；hub.test.ts v6；hub-access.test.ts v7；hub-resources.test.ts v10/v11；hub-repositories.test.ts v12；hub-agents.test.ts v13；hub-agent-resolution.test.ts v14；hub-delegation-native.test.ts 的 v15→v16 grant schema upgrade。resources.test.ts更高schema拒绝保留为所有不匹配格式拒绝测试。hub-delegation.test.ts旧无owner行不认领改为当前格式非法记录明确拒绝，不继续旧记录读取/恢复。相应有效并发/权限/恢复用例仍保留。

scripts/smoke-upgrade.ts的schema6种子、旧Agent跨版本/回退链随历史迁移能力撤销，脚本已于T5删除（当前无test:upgrade脚本名）；当前安装/服务版本差异诊断与重启保障由现行服务/安装测试继续覆盖。smoke-hub-upgrade.mjs按Plan拆成两个实际场景：现有schema18专用基线交候选无写拒绝；候选新建schema19数据后由同候选停服重启，核身份、机器、Agent、仓库、附件与worktree保留。不声称不存在的schema19旧版升级，不静默忽略旧binary参数。test:*全清点，除明确撤销历史smoke-upgrade外保留真实场景，不用删入口空通过。

## 文档与接口例外

待实现后同步Specs：deployment、installation/cli、delegation/lifecycle/central、resources/ownership/scope、spaces/membership、release/acceptance/distribution、installation/skill。删除历史增量升级/旧库读取/reset事实，写当前格式拒绝和正常留存；原归档事实不改。docs/usage.md:303/305、development.md服务/QEMU reset说明、skills/runweft/references/maintenance.md:58/61及主Skill维护措辞需同步；website无data reset命令。CLI基线只允许移除data/reset树；17项MCP及其他CLI保持相同。

## 无写入拒绝验证

为已存在旧/未知/伪造当前版本但缺表字段/损坏SQLite及旧Task/Round字段建立专用文件，拒绝前后比对bytes/hash/mode、表/行、目录文件集（包括WAL/SHM），不在拒绝路径重试创建或自动reset。全新文件一次创建、已有完整当前文件正常打开/重启/恢复分别验证。并发首次建库必须区分真实不存在与已存在空库，不把version0文件当新文件迁移。全部测试只操作专用目录。

验收消费者也不能绕过拒绝边界：collaboration-package当前先用DatabaseSync读取现场，再核候选hash；retention/console等脚本同样有直接readonly查询。SQLite readonly可能改sidecar，因此消费入口须先确认本次当前候选和格式，再查询当前业务事实；不为旧现场添加兼容读取器。hub/delegation/service的可选round合成对象是当前调用契约，核实际调用后处理，不能机械认作旧记录兼容；持久Round.agent缺失必须拒绝。

## 主 agent 的 SQLite 拒绝路径实验

2026-10-02 在本 Change 专用目录、当前 Bun 中实际执行，尚非产品实现或验收通过：

- 普通 `Database(path, { readonly: true })` 对关闭后的 WAL 库会生成 sidecar；对已有活跃 WAL 的连接也改变 SHM 摘要。不能用它保证拒绝时无写入。
- URI `immutable=1` 配合 READONLY/URI 标志，在两种情况下均未改变 DB/WAL/SHM 字节、mode 或文件集；但忽略 WAL，不能读取当前业务事实。
- 先以默认 journal 建好完整 schema19 并关闭，再开 WAL 写业务行时，immutable 可以看到固定表/UNIQUE 结构与版本19，且读取不改文件；它仍看不到仅在 WAL 中的新增业务行。
- 后一实验初稿混入了 writer 查询，造成 SHM 变化；最终将摘要区间限制为 immutable 读取后结果为不变。这不证明任意并发检查点下均安全，T14仍须对拟采用的最小方案做真实结构与并发验证，不实现 WAL 解析器。

脚本与原始结果位于 `.dev-smoke/slimming-acceptance/sqlite-probe/` 的 `probe.ts`、`result.json`、`current-schema.ts`、`current-schema.json`，仅保存合成数据。该实验只验证 SQLite 行为，不代表迁移链已删除。

启动入口静态补充：`services.serve` 在 `openState` 前会创建 root token、目录并启动 HAPI；`start` 还会先处理进程记录、打开日志，再派生 `serve`，且子进程退出会包装为 `service_start_failed`。T14须在实际服务启动前拒绝旧state；`start`对外也需保留明确格式诊断。验收既覆盖直接serve，也覆盖编译start，比较Runweft业务库和HAPI数据；不能仅证明openState无写入。`hub/tasks-page.ts`的Hub配置版本/definitionVersion双分支也须核对并移除旧记录显示回退。明确外来原生对象的归属拒绝仍是当前安全边界，不因旧注释的措辞删除。

补充实测（`sqlite-probe/reader-modes.ts` 与 JSON）：主文件版本19、结构/版本变化仅提交在 WAL 时，普通只读 URI、`mode=ro`、`vfs=unix-excl` 都读到 WAL 的18及新增列，但改变原SHM；`immutable=1`不写却错误地只看到主文件19及旧结构；`nolock=1`/unix-none/unix-dotfile在该WAL场景不能开库。复制主文件和WAL到专用临时目录，再读取副本，能识别18和新增列，原目录bytes/mode/文件集不变。不采用immutable单独验证完整现行结构，也不自行解析WAL。

`sqlite-probe/copy-race.ts` 实测固定schema19在另进程持续写入及PASSIVE/TRUNCATE检查点期间，150次独立主文件/WAL副本均成功读取同一完整schema；writer完成497轮，exit=0。该实验只核验固定schema，不宣称副本业务行是事务级备份，也不保证恶意外部并发改schema。临时检查副本由检查者回收，原数据目录无清理；T14仍需对最终实现验证并发首次建库、旧/未知/损坏结构、完整当前结构及真实服务启动拒绝。
