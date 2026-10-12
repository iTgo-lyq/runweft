# 一键完整卸载执行概况

## Plan 评审

- iclaude 只读评审会话 `ff08266e-4108-42da-bd9b-8e91fe2dc187` 成功，耗时约 12 分钟；未耗尽额度，未使用 subagent。有关进程、跨 home 接入、Skill/Git 元数据与 npm 时序的必要意见进入 Technical；主 agent 落实并自动验证。

## T1 完整卸载实现与删除边界验证

- 结果：根级 uninstall 默认预览、--yes 执行；核对 npm/独立平台包归属，MCP 无备份编辑及内存回退，保护 home/Skill/源 Git 边界，直接调用已存在的 HAPI 控制接口。进程检查包含恢复记录、程序 realpath、父进程链及控制端口实际所有权；保留其他配置/模型凭据，拒绝未知状态。
- 验证：`bun run typecheck` 通过；`bun test ./test/uninstall.test.ts ./test/mcp-install.test.ts` 15 项、169 个断言通过，真实编译 CLI 子进程执行独立包卸载，验证预览、源项目与用户分支、符号链接、另一 home、配置回退和原有备份行为。Hub/Runner/npm 真实安装在 T2 验证。
- Commit：`complete-uninstall T1: add guarded complete uninstall without backups`
