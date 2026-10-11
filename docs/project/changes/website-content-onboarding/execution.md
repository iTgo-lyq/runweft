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
