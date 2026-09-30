# HAPI 通道的身份与对象授权

> 状态：待验收
> 规模：大型
> 前置：[身份与空间](../../archive/2026-09-30-hub-identities-and-spaces/requirement.md)
> 更新：2026-09-30

## 目标

沿 [授权契约](../hub-spaces-and-agent-configuration/access-design.md) 让 Web/CLI/MCP、原生 UI、Runner 与结果通道遵守同一对象授权，复用 HAPI 的执行和原生状态。

## ADDED / MODIFIED

- 可信映射 user/space/机器/任务到 HAPI namespace/对象；明确普通用户、机器与任务凭据各自能力，不向用户或 Runner 下发 Hub 根 token。
- HTTP 列表和详情、文件/终端/RPC、SSE、Socket.IO 的认证、对象检查与撤销；未关联业务任务的原生 session 必须有确定归属。
- 禁止通过旧 `/api/auth`、`/cli` 或升级连接绕过上层权限；长连接撤销不只在下一次握手生效。

## 边界与验收

先以本地真实 HAPI 验证现有入口和具体缺口；需要通用认证入口增补时在独立 fork 实现，不改 Codex/Claude launcher，不另造原生执行协议。资源共享的产品规则归下一 Change，本 Change 提供可验证的执行边界。

验收两身份/两空间，直接访问与流式订阅均隔离，撤销后现有连接失权；普通用户不能取得底层 root/机器控制权，授权的原生会话与终端仍可用。Technical/Plan 在证据齐备后形成并用 iclaude 评审。
