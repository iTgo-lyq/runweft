# 完整卸载技术方案

> 更新：2026-10-12

## 已调查事实

- CLI 无根级 uninstall；npm 只删除主包及可选平台依赖。`mcp uninstall` 经 applyConfigChanges 写入完整配置备份，不能直接作为无备份卸载入口。
- MCP 使用管理标记和 Claude 特定 matcher/hook；Codex 的 TOML AST 编辑器可直接删除自身条目并验证其余配置，卸载不需要调用 Codex 原生命令生成定义。
- 数据根包含 server、connections、client.sqlite、logs、backups、cache、tmp 和 config.yaml；原生 Codex/Claude 数据独立。Hub 停止以健康接口 instanceId 核验；Runner 原生 `/list`、`/stop-session`、`/stop` 控制接口足够，不改 HAPI。
- npm 主包启动平台二进制；主包 bin/runweft.cjs 与依赖 manifest 可确定程序归属。独立平台包也有准确 package.json 和相邻 bin/hapi。
- HAPI 受管任务工作树在 connections/*/hapi/workspaces/environments/*/checkout；workspace.json 记录 source/commonDir、branch 与固定结果。单纯递归删除会遗留源仓库 worktree 注册。

## 实现

根级 `uninstall` 默认只预览，`--yes` 执行；`--dry-run` 始终预览。输出支持全局 --json，包含程序、数据根、Skill、配置编辑及停止对象，不输出内容或秘密。选定路径由 configPath 解析，卸载不依赖业务数据库可打开；损坏配置不阻止删除，但不猜测未知运行状态。

先完成全量预检：确定编译安装归属，拒绝源码；npm 由实际运行二进制所在主包推导 prefix，核对固定 launcher 与 optionalDependency。禁止把用户 home、系统根、原生配置目录、项目或安装父目录当作数据根；数据根顶层只能含产品目录/文件，根符号链接拒绝，子符号链接只移除链接。Skill 从既有 Codex/Claude 发现位置核对 frontmatter name=runweft，未知同名目录拒绝。所有 MCP 修改预先生成并验证，无磁盘备份模式保留现有并发检查和内存回退。

停止本 home 的 Hub 和全部 connections Runner：Hub 核对 instanceId，Runner 核对进程与原生状态并使用现有控制接口停止已登记会话和 Runner。会话包含 `/list` 与 resume-processes 记录；控制接口并非完整进程清单，停止后以程序 realpath 再查残留，未知占用拒绝删除。不能确认或仍有程序使用的数据时停止卸载，不调用全局 HAPI doctor clean。只停止当前 home 的 MCP 服务；同程序其他 home 实例或卸载进程的受管祖先阻止自删除。

受管工作树仅核对 workspace.json 固定路径、Git 指回的工作树注册与 exact refs；删除该 checkout 和注册，不 prune 全仓库。只删除仍符合受管记录的 hapi-task/UUID 与 refs/hapi/workspaces/UUID；被用户改写的引用拒绝删除。源项目文件、用户分支和其他工作树不改。

执行顺序：预检 → 停止会话/Runner/Hub → 再核验 → 无备份移除 MCP/hook → 清理受管 Git 元数据和 Skill → npm uninstall -g --prefix <确定prefix> runweft --ignore-scripts（或删除确认为平台包的独立目录及指向它的入口链接）→ 立即核验程序已删除 → 删除 home → 核验不存在。npm 失败保留数据根并报错；不会为已经停止的进程或删除的文件制造虚假事务恢复。程序删除前可直接重试；程序删除后如数据删除失败，非零输出准确剩余路径与处理方式，不再提示调用已删除的程序。

## iclaude 评审落实

一次只读评审会话 `ff08266e-4108-42da-bd9b-8e91fe2dc187` 成功，主 agent 独立判断采纳：MCP/hook 按 home 和程序归属处理，另一 home 使用当前程序时拒绝；预检读写权限与当前用户所有权，root 不接管他人 HOME；数据根须有产品专属结构或可识别的生成配置，不能仅凭通用目录白名单；Skill 文件集合须为包内集合子集；外部 source/commonDir 可验证且任务分支未被其他 worktree 检出；数据内仓库缓存不做外部 Git 清理；npm 环境显式排除 dry-run 等行为污染并禁脚本；删除后核验所有对象，错误输出不转发原生 stderr。测试以隔离 env 的编译 CLI 子进程为主。

评审关于 `/list` 足够的原方案结论已修正。现有 HAPI 仍可承担准确会话停止，不改 launcher/runtime；未知残留以拒绝删除收口。

## 验证与边界

全部操作在 `.dev-smoke/` 或测试 fixture 的独立 HOME、CODEX_HOME、CLAUDE_CONFIG_DIR、npm prefix/cache 上完成。真实 npm 安装使用本次编译程序和本地平台依赖，不访问发布权限、不调用模型。测试覆盖预览、服务/多连接、重复执行、符号链接、凭据/原生会话/用户项目保护、未知归属与 npm 失败。Linux x64 为本机真实卸载证据；四平台交叉构建不代替 Mac/arm64 实机。

数据库/config schema 不变，首次部署基线与正常打开时的旧格式拒绝保持。完整卸载是用户显式销毁选定环境，不新增迁移、reset 或自动历史清理。
