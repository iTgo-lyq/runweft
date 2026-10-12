# 诊断与维护

## 先查事实

```sh
runweft --version
runweft config check
runweft config show
runweft paths
runweft status
runweft hub connect status
runweft hub identity
runweft runner status
runweft doctor
runweft mcp check --client <codex或claude>
```

不打印 `paths` 指出的身份/机器文件、完整日志、原生配置或完整 prompt。需要日志时只读取有界错误并脱敏。`doctor` 不运行模型；连接本机记录、远端授权、Runner 在线、工具可用、MCP 握手和实际调用逐层区分。

| 现象 | 下一步 |
| --- | --- |
| 程序不存在或 HAPI 不兼容 | 核对安装路径、版本与同批配套 HAPI；不随便调用系统另一份 HAPI |
| Hub 未连接 | 核对 `hub.url`、网络与 `hub identity`；按 begin/complete 接入，不要求 token |
| 401/身份失效 | 让用户在浏览器导入本人已保存的新 token，再安全交接；不自动领取新身份 |
| 403/资源不可用 | 查当前空间、资源 permissions、登记/共享/成员关系；不改身份绕过 |
| 无机器凭据 | 该机器 enroll、associate，再 runner start；中心不用 root token 分发 |
| Runner 离线 | 在对应机器查 runner status，核对环境后重启；机器轮换后必须重启 |
| 工具可见但模型失败 | 在执行机沿原生登录/模型流程诊断；不修改用户模型凭据或全局权限 |
| MCP 握手成功但工具不可用 | 重新打开实际原生会话，用 runweft_status 验证身份捕获；不伪造父身份 |
| 任务等待超时或未知 | 查原 task ID、round ID、request ID，再 wait；不重复 spawn |
| Git 收尾失败 | 根据错误修复 hooks/签名/子模块，再 retry-finish；不重发模型 |
| 文件/代码交付失败 | 查限制、候选、原操作，再 artifacts/result retry；缺文件才显式 collect |
| HAPI 标签页到期 | 返回 `/hub`，从当前身份任务详情重开，不把 token 加到 URL |

## 升级和卸载

先记录安装版本、路径、Hub 角色、数据根、活跃任务。结束/中断任务并确认停止后再停对应服务；停止 Runner/Hub 不能代替中断模型进程。

升级：确认当前入口属于 npm 安装，使用 `npm install -g runweft@<目标版本> --registry=https://registry.npmjs.org/ --include=optional`；成功后核对版本和入口，再运行 `mcp install --client <宿主>` 更新入口/timeout/hook。从更新后的 npm 包读取产品 Skill，比对、备份扫描目录外的旧目录再替换。没有 `runweft upgrade` 命令。当前业务库只支持 schema19，不通过切换程序迁移数据。

按原角色启动：本机 Hub `start`，独立执行机 `runner start`，前台公开服务由原进程管理器执行 `serve --public`。核对 `--version/status/doctor/mcp check`，再做一次低风险真实调用。只执行用户指定范围，不更新在线其他实例。

完整卸载：先用 `--version` 和 `uninstall --help` 核对实际版本支持；1.1.4 起支持完整卸载。用户已明确要求完整卸载即视为授权：先用 `runweft --home <目录> uninstall` 预览，核对数据根和删除范围；与要求一致就直接执行 `runweft --home <目录> uninstall --yes`，不再次确认。范围不符或命令报错时停止，并如实说明。npm 卸载失败时数据仍在，可重试；程序已删而数据未删时，按错误给出的准确路径处理。

完整卸载无备份地移除该 home 的全部数据、当前程序、自身 MCP/hook 和已确认的 Skill，保留其他软件配置、模型凭据、原生会话和用户项目。默认 home 可省略 `--home <目录>`；`--dry-run` 始终只预览。不要在受管会话内执行完整卸载，使用独立终端。

只删程序、保留数据：先结束任务、停止相关 Runner/Hub，用 `mcp uninstall --client <宿主>` 移除接入并核对其他 MCP/hooks 保留；确认当前 npm prefix 后执行 `npm uninstall -g runweft`，仅移除未改写的产品 Skill。此处 `mcp uninstall` 仍生成备份。既有可信独立平台包按其受管目录处理，不删除未知入口。

`mcp backups` 列非秘密摘要；`mcp restore <备份ID>` 恢复操作前完整快照，会拒绝覆盖后续修改，不强行绕过。MCP 修改位置：Codex `${CODEX_HOME:-$HOME/.codex}/config.toml`；Claude 默认 `$HOME/.claude.json` 和 `$HOME/.claude/settings.json`，设置 CLAUDE_CONFIG_DIR 后两者均在该目录。不要手工复制完整配置给模型。

## 当前附件与成果留存

默认数据根 `$HOME/.runweft`；`--home` 优先于 RUNWEFT_HOME，字段环境变量优先于 config.yaml。用 `paths` 获取当前连接实际目录，不硬编码 URL 哈希。Hub 数据在 `server/`，每 Hub 身份/机器与 HAPI 数据在 `connections/`，`client.sqlite` 保存当前 Claude MCP 调用身份并协调连接文件写入，备份在 `backups/`。原生 Codex/Claude home 不被 Runweft 接管。

备份当前运行环境前先结束任务、停止 Hub/相关 Runner，保留同一时点的配置、中心库/文件、连接数据、未交付候选、原生会话及 worktree 依赖的源 Git/缓存；不要只备份数据库。不要无授权打包上传身份或模型凭据。

```sh
runweft task result release <taskId>
runweft task artifacts release <taskId>
runweft artifact refs <artifactId>
runweft artifact prune
```

以上 release/prune 默认预览，核对结果和用户意图后才加 `--apply`。丢弃未交付结果需要另外明确 `--discard-pending`。工作区删除 `task workspace remove <taskId>` 会实际执行，不能当预览；ignored 文件默认阻止删除，仅明确放弃才加 `--discard-ignored`。释放引用不删除字节，仍有引用的对象不能 remove。

中心业务库只支持当前 schema19，本机 client.sqlite 只支持当前 schema1；新库直接创建，同格式库正常重开。旧版本、不匹配或损坏格式明确拒绝，不迁移、改写或清理原目录。按错误诊断使用独立新 `--home <目录>` 并自行保管原目录；不要把未知执行/回执作为删除历史的理由。当前附件/成果的 release/prune/remove 与已登记操作的回执恢复仍按各命令执行，不接管旧目录。配置省略 schemaVersion 使用当前默认值1，显式非当前版本拒绝。
