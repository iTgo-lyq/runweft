# Runweft 开发与自动验收

使用固定 Bun 1.4.2 和 package.json 中的 HAPI pin。当前产品使用 Hub 身份/空间和中心配置；旧 YAML/root-token smoke 只保留研究价值，不是新版验收入口。

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

## 当前 Hub 验收

以下脚本使用专用数据、当前编译 CLI 和真实 HAPI，停止自建服务并保存 evidence.json。Playwright 可设置 `RUNWEFT_SMOKE_CHROMIUM` 指向已有 Chromium；没有时安装兼容浏览器，不连接用户真实浏览器。

| 命令 | 范围 |
| --- | --- |
| `bun run test:hub-connect` | 编译 CLI、RSA/WebCrypto、主动创建身份/选择空间、加密交接、重试、取消、秘密扫描 |
| `bun run test:hub-console` | 完整后台、机器/runtime/Agent/仓库/个人选择、权限、任务分页、多身份 HAPI 标签/审批/文件/SSE、390px；任务历史/RPC 是明确夹具，不运行模型/OS PTY |
| `bun run test:hub-service` | 默认服务角色、独立机器接入、轮换/撤销、监督 Runner、显式 reset 与保留 worktree；不运行模型 |
| `bun run test:hub-resources` | 真实 Runner 接入、两个原生工具探测、分享/治理与凭据轮换；不运行模型 |
| `bun run test:hub-configuration` | 中心仓库、Agent、个人选择与配置解析；工具发现不等于模型调用 |
| `bun run test:hub-access` | 真实 HAPI HTTP/文件及多主体隔离 |
| `bun run test:hub-realtime` | 真实 Socket/SSE，协议执行端的终端/派生，不等于真实 PTY |

模型验收须已有授权和专用认证副本：

```sh
bun run test:hub-native-mcp <已安装平台bin/runweft>
bun run test:hub-consumers <已安装平台bin/runweft>
```

`test:hub-native-mcp` 先通过真实浏览器 begin/complete 连接，再用 Codex/Claude 两个原生主宿主 × 两种 runtime × shared/本地worktree/同机远端执行十二组 spawn/wait/read；四组 shared 实际等待65秒，全部核对报告、模式、子 CLI 递归拒绝与进程退出。RUNWEFT_SMOKE_HOST=codex|claude、RUNWEFT_SMOKE_RUNTIME=codex|claude、RUNWEFT_SMOKE_MODE=shared|worktree|remote 可聚焦。仅专用 helper、proof读取和精确只读Git命令获批，其他命令返回原生拒绝，不改变产品权限。

`test:hub-consumers` 使用已安装 CLI 默认 Hub/相邻 HAPI 和两个 CLI-managed Runner，验证共享两轮、原生确认历史缺失后重建、本地 worktree、同机远端 Claude 附件/代码回收、显式清理、两 runtime 停止续接及 Hub 重启只读查询。历史缺失以专用空原生 home 和相同认证/机器验证，不能删除部分文件就把 unknown 当 missing。RUNWEFT_SMOKE_CONSUMER_CASE=codex|remote|prepare|controls 可聚焦。

脚本默认复制已有 Codex/Claude 配置与认证到 `.dev-smoke/`。Claude 优先 iclaude，可用 RUNWEFT_SMOKE_CLAUDE 指定；Codex 可用 RUNWEFT_SMOKE_CODEX_MODEL/EFFORT 覆盖专用副本中的可用模型。不要打印复制凭据、完整原生输出或 prompt。所有成功与失败保留真实证据，同机两个 Runner 不称物理远端。

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
bun run test:hub-upgrade <已保存的Hub基线bin/runweft> <已安装候选bin/runweft>
RUNWEFT_SMOKE_QEMU=<qemu-aarch64-static> RUNWEFT_SMOKE_SYSROOT=<aarch64-linux-gnu目录> bun run test:arm64
```

registry 安装只服务本批包、使用专用 npm prefix/cache；evidence.json 的 installedBinary 是后续模型/网页参数，不用 npm launcher 或另编译的 dist/runweft 替代。`test:service` 为无需Bun/模型PATH的Node默认Hub测试。connect/console同样接受已安装程序参数并记录相邻hash。QEMU入口解包当前arm64包，只验证版本、配置、路径、缺Hub诊断及显式reset，不修改全局binfmt，也不声称原生服务/模型验证。

全量成功后准备经人工筛选的本地验收说明和无秘密证据索引，索引必须含 version、sourceRevision、success=true。不复制原生日志、凭据或完整prompt：

```sh
bun run release:assemble dist/packages dist/website <验收说明.md> <脱敏证据索引.json>
```

网站 release.json 必须为相同版本的 npm 安装元数据，包名 runweft、registry 为公开 npm；旧下载字段或 downloads 目录会被拒绝。网站源码不作为程序候选来源。使用说明和 Skill 源码修改后须重新冻结程序包输入，不能用旧 dist/packages 组装新交付。

输出 `dist/runweft-<版本>-release/`、`.tar.gz` 及 `.sha256`，含包/Skill、静态官网、逐文件校验、对应两仓库源码归档及离线Git bundle；bundle保留固定revision，源码重建不依赖远端Git，但安装依赖仍需网络。已有输出拒绝覆盖，先明确备份旧生成物。不公开发布或修改在线部署。Mac双架构必须构建但保留实机边界，同机多Runner不当作物理远端。实际结果见[项目入口](README.md)。

## npm 可信发布

五包已绑定 `iTgo-lyq/runweft` 的 `.github/workflows/npm-publish.yml`，GitHub 托管 runner 用 OIDC 获取短期发布授权，无需 npm token secret 或逐包人工验证码。[已验证记录](project/archive/2026-10-01-npm-trusted-publishing/acceptance.md)包括真实五包授权和无上传预演；[1.1.1 原 tag 验收](project/archive/2026-10-02-npm-patch-release/acceptance.md)已新增实际 OIDC 上传和匿名安装。

正式发版先更新 `package.json` 和常规说明中的目标版本，完成变更验收并提交干净源码，再推送严格匹配的版本 tag。`vX.Y.Z` 发布到 npm `latest`，`vX.Y.Z-beta.N` 发布到 `beta`；整数不允许前导零，N 从 0 起，alpha/rc 等其他格式拒绝。工作流从该标签构建干净候选，完成根检查、四平台打包/内容/实际安装检查后，依次发布四平台包；确认全部公开完整性后才发布主包。当前公共 1.1.1 已验证，历史 1.1.0 保持原样，不能用新候选覆盖同版本。

main/codex 分支的发布流程文件变更只检查授权和预演；普通产品变更运行独立 CLI 安装 CI。默认分支 main 已包含工作流，可从 Actions 手动运行预演；手动入口不发布 npm。本仓库为私有，当前不会生成自动 npm provenance。

Beta 从最新 main 创建独立 codex 开发分支，准备例如 1.1.2-beta.1 的根版本与常规说明，完成检查并提交后再推送 tag：

```sh
git fetch origin
git switch -c codex/release-1.1.2-beta.1 origin/main
# 更新 package.json、README 与 docs/usage.md 的常规版本目标；检查并提交干净源码
git push origin HEAD
git tag -a v1.1.2-beta.1 -m "Runweft 1.1.2-beta.1"
git push origin v1.1.2-beta.1
```

Beta 仍运行原四平台构建/安装、同一五包 OIDC 与发布顺序，不需要新增 Secret 或可信 publisher。Beta 必须高于每包当前的 beta 和 latest，stable 只与 latest 比较；同版本仅允许原候选恢复。发布后读取实际 dist-tags，Beta 的 latest 必须与上传前相同，回执保留 channel/latestBefore/distTags；变化时失败并提示检查，不自动修正标签。

首次 Beta 公开后可用 `npm install -g runweft@beta --registry=https://registry.npmjs.org/ --include=optional` 跟随 Beta 通道，或使用 `runweft@1.1.2-beta.1` 固定版本；默认 `runweft` 仍安装 latest。Beta 源版本不合入 main；转正式版时准备稳定源码和同名稳定 tag，再按 npm → main/官网顺序交付。

上传前发现同版本不同完整性会停止；上传结果未知不自动重发。部分完成时检查 `npm-publication` 回执，仅在上传前失败、accepted 等待超时或公开完整性已经确认时，使用原 run 的 **Re-run failed jobs** 恢复原候选与通道回执；uploading 且仍未公开时继续停止，先定位结果。候选和回执保留三十天；重跑整个 run 会重新构建，不能当作相同候选。到期或未知结果先核实公开 registry 和回执，不直接重新上传。

## 官网 Cloudflare Pages

网站使用独立 `website-pages.yml`：稳定版本的官网相关 main 推送发布生产、codex 分支推送发布预览，PR 只检查；codex push/dispatch 的 Beta 执行聚焦检查后明确跳过构建/上传，main 或 PR 的 Beta 版本直接失败；操作和 Secrets 见[官网说明](../website/README.md#cloudflare-pages-自动部署)。产品已合入 main，[生产推送 CI](https://github.com/iTgo-lyq/runweft/actions/runs/36921038133)通过；PR 和手动入口已配置，真实触发未实测。

两个凭证已保存为 Repository secrets；[正式官网](https://runweft.pages.dev/)已通过八文件摘要/MIME 和三页 Playwright 检查，[分支预览验收](project/archive/2026-10-02-website-cloudflare-pages/acceptance.md)另存归档。工作流先保存上传回执，在约三分钟窗口内等待网络传播；官网部署不触发程序发版，当前生产安装目标为已公开的 npm 1.1.1。

发版顺序为更新稳定版本并验收、推送匹配版本 tag、等待五个 npm 包发布通过、运行最新分支的官网工作流。npm 未公开时官网检查停止属于预期；Pages 不自动触发 npm 发布。生产部署拒绝旧 main SHA，不能通过重跑旧任务恢复旧官网；确需回退时先提交明确的源代码/版本回退。
