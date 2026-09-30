# 产品接入 Skill

`skills/runweft` 提供 Agent 使用的产品 Skill；主文件按接入、中心配置、委派和维护路由到 references，包含完整命令、安全限制、诊断和升级/卸载流程。主包和全部平台包携带同一 Skill，另有 `runweft-skill-<version>.tgz`；发行索引记录 SHA-256/SHA-512，官网提供校验下载。

用户授权后，Agent 将 Skill 放到 Codex `.agents/skills/runweft` 或 Claude `.claude/skills/runweft`；不同已有内容先备份/确认，卸载只删除确认受管目录。不自动安装到开发者全局配置，不修改模型凭据或其他 MCP/Skill。MCP 使用产品显式安装/更新/卸载命令。

流程先选择明确 Hub，再由用户浏览器确认独立身份/空间，使用加密 begin/complete，凭据不进模型、URL 或日志。新电脑即使只用 task CLI 仍须先登记本机；Web 读本人任务不需要登记。机器、runtime、中心 Agent 分开建立，不能把在线/工具发现当作模型成功。

维护区分安装程序和运行服务，校验配套包后升级并按角色重启；没有虚构自升级命令。停止/续接/文件和代码取回保留实际任务 ID，不确定结果先读状态与回执，不盲目重发。显式清理不删除仍需保留的 worktree，也不提供旧 YAML 迁移或自动历史认领。

完整用户路径见[使用说明](../../../../usage.md)；后台见[Hub 页面](../../dashboard/subagents/spec.md)。
