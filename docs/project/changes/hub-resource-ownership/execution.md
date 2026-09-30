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

## T2 Runtime 归属、共享和空间治理

- 结果：schema 12 保存全局 machine × flavor runtime、空间分享与治理禁用；删除关联依靠同事务外键级联撤回分享，成员重新加入/重新登记不恢复授权。同步 usable 判定供解析及后续委派调用；详情明确当前空间的机器/runtime 禁用状态。
- 探测与 DTO：沿公共 nativeInspections 复用原 HAPI 详情，不增加执行适配；每台机器最多一次探测，单机失败保留历史且不阻断其他机器。共享/治理响应按白名单构造，完整 inspection 仅给所有者；公开执行目标无路径、Runner state、其他空间分享或原生错误文本。
- 授权：原生 spawn/derive 和实际 outgoing RPC/ack 均复查当前领域权限；机器 peer 按已绑定会话的 owner/space 使用 runtime，不能换成机器所有者。异步探测后的持久写事务再次授权；注册过程中注销 runtime 不会被旧请求恢复。
- 验证：typecheck；全仓 205 pass、0 fail、4180 expectations（30 文件）；补充治理展示字段后的聚焦复核 14 pass、0 fail、292 expectations。覆盖两空间/多角色、并发注册、v11 迁移、配置留存、路径裁剪、单机失败及探测期间撤销；真实双跳 Socket.IO 协议 fixture 证明预检后禁用也不会把启动字节交给 Runner。原始日志 `t2-tests.log` / `t2-final-focused.log`。
- 回归：真实 HAPI HTTP/文件 12 组通过（`.dev-smoke/hub-access-hGHSA4`），实时/Runner 10 组通过（`.dev-smoke/hub-realtime-Vi8Fkm`）。结构与 diff 检查通过。新领域组合下真实 enrollment/Runner 探测在 T4 验收，未把协议 fixture 称为真实模型执行。
- Commit：`hub-resource-ownership T2: govern runtime sharing and native dispatch`

## T3 Hub CLI 与持久接入恢复

- 结果：同一 CLI 的 `hub machine/runtime` 命令和 typed client 完成资源管理；显式 URL、身份文件或 RUNWEFT_IDENTITY_TOKEN，不走旧 root/HAPI 认证或本地回退。Web 备份同时核对 origin/身份 ID；能力检查先于发送凭据，跨地址重定向拒绝。
- 持久化：规范化 Hub 对应 0600 machine.json，网络请求前保存 request/token 与 pending；复用 client.sqlite 短写事务串行文件更新，不保存第二份凭据或遗留锁文件。并发首次接入共享同一请求，确认后的迟到回执不覆盖轮换状态。旧 pending 明确失败，显式替换才生成新请求。
- 恢复：模拟服务端提交后丢响应，原 enrollment/轮换均可恢复；原机器凭据被撤销且首次回执尚未保存时，显式 rotate 可查询原 requestId 找回机器，无需修改文件或创建第二台。
- 验证：typecheck；资源/CLI 聚焦 18 pass、384 expectations；最终 CLI/config/旧 CLI 复核 11 pass、127 expectations。测试实际编译 Runweft 可执行文件后运行，覆盖并发接入、分享/禁用/check、轮换、双 Hub、身份不匹配、Web 备份、JSON/人类输出无 token、0600 及不生成原生配置。原始日志 `t3-tests.log` / `t3-final-tests.log`；结构与 diff 检查通过。
- 边界：此任务使用组合资源服务及原生协议 fixture；真实 Runner 使用新持久接入文件由 T4 验证。操作接口见 [CLI 契约](cli-contract.md)。
- Commit：`hub-resource-ownership T3: add hub resource CLI and durable machine enrollment`

## T4 真实 Runner 与完整接口验证

- 结果：新增 test:hub-resources，实际编译组合网关 smoke 并使用 build 生成的 Runweft CLI、未改造 HAPI Hub/Runner 和本机 Codex/Claude 命令，仅查询版本，不运行模型。7 组真实检查覆盖登记后启动、原生探测、稳定 runtime、分享与治理、轮换断开/重连、网关重启和真实 45 秒离线收敛。
- 验证：typecheck、build；全仓 209 pass、0 fail、4278 expectations、31 文件（`.dev-smoke/reviews/hub-resource-ownership/t4-tests.log`）。编译后的 smoke 7 组通过，证据 `.dev-smoke/hub-resources-fltFyI/evidence.json`，日志 `t4-resources.log`；原生执行通道回归沿 T2 已通过证据，此后未修改通道实现。
- 验收：需求映射与自动验收结论见 [acceptance.md](acceptance.md)。本地按用户既有授权完成，不增加人工确认门禁；专用身份/home/服务，未改当前用户配置或线上 Hub，HAPI 子模块保持干净。
- 边界：默认 serve/Runner 配置尚待阶段 5 切换；Web 后台在阶段 6 接线。此阶段不声称实际模型委派、物理远端或 Mac 实机已重新验证。
- Commit：`hub-resource-ownership T4: verify compiled CLI with native runner enrollment`
