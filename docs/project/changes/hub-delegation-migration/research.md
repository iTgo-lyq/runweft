# 委派接入与迁移调查

> 2026-10-01。前四阶段已验收；当前调查支持 [Technical](technical.md) 与 [Plan](plan.md)，尚未切换默认服务或在线数据。

## 已核对的接口

- `src/config.ts` 目前 schemaVersion=1，mode local/hub 决定服务部署和 targetUrl，local 连接名固定为 local。hub 只保存 url/tokenEnv。默认配置没有用户身份或空间；当前 paths 的机器 native home 也随旧模式命名。
- `src/hapi.ts` 的 accessToken/local clientEnvironment 仍把托管 HAPI root token 或旧客户端 settings 作为运行凭据；HapiClient 把 namespace 同时用于原生连接和业务范围。新 HubClient 已有显式 origin、身份备份校验、短 JWT、能力检查和脱敏，可复用，不应复制其读取凭据实现。
- `src/api.ts` 的默认业务入口验证旧 HAPI JWT uid/ns；非自有路由沿旧 proxy。独立 createConfigurationGateway 已经组合身份/空间、执行通道授权、机器/runtime、仓库与 Agent；默认入口切换必须整体切换，不能只换任务按钮而保留 root 路由旁路。
- `src/tasks/client.ts` 目前本机读 Agent YAML 后把快照送给服务端；TaskCoordinator.accept 只重查旧 namespace 下的 runtime，而未校验中心 Agent。新路径必须在服务端自己解析中心定义，不能信任传入的 snapshot。Task/Round 需保存发起人/空间/hubRepositoryId 与内容版本；现有 task.namespace 是旧业务和原生连接混合概念，不得冒充用户身份。
- `src/tasks/coordinator.ts` 已具备接受幂等、串行轮次、准备/启动/观察/停止/收尾、同 session 续接、原生缺失历史重建、文件与代码回收。`TaskStore` 和各原生领域 helper 可保留；不另建第二个执行循环。
- `TaskWorkspaces` 的 resolve/prepare/inspect/finalize/remove、TaskFiles 的冻结/pin/materialize/release 等直接消费 HAPI 既有 API；Git 与字节持久化归 HAPI。TaskFiles 在接受前会访问输入对象并 pin，新的 owner 权限必须覆盖这一窗口，而不只覆盖最终 spawn。
- `NativeSessions` 已有可信 dispatch intent、native ID 认领、防止跨 owner/space 合并历史、派发前资源策略。公共 `/api/machines/:id/spawn` 仍要求机器 owner，且显式拒绝 preparedFiles/preparedWorkspace；这是为后续受控任务协调器保留的边界。共享 runtime 的执行不能通过授予调用者整个机器 write 权绕过它。
- 独立网关公共机器路由不提供任意 workspaces/artifacts/export RPC；task 凭据不能调用普通原生会话接口。新的协调器到原生的可信调用需要接上已有对象/许可账本，不能简单给公共用户 JWT 放开机器路径。
- 中心仓库 UUID 与 HAPI source.repositoryId 分层已经验证；前者进入 hubRepositoryId，后者继续用于固定基线/worktree/bundle。客户端 checkout 路径是配置观察，不能直接作为远端执行证明。

## 接入待形成的技术细节

- 本地模式表示自托管 Hub；业务委派始终要显式 Hub 连接、用户身份、所选空间与机器接入。不得通过读取本机 HAPI root 自动完成用户认证。启动 Hub 与登记/启动 Runner 分开，机器/runtime/Agent 三种对象仍分别登记。
- Web 持有身份原 token，Hub 只存摘要，因此不能让 CLI 从摘要“取回”明文。需要一次性、过期、明确确认的程序化接入交接，凭据写到同一数据根的 origin 专属文件，不进入模型对话。研究现有身份 Web 后再选择最小完整的传递方式，不引入注册/登录服务。
- 协调器优先保留现有 TaskStore/TaskCoordinator/helper，注入中心解析和授权检查；原生传输的逻辑业务范围与 HAPI namespace 分开。接受、异步准备、真正 RPC 派发、新轮次、结果读取分别核对现行权限；授权撤销不能伪造已停止。
- 继续读取文件许可与原生 RPC 桥接，再确定受控任务如何复用 dispatch intent 和限定附件许可；不向调用者暴露 root 凭据或任意机器操作。

## 迁移待验证事项

旧 namespace、机器 UUID、原生 session ID、任务/附件/基线记录需要明确归属映射。已有 Git worktree 和原生操作回执可能记录绝对目录，不能为了统一新连接名直接移动整个旧 native home。方案需要保留原目录或显式映射，并覆盖同一数据根的可读 paths 输出。

迁移应有只读预览、备份、显式应用和持久去重/继续记录；不自动删除 YAML 或猜历史用户。原生 HAPI 数据与 Runweft state 是不同数据库，需调查真实表关系与 namespace 使用，再确定停服迁移和中断恢复顺序。尚未对在线 Hub、用户配置或模型凭据进行修改。

## 补充验证和收敛

- `src/hub/access/sockets.ts` 在真实 SpawnHappySession RPC 发出和 ack 时均调用 NativeSessions.checkExecution；这里已有固定机器和资源检查，任务 binding 可供上层追加策略，不需要改 HAPI Runner。
- `FileAccessStore.permit` 已提供可信中心先分配 output 的入口；机器 reserve 后产生用户归属并授予当前凭据字节权限。现有用户 lookup 按 sender 检索，中心接线需要按可信 owner/space 查询分配给 Runner 的同一预约；不能错误改成所有机器共享文件 namespace。
- TaskStore.accept/append 的 JSON 分别保存 Task 和 Round；当前新轮次没有自己的 Agent 快照，starting 使用 task.agent。新增 round 快照必须同时覆盖 instructions 与启动参数，并处理不能原地改变模型的 resume 情况。
- `hapi/hub/src/store/index.ts` 中 machines、sessions 的 ID 为全局主键，spawn_receipts 的主键为 namespace/request_id，artifacts 为全局 ID 加 namespace/request_id 唯一；events 等也包含 namespace。迁移需要实际列/唯一约束检查，不能只改 Runweft task.namespace。
- `hapi/hub/src/artifacts/service.ts` 的物理路径是 root/sha256(namespace)/artifactId；`artifactStore.ts` 的 fingerprint 不含 namespace/requestId。方案选择备份后复制并校验字节、显式更新预约与归属，不修改 HAPI 源码。
- 身份 Web 只在 sessionStorage 持有原 token，Hub 只持摘要；采用 Web Crypto RSA-OAEP 把 token 交给请求本机公钥，CLI 校验身份后原子落盘。此为短期交接，不建立登录/注册或第二套账户体系。
