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

身份和登录沿 HAPI；Runweft 自有认证路由验证同一 HAPI JWT 的用户和 namespace，不另建账号。Hub 令牌优先取指定环境变量，再取当前连接保存的 HAPI settings。本地令牌来自托管 Hub 配置。

`auth login/status` 配置和核对当前连接，`auth login --token-stdin` 接受标准输入。`auth token` 只在交互终端显式展示；普通状态、配置、JSON 和日志不包含令牌。`open` 使用现有 HAPI 登录入口。

托管 HAPI 的部署目录、数据库、地址、令牌、CORS 与 Runner handoff 环境由 Runweft 设置，忽略冲突的外部部署值；托管 Runner 禁用版本 handoff。其他环境和原生模型 home 继续继承，不自动改变模型凭据、默认权限或添加审批绕过参数。

## 数据归属

`paths` 输出实际位置和备份提示。相对数据根：

| 位置 | 用途 |
| --- | --- |
| `config.yaml` | 可编辑全局配置 |
| `agents/` | 全局 Agent YAML；项目定义保留于对应项目目录 |
| `server/hapi/` | 托管 Hub 的原有数据库、令牌和状态 |
| `server/runweft/state.sqlite` | 中心机器/runtime 登记与原生工具的最后观察；WAL、事务化 schema version，不保存模型凭据 |
| `connections/local/hapi/` 或 `connections/<主机名>-<URL hash>/hapi/` | 当前机器 Runner 的连接身份、配置与原生日志 |
| `client.sqlite` | 本机工作区与 Agent 个人 runtime 绑定及 Claude MCP hook 的短期调用身份 |
| `logs/` | 服务日志，由部署方管理保留和轮转 |
| `backups/mcp/` | 显式 MCP 配置修改前的快照，可能含原配置秘密，仅当前用户可读写 |
| `cache/`、`tmp/` | 可再生内容，不能保存唯一成果 |
| `server/process.json` | 托管服务定位信息，正常停止后移除 |

Hub 客户端不保存权威资源库；paths 明确指出登记位于中心，备份资源须停止中心后保留其业务库与尚存 WAL 文件。全局范围见[资源范围](../resources/scope/spec.md)。

Codex/Claude 配置和历史仍沿各自原生位置；已有 HAPI 数据不自动搬迁，工作区留在原处。停止后备份数据根及相应原生数据，恢复使用兼容版本；不承诺任意版本间回退。
