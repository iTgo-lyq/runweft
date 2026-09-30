# Runweft 开发与自动验收

`bun run test:hub` 使用已构建的 `dist/runweft` 与 `dist/hapi`，在专用数据根启动无 Runner 的 Hub，执行 Playwright 身份/空间流程、真实 HAPI 新旧凭据双向拒绝和秘密扫描，不调用模型。需要可用的 Chromium；可用 `RUNWEFT_SMOKE_CHROMIUM` 指定已安装的浏览器程序。证据位于 `.dev-smoke/hub-identity-*`，脚本结束停止自建服务，下载的身份备份也只保留于该专用目录。

```sh
git submodule update --init hapi
bun install --frozen-lockfile
(cd hapi && bun install --frozen-lockfile)
bun run build:hapi
bun run build
bun run typecheck
bun run test
bun run test:service
bun run test:resources
bun run test:agents
bun run package --all
bun run test:packages
bun run test:install
```

构建使用固定版本 Bun 1.4.2。`build` 会核对 HAPI 源码 revision、工作区状态及已构建文件的校验和；修改固定版本后须先重新运行 `build:hapi`，不能混用旧二进制。`package --all` 生成四个平台的 npm 包和可移交的 `dist/packages/index.json`；`package --platform darwin-arm64` 可只构建一个平台。`--reuse-hapi` 使用相同核对规则跳过 HAPI 重建。

安装验收启动一次性 registry，并使用 `.dev-smoke/` 下的专用 npm 配置、缓存、安装前缀和数据目录；不改用户的全局 Runweft、HAPI 或模型配置。平台包附有 HAPI 许可、NOTICE、工具许可和对应源码归档。源码工程保持 private，生成的发行包可发布；构建和 CI 均不执行 npm publish。包索引记录源码 revision/dirty、HAPI pin、二进制 SHA-256 和包 SHA-512；SHA256SUMS 可校验全部 tarball 和索引。成功后才替换交付目录，不混入旧版本包。

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

`test:collaboration` 和 `test:artifact-mcp` 默认继承配置副本中的 Codex 模型；如当前账户不支持该模型，可显式设置 `RUNWEFT_SMOKE_CODEX_MODEL` 与 `RUNWEFT_SMOKE_CODEX_EFFORT`。覆盖仅写入专用副本，同时影响测试宿主与执行端，证据记录实际值；产品的默认继承规则和用户配置不变。


## 发行验证补充

`RUNWEFT_SMOKE_NATIVE_INSTALL=1 bun run test:install` 使用实际安装的 CLI 和专用 Codex/Claude 配置验证 MCP 安装、重复安装、卸载与备份恢复；需要可执行的原生 Codex，但不调用模型，也不修改用户配置。常规 CI 不启用此项。

`test:packages` 校验四平台包的 hash、架构、许可、源码版本和解包后的独立服务。`RUNWEFT_SMOKE_KEEP_INSTALL=1 bun run test:install` 在完成卸载验证后重新安装到专用前缀，证据中的 installedCli/installedHapi 可传入后续原生验收，不修改用户全局安装。

`bun run test:dashboard` 使用 Playwright headless Chromium；首次运行先 `bunx playwright install chromium`，也可通过 `RUNWEFT_SMOKE_CHROMIUM` 指定已有 Chromium。它复制已完成任务数据，以页面操作验证登录、筛选、故障恢复、移动布局和 HAPI 详情跳转，不重新派生任务。

安装与产品操作见[使用说明](usage.md)，当前验收范围以[项目文档](README.md)为准。

`RUNWEFT_SMOKE_CODEX_MODEL=<可用模型> RUNWEFT_SMOKE_CODEX_EFFORT=<推理级别> bun scripts/smoke-reconstruction.ts <runweft程序> <配套hapi程序>` 验证两种 runtime 的真实历史缺失重建。先在专用原生目录各完成一轮，再保留同一业务库/机器身份并切换到只有配置与认证的空历史目录；核对精确 missing、新原生 ID、历史记忆、原生输入仅一次和旧历史 hash 不变。使用已有模型认证副本，会调用模型。仅当失败证据明确所有首轮已完成、没有接受后续输入且清理成功时，才可追加该 evidence.json 继续；其他失败先检查原记录，不盲目重跑。

`bun scripts/smoke-upgrade.ts <旧版runweft> <旧版hapi> <新版runweft> <新版hapi> <已完成远端验收evidence.json>` 只接受 `.dev-smoke/` 中全部轮次结束、服务停止的专用现场。它先保存原件，在原绝对路径放置工作副本（保持 Git/worktree 引用有效），验证旧程序写入、运行版本差异、升级、schema v6 回退以及完整停服备份恢复。结束时归还原件并核对整树路径/权限/字节指纹；不调用模型，不用于用户正式数据或任意版本兼容推断。0.1.0 是保留的本地验收基线，未作为已发布历史版本推荐。
