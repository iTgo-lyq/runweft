# Runweft 产品官网

中文产品首页、安装下载、上手指南和完整命令参考。官网独立于 CLI/HAPI 的业务界面，没有服务端数据库、第三方脚本或外部字体请求。

## 构建与预览

在仓库根目录使用 Node.js 24（当前验证版本）。先准备已构建的 `dist/packages/`；从干净源码生成发行包的步骤见[开发说明](../docs/development.md)。不要为修改官网重新构建已经验证的 CLI 产物。

```sh
node website/build.mjs
node website/serve.mjs
```

预览默认 `http://127.0.0.1:4173/`，可用 `node website/serve.mjs 4174` 更换端口。预览服务器只绑定本机；Ctrl+C 停止。直接打开源 HTML 不会填充发行信息，应通过构建后的 HTTP 预览访问。

源码与输出：

| 位置 | 用途 |
| --- | --- |
| `website/index.html` | 产品首页与平台安装入口 |
| `website/guide.html` | 本地首次使用、资源配置、远端和排错 |
| `website/manual.html` | 使用说明的 UTF-8 HTML 原文参考模板 |
| `website/assets/` | 样式、图标与少量原生 JavaScript |
| `dist/website/` | 可独立部署的静态目录，包含四个平台包 |

`build.mjs` 从发行索引读取版本、平台和原包路径，对照 SHA-512 与 SHA256SUMS；每个平台生成单文件 `.sha256` 和页面安装命令。构建失败保留之前的官网，成功才替换 `dist/website`。它不修改 CLI、发行包、用户配置或运行数据。

下载命令从 `assets/install.js` 统一生成，macOS 用 shasum，Linux 用 sha256sum；hash 内嵌到命令中，只下载自己的平台包就能校验。每个 `.sha256` 文件只引用相邻文件名。关闭 JavaScript 后仍能阅读指南、展开下载表和对应平台的安装命令。

## 部署

将 **整个 `dist/website/` 目录**复制到能承载约 200 MiB 单文件的静态服务器。页面、资源和下载使用相对路径，支持部署到根路径或 `/runweft/` 等子路径，不需要 SPA fallback、Node 生产服务或 HAPI 服务。

- `.html`、`.css`、`.js` 使用对应 MIME type 和 UTF-8；`.svg` 使用 `image/svg+xml`。
- `.tgz` 原样提供，使用 `application/gzip` 或 `application/octet-stream`，不要给原始归档误加 `Content-Encoding: gzip`，否则浏览器解码后 hash 会不匹配。
- 保留 `downloads/` 及其中所有文件，不能只部署 HTML。生产部署后确认浏览器取得的字节与校验清单一致。
- 域名、TLS、缓存和公开发布由实际托管环境配置。本次只交付静态文件和本地预览，没有上传到公开服务。

发布新版本时，先按发行流程生成完整一致的 `dist/packages`，再重新构建官网。不要只手工替换页面上的版本号或一个 tarball。平台验证状态等文案需要随实际证据复核；构建不会把交叉编译自动标为实机验收。

## 自动验收

复用根工程的 Playwright。若本机没有浏览器，先安装其 Chromium；已有兼容浏览器时可通过 `RUNWEFT_SITE_CHROMIUM` 指定可执行文件。

```sh
bunx playwright install chromium
node website/verify.mjs
```

验收会真正下载四个平台包及一个子路径下载副本，检查 hash；覆盖桌面/手机、复制成功和拒绝、菜单、键盘、FAQ、无 JS、reduced motion 和所有站内链接。Linux x64 上从页面 DOM 原样取得安装命令，在 `.dev-smoke/website-*/install-home/` 执行到版本输出，验证无全局 Bun/Node/HAPI 依赖。专用 shell HOME 不改变用户主目录，也不安装用户 MCP 或启动模型。

`verify.mjs` 当前包含 Linux x64 安装实测步骤，应在 Linux x64 上运行；不将它称为 Mac/arm64 实机验证。执行结束关闭本次浏览器和测试服务，证据、截图和下载留在 `.dev-smoke/website-*/`，可在确认无需保留后清理该次目录。
