# Agent 原生参数与配置继承边界

定义解析返回 HAPI launchOptions：agent 为实际 codex/claude，非空 model 原样传递；reasoningEffort 对 Codex 映射为 modelReasoningEffort，对 Claude 映射为 effort。始终附带 `disabledMcpServers: ['runweft']`，不附加权限覆盖、requestId、任务输入或启动目录。类型受定义中的 flavor 约束，不把两种工具的模型参数自动互换。

instructions 单独留给任务输入装配，description 用于发现；解析不写 AGENTS.md/CLAUDE.md，不复制用户 home、模型凭据或全局 skills/MCP，不改变工程配置与原生权限。

原生配置沿执行机器上该账户已有的 Codex/Claude Code 与 HAPI 加载规则，见[执行契约](../../execution/lifecycle/spec.md)。受控执行的 Runweft MCP 禁用及其他 MCP/原生子代理的保留见[宿主 MCP](../../host-mcp/spec.md)。定义检查只验证参数映射和当前目标资格，不证明具体模型组合或尚未准备的工作区配置已经执行。
