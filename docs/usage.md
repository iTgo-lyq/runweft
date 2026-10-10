# Runweft 使用说明

Runweft 为 Codex 和 Claude Code 提供 Hub 集中配置、任务委派、本地共享/独立 worktree、远端独立 worktree，以及附件和 Git 成果回收。执行基于配套 HAPI 内置适配。用户通过对话交给 Agent 安装和操作，在 Web 维护有权使用的资源、查看本人任务。

本文配套 Runweft 1.1.1。通过公共 npm 主包选择四个平台依赖；官网安装版本见 `release.json`，程序来源与验证范围以对应发行记录为准。

## 通过 npm 安装

支持 macOS arm64/x64、glibc Linux arm64/x64。安装需要 Node.js 20+ 和 npm；运行任务需要已登录的 Codex 或 Claude Code，Git 操作需要 Git 2.31+。LFS/子模块需在相关机器具备工具与对象访问条件。

```sh
npm install -g runweft@1.1.1 --registry=https://registry.npmjs.org/ --include=optional &&
runweft --version
```

npm 自动选择当前平台依赖，随包提供配套 HAPI 与产品 Skill，无需另装 Bun 或 HAPI。新终端找不到程序时，用 `npm prefix -g` 核对其 `bin` 子目录是否在 PATH。先检查已有程序归属，不覆盖未知来源的入口。

使用私有 registry 时替换 `--registry`；该 registry 必须提供同版本五包，只有主包 tarball 不足以安装平台依赖。

## 交给 Agent 接入

把下面这段话交给正在使用的 Agent：

> 通过 npm 安装 runweft@1.1.1，从已安装包中读取并接入 Runweft Skill。整个接入过程中，程序安装、升级和卸载都使用 npm。帮我连接指定 Hub；没有 Hub 时先询问是否在本机启动。保留其他 MCP 和模型配置，身份通过浏览器确认，不向我索要 token。分别登记机器和执行工具，创建代码评审 Agent，再在当前项目完成一次只读委派。

Skill 源目录：

```sh
printf '%s\n' "$(npm root -g)/runweft/skills/runweft"
```

Agent 先读取 `SKILL.md`，再将完整目录复制到 Codex 的 `~/.agents/skills/runweft` 或 Claude 的 `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/runweft`；已有不同内容先备份到扫描目录外并确认替换。Skill 与 MCP 是两项安装。下面是 Agent 使用的工程参考，不要求用户逐条手工执行。

## Hub、身份与空间

委派始终连接明确 Hub。本机托管不是离线模式，也不绕过身份或空间权限。

```sh
runweft init
runweft start
runweft open --print
```

本机默认入口 `http://127.0.0.1:3210/hub`，首次只启动 Hub，不自动登记身份或启动 Runner。已有 Hub 使用 `runweft init --url https://你的Hub域名`；`init` 保留已有配置。`mode local` 表示可托管本机 Hub，`mode hub` 不托管；业务连接由独立 `hub.url` 选择。

在 `/hub` 主动创建身份并保存 token 副本，或导入已有 token。不需要邮箱/OAuth/注册。浏览器只在当前标签会话保存身份，刷新和报错不新建身份；退出、关闭标签或换设备后须导入副本。丢失所有副本无法找回，重新领取不会继承原身份。Token 轮换须先保存新副本，再应用；成功后旧 token 失效。

每个新身份有初始空间，也可创建协作空间。空间所有者邀请成员/管理员、调整角色；管理员只治理允许的普通成员。邀请 24 小时内供一人使用。最后 owner 不能直接退出或降级，须先指定另一位 owner。

### Web 到 CLI 加密交接

```sh
runweft hub --url <Hub根地址> connect begin --name <本机名称>
runweft hub --url <Hub根地址> connect complete
runweft hub connect status
runweft hub identity
```

Agent 展示 begin 返回的无秘密确认链接、名称和核对码。用户在浏览器选择身份/空间、核对并确认，CLI complete 才把凭据加密领取到受限本地文件并保存 `hub.url`。不要将 token 发给模型、复制到 URL 或使用 HAPI 内部 root token。complete 返回 pending 时继续等待；响应丢失可重跑同一 complete，不重新领取身份。cancel 只取消待确认请求，保留已保存连接。

status 仅显示本机摘要，identity 才核对远端授权。CLI 全局 `--home <目录>`、`--space <UUID>`、`--identity-file <文件>`、`--json` 在子命令前。身份文件是用户主动提供的备用输入，不打印其内容。临时 `--space` 不改保存的默认空间。

## 机器与执行工具

机器登记、runtime 注册、Agent 定义是三个对象。发起工作区任务或执行任务的机器都需接入同一 Hub；只托管 Hub 或看后台无需 Runner。

```sh
runweft machine enroll --name <机器名称>
runweft machine associate <machineId> <spaceId>
runweft runner start
runweft machine discover <machineId>
runweft runtime register codex --machine <machineId> --name <工具名称>
runweft runtime check <runtimeId>
```

Claude 执行工具用 `runtime register claude`。enroll 在本机生成独立机器凭据，重跑恢复同一接入；不将身份 token 交给 Runner。机器与 runtime 是 Hub 全局所有者资源，名称可重复，引用用完整 UUID。一个机器的同类型 runtime 保持一个 ID。发现工具/机器在线不等于模型可执行，check/doctor 不运行模型。

轮换机器凭据后，执行 runner stop 再 runner start，使新凭据生效；运行中的Runner不热换凭据。Hub失联或旧凭据被撤销时，停止仍完成本地清理；独立原生会话保留，停止Runner不等于停止任务。

```sh
runweft machine list
runweft machine show <machineId>
runweft machine rename <machineId> <新名称>
runweft runtime list
runweft runtime show <runtimeId>
runweft runtime resolve <runtimeId>
runweft runtime share <runtimeId> <spaceId>
runweft runtime unshare <runtimeId> <spaceId>
```

机器关联空间不自动分享 runtime；share 才授予该空间成员执行权。共享是原生账户执行能力，不是 OS 沙箱，也不授予原生任意 shell/其他人的会话访问。空间管理员可 block/unblock 此空间资源，不取得所有权或私有配置。

取消登记用 machine/runtime unregister，保留 ID、原生历史和已保存引用；恢复用 register。detach 撤回机器空间关联及该空间 runtime 分享。撤权会使相关受管任务进入停止处理，不仅隐藏按钮。

机器凭据状态用 `machine credential <id>`，撤销用 `revoke-credential <id>`；轮换在本机 `machine rotate-credential` 后重启 Runner。pending 轮换优先重跑原操作，仅明确放弃才 `--replace-pending`。原生环境/PATH 改动也需在对应执行机重启 Runner，再探测。

## 仓库、Agent 与个人选择

中心 Git Repository 关联配置，不代表代码权限或自动 clone。不同成员同一仓库各有个人选择，不维护仓库 Runweft YAML。

```sh
runweft repository inspect
runweft repository match --machine <本机machineId>
runweft repository create <仓库名称> --request-id <固定UUID> --alias <Git远端URL>
runweft repository bind <repositoryId> --machine <本机machineId>
runweft repository checkouts
```

inspect 只读 Git 并脱敏；歧义时 match 退出 1，多个 fetch remote 可用 `--remote <名称>` 明确选择。无 remote 可省略 alias 创建后 bind。所有 worktree 共用 clone 关联，checkouts 只列本人。变更用 rename/alias/un-alias/register/unregister；解绑用 `repository unbind --machine <id>`。创建响应丢失先 `repository request <原UUID>`，同 ID 同输入重试，不按同名猜测。

Agent 是空间全局或仓库级的职责定义。Web 可完整编辑；CLI 接收最多 64 KiB 的完整 JSON，仅作为本次请求输入：

```json
{
  "name": "代码评审",
  "description": "检查正确性、回归和验证缺口",
  "instructions": "阅读工程约定与相关变更。按严重性报告有证据的问题，不修改代码。",
  "repositoryId": null,
  "runtimeId": "<实际runtimeId>",
  "flavor": null,
  "model": null,
  "reasoningEffort": null
}
```

```sh
runweft agent create --request-id <固定UUID> --file <JSON路径>
runweft agent request <原UUID>
runweft agent list
runweft agent show <agentId>
runweft agent update <agentId> --expected-version <已读整数版本> --file <完整新JSON>
runweft agent versions <agentId>
runweft agent access <agentId> members --member <成员UUID>
runweft agent select <agentId> --repository <repositoryId> --runtime <runtimeOverrideId>
runweft agent selection
runweft agent resolve --repository <repositoryId>
runweft agent unselect --repository <repositoryId>
```

repositoryId 为空表示空间全局定义。模型/推理参数为空沿用执行端默认；非空需明确匹配 flavor，不由 Runweft维护模型清单。并发版本冲突重新读并确认差异，不盲目覆盖。

所有者编辑/看完整历史、设置 private/members/space 分享；分享不授予编辑或既有任务内容。管理员只有治理概要及 block/unblock，不读取私有指令/历史。个人 select 不带 repository 表示空间默认；override 不改共享定义。失效选择保留并报原因，不自动回退。显式 resolve 可带 `--agent`、`--runtime`；旧任务继续使用已固定的版本和执行目标。

## 接入 MCP

```sh
runweft mcp install --client codex
runweft mcp check --client codex
```

Claude 用 `--client claude`，明确两者用 all，省略则自动检测。非默认数据根把同一 `--home` 放在所有命令前。重新打开实际项目的原生会话，调用 runweft_status 核对身份、目录、Hub 和空间。

安装/更新只维护 Runweft MCP 和 Claude 身份 hook，保留其他 MCP、模型配置、注释和会话；实际修改前备份。Codex 配置为 `${CODEX_HOME:-~/.codex}/config.toml`，Claude 默认 `~/.claude.json` 与 `~/.claude/settings.json`，指定 CLAUDE_CONFIG_DIR 后两者在该目录。未知来源的同名条目会拒绝覆盖。

Codex 受管入口工具超时 600 秒，支持 wait 最长 540 秒。check 分别检查配置、stdio 握手、服务连接，不执行模型，不代替原生实际调用。旧入口通过显式 install 更新；启动服务不自动改全局配置。

```sh
runweft mcp uninstall --client all
runweft mcp backups
runweft mcp restore <备份ID>
```

卸载只移除自身入口/hook，restore 恢复完整操作前快照且拒绝覆盖后续修改。备份在数据根 backups/mcp，不打印其中配置内容。

## 委派、等待与续接

在实际工作目录让主 Agent：“用已配置的代码评审 Agent 检查当前改动，等待结果并总结，不修改代码。”MCP 先 list_agent_definitions，spawn_agent 使用中心 UUID 或个人选择，再 wait/read_agent。

| MCP 工具 | 关键参数与行为 |
| --- | --- |
| runweft_status / list_agent_definitions | 核对当前父身份、Hub/空间/仓库、中心定义 |
| spawn_agent | agent_type、message、workspace_mode、base_ref；返回接受结果而非完成 |
| list_agents | 当前父会话任务与已接受请求 |
| wait | ids、timeout_ms（0–540000），可带 after_revision |
| read_agent | id、round_id、offset、limit；按 next_offset 分页 |
| send_input | id、message，默认 next；Codex steer 需活跃 round_id |
| interrupt_agent | id、固定 round_id；再查询确认停止 |
| respond_to_permission | id、round_id、原生 request_id、decision、可选 answers |
| retry_finish | 修复 Git 收尾后重试固定轮次，不重发模型 |

CLI 提供同样维护入口，可在原主宿主退出后按用户/空间查看本人任务；MCP 不自动恢复旧父身份：

```sh
runweft task spawn <agentId> --message "只读检查当前改动"
runweft task list --all
runweft task wait <taskId> --timeout 65000
runweft task show <taskId> --round <roundId>
runweft task send <taskId> --message "继续处理"
runweft task send <taskId> --steer --round <roundId> --message "补充本轮要求"
runweft task interrupt <taskId> --round <roundId>
runweft task permission <taskId> --round <roundId> --request <原生审批ID> --decision approved
```

spawn 可省 Agent 用本人选择，`--runtime` 是本次 override；长任务用 `--message-file`，`-` 读 stdin。每次接受输出 request ID；未知响应先查任务/原请求，再用原 ID 和相同参数重试。不要因超时或 unknown 新建任务。wait 超时/取消不终止已接受任务，服务停止不等于模型停止。

每轮确认进程停止后保留 session/worktree，下一轮优先续接；仅原生确切历史缺失才重建有界上下文。unknown 不按缺失处理。steer 仅 Codex 活跃轮次，Claude 使用 next；定向 interrupt 不影响后轮。受管子 agent 禁用 Runweft MCP，CLI/MCP 递归委派均拒绝，其他 MCP 与原生子代理沿原生管理。主宿主退出不后台注入或唤醒。

## 工作区与代码

共享目录只用于本地 runtime，可无 Git，不自动提交或清理。独立模式要求主目录为 Git：

```sh
runweft task spawn <agentId> --workspace-mode worktree --base HEAD --message "实现任务并运行检查"
runweft task result show <taskId>
runweft task result fetch <taskId>
runweft task result retry <taskId> --round <roundId>
runweft task retry-finish <taskId> --round <roundId>
```

本地 base 默认 HEAD，远端必须明确指定；接受时固定 commit，脏文件/未跟踪/ignored 内容不自动携带。源/目标 Runner 均在线，工作树、Git、输入和上下文先就绪再启动模型。依赖由 Agent 自行安装；执行端原生全局配置继续生效，发起机的全局 skills/MCP/凭据不自动同步。

每轮保留已有提交并 checkpoint 剩余非 ignored 改动；沿用 hooks/签名/过滤器，不改用户全局 Git。子模块脏内容/gitlink 变更不能自动封存。失败修复后 retry-finish，不重跑模型。

本地成果对象已在同仓库，远端通过 bundle 回 Hub，再在原主仓库 fetch 专用 ref。取回不切分支、合入或 push；审查 diff 后由主 Agent 按授权 merge/cherry-pick。执行完成、Git 封存、代码可取回与验收通过是不同状态。result retry 只重试交付。

远端准备诊断不运行模型，也不被以后业务任务接管：

```sh
runweft workspace prepare --agent <agentId> --base HEAD
runweft workspace inspect <准备ID>
runweft workspace preparations --all
runweft workspace release <准备ID>
```

release 返回受理后仍须 inspect 确认 released；未知执行/引用保留。不手工删缓存或恢复 pin。正式任务 worktree 另用 `task workspace remove`。

## 附件、补交与留存

```sh
runweft artifact limits
runweft artifact upload <普通文件>
runweft artifact lookup <原上传requestId>
runweft task spawn <agentId> --message "处理输入" --input <artifactId> --output report.md
runweft task artifacts show <taskId> --round <roundId>
runweft artifact download <artifactId> --output <保存路径>
runweft task artifacts retry <taskId> --round <roundId>
runweft task artifacts collect <taskId> --round <roundId> --path <名称=相对路径>
```

MCP 对应 upload_artifact/read_artifact/download_artifact/retry_artifacts/collect_artifacts。上传返回 artifact.id；spawn/next 声明 `inputs: [{artifactId,name?}]`、`outputs: [{name,relativePath}]`，每轮独立提供，steer 不带附件。MCP 路径限制宿主实际 cwd，目录外文件使用显式 CLI，不把二进制填进上下文。

上传/下载流式校验，默认不覆盖目标；进度走 stderr，JSON stdout 仅结果。输入校验落地后才启动/续接；输出在进程停止及 Git 收尾后捕获。成功候选交付并持久清单后自动回收中间副本；工作树内输入随现场保留。

失败清单可部分成功；retry 重传固定候选，不重新读目录/调用模型；collect 在任务静止时补收并发布新版本。历史清单当时 available 不保证现在仍可下载。默认单文件 512 MiB，每授权存储范围 10 GiB，具体以 limits 为准。

```sh
runweft task result release <taskId>
runweft task artifacts release <taskId>
runweft artifact refs <artifactId>
runweft artifact prune
runweft artifact remove <无引用artifactId>
runweft task workspace remove <taskId>
```

release/prune 默认预览，加 `--apply` 才执行；丢弃未交付候选需明确 `--discard-pending`。workspace remove 和 artifact remove 是实际删除，不是预览。ignored 文件阻止删除工作树，只有明确放弃才 `--discard-ignored`。释放引用不删字节，仍有其他引用的对象受保护。prune 默认清无引用满 7 天文件/24 小时上传预约，按 nextCursor 分页，不自动定时清理。报告与已取回成果不随中心引用释放删除。

## Web 后台

`runweft open` 或 open --print 提供无秘密 `/hub` 入口。后台以用户身份显示空间、机器、runtime、Agent、仓库、本人选择、成员和本人任务。管理员不看到他人私有内容或任务计数；按钮权限来自领域 API，直接调用也拒绝越权。

任务支持本人筛选/分页、轮次、固定配置、报告分页、附件/代码状态和维护说明。停止/续接/取回/释放交给主 Agent 使用 CLI，不从网页恢复旧主宿主。网络失败/离线/unknown 不当成功。

从任务详情打开 HAPI 会话/审批/文件，新标签使用同身份同空间短凭据，不将 token/JWT 放 URL，也不存长期 localStorage。各标签隔离，最长十五分钟，到期回 Hub 重开；不自动延长或创建身份。共享 runtime 不授予任意终端；受管输入/恢复仍走中心流程。原生页面默认简体中文，保留已有语言偏好。旧 `/runweft` 看板不再是默认网关入口。

## 配置、部署与数据

```sh
runweft config path
runweft config show
runweft config check
runweft config set server.port 3211
runweft paths
runweft status
runweft doctor
```

默认配置 `~/.runweft/config.yaml`，不是 Agent YAML。`--home` 优先于 RUNWEFT_HOME；字段环境覆盖高于文件、文件高于默认值，show 列来源。支持 RUNWEFT_MODE/HUB_URL/PORT/HOST/PUBLIC_URL/HAPI_EXECUTABLE。init 不覆盖、set 保留注释且先校验。

| 配置 | 行为 |
| --- | --- |
| mode | local 可托管 Hub，hub 只连接已有中心 |
| hub.url | 明确 HTTP(S) 根地址，不含凭据/路径/query |
| server.host / port | 默认 127.0.0.1 / 3210 |
| server.publicUrl | 对外入口和 CORS origin |
| server.hapiPort | 私有 loopback HAPI 端口，默认自动选择 |
| server.runner | 默认 false；已有独立机器凭据后才可启用监督 Runner |
| server.artifacts.maxFileMiB / namespaceQuotaGiB | 512 / 10，远端客户端不覆盖中心限制 |
| server.artifacts.unreferencedDays / pendingHours | 7 / 24，只定义显式清理期限 |
| hapi.executable | 开发兼容覆盖；正常安装使用配套程序 |

公开中心由已有进程管理器以前台方式托管，先配置 HTTPS 反向代理，再显式运行：

```sh
runweft config set server.publicUrl https://你的Hub域名
runweft serve --public
```

代理需支持 WebSocket、SSE、Authorization header、流式上传/下载，体积限制至少匹配单文件设置；禁缓冲、不以短总超时截断长传输。不直接暴露私有 HAPI 端口。公开部署是外部操作，Agent 不擅自执行。中心不分发 root token；每个客户端通过浏览器交接独立身份。

paths 显示准确目录：`server/` 是本机托管 Hub 数据；`connections/<Hub标识>/` 是该 Hub 的身份/机器接入和 HAPI 工作区/缓存；`client.sqlite` 保存当前 Claude MCP 调用身份并协调连接文件写入；`logs/`、`backups/` 独立。原生 Codex/Claude home 不受 Runweft 接管。备份须先结束任务、停止相关服务，保存同一时点数据库/文件、连接候选、原生会话及 worktree 依赖源仓库/缓存；只回滚数据库不安全。

中心业务库只支持当前 schema19，本机 client.sqlite 只支持当前 schema1：全新目录创建当前格式，完整同格式库可正常重开。已有旧版本、不匹配或损坏格式明确拒绝，不迁移、改写或清理原目录。需要另建环境时使用独立的新 `--home <目录>`，自行保管原目录；新环境不接续原目录中的任务。配置文件省略 schemaVersion 仍使用当前默认值1，显式非当前版本会拒绝。

## 诊断、升级与卸载

| 症状 | 处理 |
| --- | --- |
| 无连接/401 | 核对 hub.url、identity，浏览器导入原身份并重新安全交接；不自动新身份 |
| 403/选择失效 | 查空间、成员、登记/分享及具体 eligibility；不静默替换目标 |
| Runner 离线 | 在该机器查 runner status/凭据状态，修复后 runner stop/start |
| 工具发现但模型失败 | 沿执行机原生登录与模型权限检查；不改用户全局凭据 |
| MCP check 成功但任务不可用 | 在新原生会话运行 runweft_status，区分握手和实际调用 |
| 等待超时/unknown | 先查原任务/请求，再等；不重复派生 |
| 收尾/交付失败 | 修复具体错误，再 retry-finish/artifacts retry/result retry |
| HAPI 标签过期 | 从 Hub 任务详情重开，不传 URL token |
| 数据格式不匹配/损坏 | 按 state_format_unsupported/state_format_invalid 诊断，使用独立新 --home，自行保管原目录 |

升级没有自升级命令：用 `npm install -g runweft@<目标版本> --registry=https://registry.npmjs.org/ --include=optional` 安装目标版本，确认成功后检查 `--version` 并显式 mcp install 更新入口。Skill 从更新后的 npm 包中读取，比对后备份旧目录再替换。先安全结束任务，按原角色重启 Hub 或 Runner，再核对版本/status/doctor/握手和低风险真实调用，只有完整当前 schema19 库可重开；遇到不匹配格式按上面的独立目录方式处理，不执行数据迁移。

卸载先 mcp uninstall，停止本机受管服务，再执行 `npm uninstall -g runweft`，移除未改写的产品 Skill。数据、模型凭据、原生会话、其他 MCP/Skill 保留。当前附件和成果的留存操作使用显式 release/prune/remove 命令。

完整本地验收由 Agent 自动执行。Mac 双架构构建不代替实机；Linux arm64 QEMU CLI 检查不代替完整原生协作；同机多 Runner 不等于物理跨机。实际版本的证据以发行记录为准。

## 离线完整交付（工程参考）

本节仅用于用户明确提供的历史 1.1.0 可信离线完整交付目录，不表示本次提供 1.1.1 离线整包。官网不提供安装包下载，常规安装、升级与卸载使用 npm。历史整包和独立 Skill 归档仍可用于工程验证，不代表当前官网内容。

从可信发行目录取得 `index.json`、`SHA256SUMS`、`tarballs/`。校验后解包，保持整包，不单独移动 Runweft：

```sh
shasum -a 256 -c SHA256SUMS &&
runweft_platform=darwin-arm64 &&
runweft_version=1.1.0 &&
runweft_install="$HOME/.local/share/runweft/$runweft_version-$runweft_platform" &&
mkdir -p "$runweft_install" "$HOME/.local/bin" &&
tar -xzf "tarballs/runweft-$runweft_platform-$runweft_version.tgz" -C "$runweft_install" --strip-components=1 &&
ln -sfn "$runweft_install/bin/runweft" "$HOME/.local/bin/runweft" &&
export PATH="$HOME/.local/bin:$PATH" &&
runweft --version
```

先检查安装目录/链接归属；未知已有文件不能覆盖。Linux 可用 `sha256sum -c SHA256SUMS`，平台名为 `linux-x64` 或 `linux-arm64`，Intel Mac 为 `darwin-x64`。把 `~/.local/bin` 加入新终端的 PATH。Mac 产物未签名、公证；核对来源后按系统安全提示允许，交叉构建不代表实机运行。
