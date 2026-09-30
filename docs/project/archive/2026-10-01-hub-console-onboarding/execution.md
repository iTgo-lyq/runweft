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

## T4 任务详情与原生页面

- 结果：任务成为默认页，按本人空间查询计数/过滤/分页，详情呈现轮次、配置快照、分页报告、附件与代码、恢复和停止观察，并提供 Agent 后续处理说明。HTML 使用 textContent，不渲染报告内标签。
- 结果：同源新标签先清除复制身份、断开 opener，再交换当前空间短 JWT、检查目标会话并跳转 HAPI 详情/审批/文件。原生脚本同步先加载、存储仅在标签页，不延长 JWT；过期返回 Hub，不自动创建身份。HAPI useSSE 原有 URL token 被窄适配转为 Authorization header fetch 流，保留原生事件/游标/重连处理，不修改 HAPI 源码。
- 验证：typecheck/build/diff-check、21 pass / 0 fail（249 断言）通过。完整后台 Playwright 12 组通过，`.dev-smoke/hub-console-pelKJK/evidence.json`，success=true、cleanupErrors=[]。覆盖 27/1 个任务的本人隔离、筛选/分页/轮次/报告、原生消息刷新、实时 SSE、审批 RPC、文件内容、同一浏览器两身份多标签、API 越权、受管恢复拒绝、共享机器 terminal 拒绝及虚拟时钟到期；已查看任务窄屏与 HAPI 文件截图。
- 验证边界：compiled CLI + 真实 HAPI/Runner；任务历史与原生会话 RPC 为明确的浏览器夹具，无模型或 OS PTY，不替代阶段七真实模型组合。原生页面各类失败均保留证据：tWDFU2 为夹具缺任务绑定；oK9Uaw/NRqhHB 为错误的消息封装；v3z6Ei/xLvnTY 为原生中文按钮选择器。最终修正夹具后通过，未放宽授权。
- 工具偏差：试验 Bun.Transpiler exports.eliminate 在 Bun 1.4.2 触发 panic；没有使用该实验选项，改为移除已知空 default export 后生成同步 IIFE。最终构建与真实浏览器通过。
- Commit：`hub-console-onboarding T4: deliver private task views and scoped native browser handoff`。

## T5 产品 Skill 与 Agent 优先使用路径

- 结果：`skills/runweft` 完整接入/中心配置/委派/维护 Skill，主包和四平台包携带相同内容，另有带校验的独立下载；官网主入口交给 Agent、浏览器确认身份、折叠工程参考，usage/development 移除旧 YAML/root 操作路径。发行索引明确新版产品与源码，官网拒绝旧包。复制安装命令校验失败立即停止，不继续解包。
- 结果：独立场景暴露“新电脑 task CLI 仍需先 enroll”的说明缺口，已补正，第二个全新 Agent 给出正确的 Web 先查/CLI 先登记路径。独立安装验证发现未选 Hub 被误报 HTTPS 错误，修为 `hub_connection_required` 并增加测试；没有改变身份或网络权限。
- 验证：Skill quick_validate、typecheck/build/diff-check 通过；聚焦 16 pass / 0 fail、252 断言，诊断补测 6 pass / 0 fail、108 断言；真实编译空连接诊断 `.dev-smoke/connect-diagnostic-PpicAr/evidence.json`。四平台候选构建成功，主包/四平台内全部 Skill 与源码逐文件一致；这不是最终发行验收。
- 官网：`.dev-smoke/website-HnpBOQ/evidence.json`，success=true，11 组通过；真实下载 Skill/四平台/子路径、校验、错误校验不安装、320–1440px、键盘/复制/无 JS、DOM 原命令 Linux x64 安装。已查看桌面首页和手机指南截图。最后仅平台验证措辞改为构建事实，再构建通过；未部署。
- 独立 Skill 执行：Astra 会话 `01a0f402-c011-7462-80dd-13e0cfee2590`，专用安装/重复更新/卸载，`.dev-smoke/runweft-install-cycle-KC3taFHW/evidence.json`；201 成功断言、12 项最终审计通过，其他 MCP/hooks/模型配置/Skill 保留。保留初次 bwrap 挂载失败、Claude 原生元数据迁移、Codex 尾空白与主程序重建导致 hash 改变的真实记录；固定副本复验通过，不声称完整文件字节全部恢复。未启动模型/Hub、未访问真实配置凭据。
- 独立场景：Astra 会话 `01a0f406-be89-7c33-a4fe-f61379220ba6` 初稿 `.dev-smoke/skill-scenario-initial.md`；修订后新会话 `01a0f40a-7273-7402-a6d9-9bb6ee8440da` 的 `.dev-smoke/skill-scenario-final.md` 正确区分原身份交接、个人 override、旧任务和不确定结果。均仅提供真实场景与 Skill，没有传预期答案；结束后关闭 agent。
- 真实接入/首任务：更新现有 native MCP smoke，改为浏览器主动身份与 begin/complete，不直接写 identity 文件。`.dev-smoke/hub-native-mcp-eZQ9jC/evidence.json`，success=true、cleanupErrors=[]；两宿主 × 两 runtime 四组实际 spawn/wait/read、65 秒等待（65008–65181 ms）、报告、子 CLI 递归拒绝、进程退出。原生权限仅批准专用 helper，未放宽产品默认权限。后续仅新增缺 URL 诊断分支，合法已连接执行路径未改变。
- Commit：`hub-console-onboarding T5: ship product skill and agent-first onboarding documentation`。

## T6 阶段六自动验收

- 结果：完成全部需求到实现/证据映射，见 [Acceptance](acceptance.md)。用户已授权自动本地验收，不重复人工门禁；未遗漏后台领域功能。
- 验证：最终 typecheck/build 通过；根测试 254 pass / 0 fail、5206 断言、39 文件。最终后台十二组、连接五组、服务五组均 success=true 且 cleanupErrors=[]，复核 T5 真实两宿主 × 两 runtime、独立 Skill 安装与官网证据。`test:packages` 旧服务入口仍明确由阶段七更新，未宣称通过。
- 边界：同机多 Runner 不等于物理跨机；Mac 未作实机验证；最终新版四平台必须重新统一构建。未变更在线 Hub/Merlin、用户原生配置，不 push 或发布。
- Commit：`hub-console-onboarding T6: accept complete console and onboarding workflows`。
