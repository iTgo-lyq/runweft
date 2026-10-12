# 中心 Agent

Hub 是 Agent 定义和个人选择的权威；根级 agent、hub agent 和委派解析使用同一身份/空间授权与中心 API。create/update 的 JSON 文件只是单次输入，不扫描全局或项目 YAML。健康能力为 hubAgentDefinitions:1 和 hubAgents:1，不满足时客户端拒绝，不回退本地文件。

## 定义和权限

Agent 使用稳定 UUID、固定 owner/space，名称可重复。完整 definition 包含 name、description、instructions、repositoryId、runtimeId、flavor、model、reasoningEffort。repositoryId=null 表示当前空间跨仓库；非空限本空间一个仓库。name 最多 80、description 4096、instructions 32768、模型/推理参数各 256 个字符，请求最多 64 KiB。未知命令/环境/权限/MCP/skill 或归属字段拒绝；模型参数非空必须声明 codex/claude。

创建 requestId 在 owner 范围去重，摘要含空间和规范定义；重放不覆盖后来内容/登记/分享。更新提交完整 definition 与 expectedVersion，以事务条件写递增整数版本；内容行与摘要不可变。新非空 runtime 绑定要求 owner 当前可使用且类型匹配；已有目标失效仍允许编辑指令，不自动改绑。最终目标类型在解析时验证。

访问范围为 private、指定当前 members 或当前 space 成员。仅 owner 可改内容、登记、分享或读取完整历史；共享只授予读取当前内容和调用资格。非 owner 的管理员对私有 Agent 只见 ID/owner/space/name/仓库范围/版本/登记/共享模式/治理/owner 在场状态及操作权限，不返回 definition、model、runtime 绑定、instructions 或内容摘要。成员清单仅 owner 可见。

管理员独立禁用，不改写私有内容，也不因 owner 编辑、分享或取消/恢复登记而清除。owner 离开空间期间不可调用；其分享在移除成员的同事务撤为 private、删除成员目标，保留内容/登记/治理。普通成员退出清除对其显式授权及其个人选择/checkout；重入不恢复旧个人选择或 owned Agent 分享，当前 space 共享仍按当前成员资格适用。

## 个人选择

个人选择唯一为 user × space × 可空 repositoryId，由表达式唯一索引保证空间默认最多一行，不能替他人修改。选择必须适合当前仓库/空间并可调用；可另存本人 runtime override，要求当前资源使用权和类型匹配。失效引用保留供诊断，显式删除才启用下一层。

Agent 顺序为本次显式 UUID → 本人仓库选择 → 本人空间默认；无确定项返回 agent_selection_required，不按同名项或唯一候选挑选。决定层失效直接失败；未选中层不影响本次显式选择。

runtime 顺序为本次显式 ID → 与已选 Agent 相同的仓库 override → 与已选 Agent 相同的空间 override → 定义绑定。其他 Agent 的偏好不影响目标；已选 override 失效不回退，完全未配置返回 agent_runtime_required。

## 解析与固定结果

解析输入为可选 hubRepositoryId/agentId/runtimeId，actor/space 来自用户 JWT。先核对 Agent 当前共享、owner 成员资格、登记/治理与仓库适用范围，再对所选 runtime 复用资源同步授权和原生工具探测；共享 Agent 不自动分享 runtime。私有机器配置、工具绝对路径不进入目标响应。

RequestLease 在异步探测前后重查内容和决定层选择；配置变化返回 agent_configuration_changed，当前授权/上下文已失效则返回具体原因，不组合新旧配置。成功 JSON 固定 actorId/spaceId/hubRepositoryId、agentId/agentOwnerId、version/contentHash/definition、选择来源、裁剪 target、launchOptions 和 resolvedVersion。探测时间不影响配置身份，后续编辑不改旧内容或既有快照。

validateSelection 用于同次异步固定检查；任务接收方须在服务端自行解析，不信任客户端旧快照。已接受任务的内容/目标与当前 invocable/usable 授权分别判断，纯内容编辑不自动重定向。中心 Task/Round 接入仍由默认委派模块负责，不由配置解析代建状态机。解析不创建 task/session、不调用模型；模型认证、模型组合和执行均为 not_checked。

## 接口与 CLI

- `/api/runweft/agents`：创建/目录，`/requests/:requestId` 本人回执；详情/完整条件更新/取消登记，`/register`、`/access`、`/block`、owner-only `/versions`。
- `/api/runweft/agent-selections`：GET 本人记录、PUT 选择、DELETE 删除。
- `/api/runweft/agent-resolution`：POST 选择输入，返回 `{resolution}`；拒绝把输出快照直接提交作为输入。
- `hub agent create/list/show/update/request/register/unregister/access/block/unblock/versions` 管理定义；create/update 的 --file 是一次 JSON 输入，不是持续文件权威。创建要求 --request-id，修改要求 --expected-version。
- `hub agent select/selection/unselect/resolve` 管理本人偏好和预览。--repository 指定 Hub 仓库，resolve 的 --agent/--runtime 仅覆盖本次，不修改共享定义。

定义、版本、共享/治理和选择存同一 state.sqlite。CLI 不另存中心配置副本；真实 cwd 与 Repository 的关系见[仓库关联](../repositories/spec.md)，执行资源权限见[Hub 资源归属](../resources/spec.md)。

## Agent 原生参数与配置继承边界

定义解析返回 HAPI launchOptions：agent 为实际 codex/claude，非空 model 原样传递；reasoningEffort 对 Codex 映射为 modelReasoningEffort，对 Claude 映射为 effort。始终附带 `disabledMcpServers: ['runweft']`，不附加权限覆盖、requestId、任务输入或启动目录。类型受定义中的 flavor 约束，不把两种工具的模型参数自动互换。

instructions 单独留给任务输入装配，description 用于发现；解析不写 AGENTS.md/CLAUDE.md，不复制用户 home、模型凭据或全局 skills/MCP，不改变工程配置与原生权限。

原生配置沿执行机器上该账户已有的 Codex/Claude Code 与 HAPI 加载规则，见[执行契约](../execution/spec.md)。受控执行的 Runweft MCP 禁用及其他 MCP/原生子代理的保留见[宿主 MCP](../host-mcp/spec.md)。定义检查只验证参数映射和当前目标资格，不证明具体模型组合或尚未准备的工作区配置已经执行。
