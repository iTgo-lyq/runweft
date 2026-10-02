# Smoke 全入口覆盖映射

本表以当前 package.json 的全部 test:* 为准；参数来自各脚本 process.argv。T5仅实施标为T5的无模型入口；其余记录保障/依赖，不能据此宣称已迁移或已通过。所有原名和合法argv保留，合并只有真实场景等价才能转发。

| test:* / 当前脚本 | 合法argv | 场景/保障 | 当前依赖及后续归属 |
|---|---|---|---|
| `test:service` / `scripts/smoke-service.mjs` | [runweft] | compiled start/重复start、root/旧route拒绝、显式身份/机器、Runner监督/restart、SIGTERM/foreground；worktree/pending/backups保留；移除data reset专属断言 | 当前Hub或native入口，逐项核对；T5 |
| `test:dashboard` / `scripts/smoke-dashboard.ts` | [runweft] [hapi] [task evidence…] | 旧dashboard浏览器、真实任务fixture与evidence输入；迁到当前console而不减少DOM行为 | 旧agent init/YAML/token suffix/非Hub路径需迁；T7 |
| `test:hub` / `scripts/smoke-hub.ts` | [runweft] [hapi] | Playwright身份/邀请/权限/导出恢复/响应式/秘密脱敏 | 当前Hub或native入口，逐项核对；T7 |
| `test:execution` / `scripts/smoke-execution.ts` | [runweft] | 两runtime并发spawn/丢回复、native输入/审批/拒绝/精准stop、兄弟session与resume历史 | 当前Hub或native入口，逐项核对；T6 |
| `test:mcp` / `scripts/smoke-mcp.ts` | [runweft] | 两host安装/stdout实际工具、子执行过滤保留其他MCP、两runtime resume；compiled取消认证及EOF/退出 | 旧agent init/YAML/token suffix/非Hub路径需迁；T6 |
| `test:resources` / `scripts/smoke-resources.ts` | [runweft] | 无模型双工具版本、stable IDs/read-only、auth/route、MCP安装/stdout、cancel/restore、45s离线、missing command/invalid override/version失败 | 旧agent init/YAML/token suffix/非Hub路径需迁；T5 |
| `test:agents` / `scripts/smoke-agents.ts` | [runweft] | 无模型定义/选择/快照/model+effort映射、两runtime、取消恢复/restart/owner空间隔离；旧YAML发现及suffix认证淘汰 | 旧agent init/YAML/token suffix/非Hub路径需迁；T5 |
| `test:tasks` / `scripts/smoke-tasks.ts` | [runweft] | CLI接受ID/打印request/retry不重放、真实完成/host退出、shared保留与cursor、service restart | 旧agent init/YAML/token suffix/非Hub路径需迁；T6 |
| `test:task-controls` / `scripts/smoke-task-controls.ts` | [runweft] | 双runtime显式model/effort、resume固定定义/历史、审批拒绝、steer、interrupt | 旧agent init/YAML/token suffix/非Hub路径需迁；T6 |
| `test:task-mcp` / `scripts/smoke-task-mcp.ts` | [runweft] | 双host真实spawn/wait/read、child CLI拒绝、长wait timeout、native完成/退出 | 旧agent init/YAML/token suffix/非Hub路径需迁；T6 |
| `test:collaboration` / `scripts/smoke-collaboration.ts` | [runweft] | mode×host×runtime矩阵，shared/worktree/remote真实编辑、context/skill/MCP、resume、断连/steer/interrupt/retry_finish、Git/LFS/input/output/fetch/merge | 旧agent init/YAML/token suffix/非Hub路径需迁；T6 |
| `test:workspaces` / `scripts/smoke-workspaces.ts` | [runweft|--source] [hapi] | 实际RPC prepare/proof/native执行stop/checkpoint、expired resume与missing checkout | 旧agent init/YAML/token suffix/非Hub路径需迁；T6 |
| `test:worktree-tasks` / `scripts/smoke-worktree-tasks.ts` | [runweft] [codex|claude] | 两runtime实际Git编辑/context/skill/MCP、失败hook retry-finish、两轮seal且parent不变 | 旧agent init/YAML/token suffix/非Hub路径需迁；T6 |
| `test:worktree-lifecycle` / `scripts/smoke-worktree-lifecycle.ts` | evidence.json…（必填） | 读取完成worktree证据；restart/resume/ignored依赖、两task隔离、cancel prepare、discard/remove后future send拒绝 | 当前Hub或native入口，逐项核对；T6 |
| `test:install` / `scripts/smoke-install.mjs` | [packages root] | 私有npm安装/更新/卸载/MCP配置保留、服务版本不一致诊断、路径/runner | 旧agent init/YAML/token suffix/非Hub路径需迁；T12 |
| `test:packages` / `scripts/verify-packages.mjs` | [packages root] | 四平台包manifest/binary/hash/layout与npm launcher | 当前Hub或native入口，逐项核对；T12 |
| `test:arm64` / `scripts/smoke-arm64.mjs` | [packages root] | arm64包私有QEMU/sysroot实际启动与服务探针 | 当前Hub或native入口，逐项核对；T12 |
| `test:hub-upgrade` / `scripts/smoke-hub-upgrade.mjs` | baseline binary candidate binary（两项必填） | 旧baseline/candidate双binary；T14改为baseline18无写拒绝+candidate19同格式重启、current身份/Agent保留 | 旧agent init/YAML/token suffix/非Hub路径需迁；T14 |
| `test:artifacts` / `scripts/smoke-artifacts.ts` | [runweft] [hapi] | 72MiB实际upload/download/hash、丢连接fixed reservation、namespace/auth/pins/tombstone、慢流/restart/零session | 当前Hub或native入口，逐项核对；T6 |
| `test:inputs` / `scripts/smoke-inputs.ts` | [runweft|--source] [hapi] [--machine-only] | 72MiB机器RPC输入/receipt重启/release、Unicode worktree输入、双runtime native读及两轮resume权限 | 当前Hub或native入口，逐项核对；T6 |
| `test:task-inputs` / `scripts/smoke-task-inputs.ts` | [runweft] [--shared-only] | 两runtime×shared/worktree两轮真实input读、context/pins/native stop/resume | 旧agent init/YAML/token suffix/非Hub路径需迁；T6 |
| `test:outputs` / `scripts/smoke-outputs.ts` | [runweft] [hapi] | 实际capture missing/超限、fixed72MiB候选Hub/Runner重启source删除仍retry、Hub下载hash/spool清理/零session | 当前Hub或native入口，逐项核对；T6 |
| `test:task-outputs` / `scripts/smoke-task-outputs.ts` | [runweft] | 两runtime×mode两轮output bytes、部分delivery/retry/collect版本、spool release/原bytes保持 | 旧agent init/YAML/token suffix/非Hub路径需迁；T6 |
| `test:artifact-prune` / `scripts/smoke-artifact-prune.ts` | [runweft] [hapi] | 当前策略preview/apply/分页/quota、restart、丢删除回执查tombstone、所有pins保留/零agent | 当前Hub或native入口，逐项核对；T6 |
| `test:task-retention` / `scripts/smoke-task-retention.ts` | task-output evidence.json [runweft] | 从既有八轮证据继续；共享input回收/worktree保留、failed spool discard、历史pins release但外部pin保留、删除/quota/restart/零native重放 | 当前Hub或native入口，逐项核对；T6 |
| `test:artifact-mcp` / `scripts/smoke-artifact-mcp.ts` | [runweft] | mode×host×runtime矩阵真实MCP input/output/retry/collect/download两轮、child boundary/原bytes | 旧agent init/YAML/token suffix/非Hub路径需迁；T6 |
| `test:repository-export` / `scripts/smoke-repository-export.ts` | [runweft] [hapi] | 实际Git bundle+submodule/LFS export、fixed operation/lost回执/release/hash/零模型 | 当前Hub或native入口，逐项核对；T6 |
| `test:task-results` / `scripts/smoke-result-export.ts` | [runweft] [hapi]（固定--tasks） | 同result-export脚本--tasks分支：TaskResults实际成果发布、固定round/停止seal/bytes | 当前Hub或native入口，逐项核对；T6 |
| `test:result-fetch` / `scripts/smoke-result-export.ts` | [runweft] [hapi]（固定--fetch） | 同result-export脚本--fetch分支：原仓库fetch-result、fixedref/HEAD不变/回执恢复 | 当前Hub或native入口，逐项核对；T6 |
| `test:result-export` / `scripts/smoke-result-export.ts` | [runweft] [hapi] | 实际export-result、sealed Git树/成果bundle/LFS/失败语义/回执重启 | 当前Hub或native入口，逐项核对；T6 |
| `test:repository-import` / `scripts/smoke-repository-import.ts` | [runweft] [hapi] | 实际仓库bundle/LFS materialize/import、100+分批、损坏输入/fixed IDs/离线/restart/release | 当前Hub或native入口，逐项核对；T6 |
| `test:workspace-preparation` / `scripts/smoke-workspace-preparation.ts` | [runweft] [hapi] | CLI preparation与100+批次、固定base/consumer/generation、失败prepare/dirty/ignored/retry/release | 旧agent init/YAML/token suffix/非Hub路径需迁；T6 |
| `test:remote-tasks` / `scripts/smoke-remote-native.ts` | [runweft] [hapi] [codex|claude]（固定--tasks） | remote-native --tasks分支：双runtime完整中央task两轮inputs/outputs/Git/LFS/fetch、断线重启/零重放 | 旧agent init/YAML/token suffix/非Hub路径需迁；T6 |
| `test:result-retention` / `scripts/smoke-result-retention.ts` | remote fixture root [runweft] [hapi] | 继续专用remote成果fixture；preview/release/discard、refs/cache/foreign pins、restart/不重放 | 当前Hub或native入口，逐项核对；T6 |
| `test:remote-native` / `scripts/smoke-remote-native.ts` | [runweft] [hapi] [codex|claude] | 双runtime直接实际native remote prepare/launch/seal/export/fetch/merge与history | 旧agent init/YAML/token suffix/非Hub路径需迁；T6 |
| `test:hub-access` / `scripts/smoke-hub-access.ts` | [hapi] | 真实HAPI机器/身份隔离、intent/adopt/receipt、文件bytes/grants/expiry、流式撤权、restart/脱敏 | 当前Hub或native入口，逐项核对；T5 |
| `test:hub-realtime` / `scripts/smoke-hub-realtime.ts` | [hapi] | 真实socket/polling/RPC/terminal/SSE权限与replay/revoke，Runner heartbeat及same-host fallback拒绝 | 当前Hub或native入口，逐项核对；T5 |
| `test:hub-resources` / `scripts/smoke-hub-resources.ts` | [hapi] [runweft] | 真实HAPI+Runner版本probe、CLI enrollment/stable IDs/sharing/governance/credential rotate/restart/45s离线/脱敏 | 当前Hub或native入口，逐项核对；T5 |
| `test:hub-configuration` / `scripts/smoke-hub-configuration.ts` | [hapi] [runweft] | 真实CLI+HAPI+Runner；repository clone/worktree observation、owner×space Agent/selection/model映射、授权/撤权/restart/零task | 旧agent init/YAML/token suffix/非Hub路径需迁；T5 |
| `test:hub-delegation-native` / `scripts/smoke-hub-delegation-native.ts` | [hapi] | 无模型真实HAPI bridge/RPC与prepared proof拒绝；协议fixture验证owner/task/session边界，不声称两runtime模型执行 | 当前Hub或native入口，逐项核对；T6 |
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
