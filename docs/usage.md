# Runweft 基础入口使用说明

当前实现包含配置、HAPI 服务管理、机器/runtime 登记及 Codex/Claude Code 的 MCP 安装与身份诊断；这些模块已通过相应本地验收，agent 定义、任务委派与看板尚未交付。这里不是完整协作版本的完成声明。

## 安装与首次使用

运行环境需要 Node.js 20+。候选包覆盖 macOS arm64/x64、glibc Linux arm64/x64；不需要全局 Bun 或单独安装 HAPI。当前尚未发布到公共 npm，使用提供候选包的 registry：

```sh
npm install -g runweft@0.1.0 --registry <候选包-registry> --include=optional
runweft start
runweft open
```

安装源必须同时提供 `runweft` 和当前平台的 `runweft-<os>-<arch>` 包。主包只有启动器，单独安装主包 tarball 不能代替平台依赖安装。`runweft --version` 可核对版本；找不到平台包时按错误提示重新安装并保留可选依赖。

本地默认入口是 `http://127.0.0.1:3210`，默认数据根是 `~/.runweft`。`start` 自动管理本机 HAPI Hub 与 Runner；`open` 使用该连接的 HAPI 登录打开浏览器。无图形浏览器时，在本机交互终端运行 `runweft auth token`，然后手动访问服务地址登录。令牌不会写入普通状态输出或 JSON。

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

默认检测本机的 Codex 和 Claude Code，也可用 `--client codex`、`--client claude` 或 `--client all` 明确选择。然后进入实际项目目录启动原生会话，调用 `runweft_status` 检查当前身份、工作区和服务连接。全局注册不会固定安装时所在的项目目录；当前仅提供诊断工具，业务委派工具由后续 Change 接入。

`mcp check` 分开报告配置、stdio 握手与服务连接，不执行模型，不把握手当作原生会话已经调用成功。服务未连接时继续用 `runweft status`、`runweft doctor` 检查。不同数据目录使用全局 `--home`：例如 `runweft --home /srv/runweft mcp install`；检查及恢复时也使用相同目录。

安装只维护名为 `runweft` 的 MCP 及 Claude 身份 hook，其他 MCP、原生配置、注释和模型凭据保留。Codex 使用 `CODEX_HOME/config.toml`（默认 `~/.codex/config.toml`）；Claude 默认使用 `~/.claude.json` 和 `~/.claude/settings.json`，设置 `CLAUDE_CONFIG_DIR` 时改用该目录下的 `.claude.json` 和 `settings.json`。重复安装会更新自己的入口，命令路径变化后重新运行安装即可。已存在非 Runweft 管理的同名条目时会明确报冲突。

HAPI 的受控执行入口支持按会话禁用 Runweft MCP，停止后续接保留该设置；其他 MCP 和原生 Agent/Task 等能力继续由原生客户端管理。当前结果通道是 MCP 工具响应，尚不声明宿主退出后的恢复或后台唤醒。

```sh
runweft mcp uninstall --client claude
runweft mcp backups
runweft mcp restore <备份ID>
```

每次实际修改先备份到 Runweft 数据目录的 `backups/mcp/`，输出备份位置与恢复命令。卸载只删除自己的注册及 hook，不删除其他设置或会话数据。恢复会还原该次操作前的完整文件快照；如果相关配置已有后续修改，会拒绝覆盖，此时可选择卸载自己的条目或根据备份手动处理。恢复操作自身也会备份。

## 机器与 runtime

机器是 HAPI Runner 的身份，runtime 是该机器上的 Codex 或 Claude Code。二者分别登记；后续 agent 定义通过 runtime ID 选择执行目标，不把展示名称当作路由。资源属于当前中心的 namespace，进入另一个项目目录仍使用同一份登记。

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
| `server/hapi/` | 托管 Hub 的原有数据库、令牌、JWT 密钥及状态；备份保留 |
| `server/runweft/state.sqlite` | 中心的全局机器/runtime 登记、稳定 ID 和最后一次工具观察；不保存模型凭据或原生会话 |
| `connections/<连接>/hapi/` | 本机 Runner 的连接配置、机器身份和原生日志；各连接分开 |
| `client.sqlite` | 本机真实工作目录绑定；Claude MCP hook 的逐调用身份用后删除，未消费记录保留 24 小时 |
| `logs/` | 托管服务日志；当前由部署方按磁盘需要归档或轮转 |
| `backups/mcp/` | MCP 安装、更新、卸载及恢复前的原生配置快照；可能包含原配置中的秘密，权限仅限当前用户 |
| `cache/`、`tmp/` | 可再生缓存与临时文件；服务停止后可清理，不保存唯一成果 |
| `server/process.json` | 当前托管服务定位信息；正常停止会移除 |

Codex/Claude Code 的配置和会话历史仍在各自原生目录，工作区源码仍在原处。不要删除整个数据根来修复安装问题。

local 模式的资源库位于本机中心；hub 模式只读写所连中心的资源库，客户端不保留第二份权威登记。`paths` 显示本机可能托管中心的库路径，并在 hub 模式标明资源归属；备份资源登记须在中心停止服务后备份 `server/runweft/`（包括尚存的 SQLite WAL 文件），不能只备份客户端连接目录。

升级时安装同一批次的主包与平台包，再按角色重启相应服务。`status` 区分已安装与正在运行的服务版本；`doctor` 检查固定 HAPI 兼容版本。更换二进制不自动删除旧数据，也不主动迁移用户已有 `~/.hapi`。有活跃模型任务时先收尾再更新执行组件。

备份前停止对应服务；备份 `config.yaml`、`server/`、`connections/` 和 `client.sqlite`。SQLite 使用 WAL，整个停止后的数据根一起备份最直接。恢复时使用匹配的 Runweft/HAPI 版本；未来数据升级由所属 Change 定义，当前不承诺跨任意版本回退。npm 卸载只删除软件包，数据根需另行管理。

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
bun run package --all
bun run test:install
```

构建使用固定版本 Bun 1.4.2。`build` 会核对 HAPI 源码 revision、工作区状态及已构建文件的校验和；修改固定版本后须先重新运行 `build:hapi`，不能混用旧二进制。`package --all` 生成四个平台的 npm 包和可移交的 `dist/packages/index.json`；`package --platform darwin-arm64` 可只构建一个平台。`--reuse-hapi` 使用相同核对规则跳过 HAPI 重建。

安装验收启动一次性 registry，并使用 `.dev-smoke/` 下的专用 npm 配置、缓存、安装前缀和数据目录；不改用户的全局 Runweft、HAPI 或模型配置。平台包附有 HAPI 许可、NOTICE、工具许可和对应源码归档。候选包保持 private，不会由构建或 CI 自动发布到 npm。

`test:resources` 需要已安装 Codex 和 Claude Code（优先 iclaude，可设置 `RUNWEFT_SMOKE_CLAUDE`），仅执行版本查询，不需要模型登录。它使用专用空原生配置和配套编译程序验证本地与 Hub 资源命令、MCP 安装/握手、稳定 ID、离线、恢复和环境故障；离线等待沿 HAPI 的 45 秒活跃超时。脚本保存证据并关闭自建服务，故障环境只作用于测试 Runner；macOS 若发现原生 Codex.app 回退路径，会如实记录，命令缺失仍通过专用 Claude 覆盖验证。

已有 Codex/Claude Code 模型登录的开发环境可显式运行原生验收：

```sh
bun run test:mcp
bun run test:execution
```

`test:mcp` 复制原生配置及认证到 `.dev-smoke/` 专用目录，用编译产物验证 local/hub 两种连接下的真实全局安装、身份和 HAPI 子执行启动/续接的工具禁用，并记录证据和进程清理结果。默认 Claude 命令优先使用 `iclaude`，可通过 `RUNWEFT_SMOKE_CLAUDE` 指定。`test:execution` 使用当前原生模型配置和专用服务/工作目录，验证执行事实、审批、中断、续接与结果不确定时的查询。二者会实际调用模型，不属于常规单元测试。
