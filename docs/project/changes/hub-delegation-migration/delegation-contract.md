# 任务归属、轮次与原生桥接

## 接受与读取

- 用户 JWT 必须选定空间；业务 scope 是 ownerId 与 spaceId 的确定组合，不能从 HAPI JWT namespace 推断。主机器必须属于当前用户且已登记，不能冒用共享机器上的 cwd。MCP 的两种宿主校验仍在接入端执行；它与 Hub 用户认证是两条独立约束。
- spawn 只接收 Agent/runtime 选择器、仓库观察、工作区模式、message、inputs/outputs、requestId 和 Parent。中心解析 Agent；拒绝客户端自报快照、owner、space、原生 namespace 或任意 launcher 参数。
- Git 观察使用上一阶段的规范 descriptor 与个人 checkout 关联。Hub Repository UUID 写入 hubRepositoryId；原生 resolve 的 repositoryId/baseCommit 保持 HAPI 语义，并核对其 sourcePath/commonDir/repositoryRoot/objectFormat 与本次观察一致。无 Git 的本地共享任务可用空间全局 Agent；任何 worktree 任务要求真实 Git，远端仍要求明确已提交基线。
- Task 固定发起人、空间、仓库、主会话、工作区和目标 runtime/machine/flavor。每个 Round 保存实际接受的中心 Agent ID、版本、内容、选择来源及 launch 参数。接受过程中配置变化失败；接受后的纯内容编辑不改变已排队轮次。
- next 用原 Agent ID 和原轮次的选择来源重新解析当前定义并鉴权。显式 runtime 或个人 override 不被 definition.runtimeId 替换；实际选中目标与固定机器/runtime/flavor 不兼容时返回目标变化错误，请创建新任务，不能把已存在工作区挪到另一目标。配置兼容时复用已停止 session；改变不能在 resume 生效的启动参数时新建 session 并带历史，不能宣称新模型参数已在旧 session 生效。
- steer 使用当前轮次的固定配置，不创建新版本；继续检查当前调用权。请求重放优先返回已接受回执，配置编辑不导致第二次接受。查阅历史只要求当前用户/空间/主会话可访问该任务，不要求原 Agent 仍共享。
- wait/read/list/看板/成果下载只返回本人的任务与结果；空间管理员不因此读取别人 prompt、目录、附件或报告。长等待使用 RequestLease，成员撤回或 token 失效及时结束请求。

## 复用协调器

TaskCoordinator 增加中心解析/授权与可信 native client 注入点；TaskStore 保留原请求幂等、串行轮次和回执。接受提交与任务对象 binding 使用同一 SQLite 事务，不允许已接受任务缺少授权归属。不能在两个 SQLite 连接间嵌套写锁；必要时让 TaskStore 使用注入的 AccessStore 连接。

WorkspacePreparations 的独立准备/诊断入口使用同样的服务端 Agent 解析、owner/space、主机器和固定目标策略，复用 BaselineStore 与远端准备循环；不得保留信任旧 snapshot 的业务路由。准备记录不冒充 Task，不授予 session 启动能力。

Task、pendingArtifactIntents、WorkspacePreparations 及 baseline/consumer 的启动扫描均只选择已经中心归属的 scope，未迁移历史不做 pin 清理、准备、启动或续接。后台处理不保存或重放用户 token，按持久 ownerId/spaceId 检查当前成员、invocable、requireUsable 和仓库登记；token 轮换使新请求重新认证，但不取消已接受工作。

开始准备、实际 spawn/resume/steer 前验证当前 Agent 调用权、Repository 登记、固定 runtime 的可用权；执行期间共享/成员撤回后不再发新工作。对已启动子进程，中心仍可查询和停止已绑定的准确 session，记录真实结果或未确认状态，不能把权限错误伪装为进程已关闭。历史内容不再向已失去空间资格的用户开放。

中心任务专属 native client 只能由可信服务构造，携带明确 owner/space/task/source/target 上下文及现行策略检查。会话调用保留原生 ID，spawn request 用持久 dispatch intent 对应原 round request；丢失响应只查原回执。session 归属在 Runner 自举和实际 RPC 前绑定，机器 owner 的用户 API 不因此取得任务内容。将 task binding 传给执行策略，实际 RPC 发出与 ack 时同时核对 task 与 runtime；HAPI 同 host 回退不得换掉固定机器。

task 对象绑定目标机器。主机器的源 export 和成果 fetch 不带 target taskId，由本人机器权限、owner/space 及持久操作约束；可跨任务复用的 baseline 使用 scope 级 client。不能通过修改 task.machineId 同时表示源与目标。

机器 workspace/repository/artifact 操作只由已接受的协调步骤发出；不扩大公开 machines API。source 操作仅针对主机器，target 操作针对固定 runtime；清理仅引用原任务持久记录。原生工作区、准备引用、export/import/fetch 的幂等规则保持。

## 文件和代码

输入对象在接受前按 owner/space 检查、冻结和 pin。在 Runner materialize 前授予该机器当前凭据对指定 artifact 的 read；在 deliver 前写入限定 machine/requestId/filename/reference 的 permit。机器只获得所分配字节的读写，不能修改用户留存或列举文件库。输出仍归任务发起者，机器所有者及 Agent 共享成员的用户 API 不能读取。

输入传输确认终止后收回对应 read 授权，输出发布清单后收回对应 read/write 授权。相同机器并行操作可能使用同一个 artifact，授权按持久操作记录引用，最后一个使用者释放时才删除底层 grant；不粗暴撤掉其他仍在传输的权限。当前机器凭据以资源表 currentCredentialId 为准。

协调器的 artifact lookup 需要同时识别用户上传和其授权机器上传的预约，使用预约映射读取 owner/space 的 fileNamespace，不把所有任务文件塞入全局 runweft namespace。多个 sender 的同 requestId 若不能按上下文唯一确定，明确返回冲突，不取第一条。TaskOutputs 和 SnapshotPublisher 继续负责校验、固定清单和引用，adapter 负责接上已存在的授权账本。许可撤销与凭据轮换不隐式复活旧授权；仍在执行的持久步骤可在重新验证后为当前机器凭据补充所需最小授权。

远端 baseline 复用仅在同一 owner/space 内发生；结果 fetch 目标须为当前用户拥有的已登记机器，按任务固定来源验证。保留 worktree 与 bundle，不要求 push；冲突处理继续由主 Agent 完成。

## 子执行约束

启动始终移除 runweft MCP，Runner/子进程环境不继承 Runweft 用户身份 token。服务端对子会话查重不按用户/空间 scope 过滤，防止更换身份或空间绕过递归限制；现有 native/HAPI session 登记作为拒绝依据。Codex/Claude 自带的子 agent 行为不拦截。宿主关闭不引入恢复主会话要求。

Hub API 的数据隔离不等于执行端 OS 隔离。共享 runtime 中的任务以机器的 OS 账户运行，机器管理员能访问磁盘，任务也可能访问同账户文件；按用户决策不新增沙箱。分享说明与 doctor 准确呈现此边界，不能声称同一 OS 账户下的本机凭据或源码获得隔离。
