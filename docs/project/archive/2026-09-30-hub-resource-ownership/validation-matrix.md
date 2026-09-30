# 资源归属验收矩阵

> 已按本地自动验收授权验证；原始证据与边界见 [acceptance.md](acceptance.md)。使用 A（机器所有者）、B（同空间普通成员）、C（非资源所有者的管理员）和 D（空间外身份），空间 S/T。

| 场景 | 预期 |
| --- | --- |
| 同 owner/requestId 重放 enrollment、查询、重启 | 一个 machineId；摘要与原凭据一致；不新建身份 |
| 同 requestId 不同 owner / 不同凭据 | 不混同；已有 owner 的请求内容不能改写 |
| self-reported owner/machineId 与旧原生行 | 不认领；不会覆写 HAPI 数据 |
| 凭据替换响应丢失、同 token 重放、旧 token 后到 | 可用已保存新 token 确认；旧 token 不复活、不撤销新凭据 |
| B/C 操作 A 机器名称、登记、凭据、discover | 拒绝；空间管理角色不变为机器所有者 |
| A 关联机器到 S，尚无 runtime | 不创建 runtime；普通成员不获得机器文件/终端操作 |
| 同机 codex/claude、同类型并发注册 | 两类各有独立 ID；同类型仅一个稳定 ID |
| 私有 runtime，C 治理概要 | B/D 不可见；C 不见执行路径/完整探测，也不能用/编辑 |
| runtime 分享到 S | B 可 check/resolve；T 未显式分享时不能用；A/B 仍不能读彼此任务 |
| B 的分享、改名、新增 runtime 请求 | 拒绝；分享只授予使用 |
| C 在 S 禁用 machine/runtime | S 的 A/B 均不能新解析；T 权限不变；分享/重新登记不能解除禁用 |
| C 在别的空间伪造 block 对象 | 拒绝；只可治理当前空间关联资源 |
| A 退出/被移出 S 再加入 | 原机器关联及 runtime 分享不自动恢复 |
| B 离开 S、旧 JWT、跨空间 ID | 当前身份/成员在每次操作复核，不能沿旧结果继续解析 |
| 探测过程中分享撤回、禁用、注销或成员移除 | 返回时不报告可用；注册写入重查前置，取消不可被覆盖 |
| 离线和单机 RPC 失败 | 配置及历史观察保留且标明过时；其他机器可继续展示 |
| CLI 两 Hub、重复 enrollment、JSON/人类输出 | 数据在明确的 connections 分区，身份/机器凭据不串用，不输出 token |
| 真实未改造 Runner | 从可信 ID/opaque token 正常登记、心跳、工具发现；不要求模型调用 |
| 原生机器 spawn、会话派生、实际 outgoing RPC | 当前空间的资源撤销/禁用同样生效，机器 peer 不能替换任务所有者 |
| 编译与回归 | typecheck、全仓 test、build；旧资源 API/CLI 与已验收授权通道不回退 |

存储、角色、DTO、并发及异步撤销场景由 `test/hub-resources.test.ts` 覆盖；编译 CLI 与丢响应恢复由 `test/hub-resource-cli.test.ts` 覆盖；实际 outgoing RPC 竞态由 `test/hub-resource-dispatch.test.ts` 的双跳 Socket.IO fixture 验证。`scripts/smoke-hub-resources.ts` 完成真实未改造 Runner 和两种工具的观察；模型执行不属于此资源领域验收。
