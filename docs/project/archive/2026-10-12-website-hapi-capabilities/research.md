# 已开放能力核对

以 Runweft main `4c81986`、固定 HAPI `8f774b94` 为本次文案事实基线；下列为源码和既有验收规格核对，本次不重新执行模型。

| 可介绍内容 | 依据与必要边界 |
| --- | --- |
| 原生工具执行与配置 | `specs/execution/lifecycle`、`specs/agents/inheritance`、`specs/host-mcp`：复用 HAPI 的 Codex/Claude 启动、原生登录、执行机器上的工程指令/Skill/其他 MCP。远端不复制发起机全局配置；受管子执行禁用 Runweft MCP |
| 查看会话过程 | `src/hub/tasks-page.ts` 打开原生详情；`src/hub/access/http.ts` 允许 session/messages，SSE 按归属传递；消息、工具调用与审批组件由 HAPI Web 提供 |
| 浏览器审批 | `src/hub/access/http.ts` 允许 permissions approve/deny，`src/hub/delegation/service.ts` 的 sessionPolicy 不拒绝审批；任务详情已有“打开原生详情 / 审批”。手机须能连到部署的 Hub，localhost 不能供另一设备直接访问 |
| 文件及差异 | `src/hub/tasks-page.ts` 原生文件入口；网关允许 git-status/git-diff-numstat/git-diff-file/file/files/directory；`hapi/web/README.md` 的文件列表/查看器提供 staged/unstaged diff 和语法高亮。需要执行机器可用，静态成果查看不冒充实时文件访问 |
| 会话留存与续接 | `specs/execution/recovery`、`specs/delegation/rounds`：每轮结束关闭执行进程，保留历史和工作区；后续优先原生 resume，启动配置变化或确认会话缺失时重建。受管任务 messages/resume/模型修改须走 Runweft，不能宣传浏览器任意接管 |
| 自托管 | `specs/deployment`：Hub 部署在自己的机器/服务器，模型请求仍由原生工具处理，不等于代码绝不发送到模型服务 |

HAPI README 还介绍全部 runtime、iOS/Android、Telegram、语音、推送、relay、Web 终端等；Runweft 当前默认网关和两 runtime 范围不支持将它们整体当作产品承诺。只选择已开放的用户场景，不在官网堆叠未接通功能的排除清单。

## Plan 评审后的定向核对

- 文件/diff：`hapi/hub/src/web/routes/git.ts` → `rpcGateway.sessionRpc`，必须有该 session 的在线 RPC handler；仅 Runner 在线不够。文案限定执行期间/会话在线；完成后经 Runweft 取回成果在本机审查，Hub 历史与实时文件区分。
- 审批：Runweft 不传权限覆盖；Claude 默认 permissionMode=default，Codex shared launch 未显式选择权限模式时沿原生配置。是否出现请求取决于原生权限策略。`coordinator.ts` 收到请求设置 permission_required，wait 返回需处理；不保证每项任务产生审批，不等于后台推送。
- 手机：用能访问的 Hub 地址，在浏览器导入自己的既有身份并选同一空间。localhost 仅本机；现有公开部署要求 HTTPS 反向代理与 server.publicUrl，不推出新的自动隧道方案。
- 输入：HAPI SessionChat 仍提供 composer，Runweft 网关拒绝受管任务直接 messages/resume/模型修改，返回 managed_task_control_required。指南直接指向主 Agent 的 Runweft 续接路径，不承诺网页无缝接管。
- 入口：Hub 默认任务页 → “查看任务详情” → “打开原生详情 / 审批”或“打开原生文件”。短期标签凭据到期回 Hub 重开。
