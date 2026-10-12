# 产品接入 Skill

`skills/runweft` 提供 Agent 使用的产品 Skill；主文件按接入、中心配置、委派和维护路由到 references，包含完整命令、安全限制、诊断和升级/卸载流程。主包和全部平台包携带同一 Skill，另有 `runweft-skill-<version>.tgz`；发行索引记录 SHA-256/SHA-512，官网以 npm 安装为入口，不提供独立下载。

用户授权后，Agent 将 Skill 放到 Codex `.agents/skills/runweft` 或 Claude `.claude/skills/runweft`；不同已有内容先备份/确认，卸载只删除确认受管目录。不自动安装到开发者全局配置，不修改模型凭据或其他 MCP/Skill。MCP 使用产品显式安装/更新/卸载命令。

流程先选择明确 Hub，再由用户浏览器确认独立身份/空间，使用加密 begin/complete，凭据不进模型、URL 或日志。新电脑即使只用 task CLI 仍须先登记本机；Web 读本人任务不需要登记。机器、runtime、中心 Agent 分开建立，不能把在线/工具发现当作模型成功。

当前 Skill 源码以 npm 为常规安装入口，从已安装 npm 包接入宿主；升级安装目标版本，核对入口归属。只删程序使用 npm，保留数据；完整删除使用根级 [uninstall](../cli/spec.md#完整卸载)，先核对实际版本支持。1.1.4 五包携带冻结的完整卸载维护说明；匿名 Linux x64 主/平台六文件及 README 逐字匹配v1.1.4源码，见[发布验收](../../../archive/2026-10-12-npm-uninstall-release/acceptance.md)。既有离线安装按已确认受管范围处理。

用户明确要求完整卸载即授权删除选定环境：Agent 先预览并核对范围，一致时直接执行 --yes，不再次确认；不依赖 config show 或业务库可打开。仅处理 Runweft 的 Skill 路径，普通目录须有 name=runweft 且文件集合属于包内 Skill；未知文件拒绝删除，符号链接只移除链接。保留其他 Skill、模型凭据、原生历史与用户项目；错误范围或失败停止并报告。实际卸载在独立终端执行，受管祖先不能停止自身。

维护区分安装程序和运行服务，升级后按角色重启；没有虚构自升级命令。停止/续接/文件和代码取回保留实际任务 ID，不确定结果先读状态与回执，不盲目重发。显式清理不删除仍需保留的 worktree，数据格式不匹配时指向独立新home；不提供data/reset、旧YAML迁移或自动历史认领。

完整用户路径见[使用说明](../../../../usage.md)；后台见[Hub 页面](../../dashboard/subagents/spec.md)。
