# 测试与工程辅助流程调查

## 基线与任务授权

用户已授权启动独立重构任务，并明确不保留旧测试数据、格式与逻辑的兼容层。2026-10-16 用户取消 traex 参与，改由主 Agent 多轮自审，要求 launcher 放 src、减少目录与抽象。前置清理 Change 已归档合入 main；这是先后工作安排，不声明代码交付依赖。

当前基线 `94f36a25776c59a87fb3d83cf4448d28411c66ec`。下述初始统计与 CI 实证来自前期 `76e53ef` 调查，两者产品/测试/工作流代码相同，只有清理文档和状态变化。前期调查未新增产品/模型验收；2026-10-17 Claude 的根测试与编译测量见第四轮评审，本 Agent 未重复执行。

## 已核实的现状

### 数量与实际入口

统计限于本仓库 `scripts/` 与根 `test/`，不含 HAPI、原型、官网及 SpecTrail 自身测试；行数包含空行和注释，仅用于描述维护规模，不作为删除依据。

| 分类 | 文件数 | 行数 | 实际职责 |
| --- | ---: | ---: | --- |
| 根 `test/*.test.ts` | 43 | 6282 | 纯规则、数据库/协议组件、编译 CLI、测试设施回归混合 |
| 根测试辅助文件 | 12 | 703 | SQLite/HTTP/native 替身、CLI 编译和生命周期 |
| `scripts/smoke-*` | 30 | 4798 | 无模型集成、安装/卸载、模型主链及 HAPI 专项 |
| `scripts/fixtures/` | 32 | 1902 | 集成环境、原生生产/消费、候选/来源契约；包含类型声明文件 |
| `scripts/tests/` | 6 | 1026 | 发布、下载、证据汇总、空间、分发与 CI 范围检查 |
| `scripts/` 顶层其他文件 | 19 | 1499 | 构建、打包、npm launcher、发布、检查与分发；不能当测试废文件删除 |

`scripts/` 合计 87 个文件、9225 行。根测试及辅助合计 6985 行；作为量级参照，`src/` 为 113 个 TypeScript 文件、12042 行。测试与工具多于业务代码不直接证明过度设计，必须核对独立故障保障。

30 个 smoke 文件全部存在现行可达入口或手动文档入口：无模型集成清单负责 access 4、storage 11、web 3、service-package 2，共 20 个 case（result-export 分 fetch/tasks 两次；包组含非 smoke 的 verify-packages）；native 入口组织六条主链与四个控制/重建 case，并消费三个 package 后继入口；execution 由 package.json 暴露，HAPI session/shutdown 由发行文档手动选择；service 由安装/包验收及开发 CI 调用，完整卸载由正式发行调用。没有发现可以仅因“无人调用”而批量删除的 smoke 文件。

### 根测试并不是纯单元测试

[此前分层设计](../../archive/2026-10-03-test-backbone-slimming/technical.md)明确把根测试定义为“核心快测”，允许真实 SQLite/HTTP 和必要的编译 CLI。当前并非完全没有设计，而是这些不同成本的检查仍合在 `bun run test` 下，缺少独立的纯规则快测入口。

43 个根测试文件中，9 个直接调用共享 `compiledCli()`，18 个直接出现子进程调用，12 个直接创建 HTTP/Socket 设施；集合交叉，且没有计入 helper 间接启动，不能相加当作不同测试数量。CLI 编译已按进程缓存一次，并非每个文件重复编译；第四轮测量该编译约 0.2 秒，决定保留而不要求所有 CLI 测试先构建 HAPI。

例如 [artifact 测试](../../../../test/artifacts.test.ts)直接导入 HAPI Store、ArtifactService、路由和认证中间件，启动服务并执行编译 CLI；[卸载测试](../../../../test/uninstall.test.ts)建立包目录并执行自卸载。这些是有价值的组件/系统回归，但不能视为无外部准备的函数级测试。[MCP 安装测试](../../../../test/mcp-install.test.ts)两项还依赖本机 Codex，缺少时跳过；CI 因而必须安装 Codex。

### “冒烟”已经承担完整集成回归

无模型集成各 case 拥有独立环境、停机与证据；其中包含大量异常、恢复和边界场景，语义已超出少量关键链路的冒烟：

- hub-resources 同时测试登记、共享、禁用、轮换、重启、工具发现异常，最后附带 MCP 配置及协议检查，并等待真实 45 秒机器在线状态过期。其 MCP 检查与资源治理职责相交；普通安装也有 MCP catalog 检查，另可通过显式开关运行同一安装 helper。
- artifacts、inputs、outputs 三个入口均使用 72 MiB 文件；artifacts 还验证超过普通 10 秒请求期限的持续上传。这些保障涉及不同传输路径，尚不能判成完全重复，但大尺寸应对应明确边界而不是跟随每条业务流程。
- workspace-preparation 一条场景同时建立 103 个 Git/LFS 文件、重启 Hub、测试离线、ignored-file 保留、重用与释放。它是完整恢复集成，失败可能发生在很长的准备/执行链中。
- 原生入口有六条模型主链、四个控制/重建 case，expanded 可扩至十二主链组合并附带四个 case。生产者/消费者、候选指纹和显式续验有真实用途，不能按一般临时脚本删除；真实模型已与普通 CI 分离。

这里可以确认职责混合与高成本场景存在；是否删除具体断言，还需要按独立故障映射核对。真实 HAPI、安装布局、信号转发、宿主 MCP 调用与模型历史无法由模拟 HTTP 直接替代。

### CI 触发范围是已有实证的浪费点

只读核对 [Development checks 38535122829](https://github.com/iTgo-lyq/runweft/actions/runs/38535122829)：源码为 `76e53ef`，改动仅 AGENTS 和本 Change 文档。整个 run 08:26:32–08:35:24 UTC，8 分 52 秒；所有 job 成功。使用 REST jobs 的独立时间字段得到：

| 项目 | 本次时间 | 解释 |
| --- | ---: | --- |
| core job | 528 秒 | 含安装、检查、构建、集成 |
| 根测试 | 80.63 秒 | 日志显示 264 pass、0 fail、43 files；不是本轮本机重测 |
| typecheck + 根测试 step | 87 秒 | 与上一行包含关系，不相加 |
| 选中集成 step | 355 秒 | access、storage、web、service 顺序执行 |
| prototype job | 43 秒 | Chromium 准备 21 秒、构建及测试 15 秒；与 core 并行 |

日志明确给出 `CI_BASE=0000000000000000000000000000000000000000`，因此 [ci-scope](../../../../scripts/ci-scope.mjs) 按 unknown 选择全部四组。这是新分支首次 push 的实际行为，不代表每次文档更新都跑全部集成。

但即使有正常 diff、集成选择为空，[开发工作流](../../../../.github/workflows/checks.yml)仍无条件安装根/HAPI 依赖与 Codex、跑类型/根/Node/actionlint 检查；独立 prototype job 也不按路径筛选。范围判定发生在这些准备与检查之后。只读调用 `integrationGroups` 也确认：文档与 AGENTS 返回空组；report-evidence、npm-read 和一般 hub/resources 变动均选择四组。当前主要是组级保守选择，未对应各职责的最小执行范围。

### 已有改善与剩余问题

2026-10-03 已收敛原生组合、复用生产者成果并共享一次 CLI 编译；2026-10-13 又移除重复的原始目录服务验收及空等，保留 tarball/symlink 和 npm launcher 两种实际部署形态，并将公共集成分片。[同候选记录](../../archive/2026-10-13-release-validation-efficiency/execution.md)显示 access 顺序约 140.7 秒、storage 约 207.7 秒，两条包路径并行约 38.1 秒；这是历史样本，不是当前基线。不能再次建议删除已经删掉的第三次服务验证，也不能把并行当成工作总量减少。

剩余问题有四层：测试层级没有独立执行入口；重集成聚合了较多业务回归与专项边界；CI 范围选择及新分支基线处理偏粗；现场所有权与回收规则不一致。`.dev-smoke` 的积累是最后一层的直接结果，前面几层决定它持续生成的规模。


## 当前脚本去向清单（2026-10-16 收敛）

以下为设计去向，不是已执行删除。名称相对 `scripts/`；一行合并列出同职责成员，并覆盖全部 87 个文件。删除长入口不等于删除其独立产品保障；替代覆盖尚未落实时不得将其记为完成。最终职责与取舍见 [Technical](technical.md)。

### 30 个 smoke 入口

| 当前成员 | 决策与职责去向 |
| --- | --- |
| `smoke-hub-access.ts`、`smoke-hub-realtime.ts`、`smoke-hub-resources.ts`、`smoke-hub-configuration.ts` | 合并为 Hub 接线套件；资源/权限异常组合下沉核心；MCP 配置移出资源长链 |
| `smoke-artifacts.ts`、`smoke-inputs.ts`、`smoke-outputs.ts`、`smoke-artifact-prune.ts`、`smoke-result-export.ts` | 合并文件/成果领域套件；fetch/tasks 仍有明确语义；大文件与持续传输按独立边界保留，不复制整条业务链 |
| `smoke-repository-export.ts`、`smoke-repository-import.ts`、`smoke-workspace-preparation.ts` | 工作区/Git 套件；小数据负责主路径，大量文件/LFS/恢复分开验证 |
| `smoke-hub-delegation-native.ts`、`smoke-hub-delegation-preparation.ts` | Hub 委派到真实 HAPI 的集成；规则排列下沉核心，不因名字含 native 就归付费模型层 |
| `smoke-hub.ts`、`smoke-hub-connect.ts`、`smoke-hub-console.ts` | 合并 web 套件；固定当前格式样本与真实历史验收分开 |
| `smoke-integration.ts` | 删除“脚本启动脚本”的旧编排；用测试框架的 suite/用例选择与最薄准备入口替代 |
| `smoke-install.mjs`、`smoke-uninstall.mjs`、`smoke-service.mjs` | 安装验收中的安装/卸载/服务 case；共用候选与部署函数，保留两种部署形态的独立边界 |
| `smoke-native.ts`、`smoke-collaboration.ts`、`smoke-shared-package.ts`、`smoke-worktree-package.mjs`、`smoke-remote-package.ts`、`smoke-execution.ts` | 合并 native case 生命周期；删除交接文件协议、stdout 抓路径、多命令清理所有权与 expanded 笛卡尔全排列 |
| `smoke-task-controls.ts`、`smoke-reconstruction.ts` | 保留两种 runtime 的真实控制/重建保障，归 native 定向 case；非模型状态分支下沉 |
| `smoke-hapi-session-and-shutdown.ts` | 无模型的随包 HAPI 停机/断连/认证/重启保障归 integration，Claude 长路径两轮延续归 native；删除混合入口，不要求先改 fork/pin |

### 19 个其他顶层脚本

| 当前成员 | 决策与职责去向 |
| --- | --- |
| `build.ts`、`build-hapi.ts`、`hapi-source.ts`、`package.ts`、`platforms.ts` | 保留平铺 scripts 中的构建/候选职责；共享实际公共逻辑，保留独立操作 |
| `npm-launcher.cjs` | 移至 src/npm-launcher.cjs；包内 bin/runweft.cjs 不变，安装验收覆盖行为 |
| `verify-packages.mjs` | 包内容验证归安装验收，共用构建的候选读取；删除旧独立转发入口 |
| `npm-publish.mjs`、`npm-read.mjs`、`npm-release.mjs`、`release-finish.mjs`、`release-space.mjs` | 保留发布、读取、恢复、收尾与资源保障的实际语义，留在平铺 scripts；聚合共同判定，避免万能命令 |
| `check-docs.mjs`、`check-workflow.mjs`、`check-runweft-kit.mjs`、`check-npm-trust.mjs`、`ci-scope.mjs` | 保留明确检查职责，留在平铺 scripts；scope 在依赖准备前执行 |
| `report-evidence.mjs` | 删除递归历史目录扫描；当前报告的显式列表汇总留在平铺 scripts，由 CI 直接传入 |
| `sync-runweft-kit.sh` | 保留独立 Kit 分发流程，留在平铺 scripts；与官网 DOM 验证解绑 |

### 32 个 fixture 文件

| 当前成员 | 决策与职责去向 |
| --- | --- |
| `smoke-lifecycle.ts`、`smoke-deadline.ts` | 保留必要的关闭/等待错误语义，就近保留普通辅助函数，确实跨套件复用再提取；不建设资源管理框架 |
| `smoke-preflight.ts`、`installed-binaries.mjs`、`installed-binaries.d.mts` | 配对程序/候选读取由固定测试和 dev:env 共用普通函数；浏览器检查只由 web 消费；preflight 不算环境启动或业务通过 |
| `release-inputs.mjs`、`release-inputs.d.mts`、`hapi-source-archive.mjs` | 生产构建/发行共享契约，移出测试 fixtures 到平铺 scripts；保持来源和候选校验 |
| `integration-cases.ts` | 删除旧脚本清单及为旧 shard 结构服务的断言；suite 选择使用现有测试框架，CI 范围只选择套件 |
| `collaboration-package.mjs`、`collaboration-package.d.mts` | 删除跨入口交接格式/解析；有效的候选一致性与当前记录验证进入 native 生命周期/所属契约测试；关闭后凭据会删除，旧格式不保证独立重跑后半段 |
| `hub-console-smoke.ts`、`hub-console-tasks.ts`、`hub-console-history.ts` | web 就近辅助，合并重复启动和数据准备；真实历史页面进入 N1/N2 的现场生命周期，在最终清理前消费真实数据库/历史；普通 UI 使用当前样本 |
| `model-homes.ts`、`codex-model.ts`、`native-host.ts`、`native-preflight.ts` | native 就近辅助，保留隔离配置和宿主关闭诊断；移除无关浏览器准备及重复跨命令检查 |
| `mcp-cut.mjs`、`mcp-probe.mjs`、`claude-observer.mjs`、`codex-catalog.ts` | 保留证明真实宿主调用/断线/发现所需的最小探针，归 native；不扩展为新的执行适配器 |
| `mcp-install.mjs`、`mcp-install.d.mts`、`service-version-probe.mjs` | install 就近辅助，覆盖原生配置与安装服务诊断 |
| `mcp-protocol.ts` | CLI stdio/auth 接线归 integration；协议规则归 core；不绑定资源治理长链 |
| `native-file-smoke.ts`、`native-user-smoke.ts`、`task-results-probe.ts` | 无模型业务断言归 integration；其中隔离 Hub、身份/Runner 与关闭的通用准备拆出供固定测试和 dev:env 直接调用；安装层只保留部署边界 |
| `task-smoke.ts`、`fixture-round.ts`、`non-git-smoke-project.ts` | 实际复用的任务/当前记录/非 Git 场景准备就近保留，合并重复现场创建；不保留旧 .dev-smoke 路径假设 |

`.d.mts` 是跨 Bun/Node 类型边界的一部分，不单独按数量删除；是否仍需声明由最终模块导出决定，不为少几个文件改写整个工程语言体系。

### 6 个工程测试与其他归属

`npm-release.test.mjs`、`npm-publish.test.mjs`、`release-space.test.mjs`、`release-finish.test.mjs`、`skill-sync.test.mjs`、`ci-scope.test.mjs` 继续留在现有 scripts/tests，不为分类搬成多个子目录。保留发布副作用、候选、失败/恢复和范围选择等可出错分支，移除只复刻旧路径、目录数量或旧报告格式的断言。根测试中测试辅助设施的回归随真实所属设施归位，不为旧框架保留兼容。

官网/原型验证留在各自目录，SpecTrail 工具及其测试留在 Skill，HAPI 内部测试留在 fork。根 package 命令与工作流统一调用其明确入口，不通过根 test 自动递归发现所有子项目。

## 根测试及辅助文件的去向

下表覆盖当前 43 个测试文件、12 个辅助文件；是按保障划分的去向，不要求按整文件机械搬移。特别是文件名含 native 不代表调用真实模型，需看实际 fixture。core 可保留真实本机 HTTP、SQLite、小型子进程及必要 Git 操作；大量文件/恢复长链才进入专项集成。

| 当前测试成员 | 去向 |
| --- | --- |
| `config.test.ts`、`execution.test.ts`、`proxy.test.ts` | core：配置、执行协议与错误语义、本机网关组件；共享 HAPI 类型不带入运行环境 |
| `hub-access.test.ts`、`hub-agent-resolution.test.ts`、`hub-agents.test.ts`、`hub-resources.test.ts`、`hub-resource-dispatch.test.ts`、`hub-sockets.test.ts`、`hub.test.ts` | core：权限/治理/原子性及本机协议组件；真实 HAPI 接线另由 integration 承担 |
| `hub-delegation.test.ts`、`hub-delegation-native.test.ts`、`hub-console.test.ts` | core 保留替身协议、任务/权限和页面接口契约；这些文件并不因名字含 native/console 就进入模型/浏览器层 |
| `hub-repositories.test.ts`、`remote.test.ts`、`remote-tasks.test.ts`、`task-results.test.ts`、`task-workspaces.test.ts` | 规则、状态和小型真实 Git 在 core；实际传输/大量文件/工作区恢复与现有 smoke 合入 integration，删重复组合 |
| `task-records.test.ts`、`task-rounds.test.ts`、`tasks.test.ts`、`tasks-mcp.test.ts`、`tasks-overview.test.ts` | core 的当前格式、轮次、MCP、概览和幂等保障；不将有效协议替身全部换为重型原生调用 |
| `artifact-mcp.test.ts`、`artifacts.test.ts`、`task-files.test.ts`、`task-outputs.test.ts` | 实际 HAPI Store/ArtifactService/路由及 CLI 接线归 integration/files，能独立证明的规则留 core；与领域 smoke 合并准备和重复断言 |
| `cli.test.ts`、`hub-connect.test.ts`、`hub-consumers.test.ts`、`hub-resource-cli.test.ts`、`mcp.test.ts`、`service-commands.test.ts`、`state.test.ts` | 编译 CLI 调用进 integration，配置/状态/协议规则留 core；保留一次共享 CLI 编译，实际 HAPI 接线才要求显式匹配二进制 |
| `mcp-install.test.ts`、`uninstall.test.ts` | 配置编辑/拒绝/原子回滚规则留 core；真实宿主 catalog 和安装包/自卸载行为合入 acceptance/install，缺所选宿主不再 skip |
| `release-inputs.test.ts` | 候选冻结/源码干净判定归 scripts/tests，复用 Node 工具测试入口，不建新的测试体系 |
| `website-build.test.ts` | 归 website 自身验证，根 core 不再替官网启动构建 |
| `acceptance-fixtures.test.ts`、`fixture-cleanup.test.ts`、`smoke-deadline.test.ts`、`smoke-lifecycle.test.ts` | 保留无模型的候选拒绝、关闭竞态、超时和失败清理等行为回归在 core；真实 HAPI 启动断言进 integration，删除旧交接格式/旧 smoke 入口断言 |
| `integration-cases.test.ts` | 删除随旧清单/shard runner 消失的实现镜像；实际超时/清理保障由仍存在的行为测试承担 |

| 当前辅助成员 | 去向 |
| --- | --- |
| `compiled-cli.ts`、`preload.ts` | 随 CLI 消费者移到 integration 并保留；preload 仅由集成入口启用，core 不加载编译生命周期 |
| `helpers.ts`、`fixture-cleanup.ts` | 收敛为小型辅助，先补齐每个根的所有者与关闭/删除，再移除固定 .dev-smoke 根；不新增 support 目录 |
| `hub-resources-fixture.ts`、`hub-delegation-fixture.ts`、`native-fixture.ts`、`task-native-fixture.ts`、`hub-workspace-fixture.ts`、`remote-fixture.ts`、`remote-native-fixture.ts`、`workspaces-fixture.ts` | 随实际使用的 core/integration 文件就近保留普通组件替身和数据准备；共用部分按真实消费者提取，删除长链重复的环境搭建，不造全局 fixture 注册中心 |

## 2026-10-16 定向复核新增事实

本轮重新读取源码，并复算文件数/行数，与上面的 87 个 scripts 文件、43 个根测试及 12 个辅助统计一致；没有执行模型或产品回归。三轮方案修订详见 [Review](review.md)。

- [compiled-cli](../../../../test/compiled-cli.ts) 已共享一次编译，而 [开发工作流](../../../../.github/workflows/checks.yml) 后续还跑 build；两阶段存在重复，但第四轮测量证明编译仅约 0.2 秒，收益不足以抵偿强制引入 HAPI 构建；因此保留轻量编译辅助。根 [tsconfig](../../../../tsconfig.json) 已是单项目，隔离运行成本不要求再拆多个项目。
- [原生历史页面](../../../../scripts/fixtures/hub-console-history.ts) 消费真实数据库、历史与身份现场；[shared 消费者](../../../../scripts/smoke-shared-package.ts) 先验历史页面再重启 Runner。新设计保持这些实质边界，不能把一个结果摘要当作完整可重建现场。
- [HAPI 专项](../../../../scripts/smoke-hapi-session-and-shutdown.ts) 同时包含无模型停机/认证和真实 Claude 长路径两轮会话延续；[execution](../../../../scripts/smoke-execution.ts) 还有 Codex 共享宿主兄弟会话停止隔离。它们不能整包认作重复。
- [官网恢复](../../../../website/recover.mjs) 仍按 `.dev-smoke/website-pages` 的固定路径读取日志报告；[报告汇总](../../../../scripts/report-evidence.mjs) 递归扫描目录。因此移除物理目录依赖须联动生产和消费的工作目录；第四轮采纳更小方案，保留现行日志信封与 path 协议标识，只显式传入报告文件。
- [打包](../../../../scripts/package.ts) 从 scripts 复制 npm launcher 到包内 `bin/runweft.cjs`；[候选来源](../../../../scripts/fixtures/release-inputs.mjs) 含这个旧源路径。移到 src 只改变源码归属，但两个当前消费者要同步处理。

## 环节与前置命令补充调查

用户指出仅分目录仍无法回答“何时运行哪个入口，哪些只负责启动”。复核现有命令和函数后，对技术方案作如下补充；`dev:env` 是拟新增入口，不是当前可执行命令，也不属于上述 87 个现有文件。

| 当前事实 | 设计含义 |
| --- | --- |
| [package.json](../../../../package.json) 的 dev 只是 `bun src/cli.ts`；[服务命令](../../../../src/service-commands.ts) 已有 start/serve/status/stop 与 runner start/stop | 产品启动能力已经存在；开发 dev 命令本身不创建隔离验收环境。新入口仅包装隔离准备和显式 start/stop，不另写服务/runtime；不把产品后台进程当作前台子进程 |
| [使用说明](../../../usage.md) 明确首次 start 只启动 Hub，不自动建立身份/Runner；停止 Runner 也不等于停止任务 | dev:env 默认只起 Hub，--runner 才额外准备专用身份/连接；显式 stop 先核对会话/宿主，无活跃且归属明确才回收，不能推断外部任务所有权 |
| [native-user-smoke](../../../../scripts/fixtures/native-user-smoke.ts) 已有独立 Hub、身份、机器、Runner 与 close；[task-smoke](../../../../scripts/fixtures/task-smoke.ts) 进一步绑定模型配置、Agent 与会话关闭 | 拆分通用准备与业务场景，复用前者到薄环境入口；不把 task/native 整段测试直接包装成 setup 命令 |
| [model-homes](../../../../scripts/fixtures/model-homes.ts) 会读取来源配置，部分上层还修改副本中的 MCP 列表 | 自由启动默认使用空隔离原生目录，不能无条件运行当前模型 fixture；固定 native 的显式模型准备留在该验收路径 |
| [发行操作](../../../release.md) 当前通过 KEEP_INSTALL 保留安装现场，后续拿 installedBinary 接着验 | 目标改为测试与环境准备各自独立：test:install 给固定结果，dev:env start --candidate 给可操作环境；共用安装函数，不复用测试现场 |
| [官网说明](../../../../website/README.md) 已有 build/serve 与 test/verify 的分离 | 保留此现成区分；serve 是预览前置，verify 是固定检查，不新增根包装器 |

固定回归、交互验收与发行工作流的完整入口表见 [技术方案](technical.md#在什么环节执行什么)。后续实现时更新当前操作文档和 package 入口；本轮不把拟定参数写成已实现能力。


## 2026-10-17 第四轮复核补充

用户提供评审提交 151d5cc。主 Agent 重新读取相关源码与固定 Bun 帮助，并使用 GitHub API 核对 fork；本轮没有再次运行 264 项根测试、integration 或模型。第四轮的 71.44 秒根测试、0.2 秒 CLI 编译和 CI 时长均归属 Claude 的实测记录，不能算作本 Agent 重测。

- API `repos/iTgo-lyq/hapi/actions/runs?per_page=1` 返回 total_count=0；pin `8f774b9413fd483bc163cc06425d7646f10a7c92` 的 check-runs 也为 0。不能把 fork 目录里的测试视为正在执行的门禁。
- pin 的 CLI repositories/artifacts/workspaces manager 测试实际使用 Vitest；repositories 有真实 Git bundle/fsck、workspaces 有真实 LFS。其 globalSetup 还启动源码 Hub并使用固定临时配置名，故需独立 job/临时根与源码依赖，不能说成只运行纯函数或直接用 Bun 原生 runner 执行。测试文件及其内部产物仍归 HAPI，根仓不复制/改写。
- services.start 使用 detached/unref；services.stop 会等待托管服务关闭，但返回 sessionsPreserved，不能证明原生会话退出。runner start 同样后台化。dev:env 改显式目录句柄与 stop，不承诺终端关闭自动回收，不替外部操作猜测任务所有权。
- Bun 1.4.2 本机帮助确认 --shard、--timings/--update-timings、--isolate、--parallel、--no-orphans；--timings 是耗时文件输入，配合 --update-timings 才写测量。无计划增加自制分片调度。
- cli-install 当前实际安装 Bun；Node-only 是重构验收目标而非已有 CI 事实。9 个 compiledCli 消费者不要求真实 HAPI 二进制，但其中有文件使用内嵌 HAPI Store/路由，不能一概说其所有边界都是假 HAPI。
- 当前发布 workflow 从 tag 重建并不读取 native 证据。本方案明确选择冻结源码/构建输入绑定、由发行 Agent 本地核对；公开包的摘要与安装/集成由 CI 自己核对。没有声称形成 CI 强制的公开包模型门禁。
- 已核对 SSE 撤销/回放/RPC 改路由、传输中撤销、日志/数据库/WAL 秘密扫描、浏览器 WebCrypto 与实际版本发现的独有检查；逐项归属见 Technical，不以一般权限回归替代。
- 现行日志 path 同时是官网恢复协议标识，因此沿用其单一格式；物理工作目录与标识分离。CI 工具/配置、release-source、候选/缓存、空间采样、官网与卸载报告、Kit 导出的所有者/位置见 Technical，不再统称测试现场。
- 当前 modelHomes 比较认证文件 hash、native 指纹包括 Claude 状态，closeSmoke 没有共享关闭结果；这些均是要改的行为。目录迁移前补全安装 prefix/cache/services、包解包、service 与无 cleanups fixture 的根所有权。机器过期无可注入时钟，保留一次真实等待；关闭宽限时间仅在工程 helper 中参数化。

## 2026-10-17 规模与手册复评

用户要求重新判断代码是否缩减、架构是否清晰及能否形成完整操作手册。本次从 git 跟踪文件读取行数并复核现有调用；只统计与评估，没有实施或重跑产品测试。源码仍与前述基线一致。

| 统计对象 | 文件数 | 总行数 | 非空行数 |
| --- | ---: | ---: | ---: |
| 根 test | 55 | 6985 | 6668 |
| scripts（含 fixtures 与工具测试） | 87 | 9225 | 8953 |
| 两者合计 | 142 | 16210 | 15621 |
| 根 .github/workflows | 5 | 657 | 626 |

口径为跟踪的 TS/JS/声明文件、shell 与 YAML；不含依赖、生成物、HAPI、文档及其他子工程。非空行仍含注释，也不是语句数；当前多语句同行的写法尤其不适合据行数推断复杂度。最终新增或迁出的同职责文件须加入对比，不能因换目录减少分母。

- 旧 smoke-integration 与 integration-cases 共 97 行，配套 integration-cases.test 65 行；新调用入口和分片缺项/失败保障仍有代码成本，162 行并非净删除承诺。
- native 的主入口、collaboration、三个后继入口及交接模块/类型共 891 行。交接格式可删，但其中真实重启、不重放、成果和历史断言要保留，不能将整个集合计作节省。
- install/uninstall/service/verify-packages 共 654 行，同样主要是合并准备与明确保障归属；两种布局和卸载行为不能按重复入口整段删除。
- report-evidence 仅 18 行，launcher 36 行；前者改显式输入，后者纯搬移，都不是显著代码规模收益来源。expanded 的代码是少量组合生成，删除主要降低运行范围与解释成本，代码减少有限。
- 因此净缩减依赖重复准备和真正重复回归的消除，不能由“删除 30 个 smoke 文件名”推算。dev:env、scope、原生报告核对、关闭及 HAPI 门禁会抵消部分收益；现有证据只支持小幅净减的预期，不支持确定比例或大幅减少的承诺。

现行操作散在 AGENTS、docs/release.md、website/README 和原型/Kit 说明；技术方案已经覆盖大部分路径，但设计稿尚不能作为已验证操作手册。目标采用 docs/testing.md 作为总入口，专用发布/官网操作继续引用原文，避免另一套重复流程。具体结构与按手册实际执行的验证要求已进入 Technical 和 Requirement；本轮不创建冒充已实现命令的现行手册。
