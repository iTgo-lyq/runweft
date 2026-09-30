# 授权验收矩阵

> 本阶段逐项通过，编译程序真实证据为 HTTP/文件 12 组、长连接 10 组，入口见 [验收](acceptance.md)。下表“原生顺序协议测试”不代表真实模型执行。

| 场景 | 判定条件 | 层级 |
| --- | --- | --- |
| A 的机器承接 B 的可信意图，C 无关 | B 的 spawn/adopt/消息/终端成功，A/C 用户列表、详情与 SSE 无内容 | 真实 HAPI + 协议执行端 |
| 带与不带客户端 requestId 的 spawn | 内部 UUID 去冲突；回执在 RPC 完成前可绑定；不同 owner 不能抢占 | 真实 HAPI |
| 非共享 Claude fork 时序 | Hub 创建子行后、HTTP 完成前，机器可以登记子会话；用户归属为 B | 阶段 2 原生顺序协议测试；阶段 5 真实 Claude |
| Codex 共享 fork/clear 时序 | 非 adopt bootstrap 不归机器所有者；只接受有效 source/machine 派生意图 | 阶段 2 原生顺序协议测试；阶段 5 真实 Codex |
| B 的绑定机器离线，C 同 host 在线 | resume 不向 C 发送 RPC 内容，包括前置在线检查后掉线的窗口 | 真实 HAPI + 可控 Runner |
| 未绑定会话的事件与重放 | A/B/C 都不可见；绑定后 B 被要求刷新或收到可见事件，A/C 仍不可见 | 真实 SSE |
| RPC 注册和注销他人前缀 | 机器与 session 两种 scope 均拒绝；自己的原生 RPC/ack 成功 | Socket.IO WebSocket + polling |
| 机器 JWT 与用户 JWT | 机器只可读/操作已分配会话的 peer 路由；不能进入用户管理或其他机器 | 真实 API |
| 原生 ID 去重、metadata.machineId、forkedFrom、tag、嵌套附件 ID 伪造 | 不取得另一对象、执行机器或附件权限；不能认领未迁移的旧行 | API + SQLite |
| identity 轮换、机器撤销、移除成员 | 既有 Socket/SSE/文件流停止交付；新请求无效；身份不混同 | 真实流、定时检查 |
| spawn 响应丢失与网关重启 | 同一意图重查同一 session；不自动重复启动 | 故障注入 |
| 上传/下载及 SSE 背压 | 不缓冲整个大文件；撤销/断开取消上下游，权限内传输保持字节一致 | 真实流 |
| 升级旧入口与未知路径 | 根 token/HAPI JWT、未知 namespace、其他 upgrade、库导出和全局配置不能绕过 | 真实 HTTP/Socket |
| 配套原生 Runner | 专用目录登记、心跳、目录 RPC、退出清理通过；凭据不含根 token | 未改造的真实 Runner |

阶段 2 不把模拟 CLI 当成真实模型执行；阶段 5 必须补齐两宿主/两 runtime 的完整回归。普通用户不开放原生全局 storage/hubSettings/usage/devices/push/voice/workGraph、Codex Desktop 导入及不支持的其他 runtime 管理接口；原生会话界面的这些非 Runweft 功能不属于新授权网关的开放面，阶段 6 导航需与之相符。支持路由及 SSE 事件清单固定到配套 HAPI 版本，升级必须触发重新审计。

别名核对：当前 pinned HAPI 的 session access 按原 ID 查找，去重删除旧行，不提供独立 alias 重定向；真实跨人风险在原生 ID 合并，已补归属声明及跨 owner/机器/空间、未知旧行测试。HTTP 仍核对返回 canonical ID，以免未来底座变化静默扩大权限。
