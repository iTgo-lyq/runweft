# 产品官网验收

> 日期：2026-09-30
> 结论：按用户持续授权完成本地自动验收；官网可独立构建、预览和静态部署。未执行外部发布，Mac/物理远端验证范围沿既有发行结论。

## 交付

- `website/`：首页、独立上手指南、完整命令参考模板、样式和脚本，含构建、预览与自动验收入口。
- `dist/website/`：生成的完整静态站点，四个平台实际下载包、单文件校验、版本索引和原使用说明一并提供。
- 本机预览：`http://127.0.0.1:4173/`；指南为 `/guide.html`，完整参考为 `/manual.html`。预览不是公网发布。
- [维护与部署说明](../../../../website/README.md)：构建、预览、静态服务器 MIME 与大文件要求、子路径部署和复验方式。

## 需求对应

| 验收项 | 实际结果 |
| --- | --- |
| 产品首页 | 明确两客户端、主工作区、委派流程、工作区准备、成果回收与看板；本地/远端图可切换且明确为示意 |
| 真实四平台下载 | Playwright 实际点击并保存四份 tarball，逐份 SHA-256 与发行清单一致；各单文件 `.sha256` 只引用相邻文件名，命令内嵌对应 hash；Mac/arm64 的验证状态不冒充原生验收 |
| 安装与首次使用 | 指南区分宿主、机器、runtime 和 Agent；包括 PATH、原生模型登录、MCP、实际 runtime ID 来源、绑定、首次委派与等待。Linux x64 安装命令从页面 DOM 原样取得并在专用 HOME 下成功执行 |
| 交互 | 平台按钮与命令/文件联动、复制成功与拒绝后的手动选择、导航、FAQ、协作示意及客户端/runtime 选项通过 |
| 响应式与可访问性 | 1440/1024/768/390/320px 三页无页面横向溢出；键盘平台切换、可见焦点、菜单 Escape 焦点、reduced motion 和无 JavaScript 下载/安装回退通过 |
| 独立构建与原产品保护 | 构建核对发行索引 SHA-512 与 SHA256SUMS；缺包/损坏包注入均保留旧站点并清理暂存。31 个子路径站内链接/锚点与 `/sub/` 下真实下载通过；CLI 源码、构建输入与发行 index 未变 |

## 证据

运行命令：

```sh
node website/build.mjs
RUNWEFT_SITE_CHROMIUM=/home/tiger/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell node website/verify.mjs
```

最终原件为 `.dev-smoke/website-70bwyG/evidence.json`，success=true，pageErrors=[]，networkErrors=[]；包含 9 类检查、4 份下载和 19 条布局记录。Playwright Chromium 版本为 153.0.8010.12。该次目录内的首页/指南桌面及手机、安装区截图已检查；下载和测试安装留在专用现场，没有修改用户全局配置或运行模型。

从 DOM 安装的 Linux x64 程序输出 1.0.0，SHA-256 为 `e681e8f801c81c31de0788b8901609d2a6b1576d4715cb6485b5348033bc4de3`，与完整发行验收使用的程序一致。`dist/packages/index.json` 仍为已冻结 hash `71abc1e602c6e3963f48e3eab3feab9a118aad881b29acf4ff0bff414eb6873f`。

官网仅新增 HTML/CSS/JavaScript，不改根 TypeScript、依赖、CLI 构建和 HAPI；执行了相关脚本语法、构建、浏览器、实际下载/安装和文档检查，没有重复未变化的 CLI 模型矩阵或将旧根测试写成本次新运行。

## 部署边界

没有公网域名或托管发布动作；交付目录可由静态服务器独立承载，须支持约 200 MiB 单文件，并原样提供 tgz。官网明确当前无公共 npm 包；完整手册说明完整交付目录安装与官网单平台下载的区别。Mac 未签名/未公证和待实机、Linux arm64 仿真、物理跨机延期均如实保留。
