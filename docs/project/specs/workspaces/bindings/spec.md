# 主工作区与仓库关联

业务调用采用宿主已验证的真实 cwd；MCP 不为目录另建 workspaceId 或写本机工作区绑定表。旧 workspace bind/list 已移除。

Git 仓库、remote 别名与本人 checkout 关联保存在 Hub。使用 repository inspect/match/bind/checkouts，观察和绑定规则见[仓库关联](../../repositories/association/spec.md)。Agent 项目范围引用中心 Repository ID，不读项目中的 Runweft YAML 配置。不同用户可以为同一仓库保存自己的选择。

原生执行从主 cwd 或已经准备的 git worktree 启动，因此项目 skills 和原生配置继续由 Codex/Claude 加载。非 Git 目录可执行本机共享任务；独立工作区和远端执行要求 Git 来源。
