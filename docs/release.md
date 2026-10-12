# 打包与发行操作

源码准备和日常检查见 [AGENTS.md](../AGENTS.md)。发行契约见[发行规格](project/specs/release/distribution/spec.md)，验收选择、证据复用和实测边界见[发行验收](project/specs/release/acceptance/spec.md)；官网操作见 [website/README](../website/README.md)。

## 本地候选与验收

从已提交的干净源码构建候选：

```sh
bun run package --all
bun run test:packages
RUNWEFT_SMOKE_NATIVE_INSTALL=1 RUNWEFT_SMOKE_KEEP_INSTALL=1 bun run test:install
bun run test:uninstall dist/packages
```

`package` 可用 `--platform darwin-arm64` 选单平台，已核对的 HAPI 构建可加 `--reuse-hapi`。产物在 `dist/packages/`；包输入变化须重新构建验收，固定输入由 `scripts/fixtures/release-inputs.mjs` 定义。

安装验收使用专用 registry/prefix/cache，打印的 evidence.json 中 `installedBinary` 是后续参数；原生入口会解析 npm launcher 并核对平台程序与相邻 HAPI 的 hash，不能替换为另编译的程序。卸载专项可传候选目录与证据文件，使用候选原平台 tarball，不重建包；会话为登记到 HAPI 的测试进程，不能算模型协作证据。

```sh
bun run test:integration access <已安装CLI>
bun run test:integration storage <已安装CLI>
bun run test:integration web <已安装CLI>
bun run test:integration service-package <已安装CLI>
```

各脚本使用独立现场，清理自建服务；已有 Chromium 可用 `RUNWEFT_SMOKE_CHROMIUM` 指定。模型验收须已有授权，使用专用认证副本并核对源配置不变；Claude 默认优先 iclaude，可用 `RUNWEFT_SMOKE_CLAUDE` 指定执行程序，`RUNWEFT_SMOKE_CODEX_MODEL/EFFORT` 覆盖专用副本的模型选择。

```sh
bun run test:native <已安装CLI> preflight
bun run test:native <已安装CLI> all
# 定位并修复失败后，使用前次入口打印的证据定向续验：
bun run test:native <已安装CLI> N3 <前次evidence.json>
bun run test:native <已安装CLI> all <前次evidence.json>
```

HAPI/native 映射或 workspace 契约变化时选 `expanded`；HAPI 执行层变化另查 `test:execution` 及专项入口。Linux arm64 安装由发行 CI 的原生 arm64 runner 验证。

## npm 发布与恢复

公开发布按用户授权执行。更新根版本与包内说明、完成验收并提交后，推送匹配的 `vX.Y.Z` 或 `vX.Y.Z-beta.N` tag 触发 `npm-publish.yml`。先上传 beta，经四平台公共安装及完整卸载 gate 后，稳定版本晋级 latest；详细权限和门禁以发行规格为准。

安装或晋级失败只重跑失败 job，保留原 beta 包与候选。工作流修复后，从最新 main 手动恢复原 tag 和原 run：

```sh
gh workflow run npm-publish.yml --repo iTgo-lyq/runweft --ref main \
  -f 'release-tag=<原版本tag>' -f 'source-run-id=<原run编号>'
```

手动 `release-tag` 留空只预演。恢复必须取得原候选描述并核对来源及摘要；部分公开、日志不可取得或上传结果未知时停止，不盲目重发。beta 是公开渠道，已公开版本不能覆盖。

缺少标签权限时，逐包检查 npm 的 `/package/<包名>/access` Trusted publishing：仓库 `iTgo-lyq/runweft`、文件 `npm-publish.yml`、environment 留空，同时允许 `npm publish` 与 `Allow npm dist-tag`。权限修复后只重跑 promote。npm 发布完成后，从最新分支运行官网工作流；不用旧生产提交回退网站。
