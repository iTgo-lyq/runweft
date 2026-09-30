# Hub 最终集成执行记录

## 执行环境

- 主执行者：TraeX 会话 `01a0f3d9-1ed7-7b33-a2f6-146c5e371e55`，GPT-6-Astra，xhigh；沿当前会话独立完成，不等待前执行者。
- 工作区 `/home/tiger/workspace/runweft`，分支 `codex/cli-foundation`；阶段六归档基线 `9f85353`，开始时干净。整体阶段七由本父 Change 承担，不是第五阶段内部 T7。
- 当前 HAPI pin `3ac8b08b2aead13e9eaae459de62d9a5d5df7395`，0.30.7/protocol 1，子模块不修改。全部临时证据在 `.dev-smoke/`，用户全局配置、模型原件、在线 Hub/Merlin 不动。

## 方案评审

正式 Technical/Plan 已建立，纠正父需求中已被用户取消的旧数据导入验收，改为有界显式 reset；版本定为 1.1.0，避免与旧认证 1.0.0 产物混淆。

iclaude 首次进程因变长 `--mcp-config` 参数吞入末尾 prompt，在模型启动前退出；错误保存于 `.dev-smoke/reviews/hub-final-release/stderr.log`。加入 `--` 后重启同一次只读评审，输出路径为同目录 `review.json`。仅允许 Read/Grep/Glob，禁止编辑、模型实测、子 agent 与读取临时凭据。

评审会话 `5146b7ab-98a3-4f75-8f66-25568718eee5`，385217 ms、51 turns，is_error=false，无阻塞、七项非阻塞意见。独立采纳：连接 smoke 改编译服务（评审期间主 Agent 已发现并补方案）、各入口显式传平台二进制并记相邻 hash、dirty=false/固定包输入差异/按源码revision归档、reset运行中拒绝与保留字节、Skill相同内容才复用独立场景、QEMU记录当前命令。未采纳“不测1.0.0→1.1.0”：本机已有阶段六 Hub/schema18 的1.0.0真实编译程序，并非旧root版；已保存到 `.dev-smoke/final-baseline-1.0.0`，hash及来源见 provenance.json，可在专用新数据上真实升级，不扩展兼容框架。

方案与Plan按持续授权确认，开始串行 T1。没有再次调用 iclaude 或另开代评 subagent。
