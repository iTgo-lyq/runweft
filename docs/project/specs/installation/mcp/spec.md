# 全局 MCP 安装与维护

`runweft mcp install` 为检测到的 Codex/Claude Code 注册全局 Runweft MCP；可通过 `--client codex|claude|all` 明确选择。安装只由显式 CLI 命令触发，不自动修改用户配置。

固定 server ID 为 `runweft`，记录实际可执行入口和选定 Runweft home；不固定 cwd，不写入连接令牌。开发入口使用 Bun 与源码的绝对路径，编译入口使用自身路径，支持含空格路径。重复安装检查和更新自己的注册；已有非 Runweft 管理的同名条目时明确拒绝覆盖。

## 原生配置

- Codex 使用 CODEX_HOME/config.toml，默认 `~/.codex/config.toml`。安装时原生编辑器在 staging 生成自身定义，按 TOML AST 的原文范围合入目标；卸载直接编辑 TOML AST，不依赖 Codex 可执行程序。保留其他 MCP、配置语义和注释，不复制或修改模型认证文件。
- Claude 默认 MCP 文件为 `~/.claude.json`，hook 文件为 `~/.claude/settings.json`；设置 CLAUDE_CONFIG_DIR 时分别使用该目录下的 `.claude.json`、`settings.json`。只维护自己的 server 和匹配 `mcp__runweft__.*` 的身份 hook，保留其他设置。

两种客户端在不同项目启动时使用各自实际 cwd；全局安装不创建业务 agent 或 runtime 注册。

Codex 受管条目写入 tool_timeout_sec=600，为最长 540 秒的 wait 留出返回余量。旧受管条目由显式重复安装升级，其他 MCP 和配置保持不变。

## 诊断与恢复

`mcp check` 展示实际配置位置、命令、home、stdio 握手和当前服务状态，检查禁用入口、失效路径和 Claude hook 一致性。它不运行模型，不把握手称为真实宿主调用成功；服务不可用与安装配置问题分别报告。

Codex 受管超时缺失或小于 600 秒时，check 提示重新安装，不自动修改配置。

普通 mcp install/uninstall/restore 每次实际修改前保存完整配置快照到 `<Runweft home>/backups/mcp/<ID>.json`，权限限制为当前用户，输出备份位置。写入前校验原文件并原子替换；多文件操作失败时回退自己已写且未被后续修改的文件，不覆盖并发编辑。

`mcp uninstall` 仅删除仍属 Runweft 管理的注册和 hook，保留其他配置及会话数据。`mcp backups` 列出集中备份；`mcp restore <ID>` 还原该次操作前的文件，拒绝覆盖此后发生的修改，恢复本身也创建备份。快照可能包含原配置中的秘密，普通输出不打印其内容。

根级 [完整卸载](../cli/spec.md#完整卸载)复用这些编辑与并发校验规则，用内存快照回退，不新增持久备份；最后删除选定数据根中已有备份。只移除此 home 的接入；另一 home 的注册若仍引用当前程序则拒绝删除，指向其他安装的注册保留。未知同名注册继续拒绝覆盖。
