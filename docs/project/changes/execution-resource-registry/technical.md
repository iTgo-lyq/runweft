# 全局机器与 Runtime 注册技术方案

> 来源：[Requirement](requirement.md)、[Research](research.md)
> 状态：已确认
> 更新：2026-09-29
> 确认方式：沿用户逐 Change 自主落实授权；实施前由当前工作区 iclaude 对 Plan 做一次评审，主 agent 独立复核。

## 边界与依据

Runweft 保存执行资源的登记关系，HAPI 仍负责机器身份、心跳、工具解析及实际启动。当前固定版本已有机器注册、离线记录、名称更新和 AgentAvailability RPC；仅缺离线列表的 Web API 暴露与版本详情。新增代码不改两种 runtime 的 launcher、SDK、原生 session 和默认权限。

机器不是 runtime，runtime 不是业务 agent。当前一个 machineId/flavor 对应一个 runtime，flavor 仅允许 codex/claude；其命令与原生全局配置来自该 Runner 的环境。多份同 flavor 启动 profile 不在现有 HAPI 能力内，本 Change 不伪造支持。项目文件不能登记全局资源，agent 定义留给后续 Change。

## 用户流程

用户先按已有流程运行 `runweft start`，再执行 `runweft machine register`，读取该连接 settings 的 machineId 并核对 HAPI 机器后登记。register 本身不启动服务；尚无连接或本机身份时提示 start。显式传机器 ID 时只登记当前 namespace 内已有 HAPI 机器；已知离线机器可以登记，但仍显示离线，不能据此开始任务。可选名称沿 HAPI PATCH 更新。

`runtime discover` 默认查询当前连接的本机，可用 `--machine <ID>` 指定目标；它显示两种内置工具的发现结果和版本，不登记、不调用模型。`runtime register <codex|claude>` 同样默认本机，要求机器已登记且当前工具已发现；返回稳定 runtime ID 和名称，作为后续 agent 定义的引用。重复登记或恢复已取消的同一 machineId/flavor 保持 ID。

机器与 runtime 分别提供 list、show、rename、unregister；runtime check 重新探测指定引用并输出可操作诊断。machine list 默认显示已登记机器及当前本机，--all 显示完整库存；runtime list 默认显示已登记项，--all 包含已取消项。列表呈现当前连接、ID、展示名称、类型、登记与在线状态，并给出“可用于新委派”的派生状态和原因；runtime 的命令发现和版本各有观察时间。空列表展示最短下一步命令。需要资源身份的后续调用使用 ID，不以可重名、可修改的展示名称路由。

取消登记只停止 Runweft 新委派对该资源的解析，保留 ID、历史引用及最后观察。取消机器登记会使它的 runtime 不可用于新任务，输出受影响 runtime；不顺带删除或取消这些 runtime 的登记。恢复机器登记后它们恢复可检查状态。取消 runtime 不停止任何原生进程。CLI 明确说明已有 agent 引用需重新选择或恢复登记；不扫描用户所有项目，也不改写定义。

## HAPI 最小查询补充

- `GET /api/machines?includeOffline=true` 使用现有 getMachinesByNamespace；默认请求继续返回在线机器。namespace 仍来自 HAPI JWT。health 增加 machineInventory:1，旧服务缺少能力明确要求更新配套组件，不把不完整列表当全量。
- `GET /api/machines/:id/agent-availability?details=true` 沿现有 RPC 转交显式 details 参数。默认行为不变；详情只针对 Codex/Claude，Codex 使用当前 shared launcher 的 resolveCodexCommand(env)，Claude 使用原 launcher 的 getDefaultClaudeCodePath(env)。异步 execFile 执行 `<command> <既有参数> --version`，两种工具并行、单次上限 3 秒并限制输出，避免阻塞 Runner 心跳。返回实际 executable 或未发现状态、解析后的 version 或 versionStatus，以及 checkedAt；不读取或复制模型凭据，不输出完整原生诊断或命令参数。
- 详情能力由 Runner 的可选 agentAvailabilityDetails 声明，Hub 在请求前核对；不加入 REQUIRED_MACHINE_CAPABILITIES，不因用户未使用此功能而强制升级/停止 Runner。旧 Runner 返回升级提示，不悄悄缺字段。版本超时、命令失败、无法识别版本分别返回详情状态，已有 available/reason 保留为 Runner preflight 的原始事实；Codex 旧 preflight 仍读取 HAPI_CODEX_APP_SERVER_BIN，但当前 shared launcher 不使用它，不能把覆盖程序的版本当作真实执行版本。详情使用真实命令查询；Runweft 同时要求 preflight 通过且真实命令可发现。版本读取失败不将已找到的 CLI 改称不存在。Claude 无效命令覆盖沿现有 not_found 返回，不擅自改成 invalid_configuration。
- 扩展沿共享 schema、RPC、Hub 路由和现有原生解析器，不创建新通用 runtime 协议。对应 HAPI 接口文档与固定 revision 同步。

## 服务、存储与作用域

资源 API 位于 `/api/runweft/resources/`，在已有网关验证 HAPI JWT 后执行。访问私有 HAPI API 转交同一个请求 Bearer，保持调用方 namespace；不使用默认 CLI token 代查其他 namespace。所有登记读写包含 namespace 条件，当前连接无法解析其他 Hub 的 runtime ID。

本地模式与 Hub 模式使用同一服务代码。CLI 及其客户端目标解析调用层在 local 配置下只接受当前连接 settings 中的本机 machineId；Hub 客户端可选择当前 namespace 的其他机器。中心服务端解析只按 namespace 和资源事实判断，不能读取自身 config.mode 来限制机器，因为 serve --public 的中心也使用 local 配置。本地客户端 ID 缺失时提示先 start，不猜主机名；本 Change 不把 loopback 访问当作其他机器不存在的证明。登记状态保存在服务端 `<home>/server/runweft/state.sqlite`；本地模式落在本机，Hub 客户端不保存第二份权威注册文件。沿现有 SQLite WAL 和 busy_timeout，初始化事务设置 schema version；不保存秘密、原生模型配置或消息历史。

| 记录 | 持久字段与约束 |
| --- | --- |
| machine_registrations | namespace + machineId 主键，registered、createdAt、updatedAt；HAPI 机器信息按需读取，不复制心跳和在线状态 |
| runtime_registrations | UUID id、namespace、machineId、flavor、展示 name、registered、createdAt、updatedAt；namespace/machineId/flavor 唯一，ID 与目标不可改绑；可保存最后一次原生详情及其观察时间 |

HAPI 机器名称直接沿原 PATCH 修改，runtime 名称只改自己的展示字段。取消登记为状态更新，不物理删除记录或解除历史身份。重新登记通过唯一约束更新原行；并发请求不得产生重复 runtime。

`paths` 展示服务端业务库位置，使用说明覆盖备份和模式归属。更换连接不迁移注册。当前 HAPI 采用 namespace 作为访问范围，本模块不引入新账号或 RBAC。

## API 与消费者契约

机器集合 GET 返回当前 namespace 的 HAPI 机器及 Runweft 登记状态；POST 接受已有 machineId 及可选名称。单项 GET/PATCH/DELETE 分别查询、命名和取消登记，DELETE 不删除 HAPI 身份。runtime 集合同理，POST 仅接受已登记 machineId、flavor、可选展示名；PATCH 只改展示名，拒绝改绑字段。显式 check 查询实际目标的详情。

`resolveExecutionTarget(runtimeId)` 提供下游公共调用：读取稳定登记，核对机器已登记且在线，查询当前 availability 详情，同时核对 Runner preflight 与真实命令可发现，返回 runtimeId、machineId、flavor 与当前观察；版本查询失败本身不禁止已发现命令的登记或解析。不存在、已取消、机器离线、工具不存在、配置无效、探测失败分别产生结构化错误和下一步提示，不选择替代目标。每次新委派重新解析；已接受任务持有不可变目标快照，不因后续重命名或取消登记改绑到别处。实际原生启动时的最终检查仍由 HAPI 负责。

列表不运行模型。机器在线单独显示；runtime 的 available 明确标为“工具已发现”，认证与执行标为“未检查”。实际详情按机器并行查询，失败在对应机器/runtime 上可见；离线时最后一次详情有时间标记，不能将历史观察称为当前认证或可执行证明。未发现/配置无效的提示说明 Runner 使用启动时的 PATH、原生 home 和命令覆盖，修改环境后须 runweft restart。

参数和响应复用项目 Zod/错误约定；新接口保留 code/message/hint，CLI 顶层输出非零状态。读取失败不自动创建、补注册或重放变更。登记操作本身以 machineId/flavor 幂等，网络未知结果可查询同一目标；不因此引入通用任务重试器。

实现接口固定如下，前缀均为 `/api/runweft/resources`。响应带当前 `namespace`，ID 使用 URL 编码，名称复用 HAPI 的 64 字符上限。

| 路径 | 方法与结果 |
| --- | --- |
| `/machines` | GET 返回完整 namespace 库存；POST `{machineId,name?}` 登记已知机器 |
| `/machines/:id` | GET 返回机器；PATCH `{name}` 修改 HAPI 名称；DELETE 取消登记并返回 affectedRuntimeIds |
| `/machines/:id/discover` | GET 查询两种实际工具，不创建登记 |
| `/runtimes` | GET 默认登记项，`?all=true` 包含取消项；POST `{machineId,flavor,name?}` 登记或恢复 |
| `/runtimes/:id` | GET 返回当前检查及历史观察；PATCH `{name}` 只修改名称；DELETE 取消登记 |
| `/runtimes/:id/check` | GET 返回重新探测后的 runtime |
| `/runtimes/:id/resolve` | GET 返回固定 runtimeId/machineId/flavor 及当次原生 inspection，任一前提不成立时失败 |

`eligibility` 表示对应资源是否满足选用条件，不是已验证模型可运行；runtime 明确返回 `modelAuthentication: not_checked`、`execution: not_checked`。`inspectionCurrent` 区分当次查询与保留的原始 checkedAt，不在探测失败或离线时刷新历史时间。列表按机器查询一次，两种 runtime 共用该次详情；认证错误整次失败，单台 Runner 探测失败在对应项表达。登记和目标解析在异步探测之后再次读取取消标记，避免查询期间的取消被旧读取覆盖。

公共 `ResourceClient` 执行 local 本机限制及默认列表过滤；中心 `ResourceService` 不依赖部署模式。JWT 验证沿现有网关提取为共用 handler，只有认证后的资源请求打开服务端数据库，并在请求完成后关闭连接；并发初始化和登记使用 SQLite 事务及唯一约束。

## 验证与就绪性

HAPI 查询扩展覆盖默认/离线列表、namespace、旧 Runner、实际 override 解析、版本失败与超时；共享契约按仓库要求执行类型与全测试。Runweft 覆盖并发重复登记、取消/恢复稳定 ID、目标不可改绑、namespace/连接分离、离线和 CLI 缺失、版本未知、结构化错误以及从任意 cwd 访问同一全局资源。

配套编译验收使用专用本地中心和独立 Hub 客户端；真实 Runner 上探测 Codex/iclaude 的版本，不需要模型任务。正常原生配置不写入；CLI 缺失与无效覆盖只在专用 Runner 环境注入。服务重启保留登记和 ID，取消登记不影响 HAPI 现有会话记录。实际跨机验证仍由远端阶段补齐。

现有依赖和本机环境足以完成本 Change；本方案不依赖未实现的 agent/委派/Git/附件模块。局部函数与输出排版在执行时落实，不需要额外用户确认。
