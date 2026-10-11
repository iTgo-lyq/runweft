# 官网内容与上手路径执行概况

## 方案与协作

- 原始证据：`.dev-smoke/website-content-onboarding/before/` 保存本次三页桌面/移动截图与标题清单；已检查首屏与移动指南。当前首屏定义不明确，指南在可操作内容前展示多项技术概念，结论来自本次实际页面与源码。
- iclaude 首次完整材料调用未返回结果，进程退出143，无额度耗尽证据；未将它计为评审完成。精简材料后通过 iclaude print/medium 实际完成，119219ms，session `786c6e79-6530-4046-943e-26488b76c531`，结果文件 `.dev-smoke/website-content-onboarding/iclaude-plan-review.md`。
- 采纳：接入与首项任务按 MCP 重开拆开；本机共享目录评审未提交改动；示意图区分共享评审和独立实现；首页/指南提示一致；首屏可见定义与主CTA；每步完成标志；工程边界默认折叠；参考正文保持已发布版本。
- 主 Agent 调整：入门场景不要求同时安装两种模型工具；“只读”表述为任务要求，不作为强制沙箱承诺。GitHub API 确认仓库私有，导航改为公开 npm，三页核对；不改变仓库可见性。
- 范围：用户授权官网内容改善，保留既有框架与样式。Playwright 验证页面和可复制指令，产品二进制与 Skill 不改变；不会把文案路径验收声称为新增真实模型或跨机验收。

## T1 重写首页内容与入门入口

- 结果：首屏明确任务委派工具与 Codex/Claude Code；三卡改为评审、独立实现、远端测试/构建；主入口统一为 Agent 接入，手动安装为次入口；接入提示以重开客户端结束；示意图共享评审/独立实现与远端目录一致。私有 GitHub 首页导航改为公开 npm。
- 验证：网站构建通过；Playwright 检查 1280×800、390×844、320×844、1440×1000 首屏定义与主 CTA 可见、无横向溢出，接入复制和本地/远端切换通过。主 Agent 已查看桌面与手机截图，现有 CSS 未修改。证据：`.dev-smoke/website-content-onboarding/home-t1/evidence.json`。
- Commit：`website-content-onboarding T1: explain delegation with concrete examples`。

## T4 由 iclaude 独立重写全部官网文案

- 用户追加要求：全部文案由 iclaude 编写，包含先前 T1 已改首页。T1 提交保留为过程记录，新增 T4 替换其文案，不将 T1 作者误记为 iclaude。
- 分工：iclaude 负责内容组织和最终措辞；主 Agent 提供事实、检查产品准确性、机械落地并验收。需要修改文字时交回 iclaude，不由主 Agent 润色。
- 成稿：iclaude session `a4dc0d40-4125-4a03-83c6-ab14d64bbb6c` 成功完成三页、示意文案和编辑说明；事实返修 session `b07805b3-74d5-4b4f-9adf-64f511f82e93` 修正 Skill 授权约定与续接重建条件，并补写复制反馈。原始成稿与结果保存在 `.dev-smoke/website-content-onboarding/`，逐文件 SHA-256 见 `authorship.json`。
- 结果：三页 HTML 与 iclaude 最终成稿逐字节一致；JS 从其 JSON 原样引入示意/复制提示。首页和指南都有一致的接入提示与重开后的首项任务；导航使用公开 npm。参考导读重写，已发布命令正文与占位符保留。
- 事实核对：默认 Hub 地址、MCP 身份/空间返回、Runner online、成果取回与原生续接条件对应源码/Skill；没有把只读任务要求写成沙箱保障。样式未改，801px 标题自然换行，无裁切。
- 验证：静态构建；九种宽度首屏定义/主 CTA 可见、无横向溢出；复制、模式切换、无页面异常通过。已查看桌面/移动首页、801px 首页、移动指南、参考页与首页全页截图。证据见 `home-iclaude/evidence.json` 和 `after/`。
- Commit：`website-content-onboarding T4: integrate iclaude-authored website copy`。

## T2 验证上手路径并完善维护说明

- 结果：官网验证器增加显式 `--browser-only`，默认仍真实安装 npm；新增首页主入口、两页接入与首项任务提示一致性、首屏可见及公开导航检查，折叠选择器适配指南结构。README 说明验收范围，并将历史部署数据标为历史。
- 验证：`node --test ./website/publish.test.mjs` 15/15；`node website/verify.mjs --browser-only` 全部通过，三页五宽度、24 个相对链接/锚点、复制拒绝/焦点、菜单/切换、无 JS、reduced motion 和失败安装短路均通过。原始证据 `/home/tiger/workspace/runweft/.dev-smoke/website-fdgP6n/evidence.json`，本 Change 副本 `browser-evidence.json`。
- 包边界：`assertFrozenCandidate` 对 `v1.1.3` 源码 `dab91e089c63a64a4d275a81b7b793354d86200b` 校验通过；程序、Skill、使用说明及版本未改。本次显式跳过重复 npm 安装，不新增平台/原生模型/跨机验证结论。
- Commit：`website-content-onboarding T2: verify onboarding path and document browser checks`。

## T3 发布验收、Specs 同步与归档

- 结果：按既有授权快进合入 main 并推送；Pages 正式部署完成，唯一 URL 为 `https://9417cc0a.runweft.pages.dev/`，正式域名三页为 iclaude 新稿。
- 验证：main CI 与 Pages CI 成功；正式域名及唯一 URL 的八文件摘要/MIME、三页浏览器、首页主入口/示意切换通过。CI/local 文件一致，静态总量 102,120 字节，Actions artifact 为零；具体来源和范围见 acceptance.md、verification.json。
- 关闭：按用户持续授权完成自动验收，同步 website/product 与 website/guide Specs、文档入口，将本 Change 归档到 `2026-10-12-website-content-onboarding`。本次未执行重复 npm 安装或新模型任务。
- Commit：`website-content-onboarding T3: record production acceptance and archive`。
