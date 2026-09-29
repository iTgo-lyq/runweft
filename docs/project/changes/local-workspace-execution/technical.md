# 本地独立工作区技术方案

> 来源：[Requirement](requirement.md)、[Research](research.md)
> 状态：已确认
> 更新：2026-09-29
> 确认方式：沿用户逐 Change 自主推进授权；正式 Plan 经当前工作区一次 iclaude 评审后实施。

## 交付路径

主 agent 选择 `workspace_mode=worktree`，中心通过发起机 HAPI Runner 解析已提交基线，持久接受任务和准确 SHA。HAPI 准备独立目录并返回证据，中心携带该引用调用原生 spawn/resume。每轮原生执行停止后由 HAPI 固定成果，中心完成轮次并返回同仓库 Git 引用。后续轮次复用同一目录和 session；默认保留现场，清理由 CLI 显式发起。

共享模式默认行为不变；本阶段仍要求 runtime 与发起机相同，支持 local 与 Hub 的同机任务。远端模式须等准备与回收能力齐备才开放。Git 行为详见[工作区契约](workspace-contract.md)，其中的环境与成果定义也是远端的消费入口。

## HAPI 复用与补齐

复用现有机器认证、路径策略、Socket.IO RPC、Git worktree 实现位置、spawn receipt、launcher、原生结果和 archive/resume。扩展 `runner/worktree.ts` 所在模块提供机器级解析、准备、检查、固定成果和删除操作，在现有 machines routes/RpcGateway 注册有类型的有限操作；不暴露任意 shell，不引入 daemon、插件协议或第二套原生执行框架。

新增 Runner capability `managedWorkspaces: 1`。通用 spawn/resume 接受 `preparedWorkspace` 引用，在 Runner 实际启动前核对 cwd、归属、准备版本、开始 HEAD 和所需文件；它与 sessionType=worktree 互斥。引用贯穿 protocol 的 spawn/resume schema、spawn 回执指纹、SyncEngine/RpcGateway 参数、apiMachine、SpawnSessionOptions，以及 Runweft ExecutionClient 的 start/resume 请求。新旧会话 metadata 由通用合并路径保留环境关联，不要求原生 adapter 回写。Codex/Claude adapter 不主动改造。

准备校验在 simple 分支的目录创建之前运行，preparedWorkspace 强制 approvedNewDirectoryCreation=false，并在实际 spawn 前再核对；checkout 丢失不会被重建成空目录。已绑定受控环境的 resume 严格匹配原机器/环境，并要求当前有效准备证据；包括 HAPI 界面续接/clear 触发的通用恢复入口，省略参数不能绕过约束。未使用受控工作区的 HAPI 会话维持原行为。

HAPI 子仓库单独提交通用改造，Runweft 只更新固定 revision 与调用层，不复制其实现。未升级 Runner 明确提示兼容错误，不退回默认 HEAD 创建工作树。

## 中心与调用入口

SpawnIntent 增加 worktree 分支和可选 baseRef（默认 HEAD），shared 禁止 baseRef。请求去重仍比较原始意图；重试先查已接受记录，之后才解析可变 ref/Agent 文件。首次接受前通过目标 Runner 只读解析基线，接受记录保存该 SHA；即使 HEAD 后来变化，准备也不重新解析 ref。解析失败不接受；已接受后对象失去可用性则准备失败，不改换基线。

环境身份和轮次准备身份在中心先持久化，再发机器操作。Task.environment 区分 shared/worktree，保存 repositoryId、environmentId、source cwd、实际 cwd、基线与保留状态；round 保存 preparationId、startHead、Git 成果和 finish 操作回执。沿现有 JSON 业务记录做 schema 升级；Task 数据写入带 revision 比较，不能只更新 round 和计数。旧 shared 任务保持可读取/续接，不迁移原生会话库。

prepare/finalize/remove 在机器侧持久受理后立即返回操作回执，Runner 在进程内执行有限 Git 操作，中心通过 inspect 查询；不长时间占用 10 秒客户端请求/30 秒 RPC 或 Hub HTTP 连接，不为此新增通用任务队列。中心增加 preparing/finishing 阶段，传输错误保留阶段并查询同一操作，不在 queued 的旧 catch 中误判失败。只有明确操作失败才进入对应失败/需处理状态；回执未知不重发 commit/hook。

中心在 stopping 确認进程停止后进入 finishing；只有工作区提供方返回完整成果才 finished。封存失败提供 attention、现场、原生报告与修复指引，后轮保持排队。`task retry-finish <id> --round <id>` 和 MCP `retry_finish` 只显式重试固定轮次的 Git 收尾；不会重发 prompt、改写原生结果或清除权限问题。

`task show` / read_agent / wait 同时展示 base/start/result SHA、结果 ref、目录、checkpoint 的变更数量/有界路径与代码状态；本地结果已经位于主仓库对象库，不需 push、附件上传或自动 merge。收尾进行中总体仍是 running，收尾失败/未知为 needs_attention（scope=workspace）；原生 execution 结论与 delivery.git 的 pending/sealed/needs_attention/unknown 分开，wait 不在封存前假报完成。finishing 已无 agent 可中断，interrupt 返回 execution_already_stopped，不改写 cancellation；收尾继续。取消、失败也可返回标记为部分结果的 Git 成果；执行是否已停止未知时不得封存。

`task workspace remove <id>` 仅为显式操作者 CLI，必须所有轮次结束且环境可以安全清理；MCP 通过 read_agent 查询保留状态。next 接受在同一事务内检查 retained；删除接受在事务内检查无未完成轮次并标记 deleting，无需新增分布式锁。未知结果先查询机器环境，不用新 ID 重发。被删除的环境拒绝新的输入，任务/报告/成果引用保留。比较最近一次成功封存的 resultHead，没有则使用 base，支持从未启动的失败准备现场的明确清理。

## 配置、上下文与故障

数据沿既有 home 和执行账户，业务配置不新增必填项；paths/doctor 和任务详情显示实际工作区根。Git 2.31+ 用于真实路径/对象格式查询，存在 LFS 文件时另需 Git LFS；继承执行机已有 Git 凭据，不复制或打印秘密。使用本机全局原生配置，版本化项目指令/skills 来自所选基线。

上下文由既有 prompt 输入附上程序确认的 cwd、基线、分支、未包含的主目录改动与成果规则，不覆盖 AGENTS.md/CLAUDE.md。已解析外部输入可在受控环境目录的源码树外就位；本 Change 不增加附件上传 API。依赖安装继续交给子 agent。

Git 操作错误保留标准 code/message/hint；普通日志不记录源码、完整 prompt 或 Git 凭据。准备/收尾的丢响应使用同一操作身份查询，重复参数冲突明确拒绝；已完成操作可返回原回执，未知 commit/hook 不自动重跑。调用剔除会重定向仓库/index 的继承 Git 环境变量，保留普通凭据和 Git 策略；副作用 Git 命令关闭 stdin、GIT_TERMINAL_PROMPT=0、每个子进程默认最长 15 分钟，超时停止本次受控进程树并核对是否已经产生提交。停止未知不释放写入条件，不删除 Git lock 文件。失败保留现场，禁止 reset/clean 来掩盖偏差。

## 验证与就绪性

专用 `.dev-smoke` 仓库和模型环境均已具备；当前工作区 iclaude 可用。Git 实验确认了关键原语，详细 RPC 字段、函数拆分和测试夹具在任务内落实，不影响上述架构。无需用户提供新的产品决策。

先以真实 Git + HAPI 机器 API 验证固定 SHA、冲突、hook/签名/index 锁、准备失效与清理；T2 即以两 runtime 的编译 CLI 跑真实独立任务和第二轮续接，并核对新 checkout 的工程指令、项目 MCP 与信任状态，不等 T4 才发现加载差异。最终两宿主 × 两 runtime 在 local/同机 Hub 验证完整协作。候选包安装和现有 shared 回归一起验收，跨机证据仍属于后续 Change。
