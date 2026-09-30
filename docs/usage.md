# Runweft 基础入口使用说明

当前实现包含配置、HAPI 服务管理、机器/runtime 登记、Agent 定义，以及 Codex/Claude Code 经 MCP 或 CLI 进行本机共享目录、独立 worktree 和远端 worktree 协作。已支持文件输入/输出、代码成果发布及取回、补交、显式释放和远端 Git 诊断准备。协作看板已通过自动验收，完整发行集成仍在推进；当前候选包不是完整项目的最终发布。

## 安装与首次使用

运行环境需要 Node.js 20+，工作区识别需要 Git 命令；执行任务还需安装所选的原生 Codex/Claude Code 并完成模型登录。候选包覆盖 macOS arm64/x64、glibc Linux arm64/x64；不需要全局 Bun 或单独安装 HAPI。当前尚未发布到公共 npm，使用提供候选包的 registry：

```sh
npm install -g runweft@0.1.0 --registry <候选包-registry> --include=optional
runweft start
runweft open
```

安装源必须同时提供 `runweft` 和当前平台的 `runweft-<os>-<arch>` 包。主包只有启动器，单独安装主包 tarball 不能代替平台依赖安装。`runweft --version` 可核对版本；找不到平台包时按错误提示重新安装并保留可选依赖。

本地默认入口是 `http://127.0.0.1:3210`，默认数据根是 `~/.runweft`。`start` 自动管理本机 HAPI Hub 与 Runner；`open` 使用该连接的 HAPI 登录打开 `/runweft/` 协作总览，`open --hapi` 直接打开 HAPI 会话界面。无图形浏览器时，在本机交互终端运行 `runweft auth token`，然后手动访问服务地址的 `/runweft/` 登录。令牌不会写入普通状态输出或 JSON。

看板列出当前访问范围内跨主会话、跨工作区的任务，支持主工作区路径、主会话和执行状态筛选；每页 50 项，每 5 秒刷新，页面隐藏时暂停。执行、代码和附件分别显示，进程已结束仍可保留会话供续接；共享目录的代码显示“不适用”，没有声明输出显示“未声明”。展开条目查看摘要与成果下一步，点击主/子会话链接进入同一 HAPI，审批和对话仍在 HAPI 中完成。只有真实 HAPI 会话 ID 才提供跳转。

主宿主退出后记录仍可查看，Hub 模式查看看板不要求本机启动 Runner。刷新失败保留上次成功记录并标明时间；执行机离线/未知时，尚未结束的任务标为“状态可能过期”，不能据此判定任务已成功。登录与 HAPI 共享浏览器内的当前连接令牌，JWT 过期会尝试重新认证一次；持续失败需要重新连接。旧 Hub 不支持看板时，`open` 会提示更新或使用 `--hapi`。看板没有任务启动、合码或清理按钮。

```sh
runweft status
runweft doctor
runweft workspace bind
runweft stop
```

`doctor` 不运行模型，也不把机器在线视为模型登录已验证。服务停止会保留配置、数据库和原生会话；正在运行的模型会话由 HAPI 管理，停止 Runner 不等于停止所有模型任务。

## 接入 Codex 与 Claude Code

原生客户端安装并完成自己的模型登录后，运行一次：

```sh
runweft mcp install
runweft mcp check
```

默认检测本机的 Codex 和 Claude Code，也可用 `--client codex`、`--client claude` 或 `--client all` 明确选择。然后进入实际项目目录启动原生会话，调用 `runweft_status` 检查当前身份、工作区和服务连接。全局注册不会固定安装时所在的项目目录；定义绑定完成后，可让主 agent 使用下文的委派工具。

`mcp check` 分开报告配置、stdio 握手与服务连接，不执行模型，不把握手当作原生会话已经调用成功。服务未连接时继续用 `runweft status`、`runweft doctor` 检查。不同数据目录使用全局 `--home`：例如 `runweft --home /srv/runweft mcp install`；检查及恢复时也使用相同目录。

Codex 的受管入口使用 600 秒工具超时，支持最长 540 秒的单次任务等待。旧入口若缺少该设置，`mcp check` 会提示重新执行 `mcp install --client codex`；检查和服务启动不会自动改写原生配置。

安装只维护名为 `runweft` 的 MCP 及 Claude 身份 hook，其他 MCP、原生配置、注释和模型凭据保留。Codex 使用 `CODEX_HOME/config.toml`（默认 `~/.codex/config.toml`）；Claude 默认使用 `~/.claude.json` 和 `~/.claude/settings.json`，设置 `CLAUDE_CONFIG_DIR` 时改用该目录下的 `.claude.json` 和 `settings.json`。重复安装会更新自己的入口，命令路径变化后重新运行安装即可。已存在非 Runweft 管理的同名条目时会明确报冲突。

HAPI 的受控执行入口支持按会话禁用 Runweft MCP，停止后续接保留该设置；其他 MCP 和原生 Agent/Task 等能力继续由原生客户端管理。当前结果通道是 MCP 工具响应，尚不声明宿主退出后的恢复或后台唤醒。

```sh
runweft mcp uninstall --client claude
runweft mcp backups
runweft mcp restore <备份ID>
```

每次实际修改先备份到 Runweft 数据目录的 `backups/mcp/`，输出备份位置与恢复命令。卸载只删除自己的注册及 hook，不删除其他设置或会话数据。恢复会还原该次操作前的完整文件快照；如果相关配置已有后续修改，会拒绝覆盖，此时可选择卸载自己的条目或根据备份手动处理。恢复操作自身也会备份。

## 机器与 runtime

机器是 HAPI Runner 的身份，runtime 是该机器上的 Codex 或 Claude Code。二者分别登记；agent 定义通过 runtime ID 选择执行目标，不把展示名称当作路由。资源属于当前中心的 namespace，进入另一个项目目录仍使用同一份登记。

```sh
runweft start
runweft machine register --name '我的开发机'
runweft runtime discover
runweft runtime register codex --name 'Codex 开发环境'
runweft runtime register claude --name 'Claude 开发环境'
runweft runtime list
runweft runtime check <runtime-ID>
```

按需登记已安装的工具即可，不要求同时安装两种。`discover` 不创建登记，只通过 Runner 查询实际命令及版本，不运行模型；`register` 不启动服务或安装工具。省略机器 ID 时使用当前连接的本机身份，首次没有身份时提示先 `start`。机器在线、工具已发现和模型登录有效是不同事实；输出明确将模型认证与任务执行标为“未检查”。版本读取失败单独报告，只要实际命令与 HAPI 启动检查均通过，仍可登记和选用。

```sh
runweft machine list
runweft machine list --all
runweft machine show
runweft machine rename <machine-ID> '新名称'
runweft runtime show <runtime-ID>
runweft runtime rename <runtime-ID> '新名称'
runweft --json runtime check <runtime-ID>
```

机器列表默认显示已登记机器及当前本机，`--all` 包含历史和未登记机器；runtime 列表默认显示已登记项，`--all` 包含已取消项。展示名称可重复，最多 64 个字符；执行引用使用完整 ID。`show` 与 `list` 能正常显示不可选资源；显式 `runtime check` 在目标不可选时退出码为 1，JSON 仍在 stdout 返回相同状态和原因。离线或探测失败时保留原观察时间，不将历史版本当作当前证明。`discover` 即使缺少其中一种 CLI 也返回发现清单；连接或查询失败则报错。

Hub 客户端可以明确指定同 namespace 内的执行机器：

```sh
runweft machine register <machine-ID>
runweft runtime discover --machine <machine-ID>
runweft runtime register codex --machine <machine-ID>
```

本地模式只选择当前连接的本机资源；需要其他机器时使用对应 Hub 连接。只托管 Hub 的中心不需要本机 Runner，可在 Hub 客户端管理已连接的其他机器。不同 Hub 不按展示名称共享或迁移 ID；无效引用会报错，不能自动换成同名目标。

```sh
runweft runtime unregister <runtime-ID>
runweft machine unregister <machine-ID>
```

取消 runtime 登记禁止新任务选用它，保留原 ID；对同 machineId/flavor 再次 register 会恢复该 ID 和原名称。取消机器登记会列出受影响 runtime，使它们不可用于新任务，但保留它们各自的登记；恢复机器后可重新检查和选用。两种取消都不会停止原生任务、删除会话或修改 agent 定义；已有 agent 引用需恢复登记或显式重新选择。

工具缺失或配置无效时，检查执行机器上的 PATH、原生 home 和命令覆盖。Runner 使用启动时的环境，修改后在那台机器运行 `runweft restart`，再 `runtime check`。资源操作无需工程初始化、Git 仓库或 agent 定义。

## Agent 定义与个人绑定

机器标识执行位置，runtime 标识该机器上的工具，Agent 定义职责与指令。机器/runtime 属于当前中心；Agent 可以全局或项目共享，不会自行注册资源或触发任务。

```sh
runweft agent init reviewer
runweft agent init reviewer --scope project
runweft agent list
runweft agent show reviewer
runweft agent validate
runweft agent bind reviewer --runtime <runtime-ID>
runweft agent check reviewer
runweft agent list --check
```

`init` 输出可直接编辑的 YAML 路径，默认全局 `<数据根>/agents/<id>.yaml`，项目文件位于 `<项目根>/.runweft/agents/<id>.yaml`。id 满足 `^[a-z][a-z0-9-]{0,63}$`，已有文件不会覆盖。只用 `.yaml`；`.yml` 会提示改名，符号链接可读取且 `show` 显示实际目标。

```yaml
schemaVersion: 1
name: 代码评审
description: 检查变更正确性、回归和验证缺口
instructions: |
  阅读工程约定与相关变更，按严重性报告有依据的问题。
runtime: null
flavor: null
model: null
reasoningEffort: null
```

`description` 供主 agent 发现和选择，`instructions` 由委派作为任务指令传入；二者不自动互相混用。模型和推理参数留空继承执行工具的默认值。设置非空 `model` 或 `reasoningEffort` 时必须填写 `flavor: codex` 或 `flavor: claude`；指定 flavor 的定义只能绑定同类型 runtime。Runweft 不维护模型清单，`check` 验证资源与参数映射，不证明模型登录或模型/推理参数组合已执行成功。

项目同 id 定义整体覆盖全局项，包括空值；`show` 显示两处来源。用 `show/check/bind/unbind <id> --scope global` 可维护被遮蔽的全局项。坏的项目定义不会退回全局；`list` 和 `validate` 列出有效项及错误，有错误时非零退出；无关坏文件不阻止检查指定 id。

Git 项目从当前 worktree 根读取定义；从子目录调用仍使用该根。无 Git 时向上找到最近的 `.runweft/agents`，不会把用户 home 下的默认全局目录当作祖先项目；没有项目定义时 `init --scope project` 在当前目录创建；非 Git 的用户 home 只使用全局作用域，创建项目定义需先进入项目目录。

共享 YAML 可以保留 `runtime: null`。`agent bind` 将个人选择存入集中 `client.sqlite`，不会编辑项目文件；优先于 YAML 中的 runtime。全局绑定跨项目；Git 项目绑定在同一仓库的 worktree 间复用，不同 clone 和非 Git 项目各自独立。worktree 的定义内容仍来自各自基线，绑定不混合职责。

```sh
runweft agent bind reviewer --scope global --runtime <runtime-ID>
runweft agent unbind reviewer
runweft --json agent check reviewer
```

绑定按当前连接与认证 namespace 隔离；local 改端口不丢失绑定，local 与 hub 即使指向同一个 URL 仍是不同连接。切换 Hub 或 namespace 要明确绑定该处 runtime。离线 `list/show` 将已有个人绑定标为“namespace 尚未认证”，在线 `check` 才选择准确身份的引用。

已知离线或取消登记的 runtime 可以保存绑定，命令会提示当前不可选；`check` 和 `list --check` 在目标不可选时返回非零，不自动切换目标。`unbind` 只移除当前身份的个人选择，随后使用 YAML 引用；YAML 也为空则保持未绑定。离线 `validate` 允许 runtime 为空。

定义解析提供带版本、连接及 namespace 的内容快照，供委派消费；单独解析不创建会话。执行工具继续加载执行账户已有的原生全局配置，并从主 cwd 或准备完成的 worktree cwd 加载工程配置。远端接收解析后的定义和项目基线，不会自动同步发起机器的全局 skills、其他 MCP 或凭据。受控执行只禁用 Runweft MCP，其他 MCP 和原生子代理能力保留。

## 本机任务

CLI 和 MCP 提供同一组派生、查看、等待、多轮续接和定向控制能力。进入实际工作目录，先用 `agent check` 确认定义绑定本机 runtime：

```sh
runweft agent check reviewer
runweft task spawn reviewer --message "检查当前改动并报告问题"
runweft task wait <任务ID>
runweft task show <任务ID>
runweft task list
```

可用 `--message-file <文件>` 读取较长任务，`-` 表示 stdin。派生先在 stderr 输出 request ID，再返回接受结果；若响应丢失，保持任务参数并传 `--request-id <原ID>` 重试，或用 `task list` 查已接受记录。中心持续观察并收尾，CLI 退出或等待超时不取消任务。只有原生结果可靠、执行确认停止及共享收尾完成后，才显示完成。

目录可以没有 Git；共享模式在同一 cwd 执行，不自动提交或清理。Hub 模式也必须选择发起机的 runtime。`task list` 默认当前发起机和目录（包含 MCP 来源），`--all` 查看当前 namespace；长报告用 `task show --offset <字符偏移> --limit <字符数>` 分页。

```sh
runweft task send <任务ID> --message "继续处理刚才发现的问题"
runweft task send <任务ID> --steer --round <轮次ID> --message "本轮补充要求"
runweft task interrupt <任务ID> --round <轮次ID>
runweft task permission <任务ID> --round <轮次ID> --request <原生审批ID> --decision approved
```

`send` 默认排下一轮，前轮确认停止后才开始，优先续接原生 session；只有原生明确报告历史缺失，才用旧任务和报告构造有界上下文。现有任务始终使用原目录、runtime 和定义快照；改 YAML 或换当前目录不重定向它。运行中追加只支持 Codex，必须指定活跃轮次；接受后通过 `show` 的输入状态区分已注入、已消费、排队和未知，Claude 使用默认下一轮排队。

`interrupt` 只针对指定轮次；迟到请求不影响后轮。取消未知执行也需要停止证明，保留原生未知与报告不完整标记。`show` 显示当前待审批内容与 HAPI 详情地址；`permission` 可选 approved、denied、abort，问答可附 `--answers <JSON>`，仅响应当前请求，不改变默认权限策略。等待超时可再次等待；自动化调用可将返回的 revision 用于 `--after-revision '{"任务ID":版本}'`，按序读取新结果。

### 独立 Git worktree

需要隔离代码改动时，在受 Git 管理的主工作区派生：

```sh
runweft task spawn developer --workspace-mode worktree --base HEAD --message "实现任务并运行相关检查"
runweft task wait <任务ID>
runweft task show <任务ID>
runweft --json task show <任务ID>
```

`developer` 是已绑定 runtime 的 Agent 定义。本机任务的 `--base` 可省略，默认 HEAD；远端任务必须显式提供。可指定已有 commit、分支或 tag，接受任务时冻结为 commit。主目录未提交、未跟踪及 ignored 内容不会自动复制，后续主分支移动也不改变子任务的基线。共享模式仅支持本机，且不接受 `--base`。

HAPI 先创建并核对独立工作树，再在对应目录启动 agent。版本化的工程指令、skill 和项目 MCP 来自所选基线，原生全局配置及路径信任策略继续生效；没有进入基线的工程配置不会凭空出现。项目依赖由 agent 按需安装。Git 需 2.31+；基线含 LFS 时需要 Git LFS 及可读实体对象，含子模块时需能初始化相应 commit。缺少工具、对象或访问权限会阻止启动并显示原因。

每轮结束先停止子执行，再保留 agent 已有提交，并把剩余非 ignored 改动补为 checkpoint；没有改动不创建空提交。机器补交使用 `HAPI Checkpoint <checkpoint@hapi.local>` 身份，沿用 Git hooks、签名与过滤器，不修改用户 Git 全局配置。主目录不被自动提交。子模块内部脏内容或 gitlink 改变不能自动封存，应先由主 agent 处理。

`wait` 在执行停止且成果已封存后返回完成；远端还会先尝试发布代码和附件，交付失败单独显示，不能把原生成功当作代码已取回。JSON 的 `git` 提供 `base_commit`、本轮 `start_head`、`result_head`、`result_ref`、checkout 路径及留存状态。本机成果对象已在同一仓库，不需 push；主 agent 或操作者在目标分支审查后自行合入，例如：

```sh
git diff <start_head> <result_head>
git log --oneline <base_commit>..<result_head>
git merge <result_ref>
```

也可审查后选择具体提交 cherry-pick。成果可能包含多次 agent 提交，不能假设只取最后一个 checkpoint 就包含全部变更。冲突和推送由主 agent 处理，Runweft 不自动合码。

`needs_attention` 且 `git.status=needs_attention` 表示工作区收尾需要修复，例如 hook、签名、索引锁或目录改动不满足条件；原生报告仍可读取。根据 `show` 的原因处理现场或手动完成提交后，显式重试：

```sh
runweft task retry-finish <任务ID> --round <轮次ID>
runweft task wait <任务ID>
```

这只重试 Git 收尾，不重新发任务或启动模型。未知操作先查询同一任务，不盲目重跑。封存未成功时，已排队的下一轮不会开始。准备时取消的任务在准备结果明确后收尾，不为收尾启动模型；已经启动但停止未知的执行仍需确认停止。

后续 `task send` 复用原 worktree、依赖和原生 session，以前轮成果为起点，不自动跟进主分支。默认无限期保留 worktree，合入代码也不删除。需要回收时显式执行：

```sh
runweft task workspace remove <任务ID>
runweft task show <任务ID>
# 若清理因 ignored 依赖或文件被拒绝，确认这些内容可丢弃后：
runweft task workspace remove <任务ID> --discard-ignored
```

删除命令返回受理后，用 `show` 确认 `git.retained=removed`。存在排队/活跃任务、停止未知、未封存或脏改动时会拒绝；删除进行中拒绝追加任务。成功删除移除自有 checkout 和任务分支，保留报告、原生历史与 base/round 成果引用，之后不能再续接该环境。未启动的失败准备也只有在确认归属和没有唯一改动后才可清理；不要用直接删除目录代替此命令。

### 远端任务与代码取回

源、目标 Runner 连接同一 Hub/namespace，Agent 绑定目标 runtime。主工作区必须是 Git 仓库；使用上面的 `task spawn --workspace-mode worktree --base HEAD` 即会自动传输固定基线、准备工作区和输入，然后启动目标 agent，无需先运行诊断 prepare。中心无需 Runner 或 Git。续接沿原任务基线与前轮成果，不重新同步主分支。

```sh
runweft task result show <任务ID>
runweft task result fetch <任务ID> --round <轮次ID>
runweft task result show <任务ID> --round <轮次ID>
# 代码发布确定失败，修复原因后补交；不会重跑模型：
runweft task result retry <任务ID> --round <轮次ID>
```

show/fetch 省略 `--round` 时选最新接受轮次，其成果未就绪就显示等待，不退回旧结果。fetch 从中心恢复 Git、未改变的子模块和基线/成果 LFS 到原主仓库，完成后给出专用 ref；不改变主目录、index 或分支，也不自动合入。根据状态确认取回完成，再审查和显式 merge。成果已发布后执行机可以离线，发起机 Runner 仍需在线。MCP 使用 `fetch_result`、`retry_result`，普通附件补交仍用 `retry_artifacts`。

worktree 默认保留，取回也不删除。远端 `task workspace remove` 要求所有轮次和文件操作已结束，代码已经发布或明确放弃。它移除自有 checkout、任务分支和精确成果引用，再释放该任务的输入基线消费者；其他任务仍保护共享缓存。中心代码清单与恢复文件继续保留，执行机缓存删除后仍可取回。`show` 分别显示环境删除与缓存/基线释放状态，清理失败会保留原因并沿原意图恢复。

不再需要中心保存某轮代码时，使用独立的释放命令：

```sh
runweft task result release <任务ID> --round <轮次ID>
runweft task result release <任务ID> --round <轮次ID> --apply
# 已停止且未交付代码确定可放弃时：
runweft task result release <任务ID> --round <轮次ID> --discard-pending --apply
```

默认仅预览，省略 `--round` 选择已结束或收尾中的轮次。apply 后保存逐项释放进度，历史清单仍可查看，但这一轮不再承诺可取回，也不能 retry 恢复旧发布。只移除本轮中心引用和已停止的候选，不删除报告、工作区、已取回的主仓库引用或其他轮次的引用。文件字节仍须按 `artifact prune/remove` 清理；共享文件有其他引用时继续保留。

活跃或未知操作不能释放。捕获确定失败、原生已停止且 Git 已封存时，`--discard-pending` 可显式放弃该轮，随后继续附件收尾并放行已排队下一轮；下一轮仍通过正常工作区准备，不会重跑已结束模型。普通代码补交仍优先使用 retry。

### 远端 Git 诊断准备

在主 Git 工作区使用已绑定另一台机器 runtime 的 Agent：

```sh
runweft workspace prepare --agent developer --base HEAD
runweft workspace inspect <准备ID>
runweft workspace preparations
runweft workspace preparations --all
```

源、目标 Runner 均须在线并连接同一 Hub/namespace；中心本身不需要 Runner 或 Git。`--base` 必须显式提供，接受后固定为提交 SHA；未提交内容排除并在详情提示。支持没有 remote 或尚未 push 的基线；源端必须已有所需 Git、子模块和 LFS 对象。目标是发起机时会提示改用本机 worktree 委派，不创建远端诊断。

命令输出准备 ID、请求 ID、固定 SHA、阶段、预计上传/复用字节与错误。响应丢失时用原参数和 `--request-id <原请求ID>` 查询同一次准备；未知状态先 inspect，不盲目新建。明确失败后按提示修复，用新请求和原固定 SHA 再准备，旧记录保留。同 namespace、源仓库及 SHA 复用基线和目标缓存，不重复打包或上传；另一提交使用新的完整 bundle，相同 LFS 实体只增加引用。目标导入失败与中心基线可用性分别展示。

准备完成时可看到独立 worktree 的目录和分支，不启动模型。诊断不接收任务消息或附件，也不会在以后被业务任务接管；正式任务直接使用 task spawn。准备记录、中心恢复对象和目标缓存默认保留；不再需要该诊断环境时显式释放：

```sh
runweft workspace release <准备ID>
runweft workspace inspect <准备ID>
# 只有明确可丢弃 ignored 依赖和文件时：
runweft workspace release <准备ID> --discard-ignored
```

release 先返回受理状态，用 inspect 确认最终 `released`。源/目标操作或执行停止状态未知时保留恢复对象并继续查询原操作；明确失败会显示原因，修复后再次 release。新增提交、脏代码和尚未回收的成果不会自动 checkpoint 后删除。命令不作用于正式任务的工作区；后者使用 `task workspace remove`。

移除本环境后才解除其消费者引用；最后一个消费者释放才解除该快照的恢复 pin，其他快照共享的 LFS 引用保留。缓存仍被其他导入、外部 worktree 或未知 Git ref 使用时会说明保留原因，不能仅凭目录空闲删除。中心文件字节沿原有 artifact remove/prune 规则清理，历史准备与操作回执继续可查。已完全释放快照再用于新准备时创建新代次，旧请求仍返回已释放记录。不要手工删除缓存目录或修改恢复引用。

此入口随配套 CLI 与 HAPI 一起交付；更新候选安装后，用 `workspace prepare --help` 和 `workspace release --help` 核对命令。

### 主 agent 的 MCP 流程

例如让主 agent：“用 reviewer 检查当前改动，等待结果，并总结需要处理的问题。”它可以先发现定义，再按下表操作；Codex 宿主可以选 Claude runtime，Claude 宿主也可以选 Codex runtime。

| 工具 | 用途 |
| --- | --- |
| `list_agent_definitions` | 查看当前项目有效定义和各自 runtime 可选状态 |
| `spawn_agent` | 传 `agent_type`、`message`，立即返回 `agent_id`、`round_id`、`request_id` 和接受状态；`workspace_mode` 默认 `shared`，可选 `worktree`，其 `base_ref` 默认 HEAD |
| `list_agents` | 查看当前原生父会话的任务、状态及最近接受记录 |
| `wait` | 传 `ids`，等待任一任务完成或需要处理；`timeout_ms` 默认 30000，最大 540000，超时返回 `timed_out=true` |
| `read_agent` | 传 `id`，读取最新接受轮次的完整事实、审批与报告；可指定 `round_id`、`offset`、`limit` |
| `send_input` | 传 `id`、`message`，默认 `mode=next`；Codex 的 `mode=steer` 还须传活跃 `round_id` |
| `interrupt_agent` | 传 `id`、`round_id`，请求取消该轮次，再通过读取/等待确认停止 |
| `retry_finish` | 修复 Git 收尾错误后，传 `id`、`round_id` 重试成果封存；不重跑模型 |
| `upload_artifact` | 上传宿主工作目录内的普通文件；传 `path`，可指定 `name` 和稳定的 `request_id`，返回 `artifact.id`、大小及摘要 |
| `read_artifact` | 传 `id` 或 `request_id` 之一，查询中心文件元数据和状态，不返回字节内容 |
| `download_artifact` | 传 `id`、目标文件 `path`，校验后保存；明确替换已有文件才设 `overwrite=true` |
| `retry_artifacts` | 传任务 `id`、`round_id`，重传该轮固定候选；缺失文件须补收，不重跑模型 |
| `collect_artifacts` | 传任务 `id`、`round_id`、`files: [{name, relativePath}]`，在任务静止后补收并生成新版本 |
| `respond_to_permission` | 传 `id`、`round_id`、原生 `request_id`、`decision`，显式响应当前审批；可带原生 `answers` |

`spawn_agent`/`send_input` 的接受结果不等于任务完成。省略 `request_id` 时，同一次原生调用有稳定请求 ID；重新发起另一次调用会生成新 ID。遇到模糊接受响应，先 `list_agents` 查已接受记录，再用原 `request_id` 和相同参数重试，避免重复派生。审批工具的 `request_id` 则是原生审批 ID，两者用途不同。

带文件的任务先调用 `upload_artifact`，再将结果的 `artifact.id` 放到 `spawn_agent` 或 `send_input(mode=next)` 的 `inputs: [{artifactId, name?}]`，输出声明用 `outputs: [{name, relativePath}]`。每轮独立声明，`steer` 不接受附件。`read_agent` 的 `artifacts.manifest` 给出成功项的 `artifactId`，用 `download_artifact` 保存；`input_files` 展示输入与下载副本留存。文件重试和补收返回受理后仍须读取或等待，响应不明先用 `list_agents` 查已接受的文件操作及其 `request_id`，再查看 `read_agent.artifacts.pending`；保留原 ID 和参数重试。

MCP 上传源和下载目标均限定宿主实际工作目录，包括符号链接解析后的路径；新下载目录也检查已有祖先。目录外文件可由操作者显式使用 CLI 处理。上传响应不明时用原 `request_id` 查询；预先指定 ID 可在宿主取消或失联后定位。文件工具只返回元数据和保存路径，不把二进制放进模型上下文。服务以 60 秒无进展及取消信号中止传输，不另设总时限；宿主自己的 MCP 调用超时仍有效，持续传输超过宿主时限时使用 CLI。

概览提供 `status`、需处理原因、轮次和有界报告。`needs_attention` 可能是原生审批或工作区收尾错误，应根据 `attention` 和 `git` 区分；`unknown` 表示现有证据不能确认某个步骤，不应盲目重跑。`completed` 表示本轮执行及关闭已确认，worktree 还要求成果封存成功，不表示成果已合并或验收。缺少结构化报告时仍保留原生文本。

等待默认观察调用开始时最新接受轮次；想消费新通知时，传 `after_revision: {"任务ID": 上次返回的revision}`。新轮次排队时不会被旧轮次的完成提前满足；前轮审批阻塞后轮时会返回 `blocking_round_id`，应处理该轮次。长报告按 `next_offset` 分页，历史报告用固定 `round_id` 读取。

MCP 仅操作当前父会话自己的任务，CLI 是当前 namespace 的操作者入口。受控子执行禁用全部 Runweft MCP，并拒绝经 CLI 再派生或追加 Runweft 任务；其他 MCP 和内置 subagent 保留。子端从 HAPI 原生输出交回报告，无需专门汇报工具。

取消等待或宿主连接断开不会取消中心已接受的任务；需要中断时显式调用对应工具或 CLI 命令。主宿主关闭后不承诺新会话自动接回原父身份，已有结果仍可用 CLI 查看。服务停止会暂停中心观察，不能代替任务中断；需要有序关闭时先等待任务收尾或逐轮中断，再停止服务。

## 持久文件

文件命令不需要活跃 agent 或 Runner。本地模式把文件存到本机托管的 HAPI，Hub 模式存到所连中心；执行机关闭不影响已发布文件的下载。

```sh
runweft artifact limits
runweft artifact upload './需求 brief.pdf'
runweft artifact list
runweft artifact show <文件ID>
runweft artifact download <文件ID> --output ./downloads/brief.pdf
runweft artifact refs <文件ID>
runweft artifact remove <文件ID>
```

上传先在 stderr 打印请求 ID，完成后返回文件 ID、大小及 SHA-256。响应不明确时用 `artifact lookup <请求ID>` 查询；需要重传时给原文件加 `--request-id <请求ID>`，内容或名称变了则用新请求。已发布字节不会覆盖，删除后的请求 ID 也不能复活文件。`--json` 的 stdout 只有结果，传输进度走 stderr。

下载流式校验后才保存目标，默认不覆盖已有文件；明确替换时加 `--overwrite`。只接受显式普通文件，目录请先自行打包。`--name` 可指定显示文件名，支持中文和空格。列表按 `--offset`、`--limit` 分页（最多 200），也展示删除记录。

默认单文件 512 MiB，每 namespace 的已保存文件与上传预约合计 10 GiB。用 `artifact limits` 查看当前服务的真实用量和限制。有留存引用的对象不能删除，`artifact refs` 会列出引用原因；不要直接删数据目录来腾空间。用 task artifacts release 预览已结束轮次的留存释放。

### 将文件带入任务

先上传，再把文件 ID 传给任务；不需要把文件内容复制到 prompt：

```sh
runweft artifact upload './需求 brief.pdf'
runweft task spawn reviewer --message '读取输入并评审需求' --input <文件ID>
runweft task send <任务ID> --message '结合这份补充继续评审' --input '补充说明.pdf=<文件ID>'
runweft task show <任务ID>
```

`--input` 可重复，默认采用上传对象的文件名；同轮有重名时用 `名称=文件ID` 区分。shared 和 worktree 均先下载、核验输入，再启动或续接模型。实际读取路径在任务提示和 `task show` 的 `input_files` 中展示；文件保存在连接数据根，不写入主工作区。worktree 会复制到自己的输入目录，随后自动释放下载中间副本；shared 下载副本在确认本轮执行停止后自动回收。`input_files.download_retention` 显示下载副本状态，worktree 内的输入随工作区保留。

附件列表属于本轮请求，重试须保留相同 request ID 和参数。下一轮显式传入需要的附件；省略 `--input` 表示该轮没有新输入，不自动沿用上一轮列表。`--steer` 不接受新附件。已接受的输入带留存引用，排队、执行和完成后的普通删除都会拒绝；需要回收时显式使用 task artifacts release。输入缺失或校验失败会显示原因，模型不会替代程序补做下载，也不会因文件传输失败被重新执行。

### 任务成果与补交

用 `--output` 声明工作目录内的文件，可重复；需要区分同名文件时用 `名称=相对路径`：

```sh
runweft task spawn writer --message '生成报告和结果数据' --output report.md --output results/data.json
runweft task artifacts show <任务ID> --round <轮次ID>
runweft artifact download <成果文件ID> --output ./report.md
```

任务进程停止后才捕获文件，worktree 先完成 Git 封存。只收集声明的普通文件，不扫描目录；未忽略的输出也会进入 worktree 的 Git 成果。文件捕获后保存在连接数据根，中心确认交付和清单持久化后自动释放成功候选的本地副本。执行机离线后仍可下载中心已经发布的文件。

`task show/wait` 分开显示原生结果、Git 和 `artifacts`。文件缺失或传输失败时清单为 `incomplete`，成功项仍可下载，原生执行结论不变。按错误选择重传或补收：

```sh
# 修复连接、配额或文件大小限制后，只重传已捕获的失败候选
runweft task artifacts retry <任务ID> --round <轮次ID>
# 任务当前没有执行或准备中的轮次时，显式收集遗漏的文件
runweft task artifacts collect <任务ID> --round <轮次ID> --path notes.txt
runweft task artifacts show <任务ID> --round <轮次ID> --version 1
```

重传不重新读取工作目录，也不运行模型或 Git。补收记录新的捕获时间；用相同逻辑名补收会在新清单版本中替换该项，旧版本和旧对象保留。两类命令都返回请求 ID，响应丢失时加 `--request-id` 重试相同参数。补交接受后，命令会给出带 `--after-revision` 的完整等待命令；发布新清单才通知更新。下一轮不自动继承上一轮的 `--output`，`--steer` 不接受输出声明。

## 配置

没有配置文件时可以直接使用本地默认值。需要调整时：

```sh
runweft init
runweft config path
runweft config set server.port 3211
runweft config check
runweft config show
runweft restart
```

`init` 保留已有配置；`config set` 保留注释并先校验，失败不覆盖原文件。配置优先级为字段环境变量高于 YAML，高于默认值；`config show` 显示每项生效来源。数据根的全局 `--home` 高于 `RUNWEFT_HOME`，例如 `runweft --home /srv/runweft status`。全局参数写在子命令前。

```yaml
schemaVersion: 1
mode: local
server:
  host: 127.0.0.1
  port: 3210
  runner: true
hub:
  tokenEnv: RUNWEFT_HUB_TOKEN
```

| 配置 | 含义 |
| --- | --- |
| `mode` | `local` 管理本机服务；`hub` 连接指定 Runweft 中心 |
| `server.host` / `server.port` | 本机入口监听地址和端口；本地使用 `127.0.0.1` 或 `localhost` |
| `server.publicUrl` | 对外部署时用户实际访问的 HTTP(S) 根地址，用于公开 URL 与 CORS |
| `server.hapiPort` | HAPI 私有 loopback 端口；省略则自动选择，不与入口端口相同 |
| `server.runner` | 中心是否同时托管本机 Runner；只有中心职责的机器可设 `false` |
| `server.artifacts.maxFileMiB` | 托管服务单文件上限，默认 512 MiB |
| `server.artifacts.namespaceQuotaGiB` | 每 namespace 已保存与预约字节上限，默认 10 GiB |
| `server.artifacts.unreferencedDays` / `pendingHours` | 无引用文件/预约的清理策略，默认 7 天/24 小时；当前不自动删除 |
| `hub.url` | Hub 模式下的 Runweft 中心根地址，不含路径或查询参数 |
| `hub.tokenEnv` | 保存访问令牌的环境变量名称，不是令牌值 |
| `hapi.executable` | 开发或兼容 fork 的程序覆盖；正常安装无需填写 |

环境变量覆盖入口为 `RUNWEFT_MODE`、`RUNWEFT_HUB_URL`、`RUNWEFT_HOST`、`RUNWEFT_PORT`、`RUNWEFT_PUBLIC_URL`、`RUNWEFT_HAPI_EXECUTABLE`。托管服务的 `HAPI_HOME`、`DB_PATH`、HAPI 地址、端口和访问令牌由 Runweft 管理，忽略同名外部部署设置；模型原生配置环境继续继承。

## Hub 部署

| 机器角色 | 需要安装和运行的内容 |
| --- | --- |
| 中心 | Runweft 配套包，前台 `serve --public`；保存 HAPI 与 Runweft 服务端数据 |
| 主宿主机器 | Runweft 与原生 Codex/Claude Code；Hub 模式连接该中心 |
| 执行机器 | 兼容版本的 Runweft 包、所需原生 runtime 和该账户的模型配置；Hub 模式 `start` 注册本机 Runner |

同一机器可兼任多种角色。纯 HAPI Hub 不包含 Runweft 上层路由，不能直接当作 Runweft 中心；doctor 会明确提示。原生模型 CLI 的认证仍按其原有方式配置，不复制其他机器的 home、skill 或凭据。MCP 注册只在显式运行 `runweft mcp install` 时修改原生配置。

中心保留 `mode: local`，配置公开地址。以下示例假设已有反向代理把公开 HTTPS 地址转到本机 3210 端口：

```sh
runweft init
runweft config set server.publicUrl https://runweft.example.com
runweft config set server.runner false
runweft serve --public
```

`--public` 在默认 host 下监听 `0.0.0.0`；不加该选项的 `start` / `serve` 保持本地模式。公开部署由已有进程管理器运行上述前台命令，发送 SIGTERM 可正常关闭。重启中心应保持 `serve --public` 参数；`runweft restart` 用于本地后台组合或 Hub 客户端 Runner。HAPI 内部端口只绑定 loopback。

在中心另一终端运行 `runweft auth token` 取得访问令牌，再通过已有安全方式交给客户端。客户端操作：

```sh
runweft init --url https://runweft.example.com
runweft auth login
runweft start
runweft status
runweft doctor
```

无人值守环境可配置 `RUNWEFT_HUB_TOKEN`，或用秘密管理工具将令牌通过标准输入传给 `runweft auth login --token-stdin`；不要把令牌写在命令参数或 `config.yaml`。环境变量令牌优先于本连接保存的令牌。

Hub 客户端 `stop` 只停止该机器在当前连接上的 Runner，不关闭中心。不同 Hub URL 与本地模式各自保存连接身份；切换配置不会迁移数据，也不会替用户停止旧连接的 Runner。切换前应先停止当前连接，再配置新地址和认证。

已有本地配置时，`init --url` 不会覆盖它。切到 Hub 的明确步骤是先 `runweft stop`，再 `runweft config set hub.url https://runweft.example.com`、`runweft config set mode hub`，然后登录并启动。切回本地先停止当前 Runner，再设置 `mode local`。

## 数据、升级与诊断

`runweft paths` 给出所有实际路径。相对数据根：

| 目录或文件 | 生命周期 |
| --- | --- |
| `config.yaml` | 可编辑配置；升级保留 |
| `agents/` | 可编辑全局 Agent YAML；项目定义留在项目 `.runweft/agents/` |
| `server/hapi/` | 托管 Hub 的原有数据库、令牌、JWT 密钥及状态；备份保留 |
| `server/runweft/state.sqlite` | 中心机器/runtime 登记、任务/轮次/请求及报告；v5 基线/导入/消费者/LFS/诊断准备，v6 增加代码清单和取回操作，轮次记录包含释放进度；原生完整历史仍归 HAPI，不保存模型凭据 |
| `connections/<连接>/hapi/` | 本机 Runner 的连接配置、机器身份和原生日志；各连接分开 |
| `connections/<连接>/hapi/workspaces/environments/<环境ID>/` | 独立任务或诊断的 checkout、准备/收尾回执及树外输入；持久保存，不能当缓存清理 |
| `connections/<连接>/hapi/workspaces/repositories/` | 远端基线的自有共享 Git/LFS 缓存，checkout 依赖此处；不是可随意删除的临时缓存 |
| `connections/<连接>/hapi/workspaces/exports/`、`imports/` | 仓库操作与清单回执；成功传输的导出/捕获/下载中间副本自动释放，未交付候选保留 |
| `connections/<连接>/hapi/workspaces/fetches/` | 代码取回回执与独立验证副本；成功取回后副本释放，失败现场保留到显式成果释放 |
| `client.sqlite` | 本机工作目录与 Agent 个人 runtime 绑定；Claude MCP hook 的逐调用身份用后删除，未消费记录保留 24 小时 |
| `logs/` | 托管服务日志；当前由部署方按磁盘需要归档或轮转 |
| `backups/mcp/` | MCP 安装、更新、卸载及恢复前的原生配置快照；可能包含原配置中的秘密，权限仅限当前用户 |
| `cache/`、`tmp/` | 可再生缓存与临时文件；服务停止后可清理，不保存唯一成果 |
| `server/process.json` | 当前托管服务定位信息；正常停止会移除 |

Codex/Claude Code 的配置和会话历史仍在各自原生目录，工作区源码仍在原处。不要删除整个数据根来修复安装问题。

`paths.taskWorkspaces` 给出当前连接的本机环境根，`doctor` 的 `task_workspaces.checkoutCount` 统计其中实际保留的 checkout 目录，包括可能尚未准备成功的现场；不代表成功任务数，也不统计其他连接或机器。读取失败会显示诊断错误；离线仍能查看本机目录数量。任务状态和具体路径用 `task list --all` / `task show` 查询，运行这两个命令需要连上中心。

`paths.repositoryCaches`、`repositoryExports`、`repositoryImports`、`repositoryFetches` 和 doctor 的工作区诊断给出受管仓库目录。通过 task/workspace 命令处理引用和环境，通过 artifact 命令处理无引用字节，不直接删除这些持久目录。

local 模式的资源库位于本机中心；hub 模式只读写所连中心的资源库，客户端不保留第二份权威登记。`paths` 显示本机可能托管中心的库路径，并在 hub 模式标明资源归属；备份资源登记须在中心停止服务后备份 `server/runweft/`（包括尚存的 SQLite WAL 文件），不能只备份客户端连接目录。

升级时安装同一批次的主包与平台包，再按角色重启相应服务。`status` 区分已安装与正在运行的服务版本；`doctor` 检查固定 HAPI 兼容版本。更换二进制不自动删除旧数据，也不主动迁移用户已有 `~/.hapi`。有活跃模型任务时先收尾再更新执行组件。

备份前停止对应服务；备份 `config.yaml`、`agents/`、`server/`、`connections/` 和 `client.sqlite`。SQLite 使用 WAL，整个停止后的数据根一起备份最直接。恢复时使用匹配的 Runweft/HAPI 版本；未来数据升级由所属 Change 定义，当前不承诺跨任意版本回退。npm 卸载只删除软件包，数据根需另行管理。

有本机源仓库派生的 worktree 时，先等待所有轮次停止并完成收尾，再停止服务，同时备份源仓库及其 Git common directory、Runweft 数据和需要续接的原生历史。checkout 的 `.git` 指向源仓库，Git 对象/refs 不在 Runweft 数据根；只备份其中一侧不完整。远端诊断 worktree 指向执行机数据根内的 `workspaces/repositories/`，备份时同时保留该缓存、环境目录及中心基线记录/文件对象。按原路径恢复后检查 `git worktree list` 和对应记录；迁移路径涉及 Git 注册及持久环境记录，当前没有自动迁移命令，不能仅移动目录后直接续接。子模块对象和 LFS 实体也应一起保存。

任务分支为 `hapi-task/<任务ID>`，基线与每轮成果引用为 `refs/hapi/workspaces/<任务ID>/base`、`refs/hapi/workspaces/<任务ID>/rounds/<轮次ID>`。本机 checkout 删除后仍保留这些引用；远端任务 remove 在代码已交付或明确放弃后释放精确轮次引用，共享 cache 由剩余消费者继续保护。取回到主仓库的引用为 `refs/hapi/results/<任务ID>/<轮次ID>`，Runweft 清理不删除它。操作者确认不再需要后按主仓库的 Git 规则维护；“已合入”不会触发自动删除。

常见排查顺序是 `config check` → `status` → `doctor` → `paths` 所列日志。端口占用先修正 `server.port`；纯 HAPI 地址改为 Runweft 中心；认证失败核对当前连接与令牌来源。错误不会静默切回本地或其他执行目标。

原有 HAPI 命令可通过 `runweft hapi …` 使用，参数、终端、退出码和信号沿原程序传递；覆盖同一托管 Hub/Runner 的操作会提示使用统一启停命令。

## 源码构建和候选安装验收

```sh
git submodule update --init hapi
bun install --frozen-lockfile
bun run build:hapi
bun run build
bun run typecheck
bun run test
bun run test:service
bun run test:resources
bun run test:agents
bun run package --all
bun run test:install
```

构建使用固定版本 Bun 1.4.2。`build` 会核对 HAPI 源码 revision、工作区状态及已构建文件的校验和；修改固定版本后须先重新运行 `build:hapi`，不能混用旧二进制。`package --all` 生成四个平台的 npm 包和可移交的 `dist/packages/index.json`；`package --platform darwin-arm64` 可只构建一个平台。`--reuse-hapi` 使用相同核对规则跳过 HAPI 重建。

安装验收启动一次性 registry，并使用 `.dev-smoke/` 下的专用 npm 配置、缓存、安装前缀和数据目录；不改用户的全局 Runweft、HAPI 或模型配置。平台包附有 HAPI 许可、NOTICE、工具许可和对应源码归档。候选包保持 private，不会由构建或 CI 自动发布到 npm。

`test:resources` 需要已安装 Codex 和 Claude Code（优先 iclaude，可设置 `RUNWEFT_SMOKE_CLAUDE`），仅执行版本查询，不需要模型登录。它使用专用空原生配置和配套编译程序验证本地与 Hub 资源命令、MCP 安装/握手、稳定 ID、离线、恢复和环境故障；离线等待沿 HAPI 的 45 秒活跃超时。脚本保存证据并关闭自建服务，故障环境只作用于测试 Runner；macOS 若发现原生 Codex.app 回退路径，会如实记录，命令缺失仍通过专用 Claude 覆盖验证。

`test:workspace-preparation` 验证配套编译 CLI 的远端诊断准备与释放：专用 Hub 无 Runner，同机两个 Runner 传输 103 个 Git/LFS 文件，检查请求接受后重启、同提交与 LFS 复用、源端离线后的查询、脏文件/ignored 保护、目标离线恢复、实际缓存删除及跨快照 pin 留存，并验证 local 模式同机目标拒绝。需要 Git/LFS 和已安装 Codex，仅查询 runtime 版本，不调用模型；证据在 `.dev-smoke/workspace-preparation-*`。底层导出与导入可分别运行 `test:repository-export`、`test:repository-import`。这些实验不代替真实跨物理机器验收。

`RUNWEFT_SMOKE_REMOTE_PREPARATION=1 bun run test:install` 在 npm 候选实际安装后，使用安装的 CLI/HAPI 再执行上述完整诊断验证。Bun 只运行验收脚本；安装产品本身无需 Bun，基础服务检查另用不含 Bun 的 PATH 验证。

`test:remote-native` 会实际调用已登录的 Codex 和 Claude Code（优先 iclaude），需要真实 agent 验收授权。它复制配置与认证到专用目录，在导入的独立 worktree 中各运行两轮只读任务：读取工程指令、skill、每轮新附件、子模块和二进制 LFS，核对续接原生会话、Runweft MCP 禁用、其他 MCP 保留，并验证失效准备拒绝启动、进程退出和源/执行 Runner 离线后的中心下载。可追加 `dist/runweft dist/hapi codex` 或 `claude` 只运行一种 runtime；证据在 `.dev-smoke/remote-native-*`，原全局配置保持不变。这是同机双 Runner 验证，仍不代表真实跨机验收。

`test:remote-tasks` 通过正式 CLI 自动准备并委派两种 runtime 各两轮，验证工程继承、输入/输出、Git 收尾故障修复、session 续接以及执行端离线后的代码取回与显式合入。`bun run test:result-retention <已成功的 .dev-smoke/remote-tasks-native-目录>` 随后使用该专用现场验证公开 CLI 成果预览/释放、两任务共享缓存删除及缓存消失后的取回；后者不启动模型，会实际清理指定测试环境。

`test:agents` 同样只需要已安装的原生工具，不需要模型登录。它用配套编译 CLI 和专用 Hub/Runner 验证定义创建、worktree 绑定、local/Hub 连接、真实 token namespace 后缀、目标失效与恢复；保存证据并停止自建服务，不启动模型会话。

已有 Codex/Claude Code 模型登录的开发环境可显式运行原生验收：

```sh
bun run test:mcp
bun run test:execution
bun run test:tasks
bun run test:task-controls
bun run test:task-mcp
bun run test:collaboration
bun run test:workspaces
bun run test:worktree-tasks
```

独立工作区的两宿主 × 两 runtime × local/同机 Hub 矩阵使用 `RUNWEFT_SMOKE_WORKSPACE=worktree bun run test:collaboration`；可用 `RUNWEFT_SMOKE_CASE=local-codex-claude` 选择单组。`test:workspaces` 验证机器 Git/准备入口；`test:worktree-tasks` 运行实际模型。测试证据和专用数据都保存在 `.dev-smoke/`，不能把跨平台编译或同机 Hub 当作跨机器执行验证。

`test:mcp` 复制原生配置及认证到 `.dev-smoke/` 专用目录，用编译产物验证 local/hub 两种连接下的真实全局安装、身份和 HAPI 子执行启动/续接的工具禁用，并记录证据和进程清理结果。默认 Claude 命令优先使用 `iclaude`，可通过 `RUNWEFT_SMOKE_CLAUDE` 指定。`test:execution` 使用当前原生模型配置和专用服务/工作目录，验证执行事实、审批、中断、续接与结果不确定时的查询。二者会实际调用模型，不属于常规单元测试。

`test:tasks` 使用专用 Codex 配置副本、非 Git 工作目录和编译 CLI，验证任务接受/去重、原生完成、自动关闭进程、等待游标及服务重启后读取。它会实际调用模型，证据保存在 `.dev-smoke/tasks-*`，结束后关闭自建服务。

`test:task-controls` 用专用 Codex/Claude 配置及明确模型/推理参数，验证真实续接、权限批准/拒绝、定向中断与 Codex 追加。只在专用 Codex 配置副本中启用 on-request 和 workspace-write 以产生审批；产品继续继承用户原生默认配置。可通过 RUNWEFT_SMOKE_CODEX_MODEL/EFFORT 和 RUNWEFT_SMOKE_CLAUDE_MODEL/EFFORT 选择当前可用参数，证据保存在 `.dev-smoke/task-controls-*`。

`test:task-mcp` 由两个真实原生宿主分别完成派生、等待、结果读取，验证子 CLI 拒绝递归委派和超过 60 秒的 MCP 等待；`RUNWEFT_SMOKE_HOST=codex|claude` 可只验证一个宿主。

`test:collaboration` 覆盖 local 与同机 Hub 下两宿主 × 两 runtime 的八个组合，包括共享编辑、纯报告续接、其他 MCP 保留、Runweft 工具过滤、进程退出及实际 MCP 连接中断。`RUNWEFT_SMOKE_CASE=hub-claude-codex` 可选择一个组合；指定组合后加 `RUNWEFT_SMOKE_CONTROLS=1` 验证原生 MCP steer/不支持分支与定向中断。证据保存在 `.dev-smoke/collaboration-*`。这些测试会调用模型，只修改专用原生配置；同机 Hub 结果不代替真实跨机远端验收。

`RUNWEFT_SMOKE_REMOTE=1 bun run test:collaboration` 验证独立 Hub、发起 Runner 和目标 Runner 下的两宿主 × 两 runtime 四组远端委派；也可用 `RUNWEFT_SMOKE_CASE` 选择一组。每组两轮包含自动基线、附件、Git/LFS、未改变的递归子模块、MCP 取回和 session 续接；执行端停止、源分支删除后再经 CLI 取回并显式合入。证据在 `.dev-smoke/remote-mcp-*`，同机不同 Runner 身份不代表物理跨机。传入 `RUNWEFT_SMOKE_REMOTE_EVIDENCE='[".dev-smoke/remote-mcp-…/evidence.json"]' bun run test:install` 可让候选安装验证复用已完成现场，只重启中心/发起端、查询、下载和取回，不再次运行模型。

`test:artifact-mcp` 使用同样的两宿主 × 两 runtime × local/同机 Hub 八组，实际通过 MCP 上传、带输入派生、读取输出、重试/补收并下载，第二轮续接同一原生会话。Hub 的两个交叉 runtime 组合使用独立 worktree，其余使用 shared；可用 `RUNWEFT_SMOKE_CASE` 选择单组。证据在 `.dev-smoke/artifact-mcp-*`，测试配置与数据独立保存，结束后关闭自建服务。


### 文件清理与用量

```sh
runweft artifact limits
runweft artifact prune
runweft artifact prune --apply
runweft artifact refs <文件ID>
runweft artifact remove <无引用文件ID>
runweft doctor
```

`prune` 默认只预览，`--apply` 才删除本页符合条件的字节。默认一页 100 个，`--limit` 可选 1–200；按返回的 `nextCursor` 用 `--after` 继续。apply 时重新检查引用、期限、对象状态和活跃上传，逐项列出失败原因；失败项不阻止其他项。响应丢失时用 show/lookup 查原对象，重新从第一页清理也不会重复删除已删除对象。删除保留元数据墓碑及原 request ID，下载返回已删除，已发布内容不能以旧 request ID 复活。

默认只清理没有任何引用的对象：已发布对象从发布时间满 7 天，未完成上传预约从创建时间满 24 小时。释放引用不重置这些期限；删除中断的对象可继续清理。单对象 remove 不要求满期限，但同样拒绝任何引用。任务输入、成果、恢复和其他来源的引用均受保护，完成任务不会自动删掉唯一文件副本，也不会隐式定时清理。用下述轮次释放入口解除其 input/output 引用；不要手工删数据库引用或数据目录以绕过保护。

limits 与 doctor 展示当前中心的已发布、预约、删除中及引用保留用量；同一对象的多个引用只计一次，引用字节已包含在前三项总额中。这是配额占用，不是磁盘实际占用，Runner 输入/候选和数据库另计。Hub 客户端的本地 server.artifacts 设置不覆盖所连 Hub；修改服务端配置后重启托管服务。配额不足时先预览可清文件，查看被引用对象的留存原因；按需提高中心 namespaceQuotaGiB。

### 释放轮次附件留存

```sh
runweft task artifacts release <任务ID>
runweft task artifacts release <任务ID> --round <轮次ID> --apply
runweft task artifacts release <任务ID> --round <轮次ID> --discard-pending --apply
runweft task artifacts show <任务ID> --round <轮次ID>
```

release 默认只预览，省略 round 选择本任务全部已结束轮次；本任务仍有排队、执行或未确定的文件操作时拒绝释放。预览列出本轮各历史版本的引用和未交付捕获候选；后者应先 retry，只有明确放弃重传来源时才用 `--discard-pending`。缺失且从未捕获的文件没有候选可放弃。

`--apply` 先持久记录释放意图，再回收本轮下载/捕获副本并逐项解除 input/output 引用。CLI 返回受理结果，用 show 查询；服务重启和同一 release 重试继续已有记录，不重新运行模型。释放进行中暂不接受该任务新的轮次或文件操作，其他任务照常执行。输入接受过程中已登记但未接受的引用仍由中心启动时自动对账；未知来源和 recovery 引用始终保留。

留存状态 retained/releasing/released/discarded 与不可变的历史清单分开；release 不删除报告、Git ref、工作区或中心对象字节。解除引用后，其他来源的引用仍保护对象；没有引用时可显式 remove 或到期 prune。历史清单中的 available 表示当时发布成功，实际下载以当前中心对象状态为准。

释放后不再对原轮次 retry/collect；需要新成果时用 next 新建轮次，并重新显式提供所需输入。后续仍可复用原生 session 和保留的 worktree。释放结果通过 artifactsRevision 通知 wait，原完成 revision 和执行结论保持不变。

### 文件部署与恢复

`runweft paths` 标出本机托管中心的 artifacts、连接对应的 artifact-transfers 以及中心业务库。Hub 模式的权威对象字节在 Hub，执行机只保留准备文件与未交付候选；成功候选会在清单确认后自动回收。所有这些路径都在配置的数据根内，用户显式下载的位置由用户选择。

备份前停止业务中心与对应 Runner，保存中心 Runweft state.sqlite、HAPI 数据库与整个 artifacts 目录；保留执行机 artifact-transfers 中的未交付候选和回执。恢复时数据库与字节来自同一次备份，不单独回滚数据库；恢复后运行 doctor，并查询原任务/文件操作。未知来源引用保守保留，无法仅凭缺少本地任务记录判定可删除。原生凭据继续由原生配置管理，不进入文件对象存储。

反向代理需允许配置的单文件体积和持续流式传输。以下 Nginx 示例适用于默认 512 MiB 上限，服务端和各级网关的限制需要一致；此环境未安装 Nginx，示例尚未经过 Nginx 实测：

```nginx
location / {
    proxy_pass http://127.0.0.1:3210;
    proxy_http_version 1.1;
    client_max_body_size 512m;
    proxy_request_buffering off;
    proxy_buffering off;
    client_body_timeout 60s;
    proxy_send_timeout 60s;
    proxy_read_timeout 60s;
    proxy_set_header Host $host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

这些超时约束两次 I/O 之间的空闲时间，不能另加限制整个文件传输时长的网关规则；依据 [Nginx proxy 超时与缓冲说明](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_read_timeout)及 [client body 限制说明](https://nginx.org/en/docs/http/ngx_http_core_module.html#client_body_timeout)。遇到 413 或代理 HTML 错误，检查入口代理与 Hub 的体积限制；不要重复派生任务。公开 Hub 的 TLS、访问控制和已有 WebSocket 配置仍按部署要求设置。
