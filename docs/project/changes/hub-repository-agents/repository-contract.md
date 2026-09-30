# Repository 与 checkout 契约

## 空间目录

Repository 是空间内的稳定 UUID，有创建 owner、名称、登记状态和明确别名。任意当前成员可创建；所有成员可看本空间目录，创建者和空间 owner/admin 可改名、管理别名或取消登记。目录仅是配置关联，不授予 Git 读取/clone 权、执行权限或其他空间成员资格。重入后可见目录来自当前成员权，不是 URL 授权。

别名唯一约束为 space × canonicalKey。冲突不合并记录、搬迁不改 Repository ID；通过显式增加/移除别名维护。取消登记保留别名、历史引用与 Agent 配置，阻止新仓库解析；恢复不改变 ID。不提供自动跨空间合并或 ownership 转移。

## URL 规范化

接受 HTTP(S)、git、ssh URL 与 SCP 写法。host 小写、规范默认端口；repository path 保留大小写，去除末尾 `/` 及一层 `.git`。保留传输类型和 SSH 相对/绝对路径区别，不猜测 SSH/HTTPS 或 SSH config 别名等价；用户可以把明确的多个别名加到同一 Repository。

HTTP(S) userinfo 去除。SSH 用户可能影响服务器的实际根目录，匹配键的规范元组保留其摘要而展示 URL 去掉 userinfo；不得输出/保存 SSH 密码，带密码、query/hash、控制字符、反斜杠或有歧义路径的地址拒绝。规范元组摘要为 canonicalKey，公开 displayUrl 无凭据。不同 SSH 用户不误合并，本地绝对路径/file remote 不作为跨机器键，保留“需要显式绑定”诊断。

原始 remote URL 仅在本机观察过程中短暂读取，不进入中心记录、错误或日志。测试包含 HTTP 凭据清除、路径大小写、默认端口、fork、不同 host、SSH/HTTPS 明确别名、SSH 用户/路径区别及无 remote Git。

CLI 发送传输类型、host、port、path、路径模式和 SSH 用户摘要构成的规范描述，不发送含凭据的原始 remote；服务端严格校验描述并重算 canonicalKey/displayUrl。直接管理别名时，服务端同样规范化输入 URL，不接受自报匹配键。SSH 用户摘要固定为 UTF-8 用户名的无盐 SHA-256；URL 与描述路径共用一份版本化规范函数，以跨路径键相等测试约束。不能规范化的 remote 仅保留原因与不可逆摘要，用于识别集合漂移，不能自动匹配目录。

## 本机观察和关联

CLI 从真实 cwd 读取 repositoryRoot、gitCommonDir、objectFormat、Git remote 名称及规范候选。非 Git 返回明确状态，不假装有仓库；空间级 Agent 可继续用于非 Git，本阶段不为其创建 Repository。

有效 remote 使用 Git 的 `remote get-url --all` 展开 `insteadOf`，仅观察 fetch URL，不把 push URL 当作仓库身份；不访问网络。不能读取 Git 配置时返回诊断，不将失败解释成“无 remote”。

Hub checkout 关联仅记录本人在本人机器上的配置元数据，须有当前 machine owner 和空间成员权；不向其他成员/管理员展示绝对路径。键为 owner × space × machine × real commonDir，避免同一 clone 的 worktree 被映射为不同 Repository。具体观察包含当前 worktree root/cwd，关联使用同一个 commonDir。成员退出时在 HubStore 同一事务删除本人 checkout，重新加入不恢复旧关联。跨 clone 的 commonDir 不同，但规范别名匹配同一个 Repository。

显式绑定支持无 remote 的 Git。关联保存规范 remote 集合摘要；重新观察若 remote 集合改变，要求显式确认新的关联，不继续套用旧配置。名称调整不改变规范集合。Hub 不从客户端路径读文件；执行前的真实目录/基线验证继续归可信宿主与 HAPI。

匹配优先使用本人已有且观察未漂移的 checkout 关联。没有关联时，只在当前空间寻找规范别名：全部候选明确收敛到一个 Repository 才返回匹配；多个 Repository、已知/未知 remote 混合或多个尚未明确关联的目标返回歧义及可见候选，要求显式选择/绑定；未命中时提示添加明确别名，不把 fork 的 upstream 静默当项目。用户可显式选择 remote 后匹配，但不会因该 URL 加入空间。

## 接口

- Repository：POST 创建（requestId/name/aliases）、GET 列表/详情、GET `/requests/:requestId` 查询本人原创建请求、PATCH 名称、DELETE 取消、POST `/:id/register` 恢复；PUT/DELETE `/:id/aliases` 管理规范别名，均授权后处理。去重摘要包含对象类型与空间；查询和重放返回原稳定 ID 及当前记录，不覆盖之后的编辑。
- Checkout：POST 观察/匹配只读且不保存记录，PUT 显式关联，DELETE 解除本人关联，GET 仅本人可见记录。输入 machineId、观察与可选 repositoryId，owner/space 来自凭据。
- CLI：`hub repository create/list/show/rename/register/unregister/alias/un-alias` 与 `inspect/match/bind/unbind/checkouts`；Git 观察使用 `--cwd`，中心关联显式选择 `--machine`。

中心 Repository UUID 与 HAPI WorkspaceSource.repositoryId 分别表示跨 clone 配置身份和原生执行对象，后续 Task 上下文用 hubRepositoryId 区分；不把 UUID 替换进 Git bundle、WorkspaceSource 或基线校验。
