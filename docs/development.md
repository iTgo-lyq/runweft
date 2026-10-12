# Runweft 开发与自动验收

使用固定 Bun 1.4.2 和 package.json 中的 HAPI pin。当前产品使用 Hub 身份/空间和中心配置。

## 构建与基础检查

```sh
git submodule update --init hapi
bun install --frozen-lockfile
(cd hapi && bun install --frozen-lockfile)
bun run build:hapi
bun run typecheck
bun run test
bun run build
```

根测试显式使用 `./test`，不要执行 HAPI 全套测试。build 核对 HAPI revision、源码干净和二进制 hash；pin 改变后先重新 build:hapi，不混用旧程序。不修改用户原生配置，不提交 `.dev-smoke/`。

## 分层验收

默认 `bun run test` 只运行 `./test`，不调用模型。发布和 CI 选择逻辑用 Node 单独检查，避免把 Bun 测试导入 Node：

```sh
node --test ./scripts/tests/*.test.mjs ./website/publish.test.mjs
```

集成使用当前编译 CLI、真实 HAPI 和独立现场，每个脚本记录退出码/耗时并清理自建服务。没有整组自动重试；失败后检查证据，只重跑失败脚本及未执行部分。Playwright 使用专用浏览器，可用 `RUNWEFT_SMOKE_CHROMIUM` 指定已有 Chromium。

| 命令 | 核心保障 |
| --- | --- |
| `bun run test:integration access [CLI]` | HAPI HTTP/Socket/SSE、身份隔离、资源治理、Runner发现与中心配置；不调用模型 |
| `bun run test:integration storage [CLI]` | 附件流式传输/留存、Git准备/回收、远端权限与并发重查；不调用模型 |
| `bun run test:integration web [CLI]` | 真实浏览器连接、配置CAS、任务、审批/文件、身份撤销、迟到响应；任务执行为明确夹具 |
| `bun run test:integration service-package [CLI]` | 默认服务、Runner生命周期、候选完整性、专用registry安装/卸载；须先构建发行包 |
| `bun run test:uninstall [证据文件]` | 隔离 npm prefix/HOME 中安装当前编译程序，验证 Hub、双连接 Runner、会话控制、预览、完整删除、失败重试与独立包；不调用模型 |
| `bun scripts/smoke-hapi-session-and-shutdown.ts [CLI]` | 真实Runner退出码/状态/锁/端口、无ACK/停服/失败启动/重启及Claude长cwd两轮；会调用模型，须已有授权和专用认证 |

完整卸载专项需先 `bun run build`，并具备 `bun run package` 生成的当前平台包与主包目录（`dist/packages/`）；脚本只复制包模板到专用现场，再换入当前编译程序、Skill 和使用说明，不覆盖原交付。会话使用登记到真实 HAPI 控制接口的测试进程，验证停止流程，不代替原生模型协作。默认脱敏证据为 `.dev-smoke/complete-uninstall/npm-evidence.json`；自建服务、安装和数据在结束时清除。

模型验收使用安装后的候选和专用认证副本，已有授权才运行：

```sh
bun run test:native <已安装bin/runweft> preflight
bun run test:native <已安装bin/runweft> all
# 修复并定位失败后，输入前次打印的 evidence.json：
bun run test:native <已安装bin/runweft> N3 <前次evidence.json>
bun run test:native <已安装bin/runweft> all <上次evidence.json>
```

`preflight` 在零模型阶段实际检查程序/浏览器、两轮fixture与消费者契约、空原生配置下local/hub接线。`all` 包含六主链和双runtime各自的控制/历史缺失重建专项：

| 用例 | 模式 / 宿主→执行侧 | 独立保障 |
| --- | --- | --- |
| N1 | local shared / Codex→Codex | 两轮续接、65秒等待、原生历史浏览与重启无重放 |
| N2 | hub shared / Claude→Claude | 另一宿主65秒等待、另一runtime真实历史 |
| N3 | hub worktree / Codex→Claude | 工程指令/Skill/MCP继承、Git hook失败后retry_finish |
| N4 | local worktree / Claude→Codex | 双轮输入输出、第二轮无改动时不造提交 |
| N5 / N6 | hub remote / 双向交叉 | 源/目标Runner、真实模型、二进制输入输出和MCP取回；同机模拟远端 |
| C-codex / C-claude | 独立原生控制 | 中止、续接、原生进程退出 |
| R-codex / R-claude | 独立缺失重建 | 原生确认missing后重建；unknown不当missing |

每个主链成功包含producer、消费者和清理；入口只复用同候选/helper/原生配置/模型选择下已完成的case。指纹变化就重新验收受影响链，不伪造旧证据。HAPI/native映射或workspace契约改动使用 `expanded` 扩为12组合；HAPI执行层改动另运行 `test:execution` 的shared sibling停止边界。无需每次同时跑旧矩阵或为消费者重新生产相同会话。

默认复制已有配置/认证到专用目录，校验源配置不变。Claude优先iclaude，`RUNWEFT_SMOKE_CLAUDE`可指定；`RUNWEFT_SMOKE_CODEX_MODEL/EFFORT`只覆盖专用副本。证据不含凭据、完整prompt或原生stderr。未知失败先诊断，不自动重发已接受任务；同机两个Runner不称物理跨机/WAN验收。

## CI 触发

| 事件 / 改动 | 执行范围 |
| --- | --- |
| main/codex推送、其他分支/外部PR | 核心类型/根测试、Node发布与选择测试、actionlint |
| 产品/测试夹具实现 | 按实际Git差异选择access/storage/web/本机service；未知路径和新分支保守全选四组 |
| 仅测试、开发文档、发布脚本 | 保留核心/Node检查，不构建四平台候选 |
| 官网相关改动 | 独立website流程；PR验证、稳定main生产、稳定codex预览，Beta按下文规则处理 |
| stable/Beta tag | npm流程仅调用一次四平台候选；完整根/Node/四组无模型集成，不按diff跳过；先上传beta，四平台公共npm安装全部成功后晋级latest |
| npm流程 | 空手动输入只预演；版本tag或main显式release-tag先beta、四平台公共安装后晋级 |

同仓codex分支的PR复用push检查，不再重复普通分支四平台打包。CI没有模型认证、不运行真实模型。工作流本地静态与选择测试不代表远端runner已经通过。

## Skill 与官网

产品 Skill 在 `skills/runweft/`，只交付、不安装到开发者全局。使用 skill-creator 结构校验和独立 Agent 场景验证，安装/更新/卸载只针对专用 HOME/CODEX_HOME/CLAUDE_CONFIG_DIR。

```sh
node website/build.mjs
RUNWEFT_SITE_CHROMIUM=<Chromium路径> node website/verify.mjs
```

官网独立构建，仅使用 website、package.json 和当前使用说明，不需要 dist/packages。根夹具验证构建失败保护；Playwright 检查无下载入口、320–1440px/链接/键盘/无 JS，再在专用 HOME/npm prefix/npmrc/cache 中真实执行页面 DOM 的公共 npm 安装和 Skill 目录命令。清除继承的 npm 配置/认证，核对入口归属与 Skill 完整性，不改用户 MCP，不部署在线站点。详情见[官网说明](../website/README.md)。

## 发行

```sh
bun run package --all
```

或 `--platform darwin-arm64` 选单平台；已核对的 HAPI 构建可加 `--reuse-hapi`。完整 `dist/packages/` 含主包、四平台 tarball、独立产品 Skill、index.json 和 SHA256SUMS。主包和平台包内使用说明/Skill一致，包含 HAPI 许可/NOTICE/源码。索引绑定源码 revision/dirty、HAPI pin、二进制与 tarball hash；全部成功才替换旧发行目录，不自动 publish。

从已提交干净源码构建正式候选。`test:packages` 强制 source.dirty=false，并按 `scripts/fixtures/release-inputs.mjs` 固定输入检查后续差异；源码、包内说明、Skill或指定构建脚本改变就重建。验收脚本/项目记录变化可保留同候选，但源码归档仍取索引revision。

```sh
bun run test:packages
RUNWEFT_SMOKE_NATIVE_INSTALL=1 RUNWEFT_SMOKE_KEEP_INSTALL=1 bun run test:install
RUNWEFT_SMOKE_QEMU=<qemu-aarch64-static> RUNWEFT_SMOKE_SYSROOT=<aarch64-linux-gnu目录> bun run test:arm64
```

registry 安装只服务本批包、使用专用 npm prefix/cache；evidence.json 的 installedBinary 是后续模型/网页参数；入口将 npm launcher 解析为实际平台程序，并核对其与相邻HAPI的hash，不用另编译的 dist/runweft 替代。service-package包含无需Bun/模型PATH的Node默认Hub测试，web组同样接受已安装程序参数。QEMU入口解包当前arm64包，只在新专用home验证版本、配置、路径、缺Hub诊断和配套HAPI，不修改全局binfmt，也不声称原生服务/模型验证。

全量成功后准备经人工筛选的本地验收说明和无秘密证据索引，索引必须含 version、sourceRevision、success=true。不复制原生日志、凭据或完整prompt：

```sh
bun run release:assemble dist/packages dist/website <验收说明.md> <脱敏证据索引.json>
```

网站 release.json 必须为相同版本的 npm 安装元数据，包名 runweft、registry 为公开 npm；旧下载字段或 downloads 目录会被拒绝。网站源码不作为程序候选来源。使用说明和 Skill 源码修改后须重新冻结程序包输入，不能用旧 dist/packages 组装新交付。

输出 `dist/runweft-<版本>-release/`、`.tar.gz` 及 `.sha256`，含包/Skill、静态官网、逐文件校验、对应两仓库源码归档及离线Git bundle；bundle保留固定revision，源码重建不依赖远端Git，但安装依赖仍需网络。已有输出拒绝覆盖，先明确备份旧生成物。不公开发布或修改在线部署。Mac双架构必须构建但保留实机边界，同机多Runner不当作物理远端。实际结果见[项目入口](README.md)。

## npm 可信发布

五包绑定 `iTgo-lyq/runweft` 的 `npm-publish.yml`。托管runner使用Node24/npm11.21.0与OIDC，不保存长期npm token；publisher需要允许 `npm publish` 和 `Allow npm dist-tag`。五包上传和标签权限均由1.1.3真实发布及晋级确认；本仓库为私有，不生成自动npm provenance。

先更新根版本和常规说明，完成检查并提交干净源码，再推送严格匹配的不可变tag。稳定版本为 `vX.Y.Z`，预发行版本为 `vX.Y.Z-beta.N`；整数不允许前导零，不接受alpha/rc。发布控制提交与tag的packageInputs必须相同；控制提交执行当前测试，独立checkout原tag及固定HAPI构建一次。基础检查和四组Linux集成通过后，构建job依次上传四平台包与主包，全部使用 `--tag=beta`。

四平台矩阵从公共npm下载精确版本，核对五包元数据、主包与本平台tarball SHA-512，再从公共registry安装到专用prefix/cache；必须实际找到匹配的平台包、核对Runweft/HAPI SHA-256并通过服务/信号、MCP目录、重装与卸载验证。矩阵全部成功后晋级job复查完整性，先更新四个平台latest、最后更新主包latest； `X.Y.Z-beta.N` 仍保留beta，不晋级latest。标签操作允许同候选部分晋级恢复，不允许倒退或改动其他新版本。

beta是公开渠道。稳定版本 `X.Y.Z --tag=beta` 尚未成为默认latest，但可显式安装或被版本范围匹配；失败后不能覆盖同版本，须使用新版本修复。版本、来源、HAPI、manifest/五包SHA-512/程序SHA-256在首个上传前输出 `RUNWEFT_RELEASE_DESCRIPTOR`，成功后经任务output传给矩阵。安装与晋级证据保存任务日志/摘要，最终脱敏摘要写入仓库验收记录；不上传或下载Actions artifact。

main/codex普通推送只做核心/相关集成检查，不发布npm。手动入口 `release-tag` 留空只预演；显式填写已有tag时，仅允许选择main，构建原tag源码并执行上述完整发布，不能移动旧tag。当前恢复例子：

```sh
gh workflow run npm-publish.yml --repo iTgo-lyq/runweft --ref main -f release-tag=v1.1.3 -f source-run-id=38149709526
```

安装或晋级失败时只重跑失败job，复用原成功beta输出和npm原包。beta job失败但五包全部公开时，从同run原attempt日志恢复候选描述，不重新构建。需要修正后工作流恢复旧run时，从最新main手动运行并填写 `release-tag` 与原 `source-run-id`；日志来源workflow、tag/source、所有摘要必须一致。日志不可取得、部分公开或上传结果未知均停止，不盲目重发；只有无公开版本且上次尚未开始上传可重建。旧artifact工作流run38041451856不再重跑。

缺少标签权限会停在beta和旧latest。逐包进入 `https://www.npmjs.com/package/<包名>/access` 的Trusted publishing设置，允许 `npm publish` 与 `Allow npm dist-tag`，仓库 `iTgo-lyq/runweft`、文件 `npm-publish.yml`、environment留空；需重建绑定时保留这些字段。开启后只重跑promote，不重复安装或上传。

## 官网 Cloudflare Pages

网站使用独立 `website-pages.yml`：稳定版本的官网相关 main 推送发布生产、codex 分支推送发布预览，PR 只检查；codex push/dispatch 的 Beta 执行聚焦检查后明确跳过构建/上传，main 或 PR 的 Beta 版本直接失败；操作和 Secrets 见[官网说明](../website/README.md#cloudflare-pages-自动部署)。产品已合入 main，[最新手动生产CI](https://github.com/iTgo-lyq/runweft/actions/runs/38151944692)通过；PR入口尚未实测。

两个凭证已保存为 Repository secrets；[正式官网](https://runweft.pages.dev/)已通过八文件摘要/MIME 和三页 Playwright 检查，[分支预览验收](project/archive/2026-10-02-website-cloudflare-pages/acceptance.md)另存归档。工作流先保存上传回执，在约三分钟窗口内等待网络传播；官网部署不触发程序发版，当前生产安装目标为已晋级latest的npm1.1.3。

发版顺序为更新稳定版本并验收、推送匹配版本 tag、等待五个 npm 包发布通过、运行最新分支的官网工作流。npm 未公开时官网检查停止属于预期；Pages 不自动触发 npm 发布。生产部署拒绝旧 main SHA，不能通过重跑旧任务恢复旧官网；确需回退时先提交明确的源代码/版本回退。
