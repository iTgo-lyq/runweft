# 机器与 Runtime 归属研究

2026-09-30，本阶段读取既有实现与已验收授权模块，不重新调查已通过的 HAPI 通道。

## 已验证基础

- `src/resources/service.ts` 已用 HAPI 完整库存、`agent-availability?details=true` 和原生名称更新；工具探测能区分 preflight、实际命令及版本状态，注册/解析后重读登记，列表每机探测一次。`src/resources/store.ts` 只有旧 namespace 范围，没有 owner/空间共享或治理。
- `src/hub/access` 已验收：机器 ID 必须先有可信绑定才能用独立机器 token 登记 HAPI；公开机器 API 仅机器所有者可控制。业务回调可接用户 JWT，而不能将用户可见 runtime 直接变成机器操作权。
- 真实未改造 Runner 可从独立 settings 中使用已分配 machineId 和 opaque token；启动、心跳及目录 RPC 已通过 `.dev-smoke/hub-realtime-gRqsi0`。注册衔接可以由 Runweft 预分配 ID/凭据完成，不需要新增 HAPI 注册协议。
- HAPI 的真实机器详情、工具绝对路径和终端权同属原 namespace；“向空间共享某个 runtime”和“仅概要治理”是其现有接口没有的业务权限，必须在 Runweft 资源服务过滤，不能给共享用户原生机器 JWT 或原样返回机器详情。
- 当前 CLI 的 ResourceClient 会由旧 Config 构造 HapiClient，且默认服务仍是旧认证。新资源领域先组合独立网关，提供明确的 Hub 管理 CLI 和 typed client；默认连接/Runner 切换属于阶段 5，不能给旧入口拼一层 owner 后视作完成迁移。

## 工程取舍

- 机器与 runtime 全局于同一个 Hub，空间关联仅是授权边界。机器关联空间不自动共享 runtime，runtime 默认私有；所有者可逐空间开放使用。
- 治理禁用限定当前空间。管理员不能通过治理更改其他空间的资源，也不取得私有 runtime 的调用、路径或配置编辑权；禁用记录独立保存，所有者开关分享或恢复登记不抹去禁用。
- 创建机器使用按所有者限定的 enrollment requestId，Hub 分配新的机器 ID。接入客户端先产生并落盘机器凭据再提交，服务器只存摘要；相同请求恢复原 ID，丢响应不重建身份。自报旧 machineId 的认领属于显式迁移，不在普通注册路径提供。
- 拆出既有原生工具探测的可复用函数，旧 ResourceService 与新的权限服务共用。保持命令、版本、状态和原生执行来自 HAPI，不创建 launcher/profile/心跳体系。
