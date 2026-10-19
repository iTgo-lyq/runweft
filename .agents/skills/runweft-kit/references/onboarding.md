# 安装与接入

## 选择安装与 Hub

1. 查询系统/架构、Git、已有 `runweft`、Codex/Claude Code。只安装用户选定宿主，执行端也只需所选 runtime。原生工具未登录时由用户在该工具的安全登录流程完成，不能代填或读取凭据。
2. 常规安装使用公共 npm；确认 Node.js 20+ 与 npm，以及 macOS arm64/x64 或 glibc Linux arm64/x64。通过[官网 release.json](https://runweft.pages.dev/release.json) 的 npm 版本或用户指定的已发布版本安装，不猜测归档下载地址。Git 操作要求 Git 2.31+。
3. 先检查已有程序和 npm 全局 prefix 的归属。执行 `npm install -g runweft@<已确认版本> --registry=https://registry.npmjs.org/ --include=optional`，仅成功后运行 `runweft --version`；npm 自动选择平台依赖并提供配套 HAPI，不另装 Bun/HAPI。新终端查 PATH 时核对 `npm prefix -g` 的 `bin`。用户明确提供离线归档时才按可信索引校验并检查 tar 列表后解包，保留整包布局，不覆盖未知文件。
4. Hub 按用户明确地址→已有连接→默认首次体验指令授权的本机启动选择。采用默认体验指令且没有前两者时直接本机启动，不重复询问。普通请求尚未给出本机启动授权、或需改变既有目标时才询问缺失决定。不要把公网 Hub 当成无需许可的部署目标。

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

## 账号登录与连接授权

```sh
runweft hub --url <Hub地址> connect begin --name <本机名称>
```

向用户展示返回的确认链接、设备名和核对码。用户在自己的浏览器打开链接，注册或登录账号，核对设备/码并授权。单一空间自动使用，多空间且没有有效默认时才选择；一张表单完成账号和连接。链接是短时连接请求，不是 token。不要让用户粘贴 token 给你，也不要替用户输入密码或点击注册/授权。

```sh
runweft hub --url <Hub地址> connect complete --wait 60
runweft hub connect status
runweft hub identity
```

`complete` 可重跑并继续同一请求，只有 `connected` 才算完成；授权确认已激活独立 CLI 凭据，它校验后保存在本机受限文件并保存 `hub.url`。`status` 仅是本机记录，`identity` 才核对当前远端授权。确认前过期需先 cancel 再 begin；确认后原期限到期仍可用原记录 complete。响应未知优先 complete，不新建身份。`connect cancel` 只取消待确认请求，保留既有连接。

在另一台机器通过同样流程连接用户选择的身份/空间；不要复制 Hub 内部 root token。后续命令默认使用已保存空间，需要临时空间时使用全局 `--space`，使用 space list/use 修复默认，不编辑连接文件。仅查询 task list --all/show/wait/result show/artifacts show 不需要机器或 Runner。人工终端也可 auth register/login --interactive --url <地址>，密码隐藏输入；Agent 默认仍提供浏览器链接。

## 分别接入机器和 runtime

先 list/status 查询已有机器、runtime 和 Runner；复用正常记录，不因首次接入说明重复创建、重启或共享。

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

## 当前仓库和第一份报告

连接成功后直接继续，用户不需要手动输入命令或重开后再发提示。先读 configuration 中的仓库和 Agent 命令：

1. 在用户实际 cwd 执行 repository inspect/match。non_git 可直接本机共享目录；Git 唯一匹配则复用并 bind。未匹配且当前本机 clone 明确时，用固定 request ID create 后 bind；有唯一明确 fetch remote 才作 alias，多 remote/匹配歧义无法从现有上下文判断时才询问。读取失败不当成 non_git，也不建立冒名仓库。
2. 查询 agent list/show/resolve，复用本人已有且目标正确的私有评审 Agent；否则用完整临时 JSON 创建 private Agent，说明只读、只输出报告、不改代码，runtime 取实际选定工具，模型参数为空继承默认。不要覆盖别人定义或替用户默认共享。当前仓库明确时绑定对应 repositoryId；用返回 UUID 委派，不必修改用户已有默认选择。
3. 用 CLI 在当前 cwd 的 shared 模式派发第一份评审：有未提交改动时审查改动，否则审查最近提交；非 Git 且代码范围明确则审查当前代码。只有范围确实不明才询问。固定 request ID，spawn 响应不明用相同 ID/参数恢复，不重复派发。

```sh
runweft task spawn <agentId> --workspace-mode shared --request-id <固定UUID> --message-file <只读评审任务文件>
runweft task wait <taskId> --timeout 60000
runweft task show <taskId> --round <roundId>
runweft task open <taskId> --round <roundId> --print
```

按 next_offset 读完整报告并在当前对话总结。超时继续查询原任务，遇审批按已有授权处理，否则只说明具体待办，不扩大权限。模型登录无效等外部条件缺失时停在具体失败阶段，不把接收成功当执行成功。CLI 报告已读回是第一份体验成果；MCP 加载与真实调用另行核对。

## 安装产品 Skill 与 MCP

先复用已加载的 Runweft Kit，不再重复安装全局副本。工程内 `.agents/skills/runweft-kit/` 可由 Agent 显式读取使用；宿主自动发现位置按所用客户端核对。需要另行安装 Skill 时，经用户安装授权，可从独立公开仓库安装到选定宿主：

```sh
npx skills add iTgo-lyq/runweft-kit --skill runweft-kit --agent codex -g --copy -y
```

Claude Code 将 `--agent codex` 改为 `--agent claude-code`；只安装用户选定的宿主。安装前核对目标，内容不同的已有 Runweft Kit 先告知并备份到扫描目录外，确认替换范围后再执行。Skill 安装不等于程序或 MCP 安装。

新构建的 npm 主包也提供 Runweft Kit，包内目录为 `$(npm root -g)/runweft/skills/runweft-kit`；先检查该目录存在且 frontmatter.name 为 `runweft-kit`。已安装包没有该目录时使用上面的公开仓库安装，不猜测或复用其他名称的包内 Skill。未通过公开仓库安装时，先读包内 `SKILL.md`，再经安装授权把完整目录复制到宿主发现位置：

- Codex：`$HOME/.agents/skills/runweft-kit`。
- Claude Code：`${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/runweft-kit`。

先比对目标；相同内容不改，不同内容先告知并备份到宿主扫描目录外，确认覆盖范围后再替换。发现同功能但不同名称的旧副本时，先识别来源并备份用户修改，经安装/替换授权后将确认被替代的副本移出扫描目录；不要把旧副本留在 skills 下导致重复加载。不安装到正在使用的工程仓库，也不删除其他 Skill。Skill 不自动安装 MCP：

```sh
runweft mcp install --client codex
runweft mcp check --client codex
```

Claude 改为 `claude`；明确要两者时用 `all`。命令只维护 Runweft MCP/Claude 身份 hook，每次实际修改先备份。已有不同来源同名入口会拒绝，不手改绕过冲突。数据根非默认时在所有命令前加同一 `--home`。

只有当前宿主尚未加载 MCP 时才在第一份 CLI 报告之后说明需要重载；支持自动重载时按宿主实际能力执行。记录已返回的任务 ID 与无秘密链接，重载后无需第二段体验提示，也不为验 MCP 重复第一份业务任务。MCP 的安装检查、握手和真实工具调用分别记录；未实测就说明尚未验证。按用户已有验收授权使用专用环境，不要求用户手工敲 CLI。
