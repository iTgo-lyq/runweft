# HAPI 通道授权验收

2026-09-30 按用户持续授权由主 agent 自动完成本地验收。

## 结果

提供独立的 `createAccessGateway`，可组合现有 HAPI，统一 HTTP、Socket.IO、终端、SSE 和文件授权；HAPI 源码和两个内置 runtime 没有修改。普通身份、机器凭据和任务凭据不取得 root；机器执行授权与任务内容所有者分开。schema v8–10 增量保存授权映射、文件预约与原生 ID 归属，旧行不自动认领。

| 验证 | 结果与证据 |
| --- | --- |
| 类型与全套单测 | `bun run typecheck` 通过；`bun run test` 191 pass / 0 fail / 3892 expectations / 28 files；`.dev-smoke/reviews/hub-hapi-access/t4-tests.log` |
| 默认产物构建 | `bun run build` 通过，现有 CLI 仍可运行；本阶段不切换默认服务 |
| 新网关编译 | 两个独立 smoke 通过 `bun build ... --compile` 编译到 `.dev-smoke/reviews/hub-hapi-access/{http,realtime}-smoke`，将网关及 Socket.IO 依赖实际打包 |
| 编译后 HTTP/文件链路 | `.dev-smoke/hub-access-TKn4Et/evidence.json`，12 组通过；真实配套 HAPI，包含嵌套附件引用、同 tag、跨 owner 机器执行、幂等/重启、文件流撤销、原子清理和无凭据日志 |
| 编译后长连接与 Runner | `.dev-smoke/hub-realtime-gRqsi0/evidence.json`，10 组通过；真实未改造 Runner 登记/心跳/目录 RPC，原生 HAPI Socket/终端/SSE；45 秒真实机器失活后的跨机器回退被拦截 |
| 结构与源码边界 | validate-change、git diff --check 通过；HAPI 子模块保持原 pinned revision 且无修改 |

逐场景证据见 [授权矩阵](validation-matrix.md)。测试目录及编译 smoke 为专用临时证据，不提交，不修改当前用户配置、模型凭据或在线 Hub。

## 明确范围

- 终端、Claude fork/bootstrap、Codex 共享 fork/clear 的子进程端使用协议 fixture；验证原生 Hub 的真实时序和数据流，无模型或真实 PTY。真实模型执行留给阶段 5 的两宿主/两 runtime 组合回归，不能用本次结果代替。
- 新组件尚未接入默认 `serve`。旧服务仍运行旧认证；已交付模块的安全边界不代表旧部署已完成多用户迁移。阶段 5 负责接入、历史归属和原生文件按 owner/space 的迁移，阶段 6 提供统一 Web 入口。
- 机器/runtime 的注册、分享和治理 API 属于阶段 3；本阶段提供可信服务方法，未开放让任意客户端写授权表的接口。
- 物理远端、Mac 实机和四平台最终发行在完整集成阶段按既有约定验证；不阻塞本授权模块的独立验收。
