# 测试与工程辅助流程调查

## 基线与任务授权

用户已授权启动独立重构任务，与 traex（`openrouter-4o` / `xhigh`）多轮共同评估，并明确不保留旧测试数据、格式与逻辑的兼容层。前置清理 Change 已归档合入 main；这是先后工作安排，不声明代码交付依赖。

当前基线 `94f36a25776c59a87fb3d83cf4448d28411c66ec`。下述统计与 CI 实证来自前期 `76e53ef` 调查，两者产品/测试/工作流代码相同，只有清理文档和状态变化。本轮尚未执行新的产品或模型验收。

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

43 个根测试文件中，9 个直接调用共享 `compiledCli()`，18 个直接出现子进程调用，12 个直接创建 HTTP/Socket 设施；集合交叉，且没有计入 helper 间接启动，不能相加当作不同测试数量。CLI 编译已按进程缓存一次，并非每个文件重复编译。

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


## 当前脚本去向清单

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
| `smoke-hapi-session-and-shutdown.ts` | 拆分 Runweft 接线与 HAPI 内部保障；前者归 integration/native，后者归独立 fork；不在覆盖未落实时删除唯一保障 |

### 19 个其他顶层脚本

| 当前成员 | 决策与职责去向 |
| --- | --- |
| `build.ts`、`build-hapi.ts`、`hapi-source.ts`、`package.ts`、`platforms.ts` | 保留构建/候选职责，归 scripts/build；共享实际公共逻辑，保留独立操作 |
| `npm-launcher.cjs` | 随包运行的交付资产，归 packaging；安装验收覆盖行为 |
| `verify-packages.mjs` | 包内容验证归安装验收，共用构建的候选读取；删除旧独立转发入口 |
| `npm-publish.mjs`、`npm-read.mjs`、`npm-release.mjs`、`release-finish.mjs`、`release-space.mjs` | 保留发布、读取、恢复、收尾与资源保障的实际语义，归 scripts/release；聚合共同判定，避免万能命令 |
| `check-docs.mjs`、`check-workflow.mjs`、`check-runweft-kit.mjs`、`check-npm-trust.mjs`、`ci-scope.mjs` | 保留明确检查职责，归 scripts/check；scope 在依赖准备前执行 |
| `report-evidence.mjs` | 删除递归历史目录扫描；当前报告的显式列表汇总归 scripts/release，由 CI 直接传入 |
| `sync-runweft-kit.sh` | 保留独立 Kit 分发流程，归 scripts/release；与官网 DOM 验证解绑 |

### 32 个 fixture 文件

| 当前成员 | 决策与职责去向 |
| --- | --- |
| `smoke-lifecycle.ts`、`smoke-deadline.ts` | 保留必要的关闭/等待错误语义，收敛进少量跨套件 support；不建设资源管理框架 |
| `smoke-preflight.ts`、`installed-binaries.mjs`、`installed-binaries.d.mts` | 按构建与候选输入分离；构建一致性归 build，安装位置探测归 install，浏览器检查只由 web 消费 |
| `release-inputs.mjs`、`release-inputs.d.mts`、`hapi-source-archive.mjs` | 生产构建/发行共享契约，移出测试 fixtures 归 scripts/build；保持来源和候选校验 |
| `integration-cases.ts` | 删除旧脚本清单及为旧 shard 结构服务的断言；suite 选择使用现有测试框架，CI 范围只选择套件 |
| `collaboration-package.mjs`、`collaboration-package.d.mts` | 删除跨入口交接格式/解析；有效的候选一致性与当前记录验证进入 native 生命周期/所属契约测试 |
| `hub-console-smoke.ts`、`hub-console-tasks.ts`、`hub-console-history.ts` | web 就近辅助，合并重复启动和数据准备；真实历史保持明确证据输入 |
| `model-homes.ts`、`codex-model.ts`、`native-host.ts`、`native-preflight.ts` | native 就近辅助，保留隔离配置和宿主关闭诊断；移除无关浏览器准备及重复跨命令检查 |
| `mcp-cut.mjs`、`mcp-probe.mjs`、`claude-observer.mjs`、`codex-catalog.ts` | 保留证明真实宿主调用/断线/发现所需的最小探针，归 native；不扩展为新的执行适配器 |
| `mcp-install.mjs`、`mcp-install.d.mts`、`service-version-probe.mjs` | install 就近辅助，覆盖原生配置与安装服务诊断 |
| `mcp-protocol.ts` | CLI stdio/auth 接线归 integration；协议规则归 core；不绑定资源治理长链 |
| `native-file-smoke.ts`、`native-user-smoke.ts`、`task-results-probe.ts` | 名称虽含 native，实际无模型领域检查合入相应 integration；安装层只保留部署边界 |
| `task-smoke.ts`、`fixture-round.ts`、`non-git-smoke-project.ts` | 实际复用的任务/当前记录/非 Git 场景准备就近保留，合并重复现场创建；不保留旧 .dev-smoke 路径假设 |

`.d.mts` 是跨 Bun/Node 类型边界的一部分，不单独按数量删除；是否仍需声明由最终模块导出决定，不为少几个文件改写整个工程语言体系。

### 6 个工程测试与其他归属

`npm-release.test.mjs`、`npm-publish.test.mjs`、`release-space.test.mjs`、`release-finish.test.mjs`、`skill-sync.test.mjs` 与被测 release 模块相邻；`ci-scope.test.mjs` 与 check 模块相邻。保留发布副作用、候选、失败/恢复和范围选择等可出错分支，移除只复刻旧路径、目录数量或旧报告格式的断言。根测试中测试辅助设施的回归随真实所属设施归位，不为旧框架保留兼容。

官网/原型验证留在各自目录，SpecTrail 工具及其测试留在 Skill，HAPI 内部测试留在 fork。根 package 命令与工作流统一调用其明确入口，不通过根 test 自动递归发现所有子项目。
