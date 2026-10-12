# 完整卸载自动验收

2026-10-12 按用户已授权的本地自动验收完成；没有新增人工门禁。实现已提交，尚未发布到 npm，公共 1.1.3 没有此命令。

`runweft uninstall` 默认只预览；`runweft uninstall --yes` 完整删除且不留备份。自定义目录使用 `runweft --home <目录> uninstall --yes`；`--dry-run` 始终预览。选定 home 的 Hub、全部连接 Runner 和已登记会话先停止，再移除当前安装、自身 MCP/hook/Skill、数据与备份。操作只覆盖当前安装和选定本机数据根。

| 需求 | 可观察证据 |
| --- | --- |
| 全部程序、数据、备份、接入消失 | 真实 npm 全局安装后的 CLI 自删除；主包、平台依赖、bin 入口、home 和三个位置的 Skill 不存在，MCP/hook 恢复为保留项 |
| 预览零副作用与拒绝危险范围 | 冷预览及 yes+dry-run 比较字节摘要；活动预览保留 Hub/Runner/会话 PID；根测试覆盖普通目录、危险路径、未知包、外部内容及跨 home 接入 |
| Hub/全部 Runner/登记会话停止 | 两个真实 Hub、同一 home 的两个连接 Runner；当前及恢复记录中的 Node 测试进程经真实 HAPI 控制接口停止，另一个 home 的 Hub 保持存活；错误控制端口在发送停止请求前拒绝 |
| 保留其他配置、凭据、历史与项目 | npm smoke 与根测试比较 Codex/Claude 保留配置、注释、模型凭据、原生历史、其他 Skill/程序和源文件；内容不变 |
| 符号链接及 Git 删除边界 | 根测试只移除数据链接，不触碰目标；正常清理确切 checkout/注册/refs，保留源文件、未提交文件、用户分支与其他 refs；另一 worktree 检出任务分支时拒绝 |
| 独立包、重试与失败 | 完整平台目录/PATH 链接真实自删除；先制造 npm 失败，确认数据/程序保留后重试成功；重装后原 home/接入已不存在仍可卸载；readonly prefix、损坏状态与未知占用拒绝 |

`bun run typecheck`、`bun run build`、260 项根测试和 8 组真实安装专项全部通过。实现/证据指纹与首次失败记录见 [verification.json](verification.json) 和 [Execution](execution.md)。T1 为 `2cd0436`，T2 为 `4bfa1ee`；归档后独立提交 Specs。

真实卸载平台为 Linux x64。会话使用登记到真实 HAPI 的测试进程，未运行 Codex/Claude 模型，不代替原生模型协作或物理远端测试。Mac/arm64 本次未实测，Mac ps 适配仅有官方实现依据。实际用户环境没有运行完整卸载；独立 HAPI 未动，新建测试服务、安装和数据已清除。

数据库/config 格式未变。普通 mcp uninstall/restore 继续写备份，npm uninstall 继续保留 home；完整卸载是用户显式销毁选定环境，不新增旧格式迁移或自动历史清理。
