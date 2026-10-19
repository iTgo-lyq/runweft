# CLI 安装与命令承载

Runweft 以统一 CLI 承载配置、服务、连接、资源和委派。`runweft hapi …` 调用配套 HAPI，保留参数、终端交互、退出码与信号；同一托管 Hub/Runner 使用统一启停命令。

## 安装包

- npm 主包通过固定版本可选依赖选择 macOS arm64/x64、glibc Linux arm64/x64 平台包；需要 Node.js 20+，不需要全局 Bun 或单独安装 HAPI。
- 平台 tarball 可直接解包运行，不需要 Node；保留相邻 Runweft/HAPI 和包目录结构，可通过符号链接提供统一命令入口。Mac 产物未签名、未公证。
- Node 启动器运行配套二进制并转发信号。不支持的平台、缺少平台依赖或文件不完整时非零退出并提供诊断，不切换执行组件。
- 构建验证固定 HAPI revision、版本和干净源码；复用构建还核对二进制 hash。平台包包含 HAPI 程序、许可、NOTICE、匹配的源码归档和构建来源。
- `build` 在编译前核对已构建 HAPI 的 revision 和 hash，不混用旧程序；更换固定版本后先运行 `build:hapi`。`package --reuse-hapi` 使用相同核对规则。
- registry 须提供主包和固定版本平台依赖；只安装主包 tarball 不能代替完整依赖解析。
- 主包和四个平台包均附相同的完整使用说明，覆盖安装、配置、任务协作、数据留存与维护，不要求从源码启动日常命令。
- 主包和平台包同时附带产品 Skill，官网统一提供 npm 安装命令，从 npm 包读取 Skill，无独立下载；安装到宿主由用户授权的 Agent 操作，不自动更改全局配置。
- 打包使用独立暂存，成功后替换旧交付；索引与校验文件绑定源码、配套 HAPI、程序和 tarball，见[发行产物](../release/spec.md)。
- npm 卸载删除程序，保留 Runweft 数据根。包升级不搬迁用户数据，运行中的服务与已安装程序分别报告版本，按角色重启生效。

## 完整卸载

根级 `uninstall` 默认只预览，`--yes` 执行完整删除，`--dry-run` 始终预览；全局 `--home` 与 `--json` 位于子命令前。范围为当前安装与选定本机 Runweft 数据根，不扫描其他账号、数据根或远端 Hub，不清理全局 npm 缓存。

支持可确认归属的 npm 全局包与完整独立平台包。预检安装、路径、所有权、权限、原生接入、Skill、进程与 Git 元数据；拒绝源码/项目依赖、未知包、危险数据根、未知内容、同程序其他 home 占用、无法验证的进程和被用户改写的任务 Git 引用。预览不停止进程、不打开业务库、不写文件或备份。

执行先停止该 home 的 Hub、全部连接 Runner、当前及恢复记录中的登记会话和本 home 的 MCP 服务；检查残留后，用无持久备份的配置编辑移除自身 MCP/hook，清理已确认的 Skill 与确切受管 worktree/refs，再删除程序和整个数据根（含配置、连接凭据、数据库、日志、缓存、工作区副本及备份）。保留其他软件配置、模型凭据、原生历史、独立 HAPI、用户源项目、用户分支和其他工作树；子符号链接只移除链接。卸载不得在将被停止的受管祖先进程内运行。

npm 程序删除禁用生命周期脚本、忽略 npm_config 环境污染并核对入口/主包/平台程序已消失。失败非零，程序删除失败保留数据并可重试；程序已删而数据删除失败时报告准确剩余路径，不提示调用已删除 CLI。停止或删除已完成的部分不制造虚假恢复。

## 命令约定

全局 `--home` 与 `--json` 写在子命令前。JSON 输出用于已实现的结构化命令；HAPI 透传保留原程序输出。错误写入 stderr，并设置非零退出码。业务能力尚未实现时不提供占位命令。

安装与维护操作见[使用说明](../../../usage.md)；配置和服务行为见[部署](../deployment/spec.md)。

## 全局 MCP 安装与维护

`runweft mcp install` 为检测到的 Codex/Claude Code 注册全局 Runweft MCP；可通过 `--client codex|claude|all` 明确选择。安装只由显式 CLI 命令触发，不自动修改用户配置。

固定 server ID 为 `runweft`，记录实际可执行入口和选定 Runweft home；不固定 cwd，不写入连接令牌。开发入口使用 Bun 与源码的绝对路径，编译入口使用自身路径，支持含空格路径。重复安装检查和更新自己的注册；已有非 Runweft 管理的同名条目时明确拒绝覆盖。

### 原生配置

- Codex 使用 CODEX_HOME/config.toml，默认 `~/.codex/config.toml`。安装时原生编辑器在 staging 生成自身定义，按 TOML AST 的原文范围合入目标；卸载直接编辑 TOML AST，不依赖 Codex 可执行程序。保留其他 MCP、配置语义和注释，不复制或修改模型认证文件。
- Claude 默认 MCP 文件为 `~/.claude.json`，hook 文件为 `~/.claude/settings.json`；设置 CLAUDE_CONFIG_DIR 时分别使用该目录下的 `.claude.json`、`settings.json`。只维护自己的 server 和匹配 `mcp__runweft__.*` 的身份 hook，保留其他设置。

两种客户端在不同项目启动时使用各自实际 cwd；全局安装不创建业务 agent 或 runtime 注册。

Codex 受管条目写入 tool_timeout_sec=600，为最长 540 秒的 wait 留出返回余量。旧受管条目由显式重复安装升级，其他 MCP 和配置保持不变。

### 诊断与恢复

`mcp check` 展示实际配置位置、命令、home、stdio 握手和当前服务状态，检查禁用入口、失效路径和 Claude hook 一致性。它不运行模型，不把握手称为真实宿主调用成功；服务不可用与安装配置问题分别报告。

Codex 受管超时缺失或小于 600 秒时，check 提示重新安装，不自动修改配置。

普通 mcp install/uninstall/restore 每次实际修改前保存完整配置快照到 `<Runweft home>/backups/mcp/<ID>.json`，权限限制为当前用户，输出备份位置。写入前校验原文件并原子替换；多文件操作失败时回退自己已写且未被后续修改的文件，不覆盖并发编辑。

`mcp uninstall` 仅删除仍属 Runweft 管理的注册和 hook，保留其他配置及会话数据。`mcp backups` 列出集中备份；`mcp restore <ID>` 还原该次操作前的文件，拒绝覆盖此后发生的修改，恢复本身也创建备份。快照可能包含原配置中的秘密，普通输出不打印其内容。

根级 [完整卸载](#完整卸载)复用这些编辑与并发校验规则，用内存快照回退，不新增持久备份；最后删除选定数据根中已有备份。只移除此 home 的接入；另一 home 的注册若仍引用当前程序则拒绝删除，指向其他安装的注册保留。未知同名注册继续拒绝覆盖。

## 产品接入 Skill

`.agents/skills/runweft-kit` 是工程内唯一产品 Skill 源码，供 Agent 显式读取或由支持该位置的宿主发现；主文件按接入、中心配置、委派和维护路由到 references，包含完整命令、安全限制、诊断和升级/卸载流程。主包和全部平台包继续在 `skills/runweft-kit` 携带同一 Skill（含宿主 UI 元数据），另有根目录为 `runweft-kit/` 的 `runweft-kit-<version>.tgz`；发行索引记录 SHA-256/SHA-512，官网以 npm 安装为程序入口，不提供独立下载。

独立公开仓库 [runweft-kit](https://github.com/iTgo-lyq/runweft-kit) 提供 `skills/runweft-kit/`，可通过 `npx skills add iTgo-lyq/runweft-kit --skill runweft-kit --agent codex -g --copy -y` 安装；Claude Code 使用 `--agent claude-code`。公开分发只包含产品 Skill 和安装说明，不依赖 Runweft 源码公开。已有加载的工程 Skill 时直接复用，不重复安装全局副本；自动发现能力按实际宿主核对。

用户授权后，Agent 将 Skill 放到 Codex `.agents/skills/runweft-kit` 或 Claude `.claude/skills/runweft-kit`；不同已有内容先备份/确认，卸载只删除确认受管目录。不自动安装到开发者全局配置，不修改模型凭据或其他 MCP/Skill。MCP 使用产品显式安装/更新/卸载命令。

流程选择明确 Hub 或复用现有连接；首次体验指令允许时默认启动本机 Hub。用户在浏览器一页注册/登录并确认空间，begin/complete 使用确认即激活和本地待连接记录，凭据不进模型、URL 或日志。只读任务 CLI 与 Web 无需登记机器；执行写操作仍要求机器登记。机器、runtime、中心 Agent 分开建立，不能把在线/工具发现当作模型成功。

程序以 npm 为常规安装入口，Skill 可从独立公开仓库或已安装 npm 包接入宿主。升级分别核对来源与本地修改：工程维护的 Skill 由 Git 更新，skills CLI 安装的副本按实际全局/项目范围更新，npm 副本随程序包比对更新；已有个人修改先备份到扫描目录外并确认替换范围。Skill 更新不代替程序版本，实际操作仍核对 CLI `--version/--help`。只删程序使用 npm，保留数据；完整删除使用根级 [uninstall](#完整卸载)，先核对实际版本支持。既有平台包安装按已确认受管范围处理。

用户明确要求完整卸载即授权删除选定环境：Agent 先预览并核对范围，一致时直接执行 --yes，不再次确认；不依赖 config show 或业务库可打开。仅处理 Runweft 的 Skill 路径，普通目录须有 name=runweft 且文件集合属于包内 Skill；未知文件拒绝删除，符号链接只移除链接。保留其他 Skill、模型凭据、原生历史与用户项目；错误范围或失败停止并报告。实际卸载在独立终端执行，受管祖先不能停止自身。

维护区分安装程序和运行服务，升级后按角色重启；没有虚构自升级命令。停止/续接/文件和代码取回保留实际任务 ID，不确定结果先读状态与回执，不盲目重发。显式清理不删除仍需保留的 worktree，数据格式不匹配时指向独立新home；不提供data/reset、旧YAML迁移或自动历史认领。

完整用户路径见[使用说明](../../../usage.md)；后台见[Hub 页面](../dashboard/spec.md)。

首次体验接入提示同时授权安装与只读评审时，Agent 自动复用/配置机器、Runner、当前宿主执行工具、Git 仓库关联和私有评审 Agent，使用 task CLI 发起、等待并读回完整报告；不要求第二段用户提示或先重开 MCP。MCP 是否可用单独报告，确需重载时提示一次。只安装的请求不自动触发模型任务；原生登录、审批、配置冲突或真实歧义保留必要交互。
