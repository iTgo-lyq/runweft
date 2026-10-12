# Hub 仓库身份与 checkout 关联

默认 Hub 网关提供中心 Repository 目录与本人 checkout 关联，CLI/MCP 委派使用同一仓库匹配。仓库是所选空间内的配置身份，不授予 Git 代码读取、机器执行或空间成员资格。

Repository 使用稳定 UUID、固定 owner/space、名称、登记状态与明确别名。当前成员可创建/查看本空间目录；创建者和空间 owner/admin 可改名、管理别名、取消/恢复登记。取消登记保留 ID/别名/配置引用，阻止新解析。创建用 owner 作用域 requestId 与含空间的规范摘要去重；重放/回执读取原对象当前状态，不覆盖后来编辑。

Git 地址接受 HTTP(S)、git、ssh URL 与 SCP。host 小写/默认端口归一，path 保留大小写、去末尾 `/` 与一层 `.git`；保留协议、SSH 相对/绝对路径与 SSH 用户区别。HTTP userinfo 丢弃，SSH 用户仅保留固定无盐 SHA-256，密码、query/hash、控制字符、反斜杠与歧义路径拒绝。本地/file remote 不能自动成为跨机器键。

CLI 用 `git remote get-url --all` 展开 insteadOf，只观察 fetch URL，不访问网络；本机先生成规范描述，Hub 严格校验并重算 canonicalKey/displayUrl。未知/本地 remote 只保留类型与不可逆摘要。原始含凭据地址不写入中心记录或诊断。别名唯一为 space × canonicalKey，SSH/HTTPS、不同用户/host/path 不猜测等价，冲突不合并记录。删除可使用规范描述、原 URL 或已授权仓库内的 canonicalKey 选择器。

checkout 必须来自当前用户拥有的机器，且用户仍为所选空间成员。记录键为 owner × space × machine × real Git commonDir，同一 clone 的 worktree 共享关联，跨 clone 通过明确别名匹配；cwd/root/commonDir 只在本人 checkout 响应出现。观察路径只是配置元数据，不是可信执行证明。

匹配首先使用本人现有且 remote 集合/对象格式未变化的关联；集合变化要求显式重新 bind，remote 改名不算变化。没有关联时，所有候选须收敛到本空间同一已登记 Repository；多个仓库、已知/未知混合不自动选择 fork/upstream。可以指定 remote 或显式 bind；无 remote/local remote Git 可手动关联，非 Git 只返回 non_git，不创建 Repository。观察/匹配不写状态。

接口 `/api/runweft/repositories` 提供创建/目录、`/requests/:requestId`、详情/改名/登记与 `/aliases`；`/api/runweft/checkouts` GET 本人记录、POST 只读匹配、PUT 绑定、DELETE 解除。均使用明确空间的用户 JWT，拒绝自报 owner/space 和未知字段。

CLI 位于 `hub repository`：create/list/show/rename/register/unregister/alias/un-alias/request/inspect/match/bind/unbind/checkouts。创建要求 --request-id；本机观察用 --cwd，中心匹配和绑定要求 --machine。inspect 无需身份 token；match 非 matched 时退出 1，并返回歧义、漂移或未关联的可操作提示。

数据存同一 state.sqlite；成员退出同事务删除其 checkout，重新加入不恢复旧关联。Hub Repository UUID 用于配置上下文 hubRepositoryId；HAPI 原生 repositoryId 继续表示 machine/commonDir/objectFormat 对应的 Git 对象，不替换基线、bundle 或原生工作区清单。

业务调用采用宿主验证的真实 cwd；MCP 不另建 workspaceId 或本地绑定表。Hub Repository 用于 Agent 项目范围，原生配置仍由实际执行目录加载。
