# 安装与接入

## 选择安装与 Hub

1. 查询系统/架构、Git、已有 `runweft`、Codex/Claude Code。只安装用户选定宿主，执行端也只需所选 runtime。原生工具未登录时由用户在该工具的安全登录流程完成，不能代填或读取凭据。
2. 使用用户提供的发行目录或官网的 `release.json`、平台包与 SHA-256；不要猜测公开下载地址或假定 npm 已发布。选择 macOS arm64/x64 或 glibc Linux arm64/x64，不混架构。平台包内含 Runweft/HAPI，无需另装 Bun/Node；Git 操作要求 Git 2.31+。
3. 在专用临时目录下载，核对可信来源的校验和，检查 tar 列表再解包。把整包放入带版本/平台的安装目录；保持 `bin/runweft` 与 `bin/hapi` 相邻。建立 `$HOME/.local/bin/runweft` 链接前检查旧路径归属，不覆盖未知程序。运行 `--version`。Mac 未签名/公证，不能因系统拒绝就关闭安全保护。
4. 确认用户要连接的 Hub 地址；未提供且无既有连接时只问“使用已有 Hub，还是在本机启动？”。不要把公网 Hub 当成无需许可的部署目标。

全新本机 Hub：

```sh
runweft init
runweft start
runweft open --print
```

首次只启动 Hub；尚未有身份或机器，不能期待 Runner 已就绪。已有 Hub：

```sh
runweft init --url <HTTP(S)根地址>
```

`init` 不覆盖已有配置。切换已有连接时先说明会切换当前业务目标，停止旧 Runner，再执行 `config set hub.url <地址>`；需要不再托管本机 Hub 时设置 `mode hub`。`hub.url` 与托管角色独立，不能仅改 mode 冒充已连接。

## 安全交接身份

```sh
runweft hub --url <Hub地址> connect begin --name <本机名称>
```

向用户展示返回的确认链接、设备名和核对码。用户在自己的浏览器打开链接，主动创建身份并保存备份，或导入已有 token；选择目标空间，核对设备/码再确认。链接是短时连接请求，不是 token。不要让用户粘贴 token 给你，也不要自动点击“创建新身份”。

```sh
runweft hub --url <Hub地址> connect complete
runweft hub connect status
runweft hub identity
```

`complete` 可重跑并继续同一请求，只有 `connected` 才算完成；它把身份直接保存在本机受限文件并保存 `hub.url`。`status` 仅是本机记录，`identity` 才核对当前远端授权。过期或明确取消后可重新 begin；响应未知优先 complete，不新建身份。`connect cancel` 只取消待确认请求，保留既有连接。

在另一台机器通过同样流程连接用户选择的身份/空间；不要复制 Hub 内部 root token。后续命令默认使用已保存空间，需要临时空间时使用全局 `--space`，不要编辑身份文件。

## 分别接入机器和 runtime

需要发起工作区任务或执行任务的机器都登记；只看 Web 或只托管中心无需 Runner。

```sh
runweft machine enroll --name <本机名称>
runweft machine associate <返回的machineId> <已选择spaceId>
runweft runner start
runweft machine discover <machineId>
runweft runtime register codex --machine <machineId> --name <展示名称>
runweft runtime check <返回的runtimeId>
```

用 Claude 执行时改为 `runtime register claude`。enroll 生成独立机器凭据并保存，不读取输出的凭据文件；重跑继续同一接入请求。关联空间不自动分享 runtime，只有确需共享才执行 `runtime share`。工具发现和 `check` 都不验证模型调用。

## 安装产品 Skill 与 MCP

产品 Skill 在平台包 `skills/runweft/`，官网也提供独立 Skill tar 包。先读该目录的 `SKILL.md`；经安装授权，把完整目录复制到宿主发现位置：

- Codex：`$HOME/.agents/skills/runweft`。
- Claude Code：`${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/runweft`。

先比对目标；相同内容不改，不同内容先告知并备份到宿主扫描目录外，确认覆盖范围后再替换。不要把旧副本留在 skills 下导致重复加载。不安装到正在使用的工程仓库，也不删除其他 Skill。Skill 不自动安装 MCP：

```sh
runweft mcp install --client codex
runweft mcp check --client codex
```

Claude 改为 `claude`；明确要两者时用 `all`。命令只维护 Runweft MCP/Claude 身份 hook，每次实际修改先备份。已有不同来源同名入口会拒绝，不手改绕过冲突。数据根非默认时在所有命令前加同一 `--home`。

重新打开实际工作目录的原生会话，按 configuration 配置中心 Agent，然后按 delegation 完成首个低风险任务。先 `runweft_status`，再真实 `spawn_agent`、`wait`、`read_agent`；握手成功不能替代这一步。用户已授权验收且有专用环境时自动完成，不要求用户手工敲 CLI。
