# HAPI 通道授权技术方案

> 状态：已确认
> 来源：[需求](requirement.md)、[核对证据](research.md)
> 更新：2026-09-30。主 agent 按既有授权决定工程细节；实施前进行 iclaude Plan 评审。

## 边界与交付方式

新增 Runweft 授权网关，使用配套 HAPI 的 HTTP 和 Socket.IO 接口，不修改内置 runtime、Launcher、会话协议或文件库。HTTP/Socket 的对象权限来自同一业务库。Socket.IO 4.8.3 客户端与服务端成为直接依赖，用库转接事件和 ack，不自行实现帧、RPC、终端或重连状态机。

本阶段提供可与真实 HAPI 组合启动的独立网关及集成验证。现有 serve 的默认切换与旧凭据迁移属于阶段 5；切换前不将新 token 传给旧网关，不宣称现有部署已经完成多人隔离。新网关没有旧 token 透传模式。HAPI 只监听 loopback；新网关失败时不旁路连接底座。

## 主体、凭据和对象

业务库增量保存机器/任务凭据、原生对象归属、执行发起意图。随机凭据使用 32 字节随机值、类型前缀及 SHA-256 摘要；不保存明文。用户继续使用已有 identity token，不另建账户。机器凭据绑定一个机器 ID 和所有者；任务凭据绑定确定任务及机器，供 Runweft 自身的传输/协同进程访问已分配附件，不能登记机器或调用配置 API；不宣称原生子进程会持有它。原生 Runner 和子进程继续使用机器凭据，网关按已分配会话限制其访问。机器注册/共享产品 API 由阶段 3 提供，阶段 2 暴露内部签发/撤销方法供集成与自动测试使用。

schema v8 在同一 state.sqlite 增加四张表：`hub_execution_objects`、`hub_execution_credentials`、`hub_execution_grants`、`hub_execution_intents`。schema v9 增加 `hub_file_reservations`，保存发布者限定的客户端请求键、内部 UUID、可信交付许可与原生附件 ID。成员移除同时取消未完成文件许可；重新加入仅允许所有者恢复历史文件，不恢复机器传输权。回执重查不重新授予已撤销的 grant。不复制原生会话/消息/文件。对象 kind 包含 machine/task/session/artifact；task 是业务授权锚点。附件的机器/任务读写须有单独的方向性 grant，绑定到具体凭据，可独立撤销。

对象记录包含 kind/id、ownerId、可选 spaceId/taskId/machineId。主键是 kind/id；已有归属不能通过 upsert 重写。task 关联对象有同一发起人/空间，机器全局归属不以空间替代。资源共享不等于任务内容共享，阶段 2 不提供自动共享会话的路径。

用户只能读写本人拥有且仍属于其空间的对象；未关联空间的本人原生会话仍可访问。机器凭据仅控制绑定的机器，执行该机器已分配的会话及文件操作。机器操作者能读取执行现场，这是既有 OS 信任边界，不因拥有机器而在用户 API 获得他人任务内容。任务凭据不能取得机器管理权。

会话和机器共用内部 HAPI `runweft` namespace，以便共享执行资源。附件独立映射到由服务端按 owner × space 计算的 HAPI namespace；这样直接复用原生列表、用量、配额和原子清理，不在网关重建文件到期判断。跨机器附件访问从可信对象归属选择对应 namespace，客户端不能提交 namespace。产品 user/space/task ID 不作为外部可任意选择的 HAPI namespace。Runweft 业务任务仍按可信 user × space 范围管理；阶段 5 的内部 HapiClient 分离业务范围与执行 namespace。

## 认证和长连接

新网关 `/api/auth` 接受 identity token 或受限机器/任务 token，签发短期 Runweft JWT，保留原生 UI 所需的 token/user 响应结构。JWT 有效期 15 分钟，使用部署秘密经 HMAC 用途分离的密钥及独立 issuer/audience，引用凭据摘要及稳定主体；可绑定当前空间。兼容 UI 的数值 uid 不承担授权，稳定 userId 才是归属依据。每个请求、双向事件和 ack 再核对当前凭据及成员关系；轮换 identity token 会使其旧 JWT 立即失效；独立机器凭据由其显式撤销入口管理，不随用户 token 自动换号。成员移除同时撤销该空间的任务凭据并取消派生意图，重新加入不会复活这些执行权限。外部根 token、HAPI JWT、任意 namespace 后缀和未知认证方式均拒绝。

JWT 只用于外层，向 HAPI 请求时换为内部 JWT；`/cli` 内部使用根 token。内部 token 不出现在外部响应、Socket auth、错误或日志。浏览器 SSE 只能使用短期 JWT 的 query token；长期 identity/机器 token 不接受于 URL。原生 UI 登录接管与 Web 到 CLI 接入在阶段 6 接通。

撤销后每次数据交付/写入都拒绝；空闲 SSE/Socket 用定时检查关闭，最长 1 秒。流式文件上传和下载也需中止，不能只在请求开始校验。连接中保留的授权对象 ID 每次重查，不缓存可撤销权限。关闭网关清理上下游连接和计时器。

## HTTP 路由与可信绑定

采用明确的路由/方法表，未知 `/api`、`/cli`、upgrade 不透传。会话详情/消息/审批/文件/终端及机器控制，先查对象后发原生请求；相同不存在/越权对象返回 404。列表在可访问对象集合内生成或过滤后分页，不能先使用 HAPI limit 截断；总数、引用、游标和错误不得暴露他人对象。原生库导出、全局设置和未实现归属映射的入口不开放，返回明确错误。

机器登记仅允许凭据绑定 ID；内嵌 machine 也检查。只有没有任务/派生来源的原生新会话属于机器凭据所有者；带 forkedFrom 或已有 ID 的会话不能落入这个默认分支。tag/requestId 使用主体限定，防止客户端碰撞加载他人对象。元数据、parentId、ownerId 和客户端提供的 session ID 都不是归属证明。旧原生对象未映射前不可读、不可认领。

受控启动在发送 HAPI 请求前持久保存派生意图（源会话、类型、有效窗口、owner、space、task、machine）。spawn 意图为客户端 requestId 分配独立的内部 UUID，缺 requestId 时生成；不透传客户端 UUID 碰撞整个执行域。HAPI 已预分配的 session 通过原生 spawn receipt 核对后绑定，再允许 CLI adopt/Socket 连接。响应丢失以同一 requestId 查询，不能盲目重启。执行意图与绑定可重入、不可换所有者。还未绑定的原生事件不对任何用户暴露；失败留下可重查意图。fork/clear/reopen/resume 在调用前记录源会话与执行机器。机器首次提交子会话时核对未决意图：Hub fork 行通过内部读取的 parent/machine 与意图匹配；共享 Codex 的非 adopt bootstrap 要求同一受信机器正在执行该 source 的 fork/clear，才采用 forkedFrom 继承归属。客户端字段单独不足以认领；歧义或过期意图拒绝，不默认为机器所有者。用户侧在绑定前不可见；绑定后 SSE 强制 gap/刷新，避免漏掉此前过滤的 session-added。

恢复前检查绑定机器在线；更关键的是在实际下发 spawn RPC 时检查 reservedSessionId/existingSessionId 对应意图或已绑定会话的 machineId 必须等于目标机器。原生 HAPI 按 host 回退到另一台机器时，网关在数据送达 Runner 前拒绝，不能只靠发起前在线检查。所有权不随元数据变化，机器迁移也只能由可信协调操作改绑定；原生 metadata.machineId 不直接重写授权。后续真实复现若仍有网关无法拦截的通道，再按需求在独立 fork 补最小通用认证入口。

附件字节、校验、额度、引用和清理由 HAPI 完成。网关登记预约 ID，检查读取/上传对象和引用关联，机器仅访问明确授予其执行的附件。业务协调器的跨机器输入/成果分配由阶段 5 调用本阶段的可信绑定方法，不开放任意用户写授权表。附件列表/清理只作用于当前用户 × 当前空间对应的文件 namespace；机器/任务凭据不允许 prune。跨空间或跨用户的附件字节访问仍须显式对象授权。每个机器上传 requestId 要有协调器预先登记的交付许可，不能将未知机器输出默认归给机器所有者。预约结果中的 requestId 保持客户端原值，内部 HAPI requestId 由中心映射。迁移旧附件时需按明确归属复制到目标文件 namespace，并保留源文件和映射记录；旧共享 namespace 不直接冒充某个新用户的文件库。

## Socket 与 SSE

外部 `/cli` 只接机器凭据；用户 JWT 只接 `/terminal`。机器 JWT 的 `/api` 限于已分配本机会话的列表、详情、消息和受控恢复，供原生 list_peers/ping_peer；不能访问用户配置、其他机器或终端查看入口。每个外部 namespace 连接对应一个内部连接，内部连接建立成功后才完成外部握手；auth 中的 session/machine 必须符合主体，不原样转发其他字段。

CLI 事件检查 sessionId/sid、machineId；RPC 注册/注销只能使用已授权对象 ID 前缀。原生 RPC 内容仍由 HAPI 处理，不因共享 runtime 放行任意机器控制。双向 ack 只桥接一次，回调时再次鉴权；断开不重发业务事件。终端以创建/订阅时验证的 session 为准，并记录 terminalId 到 session 的关联；write/resize/close 和输出再次检查。未知事件拒绝，版本升级需重新核对事件表。

SSE 请求上游显式禁用压缩，通过原生流读取事件，按当前 session/machine 归属过滤，包括重放；控制事件只保留无敏感内容的连接状态与心跳。visibility/subscriptionId 绑定外部连接主体。采用增量解析和背压，客户端断开时取消上游；不复制 HAPI 会话状态或另建业务事件总线。

## 验证与后续集成

先测试持久主体/对象/撤销，再用真实 HAPI 验证 HTTP、文件和 Socket/SSE。覆盖两用户两空间、伪造字段和 ID、旧认证入口、跨机器 RPC、alias/adopt/tag/请求重放、主动撤销后无新数据、服务重启与不确定启动结果。原生 Runner 心跳、机器目录 RPC、会话消息与终端必须成功，不能只有拒绝测试。

具体场景见 [验收矩阵](validation-matrix.md)。基础检查为 typecheck、仓库测试和 build。专用服务/SQLite/Runner 数据放 `.dev-smoke`，不改在线 Hub 或当前 Codex/Claude 配置。阶段 2 不要求真实模型任务；阶段 5 验证两宿主 × 两 runtime 的完整执行和迁移。无新增用户决策或外部凭据前置。
