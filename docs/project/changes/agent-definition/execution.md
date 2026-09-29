# Agent 定义执行概况

## 一次 Plan 评审与采纳

- 评审：当前工作区 iclaude，2026-09-29 13:56–14:02（Asia/Shanghai），原生会话 `46bc9cae-6ff5-48c8-a04b-4f73c4bc09d3`；只读完成，退出 0，无额度错误。原始结果 `.dev-smoke/reviews/agent-definition/review.md`。
- 采纳：非空模型/推理参数必须指定 flavor，声明的 flavor 总是约束目标；坏文件只影响对应 id；connectionName + namespace + 稳定来源键；显式 scope 维护；Git common dir 共享个人绑定；显式宿主 cwd、可序列化连接快照与批量目标发现；home 搜索边界、.yml 错误提示、只读符号链接和明确 id 规则。
- 判断：worktree 仍读取自己的 Git 基线定义，共享个人执行资源选择不会混合内容；不同 clone 隔离。显式 flavor 即便无模型参数也有约束含义，避免空参数暗中撤销用户选择。
- 保留：validate 作为离线检查入口；description 允许空值，由 list 明示“未填写职责说明”，不因缺少展示说明阻断手动选择。schemaVersion 默认 1。不引入模型清单或统一配置平台。
- 下游：委派生命周期补充两种 flavor 非空模型/推理参数的真实启动验收；本 Change 只验证原生映射且不启动任务。
- 确认：按用户自主推进授权采用修订后的 Requirement/Technical/Plan，三个任务依次独立提交。

## T1 可解释的全局与项目定义

- 结果：全局/项目 YAML、完整覆盖、来源与被遮蔽项、稳定内容版本、显式 cwd/Git worktree/非 Git 定位和 init/list/show/validate 已实现。坏文件逐项报告，指定 id 不受无关错误影响；符号链接只读，创建不覆盖。
- 验证：`bun run typecheck` 通过；`bun test ./test/agents.test.ts ./test/cli.test.ts` 6 项、60 个断言通过，包含真实 Git worktree/clone、配置错误和 CLI 子进程；Change 结构校验通过。读取未创建数据库或服务目录。
- 边界：个人绑定和在线目标检查按计划由 T2 加入；当前不创建任务。
- Commit：`agent-definition T1: add scoped YAML definitions and offline agent commands`

## T2 个人绑定与委派参数快照

- 结果：个人绑定集中保存于 client.sqlite 自有表，沿现有 connectionName 和认证 namespace 选择；bind/unbind/check/list --check 与离线绑定展示已接通。公共 AgentClient 显式接收 cwd，生成可序列化快照，映射两种 HAPI 参数并禁用 Runweft MCP；不创建执行。
- 验证：`bun run typecheck` 通过；`bun test ./test/agent-targets.test.ts ./test/agents.test.ts` 10 项、235 个断言通过。使用真实 SQLite、HTTP/JWT 网关与 CLI 子进程，验证原生参数映射、内容/目标版本、来源与连接/namespace 隔离、旧客户端表保留、文件不改写、离线/注销/错误 flavor、批量探测一次及派生解析重新检查。
- 边界：HTTP 测试中的 Runner 由 fixture 提供；配套 HAPI 原生命令与真实 namespace 由 T3 验收，不宣称模型组合已运行。
- Commit：`agent-definition T2: resolve personal runtime bindings and native launch snapshots`

## T3 配套定义验收与使用说明

- 结果：paths 展示全局定义与集中绑定库；使用说明覆盖完整配置、整体覆盖、个人绑定、作用域/连接/namespace、原生继承和验证边界。新增可重复执行的 `test:agents`，配套 Linux x64 编译程序与候选 npm 包已更新；HAPI revision 保持不变。
- 复核修正：非 Git 用户 home 不作为项目作用域；全局定义目录不再次解释为项目目录，避免从 home 启动时改变来源与绑定身份。已补专用测试和清晰错误提示。
- 自动验证：常规 `bun test ./test` 61 项、851 个断言通过；目录来源修正后 `bun test ./test/agents.test.ts ./test/agent-targets.test.ts` 10 项、238 个断言通过。最终 `bun run typecheck`、`bun run build`、`bun run package --reuse-hapi` 通过。
- 原生组合：最终 `bun run test:agents` 通过，证据 `.dev-smoke/agents-BbiYjp/evidence.json`，success=true、cleanupErrors=[]。Codex 0.156.1、iclaude 2.1.283；真实 local Hub/Runner、另 namespace 的 Hub 客户端 Runner、两种 flavor、Git worktree、同 URL 切换模式、token :namespace 后缀、绑定来源、注销/恢复与重启均验证。前后原生会话列表相同，没有模型任务。
- 安装回归：`bun run test:install` 通过，证据 `.dev-smoke/install-tXuhPV/evidence.json`；一次性 registry 安装当前主包与平台包，无全局 Bun/源码 PATH 的服务回归、缺少平台依赖诊断及卸载保留数据均通过，测试服务正常清理。
- 验证偏差：初次 `.dev-smoke/agents-TW44WK/evidence.json` 因脚本改写 HOME 导致 iclaude 包装器找不到其 settings，版本查询 failed；cleanupErrors=[]。改为保留工具用户 HOME，仅将原生配置目录及 Runweft 数据放入专用目录后通过。未复制凭据或运行模型。
- Commit：`agent-definition T3: verify packaged definitions and document configuration workflow`

## 需求验收映射

| 验收项 | 实现与证据 |
| --- | --- |
| 定义、发现、选择与原生默认 | init/list/show/validate/check；文件测试、两种 runtime 编译验收 |
| 全局/项目来源与资源独立 | 整体覆盖、显式 scope、home 边界、项目文件不改写与 Hub 客户端无资源库断言 |
| 不自动调度、业务 skill 选择 | 定义接口只有读取/绑定/目标查询；原生会话列表前后相同 |
| cwd、继承与验证边界 | 显式 sourceCwd/projectRoot、worktree 实验、最小 HAPI launchOptions；不覆盖原生 home、权限或工程指令 |
| 无集中 skill/MCP 或权限管理 | 严格字段校验拒绝这些设置；只传 Runweft MCP 禁用字段 |
| 个人绑定隔离与解除 | SQLite/API 组合及真实 HAPI namespace 后缀、同 URL 的 local/hub 隔离 |
| 快照、版本与无任务副作用 | JSON 序列化、文件变更不改变旧快照、探测时间不改版本；重启版本保持 |

本 Change 的验收不包含实际模型参数支持或远端机器执行；前者已列入委派生命周期，工作区加载由对应消费者验收。完整协作版本尚未完成。
