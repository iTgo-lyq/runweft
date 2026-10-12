# 配置、部署与数据

默认数据根 `~/.runweft`，全局 `--home` 优先于 `RUNWEFT_HOME`。`init` 生成有注释的 config.yaml，已有文件不覆盖。config path/show/check/set 定位、展示来源、校验和编辑；字段环境变量优先于 YAML，再取默认值。未知字段、重复键、错误值和含凭据/路径/查询参数的 Hub 地址被拒绝，无效编辑不替换配置。

配置包含 schemaVersion、mode、server、hub.url 和可选 hapi.executable。schemaVersion省略时取当前默认值1，显式非1拒绝。mode 表示部署角色，hub.url 独立选择业务连接；模式切换不迁移身份或历史，不替用户停止另一个连接。YAML 不保存 Agent、runtime 选择或身份 token。

| 角色 | 行为 |
| --- | --- |
| local | start 托管本机 Runweft Hub，默认 127.0.0.1:3210；首次不自动创建用户、机器、runtime、Agent 或 Runner |
| 公开服务 | serve --public 前台运行，必须配置 server.publicUrl；默认对外监听 0.0.0.0 |
| hub | hub.url 指定既有 Runweft；start/stop/restart 只管理当前连接的本机 Runner |

默认 server.runner=false。机器完成独立登记后，可 runner start/stop/status；显式 server.runner=true 可随托管服务监督此连接 Runner。Runner 使用 machine.json 中的机器 ID/凭据，拒绝未登记、失效或尚未完成轮换的凭据。登记机器不隐式登记 runtime 或 Agent。

HAPI Hub 仅监听私有 loopback 端口，省略 hapiPort 时自动分配。公开入口组合身份、资源、仓库/Agent、委派与 HAPI 授权网关；原生 HTTP/SSE/Socket 按主体及对象授权，不把私有 HAPI root 作为公开认证。业务接口位于 /api/runweft/。

重复 start 保持本机同一服务；停止前核对进程与 health.instanceId。前台信号关闭本次托管进程，意外退出报错，不无限重启。Runner 停止不等于终止其所有原生模型会话。status 分别显示托管服务、身份/空间连接、机器登记与 Runner 在线情况；doctor 检查配置、HAPI 版本、连接、工作区路径和 Runner，不将在线当作模型认证/执行通过。

Runner停止同步拒绝新执行/RPC并取消心跳和状态重试；有连接时只发一次500ms的versioned退出通知，Hub无响应、断连或撤权不阻塞本地清理。三个后台manager同时abort，随后关闭控制服务，仅清除本PID状态及锁；局部失败仍继续后续清理。成功退出0，异常/清理失败/8秒整体超时退出1并记录阶段；控制客户端等10秒，Runweft托管期限仍为10秒。超时遗留锁沿HAPI已有陈旧PID恢复，不强删正在使用的资源。

Runner凭据在启动时载入，替换本地凭据不会热更新现有进程。轮换后停止旧Runner，再以新凭据启动，保持machineId；停止本身保留独立原生session，不能据此推断任务已停止或完成。

用户先通过 Web 领取/导入独立身份，再用 [hub connect](../identity/connection/spec.md) 交接到本机。auth login 生成相同确认流程，auth status 核对身份与空间。open 打开 /hub，--print 只输出无秘密地址，--hapi 打开原生界面；浏览器使用自身身份，URL 不注入 token。已移除 auth token、--token-stdin 和 hub.tokenEnv。

托管原生进程的目录、数据库、地址、凭据、CORS 由 Runweft 设置，忽略冲突部署环境；用户身份环境变量不传给原生子进程。其余模型配置沿原生机制继承，不改变权限默认值或增加审批绕过。

## 持久数据

paths 列出实际绝对路径：

| 相对位置 | 内容 |
| --- | --- |
| config.yaml | 本机部署和选中 Hub 地址 |
| server/hapi/ | 托管 HAPI 数据库、私有服务凭据、日志和 artifacts 字节 |
| server/runweft/state.sqlite | 中心身份摘要、空间/成员、授权对象、机器/runtime、仓库/Agent/个人选择、Task/Round、文件与代码关联；固定schema 19 |
| server/process.json | 托管进程及 instanceId；正常停止后移除 |
| connections/<主机名>-<origin hash>/identity.json | 0600 用户身份与空间连接 |
| 同目录 connect.json、machine.json | 0600 待确认交接及独立机器接入记录 |
| 同目录 hapi/ | 当前连接 Runner 的 settings、状态和原生日志 |
| 同目录 hapi/workspaces/environments/ | 持久独立工作区、树外输入与准备/成果回执 |
| 同目录 hapi/workspaces/repositories/ | Git、子模块、LFS 缓存 |
| 同目录 hapi/workspaces/exports、imports、fetches | 基线与成果操作回执和中间副本 |
| 同目录 hapi/artifact-transfers/ | 输入副本、传输回执、未交付输出候选 |
| client.sqlite | 固定schema 1；Claude精确调用身份与本机连接文件短事务协调，不保存权威Agent/工作区绑定 |
| backups/mcp/ | 显式原生 MCP 配置修改的备份，可能含秘密，限制访问权限 |
| logs/、cache/、tmp/ | 服务日志、可再生缓存与临时数据 |

连接目录只按 origin 分区，local/hub 使用同一地址时位置相同；未选择 Hub 时显示 unconnected，但不能用于委派。项目仓库和原生 Codex/Claude 历史保持原位。Hub 客户端不保存第二份权威任务/资源库。

备份应停服并保留中心数据库、附件字节、Runweft 业务库、机器未交付候选、对应原生历史及源 Git common directory。独立 checkout 依赖源 Git/缓存及原路径，单独复制 checkout 不完整。工作区数量仅只读统计当前连接的 checkout；详细状态由 task show 返回，不把目录数当作成功任务数。

正常成果清理按 result release → workspace remove → artifact prune/remove 显式执行，未交付候选受保护。server.artifacts 配置托管中心限制，远端客户端用 artifact limits 查询实际策略；传输流式转发，代理需支持相应体积和长流，不另加固定总传输时限。

用户显式销毁本机环境时使用[完整卸载](../installation/cli/spec.md#完整卸载)：选定 home 的配置、连接、数据库、日志、缓存、工作区副本和全部备份均删除，不留新备份。停止全部连接的受管会话/Runner 及 Hub 后核对占用；未知状态或其他 home 使用当前程序时拒绝。受管 Git 元数据按记录验证并删除确切工作树注册和引用，保留源项目、用户分支和其他工作树，不全局 prune。数据根之外的其他软件/原生模型数据和远端 Hub 不清理；普通 npm 卸载保留 home。

## 当前数据格式

首次部署的数据结构基线为Runweft源码`afdcd81a4e062f56edab533b9874f266b70f655b`：中心库schema19、本机client库schema1、配置schemaVersion1，以及该提交的连接文件、Task/Round定义。工程版本号不代替结构识别；基线之前的测试格式不提供迁移。

Runweft只创建和读取唯一当前格式：中心库schema19、本机client库schema1。全新库一次创建完整结构；已有库核验版本及表、索引和约束，同格式正常打开。旧版、未知版本或结构损坏明确拒绝，不增量建表、不补字段、不迁移或清理原目录，也不提供data/reset。

已有库核验不写原主库或WAL/SHM；拒绝时保留原字节、权限与文件集。格式不支持返回503/state_format_unsupported，损坏或结构不符返回503/state_format_invalid，提示使用独立新--home并自行保管原目录。start、serve、restart在创建服务凭据、日志或进程以及停止现有服务之前预检本机两种业务库。此约束不改造独立HAPI的内部持久化。

当前配置的正常省略值、身份轮换、现行任务恢复和显式成果留存不属于历史格式转换；它们仍按各自权限和固定回执执行。

当前业务格式验证读取专用临时副本；以读写方式打开副本，允许macOS为WAL模式数据库创建所需边文件，原数据库、WAL、SHM与身份字节不变。业务库固定schema19/client1，配置固定schemaVersion1；两个Mac原生空WAL/旧损坏拒绝/并发创建回归及四平台实际npm服务验收通过，来源见[本轮验收](../../archive/2026-10-11-npm-hapi-fix-release/acceptance.md)。
