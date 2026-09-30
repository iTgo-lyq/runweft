# 身份 token 与空间执行记录

## Plan 评审

- 评审：当前工作区 iclaude，会话 `4bc87cfc-da94-4b22-ab89-f501e8f8c5f5`，退出 0、success；只读，无执行委派。原始记录 `.dev-smoke/reviews/hub-identities-and-spaces/review.json`。
- 采纳：管理员只邀请 member；邀请角色与成员修改共用权限规则；同消费人安全重放、跨空间 ID 同时限定；轮换由客户端先保存候选 token，响应丢失核验；新旧凭据在真实 HAPI 双向拒绝；schema 测试更新；未知错误不回显；复用长期 DB 连接；删除容易受反向代理影响的 Origin 猜测检查。
- 不采纳额外 personal 类型及禁止协作：总体方案已要求个人/团队空间同一模型，个人空间定义为初始普通空间，邀请、退出和最后 owner 规则一致。已在 Technical 明示，避免后续隐式分叉。
- Web 在 `/hub` 上继续扩展；后续完整后台不另建身份入口。当前尚未宣称原生执行多用户授权完成。

## T1 身份和空间持久 API

- 结果：schema v7 增量迁移，长期 HubStore 接入 serve；独立身份 token、轮换、空间、角色、邀请和统一错误处理完成。新旧认证入口分开，HAPI 原生执行代码未改动。
- 验证：`bun run typecheck` 通过；`bun test ./test/hub.test.ts ./test/resources.test.ts ./test/task-results.test.ts` 共 22 通过，覆盖 v5/v6 迁移、独立进程最后 owner、轮换竞争、邀请重放与跨空间 ID。最后局部修正后 Hub 6 项再次通过；`git diff --check` 通过。
- 边界：当前反向旧凭据拒绝已在 API 集成测试验证；真实 HAPI/Socket 拒绝在 T3 验证，不提前声明。
- Commit：`hub-identities-and-spaces T1: persist token identities and space membership`
