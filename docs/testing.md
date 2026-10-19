# 测试与需求验收

本手册区分固定回归、需求验收的前置环境和发行操作。固定测试自己准备、断言和关闭；`dev:env` 只提供环境，业务结果由本次需求验收记录。新增测试优先保护跨模块契约、不可重发和破坏性边界；普通局部逻辑、展示字段与已被核心链路覆盖的排列不单独堆测试。

## 组织全貌

```text
src/                       产品代码，含随包 npm-launcher.cjs
scripts/                   构建、候选安装、CI/发行、dev-env 等工程命令
  tests/                   发布/恢复/分发等工程契约的 Node 测试
test/
  core/                    少量格式拒绝、并发建库、资源关闭保障
  integration/             跨模块契约、真实服务/文件/Git、Hub 浏览器
  acceptance/              安装与原生模型 E2E，及其实际使用的 helper
  lifecycle.ts 等           集成/验收共用的少量普通函数
website/                   官网构建、发布工具测试和浏览器验收
packages/prototype/        原型自己的构建、发布工具测试和浏览器验收
```

没有独立 packaging 目录、场景注册表或第二套测试调度器。`test/integration` 用 Bun 的文件发现、名称过滤和分片；`test/acceptance` 只保留安装与模型两类入口。工程脚本不反向运行测试来获取常驻现场。

## 环节与命令

| 环节 / 触发条件 | 执行什么 | 性质与成功结果 |
| --- | --- | --- |
| 开始改动、提交前 | `node scripts/ci-scope.mjs --base origin/develop --head HEAD --working-tree` | 只读选择；输出需要的检查与依赖，不执行模型 |
| 文档或 Change 修改 | `node scripts/check-docs.mjs`、`node scripts/check-workflow.mjs`、`git diff --check` | 固定检查；链接、流程与差异有效 |
| 核心格式/持久化边界 | `bun run test` | 固定 8 项核心检查；不编译或启动服务 |
| TypeScript 产品 / 测试 / 工具改动 | `bun run typecheck`，按 scope 执行 integration 文件 | 类型和跨模块固定契约；全部选中项通过并关闭 |
| 工程/发布工具修改 | `bun run test:tools` | 固定 Node 工具契约，不真实发布 |
| Hub 页面 | 选中 `web-*.test.ts` | 固定 Playwright 用户路径，自动浏览器 |
| 官网 / 原型 / Kit | 下文所属工程命令 | 固定检查；分发与部署另行触发 |
| 围绕需求自由操作 | `bun run dev:env start …` → 操作 CLI/API/UI → `stop --dir …` | 前置启动命令；不宣称业务验收已通过 |
| 安装/launcher/服务/卸载变化 | `test:install --candidate … --case all --report …` | 固定两种安装生命周期，无模型 |
| 原生适配、MCP、恢复接线变化 | `test:native --candidate … --case <ID> --report …` | 已授权的真实模型固定案例，按影响选择 |
| 合并前 | scope 选中项、适用专项、文档/流程及 `git diff --check origin/develop...HEAD`；核对 CI | 必需 job 失败、取消或缺结果不能视为通过 |
| 正式程序发行前 | 冻结候选 → 安装 → 五项原生主集合及受影响专项 → 校验报告 | 本地源码级模型证明；公共候选另做固定安装/集成 |

## 准备条件

文档检查只需 Node；工程工具测试还需根依赖（包含 yaml），先运行 `bun install --frozen-lockfile`，测试本身由 Node 执行。产品检查使用 package.json 固定 Bun（当前 1.4.2）和 HAPI pin。第一次准备源码与依赖：

```sh
git submodule update --init hapi
bun install --frozen-lockfile
(cd hapi && bun install --frozen-lockfile)
git config --local core.hooksPath .githooks
```

只在 scope 的 `build` 或候选/环境验收需要实际程序时运行 `bun run build:hapi`、`bun run build`。HAPI pin 变化必须重建 HAPI；已有 HAPI 构建会校验源码 revision、干净状态和 hash。`clients` 需要可执行的 Codex/Claude Code（开发 CI 安装固定版本且使用空配置，不调用模型）；`browser` 需要 `bunx playwright install chromium`。core/tools 不以完整服务或模型作为前置。

`managers` 为 true 时，在准备好的 HAPI 依赖下执行：

```sh
(cd hapi/cli && bunx vitest run src/runner/artifacts/manager.test.ts src/runner/repositories/manager.test.ts src/runner/workspaces/manager.test.ts)
```

只覆盖当前 pin 的文件/Git 接线，不把 HAPI 全套测试叠到根测试。

## 按改动选择检查

在仓库根执行；比较前先 fetch 所需分支，显式参数引用必须在本地可解析。

```sh
node scripts/ci-scope.mjs --base origin/develop --head HEAD
node scripts/ci-scope.mjs --base origin/develop --head HEAD --working-tree
```

输出比较提交、文件清单、固定检查和依赖范围。`--working-tree` 额外纳入已暂存、未暂存及未跟踪文件；重命名同时考虑旧、新路径。比较分叉分支可加 `--merge-base`。明确基线不存在会失败，不能把失败当成“无须测试”。

开发 CI 在 Node 环境先选择范围，再安装所选检查需要的依赖。PR 使用目标分支 merge-base；push 从本仓库最近 100 次成功开发检查中选择当前 HEAD 的成功祖先，累计检查之后的变化；新分支可复用默认分支等已通过检查的祖先提交。失败/取消的推送不能成为基线，强推后没有成功祖先、Git 对象缺失或 API 不可用时选择完整检查。scope 与最终汇总始终执行，所选检查失败、取消或缺结果不能通过。

普通文档执行文档与流程检查；未初始化 HAPI 时会明确列出未检查的外部源码链接，产品检查准备 pin 后再核验它们。原型和官网使用所属工程的验证，Kit 检查结构及分发工具。根测试、公共 helper、共享源码和工作流变更不会因被排除而漏验。`native` 是按改动给出的模型验收建议，开发 CI 不会自动调用模型；`install` 表示候选安装的影响范围。`integration` 给出实际文件，`build/clients/browser/managers` 说明所需前置；范围输出不代表检查已经执行。

官网的验证与部署由其独立工作流负责，入口见 [官网说明](../website/README.md)；原型见 [包内说明](../packages/prototype/README.md)，候选、发布和恢复见 [发行操作](release.md)。

## Hub 配置接线

已构建匹配的 CLI/HAPI 后，可单独验证 CLI 到真实 Runner 的配置解析；只做版本发现，不调用模型。它自己创建并关闭本次环境，无需预先启动服务。

```sh
bun run test:integration --bin dist/runweft -- ./test/integration/hub-configuration.test.ts
```

断言通过且 owner hook 确认关闭后才通过。未传程序、缺少原生 Codex 程序、超时或关闭失败会失败；停机未知时保留现场，不能把开始运行或打印 ready 当作成功。

## 固定检查

`bun run test` 只执行 `test/core` 的格式拒绝、并发建库和资源关闭保障；不编译 CLI 或启动服务。`bun run test:tools` 执行 Node 工程工具契约。跨模块检查在 `test/integration`，通过一个 Bun 进程直接使用原生过滤和分片：

```sh
bun run test:integration --bin dist/runweft --
bun run test:integration -- ./test/integration/tasks.test.ts -t 'lost'
bun run test:integration --bin dist/runweft -- --shard 1/4 --timings /tmp/runweft-timings.json --update-timings
```

CLI 替身检查未传 `--bin` 时本次共享编译一次；真实 Hub/Runner 检查必须显式提供配对程序。默认单项超时 120 秒，较长 Git 场景在文件中声明；`--timeout`、`--timings`、`--update-timings`、`--shard` 直接交给 Bun。空选择不能作为通过证据。失败先查看具体用例和清理结果，再定向执行文件或名称；不自动整组重试。

## 候选安装验收

安装、打包、launcher、服务启动/退出、MCP 安装或卸载变化时执行。先将包输入提交到干净版本，再构建：

```sh
bun run package --reuse-hapi
node test/acceptance/install.mjs --candidate dist/packages --case all --report /tmp/runweft-install.json
```

`npm` 与 `standalone` 可单独复验；`all` 顺序运行两种布局，每种拥有独立安装根。输入 tarball/程序摘要、版本和平台必须一致，不自行重建候选；Node 驱动在 checkout 外、无 Bun 的 PATH 下运行已安装程序，确认服务退出、MCP 配置保全和完整卸载后才通过。`--report` 保存每个布局的结果及清理失败；断言失败或未知停机均保留根目录，不能当作通过；成功才回收。

本地只证明当前平台。开发 CI 在安装相关范围选择四平台各自构建与实际安装；发行 CI 对四平台各自下载的公共候选执行同一入口。HAPI 源码归档与 pin 的逐文件比对由打包阶段负责，不在每个安装进程重复准备源码。

## 浏览器与原型

Hub 页面变化选择 `web-identity`、`web-connect`、`web-console` 集成：真实账号/连接授权、配置选择、任务到原生详情，保留跨 owner 隔离、撤权失效和秘密扫描。普通任务历史是当前格式样本；真实模型历史在原生 case 内验证，不能用普通浏览器样本代替。

```sh
bunx playwright install chromium
bun run test:integration --bin dist/runweft -- ./test/integration/web-console.test.ts
node website/build.mjs
node website/verify.mjs --browser-only --report /tmp/runweft-website.json
(cd packages/prototype && bun run build && bun run test)
```

官网三页各检查桌面/手机两档布局、版本命令、复制/键盘、图片和本地链接。仅正式发行验收才加公共 npm 的实际 DOM 安装（不传 `--browser-only`）；独立 Kit 安装不在官网重复。原型八入口各检查桌面/手机、opaque iframe、无外部请求、导航及代表性交互，不复演内存演示业务。失败按文件/入口定向复验，无需部署或真实用户浏览器。

## 灵活验收前置环境

需要围绕当前需求手动操作 CLI/API/浏览器时，先准备环境，再执行自己的业务步骤。它不运行测试、不准备 Agent 或模型配置，也不产生业务通过报告。

```sh
bun run dev:env start --bin dist/runweft
bun run dev:env start --candidate dist/packages --runner
bun run dev:env stop --dir /返回的/runweft-env-目录
```

`--bin` 使用显式程序及其相邻 HAPI 的私有副本；`--candidate` 使用已校验的候选私有安装。两者必须二选一，不自动编译或换包。默认只有 Hub，`--runner` 才登记并启动 Runner；身份和个人空间已准备好，返回受限 `accountFile` 供开发者在自己的浏览器输入合成账号，不在终端打印密码或凭据。`cli`、`home`、`nativeHome` 分别说明专用程序、Runweft 数据与原生配置位置；后续命令带 `--home` 使用返回的数据根。

启动命令退出后环境仍可使用。完成业务验收后运行返回的停止命令：核对目录/程序摘要和现有产品进程状态，活跃会话、MCP 客户端、未知进程或未确认结束的任务会拒绝删除并保留目录。先用此环境的 CLI/原生会话入口结束任务、修复状态，再定向停止；不猜 PID 强杀。确认全部进程退出后删除本次专用目录，对已删除或拼错的目录均报不存在并返回失败，不声明停止了任何进程；请以第一次停止结果为准。业务结果需要留存时先保存到环境外。固定测试自行准备和清理，不调用此入口获取现场。

## 原生模型固定验收

默认发行集合是 `main` 的五项：N1（Codex→Codex/shared）、N4（Claude→Codex/worktree）、N5（Codex→Claude/remote）、C-codex、C-claude。三条 N 各一个任务两轮；N1/N5 读取同现场真实历史，N5 另验证 Hub/Runner 重启后成果取回和不重放。C 直接做批准、拒绝、中断，Codex 再检查 steer 和共享宿主兄弟隔离。恢复/历史路径/HAPI 原生边界变化时加 R-codex/R-claude、L-claude；普通改动不自动执行全部八项。

前置为：已有模型使用授权、原生程序和有效配置、干净冻结的产品/验收源码、当前平台真实候选、N1/N5 所需 Chromium。默认原生程序为 `codex` 和 `claude`；可用 `RUNWEFT_NATIVE_CLAUDE` 指定程序。只复制本次所需配置到专用 HOME；模型/effort 从原生配置读取，或使用 `RUNWEFT_NATIVE_CODEX_MODEL/EFFORT`、`RUNWEFT_NATIVE_CLAUDE_MODEL/EFFORT` 显式设置；缺少值会失败。不会修改全局登录或配置，也不会默认调用 iclaude。

```sh
bun run package --reuse-hapi
bun run test:native --candidate dist/packages --case N1 --report /tmp/native-N1.json
bun run test:native --candidate dist/packages --case main --report /tmp/native-main.json
# 按相关改动执行，例如 Claude 长路径：
bun run test:native --candidate dist/packages --case L-claude --report /tmp/native-long.json
```

案例自己安装候选、创建 Hub/身份/Runner、执行断言和清理。只有断言、原生进程退出与关闭全部确认才成功；成功根目录删除，失败保留诊断，已确认停机时清除模型配置/凭据副本。报告在现场外，不保存凭据、原始 prompt、源码或原生历史正文。native 不是灵活环境启动器。

同一输入发生环境故障后，诊断并确认原现场停机，显式重跑单个案例：

```sh
bun run test:native --candidate dist/packages --case N1 --retry-of /tmp/native-N1.json --report /tmp/native-N1-retry.json
bun run test:native --verify-report /tmp/native-N1.json --verify-report /tmp/native-N1-retry.json --source <冻结提交40位> --required-cases N1
```

入口拒绝覆盖旧报告；`--retry-of` 只关联同一候选与验收输入的失败案例，不接管旧现场。修代码后重新冻结，用新报告验证受影响范围；不同输入的失败不能拼成同版本通过。main 失败后未运行项仍需逐项执行；发行 Agent 显式传入五项主集合及所选专项，校验器拒绝缺项/失败/未知格式/冲突。认证刷新不改变证据指纹。校验命令也要求当前产品与验收文件和指定冻结提交一致，未提交/未跟踪的输入不能复用旧报告。

报告记录受测包和程序摘要、产品/验收源码输入、HAPI pin、Bun、平台、原生版本和模型/effort。公开 CI 重建包不保证与本地逐字节相同；本地模型报告证明冻结源码，CI 证明其实际下载候选的安装和集成。当前 CI 不接收本地模型报告，推 tag 前的完整性核对由发行 Agent 执行，详情见[发行矩阵](release.md#验收矩阵)。

## Kit 检查

```sh
node scripts/check-runweft-kit.mjs
node --test scripts/tests/skill-sync.test.mjs
```

结构检查要求五份文档、元数据及本地链接有效；工具测试只在隔离 Git 仓库模拟同步，覆盖脏树拒绝和推送失败。修改产品 Skill 语义时，再用独立 Agent 在专用项目按真实场景验证指引，记录该 Change 的证据。`scripts/sync-runweft-kit.sh` 会写独立分发仓库，属于正式分发操作；不作为普通测试前置，不安装到开发者全局。

## 故障定位与完成判定

| 结果 | 下一步 |
| --- | --- |
| 依赖/候选/配置前置失败 | 修复明确缺项后重跑选中项；未调用模型不计模型覆盖 |
| 断言失败 | 保留首次日志/报告，定位对应跨模块契约；修复后按文件、名称或单案例复验 |
| 超时 / 中断 / 未知 | 先查原任务/原生进程和关闭结果；不能根据无响应推断未执行或重新派发 |
| 关闭失败 / 仍活跃 | 失败保留专用现场，诊断归属再停止；不能以断言成功覆盖清理失败 |
| 已通过 | 记录命令、源码/候选、实际范围与耗时；保留外置证据，确认成功根已释放 |

需求验收在相应 Change 记录输入、步骤、结果、失败与定向复验。模型证据、样本浏览器、模拟发布、真实公共安装分开表述；同机双 Runner 不能代替物理跨机/WAN，当前平台不能代替四平台，未执行项不写通过。无需为了验收建立常驻缓存或生成一组新的长期脚本。

## 工作目录与报告

CI 的 `prepare-ci.mjs` 只创建本次 `${RUNNER_TEMP}/runweft/<run>-<attempt>-<job>-<slot>` 根并设置配置路径：原生工具在 `tools/`，空配置在 `config/`，发行冻结检出在 `source/`，公共候选在 `candidate/`，报告在 `reports/`，官网回执在 `website/`。完成各自收尾并写入日志后，成功 job 删除自己的根；失败保留到本次一次性 runner 结束，不扫描其他历史现场。

本地发行/官网工程命令显式设置 `RUNWEFT_WORK_DIR`，冻结发行另设置 `RELEASE_SOURCE`；发布步骤和恢复权限仍以 [发行操作](release.md) 为准。模型与安装报告、官网 `--report` 文件都放在被测临时根之外。固定 Bun 集成直接使用测试输出和失败现场，不再扫描整个目录收集 JSON。

```sh
node scripts/report-evidence.mjs /明确的/install.json /明确的/native.json
node scripts/report-evidence.mjs --website /本次目录/website/check.json /本次目录/website/deployment.json
```

收集器一次校验显式文件列表；空列表、缺失、坏 JSON 或重复标识均失败，不输出半份成功证据。官网 `.dev-smoke/website-pages/*.json` 仅保留为已有日志恢复协议的稳定 ID；物理目录和收集方式已独立。恢复不上传、不重发，也不从缺失/冲突回执推断成功。Kit 的 committed tree 导出由同步命令创建和退出时回收，安装和分发检查见正式 Kit 工具。
