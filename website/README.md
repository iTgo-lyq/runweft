# Runweft 产品官网

中文产品首页、npm 安装、Agent 接入、上手指南和命令参考。官网独立于 CLI/HAPI 的业务界面，没有服务端数据库、第三方脚本或外部字体请求。

## 构建与预览

在仓库根目录使用 Node.js 24；只需网站源码、根 package.json 和 docs/usage.md，不需要发行包、Bun 依赖或构建网络。

```sh
node website/build.mjs
node website/serve.mjs
```

预览默认 `http://127.0.0.1:4173/`，可用 `node website/serve.mjs 4174` 更换端口。服务器只绑定本机；Ctrl+C 停止。直接打开源 HTML 不会填充版本，应访问构建后的 HTTP 页面。

| 位置 | 用途 |
| --- | --- |
| `website/index.html` | 产品首页与统一 npm 安装命令 |
| `website/guide.html` | npm/Skill 接入、安全身份交接、中心配置、委派和维护 |
| `website/manual.html` | 当前使用说明的转义 UTF-8 参考模板 |
| `website/assets/` | 样式、图标与少量原生 JavaScript |
| `dist/website/` | HTML、资源和 npm 安装元数据，无归档或下载目录 |

版本读取 package.json，安装成功后才运行版本检查。release.json 只保存 version、installation=npm、package=runweft 和公开 registry，不记录程序源码候选。构建全部成功后才原子替换旧网站；错误保留之前的输出，清理暂存。

参考页读取并转义完整 docs/usage.md；使用说明只维护当前产品操作。使用说明和 Skill 源码改变后，下次程序发行须重新冻结包输入。

## Cloudflare Pages 自动部署

`.github/workflows/website-pages.yml` 使用 GitHub Actions 构建和发布；Node 24 构建与部署，上传后安装固定 Bun 依赖及 Chromium 做在线浏览器检查，不构建 HAPI 或调用 npm 发布。

| 触发 | 行为 |
| --- | --- |
| main 的官网相关推送 | 已晋级时部署生产，未晋级时静态检查后等待；拒绝重跑过时 main 提交 |
| codex/** 的官网相关推送 | 已晋级时部署分支预览，未晋级时静态检查后等待 |
| pull_request 的官网相关变更 | 聚焦测试、构建和公共 npm 检查，不上传 |
| workflow_dispatch | 所选 main/codex 分支按同一规则部署；tag/其他分支只检查 |
| 稳定 npm 晋级接续 | 自动 dispatch main，核对预期版本和来源 run/attempt，发布任务等待官网实际完成 |

仅规范稳定版本运行表中的构建/公开 npm/部署步骤。codex/** 的 push 或 dispatch 遇到 Beta 根版本时执行聚焦检查并写 summary，跳过构建和准备/上传；main 或 PR 遇到 Beta 版本直接失败，避免生产更新被静默跳过。真实 builder 仍只接受稳定版本，不生成 Beta 产品站点。

相关路径为 website/**、package.json、docs/usage.md、scripts/npm-publish.mjs 和该工作流。

在[仓库 Actions Secrets](https://github.com/iTgo-lyq/runweft/settings/secrets/actions)的 **Repository secrets** 保存，不需要 Environment secrets：

- `CLOUDFLARE_ACCOUNT_ID`：Cloudflare 目标账户的 32 位 ID。
- `CLOUDFLARE_API_TOKEN`：该账户下 Account → Cloudflare Pages → Edit 权限的 API Token，不需要 npm token。

Pages 项目默认 `runweft`；已有专用项目可在同一设置的 Variables 添加 `CLOUDFLARE_PAGES_PROJECT`。只有 API 明确返回项目不存在时才创建 Direct Upload 项目，生产分支固定 main；已有 Git 接入项目或生产分支不同的项目会明确失败，不自动修改。部署域名以 Pages API 返回的子域为准，不预定 runweft.pages.dev。

无凭证的开发推送仍完成检查，summary 明确标为“未部署”并提示缺失名称；生产和手动部署缺凭证会失败。Token 仅进入 Pages 准备步骤与官方上传 action，Wrangler 4.146.0 在 runner 临时目录的独立 npm 工程安装，不写入根工程或上传目录。

上传前验证静态文件白名单、npm 元数据、五包 latest 已晋级到官网版本、完整性字段/精确平台依赖及公开 tarball HEAD；此检查不代替各平台真实安装验收。普通 push 未晋级时只等待；发布接续、PR 与手动部署要求已晋级，否则失败。稳定 npm 晋级后自动触发最新 main，版本不符或 main 推进时拒绝旧运行。官网失败只检查/恢复官网，不重发 npm；未知 dispatch 先检查 Actions，不盲目再次触发。

上传后先核对 action 返回的唯一 URL 和 preview/production 分类；生产部署还须核对正式域名。在 HTTP 校验前保存已上传回执，全部通过后更新 success。每个地址在约三分钟窗口内等待传播并核对十文件摘要与 MIME，单次请求最多三十秒；Access、错误页面或版本不一致均失败。随后用 Playwright 验证三页 1440/390px 的版本、布局与可见图片。不使用 Actions artifact；部署回执、浏览器证据及十文件摘要写入日志，npm 发布摘要收集全部关联官网 run（含失败重跑）。

上传结果未知或在线检查失败时，先检查 Cloudflare 控制台和该唯一 URL，核对当前run日志中的摘要，避免盲目重发；修正后从最新提交运行。无需修改既有 npm 的标签发布规则。

## 其他静态托管

将整个 `dist/website/` 目录部署到静态托管平台，例如 Cloudflare Pages。页面和资源使用相对路径，支持根路径或 `/runweft/` 等子路径，不需要 SPA fallback、Node 生产服务或 HAPI。

HTML/CSS/JS 提供对应 MIME type 和 UTF-8，SVG 使用 image/svg+xml，两张官方会话/代码截图使用 image/webp。版本须先在公共 npm 发布并验证可安装，再构建并部署网站；构建本身不检查 registry。域名、TLS、缓存和公开发布由实际托管环境配置。

## 自动验收

部署逻辑夹具使用 Node 内置测试，无需 Bun 依赖；在线浏览器阶段需要根工程的 Playwright：

```sh
node --test ./website/publish.test.mjs
node website/build.mjs
node website/publish.mjs check
```

最后一步访问公共 npm；API/路由失败路径用专用夹具测试。当前产品行为见[官网规格](../docs/project/specs/website/spec.md)，生产部署和匿名安装证据见[发行归档](../docs/project/archive/2026-10-12-npm-uninstall-release/acceptance.md)。[正式官网](https://runweft.pages.dev/)随 main 更新，固定构建验收使用唯一部署 URL。

根测试中的独立网站夹具不含 dist/packages，验证无下载产物、非法版本和模板失败保留旧输出。Playwright 使用根工程依赖，在 Linux x64 执行网页与真实 npm 安装验收：

```sh
bunx playwright install chromium --only-shell
node website/verify.mjs
```

仅修改官网内容、已发布程序与 Skill 保持不变时，可显式只验收网页：

```sh
node website/build.mjs
node website/verify.mjs --browser-only
```

该模式保留 DOM 命令、安装失败短路和全部浏览器检查，跳过再次下载/安装已发布 npm 包，证据标注 scope 与 install.skipped；不能作为新的平台安装证明。默认不加参数仍执行真实 npm 安装。

已有兼容浏览器可用 RUNWEFT_SITE_CHROMIUM 指定可执行路径。验收覆盖三个页面、320–1440px、首屏定义/主入口、首页到指南路径、两页接入及首项任务提示一致性、复制成功/拒绝与焦点、菜单、FAQ、MCP/runtime 切换、无 JS、reduced motion 和子路径全部本地链接。

安装命令及 Skill 目录命令从实际页面 DOM 获取。安装使用独立 HOME、npm prefix/userconfig/globalconfig/cache，清除继承的 npm 配置与认证环境变量，PATH 仅含本次安装、Node/npm 和系统工具。失败 npm 夹具确认不继续运行旧程序；公共 registry 实际安装核对入口归属、精确版本、README 和五个 Skill 文件字节。稳定发布的 Linux x64 job 传入原 descriptor，另核对 Runweft/HAPI 两程序摘要。不改用户 MCP/Skill，不启动模型。该检查不代表 Mac/arm64 实机运行。

本次服务和浏览器在结束时关闭；证据与截图、专用安装留在 `.dev-smoke/website-*/`，不提交。

## HAPI 官方截图

首页使用 HAPI 官网的会话与代码查看截图，来源为 [hapi.run](https://hapi.run/)；上游仓库许可证为 [AGPL-3.0](https://github.com/tiann/hapi/blob/main/LICENSE)。本地固定 HAPI 的 `website/public/images/app-chat-interface.png`、`app-code-view.png` 与线上同名文件已核对 SHA-256 一致。

两个上游文件实际为 946×2048 WebP，本站保持字节不变，以 `assets/hapi-session.webp`、`assets/hapi-code.webp` 和正确 MIME 提供。来源保存在本节开发记录，官网不显示来源与版本免责声明。

`publish.mjs` 只明确放行两张 WebP，更新图片须同步白名单、来源与浏览器验证。
