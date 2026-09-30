# Hub 后台与 Agent 接入执行记录

## 执行环境

- 主执行者：TraeX 会话 `01a0f3d9-1ed7-7b33-a2f6-146c5e371e55`，模型 `GPT-6-Astra`（用户指定 `gpt-6-astra`），推理等级 xhigh；已核对本机会话 turn_context，不用继承的 CODEX_SESSION_ID 代替当前会话。
- 工作区：`/home/tiger/workspace/runweft`，分支 `codex/cli-foundation`，起点 `374750b`，开始时干净；前执行者已经停止修改。
- 约束：仅本地专用数据与认证副本，不 push、不公开发布、不更新在线 Hub/Merlin，不编辑用户原生配置。

## 方案与评审

正式 Technical/Plan 已形成。iclaude 会话 `473c7abd-7500-4926-ae02-d428e3f7fe0a`，495 秒，只读评审完成；完整结果 `.dev-smoke/reviews/hub-console-onboarding/review.json`。

独立核对后采纳：空间/成员/邀请统一服务端 permissions、资源全局探测与空间视图分开、共享 runtime 禁止任意终端输入、用户空间 JWT 再交换不得改空间/延长期限、拒绝外部 Hub 重定向、本人任务详情与 CLI 维护说明、Skill 的实际安装/更新范围、后台拆成小任务。HAPI localStorage 跨标签覆盖不作为可接受产品行为，改为原生 HTML 注入窄存储适配，使用标签页 sessionStorage；不改 HAPI 源码。JWT 原样返回避免临期刷新产生新 token 循环，长任务审批到期需回 Hub 重开。前端使用独立 ES modules 的内嵌静态路由，不引入框架。

接手基线：`bun run typecheck` 与 `bun run test` 通过，249 pass / 0 fail、5144 断言、38 文件；日志同评审目录的 baseline 文件。没有以设计草案代替正式方案，也不重开第五阶段。

## T1 服务端能力与原生页面交接

- 结果：空间 permissions 统一描述改名/邀请角色/成员角色/撤销/最后 owner；任务 GET details 按用户/空间读取既有 detail 投影，报告分页、轮次、配置和成果复用，不要求浏览器伪造父宿主。
- 结果：原生登录接受当前空间用户 JWT 原样再交换，不改空间、不延长到期；拒绝无空间/机器/任务 JWT。静态只新增文件深链接，拒绝外部 Hub 参数；原生页注入标签页登录键适配，不写长期 token 或跨标签 localStorage，过期返回 Hub。后台打开行为与浏览器实测在 T4 完成。
- 结果：Socket 交互 terminal 要求同时拥有 session 和机器，并在持续连接/输入/输出核对执行策略；agent-terminal 输入走受管任务控制门禁，共享 runtime 不授予 shell。
- 验证：typecheck、build、diff-check 通过；22 pass / 0 fail、255 断言，覆盖直接越权、管理员/最后 owner、JWT scope/期限/撤销、详情分页与终端策略。初次测试预期终端静态 404，实际按既有网关规则 403；修正测试后通过，未放宽授权。日志 `.dev-smoke/reviews/hub-console-onboarding/t1-{tests,build}.log`。尚未声称真实原生 UI/PTY 已验证。
- Commit：`hub-console-onboarding T1: expose authorized console views and scoped native access`。

## T2 后台外壳与机器/Runtime

- 结果：内嵌 ES module 静态路由、统一资源导航、机器/runtime 完整管理表单和共享/治理确认、实际工具探测、全局本人探测 JWT 与当前空间 JWT 分开且只在内存。成员操作改用 T1 领域权限；退出/刷新清空旧资源，Hub 提供当前 origin 的 Agent 接入说明。
- 验证：typecheck/build/diff-check 通过；24 pass / 0 fail、514 断言。已有加密连接 Playwright 5 组再次通过，证据 `.dev-smoke/hub-connect-XvCyry/evidence.json`。
- 真实浏览器：`scripts/smoke-hub-console.ts` 使用编译 CLI、专用 HAPI/Runner、真实 Codex 工具探测，3 组通过；加密接入、机器改名、runtime 登记/分享/停用/恢复、最后 owner 和退出清空全部核对。证据 `.dev-smoke/hub-console-RdO1wb/evidence.json`，success=true、cleanupErrors=[]；桌面与 390px 截图人工视觉核对，无水平溢出。没有调用模型，不声称执行已就绪。
- Commit：`hub-console-onboarding T2: build resource console and machine runtime management`。

## T3 Agent、仓库与本人选择

- 结果：完整 Agent 表单、版本条件更新与历史、指定成员/全空间分享、登记和管理员概要治理；仓库名称/别名/登记与本人 checkout 只读；个人空间/仓库选择、Runtime override、显式解析和清除。失效选项保留原 ID，不静默替换或回退。
- 结果：Agent/仓库创建保留标签页请求 ID 与内容摘要；网络响应不确定先查回执，同一内容显式重试沿用请求 ID，切换页面后仍可查询，不保存业务指令副本。
- 验证：typecheck、build、diff-check 通过；16 pass / 0 fail、268 断言。扩展现有 compiled CLI + HAPI/Runner Playwright，共 8 组通过，证据 `.dev-smoke/hub-console-urmu1Q/evidence.json`，success=true、cleanupErrors=[]。覆盖创建丢响应、完整编辑、并发版本冲突、历史、私有数据不可见、管理员不能改私有定义、个人选择隔离、真实目标解析、分享撤回、仓库失效不回退及显式恢复。没有模型调用。
- 视觉与返修：已查看桌面 Agent 与 390px 个人选择截图，无水平溢出。初次 smoke 因 select 的隐含名称包含 option 文本而超时；补显式 aria-label 后重跑通过，失败证据 `.dev-smoke/hub-console-wjvOCu/evidence.json` 保留。
- Commit：`hub-console-onboarding T3: manage central agents repositories and personal selections`。
