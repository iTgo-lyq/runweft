# 委派持久化与中心协调

delegation 具有稳定 agent_id，保存 owner/space/repository、内部业务 scope、原生父身份或 CLI 操作者、每轮 Agent 配置和固定工作环境；业务 round、input 与 HAPI/native session 分别关联。原生身份变化时保留新旧关联，不以会话 ID 永久不变为前提。

协调器运行在既有 serve 进程。中心以事务保存接受记录、轮次和输入后才执行；启动前保存 HAPI requestId，投递前保存 localId 与实际 child 身份。查询、准备、续接、权限、终态与关闭均复用 HAPI，不另建 runtime 执行器。已接受任务不依赖父 MCP/CLI 连接存活。

## 请求与角色

请求在 owner/space 范围以 UUID 去重，比较原始意图及父来源/发起目录，不比较后来变化的 Agent 内容。同 ID 同意图返回原接受记录；冲突报错。客户端先查询原接受，再由服务端解析新定义；配置后来修改不导致原请求再执行。另一个原生 tool call 是新意图，不做相似文本去重。

MCP 省略 request_id 时由 host、nativeSessionId、callId 和操作生成稳定 UUID。模糊接受先通过 list_agents/CLI 列表查询最近接受记录，再用相同 ID 和原意图重试。中心已尝试但结果不明的原生启动、输入、续接或 steer 只查询，不自动重放或换 ID 另起任务。

只允许一层 Runweft 委派。受控执行禁用全部 Runweft MCP；CLI 派生/追加也根据本中心保存的 child HAPI/native 身份拒绝。原生 fork/Agent 身份本身不等于 Runweft child，不探测外部 Hub metadata 或禁止原生内置递归。工具过滤见[宿主 MCP](../../host-mcp/spec.md)，这是协作约束而非同一账户内的安全隔离。

## 数据与服务

业务数据在中心 `server/runweft/state.sqlite`，schema 18 保存任务、轮次、输入、请求去重、child 关联与中心归属。使用 WAL；拒绝更高版本数据，不删除数据库回退。任务输入和报告作为业务数据保存，不复制完整原生 transcript 或隐藏推理，不保存模型凭据。Hub 客户端没有第二份权威任务库。

自有任务 API 为认证后的 `/api/runweft/tasks/{spawn,lookup,send,interrupt,permission,list,read,wait}` POST，使用 Hub 用户/空间 JWT；宿主元数据与业务身份分别校验。中心后台以受控对象绑定调用私有 HAPI，不依赖宿主短期 JWT，详见[中心委派](../central/spec.md)。客户端按 exp 提前续期认证，不自动重放业务 POST。

独立工作区增加 `retry-finish` 与 `workspace/remove` POST，沿同一父权限/操作者规则；MCP 不暴露删除工具。Task JSON v2 保存固定 source/环境状态，轮次保存准备与 Git 成果/回执，写入使用 revision 比较；旧无中心归属记录不认领或执行，未上线历史可显式重置，不转换原生历史库。删除操作身份和选项持久保存，中心重启也查询未完成删除。

服务关闭停止扫描并等待当前协调步骤结束；服务重启读取持久未完成轮次继续查询/收尾。宿主退出不等于任务取消；停止中心/Runner 也不代替显式轮次中断。
