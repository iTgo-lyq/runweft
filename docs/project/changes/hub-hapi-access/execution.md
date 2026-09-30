# HAPI 通道授权执行概况

## Plan 评审

- 执行者：当前工作区 iclaude，只读；会话 `e081bfbb-9d2d-43ed-9a73-6a93c74c943b`，完成约 599 秒。原始结果 `.dev-smoke/reviews/hub-hapi-access/review.json`。
- 采纳：原生子进程持机器凭据，任务凭据仅 Runweft 使用；补派生意图支持 fork/clear 的提前登记；spawn 强制内部 requestId；机器 peer JWT 明确权限；按机器所有者与会话所有者不同的场景验收；SSE 禁用压缩并处理绑定后缺口。
- 调整采纳：恢复不能仅靠发起前在线检查阻止 HAPI 同 host 回退。网关实际发往 Runner 的 spawn RPC 再核对可信意图/会话机器绑定，拒绝后不把参数交给错误机器。T3 必须覆盖检查后掉线；若仍出现未受控通道，再复现并判断最小 HAPI 扩展。
- 不采纳：以可写 HAPI metadata 自动变更执行机器授权；授权库中 machineId 只能由可信业务操作变更。暂不采纳缓存 1 秒权限，先保持逐请求/事件检查，避免定义不一致的撤销窗口。
- 当前研究通过协议转接、真实 Runner 与 receipt 时序验证；完整授权尚未实现，默认 serve 尚未切换，未写入 Specs。

## T1 主体凭据与可信对象映射

- 结果：schema v8 增量保存原生对象/业务任务归属、独立机器/任务凭据摘要、附件方向性授权和持久派生意图。绑定不可抢占；客户端请求键映射内部 UUID，过期意图重查不延长窗口；对象 retire 保留归属防止重新认领。短期用户/机器/任务 JWT 与 HAPI 签名用途分离，授权使用当前凭据和成员关系。
- 撤销：身份轮换使已有 JWT 失效；成员移除同事务撤销任务凭据和意图，重新加入不会恢复它们。独立机器凭据显式撤销；附件 grant 可独立撤回。机器访问已分配会话与用户读取本人内容分开；空间 owner 不获得他人会话权限。
- 验证：新增 7 组授权测试，覆盖两空间/三身份、跨所有者机器、JWT 与根认证隔离、轮换中的异步签发、成员移除/重入、跨连接撤销、派生幂等/过期、两进程争抢归属、重启、无明文凭据及 v7 升级。聚焦 29 tests 通过；最终 `bun run test` 为 186 pass / 0 fail / 3855 expectations，原始输出 `.dev-smoke/reviews/hub-hapi-access/t1-tests.log`。`bun run typecheck` 与差异检查通过。
- 范围：内部权限基础完成，HTTP、文件、Socket/SSE 尚待 T2/T3 接线；未将这些接口描述成已保护的正式默认服务。完整构建与真实授权网关组合验收在 T4。
- Commit：`hub-hapi-access T1: persist scoped execution authority`

## T2 HTTP 与文件授权网关

- 结果：新增独立网关，严格列举原生路由和方法；受控认证交换、原生机器/会话清单过滤、可信 spawn/adopt 与回执重查、机器 peer API、owner × space 文件库及方向性流授权均接通。JSON 与流式传输逐次检查当前凭据；JWT 长请求也检查原始到期时间。旧 root/JWT、未知路径、未授权 machine/session/namespace 不能透传。
- HAPI 复用：文件 namespace 从可信归属计算，原生文件列表、配额、原子 prune、完整性和中断上传清理由 HAPI 实现。机器输出先有中心许可，不能自行指定文件所有者。schema v9 仅增加请求映射；共享同一 SQLite 事务完成文件绑定与 grant。恢复请求不能复活撤销的 grant。
- 验证：`bun run typecheck` 通过；既有全套 `bun run test` 为 186 pass / 0 fail；新增许可/冲突/成员重入/撤销恢复测试后聚焦 `bun test ./test/hub-access.test.ts` 为 10 pass / 0 fail / 100 expectations。真实编译 HAPI + 源码网关 smoke 共 10 组通过，证据 `.dev-smoke/hub-access-wsgSKh/evidence.json`，包括有/无 requestId 的幂等启动、跨所有者执行、文件字节与配额、重启与丢响应恢复、隔离清理、16 MiB 传输中撤销、原生残片回收和身份轮换。
- 边界：执行端为协议 fixture，无模型和 PTY；真实 Runner、Socket/SSE、派生及实际 RPC 目标检查在 T3/T4。默认 serve 未切换，未变更在线部署。完整构建在 T4。
- Commit：`hub-hapi-access T2: authorize native HTTP and file transfers`
