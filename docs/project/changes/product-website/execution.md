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
