# HAPI 授权入口核对

> 更新：2026-09-30。配套 HAPI：`3ac8b08b2aead13e9eaae459de62d9a5d5df7395`。

## 代码证据

- `hapi/hub/src/web/routes/auth.ts` 的根 token 可附加 namespace，换取 4 小时 JWT；其 uid 是部署者 ID，不是 Runweft 用户。
- `/cli` 同样接受根 token 与 namespace。HTTP guard、原生 session/machine 库和 SSE 按 namespace 隔离，没有 Runweft 用户/成员/对象归属。
- `src/proxy.ts` 目前将其他 HTTP 及全部 upgrade 透传，因此只保护 Hub 配置 API 不能形成执行边界。
- `/cli` Socket 握手可以指定 machineId/sessionId，`rpcHandlers.ts` 对 RPC method 未检查对象归属。终端已有 session/namespace 检查，仍没有新的用户授权。
- `/api/storage/sqlite` 导出原生库；原生配置、全局统计和未映射的导入入口不能直接开放给普通用户。
- HAPI `spawnSessionWithReceipt` 先持久保存 requestId/sessionId，再执行机器 RPC；等待机器启动时可查询回执。这为执行前绑定所有者提供了现成依据。CLI 的 adopt 接口可以采用这个预分配 ID。

## 真实验证

专用 HAPI 二进制实例，没有使用在线 Hub、模型账户或用户配置。原始脚本与结果位于 `.dev-smoke/hapi-access-research/`。

`probe-wKz6M1/evidence.json`（整合前次 `probe-qdXln9`、`probe-0xCQcb` 和 `probe-aNRYwz`）确认：

1. 注册 machine-a 的原生 Socket 可以注册 `machine-b:list-directory`，随后机器 B 的原生 HTTP 请求到达 A 的 handler，返回 200。证明仅凭根 token/namespace 不能限制 RPC 所有权。
2. 使用现有 Socket.IO 4.8.3 服务端/客户端作连接转接，原生 HAPI ping/ack 在 WebSocket 与 polling 两种传输均成功；无需修改 Engine.IO 帧、Codex/Claude launcher 或 HAPI 协议。

3. 未修改的真实 HAPI Runner 使用专用目录，通过 Socket 转接成功登记、心跳上线，并完成原生目录 RPC 的双向 ack。没有调用模型或访问用户工程文件。

4. 在机器 spawn RPC 尚未 ack 时，原生 spawn receipt 已能查询并返回同一预分配 sessionId；随后 CLI adopt 成功。该协议测试未启动模型进程，验证的是可以先绑定再放行的时序。
5. 原生 HAPI 终端登记及输入/输出 handler 经过转接可用；使用模拟 CLI 的协议数据，没有启动 PTY 或模型，不代替最终原生任务验收。

这不是完整授权验收：尚需实现对象判断、SSE/上传撤销与重启验证。首次探针错用 `rpc-call` 而非原生 `rpc-request`，请求超时；修正事件名后上述复现成功，不把首次超时当作隔离成立。

## 结论

优先使用 Runweft 授权网关：HTTP 选择允许的原生路由并检查对象；Socket.IO 库负责协议转接，Runweft 只检查握手、对象和 RPC scope。原生执行、会话与文件存储仍由 HAPI 管理。新授权网关先作为可独立启动验收的模块交付，阶段 5 切换正式服务；不同时把缺少身份迁移的旧 Runner 改接新凭据。

共享机器与不同用户的任务需要在同一内部执行 namespace 协作，因此不能把一个 namespace 当一个产品用户。对象归属由中心业务库保存，根 token 只在服务进程与 loopback HAPI 间使用。旧 namespace 未显式迁移前不自动出现在新授权域中。
