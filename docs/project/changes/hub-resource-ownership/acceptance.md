# 机器/runtime 归属与共享验收

> 2026-09-30，本地自动验收通过。用户已授权各阶段的本地验收由主 agent 完成；本阶段不需要人工操作或远端条件。

## 需求对应

| 需求 | 已验证结果 | 证据 |
| --- | --- | --- |
| 可信机器接入 | Hub 分配新 ID；同 owner/requestId 并发只创建一个；旧行不能自报认领；替换/撤销的原凭据重放不成功 | hub-resources 测试、真实 smoke 第 1 组 |
| 机器/runtime 分离 | 机器关联不创建 runtime；同机 codex/claude 分开、同类型稳定 ID；注销保留原生历史与配置 | 数据库/HTTP 测试、真实 smoke 第 2/6 组 |
| 所有者/空间共享 | 私有不向普通成员出现；分享只允许使用；管理员可见概要/禁用，不能编辑或使用私有目标 | 角色矩阵、编译 CLI、真实 smoke 第 2/3 组 |
| 撤销与治理 | 本空间禁用同时约束所有者；其他空间不受影响；detach/成员移除事务撤回分享，重入/恢复不复活 | 数据库/异步竞态测试、真实 smoke 第 3 组 |
| 原生旁路 | spawn、派生、机器 peer 按会话发起人判定；HTTP 预检后撤销仍在实际 RPC 发出前阻止 | hub-resource-dispatch 双跳 Socket.IO；T2 原生通道回归 |
| 探测与可见数据 | 复用 HAPI，按机器合并；单机故障不隐藏成功项；共享目标无执行路径/私有配置，离线观察标为历史 | HTTP/DTO 测试、真实 smoke 第 1/2/6 组 |
| CLI 和接入恢复 | 一个 CLI，显式 Hub/身份，无本地回退；Web 备份 origin/ID 核对；先保存凭据，丢响应与 stale pending 可明确恢复 | 编译 CLI 测试、真实 smoke 第 1/4/5 组 |
| 数据和秘密 | 0600 按 Hub 分区，SQLite 只存摘要；跨 Hub/身份不串用，不自动写原生用户配置，输出/服务日志无 token | 数据库、编译 CLI 测试、真实 smoke 第 7 组 |

## 实际执行

- `bun run typecheck`、`bun run build` 通过；全仓 `bun run test`：209 pass、0 fail、4278 expectations、31 文件。
- `bun build scripts/smoke-hub-resources.ts --compile --outfile .dev-smoke/reviews/hub-resource-ownership/resource-smoke` 后实际运行该可执行文件，7 组通过。它使用 build 产物 dist/runweft 与 dist/hapi、独立原生配置目录、真实 Codex/Claude 版本探测及 HAPI 心跳；证据 `.dev-smoke/hub-resources-fltFyI/evidence.json`。
- 已验收通道在本 Change 的 T1/T2 均回归：HTTP/文件 12 组与实时/Runner 10 组通过；最后一轮分别为 `.dev-smoke/hub-access-hGHSA4`、`.dev-smoke/hub-realtime-Vi8Fkm`。其后没有修改通道实现。
- 结构检查、diff 检查通过。测试与 smoke 原始日志在 `.dev-smoke/reviews/hub-resource-ownership/`；HAPI 子模块无变更。

## 交付边界

独立 `createResourceGateway`、领域 API、typed client 与 Hub 域 CLI 已可组合运行。默认 serve/Runner 与旧 namespace 的迁移属于下一阶段的委派迁移；不把当前在线 Hub 描述为已切换。Web 管理页面属于独立后台 Change。

真实 Runner 是同一开发机上的独立进程/数据根。本阶段不调用模型，不重新声称物理远端或 Mac 实机验证；最终完整委派与四平台发行按父 Change 继续推进。[CLI 契约](cli-contract.md)说明后续接入方式；`HubResourceStore.usable` 与 `nativeExecution` 提供中心配置/委派复用的同步授权，消费者须在提交及派发时复查，解析结果不能用作永久授权。
