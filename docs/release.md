# 打包与发行操作

包与发布门禁见[发行规格](project/specs/release/spec.md)，官网操作见 [website/README](../website/README.md)。

## 本地候选

从已提交的干净源码构建候选：

```sh
bun run package --all
bun run test:packages
RUNWEFT_SMOKE_NATIVE_INSTALL=1 RUNWEFT_SMOKE_KEEP_INSTALL=1 bun run test:install
bun run test:uninstall dist/packages
```

`package` 可用 `--platform darwin-arm64` 选单平台，已核对的 HAPI 构建可加 `--reuse-hapi`。产物在 `dist/packages/`；包输入变化须重新构建验收，固定输入由 `scripts/fixtures/release-inputs.mjs` 定义。

安装验收使用专用 registry/prefix/cache；打印的 evidence.json 中 `installedBinary` 是后续参数。原生入口核对 npm launcher、平台程序与相邻 HAPI 的 realpath/hash，不能换成另编译的程序。卸载专项使用候选原平台 tarball；登记会话是测试进程，不能算模型协作证据。

## 验收矩阵

| 层级 | 入口与范围 |
| --- | --- |
| 无模型集成 | `bun run test:integration <access\|storage\|web\|service-package> <已安装CLI>`；真实 HAPI/Runner、文件/Git、Playwright 和候选安装，各脚本独立现场 |
| 原生主链 | `bun run test:native <已安装CLI> preflight\|all\|N1..N6\|C-codex\|C-claude\|R-codex\|R-claude [前次证据]` |
| 扩展配对 | `test:native <CLI> expanded`；身份/native 映射、HAPI/原生版本或 workspace 行为变化时扩到相关四配对，最多十二组合 |
| HAPI 专项 | `bun run test:execution`；`bun scripts/smoke-hapi-session-and-shutdown.ts <CLI>`：执行关联、真实 Claude 长 cwd 续接，Runner 退出码/状态/锁/控制端口，Hub 无 ACK/停服及启动失败/重启 |

原生及 HAPI 专项调用模型，须已有授权并使用专用认证副本，核对源配置不变。Claude 默认优先 iclaude，可用 `RUNWEFT_SMOKE_CLAUDE` 指定程序；`RUNWEFT_SMOKE_CODEX_MODEL/EFFORT` 覆盖专用副本模型选择。已有 Chromium 可用 `RUNWEFT_SMOKE_CHROMIUM` 指定。机器轮换要求旧 Runner 退出 0 并完成清理。

| 主链 | 保障范围 |
| --- | --- |
| N1 | local/shared，Codex→Codex，两轮、65 秒 wait、真实历史页面与重启无重放 |
| N2 | hub/shared，Claude→Claude，两轮、65 秒 wait 与另一 runtime 的真实历史页面 |
| N3 | hub/worktree，Codex→Claude，工程指令/Skill/MCP、固定 base、实际 hook 失败后的 retry_finish |
| N4 | local/worktree，Claude→Codex，两轮输入输出、原生继承、无变更不创建提交 |
| N5/N6 | hub/remote，两个交叉配对、两 Runner、二进制输入输出、Git/模块/LFS、实际 MCP 下载/取回、离线恢复与显式合入 |
| C/R | 两 runtime 的审批允许/拒绝、精确 interrupt、Codex steer/Claude 不支持、真实 missing 重建；新输入保留原记忆，原始历史 hash 不变 |

模型前先检查候选二进制、浏览器、两轮 fixture 读写和消费者契约、三个消费者的失败证据出口、local/hub 空原生配置接线。一个 case 只有生产、消费和清理均成功才可复用；未知结果先查原记录，不重发。

```sh
bun run test:native <已安装CLI> preflight
bun run test:native <已安装CLI> all
# 定位并修复失败后，使用入口打印的证据定向续验：
bun run test:native <已安装CLI> N3 <前次evidence.json>
bun run test:native <已安装CLI> all <前次evidence.json>
```

候选、脚本/helper、原生配置或模型选择指纹变化时拒绝自动复用，不兼容旧 evidence 格式，不自动整组重试。分阶段工程判断与定向续验单列证据，不改写失败 ledger；核对成功现场停机后回收临时目录，源原生配置摘要保持不变。

## 实测边界

真实模型组合和失败处置见[原生主链验收](project/archive/2026-10-03-test-backbone-slimming/acceptance.md)，长路径与退出修复见[HAPI 专项验收](project/archive/2026-10-10-hapi-session-and-shutdown/acceptance.md)，四平台公共安装/完整卸载和匿名安装见[1.1.4 发行验收](project/archive/2026-10-12-npm-uninstall-release/acceptance.md)。证据只属于对应候选，后续安装或文档验收不增加模型覆盖。

四平台托管安装不代替用户 Mac 实机、Mac/arm64 模型、物理跨机/WAN 或生产 TLS 实测；同机多 Runner 不等于物理远端。规范 `X.Y.Z-beta.N` 的发布/不晋级与官网 Beta 跳过只有[本地夹具证据](project/archive/2026-10-02-npm-beta-publishing/acceptance.md)，稳定版本上传 beta 再晋级不等于已经实际发布该类预发行版本。

## npm 发布与恢复

公开发布按用户授权执行。更新根版本与包内说明、完成验收并提交后，推送匹配的 `vX.Y.Z` 或 `vX.Y.Z-beta.N` tag 触发 `npm-publish.yml`。先上传 beta，经四平台公共安装及完整卸载 gate 后，稳定版本晋级 latest。

安装或晋级失败只重跑失败 job，保留原 beta 包与候选。工作流修复后，从最新 main 手动恢复原 tag 和原 run：

```sh
gh workflow run npm-publish.yml --repo iTgo-lyq/runweft --ref main \
  -f 'release-tag=<原版本tag>' -f 'source-run-id=<原run编号>'
```

手动 `release-tag` 留空只预演。恢复必须取得原候选描述并核对来源及摘要；部分公开、日志不可取得或上传结果未知时停止，不盲目重发。beta 是公开渠道，已公开版本不能覆盖。

缺少标签权限时，逐包检查 npm 的 `/package/<包名>/access` Trusted publishing：仓库 `iTgo-lyq/runweft`、文件 `npm-publish.yml`、environment 留空，同时允许 `npm publish` 与 `Allow npm dist-tag`。权限修复后只重跑 promote。npm 发布完成后，从最新分支运行官网工作流；不用旧生产提交回退网站。
