# Smoke 全入口覆盖映射

本表保留T5规划时的迁移前入口与任务归属；表内“旧路径需迁”“后续归属”是当时的任务输入。最终实现、已执行结果及未验证范围以[Execution](execution.md)和[验收](acceptance.md)为准，不把入口清单当作通过记录。

本表以当前 package.json 的全部 test:* 为准；参数来自各脚本 process.argv。T5仅实施标为T5的无模型入口；其余记录保障/依赖，不能据此宣称已迁移或已通过。所有原名和合法argv保留，合并只有真实场景等价才能转发。

| test:* / 当前脚本 | 合法argv | 场景/保障 | 当前依赖及后续归属 |
|---|---|---|---|
| `test:service` / `scripts/smoke-service.mjs` | [runweft] | compiled start/重复start、root/旧route拒绝、显式身份/机器、Runner监督/restart、SIGTERM/foreground；worktree/pending/backups保留；移除data reset专属断言 | 当前Hub或native入口，逐项核对；T5 |
| `test:dashboard` / `scripts/smoke-dashboard.ts` | [runweft] [hapi] [task evidence…] | 旧dashboard浏览器、真实任务fixture与evidence输入；迁到当前console而不减少DOM行为 | 旧agent init/YAML/token suffix/非Hub路径需迁；T7 |
| `test:hub` / `scripts/smoke-hub.ts` | [runweft] [hapi] | Playwright身份/邀请/权限/导出恢复/响应式/秘密脱敏 | 当前Hub或native入口，逐项核对；T7 |
| `test:execution` / `scripts/smoke-execution.ts` | [runweft] | 两runtime并发spawn/丢回复、native输入/审批/拒绝/精准stop、兄弟session与resume历史 | 现行Hub接线归T6；execution/inputs迁入批次B，具体层级见下 |
| `test:mcp` / `scripts/smoke-mcp.ts` | [runweft] | 两host安装/stdout实际工具、子执行过滤保留其他MCP、两runtime resume；compiled取消认证及EOF/退出 | T6B当前两个独立client/Runner home，公共Hub personal native会话；不再有非Hub产品mode |
| `test:resources` / `scripts/smoke-resources.ts` | [runweft] | 无模型双工具版本、stable IDs/read-only、auth/route、MCP安装/stdout、cancel/restore、45s离线、missing command/invalid override/version失败 | 旧agent init/YAML/token suffix/非Hub路径需迁；T5 |
| `test:agents` / `scripts/smoke-agents.ts` | [runweft] | 无模型定义/选择/快照/model+effort映射、两runtime、取消恢复/restart/owner空间隔离；旧YAML发现及suffix认证淘汰 | 旧agent init/YAML/token suffix/非Hub路径需迁；T5 |
| `test:tasks` / `scripts/smoke-tasks.ts` | [runweft] | CLI接受ID/打印request/retry不重放、真实完成/host退出、shared保留与cursor、service restart | 旧agent init/YAML/token suffix/非Hub路径需迁；T6 |
| `test:task-controls` / `scripts/smoke-task-controls.ts` | [runweft] | 双runtime显式model/effort、resume固定定义/历史、审批拒绝、steer、interrupt | 旧agent init/YAML/token suffix/非Hub路径需迁；T6 |
| `test:task-mcp` / `scripts/smoke-task-mcp.ts` | [runweft] | 双host真实spawn/wait/read、child CLI拒绝、长wait timeout、native完成/退出 | 旧agent init/YAML/token suffix/非Hub路径需迁；T6 |
| `test:collaboration` / `scripts/smoke-collaboration.ts` | [runweft] | mode×host×runtime矩阵，shared/worktree/remote真实编辑、context/skill/MCP、resume、断连/steer/interrupt/retry_finish、Git/LFS/input/output/fetch/merge | 旧agent init/YAML/token suffix/非Hub路径需迁；T6 |
| `test:workspaces` / `scripts/smoke-workspaces.ts` | [runweft|--source] [hapi] | 实际RPC prepare/proof/native执行stop/checkpoint、expired resume与missing checkout | T6B当前领域seed/taskClient授权+真实HAPI双runtime；无公开机器RPC |
| `test:worktree-tasks` / `scripts/smoke-worktree-tasks.ts` | [runweft] [codex|claude] | 两runtime实际Git编辑/context/skill/MCP、失败hook retry-finish、两轮seal且parent不变 | 旧agent init/YAML/token suffix/非Hub路径需迁；T6 |
| `test:worktree-lifecycle` / `scripts/smoke-worktree-lifecycle.ts` | evidence.json…（必填） | 读取完成worktree证据；restart/resume/ignored依赖、两task隔离、cancel prepare、discard/remove后future send拒绝 | 现行Hub接线归T6；execution/inputs迁入批次B，具体层级见下 |
| `test:install` / `scripts/smoke-install.mjs` | [packages root] | 私有npm安装/更新/卸载/MCP配置保留、服务版本不一致诊断、路径/runner | 旧agent init/YAML/token suffix/非Hub路径需迁；T12 |
| `test:packages` / `scripts/verify-packages.mjs` | [packages root] | 四平台包manifest/binary/hash/layout与npm launcher | 当前Hub或native入口，逐项核对；T12 |
| `test:arm64` / `scripts/smoke-arm64.mjs` | [packages root] | arm64包私有QEMU/sysroot实际启动与服务探针 | 当前Hub或native入口，逐项核对；T12 |
| `test:hub-upgrade` / `scripts/smoke-hub-upgrade.mjs` | baseline binary candidate binary（两项必填） | 旧baseline/candidate双binary；T14改为baseline18无写拒绝+candidate19同格式重启、current身份/Agent保留 | 旧agent init/YAML/token suffix/非Hub路径需迁；T14 |
| `test:artifacts` / `scripts/smoke-artifacts.ts` | [runweft] [hapi] | 72MiB实际upload/download/hash、丢连接fixed reservation、namespace/auth/pins/tombstone、慢流/restart/零session | 现行Hub接线归T6；execution/inputs迁入批次B，具体层级见下 |
| `test:inputs` / `scripts/smoke-inputs.ts` | [runweft|--source] [hapi] [--machine-only] | 72MiB机器RPC输入/receipt重启/release、Unicode worktree输入、双runtime native读及两轮resume权限 | 现行Hub接线归T6；execution/inputs迁入批次B，具体层级见下 |
| `test:task-inputs` / `scripts/smoke-task-inputs.ts` | [runweft] [--shared-only] | 两runtime×shared/worktree两轮真实input读、context/pins/native stop/resume | 旧agent init/YAML/token suffix/非Hub路径需迁；T6 |
| `test:outputs` / `scripts/smoke-outputs.ts` | [runweft] [hapi] | 实际capture missing/超限、fixed72MiB候选Hub/Runner重启source删除仍retry、Hub下载hash/spool清理/零session | 现行Hub接线归T6；execution/inputs迁入批次B，具体层级见下 |
| `test:task-outputs` / `scripts/smoke-task-outputs.ts` | [runweft] | 两runtime×mode两轮output bytes、部分delivery/retry/collect版本、spool release/原bytes保持 | 旧agent init/YAML/token suffix/非Hub路径需迁；T6 |
| `test:artifact-prune` / `scripts/smoke-artifact-prune.ts` | [runweft] [hapi] | 当前策略preview/apply/分页/quota、restart、丢删除回执查tombstone、所有pins保留/零agent | 现行Hub接线归T6；execution/inputs迁入批次B，具体层级见下 |
| `test:task-retention` / `scripts/smoke-task-retention.ts` | task-output evidence.json [runweft] | 从既有八轮证据继续；共享input回收/worktree保留、failed spool discard、历史pins release但外部pin保留、删除/quota/restart/零native重放 | 现行Hub接线归T6；execution/inputs迁入批次B，具体层级见下 |
| `test:artifact-mcp` / `scripts/smoke-artifact-mcp.ts` | [runweft] | mode×host×runtime矩阵真实MCP input/output/retry/collect/download两轮、child boundary/原bytes | 旧agent init/YAML/token suffix/非Hub路径需迁；T6 |
| `test:repository-export` / `scripts/smoke-repository-export.ts` | [runweft] [hapi] | 实际Git bundle+submodule/LFS export、fixed operation/lost回执/release/hash/零模型 | 现行Hub接线归T6；execution/inputs迁入批次B，具体层级见下 |
| `test:task-results` / `scripts/smoke-result-export.ts` | [runweft] [hapi]（固定--tasks） | 同result-export脚本--tasks分支：TaskResults实际成果发布、固定round/停止seal/bytes | 现行Hub接线归T6；execution/inputs迁入批次B，具体层级见下 |
| `test:result-fetch` / `scripts/smoke-result-export.ts` | [runweft] [hapi]（固定--fetch） | 同result-export脚本--fetch分支：原仓库fetch-result、fixedref/HEAD不变/回执恢复 | 现行Hub接线归T6；execution/inputs迁入批次B，具体层级见下 |
| `test:result-export` / `scripts/smoke-result-export.ts` | [runweft] [hapi] | 实际export-result、sealed Git树/成果bundle/LFS/失败语义/回执重启 | 现行Hub接线归T6；execution/inputs迁入批次B，具体层级见下 |
| `test:repository-import` / `scripts/smoke-repository-import.ts` | [runweft] [hapi] | 实际仓库bundle/LFS materialize/import、100+分批、损坏输入/fixed IDs/离线/restart/release | 现行Hub接线归T6；execution/inputs迁入批次B，具体层级见下 |
| `test:workspace-preparation` / `scripts/smoke-workspace-preparation.ts` | [runweft] [hapi] | CLI preparation与100+批次、固定base/consumer/generation、失败prepare/dirty/ignored/retry/release | 旧agent init/YAML/token suffix/非Hub路径需迁；T6 |
| `test:remote-tasks` / `scripts/smoke-remote-native.ts` | [runweft] [hapi] [codex|claude]（固定--tasks） | remote-native --tasks分支：双runtime完整中央task两轮inputs/outputs/Git/LFS/fetch、断线重启/零重放 | 旧agent init/YAML/token suffix/非Hub路径需迁；T6 |
| `test:result-retention` / `scripts/smoke-result-retention.ts` | remote fixture root [runweft] [hapi] | 继续专用remote成果fixture；preview/release/discard、refs/cache/foreign pins、restart/不重放 | 现行Hub接线归T6；execution/inputs迁入批次B，具体层级见下 |
| `test:remote-native` / `scripts/smoke-remote-native.ts` | [runweft] [hapi] [codex|claude] | 双runtime直接实际native remote prepare/launch/seal/export/fetch/merge与history | 旧agent init/YAML/token suffix/非Hub路径需迁；T6 |
| `test:hub-access` / `scripts/smoke-hub-access.ts` | [hapi] | 真实HAPI机器/身份隔离、intent/adopt/receipt、文件bytes/grants/expiry、流式撤权、restart/脱敏 | 当前Hub或native入口，逐项核对；T5 |
| `test:hub-realtime` / `scripts/smoke-hub-realtime.ts` | [hapi] | 真实socket/polling/RPC/terminal/SSE权限与replay/revoke，Runner heartbeat及same-host fallback拒绝 | 当前Hub或native入口，逐项核对；T5 |
| `test:hub-resources` / `scripts/smoke-hub-resources.ts` | [hapi] [runweft] | 真实HAPI+Runner版本probe、CLI enrollment/stable IDs/sharing/governance/credential rotate/restart/45s离线/脱敏 | 当前Hub或native入口，逐项核对；T5 |
| `test:hub-configuration` / `scripts/smoke-hub-configuration.ts` | [hapi] [runweft] | 真实CLI+HAPI+Runner；repository clone/worktree observation、owner×space Agent/selection/model映射、授权/撤权/restart/零task | 旧agent init/YAML/token suffix/非Hub路径需迁；T5 |
| `test:hub-delegation-native` / `scripts/smoke-hub-delegation-native.ts` | [hapi] | 无模型真实HAPI bridge/RPC与prepared proof拒绝；协议fixture验证owner/task/session边界，不声称两runtime模型执行 | 现行Hub接线归T6；execution/inputs迁入批次B，具体层级见下 |
| `test:hub-delegation-preparation` / `scripts/smoke-hub-delegation-preparation.ts` | [hapi] | 真实Hub preparation/current selectors及Runner Git/RPC，不绕授权 | 旧agent init/YAML/token suffix/非Hub路径需迁；T6 |
| `test:hub-connect` / `scripts/smoke-hub-connect.ts` | [runweft] | compiled encrypted begin/complete，真实Playwright确认/重复/expired/cancel/origin/mobile、私钥/secret不泄漏 | 当前Hub或native入口，逐项核对；T5 |
| `test:hub-consumers` / `scripts/smoke-hub-consumers.ts` | [runweft] | 10 current消费者场景（Codex历史、local/remote/prepare/controls、runtime matrix），实际模型/Gitbytes | 旧agent init/YAML/token suffix/非Hub路径需迁；T6 |
| `test:hub-service` / `scripts/smoke-hub-service.ts` | [runweft] | current defaultHub+client/Runner独立权限、revoke/rotate/restart、worktree保留；移除reset専属 | 当前Hub或native入口，逐项核对；T5 |
| `test:hub-console` / `scripts/smoke-hub-console.ts` | [runweft] | 实际Playwright current控制台/resource/Agent/repository/task/workspace/files/审批与隔离 | 旧agent init/YAML/token suffix/非Hub路径需迁；T7 |
| `test:hub-native-mcp` / `scripts/smoke-hub-native-mcp.ts` | [runweft] | 12 host×runtime×mode当前native MCP场景、长wait/child拒绝/审批/stop，connect引导与model证据 | 旧agent init/YAML/token suffix/非Hub路径需迁；T6 |

## T5 已复核实施范围

- 不改package脚本名。resources/agents 两旧入口分别保留runweft positional argv，转入当前hub-resources/configuration真实场景；先补旧有效unique无模型保障再合并，不能只映射标题。MCP installation/stdout配置检查保留在resources；missing command/invalid override/version failure须补当前真实Runner场景。YAML/project override、token suffix/bindings文件属退役能力，不复刻。
- service/hub-service去除data reset专属调用；正常stop/restart与worktree/pending/backups现场保留继续，fresh enrollment使用独立新home/新Hub，不删除旧home。版本不一致诊断从smoke-upgrade拆到当前service/install测试；T14 schema19尚未实施，本项不运行hub-upgrade宣称新格式通过。
- 提取窄Hub/native进程启退/cleanup helper，只用于上述现行无模型Hub脚本；业务HTTP/CLI断言留调用方。资源一旦取得立即登记，失败/close按逆序尝试全部并汇总，browser/DB/runner/gateway/HAPI关闭互不跳过；清理秘密副本必须在进程退出后，恢复现场和脱敏evidence留下。
- hub-connect含现行浏览器连接保障，本项helper影响则用已有Chromium真实运行，不提前重构T7页面断言。hub-access/realtime保留真实文件授权和Socket/RPC场景，只窄收敛启退。
- smoke-mcp包含真实模型矩阵，归T6；compiled cancellation、EOF、stdout有效保障必须继续保留，当前旧/api/auth+RUNWEFT_HUB_TOKEN取消接线需按当前身份认证改，不能删除。可在T5抽出无模型协议探针并由原test:mcp调用，默认模型矩阵仍留T6迁移；是否抽出由主agent复核。

## 非package入口及授权例外

- scripts/smoke-upgrade.ts：没有test:upgrade脚本名。专属旧数据升级/旧binary回滚/旧Agent YAML复原，允许T5删除；此前版本不匹配诊断、当前重启保障必须在当前service/install中验证。
- smoke-reconstruction.ts、smoke-remote-package.ts、smoke-worktree-package.mjs、smoke-artifact-package.mjs、smoke-mcp-install.mjs、remote-task-probe.ts、task-results-probe.ts与dashboard-browser.ts：依赖链/发行包装入口，分别归T6/T7/T12，不因未列test:*就无证据删除。固定HAPI build/cache与发行workflow不改。
- test:hub-upgrade两binary argv保留，T14明确改为baseline18无写拒绝、候选19新库与同格式重启；不忽略baseline参数，不恢复任何迁移/旧记录兼容。package版本不变，STATE_SCHEMA_VERSION属于T14唯一当前格式标识。
- 原data reset专属场景与无脚本名smoke-upgrade的移除属于用户明确授权例外；其他test:*、CLI/MCP接口和有效场景没有泛化删除授权。

## 合并对应的具体当前检查

- `test:resources [cliBinary]` → 当前 `smoke-hub-resources.ts [hapiBinary] [cliBinary]`，hapi从该CLI配套installedBinaries解析，不能把argv[2]误当HAPI。旧stable ID/version/read-only → `compiled CLI persists enrollment…real Codex/Claude version discovery`、`real native installations keep stable runtime IDs`；取消/恢复 → `space-local governance…detach/reattach cannot revive grants`、credential rotation；45秒presence/restart → `gateway/Runner restart retains enrollment`、`real native heartbeat expiry…historical`。已补并实跑：当前真实Runner缺command/invalid override/version失败并恢复；专用配置MCP安装/检查/卸载与compiled stdio取消/EOF协议检查。旧root suffix authority/独立本地资源库不复刻，当前auth/route隔离由service与hub-access真实检查覆盖。
- `test:agents [cliBinary]` → 当前 `smoke-hub-configuration.ts [hapiBinary] [cliBinary]`，配套HAPI解析同上。旧worktree仓库身份 → `real clone/worktree metadata converges on one Hub repository`；绑定/namespace隔离 → `two users maintain same-name private Agents and personal repository choices`；选择器 → 当前Agent selection/check断言；已补并实跑Codex/Claude两runtime launchOptions精确model/effort断言，以及无效身份/config/definition与选择错误；取消/restart → `Hub/Runner restart preserves stable resolution; remote drift and membership rejoin require explicit renewed configuration`；零session/无资源复制 → `configuration preview performs no task/model execution`。旧离线YAML创建/whole project override/suffix认证不是现行能力，排除而非补兼容。
- `test:mcp` 默认仍保留原安装/native矩阵及合法单binary argv；T5仅先迁compiled认证取消/EOF无模型部分（若独立protocol-only选项仅新增，不让默认跳过）。必须记录实际HTTP aborted、paths无写请求、MCP stdout可解析，不靠日志PASS代替。默认native部分T6，不因T5协议probe通过宣称整个test:mcp通过。
- 合法筛选env也须保留：resources/agents `RUNWEFT_SMOKE_ROOT`；collaboration/artifact-mcp `RUNWEFT_SMOKE_CASE`；hub-consumers `RUNWEFT_SMOKE_CONSUMER_CASE=codex|remote|prepare|controls`；hub-native-mcp `RUNWEFT_SMOKE_HOST=all|codex|claude`、MODE=all|shared|worktree|remote、RUNTIME=all|codex|claude；浏览器通过RUNWEFT_SMOKE_CHROMIUM现有override，原生版本命令配置通过RUNWEFT_SMOKE_CLAUDE。

表中依赖列记录改造前接线及后续任务归属；T5实际结果见Execution，不代表T6模型或T14格式验证通过。T5已迁入resources/agents两个入口、service/hub-service、access/realtime/connect与MCP无模型协议部分；其余条目仅为静态映射。

realtime现行权限映射：A机器所有者+A自身session承担双向terminal与agent input；B自己的session在A机器只读agent-terminal订阅成功，交互terminal/input拒绝；A机器所有者读取B session仍拒绝。B只读viewer保留到token rotation/空间移除的实时撤权断言。原脚本B交互成功预期已由原HEAD复现及当前Specs/authorizeTerminal证据确认过期，未修改产品权限。

资源/Agent入口保留 macOS Codex.app 内置路径（无 PATH codex）前置条件；HAPI负责实际定位，T5只在Linux实测，不宣称macOS通过。

T5逐断言补齐：resources在真实discovery后、任何runtime register前检查runtime列表为空；`machine/runtime rename and independent unregister/register retain stable IDs and names; machine cancellation does not cancel runtime registration` 独立验证改名、机器取消后runtime仍registered但machine_unregistered、同machine恢复、runtime取消列表/详情registered=false与runtime_unregistered、同ID/name恢复。此保障不由空间治理或凭据轮换替代。configuration的 `runtime unregister refuses selected Agent resolution; explicit registration restores the same runtime and immutable resolution snapshot` 验证当前Agent拒绝/恢复；仅真实重新探测的target.checkedAt可非下降变化，其余完整resolution相等。`Hub client leaves no server/runweft/state.sqlite/client.sqlite authority in its dedicated home` 使用纯Hub客户端home执行list/resolve；机器enroll home允许当前本机协调client.sqlite，二者不能混同。

## T6 批次A 已验收接线

九入口及精确命令/evidence见Execution T6A。artifacts/prune与workspace-preparation是compiled CLI + compiled中心服务；inputs仅`[runweft] [hapi] --machine-only`、outputs及repository export/import是compiled CLI +当前源码完整gateway +实际HAPI/Runner；hub-delegation-native/preparation是源码gateway与实际HAPI/Runner。领域种子与真实授权/RPC/字节明确分开，不宣称任务模型E2E。

- artifacts root/suffix路径替换为真实other owner/space拒绝与root CLI拒绝；有效机器授权读/回收由native脚本实际input/publication grant检查保留。旧doctor.artifacts已退役，prune真实limits/server policy/usage/current paths与实际DB位置继续验证。
- 所有文件/hash/固定receipt/丢回复/Git/LFS/离线/pins/零模型检查保留；诊断103文件批≤100、三consumer快照/LFS缓存留存、dirty/ignored拒绝、offline恢复与本机诊断拒绝均实际执行。无fixture下游consumer，成功只留evidence/log，失败只保留诊断并清停服秘密。
- 正常Hub关服使用transport关闭恢复现有Runner重连；撤权/旋转仍显式disconnect，根测试保护无RPC重放/旧凭据拒绝，真实compiled诊断继续正常Hub重启+存活Runner。
- inputs默认双runtime仍归T6B，不因machine-only通过完成该条。后续task-output/retention、remote/result-retention、worktree/lifecycle与安装包装consumer仍按本表原链迁，未用本批替代模型场景。

### T6 批次B：四个默认模型入口

- execution保留合法单CLI argv，使用其installedBinaries配套HAPI；compiled中心+独立Runner经当前用户/空间/登记runtime的public HubClient.http，保留并发spawn/丢回复同回执、输入丢回复同localId、context/skill、精确interrupt、native审批/拒绝、Codex同host兄弟fork互不误停、两runtime历史resume/nativeID和host退出。代理保留实际headers/query，未改产品授权或Task恢复策略。
- MCP的local/hub仅为两个独立client+Runner home的场景标签，二者均使用当前Hub身份/空间，不声称存在旧非Hub产品mode。保留两home×两native host诊断、两runtime start/resume过滤与keep_probe真实调用、Claude原生Agent/Task工具、Codex实际catalog、相同nativeID、原默认末尾协议probe；诊断对当前hub/owner/space、nativeID/cwd/dataRoot精确断言，不补旧connection.mode。
- workspaces为compiled CLI初始化+source完整gateway/current domain seed/taskClient policy+真实HAPI/Runner/双模型，保留managedWorkspaces、dirty父仓库固定commit、prepare回执、非法proof无child、实际native完成/stop、operator写入后seal/ref/blob、sealed resume拒绝、缺checkout无child且不创建空cwd、父Git/index不变。不是Task接受到模型完成的E2E。
- inputs保留批次A完整机器前置并恢复artifactTransfers能力断言。默认双runtime按真实中央runtime/Agent创建完整当前seed，动态ExecutionClient始终读取重启后的taskClient；四轮实际input读、路径在cwd外、project marker、零额外审批、固定transfer、active release拒绝、相同nativeID续接、release后resume拒绝、显式null清preparedFiles均保留。新的独立resume验证用TaskStore.append合法新Round；同一次unknown仍原ID/原Round查询，未新增blind replay。
- 模型配置仅复制到helper实际CODEX_HOME/CLAUDE_CONFIG_DIR，0600副本/0700目录，原文件hash不变；Claude选择器映射真实HAPI_CLAUDE_PATH，MCP observer保留选择器与实际log。构造失败逐份回收，退出分别确认本次session stop、known模型host、基础Runner/HAPI；proxy或日志清理失败仍尝试已可安全的模型副本删除。成功回收可再生DB/Git/download/cache/配置，只留紧凑evidence/log；失败保留诊断数据。
- 四默认真实自检通过，精确日志/evidence见Execution。最后pin/diagnostic hub/标签及清理故障续行返修后typecheck通过；最终同版默认入口由主agent独立实跑，未以machine-only或根mock替代。其他T6模型矩阵/producer-consumer及T7+尚未下发，不标T6完成。

### T6 批次C：六个高层Task与终止留存消费链

- tasks/controls/task-mcp/task-inputs/task-outputs全部compiled中心+compiled CLI+真实Task coordinator/native模型，复用窄启动/当前身份空间与机器登记，没有finished种子、第二coordinator或授权mock。Git项目包括shared均真实repository create/bind与中央Agent UUID；tasks/controls/MCP的真non-Git工程用本次唯一系统tmpRoot/.dev-smoke/project，observeRepository先证实non_git，结束独立回收，不靠GIT_CEILING绕过真实观察。
- tasks保持Codex-only前置、stderr request UUID/accepted返回、同请求相同回执、CLI退出后继续、空项目不写、timeout0 cursor、native completion/stop/host退出与服务重启；stderr文字存在不夸称before-network时序实验。controls双runtime保留实际model/effort、审批/拒绝精确文件效果、memory/nativeID、Codex steer/Claude拒绝、旧round interrupt不影响当前与精准executionId。当前Agent update只改instructions，首轮snapshot深比较不变，next取得新version/instructions、固定target/launch相等（仅checkedAt正常非下降），不复活YAML/runtime:null能力。
- task-mcp保留HOST筛选、两原生host实际线程ID/cwd/parent、唯一spawn、实际>=64秒wait timeout、read最终报告、child CLI spawn/send合法Agent UUID的递归拒绝proof、限定审批、disabledMcpServers及host退出。CLI task list仍按相同machine/cwd过滤，可见这些MCP任务，无--all扩大范围。
- task-inputs默认八轮（两runtime×shared/worktree×两round）和--shared-only语义保留：Unicode bytes/name/hash/context、固定请求、shared preparedFiles/worktree preparedWorkspace由真实coordinator gates、released下载/工作树副本、artifact pin、服务restart后同nativeID续接、parent Git不变。task-outputs默认四Task八round，保留1MiB实际限制→partial→改额restart→幂等retry/collect v1/v2/v3、cursor/completed_revision/session不重放、旧round bytes/pins与parent Git/seal。
- outputs与retention同时改唯一current-task-outputs-1证据，不读/翻译旧fixture。producer记录candidate两binaryhash、真实server/client/state/HAPI/Runner路径和八round IDs；停模型/Runner/service并清模型认证副本，现行业务/连接交唯一retention consumer。物理spool只读已知公开manifest.captureOperationId对应本次receipt.json，严格验证cwd/name/path/hash/size，未添加机器RPC。
- retention保持八轮输入与pins、failed candidate不能普通release且spool不动、explicit discard物理删、external recovery pin、全部manifest/report/Git/completed_revision/nativeID不变、quota精确减少/tombstone/restart/零native和input重放。产品release保留Git/worktree事实在仍存现场时断言并记录history/manifest对照；最后consumer成功且所有进程停、quota恢复才回收本次producer大文件/DB/Git/spool/配置/凭据，只留两家紧凑evidence/log。失败保留诊断、确认停后清确切秘密，未扫描旧目录。
- 自检六家默认真实通过（inputs八轮、outputs八轮+retention终止消费），最终源码修整后的主agent同版验收仍进行。tasks最终import清理误删join，主agent已实际复现四行为组通过但finally写evidence失败/exit1；已仅恢复import、typecheck实际exit0，不能把失败版本当最终通过。未推进D/E/T7或标T6完成。

### T6D 当前远端与成果：根已验收

result-export、result-fetch 与 task-results 三个 package 入口仍实际执行各自分支和 [runweft][hapi] 参数。前两者为当前授权私有原生 Git/RPC/字节、无模型；后者为真实 seal + 当前合法受理终态领域种子 + 完整 gateway 恢复/public CLI及MCP adapter fetch，不称 compiled Task E2E。remote-native 默认为两runtime诊断准备/原生执行，remote-tasks 才是 compiled 中心真实 Task 协调器，均保第三 flavor 选择与默认双runtime。result-retention 只消费 current-remote-tasks-1 完整双runtime×两轮现场，明确 ownedRoot/evidenceDir，不读取旧 first/second/default 结构；最终消费后清本次临时环境。remote-package 当前由 E collaboration producer 联合迁，未声称 D 已完成该入口。长 Claude cwd 恢复未支持的固定HAPI限制保留失败证据，短运行 root 验收不代表已修复该限制。

D最终自检：remote-native o1jkVo默认八组；remote-tasks WjiLDJ默认两runtime四round+离线fetch共五组，实际配置Runweft MCP再验证native过滤；result-retention k5pauW消费WjiLDJ四组并回收唯一ownedTempRoot，均exit0/cleanupErrors=[]。只有默认all将现场交retention；单flavor成功由producer回收，合法argv不变。无模型三入口根已独立接受，模型链根已独立执行 vWPXeA默认native、8aheeA默认Task→MA3NHE retention并通过，三家cleanupErrors为空、终结ownedRoot均删除；remote-package由E当前producer同步更新，不在本批冒充通过。

### T6E 最终覆盖与验收边界

| 入口 | 当前有效保障 | 本阶段验收 |
| --- | --- | --- |
| collaboration shared/worktree/remote与controls/retry-finish选择 | 当前独立身份/空间、真实双Runner与宿主MCP；编辑/指令/skill/其它MCP过滤保留、原生同会话续轮、真实断连不重发、Git/LFS/文件/离线fetch、显式merge；控制/修复保原前置 | shared8/18实施者实跑根复核；root worktree8/18、remote4/8、双controls7轮、retry2轮；最终remote末DTO返修另有两跨runtime完整链 |
| worktree-package / remote-package | 同安装候选当前handoff、实际公开owner/space DTO；源历史/inputs/report/native不重放，取回/释放/删除与父Git保护，最终独占环境清理 | root retry mbmMVX→VPbpC2；最终remote uOAImS→MrrJFs、5w1CcT→X9Cf7M。早期default remote consumer AWbF2R失败保留，T13重跑最终default全链 |
| artifact-mcp / artifact-package | 原八组合十六轮upload/input/output/partial/collect、当前身份和child工具边界；同候选读取原bytes/manifest/history，release与checkout删除后报告/refs保留 | root default八case生产者及消费者只读部分通过；原default释放后修订号比较失败不改写，最终两个跨runtime完整链通过；T13最终default全链 |
| reconstruction | 双runtime首轮真实记忆；新原生历史只重建先前轮次、报告与新输入不回显种子；固定ID不得重复接受second | root wa6hwy七项与已接受第二轮再次调用提前拒绝；实施者pt6CM8故障现场同ID继续；不是版本数据迁移 |
| worktree-tasks / worktree-lifecycle | compiled Task双runtime工程/skill/project MCP和两轮Git seal；restart第三轮保ignored依赖/原记忆且无新commit，准备取消无模型、父推进仍固定base；ignored拒删/restart后显式discard、refs/report保留与后续send拒绝 | root 8sbJQL→yMsL7n，六实际模型轮/两准备取消；终结ownedRoot回收，原evidence紧凑保留 |

上述真实运行不降低矩阵或放宽权限。后续仅remote snapshot/fetch修订精确校验和若干凭据副本登记窄修的版本边界见Execution；最终同候选验证统一由T13完成。当前stage格式仍18，唯一schema19及无迁移/无reset行为由T14实施，不提前声称已完成。

## T7 当前浏览器接替映射（实现者自检；独立根验收见Execution）

| 原有效保障 | 当前具体接替 | 自检层级/边界 |
| --- | --- | --- |
| dashboard HTTP公开HTML/CSS/JS、CSP/referrer/cache、GET/HEAD/405/未知文件、数据401；open无凭据argv | hub-console.test静态资产矩阵；service-commands原完整open；真实console pageErrors | 根9pass127expect，当前模块；旧dashboard其他消费者T9退役 |
| 旧根登录/URLtoken/重试的安全目标：成功才保存、拒绝不覆盖、不循环/不新建、同origin原生链接不携secret | console-smoke合法形状无效identity导入一次read/零create/无保存；consoleTasks native popup/全request URL、header900s user×space、sessionStorage/opener、本机语言设置、rotation与expiry | 原共享root/localStorage与自动续期协议退役，不复活旧认证；当前Playwright真实行为 |
| 旧LatestRead迟到成功/失败、busy/cancel不复活 | consoleTasks实际served console模块+真实授权HTTP，clear后两种迟到响应不恢复content/navigation/notice；实际UI busy控件禁用与读调用不重复 | 既有generation/action，无新框架；不冒称普通用户可并发点击disabled控件 |
| unknown非成功、未确认/明确未启动/停止、code不适用、files未声明/已释放 | 当前tasks-page标签函数及根精确用例；consoleTasks已授权overview DOM投影状态/转义；实际引擎数据语义仍由T2根测试保障 | 额外状态是浏览器投影fixture，未播种可执行unknown业务任务 |
| 组合筛选、页重置/前后页、无匹配/真正空scope、刷新503保数据/错误清除、报告/Agent/summary/hint转义、刷新保轮次与展开 | consoleTasks 27owner/1member、workspace+parent+status、25/50页、当前新空space、local/global/detail503、长报告两round/16K、当前UI文字节点 | 当前真实身份/space权限；新增empty space经当前HTTP，非假权限 |
| 375/1200无横向溢出、长报告/展开JSON、键盘焦点 | consoleTasks两宽度scrollWidth与真实Tab/Shift+Tab computed outline；hub独立context390px/desktop与键盘skip | Playwright实际行为，S12明确排除，保原根CI安全字符串断言 |
| 原native retained/archived真实history/库存不变、无再登录 | dashboard全部source argv由consoleHistory逐项严格读取当前hub-native-mcp envelope，serverHome匹配paths，隔离复制当前DB，12case真实archived/title/非空message/API读取+reload；私有副本库存前后相等，原6DB/sidecar存在/mode/size/hash不变 | iFQ4mA→JFXZGU/Jiou6Z两次独立source消费成功，原source不修改不清；不是active RPCfixture替代历史 |
| 原current console配置、权限、CAS、失回执/重名、分享/治理、原生审批/文件/SSE、foreign404/managed409/terminaldeny/16min | 现有业务断言保留在console-smoke及consoleTasks，新增rotation实际401清短凭据、独立身份不受影响、明确重开新JWT且不续期 | hub-console X0kcqD17组；dashboard同17组并汇总子historyResults；hub6cHnor8组；candidate432a7726/bdf706d7 |

`test:hub-console` 保留单binary与相邻HAPI选择；`test:dashboard` 保留binary、显式HAPI、全部evidence argv，顶层success只在所有source成功后为true。RUNWEFT_SMOKE_CHROMIUM从母进程用于独立Chromium；child隔离RUNWEFT_/HAPI_/CLI_API_TOKEN/DB_PATH/TELEGRAM_BOT_TOKEN。fixture进程停止后清本次秘密，成功回收home/复制DB；截图/evidence紧凑保留。jSgCqe由主agent在全部浏览器验收后调用最终终结函数回收，只留原evidence；实施者没有擅自删除该源。

T7 final consumer现在接在全部historyResults成功之后：全部argv先验证，随后按成功当前hub-native-mcp root去重停止home/确认所有host PID消失，回收仅本次root非evidence数据；原evidence保持原样，补充sourceCleanup由顶层记录并参与success。源数据库不变检查截止回收前，不把终结消费后的删除称为“source永远只读”。根17+12浏览器验收后授权本窄动作，实现者未自行清jSgCqe；根已直接以重复cleanup argv调用最终函数，验证只清一次、24记录PID退出、原evidence不变。最终T13跑producer→browser→cleanup完整链。
