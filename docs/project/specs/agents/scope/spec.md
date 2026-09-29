# Agent 来源与个人绑定

全局文件位于 `<数据根>/agents/<id>.yaml`，项目文件位于 `<项目根>/.runweft/agents/<id>.yaml`。项目同 id 定义整体覆盖全局项，空值不继承；show 显示生效来源和被遮蔽路径。坏的项目项不会退回全局；被遮蔽文件不参与生效校验。show/check/bind/unbind 的 `--scope global|project` 可显式维护指定来源。

调用库必须提供宿主的绝对 cwd，不使用 MCP 进程的工作目录。Git 项目以当前 worktree 根为范围，保留原调用 cwd；非 Git 项目向上找最近的 `.runweft/agents`，搜索在用户 home 前停止。无定义时可在当前目录创建项目定义，非 Git 用户 home 只使用全局来源；全局目录不重复解释为项目来源。文件定位不注册工作区、机器或 runtime。

共享定义可不声明 runtime。`agent bind <id> --runtime <ID>` 认证后查询已知目标，核对 flavor 和 local 本机限制，再保存本机个人选择；不改写 YAML 或注册资源。已知离线/取消登记的目标仍可保存，输出当前不可选原因；check 严格拒绝这些目标。`agent unbind <id>` 只解除当前身份的个人绑定，回到 YAML 引用；文件也为空则未绑定。

个人绑定在 `<数据根>/client.sqlite` 的 `agent_runtime_bindings` 表，按以下维度唯一：

- 连接沿现有 connectionName：local 固定、Hub 根据 URL 区分；local 改端口保留绑定，同 URL 的 local/hub 仍隔离。
- namespace 来自 HAPI 认证，切换身份不能借用其他 namespace 的绑定。
- 来源：全局为 `global/<id>`，跨项目可用；Git 项目为规范化 Git common dir 加 id，同仓库 worktree 共享个人选择，各自读取各自基线定义，不同 clone 隔离；非 Git 项目按规范化项目根加 id。

项目覆盖不会继承全局个人绑定，展示名称不参与路由。离线 list/show 列出当前连接中该来源的历史个人绑定及 namespace，并标为尚未认证；在线解析只选择精确认证 namespace 的绑定，优先于 YAML runtime。数据库读取不存在时不创建，写入只维护自己的表，保留工作区与 MCP 身份记录。
