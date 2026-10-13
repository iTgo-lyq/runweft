# 委派与成果

在用户的实际工作目录使用 MCP。先 `runweft_status` 和 `list_agent_definitions` 核对 Hub、空间、原生父身份、仓库和执行目标；错误不自动触发新身份或配置回退。

## MCP 主流程

| 工具 | 操作 |
| --- | --- |
| `spawn_agent` | `agent_type` 使用中心 Agent UUID；`message` 描述任务。返回 `agent_id`、`round_id`、`request_id`，尚未完成 |
| `list_agents` | 当前父会话的任务与已接受请求；响应未知时先查询 |
| `wait` | `ids`、`timeout_ms`（默认 30000，最大 540000）；超时不终止任务 |
| `read_agent` | `id`，可附 `round_id`、`offset`、`limit`；按 `next_offset` 读完报告 |
| `send_input` | `id`、`message`；默认 next 排下一轮，Codex 的 steer 需明确活跃 `round_id` |
| `interrupt_agent` | `id`、固定 `round_id`，再读/等确认进程已停 |
| `respond_to_permission` | `id`、`round_id`、原生审批 `request_id`、`decision`，可带 `answers` |
| `retry_finish` | 修复 Git 收尾后重试 `id`、`round_id`，不重发模型 |

同一次调用有稳定请求 ID；另一次新调用可能是新任务。未知响应先查询，必要时保持原 request ID 和完整原参数重试。`unknown` 不等于失败或确切缺失；只有原生确认历史缺失才由系统重建有界历史，不由 Agent 删除索引触发重跑。

每轮关闭进程，保留原生 session 与 worktree。继续任务优先复用；主宿主退出不会自动把旧父身份注入新宿主。CLI 可以用同一 Hub 用户/空间查看维护本人任务，MCP 仍只操作当前父会话任务。新电脑的 task CLI 也要求先 machine enroll，哪怕只是 list/show；仅查看 Web 本人任务则不需要本机登记或 Runner。读取已保存报告无需启动执行，但续接/停止/收尾仍依赖原执行机。

## 工作区

- 本地共享：`workspace_mode: shared`，使用主 cwd，可无 Git，不自动提交或清理。
- 本地独立：`workspace_mode: worktree`，主目录须 Git，`base_ref` 默认 HEAD。
- 远端：必须独立 worktree 和明确 `base_ref`；源/目标机器连接同一 Hub 且 Runner 在线。先固定 Git、初始化工作区、放置输入和上下文，再启动模型。

基线只含已提交内容，不自动包括脏文件、ignored 依赖或主机器全局配置。需要 Git LFS/子模块时先检查工具和对象可用性；依赖由执行 Agent 按需安装。默认沿原生权限，不宣称目录隔离是安全沙箱。

## CLI 维护

```sh
runweft task spawn <agentId> --message "只读检查当前改动"
runweft task spawn <agentId> --workspace-mode worktree --base HEAD --message-file <任务文件>
runweft task list --all
runweft task show <taskId> --round <roundId>
runweft task wait <taskId> --timeout 65000
runweft task send <taskId> --message "继续处理"
runweft task interrupt <taskId> --round <roundId>
runweft task permission <taskId> --round <roundId> --request <原生审批ID> --decision approved
```

`task spawn` 可省略 Agent 使用本人已配置选择；`--runtime` 是本次显式 override。权限审批只在用户已授权范围内处理，不能为跑通验收批准任意操作。Web `/hub` 展示本人任务；从任务页打开受限 HAPI 详情/文件/审批，不手工拼带 token 链接。短凭据到期返回 Hub 重开，不能重新创建身份。

## 文件与代码

先 `upload_artifact({path})`，再在 spawn/next 中声明 `inputs: [{artifactId, name?}]`；`outputs: [{name, relativePath}]` 声明工作区普通文件，每轮独立提供。文件先校验落地，模型不用重复下载。结果通过 `read_agent.artifacts.manifest` 取 ID，`download_artifact({id,path})` 校验保存；MCP 路径限宿主真实 cwd，目录外的显式操作使用 CLI。

```sh
runweft artifact upload <文件>
runweft artifact lookup <原上传requestId>
runweft task spawn <agentId> --message "处理输入" --input <artifactId> --output report.md
runweft task artifacts show <taskId> --round <roundId>
runweft artifact download <artifactId> --output <保存路径>
runweft task artifacts retry <taskId> --round <roundId>
runweft task artifacts collect <taskId> --round <roundId> --path <名称=相对路径>
runweft task result show <taskId>
runweft task result fetch <taskId>
runweft task result retry <taskId> --round <roundId>
```

下载默认不覆盖；retry 只重传固定候选，collect 在静止工作区显式补收，不重跑模型。远端 bundle 在原主仓库取回专用 ref，不自动切分支、merge 或 push。本地 worktree 成果已在同仓库；先审查 diff，按用户授权合入。执行成功、文件可下载、代码已取回、验收通过分别报告。
