# `.dev-smoke` 调查与一次性清理记录

## 调查基线与证据级别

调查与清理日期为 2026-10-14，仓库基线 `d298782df18abfcc58ff4aa2c426320d5ab2d950`。结论来自本地脚本、文件元数据、Git 状态与消费者核对；没有把搜索命中次数当作运行依赖数量。

iclaude 使用已配置的自定义 API 完成只读独立评审，返回模型 `claude-opus-5-5`，进程退出 0、`is_error=false`、77 turns、0 permission denials，耗时 651238 ms。此处仅保存复核后的结论，不保存凭据、配置内容或完整评审会话。独立评审针对现状与方案，不是后续实现的验收。

主 Agent 采纳了成功回收、独立目录准备、公开 Kit 独立发布和官网恢复边界等建议，同时保留评审最初未充分区分的唯一草稿、未迁移检查及来源未知元数据。另纠正 `RUNWEFT_SMOKE_ROOT` 的直接读取方数量为四个：install、service、hub-configuration、hub-resources；该变量尚不是所有入口共用的契约。

## 已执行的安全清理

用户明确要求“先把明确删了没影响的东西清理掉”，随后整理方案。2026-10-14 08:20:58 UTC 已按核实清单删除 35 个顶层项，其中 17 个目录、18 个日志文件，涉及 4840 个普通文件和 24 个符号链接。删除使用逐项允许清单，符号链接只删除链接本身，未遍历其外部目标。

清理前占用 934125568 bytes，清理后 20480 bytes，释放 934105088 bytes，约 890.83 MiB。该数字是文件系统分配量，不是新实现的性能指标。AGENTS 中“临时文件放 `.dev-smoke/`，不提交”的提示已删除，原搜索排除规则保留。

执行前再次核实：没有 Git 跟踪文件；顶层清单仍为原 38 项；待删文件自清单生成后无修改；可见进程 cwd/exe/打开文件没有指向该目录，当前用户进程均可检查。少数其他用户进程的 fd 受权限限制，未将此观察描述为系统级占用证明。本次删除操作未读取三项保留内容，清理前后 inode、类型、大小和修改时间一致。

### 删除依据

| 分组 | 依据 |
| --- | --- |
| 历史安装与服务现场 | 1.1.7 安装成功，配套服务七项成功、无停机错误；CLI 已卸载，未作为 KEEP_INSTALL 保留安装。约 829 MiB 来自服务副本和 npm 缓存 |
| 合码检查快照 | 无提交、无 stash；705 个普通文件与索引一致，内容对应 merge-report 指定树 `0638d13ce32c249ab7190714ad78d843e2c8c35b`；三份仅由对象库保留的文档 blob 是生成的冲突标记，并非手工修改 |
| Kit 分发 checkout | 工作区干净、无 stash；本地 HEAD、origin/main 与实时远端查询均为 `199d53004b8446463f03715e7f7460a5177ae12f`，无本地独有交付 |
| 旧版发布副本 | 1.1.5 汇总和一次性分析脚本；当前正式发布恢复读取 Actions 日志，不消费这些本地副本 |
| Kit 安装副本、缓存及成功网页证据 | 均为已完成的隔离验收产物；需要迁移的是临时脚本的检查能力，不是安装输出 |
| 已知失败网页现场 | 导航检查误判公开 Kit 链接；修复及定向复验已记录在 [Kit 重命名执行记录](../../archive/2026-10-14-runweft-kit-rename/execution.md)，不是未诊断现场 |
| 历史日志与空 tests 目录 | 无现行入口按这些历史日志文件名消费；测试应自行创建 fixture |

本次删除的相对路径如下，均位于 `.dev-smoke/` 下；这不是可重复执行的通配清理规则。

```text
branch-conflict-review-1ffwu_w5/
hub-console-jaumFL/
install-cfpfLt/
npm-release/
release-1.1.5/
release-audit/
runweft-kit-candidate-install/
runweft-kit-distribution/
runweft-kit-dom-install/
runweft-kit-public-claude-code/
runweft-kit-public-codex/
runweft-kit-uninstall/
runweft-skill-install/
tests/
website-Dh1IOp/
website-ZaXKGQ/
website-oY1Usk/
main-ci-38344006472.log
main-ci-full-38344006472.log
release-prep-console-baseline.log
runweft-kit-browser.log
runweft-kit-bun-test.log
runweft-kit-close.log
runweft-kit-docs.log
runweft-kit-first-sync.log
runweft-kit-install-smoke.log
runweft-kit-main-checks-watch.log
runweft-kit-main-website-watch.log
runweft-kit-node-test.log
runweft-kit-package.log
runweft-kit-repeat-sync.log
runweft-kit-uninstall-smoke.log
runweft-main-checks-watch.log
runweft-main-website-watch.log
runweft-skill-sync-main.log
```

### 保留项与后续去向

| 相对路径 | 保留原因 | 处理条件 |
| --- | --- | --- |
| `.dev-smoke/verify-kit-install.py` | 两宿主安装和旧名缺失检查尚未完整进入正式入口 | 必要检查迁入现有验收并通过后删除；不迁入公开 main 与任意源码 HEAD 的字节相等门禁 |
| `.dev-smoke/skills-sh-index-cleanup/issue.md` | 唯一索引纠错草稿，未确认已提交 | 保留；后续关联正式事项后再迁移，不自动发送 |
| `.dev-smoke/runweft-kit-deploy-key.json` | 72 bytes，来源及可重建性未知，未读取内容 | 保留；确认用途及安全保管位置后单独处理，不迁入源码 |

原生、reconstruction、collaboration、worktree-mcp、remote-mcp、website-pages 和 release-source 等恢复现场在清理时不存在；如果未来出现，不能依据本次历史清理授权直接删除。

## 仍可能调用的正式依赖

| 入口/材料 | 已确认事实 | 处理判断 |
| --- | --- | --- |
| [npm 发布测试](../../../../scripts/tests/npm-release.test.mjs) | 四处直接在 `.dev-smoke` 下 mkdtemp，未创建父目录；先前隔离 cwd 定向复现 ENOENT，创建空父目录后同一用例通过 | 消除测试顺序依赖 |
| [完整卸载验收](../../../../scripts/smoke-uninstall.mjs) | 只准备输出父目录，自定义输出可使工作根缺失；finally 在停机无错误时删除现场，不要求断言成功 | 分别准备目录，并修正失败留存 |
| [安装验收](../../../../scripts/smoke-install.mjs)、[服务验收](../../../../scripts/smoke-service.mjs)、[包验收](../../../../scripts/verify-packages.mjs) | 现有成功路径保留安装/cache/服务或解包现场；KEEP_INSTALL 返回程序路径有后续消费者 | 按本次所有权回收，保留配套程序及嵌套证据边界 |
| [官网验收](../../../../website/verify.mjs) | 正式 DOM 路径已有 Codex 公开安装，尚无独立 Claude Code 覆盖；包内容硬编码六文件，包校验另硬编码五文件 | 扩展现有入口，统一完整文件检查；不另建脚本 |
| [Kit 结构校验](../../../../scripts/check-runweft-kit.mjs) | 已枚举普通文件并检查元数据、引用及路径边界 | 复用现有能力；遵守 [Kit 独立发布契约](../../specs/release/spec.md) |
| [证据收集](../../../../scripts/report-evidence.mjs) | 默认递归根目录，复用本地根会读到旧证据；原现场可找到七份历史报告，含旧失败 | 改为显式输入；当前 CI 使用新工作区，没有证据表明真实 CI 已发生历史串台 |
| [官网恢复](../../../../website/recover.mjs) | 从 Actions 日志按精确 `.dev-smoke/website-pages/{check,deployment,prepare}.json` 选择记录 | 保留日志路径标识和跨步骤文件消费 |
| HAPI submodule 测试 | 十个测试实际向父仓 `.dev-smoke` 写入；另有 path 哈希测试仅使用字面量 | 实际写入在独立 fork 后续整理；哈希向量保留 |
| 归档、发布恢复与原生续验记录 | 历史描述不是运行依赖；原生消费者、候选指纹和恢复记录则有正式用途 | 归档不批量替换；正式恢复边界保持 |

## 本轮验证范围

本轮完成逐项删除前复核、删除结果与保留项元数据核对；清理不修改正式脚本。`node scripts/check-docs.mjs` 通过（343 个文档、872 个本地链接、零错误），`node scripts/check-workflow.mjs` 通过（55 个 Change），`git diff --check` 通过。提交 hook 是否成功以实际提交结果为准，不把前期诊断当成实现已通过。未进行新的真实模型验收、发布、部署或完整根测试。

## 补充调查：测试分层与脚本成本

用户进一步要求核对脚本数量、单元测试与冒烟测试设计是否过重。本节基于 `76e53ef` 的代码、当前调用关系及对应已完成 CI，属于现状评估，没有执行新的完整测试或模型验收，也没有批准原四步计划或新的测试重构范围。

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

### 对原治理方案的影响

原 T1–T4 主要处理目录准备、现场回收、缺失检查和证据范围，只能治理末端症状。尤其原 T3 增加双宿主检查之前，应先明确它属于 Skill 分发验收还是应用/官网 gate，避免继续往重入口叠加职责。当前不继续按原计划实施，也不据本节直接扩大 Change 范围。

建议先确定规则/组件测试、真实 HAPI 集成、少量安装冒烟、发行矩阵和模型专项各自负责的故障及触发条件；将异常组合尽量放到能准确覆盖它的低成本层，完整链路只保留真实边界所需的代表性场景。优先修复已证实的 CI 过度触发和跨职责检查，再讨论物理目录搬迁与现场回收。保留冻结候选、权限隔离、失败诊断和原生恢复保障，不新增通用测试调度框架。以上为方向建议，尚不是已确认的新实施方案。
