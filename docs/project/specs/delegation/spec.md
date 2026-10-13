# 委派与业务轮次

CLI 与 MCP 使用同一 HubTaskClient、用户/空间连接和中心协调能力，必须已连接 Hub 且登记发起机器。支持 Codex/Claude Code 主宿主，执行 flavor 由 Agent 定义所选 runtime 决定，两者可以不同。工作区支持[本机 shared/worktree 与远端 worktree](../workspaces/spec.md)；远端必须显式指定已提交 base，自动准备后启动。

## MCP 工具

| 工具 | 契约 |
| --- | --- |
| `list_agent_definitions` | 当前工作区的有效定义、来源和在线目标资格，不启动执行 |
| `spawn_agent` | 可选 Agent UUID `agent_type`（省略用本人当前仓库/空间选择）、可选 runtime_id/remote、`message`、可选 UUID `request_id`、`workspace_mode`（默认 shared）；本机 worktree 可指定 `base_ref`（默认 HEAD），远端 worktree 必须指定；持久接受后立即返回 agent_id、round_id、request_id、revision、accepted |
| `list_agents` | 当前原生父会话的任务概览和最近 20 条接受记录 |
| `read_agent` | `id`、可选 `round_id`、`offset`、`limit`；读取轮次事实、报告和待审批请求 |
| `wait` | `ids` 为 1–8 个任务；`timeout_ms` 为 0–540000，默认 30000；可传各任务的 `after_revision` |
| `send_input` | `id`、`message`、可选 request_id；默认 `mode=next`，`mode=steer` 要求 `round_id` |
| `interrupt_agent` | `id`、`round_id`；请求取消固定轮次，不把 requested 当作已停止 |
| `retry_finish` | `id`、`round_id`；修复工作区错误后显式重试 Git 封存，不重发原生任务 |
| `retry_artifacts` | `id`、`round_id`、可选 request_id；重传已捕获的失败文件候选 |
| `collect_artifacts` | `id`、`round_id`、files、可选 request_id；静止任务补收文件并生成新清单版本 |
| `fetch_result` | `id`、可选 `round_id`、request_id；固定轮次并向原发起仓库取回代码 |
| `retry_result` | `id`、`round_id`、可选 request_id；修复捕获或重传代码，不重跑模型 |
| `respond_to_permission` | `id`、`round_id`、原生 `request_id`、`decision=approved/denied/abort`、可选原生 answers |

保留 runweft_status。一次工具取消、超时或 stdio 关闭仅取消该次请求/等待，已接受任务由中心继续处理；返回工具结果是主上下文取得报告的路径，不承诺后台唤醒或新宿主自动接回已关闭的原父身份。

spawn/next 可传 inputs[{artifactId,name?}] 和 outputs[{name,relativePath}]，每轮独立，steer 不接受附件。upload_artifact/read_artifact/download_artifact 见[持久文件](../artifacts/spec.md)；文件操作接受记录同样进入 list_agents，read_agent/wait 展示文件交付与留存事实。

## CLI

`task spawn/list/show/wait/send/interrupt/permission/retry-finish` 对应上述能力。spawn 可选 `--workspace-mode worktree --base <ref>`；`task workspace remove` 是显式操作者清理入口，不提供 MCP 删除工具。任务文本来自 `--message` 或 `--message-file`，`-` 读 stdin；派生/追加先向 stderr 输出 request ID，JSON 模式为进度 JSON 行，接受结果在 stdout。重试使用 `--request-id`，不维护额外客户端任务数据库。

列表默认当前发起机器和 cwd，包含 MCP 来源；`--all` 列本人当前空间。show 默认最新接受轮次，可指定 `--round` 与报告 `--offset/--limit`；wait 支持 `--timeout/--after-revision`。send 默认下一轮，`--steer --round` 才追加本轮。interrupt 和 permission 必须指定轮次；permission 还需原生请求 ID，可附 `--answers`。

CLI 使用当前连接已登记 machine.json 作为来源，不伪装原生父会话；未登记时明确提示先 enroll。MCP 只能操作自己的父会话任务，CLI 可操作本人当前空间内既有任务。完整示例见[使用说明](../../../usage.md#委派等待与续接)。

spawn/send 支持可重复 --input/--output；`task artifacts show/retry/collect/release` 提供历史版本、传输恢复、补收及显式留存释放。清理仍是 CLI 操作者入口，不新增 MCP 删除工具。

`task result show/fetch/retry/release` 提供逐轮代码清单、取回、补交及显式留存释放；release 默认预览，apply 才执行，未交付候选还需 discard-pending。MCP 只提供查询/取回/重传。具体语义见[代码成果](../results/spec.md)。

## Hub 委派归属与配置快照

主会话需本机 machine.json 登记，服务端确认发起机器属于当前用户并可在空间使用。实际 cwd 的 Git 观察用于中心仓库匹配；非 Git 只允许共享目录，本机/远端独立工作区继承源仓库和明确基线。

客户端只提交 Agent/runtime/remote 选择器与任务意图。Hub 解析当前仓库/空间中的本人选择、Agent 访问权、固定版本、执行资源及启动参数，不接收客户端构造的定义快照。Task 保存 ownerId/spaceId/repository，Round 保存不可变中心配置；任务接受与执行对象绑定在同一事务提交。

首次接受后的配置编辑不改排队轮次。next 重新鉴权并取得当前定义，保留已有工作区与执行目标；不能改绑另一 runtime/机器。不兼容的启动参数建立新 session 并提供有界业务历史，兼容时复用已停止原生 session；原生明确报告历史不存在时同样重建。失去确认的 resume 只观察，不盲目再启动。

业务 scope 由 owner × space 生成；协调器启动扫描只处理有中心归属的任务、附件意图、基线、导入、诊断与成果，不解析或认领其他scope的记录；本scope非法当前记录按持久协调逐任务拒绝，不补字段。未接受附件意图逐项收回引用；失败项保留并给出请求 ID，等待授权/连接恢复后再重启检查。恢复前不接受新的任务请求。

中心协调器通过受控 native client 复用 HAPI，不增加 runtime 协议。机器/session 使用内部执行 namespace，文件按任务 owner × space 分区；每次 work/observe/stop 根据真实任务、轮次、来源及目标核对授权。公开用户不能因此任意调用共享机器 API。dispatch intent、原生回执及会话绑定核对实际 RPC/ack，响应不明不重复派发。

已接受任务依赖稳定用户/空间，不依赖原父宿主连接或短期 JWT。token 轮换使旧请求失效但不重发已接受工作。Agent/资源/成员撤回后停止准确绑定 session，停止未确认时保留 unknown。仍有成员资格的任务所有者可读取历史，不因 Agent 不再共享而失去报告；分享 Agent/runtime 不分享他人的任务、输入、输出或代码成果。

递归判断跨业务 scope，覆盖已绑定但尚未回写的 HAPI session 和原生 child ID。工具列表对可确认的受管子会话为空；无法确认的受管上下文只保留诊断；直接绕过工具目录仍在服务端拒绝。HAPI 启动继续禁用 Runweft MCP，其他 MCP 与原生内置子代理沿原生规则。相同 OS 账户的文件访问不被宣称为安全隔离。

## 委派持久化与中心协调

delegation 具有稳定 agent_id，保存 owner/space/repository、内部业务 scope、原生父身份或 CLI 操作者、每轮 Agent 配置和固定工作环境；业务 round、input 与 HAPI/native session 分别关联。原生身份变化时保留新旧关联，不以会话 ID 永久不变为前提。

协调器运行在 serve 进程。中心以事务保存接受记录、轮次和输入后才执行；启动前保存 HAPI requestId，投递前保存 localId 与实际 child 身份。查询、准备、续接、权限、终态与关闭均复用 HAPI。

### 请求与角色

请求在 owner/space 范围以 UUID 去重，比较原始意图及父来源/发起目录，不比较后来变化的 Agent 内容。同 ID 同意图返回原接受记录；冲突报错。客户端先查询原接受，再由服务端解析新定义；配置后来修改不导致原请求再执行。另一个原生 tool call 是新意图，不做相似文本去重。

MCP 省略 request_id 时由 host、nativeSessionId、callId 和操作生成稳定 UUID。模糊接受先通过 list_agents/CLI 列表查询最近接受记录，再用相同 ID 和原意图重试。中心已尝试但结果不明的原生启动、输入、续接或 steer 只查询，不自动重放或换 ID 另起任务。

只允许一层 Runweft 委派。受控执行禁用全部 Runweft MCP；CLI 派生/追加也根据本中心保存的 child HAPI/native 身份拒绝。原生 fork/Agent 身份本身不等于 Runweft child，不探测外部 Hub metadata 或禁止原生内置递归。工具过滤见[宿主 MCP](../host-mcp/spec.md)，这是协作约束而非同一账户内的安全隔离。

### 数据与服务

业务数据在中心 `server/runweft/state.sqlite`，固定schema19保存任务、轮次、输入、请求去重、child关联与中心归属。使用WAL；只支持完整当前结构，格式不匹配无写入拒绝，详见[部署](../deployment/spec.md)。任务输入和报告作为业务数据保存，不复制完整原生 transcript 或隐藏推理，不保存模型凭据。Hub 客户端没有第二份权威任务库。

自有任务 API 为认证后的 `/api/runweft/tasks/{spawn,lookup,send,interrupt,permission,list,read,wait}` POST，使用 Hub 用户/空间 JWT；宿主元数据与业务身份分别校验。中心后台以受控对象绑定调用私有 HAPI，不依赖宿主短期 JWT。客户端按 exp 提前续期认证，不自动重放业务 POST。

独立工作区增加 `retry-finish` 与 `workspace/remove` POST，沿同一父权限/操作者规则；MCP 不暴露删除工具。Task JSON v2 保存固定 source/环境状态，轮次保存准备与 Git 成果/回执，写入使用 revision 比较；当前记录必须带明确版本及完整中心归属/配置快照，不从Task补Round的Agent，也不补写旧字段。不属于本中心scope的记录不认领或执行。删除操作身份和选项持久保存，中心重启也查询未完成删除。

当前格式库内的非法Task/Round/Input/CodeFetch读取或等待返回503/state_record_invalid，保留原记录；恢复扫描仅隔离该任务，stderr记录task ID与错误码，其余有效任务继续恢复。其他存储故障仍抛出。

服务关闭停止扫描并等待当前协调步骤结束；服务重启读取持久未完成轮次继续查询/收尾。宿主退出不等于任务取消；停止中心/Runner 也不代替显式轮次中断。

## 业务轮次与定向控制

同一 delegation 的 next 持久排队，等待前轮停止及当前工作区模式收尾后才开始。任务沿用既有目录和执行目标；已接受轮次保留快照，next 重新鉴权并解析中心定义。目标变化拒绝，不兼容的启动参数新建原生 session 并携带有界业务历史；CLI cwd 不重定向旧任务。

有附件时，preparing 先完成[本轮输入](../artifacts/spec.md)。原生停止和 Git 封存后进行[文件交付](../artifacts/spec.md)，传输未确定前不开放下一轮；确认部分交付后可结束本轮。文件 retry/collect 的恢复独立于模型轮次，不改 completed_revision。

首轮通过 HAPI 启动。后轮优先 resume 前轮已停止的原生 session，核对实际返回的 machineId/path/flavor 与能力就绪后才投递新输入。只有明确 native_session_missing 才按上下文规则构造历史并新建 session；离线、权限、读取失败或未知响应不当作历史缺失。真实新旧 HAPI/native 身份在输入前关联。

独立模式在 preparing 取得当前准备引用，spawn/resume 都消费该引用；每轮完成前须经 finishing 固定 Git 成果。收尾失败/未知阻塞后轮，显式 retry_finish 只重试收尾；已排队的轮次不重建目录或重新选择基线。环境删除与 next 在同一事务互斥，已删除环境拒绝续接。

### 本轮追加

steer 要求当前活跃 round_id，只支持 Codex；Claude 返回 steer_unsupported。接受记录不等于已经注入原生 turn，输入分别展示 pending、steered、queued、invoked、unknown。沿 HAPI 已有消息队列及 steer 入口查询实际归属；同一业务轮次可能包含同原生 turn 的追加，也可能由后续原生 turn 消费，不伪造二者一致。

同一轮次所有实际输入取得可靠终态后，中心关闭本轮执行；模式收尾完成后才允许下一轮写入。已知可靠终态和已收集输出不会被后来的传输 unknown 或关闭后读取失败覆盖。

### 中断与审批

interrupt 固定业务轮次。排队且未启动的轮次可直接取消，不触碰正在执行的前轮；已结束轮次返回 already_finished，不影响后轮。活跃轮次优先取消队列输入或按 localId/executionId 定向中断，再归档该轮 session；requested 不代表已停止。

独立任务在准备中取消时先等待原 Git 操作明确；准备成功但没有启动执行的轮次同样封存后才结束，不为收尾启动模型。已在 finishing 的执行已经停止，interrupt 返回 execution_already_stopped，不改变取消或原生结果。

原生执行未知时也可显式请求取消，但必须确认同一实际执行已停止后才完成业务取消，保留 native unknown 和不完整报告标记，不能伪造原生 interrupted。停止未知或失败通过 attention 返回。

审批必须绑定当前活跃 round 的真实 pending request，排除启动/续接前已有的旧请求；仅响应该 ID，支持原生 answers，不改变默认权限或使用全局自动批准。权限阻塞时 wait 立即返回可处理的事实。

## 委派输入与历史上下文

任务输入组合 Agent 职责/指令、程序确认的 cwd/目标和本轮消息，说明共享改动由主 agent 调度、不能递归 Runweft 委派，原生工具按自身规则使用。程序提供环境与原生执行事实，prompt 提供目标和报告要求；prompt 不代替启动回执、原生终态或停止证明。

输入请求可选 fenced runweft-report JSON，包含 summary、changes、tests、remaining；字符串数组可归一为文本。格式无效时保留原生报告，不让任务因为缺少模板字段而假失败。

只有原生明确缺失时才重建有界业务历史，包含近期既有任务/追加消息、报告、工作目录和来源 round ID；明确标记为历史且禁止重放旧工具动作。新消息单独投递。完整原生 transcript、隐藏推理和模型凭据不复制到 Runweft 业务上下文。

## 委派结果与等待

概览提供 agent_id、round_id、revision、当前活跃轮次、status、attention、有界报告、原生输入状态、stop 与 finish。列表优先显示仍在处理的轮次；read/show 默认最新接受轮次，可显式读取历史轮次。取消后方排队轮次不会在列表中隐藏仍执行的前轮。

status 为 running、needs_attention、completed、failed、interrupted、unknown。正常完成要求可靠原生终态、执行停止及模式收尾均满足；启动前明确拒绝可形成业务失败，但不伪造原生终态。显式取消的未知执行保留未知来源。审批、未知步骤或关闭失败附原因及下一步。

执行、交付和接纳分开表达。共享模式报告为 available/pending/no_final_text，Git 为 not_applicable，接纳为 external；completed 不表示已经合码或验收，也不要求文本报告任务制造提交/bundle/PR。

artifacts 提供 none/pending/delivered/incomplete、不可变清单、待处理操作和当前留存；input_files 展示输入准备及下载副本回收。文件交付失败不篡改原生执行结论；固定候选和补收规则见[文件交付](../artifacts/spec.md)。

独立模式展示 preparation、实际 cwd 和环境 retained/deleting/removed。Git 交付区分 pending/not_prepared/sealing/sealed/needs_attention/unknown，成功返回 base/start/result SHA、成果 ref、可选 checkpoint、partial、变更数量/有界路径。finishing 仍为 running，收尾错误返回 workspace attention 且保留原生 completed/failed/unknown 与报告，不伪造模型失败或重放任务。

未启动且已明确失败/取消的执行显示 not_started；准备失败的 Git 为 not_prepared，不伪造模型终态或已固定的成果。执行取消的部分结果仅在停止确认后封存。删除错误单独保存在环境 removal 中，不覆盖原生结论；清理后报告继续可查；目标成果引用按显式清理规则保留或释放，主库已取回引用不受影响。

### 报告

概览报告最多 4000 字符，详细读取默认 16000、上限 64000，使用 offset/next_offset 分页。结构化 summary/changes/tests/remaining 可选，解析失败仍保留原生原文并标记 structuredMissing；不根据报告文本猜成功。详细事实不通过原生结果字段重复返回完整报告。

### 等待与游标

wait 在任一指定任务完成或需处理时返回，并内联有界报告。超时返回 timed_out=true 和当前概览，任务继续运行；等待取消不归档执行。

不带游标时，以调用开始时已接受的最新 round 为目标，旧轮次完成不会提前满足新轮次。带每任务 after_revision 时按序返回其后的完成/文件通知，每个 round 保留 completed_revision，文件交付与留存另有 artifacts_revision，代码发布、取回及留存有 code_revision；按三者最大值升序消费，后轮开始不抹掉前轮完成通知。历史通知的 revision 指向该通知版本，current_revision 表示任务最新版本。

等待后轮时，前轮的审批或未知状态仍通过 blocking_round_id 返回。游标只抑制已交付通知，不删除报告或审批；需要详情时按固定轮次读取。

远端 code 独立返回 pending/capturing/publishing/available/needs_attention/unknown 及留存状态、固定成果、取回摘要和下一步。完成不等于代码已取回/合入；代码捕获失败可阻止后轮，固定候选后的确定上传失败只影响交付。show/read 默认最新接受轮次，详细清单与历史取回使用 task result show；见[代码交付](../results/spec.md)。
