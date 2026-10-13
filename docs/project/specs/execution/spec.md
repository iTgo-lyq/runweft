# 原生执行契约

HAPI 配套版本和协议由根 package.json 固定，健康、协议能力和 Runner 诊断用于调用前校验。当前执行封装只接受 codex/claude，不静默切换 runtime。

HAPI health 的 spawnReceipts:1 表示可重查启动；execution:1 表示本版本执行观察协议。会话 metadata.capabilities.execution:1 在对应控制器就绪后发布；归档后可保留用于历史查询，不证明会话仍活跃。缺少所需能力明确拒绝，提示更新配套 Hub/Runner。

health 的 mcpToolFilter:1 与 Runner 的 capabilities.mcpToolFilter:true 表示支持逐执行 disabledMcpServers。携带禁用表时，Runweft 和 Hub 在首次启动前核对相应能力；Hub 在续接已保存禁用表的会话前也核对 Runner。缺少能力或 runtime 不支持时明确拒绝；不携带此参数的原有执行行为保持不变。参数计入持久 requestId 的一致性检查。原生落点见 [宿主 MCP](../host-mcp/spec.md#受控执行的工具禁用)。

HAPI 的 HTTP 状态、code 与错误被保留。只有 native_session_missing 是确认缺失；其他错误和未知执行状态由上层处理，不能解释成可安全重发。

独立 Git 操作与 preparedWorkspace 启动需要 Runner `capabilities.managedWorkspaces:1`。不满足时明确拒绝并提示配套版本，不能回退到默认 HEAD 的快捷 worktree 创建；shared 与不使用准备引用的原有 HAPI 执行保持原行为。

远端 Git 诊断要求源 Runner repositoryExport:1、artifactTransfers:1、artifactOutputs:1，目标 Runner repositoryImport:1、artifactTransfers:1、managedWorkspaces:1；沿现有中心 artifacts 与机器库存能力。缺少能力时要求更新配套组件，不通过 agent 自行 clone 或传文件补做环境。

中心文件声明 artifacts:1，Runner 输入与 preparedFiles 声明 artifactTransfers:1，输出另声明 artifactOutputs:1；旧输入能力不能冒充输出支持。文件接口沿现有机器 RPC，缺少所需能力明确拒绝，不通过模型补做准备。无附件的既有执行不增加文件能力要求。

资源查询要求 Hub 的 machineInventory:1 完整库存能力。原生版本详情使用 Runner 可选 agentAvailabilityDetails:true，缺少时提示升级；不将该能力加入普通 Runner 的强制要求。资源解析与实际执行的区别见 [Runtime 登记](../resources/spec.md)。

Codex/Claude 内置启动、配置、审批和会话管理继续复用 HAPI。补充的持久启动回执、原生事实、目标中断和已复现缺口修正均位于独立 HAPI fork；不支持 npm/path runtime 插件，私有 runtime 扩展不属于当前交付。

协议字段见 [HAPI 执行观察](../../../../hapi/docs/api/execution-observations.md)。验收入口和范围见[发行操作](../../../release.md#验收矩阵)。

## 原生执行事实

Runweft 的内部 ExecutionClient 通过 HAPI 启动 Codex/Claude，使用现有机器、会话、消息和审批能力；没有独立模型执行器或原生会话库。该调用层不包含宿主 MCP 或业务委派。

启动成功回执只确认原调用结果；waitUntilReady 要求会话 active 且具备 execution 版本 1。查询使用 HAPI 历史分页，按调用方 localId 返回消费状态、原生观察、输出和当前审批，归档后仍可读取历史。

轮次可提供历史起点游标，只查询其后的关联输入/输出。HAPI 回填历史导致 epoch 变化时，沿原有分页按固定 localId 重新核对，不能把回填误认作执行失败或重新投递；同次读取 epoch 再次改变时明确返回可重查错误。

执行观察分别记录 submitted、accepted、completed、failed、interrupted、unknown，保留 runtime、executionId、输入 localIds、来源和可用原生身份/结果。REST 接受、invokedAt、thinking=false 或 ready 不单独证明完成。

Codex 通过原生 user item 与 turn ID 关联输入，以 turn/completed 的 status/error 记录结果；同轮合并输入共享事实，子线程结果不属于根输入。Claude 通过 stdin 批次 UUID 与原生 command/user UUID 回显建立关联；未知 subtype 或缺少关联保留 unknown，自主/侧链结果不结束该批输入。已知 subtype 且 is_error=true 是失败，即使 subtype 为 success。

审批沿 HAPI 原有 approve/deny 路由和原生请求 ID，不修改默认权限。Claude 当前工具拒绝流程关闭原生进程，确认清理后记为 interrupted/control；未确认关闭仍为 unknown。

真实执行继承原有模型配置和认证；专用项目的说明与 skill 由原生客户端加载。调用层不集中管理 skill/MCP，不写用户全局配置。

独立工作区启动/续接可携带 `preparedWorkspace: { environmentId, preparationId }`，与 HAPI 原有 sessionType=worktree 快捷创建互斥。该引用贯穿持久启动指纹、Hub/RPC、Runner 和会话 metadata；Runner 在目录创建前及真正启动点核对当前准备，不重建丢失目录。此能力由通用启动路径提供，不要求修改 Codex/Claude runtime adapter；Git 准备见[公共生命周期](../workspaces/spec.md)。

共享目录可带 `preparedFiles: { operationId }`，引用本机 materialize 的输入；与 preparedWorkspace 分别用于 shared/worktree。Runner 在启动前核对操作、文件大小/摘要及留存，缺失或已释放明确拒绝。引用沿原 spawn/resume 指纹和 metadata 保存，不增加 runtime 执行循环；具体准备见[输入](../artifacts/spec.md)。

## 执行关联、关闭与恢复

### 可重查请求

启动必须带调用方先保存的 UUID requestId。HAPI 在 namespace 内持久去重；同 ID 同参数返回原回执，参数冲突拒绝。回执与预分配会话原子保留后只调用一次 Runner，删除会话和重启不移除去重记录。

丢启动响应时查询原 requestId；没有原响应、查不到或不可达都不能证明未启动。调用层返回 unknown，不自动换 ID 重试。显式同 ID 同参数重调仍受 HAPI 去重保护。

输入必须带稳定 localId。丢回复保留 unknown，调用方可查原消费状态和消息；单次空查询不排除在途请求。HAPI 不重发已标记 invoked/dispatching/indeterminate 的重复输入；Claude 将输入交给原生进程后发生模糊失败也不自动重新入队。

### 定向控制

interrupt 同时提交 inputLocalId 与 executionId，HAPI 执行侧检查实际目标；返回 requested、not_running 或 target_mismatch 及受影响输入。requested 不是终态，需读取后续原生/控制事实；不匹配不回退到无条件 abort。排队输入使用现有消息取消入口。

stop 调用原有 archive，并确认 inactive 且 archived；丢响应后只读核对，无法确认返回 unknown。关闭一个共享 Codex root 不终止其他 root；最后一个会话关闭后进程退出。原生 session 与 HAPI 记录保留。

resume 沿原有入口返回实际 HAPI session、新旧原生身份，等待该执行就绪。只有 Runner 确认原生历史缺失才返回 missing；离线、认证、权限、IO 或模糊失败均不等于缺失。调用层不自动创建新执行，也不实现历史重建。

上层业务委派消费这一明确缺失结果，按[轮次规则](../delegation/spec.md)选择续接或构造业务历史；不改变原生执行调用层的上述职责。

Claude 缺失检查读取当前 cwd 对应原生 transcript；Codex 用既有 native app-server 查询指定 thread，仅精确的原生缺失响应可判缺失。预检查不发送 prompt，查询进程随后关闭；明确拒绝时保留原归档状态。

Claude 原生历史路径由 HAPI 根据真实 cwd 与 CLAUDE_CONFIG_DIR 统一定位；长路径编码不作为历史缺失的依据。

已关联受控工作区的 resume 必须携带同环境的当前有效 preparedWorkspace，实际启动前再校验；包括 HAPI 通用恢复入口，省略参数不能绕过上一轮封存与新轮准备。受控会话 clear 拒绝另开无准备会话，应通过 Runweft 结束并续轮。普通 HAPI 会话与原生内置子代理不新增这项约束，缺失目录/旧准备不作为原生历史缺失处理。

shared preparedFiles 在 HAPI resume 省略时继承，显式 null 清除。Runweft 每轮传当前准备引用，无新输入时明确清除旧绑定；失效输入不作为 native_session_missing。输入副本清理和输出重传使用机器文件回执，不重放原生输入。
