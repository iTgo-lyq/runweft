# 机器、Runtime 与 Agent 的抽象核对

> 调查日期：2026-09-29
> 状态：HAPI 本地源码与 Multica 官方文档证据，未运行真实注册或模型任务。

## HAPI 现有抽象

本地 submodule 提交 `86c88df93baf5d1f738dd4b202078bdf6dec376e`：

- [MachineSchema](../../../../hapi/shared/src/schemas.ts)区分 machineId、namespace、连接活跃信息、机器 metadata 与 Runner state；Runner 向 Hub 注册机器。可复用机器身份与连接，不建立第二套机器心跳系统。
- [SpawnSessionRequestSchema / AgentAvailability](../../../../hapi/shared/src/apiTypes.ts)以机器路由配合 agent 类型选择工具。`agent` 是 flavor（例如 codex/claude），不是含职责和 instructions 的业务 agent 对象。机器上的可用性查询可区分未找到工具与配置无效，但不证明登录有效或真实执行成功。
- [AgentConfigDescriptor](../../../../hapi/shared/src/agentConfig.ts)描述各 flavor 的模型、推理、权限等配置字段，不等于长期 agent 定义或独立 runtime 注册项。
- [Codex shared registry](../../../../hapi/cli/src/codex/shared/registry.ts)中的 runtime 指运行进程与会话共享记录，不能直接当作用户配置中的全局 runtime 身份。

**判断：** HAPI 具备应复用的底层概念，但所查入口没有直接给出 Runweft 所需三类对象的完整产品模型。具体采用机器加 flavor 的稳定映射还是补充持久 runtime 引用，仍需按 HAPI 现有配置与查询路径落实；不因名称相同就复用错误语义。

## Multica 的分离

[官方 daemon/runtime 文档](https://multica.ai/docs/daemon-runtimes)明确 daemon 运行在一台机器上，runtime 对应机器上的具体 AI 工具或兼容 profile，同一机器可注册多个 runtime；重启更新已有记录。[Agent 配置文档](https://multica.ai/docs/agents-create)将职责/instructions 放在 agent 中，由 agent 引用 runtime。

Runweft 采用这一分离；用户明确机器/runtime 全局、agent 可全局或项目级。Multica 的 workspace 权限、中心 skills/MCP、任务凭据和自动重跑不因此成为本项目要求。

## 本地模式与存储可复用入口

[CLI 配置](../../../../hapi/cli/src/configuration.ts)支持 `HAPI_HOME`，默认 `~/.hapi`，并在其下组织 settings、日志和 Runner 状态；[Hub 配置](../../../../hapi/hub/src/configuration.ts)使用 `HAPI_HOME` 与可覆盖的 `DB_PATH`，默认数据库为该目录的 `hapi.db`。[Hub 命令](../../../../hapi/cli/src/commands/hub.ts)可在 CLI 内启动 HAPI Hub。

**有依据的方案方向：** 本地模式由 Runweft 管理本机 HAPI 服务与受控数据位置，无需用户另部署共享 Hub；Hub 模式连接明确的外部 Hub。两种模式共用执行与协作契约，不额外写一套本地执行器。单一 Runweft 数据根和模式隔离需在统一 CLI 技术方案落实，不能据配置项存在就声称已完成本地模式。
