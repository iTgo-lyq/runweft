# 机器、Runtime 与 Agent 的抽象核对

> 调查日期：2026-09-29
> 状态：历史文档与当前固定 HAPI 源码核对；本 Change 尚未运行登记验收，不把已有 Runner 注册验收算作新增产品交付。

## HAPI 现有抽象

初始调查基于 `86c88df93baf5d1f738dd4b202078bdf6dec376e`；本 Change 实施前已重新核对固定版本 `58a2f6eac3acebafacb6c0827672ff91c77bb6ea`：

- [MachineSchema](../../../../hapi/shared/src/schemas.ts)区分 machineId、namespace、连接活跃信息、机器 metadata 与 Runner state；Runner 向 Hub 注册机器。可复用机器身份与连接，不建立第二套机器心跳系统。
- [SpawnSessionRequestSchema / AgentAvailability](../../../../hapi/shared/src/apiTypes.ts)以机器路由配合 agent 类型选择工具。`agent` 是 flavor（例如 codex/claude），不是含职责和 instructions 的业务 agent 对象。机器上的可用性查询可区分未找到工具与配置无效，但不证明登录有效或真实执行成功。
- [AgentConfigDescriptor](../../../../hapi/shared/src/agentConfig.ts)描述各 flavor 的模型、推理、权限等配置字段，不等于长期 agent 定义或独立 runtime 注册项。
- [Codex shared registry](../../../../hapi/cli/src/codex/shared/registry.ts)中的 runtime 指运行进程与会话共享记录，不能直接当作用户配置中的全局 runtime 身份。

**结论：** HAPI 提供底层机器和 flavor，但没有业务 runtime 登记对象。当前方案以 machineId/flavor 唯一映射到 Runweft 持久 runtime ID；不将原生运行进程的 runtime registry 当作产品资源身份。

## Multica 的分离

[官方 daemon/runtime 文档](https://multica.ai/docs/daemon-runtimes)明确 daemon 运行在一台机器上，runtime 对应机器上的具体 AI 工具或兼容 profile，同一机器可注册多个 runtime；重启更新已有记录。[Agent 配置文档](https://multica.ai/docs/agents-create)将职责/instructions 放在 agent 中，由 agent 引用 runtime。

Runweft 采用这一分离；用户明确机器/runtime 全局、agent 可全局或项目级。Multica 的 workspace 权限、中心 skills/MCP、任务凭据和自动重跑不因此成为本项目要求。

## 本地模式与存储可复用入口

[CLI 配置](../../../../hapi/cli/src/configuration.ts)支持 `HAPI_HOME`，默认 `~/.hapi`，并在其下组织 settings、日志和 Runner 状态；[Hub 配置](../../../../hapi/hub/src/configuration.ts)使用 `HAPI_HOME` 与可覆盖的 `DB_PATH`，默认数据库为该目录的 `hapi.db`。[Hub 命令](../../../../hapi/cli/src/commands/hub.ts)可在 CLI 内启动 HAPI Hub。

**已验证的前置：** [统一 CLI 验收](../../archive/2026-09-29-unified-cli-and-deployment/execution.md)已证明本地模式托管 HAPI 与受控数据目录、Hub 模式连接和数据分离；[宿主适配验收](../../archive/2026-09-29-host-mcp-adapter/execution.md#t4-配套构建与宿主整体验收)再次覆盖配套服务。当前资源登记沿这套基础增加上层持久关系，不额外实现本地执行器。


## 当前接口与实际缺口

以下为 2026-09-29 对固定源码的核对，不是新实现验收：

| 入口 | 已有能力与方案影响 |
| --- | --- |
| [Runner 注册](../../../../hapi/cli/src/runner/run.ts)、[持久配置](../../../../hapi/cli/src/persistence.ts) | Runner 沿 HAPI settings 的 machineId 注册，重启复用身份；Runweft start 已配置当前连接独立 HAPI_HOME。资源登记引用此 ID，不创建另一机器心跳或 daemon |
| [机器 HTTP 路由](../../../../hapi/hub/src/web/routes/machines.ts)、[机器缓存](../../../../hapi/hub/src/sync/machineCache.ts) | GET /api/machines 只暴露在线列表；内部 getMachinesByNamespace 已包含离线机器。PATCH 名称沿现有版本化 metadata 更新，可直接复用。补充显式 includeOffline 查询，不复制机器状态表 |
| [工具可用性](../../../../hapi/cli/src/agent/agentAvailability.ts) | getAgentAvailabilityResponse 逐 flavor 使用实际命令解析器，返回 available/not_found/invalid_configuration；旧 preflight 包括 Codex 显式覆盖，但该覆盖不被当前 shared launcher 使用。无原生版本返回，也不检查认证 |
| [机器 RPC](../../../../hapi/cli/src/api/apiMachine.ts)、[Hub 转交](../../../../hapi/hub/src/sync/rpcGateway.ts) | 已有 AgentAvailability RPC，无须模型 session；可沿同一请求添加显式 details 选项，只为 Codex/Claude 执行有时限的 --version。保持默认轻量探测与 launcher 不变 |
| [Runweft 服务](../../../../src/services.ts)、[连接配置](../../../../src/config.ts) | 网关已验证 HAPI JWT 的 uid/ns，具有 server/runweft 持久目录。新增资源接口必须沿请求 JWT 访问相同 namespace，不能拿默认中心令牌代替调用者身份 |

HAPI 的 agent 字段仍是 flavor；注册一个新的逻辑 runtime 不会使现有 Runner 同时拥有两份不同 Codex 启动配置。当前采用一个 machineId/flavor 对应一个稳定 runtime 引用，名称只用于展示。新版本或不同运行环境通过实际 Runner 配置生效，不在 Runweft 重造 profile 执行框架。

## 端到端方案判断

- 已验证的前置：统一 CLI 的 local/hub 生命周期、连接数据分离与原生 Runner 注册；宿主 Change 的配套服务回归再次通过。新增资源存储/API/CLI 尚未实现。
- 源码确认的最小 HAPI 增补：暴露现有离线机器列表、在现有 availability 请求上提供原生工具详情与能力声明。不会改 Codex/Claude launcher、SDK、原生 session 或权限。
- 合理推断：资源只需要登记关系、稳定 runtime ID 与最后一次详情观察；在线状态继续以 HAPI 为准。取消登记可保留行并拒绝新解析，既不扫描所有项目文件猜引用，也不删除底层执行，满足保留历史和不改绑任务目标。
- 版本查询失败与命令不存在不同：保留实际可用性与独立版本状态；只解析短版本号，不回传原生 stdout/stderr 全文。模型登录与真实执行均保持未检查。
- 本机可运行独立 Hub/客户端/Runner、重启、离线、缺失 CLI 和无效覆盖实验；真正跨机传输不在本 Change 验收中冒充完成。无需新的外部账号或用户确认。


## Plan 评审后的事实修正

2026-09-29 已按 iclaude 线索独立重读 [runCodex](../../../../hapi/cli/src/codex/runCodex.ts)、[shared runtime](../../../../hapi/cli/src/codex/shared/runtime.ts)、[shared launch](../../../../hapi/cli/src/codex/shared/launch.ts)：当前正式入口使用 resolveCodexCommand，codexRemoteLauncher 只有历史定义和测试调用。旧 availability preflight 检查 HAPI_CODEX_APP_SERVER_BIN 与实际启动命令并不总相同。保留既有 preflight 行为，详情与版本查询真实 launcher 的命令；Runweft 将两者共同用于资格判断，不能仅见旧 available=true 就称实际 CLI 已发现。专用回归需要覆盖有效旧 override 但真实 PATH Codex 缺失的情形。

Hub 服务端用 local 配置配合 serve --public；服务端资源解析只能按 namespace 和实际目标检查，客户端 local 的本机限制不进入中心公共解析逻辑。loopback 地址也可能被同机多个 Runner 使用，不单独充当机器身份。
