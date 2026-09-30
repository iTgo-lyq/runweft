# 全局 Runtime 登记与目标解析

以下为默认旧 namespace 入口的已验收行为。独立新 Hub 组合入口的所有权、分享与接入见 [Hub 资源归属](../ownership/spec.md)，默认服务迁移前两者分别保持其认证契约。

runtime 表示指定 HAPI 机器上可调用的 Codex 或 Claude Code；flavor 只接受 codex/claude。每个 namespace/machineId/flavor 对应一个稳定 UUID，重复登记或取消后恢复沿用原 ID。名称可修改，不改绑机器或类型；多个消费者可以引用同一 ID，名称不承担路由。命令和原生配置沿 Runner 的环境，不提供每个 runtime 的自定义启动 profile。

`runtime discover [--machine <id>]` 查询实际命令与版本，不登记、不安装、不调用模型。`runtime register <codex|claude> [--machine <id>] [--name <name>]` 要求机器已登记且当前原生工具可发现；默认当前连接的本机。`runtime list` 默认登记项，`--all` 包含取消项；show/check 查询当前目标，rename 只改名称，unregister 取消登记但保留 ID、历史观察和原生任务。

## 工具探测

沿 HAPI 原 availability RPC 请求显式详情，Runner 并行查询两种实际 launcher 命令的版本，单项上限 3 秒。不读取模型凭据，不修改启动或权限配置。原 preflight available/reason 与实际 executable、version、versionStatus、checkedAt 分开返回。

目标可选同时要求 HAPI preflight 通过和实际命令可发现。Codex 的旧 HAPI_CODEX_APP_SERVER_BIN preflight 不等于 shared launcher 实际命令，不把旧覆盖程序当作真实版本；Claude 无效覆盖沿原生 not_found 表达。命令可发现但版本读取失败、超时或无法识别仍可选，版本状态如实显示。修改 PATH、原生 home 或覆盖后，需在目标机器重启 Runner 才能使用新环境。

列表每台机器探测一次，两种 runtime 共用当次查询。单台探测失败在对应项可见，认证错误整次失败。离线或查询失败保留历史详情及原 checkedAt，inspectionCurrent 为 false，不能作为当前可选证明；成功查询也始终标明模型认证和任务执行未检查。

## 新目标解析

`resolveExecutionTarget(runtimeId)` 读取当前登记、机器状态和当次原生探测，返回固定 runtimeId/machineId/flavor 与 inspection。不存在、已取消、机器未登记/离线、命令缺失、无效配置及探测失败都有结构化原因，不选择替代目标。异步探测后再次核对登记，探测期间发生的取消会阻止新解析。

已有调用持有自己的目标快照，重命名和取消不会改变它。取消后恢复保持稳定 ID；agent 引用需恢复登记或显式重新选择，不扫描、修改项目定义。原生启动的最后检查继续由 HAPI 执行；资源解析本身不运行任务。

show/list 返回可解释状态；显式 check 在不可选时退出码为 1，JSON 状态仍写 stdout。discover 缺少其中一种 CLI 时仍返回发现清单，连接或探测请求失败则非零退出。

作用域与接口见[资源范围](../scope/spec.md)。原生命令及环境故障的重复验证入口为 `bun run test:resources`，不需要模型认证；实际跨机器验证由远端能力承担。
