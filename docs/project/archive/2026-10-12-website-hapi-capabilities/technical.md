# 官网 HAPI 能力补充方案

> 来源：./requirement.md
> 更新：2026-10-12

## 方案

基于 research.md 的当前能力核对，在首页既有委派场景之后增加原生执行/HAPI 体验内容，并在指南中提供任务详情到会话、审批和文件的操作说明。结构位置及自然措辞由 iclaude 决定，复用现有 section、feature-grid、results-band 等样式，不改 CSS、不扩大首屏高度。

iclaude 先评审 Plan；主 Agent 处理意见后再让其在专用草稿副本中编写。已有大段文案、接入/首次任务提示、命令、模板占位符与交互 ID 保留，所有文字变更由 iclaude 执行；主 Agent 原样复制成稿，记录来源与摘要。

## 影响

只改官网模板与验收文档；产品二进制、HAPI、Skill、docs/usage.md、package.json 保持 1.1.3 冻结输入。基于当前源码核对能力，不新增真实手机或模型验证承诺。

## 验证

静态构建与既有 15 项发布检查；Playwright browser-only 检查三页、五宽度、复制/无 JS/锚点与截图，补查新增入口/内容布局。正常 main/Pages 部署后核对八文件摘要/MIME及三页，再同步 Specs 与归档。
