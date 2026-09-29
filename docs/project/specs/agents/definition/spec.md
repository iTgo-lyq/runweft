# Agent 职责定义与解析

一个 `.yaml` 文件定义一个 Agent，标识取文件名，满足 `^[a-z][a-z0-9-]{0,63}$`。`agent init <id>` 默认在全局位置创建带说明的模板；`--scope project` 创建项目定义。已有文件不覆盖，维护时直接编辑 YAML；`.yml` 明确提示改名，符号链接只读且显示实际目标。

| 字段 | 行为 |
| --- | --- |
| `schemaVersion` | 当前为 1，省略时默认 1 |
| `name` | 展示名称，省略时使用文件标识 |
| `description` | 供发现和选择；省略时为空，列表明确显示未填写 |
| `instructions` | 职责指令，独立于 description 返回；省略时为空 |
| `runtime` | 当前中心的 runtime UUID，可留空并使用个人绑定 |
| `flavor` | 可选 codex/claude；声明后目标类型必须匹配 |
| `model` / `reasoningEffort` | 可选原生参数；省略、null 或空白均不覆盖；非空时必须声明 flavor |

未知字段、重复键、无效类型和标识明确报错，不接受机器注册、URL、命令、环境、权限、skill/MCP 配置。Runweft 不维护模型清单，不自动选择 Agent 或触发任务。

`agent list/show/validate` 离线读取，不启动服务或创建数据库；validate 允许 runtime 为空。list/validate 返回有效项与错误项，有错误时非零退出；validate 指定 id 不存在或无定义也非零。show 与单项在线解析只读取该 id 的生效来源，无关错误不阻断它。

`agent check <id>` 通过当前 HAPI 认证与 ResourceClient 严格解析新任务目标，返回普通 JSON 内容快照；`list --check` 批量观察目标，复用每台机器一次探测，逐项报告问题，有错误非零退出。批量观察不代替实际派生前的严格解析。目标失效或类型不匹配保留明确错误，不回退到其他定义或 runtime。

快照保留 sourceCwd、projectRoot、定义来源/遮蔽项、声明与选用 runtime、connectionName、认证 namespace、实际机器/类型、原生参数及内容版本。definitionVersion 来自规范化定义；resolvedVersion 加入选用引用、目标、连接和 namespace，不包含探测时间、mtime 或绝对来源路径。后续文件编辑不改变已经取得的快照。

模型认证、模型参数组合和任务执行均标为未检查；定义解析不创建原生会话。原生参数边界见[配置继承](../inheritance/spec.md)，作用域与个人绑定见[来源与绑定](../scope/spec.md)，命令示例见[使用说明](../../../../usage.md#agent-定义与个人绑定)。
