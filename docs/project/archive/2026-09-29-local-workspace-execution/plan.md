# 本地独立工作区实施计划

> 来源：[Requirement](requirement.md)
> 技术方案：[Technical](technical.md)、[工作区契约](workspace-contract.md)
> 执行模式：逐任务提交
> 评审：当前工作区 iclaude 一次已完成；会话与主审采纳见 [Execution](execution.md)，不重复评审。

## 交付目标

CLI/MCP 可从主仓库准确 commit 派生本地独立任务，准备完成后启动、每轮停止后自动固定成果、后续复用原目录/session，并支持失败修复后的收尾重试与显式环境清理。成果不依赖 push，完整链路复用 HAPI。

## 关键决策与风险

- HAPI 的现有 worktree 快捷入口不能满足准备与启动分离，先补通用机器 Git 能力；不改 runtime adapters。
- 准备引用必须贯穿 spawn/resume schema、回执指纹、Hub/RPC、Runner 与调用层，并先于目录创建检查；耗时 Git 操作快速受理后 inspect 查询，避免请求超时被误判为任务失败。
- 基线、准备和成果引用有独立事实，失败不自动换目录或重跑原生输入/commit hook。
- 收尾未知/失败阻塞后轮；主目录不自动提交。默认保留环境，ignored 内容必须明确丢弃后才允许清理。
- 子模块/LFS 内容在准备时验证；嵌套脏改动或新 gitlink 不冒充完整 Git 成果。

## 任务

### T1 HAPI 独立 Git 生命周期与准备启动校验

- 交付：现有 Runner/Git 路径提供机器级 resolve/prepare/inspect/finalize/remove，持久环境、异步操作回执与幂等事实；spawn/resume 消费准备引用，原生 runtime 不改造。修改 protocol 两种 schema/回执指纹、SyncEngine/RpcGateway、apiMachine/SpawnSessionOptions、metadata 保留，以及 Runweft ExecutionClient start/resume 的参数传递。
- 验收：真实 Git 的固定基线/相对 cwd、重复准备、启动失效、checkpoint/保留引用、hook/签名/锁失败、LFS/子模块与安全清理可从 HAPI 机器接口独立运行；未知结果不重放副作用。经过 Hub HTTP 验证 spawn/resume 的错误/旧准备均 childStarted=false，checkout 删除后不重建；耗时操作断线后仍可查。验证 hook 修改暂存树、提交响应丢失、Git 超时与手工提交后的封存，子模块共享配置和候选 index gitlink 检查。
- 验证：聚焦 Git、Runner/RPC、Hub namespace/路由及原生续接校验测试；HAPI 规则要求的跨包 typecheck/test；配套编译 HAPI + 专用 HTTP smoke。HAPI 单独 Commit，Runweft 更新固定 revision。

### T2 编译 CLI 独立协作与基本续接

- 交付：CLI worktree/base 参数、持久固定基线/Task 环境、preparing/finishing 与成果查询；API/prompt/CLI 模式文案一致，显式 retry-finish 修复收尾而不重跑任务，shared 兼容不变。
- 验收：真实 Codex/Claude CLI 任务在准备目录写入并自动形成 checkpoint，第二轮在原 cwd 续接并固定成果；主目录/index/HEAD 保持原样，wait 封存后才返回完成及结果 ref。两 runtime 实际核对 AGENTS.md/CLAUDE.md、项目 MCP 和路径信任行为，缺失/待批准如实展示，不修改用户配置。准备失败无模型进程；收尾错误作为 workspace attention，不改写原生结论，finishing 的中断不伪造取消。
- 验证：中心真实 SQLite/HTTP 回归、编译 CLI smoke、类型检查/构建。首次真实链路在本任务完成，不推迟到最终阶段。

### T3 跨轮次复用、失败处理与显式清理

- 交付：独立多轮 resume、agent 提交与补 checkpoint 共存、固定环境/成果门禁、取消的部分结果、重启对账；task workspace remove、事务性删除/send 互斥及列表中的路径/保留状态。
- 验收：两个 delegation 隔离，续接保留历史/依赖，主分支后续移动不影响已接受基线；无改动不提交；失败收尾阻塞后轮，修复后显式重试；删除与 send 互斥，ignored 默认保留，结果引用不随删除丢失；未启动且没有成果的自有环境也能按 base 检查并清理。
- 验证：真实 Git+中心的故障/并发/重启用例、两 runtime 编译 CLI 续接与进程退出、实际删除后成果读取；既有 shared 回归。

### T4 两宿主 MCP 独立协作与原生配置验收

- 交付：MCP 派生 worktree/base、结果事实和 retry_finish；两原生宿主完整调用，与 CLI 共用业务能力。
- 验收：Codex/Claude 宿主 × Codex/Claude runtime 在 local/同机 Hub 的真实工作树准备、编辑、收尾和续接；工程指令/skill 与其他 MCP 可用，子执行仍无 Runweft MCP，原生内置 subagent 能力保留。Git 合入由测试中的主 agent/操作者执行。
- 验证：专用原生配置、真实 MCP/模型证据、文件/index/commit 与 PID 检查；MCP 取消/断线后已接受任务不重复，收尾失败/修复用例不重放模型。当前不冒充跨机器验证。

### T5 候选安装、使用说明与整体验收

- 交付：清晰的模式/基线/收尾修复/结果合入/环境清理说明，paths/doctor 实际位置和可取得的保留数量；说明 linked worktree 对源 Git 目录的依赖、备份/迁移限制、留存 refs/分支及卸载保留数据。候选包包含配套 HAPI，完整需求验收映射。
- 验收：安装产物的 CLI/MCP/服务和数据留存通过，当前模块无需手工开发命令才能运行；真实证据与 Git fixture/跨平台构建范围分别记录。
- 验证：Runweft 类型检查、现有测试、四平台候选包构建及当前平台安装 smoke；必要的实际平台补测依变更范围执行。已通过且代码未变的模型测试不重复。

## 关闭

T1–T5 每项独立本地提交。按用户本地自主验收授权核对全部标准后，另作 Specs 同步与完整 Change 归档提交；完整项目目标和真实远端验证继续由后续 Change 承担。

## 执行顺序

按原任务依赖及既有 Plan 顺序迁入；未重新安排历史执行。

| 任务 | 前置任务 |
| --- | --- |
| T1 | 无 |
| T2 | T1 |
| T3 | T2 |
| T4 | T3 |
| T5 | T4 |
