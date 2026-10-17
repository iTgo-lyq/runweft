# 测试与工程辅助流程评估记录

## 证据边界

2026-10-14 的 iclaude/traex 调用未产生有效架构意见。traex 两次正式调用分别等待约 26 分钟、20 分钟后终止；登录及 `openrouter-4o` / `xhigh` 请求配置已核对，但不等于完成评审。具体调用历史保存在此前 Git 提交；不将等待计作评审轮数。

2026-10-16 用户明确取消外部协作，要求主 Agent 自行多轮评估、launcher 放 src、减少目录与抽象。R1–R12 为当时的自审与修订记录，既非外部独立意见，也非实现验收；被第四轮推翻的前提在 R13–R22 的主 Agent 处理中纠正，最终方案以当前 Technical 为准。当前实现未修改；每项“复核”指修订后的设计与源码证据核对，产品行为、性能及失败注入仍需实施后验证。

2026-10-17 用户要求不默认认可现方案重新评审，结果记为[第四轮](#第四轮重新评审)；由 Claude Code 会话依据源码、本地测量和 GitHub 记录完成，不是人工评审，也未修改实现或技术方案。

## 第一轮：职责与复杂度

### R1 不为职责标签逐层建目录

**证据/问题**：旧技术稿提出 integration 下四个领域目录、acceptance 下两目录、全局 support、scripts 下三目录和 packaging。现有工程工具仅 19 个顶层非 smoke 文件，且已有 scripts/tests；再拆目录不会减少任何运行成本。

**修订与复核**：只按三种成本分 test/core、integration、acceptance，领域使用文件名；scripts 保持平铺和现有 tests，npm launcher 放 src。辅助先就近复用，不预建通用层。对照 [全部 87 个脚本与根测试去向](research.md) 均有明确职责，没有以新目录替代实际收敛。

### R2 区分重复编译与必要的类型依赖

**证据/问题**：[compiled-cli](https://github.com/iTgo-lyq/runweft/blob/28ab4a2/test/compiled-cli.ts) 缓存单个 Promise，[preload](https://github.com/iTgo-lyq/runweft/blob/28ab4a2/test/preload.ts) 统一关闭；[checks](../../../../.github/workflows/checks.yml) 在根测试之后再 build。产品和测试引用 pin 的共享 schema/type，部分测试还导入 HAPI 实现，不能声称完全不依赖 HAPI 源码。旧稿为此拟拆多个 TS 项目，增加配置维护。

**修订与复核**：core 不编译/运行真实 HAPI 或 CLI；integration 消费已有明确构建。删除编译 helper/preload，保留单个 tsconfig 和独立全量 typecheck；后者诚实保留 HAPI 类型依赖。通过根测试导入调查区分实际 HAPI 实现与仅共享类型；不把 native 命名的替身测试全移成模型测试。

### R3 工具公共代码不归测试所有

**证据/问题**：[package](../../../../scripts/package.ts) 和发行代码使用 scripts/fixtures 下的来源/候选模块；npm launcher 被复制进发行包，属于交付运行资产。把整个 fixtures 目录移到测试会让生产发行反向依赖测试。

**修订与复核**：候选/来源模块移至平铺 scripts，由测试导入；launcher 移 src，包内路径不变。build-hapi/build/package 保留三种实际操作，不合成万能 CLI。`.d.mts` 按 Node/Bun 导出需要保留，不以文件数量裁撤。

## 第二轮：删除后的覆盖与复验反例

### R4 真实历史页面不能从摘要还原

**证据/问题**：[hub-console-history](https://github.com/iTgo-lyq/runweft/blob/28ab4a2/scripts/fixtures/hub-console-history.ts) 要求未消费的当前交接，复制真实 Runweft/HAPI 数据库并读取身份与历史。旧稿“清理后让 web 消费新格式 native 证据”会失去所需现场。

**修订与复核**：真实页面验证进入 N1/N2 的同一 case、最终清理之前；来源副本与浏览器也归此 case 所有，副本禁用 Runner。之后仍按场景重启服务及 Runner，比较 session、轮次与历史摘要验证不重放。与当前 [shared 消费者](https://github.com/iTgo-lyq/runweft/blob/28ab4a2/scripts/smoke-shared-package.ts) 的关键顺序一致；普通 web 使用固定当前样本，两者结果不混称。

### R5 删除工程交接必须承认复验粒度的变化

**证据/问题**：[collaboration-package](https://github.com/iTgo-lyq/runweft/blob/28ab4a2/scripts/fixtures/collaboration-package.mjs) 的 live/unconsumed 现场可以独立消费；彻底删除交接格式后，无法同时无成本保留“接管旧现场只跑后半段”。再造断点协议会带回所有权、凭据与清理复杂度。

**修订与复核**：明确以单个 case 为最小重跑单位，未知状态先诊断，不能自动重发。成功 case 只按完全匹配的候选/验证输入显式复用结论；不接管旧现场。后半段失败可能多消耗一次该 case 模型调用，这是接受的取舍，以 preflight 和无模型回归降低发生率。首次失败和后续复验分开保留；必需集合、缺项、冲突与指纹必须校验，不因“可续验”重新建设调度器。

### R6 两个旧大入口仍含唯一保障

**证据/问题**：[HAPI 专项](https://github.com/iTgo-lyq/runweft/blob/28ab4a2/scripts/smoke-hapi-session-and-shutdown.ts) 包含正常 SIGTERM、Hub SIGSTOP/断连、坏凭据、机器 ID 重用，以及 Claude 长非 Git 路径两轮原生会话延续。[execution](https://github.com/iTgo-lyq/runweft/blob/28ab4a2/scripts/smoke-execution.ts) 包含同一 Codex 宿主的兄弟会话停止隔离；不是全部可由普通 collaboration 替代。

**修订与复核**：无模型进程保障进 integration，长路径进入 N2，控制/兄弟会话隔离进对应 C case；重建进 R case。保留源代码中的实际信号、原生 session/记忆与文件效果断言，不依赖将来某个 fork PR 才删除旧入口。N2 的 shared 场景本来使用非 Git 工作目录，加入长绝对路径不引入新的矩阵维度。

### R7 大文件相同不等于传输路径重复

**证据/问题**：artifacts/inputs/outputs 使用相同 72 MiB 大小，实际经过不同上传/输入物化/输出发布边界；workspace 长链还验证数量、LFS、离线、恢复和释放。

**修订与复核**：小样本承接普通权限/内容断言，三个传输专项及持续上传超时保留，公共数据生成函数复用。103 文件不再跟随每个工作区主路径；数量/LFS 的边界单独验证。下沉后的替代保障需以定向故障证明，不把“测试还在”视作同等覆盖。

## 第三轮：CI、候选和失败语义

### R8 早期范围判断不能引入漏选和假绿

**证据/问题**：[ci-scope](../../../../scripts/ci-scope.mjs) 忽略 test、scripts/tests、部分工作流路径；[checks](../../../../.github/workflows/checks.yml) 在准备依赖和根测试之后才调用 scope。历史文档 CI 的零 SHA 触发全部集成，不代表所有文档提交都会如此。

**修订与复核**：scope 在任何产品环境准备前执行；PR/default-branch merge-base、有效 push before/head、未知基线保守选择。测试/helper、旧新重命名、删除、scope 自身均有选择规则；汇总检查所选项失败/取消/缺结果。保留少量 job、条件步骤和现有子工程入口，不建依赖图或一文件一 job。无模型开发兜底与固定发行门禁分开，付费模型/发布不在兜底范围。

### R9 移除目录扫描时不能丢掉当前发布恢复

**证据/问题**：[report-evidence](../../../../scripts/report-evidence.mjs) 递归扫描 `.dev-smoke`，[website/recover](../../../../website/recover.mjs) 以旧路径识别 check/deployment/prepare；[npm-release](../../../../scripts/npm-release.mjs) 和 [release-finish](../../../../scripts/release-finish.mjs) 消费带候选、run/job 等身份的实际发布记录。

**修订与复核**：显式报告列表、带类型/版本的日志信封；官网生产与恢复同步改读 kind，保持上传回执、源提交与实际远端核验。独立发行标记有意义就保留，不强推全项目统一负载。旧格式拒绝，当前部分发布不能靠重新构建/重发恢复。实现验证必须覆盖缺失日志、冲突/错误候选，不能只测成功汇总。

### R10 现场清理与报告留存不能互相销毁

**证据/问题**：当前 [helpers](../../../../test/helpers.ts) 及多个 smoke 固定依赖仓库 `.dev-smoke`；成功报告和大目录混放，简单删根会丢报告，不删根又长期积累。setup 中途失败和关闭不确定不能按成功清理。

**修订与复核**：现场在系统/runner 临时目录，独立报告位置由调用方指定；入口唯一负责资源。逆序关闭继续处理其他资源，重复关闭共享结果；确认停机才能删大目录/临时秘密。停机未知明确失败并限制现场权限，不上传整目录。保留失败行为回归，不新增生命周期框架。报告退出状态包含清理失败，最终汇总不将未完成视作成功。

### R11 安装边界与实施切换保持具体

**证据/问题**：开发 Bun 命令不等于候选程序需要 Bun；tarball/symlink 与 npm launcher 有不同信号/路径边界，不能只选一种而称完整安装。现有 [MCP 配置测试](https://github.com/iTgo-lyq/runweft/blob/28ab4a2/test/mcp-install.test.ts) 缺 Codex 会 skip，也不能沿用为必选验收的成功。

**修订与复核**：安装驱动用 Node，程序在 checkout 外只用候选；两种形态验证自己的部署保障，所选宿主缺失失败。五个职责交付都连同调用方切换并删除旧入口，CI 选择表同步；不单独交付空目录、兼容 alias 或没有消费者的新框架。

## 用户反馈后的操作环节复核

### R12 固定测试入口没有解决灵活验收的环境准备

**证据/问题**：用户指出上一版仍无法明确各环节运行什么、哪些是固定测试、哪些是验收前置启动。[package.json](../../../../package.json) 的 dev 只是源码 CLI；[产品服务命令](../../../../src/service-commands.ts) 已有启动/关闭能力，但隔离 Hub/Runner 的工程准备分散在 [native-user-smoke](https://github.com/iTgo-lyq/runweft/blob/28ab4a2/scripts/fixtures/native-user-smoke.ts) 等辅助里。现有安装流程使用 KEEP_INSTALL 留现场，测试成功与供后续操作混在一起。把 test:native 的 case 选择称作“灵活验收”也不准确：它仍有固定断言。

**修订**：技术方案首先按实际环节列入口、前置和完成含义，再分别定义固定检查与薄环境入口。test/core、tools、integration、install、native 都是固定测试；新增 dev:env 只负责明确输入、隔离 Hub/可选 Runner、就绪和前台生命周期。--candidate 在私有位置安装后提供同样环境，不调用 test:install 留现场。默认空原生配置，不自动调模型。官网沿用自己的 serve；build/package、scope/report、publish/recover/sync 各自区分产物准备、协调和工程操作。

**反例复核与取舍**：固定测试直接调用普通准备函数，不启动 dev:env 子命令；dev:env 不反向导入业务测试，不包含断言/case/seed 注册，不新建 up/down 控制协议。现有 product stop 保留原生会话，因此清理还需确认本次任务/宿主退出；未知保留现场。浏览器/CLI 操作在 ready 后由本次需求决定，准备成功只说明环境就绪。新增一个环境入口有多个实际消费者的准备逻辑为依据；不为每个场景再造启动脚本，也不将当前模型 fixture 原样包装以免默认读取凭据。

**实施验证**：除固定回归外，覆盖独立启动、另一操作窗口可用、退出/中断/准备失败后的关闭，以及 ready 不生成业务通过结论。目标参数尚未实现，当前文档只在 Change 中说明，不冒充现有产品命令。

## 第四轮前的收敛记录与验证界限

[技术方案](technical.md) 已吸收第一至第三轮及 R12 的反例：三个测试目录、平铺 scripts、src launcher、单 TS 配置、两个固定验收入口、一个独立环境启动入口、按 case 复验、显式证据与当前恢复闭环。舍弃全排列、跨命令现场协议、递归扫描、多层目录和预建公共框架；保留有证据的产品保障，并明确每个操作环节的入口与完成含义。

本轮实际验证仅覆盖文档/流程一致性与清单完整性；没有执行产品测试、真实模型或新 CI 工作流，也未证明性能收益。实现阶段按技术方案的反例和同候选成本指标验收，不以本次三轮自审替代运行结果。

2026-10-16 补充操作环节后的校验：`node scripts/check-docs.mjs` 检查 346 份文档、912 个本地链接，0 错误；`node scripts/check-workflow.mjs` 校验 56 个 Change 通过；`git diff --check` 通过。对当前文件清单逐项比对，87 个 scripts 文件与 55 个 test 文件在 Research 中均有去向，无漏项。此次文档交付使用实际提交 hook 再检查暂存内容。

## 第四轮：重新评审

本轮按用户指定的四个重点审查：各环节执行内容、固定测试与灵活验收的启动分离、可删减项与遗漏保障、现场复用/清理/复验。实际运行：`bun test ./test` 264 通过、0 失败，43 个文件，本地 71.44 秒，文件串行执行，各文件耗时之和约等于总时长；`bun build src/cli.ts --compile` 约 0.2 秒；Bun 1.4.2 的 `bun test --help` 确认有 `--shard`、`--timings`、`--isolate`、`--parallel`、`--no-orphans`；读取 run 38535122829 各步骤耗时及 HAPI fork 的 Actions 记录。未运行 integration、install、native 和 typecheck；其余结论来自源码阅读，推断处单独注明。

结论：三层分层、删除跨命令交接和 expanded、scope 前移的方向成立；R13–R15 的前提与源码或实际记录不符，确认技术方案前需要修订。

### R13 HAPI 内部测试没有在任何 CI 执行

**证据/问题**：技术方案以“HAPI 内部单元覆盖仍归 fork”作为收缩真实链路的依据。[checks](../../../../.github/workflows/checks.yml) 在 hapi 目录只执行 `bun install`；fork 已启用 Actions，但 2026-10-17 经 GitHub API 查得运行总数为 0，pin 提交也没有运行记录。因此 `hapi/cli/src/runner/repositories/manager.test.ts`（真实 bundle 与 fsck）、`artifacts/manager.test.ts`、`workspaces/manager.test.ts` 等 Runner 侧契约没有 CI 保障；根测试中的 LFS 只有 [remote-native-fixture](https://github.com/iTgo-lyq/runweft/blob/28ab4a2/test/remote-native-fixture.ts) 的假数据。

**建议**：方案中明确二选一：fork 启用 CI 并要求 pin 通过；或在 pin 变化时由本仓 CI 运行这些 HAPI 测试文件。解决前，真实 Runner 上的 Git、LFS 与字节链路不能改为小数据或下沉。

**主 Agent 核对与处理（2026-10-17）**：采纳覆盖缺口，选择由本仓对 pin 定向运行 repositories/artifacts/workspaces 三个 manager 测试；不要求先改 fork，也不运行 HAPI 全套。已通过 API 独立确认 fork runs 与 pin check-runs 都为 0。补读发现它们使用 Vitest 且 globalSetup 启动源码 Hub，故安排独立准备和临时根；未执行通过前不据此裁掉真实 Runner 的字节/Git/LFS 保障。代码所有权归 fork 不再被表述为已有 CI 覆盖。

### R14 dev:env 的前台所有权与产品实现冲突

**证据/问题**：[services](../../../../src/services.ts) 的 `start()` 以 detached 方式启动 serve 后 unref，`stop()` 只发 SIGTERM 并返回 `sessionsPreserved`；[runner](../../../../src/runner.ts) 的 `runner start` 启动 HAPI 后台进程。入口被强杀、终端关闭或 Agent 工具超时后，Hub 与 Runner 仍会存活；“停止本次拥有的任务”也缺少来源，任务由外部操作经产品 API 创建。仅 Hub 模式用产品 `--home` 下的 init、config set port、start 三条命令即可完成。真实缺口有两处：Runner 身份初始化（产品没有创建身份的 CLI，8 个脚本文件共 13 处直接调用未鉴权的 `/api/runweft/hub/identities` 再写 identity.json），以及候选包私有安装（[smoke-install](https://github.com/iTgo-lyq/runweft/blob/28ab4a2/scripts/smoke-install.mjs) 前段可复用，install、native、dev:env 三方需要）。

**建议**：先把这两个普通函数抽出来，供 integration 与 native 使用，dev:env 再作为薄包装。生命周期二选一：serve 和 Runner `start-sync` 作为非 detached 子进程运行（现有 smoke 已使用 start-sync）；或以环境目录为句柄提供显式 stop，经产品 API 核对会话，状态未知就保留现场。删除停止外部任务、保证外部宿主退出等无法兑现的承诺。

**主 Agent 核对与处理（2026-10-17）**：采纳所有权问题，选用显式目录句柄的 dev:env start/stop。start 返回 ready，stop 核对本私有环境的会话和进程；活跃或未知时保留现场，不承诺停止外部任务。先提取候选安装与身份初始化普通函数，再做包装。补充准确性：产品 stop 不仅发送 SIGTERM，还等待托管服务退出；缺口是其 sessionsPreserved 语义以及后台进程不受包装终端寿命约束。

### R15 原生证据与发行候选的绑定未定义

**证据/问题**：[发行操作](../../../release.md)在打 tag 前对本地 `package --all` 候选执行 native；[npm-publish](../../../../.github/workflows/npm-publish.yml) 从 tag 重新构建候选，且不读取任何 native 证据。技术方案把候选纳入复用指纹，又称由发行工作流汇总核对必需 case，但两次构建的摘要能否一致没有验证，核对者和核对位置也未写明。删除 expanded 后，原有“身份/native 映射、HAPI/原生版本或 workspace 行为变化时扩展”的触发条件没有替代。

**建议**：确认绑定方式：绑定源码 commit 与构建输入，或在已上传的不可变 beta 上执行 native 后再晋级。同时补充改动类型到 N/C/R case 的触发表，以及发版必需的 case 集合。

**主 Agent 核对与处理（2026-10-17）**：采纳绑定与触发规则缺失，选定冻结 source commit/packageInputs/HAPI pin/Bun 与构建参数的源码级绑定。实际受测包摘要继续记录，但不要求 tag 重建字节一致。发行 Agent 在推 tag 前用 native 的只读报告校验模式核对完整 N1–N6 加 C/R 集合；当前发布 CI 不读取本地报告，公开候选仅声明 CI 实际完成的安装/集成保障。Technical 明确了这一自动化边界，以及宿主、执行、工作区、历史、pin 到 N/C/R 的触发表；没有暗建模型凭据或报告上传平台。

### R16 环节表缺少选择规则

**证据/问题**：环节表只列出入口，“修改 CLI、Hub 接线…→选定 test:integration 文件/用例”没有路径到测试文件的映射；[ci-scope](../../../../scripts/ci-scope.mjs) 是唯一现成的映射，但只在 CI 使用。发行分片依赖 `RUNWEFT_SMOKE_SHARD` 与 [integration-cases](https://github.com/iTgo-lyq/runweft/blob/28ab4a2/scripts/fixtures/integration-cases.ts)，删除后的替代没有写；Bun 已提供 `--shard=N/M` 和 `--timings`。依赖描述也有出入：core 需要 hapi 依赖安装，[artifacts 测试](https://github.com/iTgo-lyq/runweft/blob/28ab4a2/test/artifacts.test.ts)等 4 个文件从 `hapi/hub/node_modules` 导入 Hono 和 HAPI Store；[cli-install](../../../../.github/workflows/cli-install.yml) 实际安装了 Bun，“安装验收不需要 Bun”未被 CI 证明；三个入口分别用环境变量、`--candidate`、`--bin` 指定程序。

**建议**：让 scope 成为本地与 CI 共用的映射，可在本地对 main 运行；写明分片方式、单文件超时和是否使用 `--isolate`；统一指定程序的参数。

**主 Agent 核对与处理（2026-10-17）**：采纳。本地与 CI 共用 ci-scope 的 base/head 与可选 working-tree 规则，输出明确文件/依赖/原生建议；列出领域到平铺测试文件组映射。分片使用 Bun --shard，--timings 搭配 --update-timings；初始不启用 parallel/isolate，普通集成 case 默认 120 秒，长专项显式上限。程序统一 --bin、包集合 --candidate；一个薄入口只转发到一次 bun test。core 目标与当前根测试依赖分开说明；Node-only 安装须新增实际无 Bun 环境证明，当前 CI 不算该证据。

### R17 删除编译 helper 会让假 HAPI 测试依赖 HAPI 构建

**证据/问题**：[compiled-cli](https://github.com/iTgo-lyq/runweft/blob/28ab4a2/test/compiled-cli.ts) 只编译 src/cli.ts，实测约 0.2 秒；使用它的 9 个测试文件都对着假 HAPI 运行，不需要 HAPI 构建。改为必须通过 `RUNWEFT_TEST_BIN` 指向与 HAPI 匹配的构建，反而会增加 `build:hapi` 依赖。把它们移出默认 core 可让日常回归少约 35 秒（hub-resource-cli 13.2 秒、uninstall 5.7 秒、hub-consumers 5.1 秒等），但这不需要删除编译 helper。43 个根测试没有哪个文件耗时占主导，整体搬入 test/core 的价值有限。

**建议**：保留测试自行编译，只按文件位置分出；17 个 smoke 改写为 bun:test 之前，先用一个文件试点，验证进程隔离、长等待超时和失败清理。

**主 Agent 核对与处理（2026-10-17）**：采纳主要建议，撤回删除 compiledCli/preload 的决定；保留共享一次 CLI 编译，局部放在 integration，显式 --bin 可替代编译。CLI 对替身/内嵌组件的测试不强制 HAPI 二进制；实际服务接线才需要配对程序。以 hub-configuration 试点超时、失败和清理再迁其余 smoke。补充：artifacts 等确有内嵌 HAPI Store/路由，不能说所有使用 compiledCli 的断言都只涉及假实现；但这不影响“无需 HAPI 可执行文件”的结论。

### R18 只有 smoke 覆盖、去向表未列出的保障

**证据/问题**：以下保障没有对应的根测试：[realtime](https://github.com/iTgo-lyq/runweft/blob/28ab4a2/scripts/smoke-hub-realtime.ts) 的 SSE 回放、可见性与撤销时背压，以及 HAPI 将 RPC 改路由到另一台机器时的拒绝；[access](https://github.com/iTgo-lyq/runweft/blob/28ab4a2/scripts/smoke-hub-access.ts) 的传输中途撤销和日志扫描；[smoke-hub](https://github.com/iTgo-lyq/runweft/blob/28ab4a2/scripts/smoke-hub.ts) 的日志与 WAL 秘密扫描；[connect](https://github.com/iTgo-lyq/runweft/blob/28ab4a2/scripts/smoke-hub-connect.ts) 的浏览器 WebCrypto；真实 codex/claude 的版本发现。

**建议**：在去向表中逐项写明归属；下沉时用故障注入证明替代测试会失败。

**主 Agent 核对与处理（2026-10-17）**：采纳并逐项写入 Technical 的保障去向：SSE 回放/可见性/背压撤销和 RPC 改路由拒绝归 hub-realtime；传输撤销/部分字节归 files-access；日志与状态库/WAL 秘密扫描归 web-identity；真实 WebCrypto 归 web-connect；实际工具版本发现归 hub-resources，安装 catalog 归 install。下沉需故障反例证明，不以目录清单有名称当作覆盖完成。

### R19 仍可删除或合并的重复

**证据/问题**：

- [smoke-collaboration](https://github.com/iTgo-lyq/runweft/blob/28ab4a2/scripts/smoke-collaboration.ts) 的 CONTROLS 和 DISCONNECT 模式不可达：smoke-native 会删除对应环境变量，也没有其他地方设置。
- [result-export](https://github.com/iTgo-lyq/runweft/blob/28ab4a2/scripts/smoke-result-export.ts) 与 [repository-import](https://github.com/iTgo-lyq/runweft/blob/28ab4a2/scripts/smoke-repository-import.ts) 的前置流程大体相同（抽查约 21 行差异），导出到导入的前置在每次 CI 中运行三遍；[resources](https://github.com/iTgo-lyq/runweft/blob/28ab4a2/scripts/smoke-hub-resources.ts) 与 [configuration](https://github.com/iTgo-lyq/runweft/blob/28ab4a2/scripts/smoke-hub-configuration.ts) 的 71 行骨架中 36 行有差异，主要是命名与类型；access 与 [artifact-prune](https://github.com/iTgo-lyq/runweft/blob/28ab4a2/scripts/smoke-artifact-prune.ts) 都验证按 owner 清理；MCP 安装检查在 resources 和 install 中各跑一次。
- workspace-preparation、hub-connect 和 artifacts 中的常规断言已由 [remote](https://github.com/iTgo-lyq/runweft/blob/28ab4a2/test/remote.test.ts)、[hub-connect](https://github.com/iTgo-lyq/runweft/blob/28ab4a2/test/hub-connect.test.ts)、[artifacts](https://github.com/iTgo-lyq/runweft/blob/28ab4a2/test/artifacts.test.ts) 根测试覆盖。
- [smoke-deadline 测试](https://github.com/iTgo-lyq/runweft/blob/28ab4a2/test/smoke-deadline.test.ts)每次都真实等待 5 秒的 SIGKILL 宽限期。

**建议**：随对应交付删除；smoke 只保留跨边界断言；宽限时间改为可注入，或删除该测试。

**主 Agent 核对与处理（2026-10-17）**：采纳不可达分支删除与准备去重。已核对当前入口会清除 CONTROLS/DISCONNECT 且没有其他活跃调用方；C/R 保障单独保留。导出/导入、资源/配置等复用只读基线和 setup，断言仍用独立工作副本，不因文本相似而共享可变现场。关闭宽限时间可注入短值，保留忽略 SIGTERM 后强杀仍判失败的回归；不采用直接删掉该有意义测试的建议。

### R20 证据格式改写会阻断在途发布的恢复

**证据/问题**：发行恢复的做法是从最新 main 恢复原 tag 和原 run；[website/recover](../../../../website/recover.mjs) 按精确路径识别旧日志。main 改用新信封并拒绝旧格式后，切换前开始、尚未完成的发布将无法恢复。`.dev-smoke` 还承担多项非测试用途：CI 工具与原生配置目录、release-source 检出、发布工作目录、官网证据和 uninstall-ci；其中官网证据由 [website/publish](../../../../website/publish.mjs) 写入，recover 按路径读取。技术方案只把 `.dev-smoke` 当作测试现场。

**建议**：最小改法是让 report-evidence 改为接收显式文件列表，日志标记保持不变。若仍要改格式，就单独交付，并以“切换时没有需要恢复的在途发布”为前提。逐项列出 `.dev-smoke` 的非测试用途并固定其路径。

**主 Agent 核对与处理（2026-10-17）**：采纳最小改法，取消本 Change 的 kind/version 信封重写。report-evidence 接收显式物理文件，沿用当前 path/report 信封及官网稳定标识，现行恢复无需双解析；物理目录从日志身份分离。补齐 CI 工具/配置、发布源码检出、候选/cache/prefix、空间记录、官网和卸载报告、Kit 导出的固定位置与所有者。协议中的 .dev-smoke/website-pages 字符串是明确保留的当前标识，不再用作磁盘读取路径。

### R21 复用指纹、清理与时间前提

**证据/问题**：

- 当前 native 指纹包含 `~/.claude.json`，该文件会被 Claude 例行改写，复用基本落空；[model-homes](https://github.com/iTgo-lyq/runweft/blob/28ab4a2/scripts/fixtures/model-homes.ts) 的 verify 对 auth.json 和 .credentials.json 求哈希，令牌刷新会让模型已经成功的 case 判为失败；指纹也没有覆盖 src。
- 以下根目录从不删除：smoke-install 的 prefix、npm-cache、services，verify-packages 的解包目录，smoke-service 的根目录，uninstall 清理出错时的根目录，以及未传 cleanups 的 `helpers.fixture()` 目录。直接迁到系统临时目录只会让泄漏不可见。
- src 中没有可注入的时钟，HAPI 的 45 秒机器过期是常量（`hapi/hub/src/sync/machineCache.ts`），realtime 和 resources 分别等待约 52 秒、60 秒；技术方案所说的“已有可控时间接口”并不存在。
- [smoke-lifecycle](https://github.com/iTgo-lyq/runweft/blob/28ab4a2/scripts/fixtures/smoke-lifecycle.ts) 的 closeSmoke 不共享关闭结果，方案描述的是需要新增的行为。
- 删除交接的取舍成立：[collaboration-package](https://github.com/iTgo-lyq/runweft/blob/28ab4a2/scripts/fixtures/collaboration-package.mjs) 在确认停机后关闭时会删除身份与机器连接文件，重跑读取这些文件即失败，现状本来就只能重跑整个 case。

**建议**：指纹由候选摘要、干净的测试 commit、宿主与 runtime 版本、模型选择组成，不包含凭据和 Claude 状态文件；“源配置未改变”只核对配置文件。迁移临时目录前，先让每个根目录都有所有者并会被删除。两次机器过期等待合并为一次。

**主 Agent 核对与处理（2026-10-17）**：采纳。复用指纹包含候选、干净产品/测试 commit、宿主/runtime 版本和模型选择，排除凭据与 Claude 状态；源配置检查仅静态字段，允许副本认证刷新。先补每个安装/解包/service/fixture 根的回收，再迁临时目录。承认当前无机器过期时钟、closeSmoke 无关闭 Promise；方案分别保留一次真实过期等待、为工程 helper 新增并发关闭共享结果。修正 R5 的能力比较：当前关闭会删凭据，原状也不保证可重跑 consumer 后半段。

### R22 交付顺序

**证据/问题**：run 38535122829（新分支、文档改动）中，零 SHA 导致选中全部集成组，集成 355 秒、构建 19 秒、Playwright 23 秒等合计约 400 秒；scope 之前的 hapi 安装、Codex 安装、typecheck 与测试、actionlint 合计约 115 秒。这两项修复都不需要调整目录，技术方案却把 CI 范围选择与默认测试边界调整放在同一个首个交付中。

**建议**：先交付 CI 修复（merge-base 基线、scope 前移、不再忽略 test 路径）；再删除死代码（expanded、交接协议、CONTROLS/DISCONNECT，integration-cases 改用 `--shard`）；再补充 native 触发与候选绑定规则，并实现单 case 生命周期；再做 smoke 去重和缺口归属（需先解决 R13）；然后抽出公共函数并实现薄 dev:env；证据格式改写作为可选项单独交付。

**主 Agent 核对与处理（2026-10-17）**：采纳 CI 独立先行，Technical 改为六个职责交付顺序。未直接采纳先删交接/分片再改生命周期：它们在当前代码仍有消费者，必须与替代一起切换；不可达分支可先删。HAPI 指定门禁与一个 Bun 试点先于领域裁剪，公共函数有真实复用后再做 dev:env。证据格式改写移出本次范围，保留物理路径与显式收集的必要改造。

**评审提交时结论**：R13–R22 尚未修订进技术方案，需逐项处理。

**处理结果**：已逐项补充主 Agent 核对与取舍，并同步 Technical、Requirement、Research；这是方案修订，不是实现通过或阶段确认。HAPI 指定测试、无 Bun 安装、进程清理与新增范围规则尚待实现验收。第四轮根测试/构建耗时仍归属 Claude 的实测；本 Agent 本轮只复核源码、CLI 帮助和 GitHub 记录，没有重跑产品或模型矩阵。

本次方案校验：文档检查 346 文件、944 个本地链接，0 错误；workflow 校验 56 个 Change 通过；git diff --check 通过。Research 仍覆盖当前 87 个 scripts 与 55 个 test 文件；R13–R22 均有处理意见。流程阶段与确认未改写，实现和后续验收仍未开始。

## 第五轮：按核心契约与 E2E 价值裁剪

本轮是主 Agent 按用户最新要求进行的源码复评，不是外部独立评审，也没有执行测试或模型。用户明确不要求普通局部模块普遍配单测，重点为跨模块约定及少量核心 E2E；以下设计替代第四轮中“全部独立断言保留”“每次发行十项原生 + HAPI 内部门禁”的范围选择，第四轮关于现有实现的事实仍有效。

### R23 有独立断言不等于值得长期维护

**问题**：前稿主要迁移既有断言，对配置正例、诊断文本、展示映射和测试设施镜像也倾向保留，无法达到用户要求的测试减量。另一方面，根测试大量通过 HTTP、Store、CLI 和协调器交互，本来就是契约集成，不能只凭“单元测试”标签整批删。

**处理**：Research 精确列出可直接删的 24 个测试块（AST 定位 272 行正文），以及随旧编排/交接删的 6 个块（99 行）。取消普通局部测试的等量替代要求；只为核心状态机、并发、权限/不可逆副作用及真实跨模块契约保留明确保障。该数字不含后续 helper 和重复长链重写，不冒充最终净减。

### R24 多层全排列不能通过合并目录解决

**问题**：资源/Agent 治理在 Store、HTTP、CLI、真实 Runner、浏览器重复完整验证；网页/原型还穷举展示字段、设备和演示业务流程。将它们搬进 integration 并不能缩小测试规模。

**处理**：核心授权/CAS/异步撤权集中在契约层；CLI/浏览器只补真实接线和主要交互。Hub 留三条用户路径，官网从六档宽度缩为两档，原型删除多设备完整 CRUD/角色演示。文件各副作用的未知/引用/不误删仍独立保留，不把三条不同传输路径的同尺寸大文件草率认作重复。工作流只保留门禁/只读模式等契约检查，删除步骤名和中间路径镜像。

### R25 原生主集合与专项必须实际减量

**问题**：第四轮仍固定十个原生 case，且每条主链叠加 Git/LFS、上下文探针、空等、后继消费和恢复；这是用户希望裁剪的实际成本。

**处理**：建议主集合为 N1/N4/N5 加两种 runtime 的控制，共五项；删除 N2/N3/N6 和 expanded。每条 N 只保留一个两轮任务，删除重复复杂数据构造/空等/治理，只有 N5 做一次重启取回；控制直接从批准操作开始，去掉额外记忆准备轮及定义更新矩阵。重建、长非 Git 路径按相关变更执行；Codex steer/兄弟隔离集中在 C-codex。65 秒宿主等待不保留固定回归，传输期限改动时再按需验收。取消无相关改动时每次发行必跑 HAPI 内部三套测试的新增负担。

**明确取舍**：不再提供全部宿主 × runtime × 工作区的真实模型配对证明，普通发布也不声称跑了全部专项；剩余契约与主链并非旧套件等价覆盖。报告必需集合由 scope/发行调用方明确提供，不能让报告自证完整。保留四平台安装、候选绑定及发布不可重复写入，避免把关键跨模块保障随测试减量一起误删。

第五轮修订仍处于设计评估；Requirement、Technical 和 Research 已同步，未删除测试代码、未记录阶段确认或实施完成。后续以实际净代码、模型调用轮次和总执行工作量验收，不能以 case 名称减少代替成本下降。

## 第六轮：实现后的独立隔离评审

SpecTrail large 要求的独立 subagent 只读评审，初始基线 28ab4a2，审至 04ee54d；覆盖完整差异、需求、技术方案、计划、执行记录和手册，未启动模型、未改文件。未发现核心契约被静默删除或新建过重框架，提出以下三项实质问题；最终增量复核与模型结果另补。

### R26 已知验收目录落入全量 CI

纯 native/recovery/collaboration 改动触发 56 个集成、四平台安装及原型/官网/Kit；native-page 行为改动却未提示 N1/N5。T13 为 acceptance 增加明确范围：入口契约、相应 native 建议，安装入口保留安装检查；native-page 单列历史建议。范围契约测试通过，未知共享路径仍保守选择全量。

### R27 模型报告不能使用 truthy 成功判断

将真实报告 success 改为字符串 unknown、成功项添加 error、删除 startedAt 时，旧校验仍通过。T13 改为严格布尔、报告/案例终态一致、有效有序时间、成功无 error/cleanup 错误；对应非法/矛盾报告反例通过，不引入报告 schema 框架。

### R28 搬移后失败时的凭据清理归属

recovery 将原生 home 改名为 retained 后，原清理集合未包含新位置；后续 mkdir/copy 失败可能遗留凭据。T13 在 rename 前登记两个位置；一次性故障注入实际完成 rename，再让 mkdir 抛错，最后调用 owner 清理，原路径和 retained 的配置/认证均已删除，源 dummy 凭据不变。首次 spy 注入未命中 ESM 命名导入，没有计为通过；改为加载前注入后验证成功。
