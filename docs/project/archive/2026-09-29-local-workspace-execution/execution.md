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

## T3 跨轮次复用、失败处理与显式清理

- 结果：准备期间取消等待原 Git 回执后封存，不为收尾启动模型；明确启动拒绝同样先封存该准备，再允许下一轮。HAPI 从自身 launch 记录核对未启动/明确拒绝，已有或未知执行仍要求 session 身份和停止证明。中心将未启动与未观测区分，失败准备不虚构模型结论。执行取消的部分成果只在停止确认后封存，续接核对本轮准备关联。
- 结果：`task workspace remove <id>` 事务性检查全部轮次并标记 deleting，与 next 互斥。删除身份/选项持久化，重复命令和中心重启查询原操作；已确认失败才允许显式新尝试。默认保留 ignored 内容，错误提供 `--discard-ignored` 的确切命令。成功删除保留报告、原生历史和成果引用，后续 send 拒绝重建；共享目录及 MCP 清理入口拒绝。
- 验证：中心工作区专项 14 项通过，覆盖准备取消、启动拒绝、停止未知、删除/send 并发、丢封存/删除响应、重启不重放、失败准备按 base 删除和 ignored 明确处理；最终与 shared/轮次回归合计 31 项、698 断言通过。`bun run typecheck`、配套 HAPI/CLI 构建及最终 `bun test ./test` 99 项、1758 断言通过。日志 `.dev-smoke/workspace-t3-{center-final,root-tests-final,root-types-final,build-hapi,build-cli-final}.log`。
- HAPI 验证：真实 Git 专项 16 项通过，新增未启动/明确拒绝准备封存与拒绝省略已有执行身份；已有 agent 提交、补 checkpoint、无改动、异常对账/清理用例继续通过。跨包 typecheck 通过；Hub 1393、Web 3249、Shared 323、Relay 118 项通过，88 个 fixture 与模式目录重生成无差异。完整 CLI 2984 通过、11 跳过、1 失败，仍为 T1 记录的未改动 skills 非 Git 用例受既存 `/tmp/.git` 干扰，不标记整套通过。
- 真实编译验证：`bun scripts/smoke-worktree-lifecycle.ts` 继续 T2 的专用 Codex/Claude 任务，服务重启后第三轮均使用原 native session 并记得此前标记；ignored 依赖文件仍可读取，目录无代码修改时 resultHead 不变、无空 checkpoint，执行 PID 退出。主目录 HEAD/index/脏状态在只读轮次保持原样；同仓库另建任务的慢准备期间，测试操作者推进主分支并取消任务，新任务仍使用接受时基线，没有发送模型输入，两个目录独立。
- 真实清理验证：两 runtime 的保留环境均因 ignored 依赖拒绝删除；服务重启后拒绝记录仍在，显式 discard 后 checkout 消失，既有三轮成果 ref 均可从主仓库读取，报告保持原样，新 send 拒绝。取消任务也可显式清理且保留 ref。证据 `.dev-smoke/worktree-lifecycle-8MY0gf/evidence.json` success=true、cleanupErrors 为空，使用本任务固定的 HAPI revision。
- 无成果现场验证：专用 post-checkout hook 明确失败，编译 CLI 显示 execution_not_started、native not_started、Git not_prepared，无 session/结果 ref，但自有 checkout 留存；显式删除按 base 检查并移除目录，base ref 仍可读。最终证据 `.dev-smoke/workspace-unused-xnFFPR/evidence.json` 通过，原始实验 `.dev-smoke/workspace-t3-unused.ts`；未启动模型，已恢复 fixture Git 设置和停止服务。
- 偏差：T3 补充了 T1 缺失的“已准备但未启动”封存路径，否则取消会永久挡住环境复用；已同步 Technical/工作区契约，沿既有自主细化授权实施，不重复 Plan 评审。无新增 runtime adapter、清理服务或全局配置。
- 交付边界：本地 CLI 的多轮与显式清理闭环已完成；MCP base/retry_finish、两宿主完整矩阵和候选包交付继续由 T4/T5 承担，尚未归档整个 Change。
- Commit：`local-workspace-execution T3: seal prepared rounds with no execution`（HAPI）；`local-workspace-execution T3: retain and safely remove task workspaces`（Runweft）。

## T4 两宿主 MCP 独立协作与原生配置验收

- 结果：MCP `spawn_agent` 支持 `base_ref`，与 CLI 共用固定基线和准备流程；shared 拒绝附加基线。`read_agent`/`wait` 描述明确区分原生执行与 Git 封存；新增 `retry_finish` 只显式重试指定轮次的 Git 收尾，沿既有父身份校验，不发送模型输入。环境删除仍由操作者 CLI 发起。
- 回归：抽取公共工作区协议夹具，新增两宿主固定基线、请求冲突、父权限、原生报告保留、失败修复与续接测试；共享/独立模式均覆盖取消等待和 stdio 断线后中心只收尾一次。MCP/工作区专项 19 项、564 断言通过；完整 `bun test ./test` 100 项、1896 断言通过，`bun run typecheck` 与编译 CLI 构建通过。首次全量检查发现两处工具列表预期遗漏 `retry_finish`，已同步回归与安装脚本目录；最终日志 `.dev-smoke/workspace-t4-{full-tests-final,types-final,build}.log`。
- 真实验收方法：扩展 `scripts/smoke-collaboration.ts` 的可选 worktree 模式，使用配套编译 CLI/HAPI、原生宿主及实际模型。每组从版本化工程指令、skill 和项目 MCP 的旧 tag 派生，主分支已有更新及未提交内容；首轮写文件，停止后补 checkpoint，第二轮只凭原生历史回忆标记。实际核对文件、目录、基线/成果引用、父 HEAD/index/脏状态、MCP 调用及执行 PID；原生父 MCP 调用必须原样传入测试任务，不能替子端注入工程/记忆标记。
- 真实修复：local 的 Codex→Codex、Claude→Claude 首轮分别触发一次失败 pre-commit hook；原生父会话看到 completed 报告与 Git needs_attention 后各调用一次 MCP `retry_finish`。只出现失败/重试两次 hook，报告和输入不变，封存后原 session 正常续接。
- 原生继承：专用 home 复制已有原生配置/登录，仅调整测试副本的 MCP；未修改用户配置或额外批准项目信任。子端实际调用保留的全局及项目探针，报告包含仅在版本化工程指令/skill 中的独立标记。Codex 原生 MCP 目录在启动/续接均无 Runweft 工具；Claude init 目录同时证明其他 MCP 和 Agent/Task 保留。Codex 原生内置递归配置未改变，此验收不声称实际调用过内置子代理。
- Git 合入：测试操作者检查父目录保持原样及本地对象可读后，显式 cherry-pick 返回的成果 ref；无需 push，合入后子 worktree 仍保留。程序收尾不自动合码。
- 真实断线：Hub 的 Codex→Claude、Claude→Codex 在第三轮已接受后主动关闭正在 wait 的原生 MCP 连接；独立操作者仅响应 sleep 审批，中心完成原任务、停止执行并封存。每组只有一次 spawn、三轮各一次输入，无重复派生或取消；断线发生在完成之前。
- 矩阵结果：下列八组全部通过，18 个真实子任务轮次均停止并封存，专用服务/宿主/探针进程退出，cleanupErrors 均为空。汇总 `.dev-smoke/workspace-t4-evidence.json`；各行目录下的 `evidence.json` 保存原生会话、实际调用、Git 与进程事实。

| 模式 | 宿主 → runtime | `.dev-smoke/` 证据目录 | 额外覆盖 |
| --- | --- | --- | --- |
| local | Codex → Codex | `worktree-mcp-E5Ydih` | MCP 收尾失败后重试 |
| local | Codex → Claude | `worktree-mcp-EH3rnv` | 交叉宿主审批与续接 |
| local | Claude → Codex | `worktree-mcp-l5N9on` | 交叉宿主审批与续接 |
| local | Claude → Claude | `worktree-mcp-rmKAmW` | MCP 收尾失败后重试 |
| Hub | Codex → Codex | `worktree-mcp-78FixU` | 独立客户端/中心 |
| Hub | Codex → Claude | `worktree-mcp-CfQmxJ` | 真实等待连接断开 |
| Hub | Claude → Codex | `worktree-mcp-dyaKcg` | 真实等待连接断开 |
| Hub | Claude → Claude | `worktree-mcp-yuUQ3c` | 独立客户端/中心 |

- 交付边界：八组均在同一台 Linux 主机，Hub 使用独立数据目录与 Runner 身份，不称为跨机器验证；本任务未改变 HAPI pin/runtime adapter。候选包、数据留存说明与完整 Change 验收继续由 T5 完成。
- Commit：`local-workspace-execution T4: expose and verify MCP worktree collaboration`。

## T5 候选安装、使用说明与整体验收

- 结果：paths 显示当前连接的本机环境根，doctor 只读统计实际 checkout 目录；离线可取得数量，读取失败明确报错。文档补齐 shared/worktree、固定基线、原生配置继承、Git 收尾修复、成果合入、显式清理和源仓库/数据联合备份。主包附完整使用说明，不新增必填配置或状态库。
- 构建与回归：`bun run typecheck`、`bun test ./test` 100 项通过；固定版本 HAPI 四平台重建、`package --all --reuse-hapi` 和 CLI 构建通过，主包/四平台索引位于 `dist/packages/index.json`。日志 `.dev-smoke/workspace-t5-{types-final,tests,build-hapi,package,build}.log`。
- 安装：`RUNWEFT_SMOKE_WORKTREE_EVIDENCE` 指定两个已完成 T4 专用 fixture，`node scripts/smoke-install.mjs` 通过。实际 npm optional dependency、十工具 MCP 目录、task 的 worktree/base/repair/remove 入口、local/Hub 服务/信号、缺平台诊断和卸载留存验证成功。证据 `.dev-smoke/install-2j1oqH/evidence.json`；运行平台 Linux x64，不把四平台构建称为四平台模型执行。
- 安装后的 Git 闭环：新增可选 `smoke-worktree-package.mjs`，使用安装后的 CLI 读取 local Codex、Hub Claude 的真实已完成任务，显式删除 checkout 后原生报告/轮次数/成果 refs 保留，父 HEAD/index/脏状态不变；在线/离线诊断从 1 个 checkout 变为 0，保留环境记录。未启动模型或重发任务；证据 `.dev-smoke/worktree-package-vC8aSV/evidence.json` success=true、cleanupErrors 为空。原 T4 两个 fixture 的 checkout 已删除，后续不得重放该清理或当作保留现场使用。
- 诊断失败：专用路径被普通文件占用时 doctor 返回带原因的失败，不显示零目录；`.dev-smoke/workspace-diagnosis-7t4xidsg/evidence.json` 通过。安装服务诊断未创建工作区；数据根/原生配置与用户环境分离。
- 整体验收：[逐项映射](acceptance.md)核对全部需求和能力，区分真实模型、真实 Git、HTTP/SQLite fixture、构建与平台范围。T3 的 HAPI 非 Git skills 环境失败仍如实保留；没有新增 HAPI 修改或未清理执行进程。沿用户本地自主验收授权通过本 Change，Specs/归档另作提交。
- Commit：`local-workspace-execution T5: ship workspace diagnostics and verified candidate packages`。
