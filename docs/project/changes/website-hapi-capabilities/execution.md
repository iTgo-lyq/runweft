# 官网 HAPI 能力执行记录

## 方案评审

iclaude session `b3378282-93dd-43a4-93f0-bec1c3d5ac31` 成功完成 Plan 评审（53561ms）。采纳其六类意见，事实定向核对见 research.md；能力介绍不沿用上游所有功能，不新增图片/资源或出站 HAPI 链接。用户延续全篇 iclaude 文案要求；主 Agent 不改写面向用户的文字，发现问题回交其修改。

## T1 补充原生执行及 HAPI 体验文案

- 基线：三页桌面/手机截图已记录；新增内容沿用原样式和首屏，原始证据在 `.dev-smoke/website-hapi-capabilities/`。
- 成稿：iclaude session `10f4318b-2bd2-472e-b6d0-fbeee9006fc5` 完成首页和指南增补，session `dffc1554-d436-4a9e-b9ef-4f1d132db3fa` 修正 UI 状态标签、拒绝审批的可能结果和实时文件在线条件。三次调用都成功，未经 GPT 改写；模板与最终草稿逐字节一致，来源和摘要见临时 `authorship.json`。
- 结果：首页 `#native-experience` 说明原生配置、权限、会话续接及 HAPI 浏览器体验；指南 `#native-session` 给出真实按钮路径、浏览器审批、在线文件、主 Agent 续接及手机网络/身份条件。首屏、接入提示、首项任务、CLI 命令、已有 ID、CSS/JS/图片和版本保持原样。
- 验证：构建、15/15 发布检查、既有 Playwright `--browser-only` 通过，覆盖三页五宽度、25 个本地链接/锚点、复制/键盘/无 JS。六种宽度首页首屏与 CTA 边界和改动前逐项相同；新增入口和无 JS 指南可达，桌面/手机截图已查看。原始完整证据 `/home/tiger/workspace/runweft/.dev-smoke/website-Sqwlcv/evidence.json`，本次副本 `browser-evidence.json`；定向结果 `after/native-evidence.json`。
- 事实：归档后的原生消息历史可读；主 Agent 有 respond_to_permission，仍受用户授权。文件/diff 依赖会话 RPC 在线；当前 Claude 拒绝请求可能结束本轮。依据来自当前实现与既有 Specs，本次不新增模型或真机执行证明。
- Commit：`website-hapi-capabilities T1: explain native execution and HAPI session features`。
