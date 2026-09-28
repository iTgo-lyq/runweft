# 执行能力与配套版本

Runweft 使用 package.json 固定的 HAPI revision 及配套构建，原有健康、协议版本和 Runner 诊断仍有效。当前执行封装只接受 codex/claude，不静默切换 runtime。

HAPI health 的 spawnReceipts:1 表示可重查启动；execution:1 表示本版本执行观察协议。会话 metadata.capabilities.execution:1 在对应控制器就绪后发布；归档后可保留用于历史查询，不证明会话仍活跃。缺少所需能力明确拒绝，提示更新配套 Hub/Runner。

HAPI 的 HTTP 状态、code 与错误被保留。只有 native_session_missing 是确认缺失；其他错误和未知执行状态由上层处理，不能解释成可安全重发。

Codex/Claude 内置启动、配置、审批和会话管理继续复用 HAPI。补充的持久启动回执、原生事实、目标中断和已复现缺口修正均位于独立 HAPI fork；不支持 npm/path runtime 插件，私有 runtime 扩展不属于当前交付。

协议字段见 [HAPI 执行观察](../../../../../hapi/docs/api/execution-observations.md)。本地真实执行与故障注入证据见[验收记录](../../../archive/2026-09-29-hapi-subagent-foundation/execution.md#t4-配套构建与整体验收)。显式验证脚本为 scripts/smoke-execution.ts；它使用专用服务/项目并继承已有模型认证，不属于默认无凭据测试。本项验收不代替宿主 MCP、业务委派或真实远端验证。
