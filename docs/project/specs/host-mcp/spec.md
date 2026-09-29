# 宿主 MCP 接入

Runweft 的 stdio MCP 接入支持 Codex 和 Claude Code。`runweft mcp serve --client codex|claude` 从原生客户端的实际工作目录启动；stdout 只输出 MCP 协议，诊断走 stderr。全局安装见 [MCP 安装](../installation/mcp/spec.md)。

## 身份与工作区

Codex 每次调用解析原生 `_meta` 的 threadId、sessionId、callId 和可用 x-codex-turn-metadata，交叉核对重复字段。当前 threadId 是会话键，可以不同于根 sessionId；cwd 来自 MCP 进程的实际目录。

Claude Code 通过匹配 Runweft 工具的 PreToolUse hook 保存该次 toolUseId、原生 sessionId、cwd、可用 agentId 和时间；工具调用以原生 claudecode/toolUseId 精确消费该记录。相同 cwd 的会话不共用身份槽，`/clear` 和 resume 使用当次 hook，不沿用启动时的 session 环境变量。记录位于 `client.sqlite`，用后删除，未消费记录保留 24 小时；不保存 prompt 或工具输入。

业务工具参数不能覆盖宿主身份或 cwd；身份缺失、冲突或 hook 记录不存在时明确报错。initialize/tools/list 只返回静态工具目录，不写工作区数据或访问服务。有效业务调用才绑定真实工作区，传入身份、工作区、配置及取消信号。

## 工具、结果与取消

产品工具列表当前仅包含 `runweft_status`，返回原生身份、工作区、数据根和当前 local/hub 连接诊断；没有业务委派工具。服务认证和连通性失败在结果中可见，诊断不启动托管服务或模型任务。

工具处理器返回结构化结果及相同 JSON 文本。请求取消、超时、stdio 断开和终止信号传递到处理器及等待中的 HTTP 认证；不重放工具请求，不将等待取消转换为执行中断或归档。结果通过工具响应进入主上下文，不声明后台唤醒、主动注入或主宿主关闭后的恢复。

## 受控执行的工具禁用

HAPI 启动参数 `disabledMcpServers` 可按执行禁用指定 MCP，保存在会话 metadata，停止后续接保留。Runweft 子执行可传 `['runweft']`；业务委派尚未实现，当前执行调用层提供该参数能力。

Codex 将完整禁用定义应用于目标 root 的原生 thread/start、thread/resume，未安装该 MCP 时也可启动；同一共享 runtime 的无关 root 不受影响。Claude 使用原生 disallowedTools 排除指定 server 的工具，保留其他原生设置；其 MCP 进程仍可能连接，但工具不进入模型可用目录。

其他 MCP 和原生 Agent/Task 等子代理能力保留，原生递归与工具继承由原生客户端管理。子执行结果从 HAPI 原生输出读取，不需要子端 Runweft 汇报工具。能力兼容见 [执行兼容](../execution/compatibility/spec.md)；这不是同一系统账户内的进程隔离。
