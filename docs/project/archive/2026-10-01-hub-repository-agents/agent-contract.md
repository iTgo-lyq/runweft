# 中心 Agent、个人选择与固定快照

## 定义与访问

Agent 使用 Hub 分配的稳定 UUID，固定 owner/space；名称可重复。适用范围是当前空间跨仓库（repositoryId=null）或一个 Repository；可以更新范围但生成新定义版本。业务字段为 name/description/instructions、可空 runtimeId/flavor/model/reasoningEffort；不保存任意启动命令、环境变量、MCP/skill 安装配置或模型凭据。模型/推理参数非空时必须指明 codex/claude；最终目标必须匹配 flavor。name 最多 80、description 4096、instructions 32768、model/reasoningEffort 各 256 个字符，控制请求仍受 64 KiB 限制。编辑提交完整 definition 与 expectedVersion，缺少 name 或含未知字段均拒绝，不把部分输入当作覆盖补丁。

每次内容编辑以 expectedVersion 条件写入，递增整数版本并追加不可变定义行；对象登记状态、分享和治理分别保存，不让治理修改所有者的内容。创建 requestId 与初始内容摘要去重；恢复登记不另建 ID。历史版本仅 owner 可查，不能以过去的分享关系读取旧 instructions。

访问模式：private（仅 owner）、members（当前指定成员）、space（当前空间成员）。只有 owner 可以改内容、改分享或登记状态，获分享者可以读取当前完整定义并调用。非 owner 的空间管理员只见治理摘要：ID、名称、owner、适用范围、版本、登记/禁用与允许操作；不返回私有 instructions/model/runtime 绑定，也不取得调用权。治理禁用不因 owner 编辑/分享/恢复登记而清除。

移除成员时，同事务删除其个人选择、显式成员授权；移除 Agent owner 时撤回其共享（变为 private）并清除成员目标，保留内容版本/登记和治理事实。重新加入不恢复旧分享；空间模式原本面向当前成员，普通调用者重新加入后按当前共享范围取得调用权。owner 退出期间的 Agent 不可用。

## 绑定与个人选择

Agent runtimeId 可空，便于把职责定义分享后由调用者选择自己的目标。设置新的非空绑定时，所有者必须当前具备该 runtime 在此空间的使用权；机器离线不影响同步授权，但不能绑定别人的私有目标。已有目标失效不阻止修改 instructions；解析继续报告不可用，不能静默改绑。

个人选择唯一键为 user × space × repositoryId（可空），SQLite 以 `(userId, spaceId, COALESCE(repositoryId, ''))` 唯一索引及一致的 upsert 目标保证空间默认最多一行；保存 agentId 与可空 runtimeId override。只能操作自己记录；空间管理员不能代改。Repository/Agent 必须在当前空间、适用范围匹配且本人可调用；runtime override 仍需本人可使用且类型相符。删除选择才回到下一层，不把失效选择当不存在。

Agent 选择顺序：本次显式 UUID → 本人当前仓库选择 → 本人空间默认。没有确定选择时返回 agent_selection_required；不按名称、只有一个候选或共享推荐偷偷选择。仓库选择成为决定层后存在但失效时明确失败，不回退空间默认；本次显式 Agent 不受未选中层失效影响。

Runtime 选择顺序：本次显式 runtimeId → 与已选 Agent 相同的本人仓库 override → 与已选 Agent 相同的本人空间 override → 定义绑定。已选中的同一 Agent 的 override 失效时直接失败，不继续尝试低层目标；其他 Agent 的偏好不能影响本次目标。override 只改变本次目标，不改他人职责或原生全局配置。返回每一层的选择来源和不可用原因。

## 解析

请求包含可空 hubRepositoryId、可选 agentId/runtimeId；身份/空间从凭据取得。配置预览允许指定已授权 Repository，执行方阶段 5 再根据可信宿主 cwd 与 checkout 确认上下文。非 Git 仅使用空间级定义。

先确定 Agent 和固定版本，检查当前调用权、owner 成员资格、登记/治理、仓库范围；再选择 runtime，复用资源领域同步授权与实际探测。共享 Agent 不自动开放私有 runtime；返回目标未授权原因，不泄漏未开放的机器配置。

异步探测前后重查同一 Agent 版本、调用权、Repository 和 runtime；版本或本次决定层的个人选择改变返回 agent_configuration_changed，不把一次请求中旧 instructions 与新目标拼在一起；当前授权或上下文已失效时保留其具体失效原因。成功返回只读序列化快照：Agent ID/整数版本/内容摘要、定义、身份/空间/hubRepositoryId、选择来源、裁剪后的 runtime 目标、原生 launchOptions、resolvedVersion。Codex 映射 modelReasoningEffort，Claude 映射 effort；固定 disabledMcpServers=['runweft']，其他原生权限使用默认。

版本历史不随后续编辑改变；调用者不能提交旧快照冒充当前授权。导出同步 invocable/validateSelection 供阶段 5 在接受、派发、新轮次时复核，任务保存自己的不可变快照与访问范围。本阶段解析不创建 HAPI session 或 Task/Round。

## 接口与 CLI

- `/agents`：POST requestId 创建、GET 目录、GET `/requests/:requestId` 查询本人原创建请求；`/:id` GET 当前视图/PATCH expectedVersion 编辑/DELETE 取消；`/:id/register` 恢复、`/:id/access` PUT 分享、`/:id/block` PUT/DELETE 治理、`/:id/versions` GET owner 历史。去重摘要包含对象类型和空间，重放只读取原对象，不恢复其登记、内容或分享。
- `/agent-selections`：GET 本人记录、PUT 当前空间/仓库选择、DELETE 删除；严格限制字段，不能指定另一个 userId。
- `/agent-resolution`：POST 解析配置与执行目标，失败保留可操作 code/message，不自动启动执行。
- `hub agent create/list/show/update/register/unregister/access/block/unblock/versions`；`hub agent select/selection/unselect/resolve`。创建/编辑从显式 JSON 文件读取业务字段，文件只是一次输入，不是持续权威配置；提供 request-id/expected-version 控制重复与并发。列表不触发模型或默认选择。

## 下游使用边界

validateSelection 用于一次解析跨异步调用的固定选择检查；任务接收端须自己解析，不能接收客户端提交的旧快照作为权威。任务已被服务端接受后，其快照仍保留原内容/目标；后续纯内容编辑不改写或重定向它。派发前对已持久化快照调用当前 invocable 与资源 usable，重新核对成员、共享、登记、治理、仓库适用范围及固定 runtime；新轮次再解析当前定义。任务状态和续接细节仍由阶段 5 接线，本阶段不创建执行。
