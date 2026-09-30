# 产品官网执行记录

## Plan 评审

当前工作区 iclaude 唯一一次只读评审已完成，session `f174ee03-f10b-4690-9180-7bbe59d4e506`，2026-09-30 15:10–15:12（Asia/Shanghai），exit 0、success。原件 `.dev-smoke/reviews/product-website/review.md`。主 agent 复核后沿持续授权执行，不新增人工门禁。

- 采纳单包命令内嵌 hash，并同时核对发行的 SHA-512/SHA256SUMS，保留独立校验下载。
- 采纳 UTF-8 HTML 完整手册参考，明确与官网单包安装的区别；不修改已冻结包内 docs/usage.md。
- 采纳宿主与机器/runtime/Agent 职责区分、runtime ID 来源、首次 local 路径、PATH 持久化和后置 Hub 章节。
- 采纳浏览器真实下载校验、子路径部署、从 DOM 原样执行 Linux 安装命令与部署时保持 tgz 字节的要求。
- 采纳无 JS 下载表及逐平台实际验证状态；预览仅需 GET/HEAD，保持实现简单。校验说明聚焦操作，不额外堆叠与本次使用无关的安全提示。

## T1 官网与上手指南

- 结果：website/ 提供中文首页、独立指南、UTF-8 完整手册参考与一致视觉；平台/协作示意切换、复制、移动导航及无 JS 下载/命令回退可用。官网独立构建到 dist/website，预览仅 loopback，不接入 CLI 服务。
- 下载：直接携带四平台原包；同时验证发行 index 的 SHA-512 和 SHA256SUMS，生成单文件校验与平台命令。构建保留旧站点直到新产物完整。最初校验 Map 键值顺序错误在首次构建失败中发现并修正，正式构建通过；原发行产物未变。
- 验证：node website/build.mjs、四个脚本语法、四平台 HTTP HEAD/长度/无 Content-Encoding/独立校验文件、UTF-8 手册及 diff 检查通过。Playwright 初查两页和 390px 首页无 pageError/页面横向溢出，桌面/手机/安装区/指南截图位于 .dev-smoke/product-website/，已目视检查。安装命令与 mcp check 客户端选项核对当前 CLI；完整下载/安装和浏览器边界在 T2 验收。
- 边界：源码产品、package.json/lockfile、CLI 构建脚本、使用说明与 HAPI 相比冻结发行后提交 f188376 均未变化。
- Commit：`product-website T1: build product site and installation guide`

## T2 浏览器验收与交付说明

- 结果：增加 website/verify.mjs 和 website/README.md；完整需求对应见 [Acceptance](acceptance.md)。实际浏览器下载四个平台包和一个子路径副本，校验字节后，从 DOM 原样执行 Linux x64 命令到版本输出。
- 验证：.dev-smoke/website-70bwyG/evidence.json success，9 类检查、19 条布局记录、4 平台下载，pageErrors/networkErrors 均为空。复制拒绝、无 JS、键盘与 Escape、reduced motion、31 个 /sub/ 链接/锚点、真实子路径下载、坏包/缺包保留旧网站与暂存清理均通过；相关脚本语法和 diff 检查通过。未触碰用户全局客户端配置或调用模型。
- 交付：本地预览 127.0.0.1:4173，源码 website/、完整静态目录 dist/website/。没有对外托管/公开发布；原 CLI 源码、package.json、lockfile、构建入口、docs/usage.md、HAPI 与冻结 index 均保持不变。维护文档说明静态部署、约 200 MiB 单文件和原样提供 tgz 的要求。
- Commit：`product-website T2: verify downloads browser flows and installation`

## 自动验收与归档

沿 AGENTS.md 与用户持续授权完成本地自动验收；T1/T2 独立提交 5118d97 / 76b6124。同步 website/product 与 website/guide Specs，更新仓库文档入口后归档至 2026-09-30-product-website；官网没有改变 1.0.0 CLI 的产品代码与发行物，未执行公开部署。
