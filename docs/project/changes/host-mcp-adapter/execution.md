# 宿主 MCP 适配执行概况

## Plan 评审与复核

- 评审：当前工作区 iclaude 会话 `10608b31-2df0-4755-88f0-0d483fb96229`，2026-09-29 10:59–11:06（Asia/Shanghai），退出 0、结果 success。只读源码和文档，未委派其他 agent；本 Change 的一次 Plan 评审已完成，不再重复。
- 原始材料：本机 `.dev-smoke/reviews/host-mcp-adapter/`；本文保存复核结论。

| 意见 | 主 agent 处置 |
| --- | --- |
| Codex 没有原 MCP 条目时 enabled=false 可能配置失败 | 采纳并实测复现 invalid transport；改为完整禁用定义，在原条目不存在、stdio、HTTP 三种情况核对启动与冷续接 |
| 原生参数实验不等于 HAPI 续接能力 | 原文描述的是原生实验，Research 已区分；进一步在 Technical 显式写明 HAPI 承载待 T1 验证 |
| resume 不需要重复传递禁用表 | 采纳。当前 Hub 使用 existingSessionId 重开原行；bootstrap 保留 metadata，launcher 从该 metadata 读取。保留恢复前 Runner 能力检查，不新增第二个 resume 配置来源 |
| Claude 默认 MCP 与 settings 路径不同 | 采纳，明确有/无 CLAUDE_CONFIG_DIR 两套路径，并加入临时 HOME 验证 |
| hook 短期记录需覆盖审批等待 | 采纳，用后删除；未消费记录保留 24 小时，并加入延迟审批验证 |
| 多 cwd 需覆盖同一 Codex app-server | 采纳，纳入 T2 真实宿主验证，不新增任务 |
| 文档入口及历史 revision 易混淆 | 采纳，补 Technical/Plan 入口，标明历史调查和当前固定版本，更新过时“工具分流”表述 |

评审同时确认 Change 独立边界、HAPI 原生落点、安装维护体验和结果通道可行。Claude remote 参数过滤的源码缺口已在评审期间修正为现有 SDK 选项合并；不改写 SDK 查询循环。

## T1 HAPI 受控执行的 MCP 工具禁用

- 结果：HAPI 新增逐执行 `disabledMcpServers`，沿原有 spawn 回执、Runner 和原生启动链路传递并保存 metadata；续接读取同一 metadata。Codex 配置只作用于目标 root，Claude 合并原生 disallowedTools。Hub/Runner 声明能力，Runweft 在不支持的 Hub 前拒绝请求；参数变化触发已有 requestId 冲突检查。未增加执行循环或修改权限默认值。
- 真实验证：Codex 0.156.1、iclaude/Claude Code 2.1.283，专用配置及数据目录。两者经真实 HAPI 源码启动、调用另一个 MCP、停止并续接相同原生 ID，均无 Runweft 工具；Codex 同一共享 runtime 中无关 root 仍有 Runweft 工具，原条目不存在时也通过启动/续接；Claude init 列表保留原生 Task 与 HAPI 工具。证据 `.dev-smoke/host-mcp-t1/run-vvoj9I/evidence.json`，清理无错误、无探针残留。此为源码链路验证，编译组合留给 T4。
- 回归：Runweft `bun run typecheck`、`bun test ./test`（25 项）通过；HAPI `bun run typecheck` 通过，完整 CLI/Web/Hub/Shared/Relay 分别通过 2965/3249/1383/323/118 项，CLI 11、Hub 3 项既有跳过；`bun run gen:fixtures` 无差异。对应日志集中在 `.dev-smoke/host-mcp-t1-*.log`。
- 修正：首次全量测试暴露旧 launcher mock 缺少 metadata getter 和 OpenCode 精确位置参数断言缺少新增可选位，均补齐。CLI 首次运行另有 worker 意外退出，限制 4 个 worker 的完整重跑通过。首轮真实 Codex 实验等待只读 MCP 审批而超时；按原生请求批准专用探针后完整重跑通过，未放宽默认权限。Bun `--tsconfig-override` 源码入口退出时打印其 directory mismatch 诊断；最终进程退出 0，未据此忽略执行状态或清理验证。
- 提交：HAPI 独立 Commit `feat: preserve per-session MCP tool filtering across spawn and resume`，随后固定 Runweft revision。
- Commit：`host-mcp-adapter T1: preserve MCP filtering across managed execution`

## T2 真实宿主身份与 MCP 调用承载

- 结果：使用固定 MCP SDK 1.25.1 提供 stdio 入口及静态工具注册，产品列表仅有 `runweft_status` 诊断。Codex 逐调用核对当前 threadId/callId 与可用根身份；Claude hook 仅保存 toolUseId、session、cwd、可用 agent ID 和时间，以精确调用消费，保留 24 小时覆盖审批等待。initialize/tools/list 不写数据或访问服务，有效调用才绑定实际工作区；测试工具不进产品列表。
- 取消：合并请求与连接 AbortSignal，处理 stdio EOF/进程终止；诊断有明确超时，HTTP 认证阶段也接收取消。等待取消、连接关闭均不触发原生 interrupt/archive，不重放工具调用，不声明后台唤醒。
- 真实 Codex：0.156.1，同一个 app-server 中并发启动两个相同 cwd 的线程及一个不同 cwd 的线程，各完成实际诊断调用并核对返回 identity/workspace。证据 `.dev-smoke/host-mcp-t2/codex-9Cp4vy/evidence.json`，成功、无进程残留；源码实验仍出现已记录的 Bun tsconfig-override 退出诊断。
- 真实 Claude：iclaude/Claude Code 2.1.283，同 cwd 并发、5 秒真实审批延迟、退出后显式 resume 均核对 toolUseId 和原生 session。证据 `.dev-smoke/host-mcp-t2/claude-sym1qoka/evidence.json`。交互式同进程 `/clear` 前后各实际调用一次，返回两个不同且正确的 session ID，证据 `.dev-smoke/host-mcp-t2/clear-5tqp7e3q/evidence.json`。两组均无残留 MCP 进程。
- 验证修正：交互式首次探测停在专用空目录的信任界面，未进入模型调用；终端脚本误读 ANSI 增量画面及选择，未据此判断产品失败。关闭这些未启动任务的实验后，在专用 Claude 配置副本中仅信任该实验目录，完成上述真实 clear 验证。没有用模拟 session 切换替代该证据。
- 回归：`bun run typecheck`、`bun test ./test` 全部通过（32 项、143 断言），覆盖缺失/冲突身份、fork 根身份差异、hook 一次消费/并发/过期、静态发现无副作用、取消/断开/超时、认证中止以及真实 stdio CLI。`bun run build` 成功编译 MCP 入口；此处不声明配套 HAPI 编译验收，T4 重新构建并验证完整组合。
- Commit：`host-mcp-adapter T2: bind MCP calls to native host identities`

## T3 一键全局安装、诊断与维护

- 结果：提供 `mcp install/check/uninstall/backups/restore`，支持自动检测或明确选择两个原生客户端；注册固定 home 和可执行入口，不固定项目 cwd、不写入连接令牌。只维护自己的 server/hook，备份统一位于 `backups/mcp`，`paths` 展示目录。check 分开报告 stdio 握手与服务，明确没有运行模型；能识别禁用入口、失效命令、不同 home 及不匹配 hook。
- 配置写入：Codex 在专用 staging 调用原生编辑器生成自己的定义，再通过 TOML AST range 合回原文，校验其他语义不变。Claude 合并自己两份 JSON 条目；修改前集中备份，写入失败回退已写文件，不覆盖用户并发修改。卸载保留外来同名 server 和无关 hook；显式 restore 拒绝覆盖后续更改，恢复操作也备份。
- 技术修正：真实回归暴露原生 Codex 编辑器会丢失其他 MCP table 内部注释，按流程暂停、核对并修正 Technical，采用固定 toml-eslint-parser 1.0.3 做局部编辑。新增覆盖带引号键、dotted keys、内联 table、多行字符串及其他配置注释的回归；没有自写 TOML 解析器或清空其他 MCP。
- 验证：`bun run typecheck`、`bun test ./test`（38 项、226 断言）、`bun run build` 通过。专用配置覆盖幂等更新、默认 Claude HOME 路径、CLAUDE_CONFIG_DIR、冲突、双文件失败回退、并发编辑保护、显式恢复及卸载。原生 Codex 编辑器用例仅在提供 codex 的环境运行，本机确实执行并通过；无 codex 的常规 CI 显式跳过该项，AST 和 Claude 用例仍运行。
- 真实安装：编译版可执行文件及 home 均置于含空格路径，执行正式 CLI 全局安装后，Codex 与 iclaude/Claude Code 分别在两个 cwd 实际调用诊断，身份、工作区和 home 均正确。幂等安装、卸载、恢复及恢复后握手通过；最终构建再次通过默认检测的无修改安装及握手。证据 `.dev-smoke/host-mcp-t3/installed-rnozxq/evidence.json`，无残留测试进程。本任务未启动服务，因此不以配置握手替代 T4 的配套连接验收。
- Commit：`host-mcp-adapter T3: install and maintain global MCP configuration`


## T4 配套构建与宿主整体验收

- 结果：新增显式 `bun run test:mcp`，以原生配置和认证的专用副本执行正式全局安装，通过配套 Runweft/HAPI 二进制验证两宿主和两 runtime；不改真实用户配置。测试探针只保存身份、工具目录、调用及清理事实，不记录完整 prompt、源码或凭据。`build` 与 `package --reuse-hapi` 共用固定源码和二进制校验，旧 revision 在改写产物前被拒绝。
- 配套产物：HAPI `58a2f6eac3acebafacb6c0827672ff91c77bb6ea`，Bun 1.4.2、Linux x64。`bun run build:hapi`、`bun run build`、`bun run package --reuse-hapi` 成功；Runweft SHA-256 `f69b2740a0de5b1c8384d965cf7bdf23135a949fc73d69ff9914fe764c0c09c0`，HAPI `41fcc51559828565013fe867d02d0147596b88babe5a58d56d00e5bbb5dfb3a5`。旧构建记录拒绝且既有二进制不变的证据为 `.dev-smoke/host-mcp-t4-build-guard.json`。
- 原生组合：Codex 0.156.1、Claude Code 2.1.283，local/hub 各完成两宿主真实诊断调用，身份、cwd、数据根和已认证连接正确；两种子执行各完成启动、实际调用保留的 MCP、原生输出回收、关闭、续接相同 native ID、再次调用与关闭。原生工具目录均不含 Runweft；Claude 仍有 Task，其他配置继承沿 T1/T3 证据。编译版 MCP 取消认证等待后，实际 HTTP 请求中止，没有重放或执行控制请求。证据 `.dev-smoke/mcp-ggKE1t/evidence.json`，2026-09-29 12:28–12:30（Asia/Shanghai），success=true、cleanupErrors=[]。
- 原有执行回归：`bun run test:execution` 经专用模型配置副本通过两 runtime 的并发启动去重、丢响应查询、项目说明/skill 继承、定向中断、批准/拒绝、同 native session 历史续接及进程关闭；Codex 共享 root 的兄弟会话仍可执行。证据 `.dev-smoke/execution-9h5sXh/evidence.json`，success=true、cleanupErrors=[]。
- 服务与安装：`bun run test:service` 通过编译网关、认证、SSE/WebSocket、重启、独立 Hub 客户端及信号清理，证据 `.dev-smoke/service-4UoYwI/evidence.json`。`bun run test:install` 从临时 registry 安装新候选包，使用不含 Bun/源码目录的 PATH 完成服务回归、缺失平台包诊断及卸载保留数据，证据 `.dev-smoke/install-T0iH0O/evidence.json`。均 success=true。
- 常规检查：`bun run typecheck`、`bun test ./test`（38 项、226 断言）通过。T4 没有修改 HAPI 源码，复用 T1 对同一 revision 的完整 HAPI 检查，不重复全量测试。
- 验证脚本修正：第一次读取 Codex 工具目录时误选已关闭的旧 runtime 记录，改为按当前 hostPid 和 active 选择，修复连接错误处理。第二次 Claude 已调用探针并返回中文“筛选完成”，固定英文结束词断言失败；改为核对实际探针调用、原生 completed 事实及非空输出，工具禁用仍由原生目录断言。两次失败环境均确认清理，最终上述整套重跑通过；没有通过重发状态未知的任务消除错误。
- 范围：本机覆盖两种部署连接，不冒充跨机器验证；macOS 完整组合留给集成发布 Change。当前产品 MCP 只有诊断，业务委派和子 CLI 再派生拒绝由委派 Change 实现。
- Commit：`host-mcp-adapter T4: verify paired MCP installation and tool filtering`

## 需求验收映射

| 验收项 | 实现与证据 |
| --- | --- |
| 全局安装、重复/更新、卸载、失败恢复 | T3 安装测试及含空格路径的真实编译安装；T4 正式安装后的 local/hub 调用 |
| 保留其他 MCP、模型配置和凭据，不串 cwd | T1 原生继承；T3 AST/原生配置编辑验证和两个项目；T4 实际其他 MCP 调用及认证 |
| 两宿主可信身份与结构化结果 | T2 原生元数据/精确 hook 关联；T4 正式入口真实返回 |
| 受控子执行移除 Runweft MCP，HAPI 回收结果 | T1/T4 原生工具目录、实际执行事实与原生输出 |
| 同 cwd 并发、Claude clear/resume 与旧启动身份 | T2 同 app-server 并发、真实交互式 clear、延迟审批及显式 resume |
| 取消、超时、断开，不重放或擅自中断 | T2 协议及真实 stdio EOF；T4 编译进程中止实际认证 HTTP 请求；不声明后台唤醒 |
| 启动及续接保持禁用，其他能力保留 | T1 共享 root、无原条目与两种 runtime；T4 两种连接下的四组真实续接 |
| 在线协作边界，不改用户全局配置完成验收 | 专用原生 home 和数据根；不包含已关闭主宿主恢复 |
