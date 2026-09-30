# Hub 后台与 Agent 接入执行记录

## 执行环境

- 主执行者：TraeX 会话 `01a0f3d9-1ed7-7b33-a2f6-146c5e371e55`，模型 `GPT-6-Astra`（用户指定 `gpt-6-astra`），推理等级 xhigh；已核对本机会话 turn_context，不用继承的 CODEX_SESSION_ID 代替当前会话。
- 工作区：`/home/tiger/workspace/runweft`，分支 `codex/cli-foundation`，起点 `374750b`，开始时干净；前执行者已经停止修改。
- 约束：仅本地专用数据与认证副本，不 push、不公开发布、不更新在线 Hub/Merlin，不编辑用户原生配置。

## 方案与评审

正式 Technical/Plan 已形成。iclaude 会话 `473c7abd-7500-4926-ae02-d428e3f7fe0a`，495 秒，只读评审完成；完整结果 `.dev-smoke/reviews/hub-console-onboarding/review.json`。

独立核对后采纳：空间/成员/邀请统一服务端 permissions、资源全局探测与空间视图分开、共享 runtime 禁止任意终端输入、用户空间 JWT 再交换不得改空间/延长期限、拒绝外部 Hub 重定向、本人任务详情与 CLI 维护说明、Skill 的实际安装/更新范围、后台拆成小任务。HAPI localStorage 跨标签覆盖不作为可接受产品行为，改为原生 HTML 注入窄存储适配，使用标签页 sessionStorage；不改 HAPI 源码。JWT 原样返回避免临期刷新产生新 token 循环，长任务审批到期需回 Hub 重开。前端使用独立 ES modules 的内嵌静态路由，不引入框架。

接手基线：`bun run typecheck` 与 `bun run test` 通过，249 pass / 0 fail、5144 断言、38 文件；日志同评审目录的 baseline 文件。没有以设计草案代替正式方案，也不重开第五阶段。
