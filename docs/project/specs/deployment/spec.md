# 配置、部署与数据

## 配置

默认数据根为 `~/.runweft`，全局 `--home` 优先于 `RUNWEFT_HOME`。配置文件为根目录下的 `config.yaml`；不存在时使用本地默认值。

`init` 生成带说明的配置并保留已有文件。`config path/show/check/set` 分别定位、展示、校验和编辑配置；展示每项生效来源，编辑保留注释，无效编辑不覆盖原文件。优先级为字段环境变量、YAML、默认值；未知字段、重复键、无效值和不完整 Hub 地址明确报错。地址不接受凭据、路径或查询参数。

配置包含 `schemaVersion`、`mode`、`server`、`hub` 和可选 HAPI 程序路径。字段及环境变量见[使用说明](../../../usage.md#配置)。模式切换不迁移任务、身份或数据，也不替用户停止旧连接。

## 服务模式

| 角色 | 行为 |
| --- | --- |
| 本地 | `start` 管理本机 Runweft 入口、原有 HAPI Hub 和默认启用的 Runner；入口默认 `127.0.0.1:3210`，无需另部署共享 Hub |
| Hub 服务端 | 保留 local 配置，通过 `serve --public` 前台部署；必须配置公开 URL，默认 host 对外监听 `0.0.0.0`，可禁用本机 Runner |
| Hub 客户端 | `mode: hub` 连接指定 Runweft 中心；`start/stop/restart` 仅管理本机当前连接的原生 Runner，不关闭中心 |

HAPI Hub 只监听本机私有端口，省略端口配置时自动选择。Runweft 单地址转发 HAPI 的 HTTP、SSE、WebSocket；自有接口位于 `/api/runweft/`。普通 HTTP 响应结束后关闭连接，SSE 保持流式传输。

本地重复启动保持同一服务。停止依据本机服务记录和 health 的 instanceId 确认归属，再发送信号。前台信号关闭本次托管 Hub/Runner；意外退出明确报错，不自动替换或无限重启。停止 Runner 不等于终止其启动的所有模型会话，原生会话管理仍由 HAPI 负责。

`status` 显示角色、地址、HAPI/Runner 状态及运行/安装版本。`doctor` 检查配置、程序版本、服务、认证和当前连接的本机 Runner；明确禁用 Runner 不算故障。纯 HAPI Hub、离线服务或兼容版本不匹配会被报告，不回退到别的中心。模型登录状态标为未检查，不把机器在线当作模型可用。

## 认证与原生环境

原生协作入口的身份和登录沿 HAPI；Runweft 原有资源/委派路由验证同一 HAPI JWT 的用户和 namespace。Hub 令牌优先取指定环境变量，再取当前连接保存的 HAPI settings。本地令牌来自托管 Hub 配置。

另有 `/hub` 的独立[身份 token](../identity/tokens/spec.md)与[空间](../spaces/membership/spec.md)入口，无需注册服务。新旧凭据互不通用，独立身份当前不授予原生执行/委派权限。

`auth login/status` 配置和核对当前连接，`auth login --token-stdin` 接受标准输入。`auth token` 只在交互终端显式展示；普通状态、配置、JSON 和日志不包含令牌。`open` 默认打开[协作看板](../dashboard/subagents/spec.md)，`--hapi` 打开原生 HAPI；两者共用 HAPI 登录。

托管 HAPI 的部署目录、数据库、地址、令牌、CORS 与 Runner handoff 环境由 Runweft 设置，忽略冲突的外部部署值；托管 Runner 禁用版本 handoff。其他环境和原生模型 home 继续继承，不自动改变模型凭据、默认权限或添加审批绕过参数。

## 数据归属

`paths` 输出实际位置和备份提示。相对数据根：

| 位置 | 用途 |
| --- | --- |
| `config.yaml` | 可编辑全局配置 |
| `agents/` | 全局 Agent YAML；项目定义保留于对应项目目录 |
| `server/hapi/` | 托管 Hub 的原有数据库、令牌和状态 |
| `server/hapi/artifacts/` | 所托管中心的持久文件字节；Hub 客户端从中心读取 |
| `server/runweft/state.sqlite` | 中心机器/runtime、任务与成果关联，以及独立身份 token 摘要、空间/成员/邀请、执行授权与请求映射、中心资源归属/关联/分享/治理；schema v12、WAL 和事务迁移，不保存模型凭据或身份 token 明文 |
| `connections/local/hapi/` 或 `connections/<主机名>-<URL hash>/hapi/` | 当前机器 Runner 的连接身份、配置与原生日志 |
| `connections/<连接>/hapi/workspaces/environments/<环境ID>/` | 独立任务或诊断 checkout、树外输入与准备/成果/操作回执；持久数据，不是缓存 |
| `connections/<连接>/hapi/workspaces/repositories/` | 来源共享 Git/子模块/LFS 缓存；保护成果与活跃消费者，不按空闲时间删除 |
| `connections/<连接>/hapi/workspaces/exports/`、`imports/`、`fetches/` | 基线/成果导出、导入及取回操作和清单回执；成功交付的中间副本释放，未交付候选保留 |
| `connections/<连接>/hapi/artifact-transfers/` | 机器输入下载副本、持久操作回执及未交付的输出候选 |
| `client.sqlite` | 本机工作区与 Agent 个人 runtime 绑定及 Claude MCP hook 的短期调用身份 |
| `logs/` | 服务日志，由部署方管理保留和轮转 |
| `backups/mcp/` | 显式 MCP 配置修改前的快照，可能含原配置秘密，仅当前用户可读写 |
| `cache/`、`tmp/` | 可再生内容，不能保存唯一成果 |
| `server/process.json` | 托管服务定位信息，正常停止后移除 |

Hub 客户端不保存权威资源库；paths 明确指出登记位于中心，备份资源须停止中心后保留其业务库与尚存 WAL 文件。全局范围见[资源范围](../resources/scope/spec.md)。

paths.taskWorkspaces 指向当前连接的本机环境根。doctor 的 task_workspaces 检查只读统计实际 checkout 目录（含失败准备现场），即使中心离线仍可取得本机数量；读取失败明确报告错误，不推断零目录或成功任务数，不统计其他连接/机器。同时显示仓库 caches/exports/fetches 路径和 result release → workspace remove → artifact prune/remove 清理顺序；具体状态通过 task list/show 查询。

任务协调器复用 serve，CLI/MCP 无需再安装独立 daemon。业务表及请求恢复见[委派生命周期](../delegation/lifecycle/spec.md)；schema v12 保留资源、任务、文件、基线/导入/消费者/诊断、代码清单与取回表，并保存独立身份/空间和执行通道授权；交付/释放进度归原 round，不改 consumer.importId 或重写旧行。遇到更高版本明确拒绝，不自动删除数据或降级。

远端准备继续使用同一服务和数据根；paths 展示 exports/imports/repositories/fetches，具体归属与释放见[远端工作区](../remote-workspace/spec.md)。中心 recovery pin 保护的文件与业务清单需一起备份，目标 cache 和环境分别保留，不能把 exports/imports 全目录当作可随意丢弃的临时文件。

server.artifacts 配置本机托管服务的大小、配额和期限，Hub 客户端以中心 limits 为准。paths/doctor 展示文件根、用量和恢复/清理提示，见[留存](../artifacts/retention/spec.md)。二进制接口流式转发，Hub body ceiling 随 maxFile 提高；反向代理须同时允许对应体积、关闭请求/响应缓冲且不另加总传输时限。备份/恢复覆盖中心数据库、字节、业务清单以及机器上未交付候选，不能只回退数据库或删除 spool。

Codex/Claude 配置和历史仍沿各自原生位置；已有 HAPI 数据不自动搬迁，工作区留在原处。停止后备份数据根及相应原生数据，恢复使用兼容版本；不承诺任意版本间回退。

独立 worktree 还依赖源仓库 Git common directory、对象与保留引用。备份前完成轮次停止/封存，再停止服务，并保存源仓库、Runweft 数据及所需原生历史；仅复制 checkout 或数据根不完整。当前不提供自动路径迁移，按原路径恢复后检查 Git 注册。卸载保留数据，工作区显式清理保留成果 refs；引用维护和迁移限制见[使用说明](../../../usage.md#数据升级与诊断)。

独立集中资源组件的机器接入记录位于 `connections/<name>/machine.json`（0600），客户端原子保存 active/pending，短期协调使用既有 client.sqlite 而不复制凭据。新 Hub 域 CLI 必须显式指定 URL，默认服务切换仍属于后续迁移；见 [Hub 资源归属](../resources/ownership/spec.md)。
