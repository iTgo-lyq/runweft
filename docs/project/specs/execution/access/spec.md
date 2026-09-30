# 原生执行通道授权

默认 serve 通过授权网关复用现有 HAPI HTTP、Socket.IO、终端与 SSE，不修改 runtime、Launcher、会话或文件执行。私有 HAPI 只监听 loopback，公开请求使用 Runweft 主体和对象权限。

## 主体与持久归属

- 用户使用稳定身份 UUID，身份 token 可交换为用途分离的 15 分钟 JWT，支持选定空间；每次使用都重新核对凭据、到期时间和当前成员关系。HAPI root/JWT 不能替代它。
- 独立机器 token 绑定一个机器；原生 Runner 和子进程继续持该凭据，受限于分配给该机器的会话。用户内容归属不随执行机器改变，机器所有者的用户 API 不能读取别人的任务内容。
- 任务 token 只读本任务概要和访问显式分配的附件；不能登记机器、控制原生会话或进入用户管理 API。机器/任务 token 服务端仅存摘要，可独立撤销。
- 用户只访问本人且仍具成员资格的会话/附件；空间管理角色不额外取得他人的执行内容。机器、任务、会话、文件绑定不可通过客户端元数据重写或抢占。
- 同一业务 SQLite 的 `hub_execution_objects/credentials/grants/intents`、`hub_file_reservations`、`hub_native_session_claims` 保存授权和请求关联；原生消息、文件和执行状态留在 HAPI。

## HTTP、会话和文件

`/api/auth` 只交换 Runweft 凭据；`/cli` 只接受机器原始 token，`/api` 接受短期 JWT。原生路由和方法显式列举；默认/未知 Socket namespace、其他升级、旧认证旁路、原生库导出和全局管理接口拒绝。健康检查与静态页面不授予数据权限。

机器和会话共用内部执行 namespace。新会话先有可信对象绑定；受控 spawn 为调用者 requestId 分配内部 UUID，在原生 receipt 与执行机器匹配后允许 bootstrap/Socket 接入。无 requestId 的启动也生成内部关联；不确定响应通过原请求查询，不盲目重发。fork/clear/reopen/resume 的派生意图固定源会话、所有者、空间和机器，子会话继承该归属。实际发往 Runner 的 RPC 及其 ack 再检查机器，HAPI 同 host 回退不能将参数送至另一机器。

Codex/Claude 原生 ID 固定归属到 owner × space × machine，metadata 转发前原子声明；首次声明先核对 HAPI 库存。跨归属碰撞和未映射旧行不可认领；同一归属内的原生历史去重仍由 HAPI 执行。客户端 tag 按机器限定，返回的实际 session ID 也须通过权限检查。

附件使用服务端从 owner × space 计算的独立 HAPI namespace，直接复用原生字节校验、用量、配额、列表和原子清理。用户列表/prune 只作用于当前文件范围；机器/任务不可 prune。跨机器传输按具体文件的 read/write grant，机器输出还须有可信协调器提前登记的文件预约；未知输出不默认为机器所有者所有。原请求重查不恢复已撤销的 grant。文件流逐块校验并响应撤销、断开和背压。

## Socket、终端和事件

每个外部 Socket 对应一个内部连接，握手成功后才接通；内部 root/JWT 不回传。CLI 只注册本连接对象前缀的 RPC，心跳、metadata、消息和双向 ack 都检查当前对象授权。终端 ID 关联本连接已授权的 session；输入、尺寸调整、关闭、输出和原生 agent terminal 订阅均重新校验。

SSE 对原生实时与重放事件按当前归属过滤，短期 JWT 可供 EventSource query 认证，长期凭据不接受于 URL。cursor 以 HMAC 绑定凭据、空间及可见对象集合；跨主体或可见集合变化要求刷新。新会话绑定后在最长 1 秒内产生 gap，防止漏掉此前被过滤的原生事件。visibility 只能修改本人现有订阅，流按背压读取并在断开时取消上游。

凭据轮换/撤销和成员移除使现有授权失效；活动请求逐次检查，空闲 Socket/SSE 最长 1 秒关闭。成员移除同时取消该空间派生/文件许可并撤销任务凭据；重新加入不恢复旧执行许可。原生机器独立凭据不因其所有者更换身份 token 而换号。

## 组合边界与验证入口

`createAccessGateway` 接收私有 HAPI 地址、部署密钥和业务库路径，返回可信对象/派生/文件服务。业务回调接收验证后的用户主体与现有 RequestLease，领域 API 仍负责对象授权与提交前重查。原生服务必须放在私有 loopback；网关失败不旁路透传。

`bun run test:hub-access` 验证真实 HAPI HTTP/文件，`bun run test:hub-realtime` 验证真实 HAPI Socket/终端/SSE 和未改造 Runner 的登记/心跳/目录 RPC。终端与 fork/clear 使用协议执行端，不能视为真实模型或 PTY 验证。普通用户不开放原生全局 storage/settings/usage/devices/push/voice/workGraph、Codex Desktop 导入和其他 runtime 管理接口。

默认网关组合 [Hub 资源领域](../../resources/ownership/spec.md)，原生 spawn/派生及实际 outgoing RPC/ack 追加中心 runtime 授权：共享/登记/空间治理在执行边界再次检查。此钩子不替换 HAPI runtime；受管任务的直接原生输入、resume 与模型修改被拒绝，须走中心委派入口。
