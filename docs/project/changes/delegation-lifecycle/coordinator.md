# 中心协调、记录与不确定结果

> 归属：[Technical](technical.md)。只封装 HAPI，非第二套 runtime 引擎。

## 存储与接受

中心沿 `<home>/server/runweft/state.sqlite`。将当前 v1 迁移抽到共享入口，事务升级 v2，保留所有资源 ID/状态；新表维护 delegation、round、input 和 request 接受映射，必要的 HAPI session 关联随 round 保存。每条记录包含 namespace；父关联包含发起机器、工作区路径、原生宿主标识或显式 CLI 来源。requestId 在 namespace 内唯一，保存原始可见意图摘要（不包含易变定义快照）及结果 ID，发生冲突不重放。

delegation 保存定义快照、目标、环境（当前 shared + 发起机 + cwd）与父身份；round 保存稳定 UUID、序号、原任务文字、工作阶段、准备/关闭回执、HAPI request/session 关联与报告引用。input 保存初始/steer 归属、localId、投递阶段及必要原生事实摘要，不建另一个原生消息库。观测结果只是缓存，带时间和原生来源，未知不能通过编辑任务状态变成成功。

客户端先查自己已知 requestId，避免原接受后 Agent 文件修改导致重新解析出不同目标。新请求先解析当前定义，再提交中心；中心先返回同 ID 已接受记录，只有新意图才用同 namespace 的资源服务重新核对 runtime、机器、类型与 shared 约束，不信任过时快照里的 eligibility。接受关联必须在首次 HAPI 调用前提交。MCP 取消已收到的接受请求不撤销任务；CLI 网络错误附稳定 requestId。

## 常驻协调器

协调器在既有 Runweft serve 进程内运行，按 delegation 串行推进，任务之间可并行，不加工作目录锁、机器调度或额外守护进程。中心沿已有令牌按 namespace 创建 HapiClient，不存客户 JWT/模型凭据。HapiClient 在请求前按 JWT exp 更新认证，不重放模糊失败的业务 POST。周期查询只针对未收尾轮次；round 保存发送首条输入前的消息起点，ExecutionClient 使用 HAPI 原有 afterAt/afterSeq 正向分页读取本轮历史，避免每轮查询整个 session；不依赖宿主保持连接。

一个轮次的步骤：

1. 核对前轮已停止且模式收尾允许继续；shared 检查原 cwd/目标，不制造 Git 基线。新任务选择固定快照；续接不重读可变 Agent 定义。
2. 首轮启动前保存 HAPI requestId；通过原生 spawn，再核对返回 session 与 execution 能力就绪。角色映射在输入之前保存，始终应用 disabledMcpServers。
3. 下一轮先 resume 原 HAPI session；记录实际新旧 HAPI/native 身份；在投递前核对返回 metadata 的 machineId/path/flavor 与绑定环境，不匹配则关闭该次返回执行并明确报错。仅 native_session_missing 进入新建分支，先保存重建来源及新 requestId。
4. 输入前提交 localId/投递意图，再调用 HAPI send。存储确认、原生 submitted/accepted 和可靠终态分别展示；未知只重查，不重发。
5. 从 HAPI 查询原生观察、权限和结果。本轮活跃追加先在中心串行登记，再用 HAPI 消息排队与 Codex steer；即使原生 turn 已结束，输入仍归属同一业务 round，返回实际 steered/queued/invoked/unknown，不谎称同 turn 注入。Claude 明确不支持此模式。
6. 所有本轮输入有可靠终态后保存报告，经 HAPI archive 关闭执行并验证 inactive+archived。终态与报告已知但停止未确认时，展示结果并阻止下一轮写入。
7. shared 收尾完成，目录和 session 留存，发布版本变化；下一轮已排队则继续。纯报告无需提交、bundle 或附件。

程序事实与业务状态分开：failed/interrupted 是原生结论；准备失败、启动拒绝、关闭失败、未来交付失败各有具体阶段/错误，不能统一伪造原生 failed。每次有意义变化递增 revision；wait 观察这些快照，不依赖自造原生终态或主机空闲定时器。

## 断线与重启

当前服务进程退出后，已接受记录和 HAPI 事实仍保留。新服务实例重新扫描未收尾任务：未尝试步骤可继续；已经尝试但没有确认的副作用先查询原回执/输入/会话，未知时阻止新写入。已停止的主宿主不恢复、不自动注入；后台只完成已接受子任务及既定排队请求的收尾。

- spawn 不明：查询原 requestId；未发现或不可达继续未知，不换 ID 重发。
- send 不明：查询 localId 的用户记录、投递状态与原生事实；只查，不重复 prompt。
- resume 不明：记录已知候选 session，读取其实际 active/metadata 与能力；不能确认仍保持未知，不因此创建新 session。
- stop 不明：读取原 session；必要时针对同一 session 再调用原生幂等 archive，不影响后续轮次。没有停止证明不放行。
- native_session_missing：按前轮确认任务/追加/报告和工作区事实构造明确标记的历史上下文，再启动新 session；摘要有长度上限并提供旧 round 引用，不重放工具或伪造原生历史。

顶层错误输出 code/message/hint 与阶段；后台错误留在任务查询结果。查询网络故障不丢弃已确认的原生终态；原生 unknown 本身不能当作 completed，需有后续可靠事实解除。库和 HTTP 等待取消不发送 archive/interrupt。

## 控制与后续接入

interrupt 必须携带 roundId。尚未发送的排队轮次可直接取消；已发送输入需查原生输入/执行标识再调用定向 interrupt，排队原生消息走取消接口。明确取消也可对无可靠终态的当前 round 关闭其固定 session；只有停机确认后才完成业务取消，原生 unknown 保留，不重放旧输入。操作与本轮收尾串行，迟到请求不能命中下一轮。原生确认后的关闭走同一收尾流程。

准备与收尾记录保留模式和证据字段，当前仅 shared 实现；以后 Git worktree/附件/远端提供具体回执，协调器只消费“准备完成”“本轮写入已停止且成果已固定”的条件。不预建通用 workflow 插件系统。报告上传失败与执行失败分开，上传重试不能触发重新执行。

角色只按本中心保存的 child HAPI/native session 关联判断，首轮、续接实际身份和缺失重建均在输入前登记。MCP 身份与 CLI 环境中 HAPI_SESSION_ID 命中 child 则拒绝派生或 send_input；未命中视为普通父/操作者，不因为其受另一个 HAPI Hub 管理就拒绝。中心不可达则正常报连接错误。模型参数不能覆盖身份上下文，不把 native fork/Agent 当 Runweft child，不控制原生递归；不增加跨 Hub 或同账户进程隔离。
