# 下游配置消费

本模块由 createConfigurationGateway 组合，默认 serve/MCP 尚未切换。HubClient 复用身份备份、短 JWT 和能力探测；HubRepositoryClient、HubAgentClient 只消费当前中心，未找到能力会明确拒绝，不回退旧 YAML/HAPI root token。

## 服务与数据

- 健康能力：hubRepositories:1、hubAgentDefinitions:1、hubAgents:1，并保留身份/执行/资源能力。配置管理和解析共用明确 user JWT、space 和同一 state.sqlite v15。
- RepositoryStore 提供目录、别名、本人 checkout 与只读匹配；observeRepository 读取实际 cwd/Git/有效 fetch remote，原始 URL 在本机规范化。
- HubAgentStore 管理定义版本与授权；AgentSelectionStore 保存本人选择并确定来源；HubAgentResolver 复用 ResourceService.resolve 原生探测，返回固定 JSON。
- `/api/runweft/agent-resolution` POST `{hubRepositoryId?, agentId?, runtimeId?}` 返回 `{resolution}`。无选择、无 runtime、权限/类型/登记/仓库/离线失败保留 code/message/hint，不按名称或其他可用项改路由。

## 固定结果与提交

resolution 包含 actorId/spaceId/hubRepositoryId、agentId/agentOwnerId、整数 version/contentHash/definition、Agent/runtime 选择来源、裁剪 target、launchOptions、resolvedVersion。target 不含工具绝对路径或机器原生配置。模型认证、模型组合和执行都明确为 not_checked；原生探测成功不等于模型执行成功。

解析接口只接受选择输入，不能提交 resolution 冒充可信配置。阶段 5 的任务接收端自己解析并持久固定结果，客户端预览不作为派发凭据。同次异步解析的 validateSelection 验证固定内容与决定层偏好；当前角色/分享/登记/治理/仓库/runtime 在探测前后都检查。

已接受任务保存自己的不可变内容/目标；后续编辑不改写旧历史、不自动改派机器。实际派发前根据可信任务 owner/space/hubRepositoryId 调用 HubAgentStore.invocable 与 HubResourceStore.usable，验证当前授权与固定目标；新轮次重新解析。Tasks/Rounds、续接及失败回收由阶段 5 实现，本模块不复制状态机。

## 仓库上下文

checkout 的路径和 remote 是配置观察，不是远端执行证明。阶段 5 从真实宿主会话 cwd 和 HAPI 源工作区取得可信执行源；远端要求 Git，预先完成独立 worktree 准备。

Hub Repository UUID 只放 hubRepositoryId。HAPI WorkspaceSource.repositoryId 仍按 machineId/commonDir/objectFormat 原生计算；不能把中心 UUID 写进基线/bundle/结果清单。显式选定 Repository 仅允许配置预览，不绕过成员、资源或真实工作区验证。

## CLI

命令均在 `runweft hub --url <origin> --identity-file <backup> --space <uuid>` 下。`repository inspect` 是脱敏本机只读观察；match 未命中/漂移/歧义退出 1，bind 才持久关联。`agent create/update --file` 的 JSON 是一次完整定义输入；create 需要 --request-id，update 需要 --expected-version。

`agent select <id> [--repository <id>] [--runtime <id>]` 保存本人偏好；selection 列出记录，unselect 才允许下一层生效。resolve 的 --agent/--runtime 是本次覆盖，不编辑共享 Agent。Web 后台和产品 Skill 由阶段 6 消费同一接口。
