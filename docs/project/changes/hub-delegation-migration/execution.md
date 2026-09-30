# 委派接入与迁移执行记录

## Plan 评审

2026-10-01 在当前工作区运行 iclaude，只读、不委派、不修改用户配置。会话 `206019f7-96f4-49bd-8ffb-8f9ea3efd3f1`，约 347 秒；完整结果保存在 `.dev-smoke/reviews/hub-delegation-migration/review.json`。

主 agent 独立核对源码后采纳：WorkspacePreparations 同步迁移及全部后台扫描隔离；task 绑定目标机器、源操作与 baseline 按 scope；后台按 owner/space 鉴权；公开 API 隔离与 OS 账户信任区分；当前机器凭据和传输授权收回；SQLite WAL/备份与多库 journal；对端旧 machineId 接入恢复；先验证消费实现再统一切换默认服务；交接确认和 HTTPS 限制。

WorkspacePreparations 的遗漏由主 agent 同步复核发现并已在评审结束前补入文档，其余结论已落实到契约与 Plan。对输入/输出 grant 收回补充并行传输引用计数：不能因一个操作完成而撤掉其他操作仍需的同一 artifact 权限。无需新增 runtime 或人工产品门禁。

本次文档提交：`hub-delegation-migration: define reviewed delegation and migration plan`。尚未执行本阶段生产改动或在线迁移。
