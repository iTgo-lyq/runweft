# 全局机器与 Runtime 注册

> 状态：已完成
> 规模：大型
> 更新：2026-09-29
> 确认依据：用户明确机器注册、runtime 注册和 agent 配置分离，前两者全局、agent 可全局或项目级；按既有逐 Change 自主落实与一次 iclaude Plan 评审授权收敛细节。

## Review 导读

用户能够分别查看和管理执行机器，以及机器上可用的 Codex/Claude Code runtime；项目 agent 只引用已注册的执行资源。本 Change 复用 HAPI 机器身份、连接、能力查询和注册机制，仅补语义映射与实际缺口；不创建新 daemon 或通用 runtime 插件协议。

## Change 依赖

| 关系 | Change | 依赖内容与满足条件 |
| --- | --- | --- |
| 前置 | [统一 CLI 与部署](../2026-09-29-unified-cli-and-deployment/requirement.md) | 本地/Hub 模式、全局配置与数据位置、HAPI 连接及命令承载已明确 |
| 下游 | [Agent 定义](../../changes/agent-definition/requirement.md) | 按 runtime 引用解析执行目标，不嵌入机器或 runtime 注册配置 |
| 下游 | [委派生命周期](../../changes/delegation-lifecycle/requirement.md) | 启动时核对目标机器和 runtime，不靠 agent 名称推断 |

## 独立验收与交付边界

无需 agent 定义、任务调度或 Git 环境即可验收本地机器注册、runtime 发现/注册、去重、查询和不可用状态。Hub API 的本机服务组合由自动化测试覆盖；真正跨机器的连接、离线和恢复在远端阶段验收。

本 Change 不决定业务触发时机，不执行 agent 任务，也不把机器在线或 CLI 可发现等同于模型认证和真实执行成功。注册是引用与可用性管理，不是动态安装新的协议实现。

MCP 宿主的两种客户端限制与 runtime 注册是两个维度。当前以内置 Codex/Claude Code 验证注册和执行目标解析，直接使用 HAPI 已有适配；注册功能不主动修改其 launcher、协议或 session 实现，私有 runtime 接入另行进行。

## 行为变化

### ADDED

#### `resources/machines`：全局机器注册

机器表示具体执行主机和 HAPI Runner 的可路由身份，记录连接、平台与能力。重复连接更新同一身份，不因切换项目创建第二台机器。Runweft 登记复用该 machineId，不再生成第二个机器身份。登记/取消登记不隐式创建或删除 runtime 或 agent，不停止原生任务；取消登记保留原记录并明确显示其 runtime 将不可用于新委派，已有定义不会被改写。Runner 的启停与资源登记分别表达。

#### `resources/runtimes`：全局执行环境注册

runtime 表示某个 HAPI Runner 身份上可调用的内置工具，拥有独立稳定身份并引用 machineId；类型、可用性与版本来自该 Runner 的原生探测。当前同一机器分别登记 Codex、Claude Code，每个 flavor 只有一个登记；其命令和配置沿 Runner 已有环境，不虚构 HAPI 不具备的逐 runtime 自定义启动 profile。只接入已支持的 Codex、Claude Code 和既定 HAPI 源码扩展路径，不引入任意动态协议插件。

一台机器可有多个 runtime，多个 agent 可引用同一 runtime。同 machineId/flavor 重复登记返回原 runtime ID，取消后重新登记也复用它；展示名称可修改，但 ID 不能改绑另一机器或类型。取消登记保留可解释的失效引用，不删除原生配置、会话或工程。机器在线、runtime 可发现、模型认证有效和任务执行成功分别表达。探测只执行命令定位和版本查询，不启动模型、不读取凭据；版本无法读取时说明原因，不冒充版本不兼容或已验证登录。删除或失效的引用明确报错，不自动改用另一机器或另一个 runtime。

#### `resources/scope`：全局资源与项目定义分离

全局指当前用户及所选运行模式/Hub 访问范围，不是跨用户公开。机器和 runtime 不进入项目级注册文件；项目只能通过 agent 定义引用它们，不能用同名项目项遮蔽全局机器或 runtime。

本地模式只路由到本机资源；Hub 模式通过当前 Hub 解析已授权资源。不同 Hub 与本地模式的身份不按名字混用，切换连接不自动迁移注册或凭据。项目 agent 中不存在的 runtime 引用给出可操作诊断。

## 验收标准

- [x] 不创建 agent 即可完成本机机器与两种 runtime 的注册和查询；重启不重复注册。
- [x] 同一机器上的 Codex/Claude runtime 可区分，同一 runtime 可被不同 agent 引用。
- [x] 持久记录与 API 分别表达 machine、runtime 和 agent，项目级配置不能重新注册全局资源。
- [x] 机器离线、CLI 缺失、配置无效及未验证认证不会被混成“可运行”。
- [x] 无效/失效的 runtime 引用明确报错，不静默切换目标；取消登记保留稳定 ID，重新登记不重复，活跃任务不被资源编辑改写执行位置。
- [x] 本地自动验收不要求用户手工操作；跨机注册与断线组合在远端阶段记录真实证据。

## 配置与操作体验

通过统一 CLI 分别登记、查询、命名及取消登记机器和 runtime；默认针对当前连接的本机，也能显式选择已授权机器。发现工具不等于登记资源；登记与查询不隐式启动服务、安装程序或创建 agent；首次缺少本机身份时提示先运行 start。资源存储在当前中心的数据目录，本地模式使用本机中心，不需要项目级资源文件。列表明确显示连接、机器、runtime 类型、登记状态、在线状态及探测时间；空列表提供下一步命令。

## 协作资源

- [HAPI 机器与执行配置](research.md#hapi-现有抽象)（读取 2026-09-29）：已有机器及工具类型/可用性，不把其 agent 字段直接当作 Runweft agent 定义。
- [Multica daemon/runtime](https://multica.ai/docs/daemon-runtimes)、[Agent 配置](https://multica.ai/docs/agents-create)（读取 2026-09-29）：runtime 关联机器与具体工具，agent 单独保存职责并引用 runtime；采用概念分离，不照搬其平台与权限体系。
