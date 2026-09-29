# 执行能力与配套版本

Runweft 使用 package.json 固定的 HAPI revision 及配套构建，原有健康、协议版本和 Runner 诊断仍有效。当前执行封装只接受 codex/claude，不静默切换 runtime。

HAPI health 的 spawnReceipts:1 表示可重查启动；execution:1 表示本版本执行观察协议。会话 metadata.capabilities.execution:1 在对应控制器就绪后发布；归档后可保留用于历史查询，不证明会话仍活跃。缺少所需能力明确拒绝，提示更新配套 Hub/Runner。

health 的 mcpToolFilter:1 与 Runner 的 capabilities.mcpToolFilter:true 表示支持逐执行 disabledMcpServers。携带禁用表时，Runweft 和 Hub 在首次启动前核对相应能力；Hub 在续接已保存禁用表的会话前也核对 Runner。缺少能力或 runtime 不支持时明确拒绝；不携带此参数的原有执行行为保持不变。参数计入持久 requestId 的一致性检查。原生落点见 [宿主 MCP](../../host-mcp/spec.md#受控执行的工具禁用)。

HAPI 的 HTTP 状态、code 与错误被保留。只有 native_session_missing 是确认缺失；其他错误和未知执行状态由上层处理，不能解释成可安全重发。

独立 Git 操作与 preparedWorkspace 启动需要 Runner `capabilities.managedWorkspaces:1`。不满足时明确拒绝并提示配套版本，不能回退到默认 HEAD 的快捷 worktree 创建；shared 与不使用准备引用的原有 HAPI 执行保持原行为。

中心文件声明 artifacts:1，Runner 输入与 preparedFiles 声明 artifactTransfers:1，输出另声明 artifactOutputs:1；旧输入能力不能冒充输出支持。文件接口沿现有机器 RPC，缺少所需能力明确拒绝，不通过模型补做准备。无附件的既有执行不增加文件能力要求。

资源查询要求 Hub 的 machineInventory:1 完整库存能力。原生版本详情使用 Runner 可选 agentAvailabilityDetails:true，缺少时提示升级；不将该能力加入普通 Runner 的强制要求。资源解析与实际执行的区别见 [Runtime 登记](../../resources/runtimes/spec.md)。

Codex/Claude 内置启动、配置、审批和会话管理继续复用 HAPI。补充的持久启动回执、原生事实、目标中断和已复现缺口修正均位于独立 HAPI fork；不支持 npm/path runtime 插件，私有 runtime 扩展不属于当前交付。

协议字段见 [HAPI 执行观察](../../../../../hapi/docs/api/execution-observations.md)。本地真实执行与故障注入证据见[验收记录](../../../archive/2026-09-29-hapi-subagent-foundation/execution.md#t4-配套构建与整体验收)。显式验证脚本为 scripts/smoke-execution.ts；它使用专用服务/项目并继承已有模型认证，不属于默认无凭据测试。本项验收不代替宿主 MCP、业务委派或真实远端验证。
