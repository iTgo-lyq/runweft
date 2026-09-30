# 资源归属执行概况

## Plan 评审

- 执行者：当前工作区 iclaude，只读 Read/Glob/Grep，无子 agent/代码变更/测试；会话 `72243c6c-7f7e-4136-ba90-23422bfc00b7`，成功完成约 487 秒，原始结果 `.dev-smoke/reviews/hub-resource-ownership/review.json`。
- 两项阻塞均采纳：公开执行目标不返回旧完整 inspection/executable；enrollment 重放必须仍持当前有效凭据，替换/撤销返回明确 409，不能把旧 token 视作接入成功。
- 采纳建议：detach 同事务撤回分享、所有者也受空间关联/禁用约束、成员移除在 HubStore 中级联、同步 usable 判定、RequestLease 传入业务接口、机器列表以中心登记为主、共享/治理 DTO 白名单、沿 connections 分区保存 active/pending 凭据、校验 Web 备份的 Hub origin、换身份不复用机器记录、替换撤销所有旧机器凭据。
- 主 agent 补充：实际原生 spawn/derive/outgoing RPC 也需检查当前资源授权，避免只保护 resolve；并发 CLI 初次接入共享同一持久请求；DAO 共享 AccessStore.db，避免嵌套写跨 SQLite 连接。未把后续委派状态机、默认服务切换或 Web 页面混入本 Change。
- 结论：Technical/Plan 已修订，主 agent 按既有授权确认可实施；无需新增用户门禁。

## T1 可信机器接入与全局登记

- 结果：schema 11 增量保存中心登记与空间关联，不自动认领旧资源；Hub 分配机器 ID，owner/requestId 重放保持同一对象；凭据摘要、条件替换、所有旧机器凭据撤销及丢响应查询已接入。取消登记保留原生身份和历史；成员移除在同一事务撤回关联。
- 接线：独立 createResourceGateway 组合入口及严格 HTTP；机器列表从中心登记合并原生库存，首次未连接可见，名称更新复用 HAPI；RequestLease 传入业务层，已知资源错误保留 status/code，原生库存读取复用公共函数。
- 验证：typecheck；5 个相关测试文件共 40 pass、0 fail、879 expectations，覆盖双进程接入/替换竞争、v10 及旧版本迁移、重启、token 不落数据库明文、身份撤销发生于异步库存读取；`git diff --check`、Change 结构检查通过。
- 回归：真实 `test:hub-access` 12 组通过（`.dev-smoke/hub-access-KHeDQs`）；`test:hub-realtime` 10 组通过（`.dev-smoke/hub-realtime-6GvQgc`），包含未改造 Runner 与真实 45 秒心跳失联后的同主机兜底拒绝。原始日志位于 `.dev-smoke/reviews/hub-resource-ownership/t1-*.log`。
- 边界：默认 serve 未切换；CLI 持久接入与真实 Runner 使用新 enrollment 由 T3/T4 验证。
- Commit：`hub-resource-ownership T1: enroll owned machines and rotate scoped credentials`
