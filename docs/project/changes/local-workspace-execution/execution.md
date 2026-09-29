# 本地独立工作区执行记录

## 一次 Plan 评审与主审采纳

- 评审：当前工作区 iclaude，2026-09-29 17:00–17:13（Asia/Shanghai），原生会话 `51ac8656-8cab-43a7-aeb9-703bd8ae55dc`；只读退出 0，result success，无额度错误。原始结果 `.dev-smoke/reviews/local-workspace-execution/review.md`；未启动第二次评审或替代 agent。
- 结论：评审列出五项需先补齐的契约，整体职责和 T1–T5 顺序保留。采纳准备引用穿透 schema/指纹/HTTP/RPC/Runner/调用层、删除 checkout 后拒绝自动 mkdir、耗时 Git 快速受理与 inspect、以操作 trailer 对账 checkpoint、明确 Git 超时/签名失败及手工修复后的收尾路径。
- 提前验证：T2 增加两 runtime 的第二轮真实续接，以及工程指令/项目 MCP/路径信任证据；不等完整 MCP 矩阵阶段才发现新路径加载差异。
- 状态与数据：采纳 Task 环境持久更新、事务性 next/remove 互斥、preparing/finishing、不把 Git attention 当原生执行失败、finishing 不伪造中断，以及保留环境的发现/备份说明。
- 独立判断：已绑定受控环境的 HAPI resume/clear 也必须消费当前有效准备，不能因省略参数绕过；未采纳“让这些受控会话沿旧无约束恢复”的建议。普通 HAPI 会话和原生内置子代理不增加控制，这是准备一致性而非新的权限隔离。
- 独立核对：hook 可以改变候选树，因此采纳 parent/trailer/身份/clean 事实对账；签名改变 commit 对象，不把它误写成必然改变 tree。post-checkout hook 报错保留已创建现场并报告失败，不因 HEAD 存在就跳过 hook 错误或换目录重建。
- 子模块：补做专用 Git 实验确认 init 对共享 config 的影响及单次配置的可行路径，见 [Research](research.md)；T1 继续验证相对 URL/递归。采纳新增 index gitlink 检查和可用本地对象复用，不把 file 源实验称为远端凭据验证。
- 未采纳的可选项：retry-finish 保留固定 round 参数，避免多轮竞态；不新增“已合入”推断字段，合码/接纳仍属主 agent；baseRef 缺省规范为 HEAD、prepare 提前核对 roots、Git/LFS 命令诊断纳入现有任务。
- 确认：用户已授权自主细化/验收，主 agent 采用修订后的 Requirement/Technical/Plan；评审结束时仅完成调查和规划；后续实现见逐任务记录。


## T1 HAPI 独立 Git 生命周期与准备启动校验

- 结果：机器接口提供 resolve/prepare/inspect/finalize/remove，保存固定基线、自有 worktree、异步操作与成果引用。准备引用贯穿 schema/指纹、HTTP/RPC、Runner、原生 bootstrap metadata 和 Runweft start/resume；失效或丢失目录在启动前拒绝，默认 mkdir 不会重建 checkout。原生 runtime adapters 未修改。
- 结果：收尾保留 agent 提交、使用明确机器身份 checkpoint，遵守 hooks/签名且不提交空改动；原生停止事实与 Git 成果分开。Git 超时停止自有进程组，重启只对账已知结果，不重跑未知 hook；确认退出的中断可显式重试。清理检查子模块及 ignored 内容，保留 base/round refs。HAPI clear 不能绕过受控轮次；普通会话/原生子代理行为保持原有边界。
- 验证：15 个真实 Git 专项通过，涵盖固定子目录基线、主目录/index 不变、幂等与缺失 checkout、格式化 hook/已有提交、签名/index 锁失败、超时及手工修复、丢 checkpoint 响应、重启中断、外部输入变更、新 gitlink、子模块递归/相对 URL/共享 config、本地 LFS 和 ignored 清理；与 machine RPC 参数用例共 44 项通过。最后一次 Git 专项记录 `.dev-smoke/workspace-t1-final-git.log`。
- 验证：HAPI 跨包 typecheck 通过；Hub 1393、Web 3249、Shared 323、Relay 118 项通过；`bun run gen:fixtures` 生成 88 个 fixture 及模式目录，无 Git 差异。CLI 全套运行结果 2980 通过、11 跳过、1 项失败：未改动的 `skills.test.ts` 非 Git 场景因既存 `/tmp/.git`（2026-09-14）读取到父级 skill，单独重跑同样失败；未删除该外部目录，未把全套标成通过。Runweft 类型检查与 85 项/1509 断言通过。
- 真实编译验证：配套 HAPI Linux x64 二进制通过专用 home 的 Hub → machine RPC → Runner 链路，Codex/Claude 均真实启动、回答固定标记并停止；随后测试操作者在已停的专用 checkout 写入 fixture，HAPI 自动封存。验证 metadata 关联保留、旧准备的无参数 resume 拒绝、缺失目录启动 childStarted=false，未改变主目录。初轮证据 `.dev-smoke/workspace-http-n81aoG/evidence.json`；固定 revision 后 `bun run build:hapi --platform linux-x64 && bun run build` 成功，`bun scripts/smoke-workspaces.ts dist/runweft dist/hapi` 再次通过，最终证据 `.dev-smoke/workspace-http-LIxpEG/evidence.json` success=true、sourceLauncher=false、cleanupErrors 为空。这里不把操作者写文件说成模型编辑，真实开发/第二轮原生续接属于 T2。
- 真实传输验证：专用 HTTP 代理丢弃 prepare 受理响应；慢 post-checkout hook 仅执行一次，inspect/同身份重交命中原结果，Runner 重启后回执仍在，未启动 worktree 可移除且保留 base。证据 `.dev-smoke/workspace-http-tDIaBW/evidence.json` success=true，cleanupErrors 为空。原始实验保存在 `.dev-smoke/workspace-transport.ts`。
- 偏差：remove 使用独立 attemptId，支持 ignored 拒绝或部分删除修复后的显式重试；Git submodule update 实际提供 --reference，没有 --reference-if-able，因此仅在本机引用目录有效时传入 --reference。原生 bootstrap 接管预分配会话和客户端 metadata 更新也须保留 Hub 管理的准备引用，已加回归。
- 交付边界：本任务完成 HAPI 机器能力和 Runweft 调用参数；CLI/MCP 的 worktree 模式、中心准备/收尾状态和发布包完整交付继续由 T2–T5 承担。初轮用源码 Runweft 编排服务，最终复核使用编译 Runweft 与 HAPI；尚未做本 Change 的安装包整体验收或远端验证。
- Commit：`local-workspace-execution T1: add managed Git workspaces and prepared execution gates`（HAPI）；`local-workspace-execution T1: pin verified workspace lifecycle and execution calls`（Runweft）。

## T2 编译 CLI 独立协作与基本续接

- 结果：CLI `task spawn --workspace-mode worktree --base <ref>` 在接受时固定 Git commit，中心持久化环境与每轮准备引用，准备完成才启动；续轮使用前轮成果 HEAD、原 cwd 和原生 session。原有 shared 默认行为保留，无版本字段的旧任务仍可读取/续接。Task JSON 增加版本标记，环境变更与轮次按当前 revision 一起保存。
- 结果：新增 preparing/finishing、成果 SHA/ref/checkpoint 与路径查询；独立任务先停止原生执行，再由 HAPI 封存，wait 和后续轮次等待封存成功。Git 错误作为 workspace attention 保留原生结论及报告；`task retry-finish <id> --round <id>` 只重试收尾，finishing 的 interrupt 不伪造取消。HAPI 直接错误响应的修复 hint 也传到 CLI。
- 验证：`bun run typecheck`、`bun run build` 通过；`bun test ./test` 共 91 项、1618 断言通过。最终工作区专项 6 项通过，覆盖旧 shared 记录、无效基线诊断、慢准备/丢受理响应、准备失败不启动、收尾阻塞 wait/续轮及显式重试。这里使用真实中心 SQLite/HTTP 与 HAPI 协议 fixture，实际 Git 证据见 T1 和下述编译 smoke。
- 真实编译验证：Codex 原生会话 `01a0eca5-4283-7f21-9417-d2371966f553`，Claude 原生会话 `1cf62b85-d525-4040-ab92-bb428ea2e199`，均由编译 CLI 派生、实际写入 fixture，自动 checkpoint 后第二轮追加内容；同 cwd、原生 session ID 与记忆标记证明 native resume，没有重建历史。成果 ref 可从主仓库读取；两轮结束后对应执行 PID 均退出，主目录脏文件、HEAD、index 保持原样。同 request ID 重试返回原接受结果。
- 原生配置：版本化 AGENTS.md/CLAUDE.md 与工程 skill 的独立标记均出现在报告中，两个 runtime 均实际调用项目 project_probe MCP。验收复制既有原生配置/登录到专用 home，仅移除专用副本中的无关 MCP；未修改用户配置，也未添加路径信任或项目 MCP 允许项。Codex 使用已有父路径 trusted 配置，Claude headless 原生加载项目 MCP；本结果不宣称新路径可以绕过用户的信任策略。权限保持原生默认，通过现有 CLI 响应专用 fixture 的写入和只读 Git 请求。
- 真实收尾故障：Claude 首轮配置专用失败 pre-commit hook；模型成功后保持 stopped/finishing，report 与原生 completed 事实保留。修复 hook 并用编译 CLI retry-finish 后封存成功，输入记录和报告与失败时一致，未重发任务；后续轮次正常续接。证据 `.dev-smoke/worktree-tasks-7jLhwP/evidence.json` success=true、cleanupErrors 为空。
- 证据范围：Codex 两轮检查在 `.dev-smoke/worktree-tasks-WkTpPF/evidence.json` 的 codex case 已通过；该次脚本随后因 Claude 只读 Git 审批范围遗漏退出，不把整次运行算作成功。Claude 单独补测通过；另一失败 fixture `.dev-smoke/worktree-tasks-Aun6qs` 同属测试审批范围问题，两次均正常停止专用服务。脚本补齐只读检查，其他请求保留待审状态而不提前杀掉任务；最终运行的两项只读 Git 请求由主 agent 用 CLI 批准。汇总 `.dev-smoke/workspace-t2-evidence.json`，测试/构建日志 `workspace-t2-{final-tests,state-final,types-final,build-final}.log`，均在 `.dev-smoke/`。
- 交付边界：本任务完成 CLI 的独立任务基本闭环；取消/启动失败后的跨轮处理、重启对账和显式删除由 T3 完成，MCP base/retry_finish 与完整矩阵由 T4 完成，候选包和完整 Change 验收仍属 T5。没有修改 HAPI pin，也没有声称跨机器验证。
- Commit：`local-workspace-execution T2: add CLI worktree tasks and sealed round results`。
