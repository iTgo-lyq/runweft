# CLI 与 Web 能力核查

2026-10-19，对基线 `10da0b76c276cc037b9d13ab16cea71dbdc6b13b` 的命令注册、Hub API、领域实现和页面入口进行只读核查。目标是落实用户要求的“能力围绕 CLI 为核心，部分可视化使用 Web”，确定本 Change 必须补齐的入口。以下“拟补”是方案，不代表已经实现。

结论：机器、Runtime、Agent、仓库和任务执行已经有较完整的 CLI；主要缺口集中在身份/空间协作管理、任务查询条件、无本机登记的只读访问，以及从 CLI 到原生可视化的有效入口。账号密码是本 Change 拟新增能力，也应从一开始提供 CLI/Web 双入口。

## 能力矩阵

| 业务能力 | 当前 CLI | 当前 Web | 本次处理 |
| --- | --- | --- | --- |
| 安装、配置、服务、Runner、doctor、MCP 管理 | 完整命令入口 | 不承担本机安装配置 | 复用 CLI，不补网页镜像 |
| 身份查询/显示名 | `hub identity` 只读 | 查询、修改显示名 | 补 account show/rename，共用身份模型 |
| 账号密码、环境撤销、改密码/恢复 | 当前均未实现 | 当前为 token 登录；新方案原先偏 Web | CLI 与 Web 一同交付，人工输入密码 |
| 空间查询、创建、改名、权限、退出 | 无专用命令组 | 已有 | 补 space 命令，复用现有 API |
| 成员查询、角色调整、移除 | 无 | 已有 | 补 member 子命令，保持最后 owner 约束 |
| 邀请创建、列表、撤销、接受 | 无 | 已有 | 补 invitation 子命令，秘密通过文件或人工输入交付 |
| 默认空间切换 | 连接时保存；`--space` 仅单次覆盖 | 有浏览器选中空间 | 补 space use，CLI/Web 各自保存选择 |
| 机器及 Runtime 登记、关联、分享、许可、探测 | 已有 | 有资源视图与对应管理入口 | 复用，无新增通用探测系统 |
| Agent 定义、分享、个人默认/隐藏/收藏 | 已有 | 已有 | 复用 |
| Repository、alias、checkout 绑定 | 已有，包括本机 inspect/match | 有中心管理界面 | 复用，由 Agent 完成首次匹配/绑定 |
| 任务派生、续接、steer、停止、审批 | 已有 | Hub 任务页以查看为主，原生页支持部分交互 | 继续使用 CLI 业务命令 |
| 任务列表 | 仅 `--all`；默认本机当前目录 | 工作区、父上下文、状态、分页 | CLI 补同等筛选/分页，保留默认查询范围 |
| 报告、历史轮次 | show 已有轮次与报告分页 | 复用任务详情投影 | 复用；去掉只读查询的机器登记前置 |
| 等待、代码成果详情、附件历史清单 | 已有，但 client 要求机器登记 | 可凭身份/空间看已保存任务事实 | 增加 CLI 用户空间只读路径 |
| 代码取回/重试、附件补收/重试、留存释放、工作区准备/释放 | 已有 | 主要展示状态和下一步 | CLI 已更完整，无需重复命令 |
| 附件上传/下载、列表、配额、清理 | 已有 | 没有完整同等操作界面 | 复用 |
| 深层失败诊断的原生消息 | 缺用户空间下的消息查询命令 | HAPI 会话时间线可看 | 补有界只读 task messages |
| 会话、文件、差异和交互终端可视化 | show 输出裸原生 URL，不能完成新标签授权 | Hub 可换取短 JWT 打开原生页面 | 补 task open 和 Hub 任务定位，保留 Web 可视化 |

矩阵比较实际业务结果，不以命令或按钮个数计算覆盖率。当前命令树含根命令与 `hub` 下的镜像，直接统计会重复计算。

## 必要增量与使用边界

### 账号和空间协作

用户 Q3 已确认账号操作 CLI/Web 双入口。Agent 默认使用浏览器授权，人工可用 `auth register/login --interactive`；account 下提供显示名、密码、登录环境及恢复操作。改密码/全端退出仍需人工输入当前密码；原始 CLI 凭据可管理本人登录环境，不允许原生短 JWT 进入这些入口，也不允许单凭既有 CLI 凭据替另一环境授权。

人工终端先验证密码并激活本机凭据，再用该凭据列空间并保存默认值；只有多个空间且无有效默认才选择一次。它不要求用户在认证前取得空间 ID，也不为选空间再输入密码。

space 下补 list/show/create/rename/permissions/use/leave，member 下补 list/set-role/remove，invitation 下补 list/create/revoke/accept。没有必要更改 Hub 的角色和邀请业务；调用方无需再从网页抄空间或成员 UUID。创建或加入返回目标 ID，随后由 Agent 显式 use；运行中的 MCP 和已有任务不跟随本地默认空间切换。默认空间已失效时仍可 list/use 恢复，不能被空间前置校验锁住。

### 任务查询和诊断

CLI task client 目前在构造时就要求 machineId，连只读 show/wait 都因此失败；Web 的 overview/details 已证明此限制不是读取本人任务所必需。补齐只需用户身份/空间的 read client，复用现有任务投影与授权，不伪造父会话。

默认 list 保留精确的本机 machineId + cwd 范围，`--all` 显式查询当前用户/空间的全部任务。无机器登记时可直接 `task list --all --status failed --page 1 --limit 20`，无需启动 Runner；无参数则提示选择 `--all`。工作区/父上下文筛选与 Web 语义相同，所有筛选在分页前完成。show/wait/result show/artifacts show 可按任务 ID 直接查询。

messages 只读任务关联会话，复用 HAPI 已有消息 API、分页游标和权限。首版提供最近一页及向前翻页，不自建日志系统；同 session 被多轮复用时明确展示关联，不能把整个原生历史冒称为单轮消息。无 session 或原生会话丢失时返回事实，避免通过重发模型输入来“诊断”。

执行、控制、代码取回和清理仍沿用既有规则；尤其 release preview 会涉及留存计划与能力检查，不混入纯读路径。只读 CLI 仍携带已有 HAPI_SESSION_ID，服务端复用受管子任务拒绝判断，不因去掉机器登记而向子任务开放查询。MCP 继续限制为当前原生父会话，不因 CLI 读入口扩大可控制范围。

### Web 可视化交接

`task open` 生成不含凭据的 Hub 任务/轮次链接，`--print` 用于远端终端。Hub 登录后恢复定位、重新校验身份/空间/任务访问，再复用已有原生页面授权流程。show 的链接同步改为该入口；不再假定新标签能直接访问 `/sessions/<id>`。

会话时间线、文件树、差异和交互终端适合保留 Web；Agent 的普通业务操作、报告/清单读取和必要消息诊断由 CLI 完成。不新增完整原生会话编辑命令、终端代理或另一套 runtime 协议。

## 核查依据

| 证据 | 已核实事实 |
| --- | --- |
| [CLI 注册](../../../../src/cli.ts)、[资源命令](../../../../src/hub/resources/commands.ts)、[服务命令](../../../../src/service-commands.ts) | 根命令与 hub 镜像；identity 仅查询；现有 auth login 为浏览器连接入口 |
| [Hub API](../../../../src/hub/api.ts)、[HubStore](../../../../src/hub/store.ts)、[Hub 页面](../../../../src/hub/app.ts) | Web 已有身份改名、空间、成员及邀请操作；规则集中在 store |
| [HubClient](../../../../src/hub/client.ts) | 单次空间覆盖及本地连接默认；需让身份级 list/use 不依赖失效默认空间 |
| [Agent 命令](../../../../src/hub/agents/commands.ts)、[仓库命令](../../../../src/hub/repositories/commands.ts) | Agent/个人选择、仓库/checkout CLI 已覆盖 |
| [Runtime 服务](../../../../src/hub/resources/service.ts)、[资源页面](../../../../src/hub/resources-page.ts) | Web 所有者探测与 CLI 当前空间 runtime check 上下文不同；本机工具 discovery 已存在，不等于 CLI 缺探测能力 |
| [任务命令](../../../../src/tasks/commands.ts)、[任务 client](../../../../src/hub/delegation/client.ts) | list 仅 --all；所有任务 client 构造要求机器登记；show 拼裸原生 URL |
| [任务 API](../../../../src/hub/delegation/api.ts)、[查询投影](../../../../src/tasks/query.ts)、[任务存储](../../../../src/tasks/store.ts) | Web overview/details 无伪造 Parent；namespace 限制 owner/space；CLI 默认本机+cwd；共享筛选/分页已有实现 |
| [任务协调器](../../../../src/tasks/coordinator.ts)、[详情投影](../../../../src/tasks/views.ts) | wait/result/artifacts 查询读取保存事实；unknown 提示查看原生状态；详情不含完整原生消息 |
| [访问网关](../../../../src/hub/access/http.ts)、[HAPI 消息 API](../../../../hapi/hub/src/web/routes/messages.ts)、[消息查询 schema](../../../../hapi/shared/src/apiTypes.ts) | 已允许受保护的原生 GET messages；支持成对时间/序号游标，limit 最大 200 |
| [原生页面](../../../../src/hub/native-page.ts)、[Hub 页面](../../../../src/hub/app.ts) | 新标签无原生 access 时退回 Hub；正常路径须换取短凭据并隔离存储 |
| [HAPI 透传](../../../../src/hapi.ts)、[inspect-peer](../../../../hapi/cli/src/commands/inspectPeer.ts) | 现有透传走机器凭据，不能替代当前用户空间的跨机器任务消息读取 |

能力核查实际调用 createProgram 遍历命令注册，另做源码只读核查；没有启动服务、操作真实账户、发起 Runweft 模型任务或验证新增命令可运行。随后由 iclaude 对新增方案进行只读评审，意见及处理见 [评审记录](review.md)。实现验收应覆盖 CLI/Web 同一领域结果、无机器只读查询、权限与分页、人工隐藏输入，以及登录后回到目标任务；详细契约和验证路径见 [技术方案](technical.md)。
