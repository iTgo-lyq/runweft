# 一键完整卸载实施计划

> 来源：./requirement.md
> 技术方案：./technical.md
> 执行模式：逐任务提交

## 交付目标

一条显式 CLI 命令清除 Runweft 安装、接入及选定本机数据，不留备份，保留其他软件和用户源项目。Plan 按既有授权由 iclaude 评审一次后主 agent 落实。

## 任务

### T1 完整卸载实现与删除边界验证

- 交付：根级预览/执行、安装归属、无备份 MCP 编辑、服务与受管工作树清理、专用 Skill/data 清除与可操作失败。
- 验收：危险路径与未知归属预检拒绝；正常卸载无备份并保护原生配置/凭据和源项目；既有 MCP 备份不变。
- 验证：聚焦删除/MCP 测试、typecheck、编译 CLI。

### T2 实际安装自动验收与维护说明

- 交付：专用 npm prefix 的真实安装卸载闭环、运行中 Hub/多 Runner、独立平台包及失败/重试验收；更新使用说明、产品 Skill 与必要官网操作文字。
- 验收：真实执行后程序/data/MCP/Skill 全部消失；保留项摘要一致；预览零副作用，服务退出。说明不把当前公开 1.1.3 称作已有此命令。
- 验证：本地安装 smoke、bun run typecheck、bun run test、bun run build；文案与构建定向检查。

## 整体验证

- 按 Requirement 每项验收映射到测试/真实证据，保存脱敏摘要；验证后同步 installation/cli、installation/mcp、installation/skill、deployment Specs 并归档。
- 不自动卸载开发者当前环境，不推送或发版；真实平台范围明确记录。

## 执行顺序

按原任务依赖及既有 Plan 顺序迁入；未重新安排历史执行。

| 任务 | 前置任务 |
| --- | --- |
| T1 | 无 |
| T2 | T1 |
