# 宿主 MCP 适配技术方案

> 来源：[Requirement](requirement.md)、[Research](research.md)
> 状态：已确认
> 更新：2026-09-29
> 确认方式：沿用户逐 Change 自主落实、一次 iclaude Plan 评审后执行的授权；最新子执行边界由用户直接确认。

## 方案与依据

Runweft 提供一个 stdio MCP 入口、两种宿主的调用身份解析及全局安装命令。受控子执行通过 HAPI 的原生配置入口禁用指定 MCP 工具；不增加执行器、原生会话库或角色分流服务。

已验证：Codex `0.156.1` 的调用元数据可识别当前线程；Claude Code `2.1.283` 的 PreToolUse 与 MCP toolUseId 可以精确关联。两者首次工具发现均不能依赖逐调用身份，因此主入口返回静态工具列表，在业务调用前取得身份。原生入口与 T1 的真实 HAPI 源码管理链路均已验证启动及恢复同一原生 session 时的禁用；Codex 使用完整禁用定义。配套编译产物整体验收由 T4 完成。

已有 Specs 中的 HAPI 执行事实、关闭/续接、默认权限、配置继承和未知结果处理继续有效。本 Change 不引入派生工具、任务状态或成果收集；委派 Change 消费这里的接口。

## 主宿主调用

`runweft mcp serve --client codex|claude` 从原生客户端的实际 cwd 启动，不在全局配置里固定项目路径。复用现有工作区绑定和连接配置，local/hub 模式选择仍由 Runweft 配置决定。工作区写入和服务访问在有效业务调用后进行，单纯 initialize/tools/list 不启动任务或托管服务。MCP stdout 只输出协议，错误与运行日志走 stderr。

使用 HAPI 已安装的官方 MCP TypeScript SDK `1.25.1`，在 Runweft 固定同版本，承载初始化、发现、调用和取消，不手写另一套协议栈。业务处理器取得统一的调用上下文和 AbortSignal，返回 MCP 结构化结果；工具描述与处理器由所属 Change 注册。产品保留只读连接诊断工具，用于检查宿主身份、当前工作区和服务连接，不注册测试用派生或等待工具。

| 宿主 | 身份来源与处理 |
| --- | --- |
| Codex | 每次调用解析 `_meta` 中 threadId/sessionId/callId 和 `x-codex-turn-metadata`；兼容实测的对象与历史 JSON 字符串形态，交叉核对同名身份。threadId 是当前会话键，不能以 threadId 与根 sessionId 不等就拒绝 fork。cwd 取 MCP 启动的真实目录，不接受模型路径参数冒充宿主目录 |
| Claude Code | 安装匹配 `mcp__runweft__.*` 的 PreToolUse command hook。hook 只保存 tool_use_id、session_id、cwd、可用 agent_id 及时间；MCP 以原生 `_meta["claudecode/toolUseId"]` 读取该次调用记录。每次独立关联，`/clear` 或 resume 后不继续使用 MCP 启动环境中的旧 session ID；缺少 hook 记录明确报错 |

调用上下文包含 host、nativeSessionId/currentThreadId、根身份（如可用）、可信 cwd 和可用 HAPI session ID；它是调用方适配结果，不接受业务工具参数覆盖。Claude 原生子事件可保留身份事实，但不据此禁用原生 Agent，也不承诺原生子连接有独立工具列表。

Claude hook 的短期记录放入已有 `client.sqlite` 的独立表，按 toolUseId 关联，用后删除，未消费记录保留 24 小时以覆盖审批等待；不保存 prompt、工具输入、模型凭据或 transcript 内容。不同进程、相同 cwd 不共享一个“当前 session”可变槽。表由本模块按现有 SQLite 模式创建，卸载 MCP 不删除其他业务数据。主宿主重启后的任务恢复不在范围内。

## HAPI 的逐执行工具禁用

管理参数采用可选 `disabledMcpServers: string[]`，Runweft 受控启动传 `['runweft']`。HAPI 不认识 delegation 或 Runweft 子角色，只负责这个已验证的启动选项；空值保持原有行为。初期只允许 Codex/Claude 使用该选项，其他 runtime 明确拒绝，不静默忽略。

首次启动沿已有 REST spawn → 持久启动回执 → machine RPC → Runner → 原生 launcher 传递，并保存在 HAPI 现有 session metadata。该参数计入 requestId 的参数一致性检查。当前 Hub resume 已传入 existingSessionId，bootstrap 直接保留该行 metadata 中的禁用表，launcher 从恢复后的 metadata 读取；不再向 resume 的 RPC 增加第二份禁用参数。Hub 仍在恢复前核对 Runner 能力。

- Codex：在对应 SharedCodexRoot 的 thread/start、thread/resume 配置中，为指定 server 设置完整 `{command: 'hapi-disabled-mcp-placeholder', enabled: false}` 定义。该 command 是不会启动的占位值；实测原生在无原条目、原 stdio 条目和原 HTTP 条目时都接受完整定义。只写 enabled=false 会在没有安装该 MCP 时产生 invalid transport。不得进入共享 engine 全局配置，其他 root 保持自身配置；冷续接先读取已保存的 metadata。新的无关 root 不继承另一个 root 的禁用表。
- Claude：将每个 server 映射为原生 `--disallowedTools mcp__<server>__*`。remote launcher 在已有 SDK disallowedTools 上合并会话 metadata 的禁用项，保留逐轮原生设置；local launcher 和目录扫描也应用同一禁用项。现有 remote 路径会过滤不在 catalog 白名单中的 claudeArgs，不能只向该数组追加参数就宣称接通。复用 SDK 原生参数，不重写查询循环、不用 strict-mcp-config 清空其他 server。Claude 仍可能连接该 MCP server，但模型可用工具列表不含其工具。
- 兼容：Hub 声明新增管理能力，Runner 声明支持此选项。请求携带禁用表时才要求该能力；版本不足在原生执行启动前报错。Runweft 检查配套能力，不能让旧 Hub 的未知字段剥离悄悄失去约束。

下游委派通过此参数隐藏所有 Runweft MCP 工具；结果仍由既有 HAPI 输出读取。子 shell 的 Runweft CLI 派生拒绝由委派入口执行，可使用 HAPI_SESSION_ID 查询保存的执行上下文；本 Change 不创建新的 CLI 派生入口。这里的协作限制不是同一系统账户下的进程安全隔离。

## 全局安装与维护

`runweft mcp install` 为检测到的支持客户端注册入口，也支持显式选择 codex、claude 或两者；重复运行即检查和更新自己的配置。`mcp check` 展示实际配置文件、Runweft 命令、home、服务模式、stdio 握手及服务可达性；不把握手成功称作模型已成功调用。`mcp uninstall` 移除自己的注册与 hook，保留其他配置。真实客户端的首次调用另由验收脚本验证。

所有安装均使用固定 server ID `runweft`；命令包含所选 Runweft home，不固定 cwd、不嵌入认证令牌。编译版记录自身可执行路径，开发版显式记录 Bun 与源码路径，check 能指出失效路径。已有同名非 Runweft 配置明确报冲突，显示原文件和处理办法，不盲目覆盖。

Codex 使用实际 CODEX_HOME/config.toml；复制文件到 Runweft 临时 staging，复用 `codex mcp add/remove` 的原生编辑器，仅将 Runweft server 差异写回。核对其他 TOML 配置语义及注释保留，不复制凭据至 staging。Claude 分别解析两份文件：未设置 CLAUDE_CONFIG_DIR 时 MCP 位于 `~/.claude.json`、hook 位于 `~/.claude/settings.json`；设置时分别为该目录下 `.claude.json`、`settings.json`。只合并自己的 mcpServers 与 hook，不触发原生 CLI 的额外迁移字段。

备份与操作记录统一放在 Runweft home 的 `backups/mcp`，文件权限限制为当前用户。修改前校验原文件；候选配置校验成功后原子替换。Claude 两文件写入出现错误时恢复本次已改的文件；若发现用户并发修改，停止并展示备份与恢复方法，不覆盖后来变更。安装输出备份路径；提供显式 restore 命令和影响说明，不自动撤销后续用户修改。卸载仅删除仍属于 Runweft 的条目，不整份恢复旧备份。

## 取消、错误与结果

SDK 提供单次请求取消 signal；已核对的 1.25.1 close 路径不会主动中止所有服务端处理器，因此适配层另用连接级 AbortController，和请求 signal 合并传给业务处理器。工具级超时产生可辨认错误。适配层不把取消等待转成 interrupt/archive，也不自动重放工具请求。身份缺失、客户端配置无效、连接失败等保留可操作诊断，不打印完整请求或凭据。

当前可兑现的结果入口是工具响应；普通 MCP 注册没有已验证的后台唤醒能力。主动注入能力默认不声明，后续若接入具体原生入口必须单独实测。不能以日志通知、tools/list_changed 或内部 waiter 通知代替宿主唤醒。

## 验证与就绪性

无需新增外部账号或用户配置。现有本机 Codex/iclaude 认证可用于用户授权的专用验收；全局安装试验使用独立 CODEX_HOME/CLAUDE_CONFIG_DIR，真实用户配置不改。原生 CLI 必须在测试证据中记录版本；临时输出集中在 `.dev-smoke/`。

先验收 HAPI 的 spawn/stop/resume 两种真实原生链路，再验收两种主宿主的实际 MCP 连接、同 cwd 并发身份、Claude `/clear`/显式 resume、结果和取消。协议模拟覆盖缺失/冲突身份和断开；不能替代真实宿主证据。全局安装覆盖重复安装、更新、选择客户端、其他配置/注释保留、失败恢复和卸载。

Runweft 运行类型检查及相关测试；HAPI 共享契约变更执行其规定的完整类型/测试与 fixture 检查。配套编译产物完成整体验收后才同步 Specs。macOS 完整组合由集成与发布 Change 统一验证，真实远端验证缺口按既定授权单独记录。核心实现路径已具备证据；错误文案、模块内函数拆分留给实施，不再转问用户。
