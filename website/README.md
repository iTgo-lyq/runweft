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

参考页读取 docs/usage.md，在末尾“离线完整交付（工程参考）”附录之前截取并转义；官网不展示离线安装命令。使用说明和 Skill 源码改变后，下次程序发行须重新冻结包输入。已公开 1.1.0 和历史离线整包不覆盖，包内旧 Skill 尚未随本次源码改动重新发布；网站接入对话明确全程使用 npm。

## 部署

将整个 `dist/website/` 目录部署到静态托管平台，例如 Cloudflare Pages。页面和资源使用相对路径，支持根路径或 `/runweft/` 等子路径，不需要 SPA fallback、Node 生产服务或 HAPI。

HTML/CSS/JS 提供对应 MIME type 和 UTF-8，SVG 使用 image/svg+xml。版本须先在公共 npm 发布并验证可安装，再构建并部署网站；构建本身不检查 registry。域名、TLS、缓存和公开发布由实际托管环境配置，本次尚未在线部署。

## 自动验收

根测试中的独立网站夹具不含 dist/packages，验证无下载产物、非法版本和模板失败保留旧输出。Playwright 使用根工程依赖，在 Linux x64 执行网页与真实 npm 安装验收：

```sh
bunx playwright install chromium --only-shell
node website/verify.mjs
```

已有兼容浏览器可用 RUNWEFT_SITE_CHROMIUM 指定可执行路径。验收覆盖三个页面、320–1440px、复制成功/拒绝与焦点、菜单、FAQ、MCP/runtime 切换、无 JS、reduced motion 和子路径全部本地链接。

安装命令及 Skill 目录命令从实际页面 DOM 获取。安装使用独立 HOME、npm prefix/userconfig/globalconfig/cache，清除继承的 npm 配置与认证环境变量，PATH 仅含本次安装、Node/npm 和系统工具。失败 npm 夹具确认不继续运行旧程序；公共 registry 实际安装核对入口归属、版本和五个 Skill 文档。不改用户 MCP/Skill，不启动模型。该检查不代表 Mac/arm64 实机运行。

本次服务和浏览器在结束时关闭；证据与截图、专用安装留在 `.dev-smoke/website-*/`，不提交。发行组装的根夹具同时验证 npm 元数据和旧下载目录拒绝，离线程序与 Git bundle 仍单独保留。
