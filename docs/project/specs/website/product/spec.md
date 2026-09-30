# 产品官网与下载

Runweft 官网是独立静态站点，不与业务看板或 HAPI 服务混用。首页介绍 Codex/Claude Code、主工作区的任务委派、独立工作区准备、会话与现场留存、Git/附件回收及 local/Hub 两种模式。本地/远端协作图是明确标注的交互示意，不读取或虚构在线任务状态。

## 平台安装

首页可选择 macOS arm64/x64、glibc Linux arm64/x64，对应下载、文件名、大小、校验和、安装命令和验证范围同步切换。版本和 hash 来自已构建的发行物，不提供尚不存在的公共 npm 安装入口。

安装命令内嵌单个平台包的 SHA-256；macOS 使用 shasum，Linux 使用 sha256sum。校验后解包到个人目录，保留配套 Runweft/HAPI，以符号链接提供命令并验证版本。每个平台另提供只引用相邻文件名的校验文件，无须取得其他平台包。PATH 的当前终端与持久配置区别明确。

Mac 未签名/未公证且未作最终实机验证、Linux arm64 当前 QEMU 范围、物理跨机尚未实测分别标注；既有真实 Linux x64 证据不外推到其他平台。产品发行事实见[发行产物](../../release/distribution/spec.md)。

## 静态交付

`website/build.mjs` 核对发行 index 的 SHA-512 和 SHA256SUMS，生成含四份原始 tarball、单文件校验、使用说明和版本索引的 `dist/website/`。独立暂存全部成功后才替换旧网站；缺少或损坏包时报错并保留旧站点，不修改 CLI 或发行包。

站内页面、资源、下载均使用相对路径，支持根路径和子路径部署。`website/serve.mjs` 提供 loopback GET/HEAD 预览，仅允许读取站点目录；公开部署使用能够承载约 200 MiB 单文件的静态服务器，tgz 原样提供，不误加 Content-Encoding。构建、维护与验证见[官网说明](../../../../../website/README.md)。

移动导航、平台键盘操作、可见焦点和 reduced motion 可用。复制失败会选中命令并提示手动复制；禁用 JavaScript 仍能阅读页面、展开四平台下载和安装命令。站点不包含账号系统、遥测或第三方脚本/字体请求。

实际浏览器下载、19 条布局、子路径、安装和构建失败保护证据见[验收记录](../../../archive/2026-09-30-product-website/acceptance.md)。
