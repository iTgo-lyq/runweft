# 轻量 Agent 定义与原生配置继承

> 状态：草稿
> 规模：中型
> 更新：2026-09-29
> 确认依据：参考 Multica 定义 agent，暂不集中管理 skill/MCP；继承接入 runtime 的全局与工程配置；启动策略由业务 skill 决定。

## Change 依赖

| 关系 | Change | 依赖内容与满足条件 |
| --- | --- | --- |
| 前置 | [统一 CLI 与部署](../../archive/2026-09-29-unified-cli-and-deployment/requirement.md) | 读取全局/项目定义并解析 HAPI 目标，不建立新的 runtime 注册平台 |
| 前置 | [全局资源注册](../execution-resource-registry/requirement.md) | 解析 runtime 引用及所属机器，agent 文件不承担资源注册 |
| 下游 | [委派生命周期](../delegation-lifecycle/requirement.md) | 消费解析后的定义，通过 CLI/MCP 向主 agent 提供描述和可用目标 |

## 独立验收与交付边界

以 CLI 的定义读取、发现、校验和参数解析独立验收，不启动任务、不依赖 MCP 或工作区准备。输出明确的 runtime 目标、指令和可选覆盖参数；空值保留原生默认，业务触发规则不属于定义。

原生配置如何进入执行进程由 HAPI 执行契约实现；共享、独立及远端目录中的实际加载由对应执行 Change 验收。本 Change 提供继承规则，不把这些消费者全部列为完成前置。

## 行为变化

### ADDED

#### `agents/definition`：职责与执行目标

参考 Multica 的名称、description、instructions 与 runtime 分工：定义稳定标识、名称、职责说明、执行指令和 runtime 引用；可选模型/推理参数留空时使用 runtime 默认。runtime 再引用机器；agent 不内嵌机器注册、连接或可执行文件注册配置，当前不构建统一 agent 控制台。

Runweft 提供 agent 发现和协作工具，业务方 skill 决定何时使用哪个 agent；不内置自动选择器、skill 触发规则或业务调度工作流。未来控制台可读写同一轻量定义，不为此预建管理平台。

#### `agents/scope`：全局与项目级定义

全局 agent 跨项目可用，项目 agent 只在所属项目上下文中生效。配置能显示来源、最终生效值及 runtime 引用；建议同标识项目定义覆盖全局定义并显式显示来源，具体文件格式在技术方案落实。项目定义不反向改写全局 agent，不允许注册或覆盖机器/runtime。

资源注册评审提醒：runtime ID 属于当前中心，Git 中的项目定义在另一用户/中心可能无法解析；本 Change 的 Technical 必须给出显式重新绑定及来源展示，不按展示名称自动改派，也不要求项目重新登记全局资源。

Git worktree 使用对应项目基线中的定义，远端执行接收发起时已经解析的定义版本；不要求复制发起机全部全局配置。该定义快照不替代目标 runtime 的原生全局配置继承。

#### `agents/inheritance`：沿原生加载配置

Codex/Claude Code 继续使用执行机器上该 runtime 用户的原生全局配置。在主 cwd 或准备完成的 worktree cwd 启动，沿原生发现加载工程指令、skill 与 MCP；不提供集中 skill/MCP 分发、复制用户 home 或空白隔离 profile。

远端继承的是远端执行账户已有配置，不等于自动搬运发起机器的全局 skill、MCP、凭据。工程内随 Git 到达的配置自然可用；未进入基线或 ignored 文件的可用性需要按实际原生发现规则说明。

只附加任务身份与必要指令，并在 HAPI 调度的 Runweft subagent 中禁用 Runweft MCP 工具；沿 HAPI 现有配置入口，不覆盖工程 AGENTS.md/CLAUDE.md 或清空原生全局配置。其他 MCP 与原生内置 subagent 保持原样，子端不另装 Runweft 汇报工具。

## 验收标准草案

- [ ] 能定义、发现并选择 agent；没有配置模型时保留原生默认。
- [ ] 全局/项目作用域、同名覆盖来源和 runtime 引用可自动验证；项目设置不改变全局机器或 runtime 注册。
- [ ] 业务 skill 决定启动时机，定义本身不会自动运行任务。
- [ ] 解析结果保留原生配置入口及 cwd 语义；共享/独立/远端模式的真实加载分别由消费者验收，未到达目标的文件不宣称已继承。
- [ ] 无中心 skill/MCP 管理、配置 home 复制或额外权限隔离。

## 协作资源

- [Multica Agent 定义](https://multica.ai/docs/agents-create)（读取 2026-09-29）：采用职责、指令与执行目标的分工；不采用其 Access、中心 skills/MCP 和 builder 控制台。
- [Claude Skills](https://code.claude.com/docs/en/skills)、[原生配置](https://code.claude.com/docs/en/settings)（读取 2026-09-29）：按用户/工程位置加载；worktree 主 checkout 回退行为有版本条件，不能作为跨机器配置同步。
