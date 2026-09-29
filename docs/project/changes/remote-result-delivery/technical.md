# 远端代码回收技术方案

> 来源：[Requirement](requirement.md)、[Research](research.md#2026-09-30-实现前复核)
> 状态：已确认
> 更新：2026-09-30
> 确认依据：用户持续授权自主落实技术细节、按顺序评审与执行；方案继续既有 worktree、checkpoint、bundle、默认权限和 HAPI 优先决策。Plan 经本 Change 唯一一次 iclaude 评审后执行。

## 方案与边界

任务在远端固定 worktree 执行，停止后继续由 HAPI 封存；新增结果层把封存引用变成可恢复的完整 Git/模块/LFS 快照，经已有文件通道发布到中心。主 agent 调用 fetch 将验证后的对象和专用引用带回原主仓库，再自行检查 diff、合入和处理冲突。

完整快照复用 C9 的导出和独立验证。同一个 resultHead 复用已发布快照，无改动且仍在初始 base 时直接引用输入基线；LFS 按 namespace/oid/size 复用。每个不同成果 commit 使用完整 bundle，代价是重复 Git 历史字节；不增加增量链、中心 Git 服务或另一套缓存验证器。原生 adapter、停止/续接/权限/历史和 Git checkpoint 继续原路径。

所有模型任务必须具备输入准备和结果发布/取回能力。诊断与业务环境分开，正式 remote 始终为 worktree；local/shared 行为不变。源码、API 和协议字段在以下任务逐步实现，本文不把目标写成已有功能。

## 原生 Git 提供方

在 HAPI 现有 repositories 机器 API 增加 `export-result`、`fetch-result`，用独立 capability `repositoryResults:1` 表示新能力，不另建 runtime 协议。复用 namespace、路径策略、Git 进程组/限时、原操作回执和仓库锁。协议数据见[结果契约](result-contract.md)。

export-result 接受 environment/round 和稳定 operationId，由 WorkspaceManager 读取已封存事实并核对固定 ref/HEAD/归属及停止条件，从 checkout 根导出准确 commit；不依赖原任务子目录仍存在。先完整捕获 Git/LFS/模块候选，再复用从 RepositoryCache 提取的独立空库验证逻辑核对 refs、闭包、gitlink、LFS 清单及 base/start/result 祖先关系。回执成功才代表不可变候选可发布，不重新 checkpoint。

fetch-result 在发起机上工作，先核对实际 cwd 的 machine/repositoryId/commonDir/对象格式属于原主仓库，不依赖原分支或基线 commit 仍存在。下载材料先复制进自有操作目录，在独立库完整验证后才向目标追加对象。根/模块对象与 LFS 完整后才发布根成果 ref，使用预期旧值更新；相同 ref/SHA 返回原结果，不同 SHA 拒绝覆盖。部分对象写入失败可以留在对象库，但不能声明取回完成，按原操作身份核对重试。

取回不修改工作树、index、当前 refs/HEAD、FETCH_HEAD 或已有 Git 配置，不运行项目脚本/hook，不调用 Git remote。所有目标写命令用自有空 hooksPath，关闭 submodule.recurse、gc.auto、maintenance.auto、fetch.writeCommitGraph；fetch 显式 no-recurse-submodules/no-write-fetch-head，只允许受控本地对象传输。LFS 直接复制进该库现有配置指定的对象存储，不执行 fetch/pull。模块沿已验证的层级与 name 进入原生模块对象库，已有库核对归属/格式，新建库使用适合以后 submodule 初始化的配置；不代替用户执行 submodule update。普通 checkout/merge 所需资产已经就位，模块与 LFS 的处理不只是返回一个远端路径。

公共 workspaces.remove 增加可选的精确成果 ref 释放名单；默认仍保留 refs。只在自有环境移除与已有停止/干净检查通过后处理匹配的 round/HEAD，并持久保存释放进度；未知 ref 或 SHA 不匹配仍拒绝。cache release 只据这些事实回收已明确释放的成果，不能根据目录空闲判断代码可丢弃。Runweft 只有在中心持久交付或操作者明确释放后才传名单。

## Runweft 编排

### 远端接受与准备

Client 与中心都核对远端必须 worktree/明确 base；保留本机省略 base 的 HEAD 默认行为及历史 request fingerprint。中心用 parent.machineId/cwd 解析并固定 origin，目标 machine/flavor 来自已解析 Agent/runtime；source 与执行目标不可混用。

任务接受后持久保存 origin、目标、原请求及待绑定基线意图，使用任务 ID 幂等取得 task consumer。诊断与任务共享同一个 RemoteBaselines 实例和锁；owner 重查避免在 consumer 插入后、task 保存前崩溃时创建第二份引用。服务启动扫描继续原 snapshot/import/任务，不重新解析主分支。目标来源 ready 后才填入 environment.source，之后继续 TaskFiles → TaskWorkspaces.prepare → 既有 start/resume。

serve 在创建 TaskCoordinator 前建立共享基线依赖，关闭时先停止并等待任务推进，再关闭诊断/基线操作和存储，最后停止 HAPI 子进程。不能沿现有先关闭 preparations.store 的顺序使用已经关闭的共享依赖。

environment 另保存 origin/consumer 关联，实际 source/cwd 指向目标；prompt 和查询展示原始来源、准确执行目录及排除脏文件。后续轮次不重新导入主工作区的新提交，沿前轮封存结果/原 native session 续接。取消、准备失败和原生启动未知沿当前生命周期，不为清理启动模型；首次基线确定失败给出按原固定 SHA 重新 spawn 的提示，不暗示原任务会自动重新解析来源。

### 封存与发布

新增 TaskResults.advance(task, round, save) 处理代码交付，TaskCoordinator 在 finishing 内按 seal → results.advance → outputs.advance → finished 顺序调用。首次结果发布成功或确定的交付失败后才递增 completed_revision，使正常 wait → fetch 无需第二次等待；后续补交使用 code_revision。Git/LFS/模块候选固定完成前不放行下一轮写入；候选固定后网络交付可以重试，不能重新执行模型或生成另一个 checkpoint。初次交付明确失败可以结束本轮原生生命周期并展示 needs_attention，后续显式 retry 沿同一候选；unknown 查询原操作，不能绕过为新导出。若捕获确定失败且原生已停止、Git 已 sealed、所有相关操作确定停止，操作者可用 release --discard-pending 明确放弃该轮，保存 tombstone 后结束收尾并解除下一轮门控；下一轮仍从该 resultHead 开始，必须通过正常 prepare，不保证未修复的 LFS/磁盘问题会自行消失。

发布复用 C9 的确定批次、capture/deliver、LFS 内容索引及 pin/清理代码，将与基线无关的仓库文件传输部分提取为内部公共 helper，不复制一套上传框架。中心核对可信 HAPI 导出回执与已保存封存 facts、清单及持久 artifact hash/size/pin，完整后发布不可变代码清单；中心自身不需要 Git/Runner。fetch 端仍重新验证，不把可信回执当作任意字节均有效。

发布时可复用已验证基线/前轮中 path、module 映射、format、commit 相同的模块 bundle artifact；派生发布清单保留被复用 bundle 的原 ref/摘要，记录验证来源，取回端仍独立校验。即使导出端为了独立验证形成了新的模块候选，也不重复上传/长期保留相同模块历史；不为完全免除打包增加另一份持久缓存。

每轮保存原生结论、报告、封存 facts、代码清单、附件清单及当前留存。查询分别展示 code/attachments 的完整性；原生成功但代码上传失败不能展示全部成果已交付。清单/补交更新增加任务 revision 和 code_revision，沿现有 wait 游标返回，不主动注入宿主上下文。

代码捕获/交付错误使用独立结果错误范围；已 sealed 的 Git facts 不能被协调器现有通用 finishing 异常处理回写成 unknown。捕获明确失败时 retry 可修复仍在收尾的轮次，不能照搬附件 API 仅允许 finished 轮次的限制而形成无法继续的等待。

### 查询、取回与重传

wait/read_agent 返回 code 的 status/round/ref/next，next 给出具体 fetch_result、retry_result 或操作者 CLI 修复命令；未就绪的 fetch 返回该状态，不把正常准备期当调用错误，权限/身份/摘要不符仍报错。retry_result 明确只处理 Git/模块/LFS，普通声明附件仍用 retry_artifacts。CLI 使用 `task result show/fetch/retry/release <taskId>`。show/fetch 可明确 round，省略时冻结当前最新接受轮次，不静默取前轮成果；retry 要求明确 round/request ID。MCP read_agent 返回同一结果状态，另加 fetch_result、retry_result；工具身份来自原宿主适配，不能覆盖 parent/cwd。清理只由操作者 CLI 调用。

fetch 在当前主仓库接受稳定请求，保存选定清单版本、目标身份、下载操作及 HAPI fetch operationId。相同 request ID 查询原记录；根 ref 固定为 `refs/hapi/results/<environmentId>/<roundId>`。结果展示 base/start/head/ref、模块与 LFS 已恢复情况、准确 diff/merge 或 cherry-pick 提示，不执行接纳动作。原执行机无需在线；发起机 Runner 是本机 Git 操作提供方。对已有本机 worktree 返回同一对象库中的已封存成果引用，不额外传 bundle。

## 数据与留存

state v6 只新增代码清单/交付操作/取回操作/释放意图，保留所有 v5 表和数据，不改变 repository_consumers。task consumer 仍保护目标 import 与输入基线；结果使用自身 artifact recovery reference，不再创建 result consumer。任务/轮次新增可选字段，旧本机数据不被要求具备远端信息。

代码清单内嵌初始基线与成果快照及各自文件映射，由同一结果 recovery reference 直接 pin 去重后的文件集合；无改动时可引用同一描述。完整 Git 历史不包含旧 LFS 实体，因此不能只 pin 新 HEAD 的 LFS，初始基线所需字节仍须保留并随取回恢复。这里保护的是所声明基线/成果树的 LFS，不宣称归档所有历史 LFS。成功发布后释放已交付候选，失败候选保留；成功 fetch 后释放下载中间副本，操作与清单历史保留。

worktree remove 要求原生/文件/代码动作确定、成果已交付或已明确放弃；之后释放 task consumer 和允许丢弃的目标成果 refs，其他任务仍保护共享 cache。各结果自己的文件引用独立保留，基线 consumer 解除不能释放这些引用，因此执行机丢失/缓存删除不破坏取回。

result release 默认预览，apply 才保存释放意图；未交付候选还需 discard-pending，活跃/未知原生或传输操作拒绝。释放按原引用逐步解除，不直接删除文件字节，不删除报告、已导入的主仓库 ref 或未被要求移除的 worktree。明确释放的结果不再承诺可取回；以后若显式移除目标环境，其对应代码 refs 可以随之释放。其他轮次、任务、LFS 和输入基线所需 pin 不受影响。失败保留未完成释放进度和可操作错误，不隐藏为已释放。

配额或单文件限制的确定失败显示 server.artifacts 的准确配置键、所需/可用字节及 result release → artifact prune/remove 的清理顺序；没有释放空间或调整配置前不鼓励反复 retry。结果查询展示本轮实际上传/复用/保留字节，paths/doctor 继续显示现有 namespace 用量，不增加新配置。

数据在既有 Runweft/HAPI 根内：业务表归中心 state.sqlite，中心字节归 artifacts，机器候选与取回操作归 HAPI workspaces 的受控目录。paths/doctor/使用说明更新，不在 /tmp 保存唯一成果；配额沿 server.artifacts，不增加第二份容量配置。

## 验证与就绪性

Git 原语与已有 HAPI 导出/独立导入已实测；新增公开协议、跨系统组合和重启恢复由 Plan 切片验证。保留公共封存对脏模块/gitlink 变化的拒绝政策，完整传回未改变的模块对象及新旧 LFS，不能假称支持未实现的模块改动。

先做无模型 Git 协议与中心交付/取回验证，再开放远端任务。实际原生验收使用专用配置副本、Hub 无 Runner、同机不同 source/target Runner，两宿主 × 两 runtime 至少各两轮，包含代码/输入/附件/重传/退出/续接。发起主分支删除、执行端永久离线后，仍验证主仓库脏状态不变且可实际合入。源码测试、故障注入、schema 升级、四平台候选构建和本机 npm 实装分别保留证据。

本轮有 Git/LFS、Codex、iclaude 与已授权专用模型环境；无新增账号、凭据或外部服务。真实跨物理机器按持续授权单列未实测。产品入口不承诺自动 push/PR/merge，HAPI/Runweft 改动各自本地提交并更新固定 revision。
