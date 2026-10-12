# 远端工作区准备技术方案

> 来源：[Requirement](requirement.md)、[Research](research.md#2026-09-29-实现前复核)
> 更新：2026-09-30
> 确认依据：用户授权自主落实细节；本 Change 唯一一次 iclaude 评审已完成，主 agent 的采纳与补充验证见 [Execution](execution.md)。

## Review 导读

新增的可复用服务只处理“父仓库固定基线 → 中心保留 → 目标仓库缓存”，输出 origin 与目标本机 WorkspaceSource。C10 用它替代本机 resolve，之后继续现有 TaskFiles、TaskWorkspaces 和 TaskCoordinator 的轮次流程。C9 不重建委派生命周期，不开放正式远端 spawn。

必要 Git/LFS 原语已实测；没有新增账号、部署服务、runtime adapter 或用户凭据。真实跨机器验收按授权单列；同机两个独立 Runner/数据根验证协议，并在目标准备前隐藏源 fixture 路径，防止误用本机源路径导致假通过。

## 用户路径

`runweft workspace prepare --agent <name> --base <ref>` 使用当前真实 cwd、现有 Agent/runtime 绑定与 Hub 连接。必须明确提供 base，HEAD 是有效值；目标和源相同则提示使用已有本机 worktree 委派。用户不填远端绝对路径、Git URL，不手动 clone 或传 bundle。

`workspace preparations` 列表、`workspace inspect <id>` 详情、`workspace release <id>` 显式释放。命令先给稳定 ID/request ID，显示冻结 SHA、排除未提交内容、阶段、传输/复用字节数与下一步。诊断成功只证明 Git 环境可用，不代表业务轮次已启动或成果可回收。

诊断命令不接受任务说明、Agent prompt 或业务轮次，不启动模型。正常远端任务在 C10 自动调用基线服务，无需先运行诊断命令，也不会接管诊断环境。普通 inputs 和上下文仍由现有委派服务准备；C9 的专用原生探针组合这些已交付能力验证完整启动门禁。

## 端到端路径

1. Runweft 校验 parent、源机器、Agent/runtime 和目标 capability，按 request ID 对账。源 Runner 用现有 resolve 取得准确 SHA、来源仓库、相对 cwd 和 dirty；中心持久冻结后才进行导出/目标操作。冻结前失败没有已接受的基线，冻结后不再解析可移动分支。
2. `RemoteBaselines` 按 `(namespace, sourceRepositoryId, baseCommit)` 查找可用快照；relativePath、baseRef 和 dirty 属于单次消费者，不影响对象复用。可用快照直接加 consumer，不重打包或重传。
3. 缺少快照时，源 Runner 在自有 exports 目录建立 scratch bare，以 alternates 只读引用源对象库，在 scratch 内固定 ref 并创建完整 bundle。主仓库及递归子模块分别打包；基线需要的 LFS 从对象库复制并校验。源工作树、index、config、refs 均不改。具体见[基线契约](baseline-contract.md)。
4. 通过已有 capture/deliver 以确定的 ≤100 项批次上传。LFS 按 namespace/oid/size 复用已有可用 artifact；每个快照有自己的 recovery pin。全部 available 且摘要匹配后中心保存可恢复清单；不保存第二份字节，也不要求 Hub 安装 Git。确认 available 的源导出候选和 spool 随即释放，失败候选保留。
5. 目标已有同一快照的有效导入回执与缓存 ref 时直接复用；否则 materialize 后 import。目标在自有空验证库实际导入、检查格式/ref/对象闭包，再导入共享 cache。根和子模块共享来源缓存，不按会话 clone；LFS 存内容对象。成功后释放下载中间副本。
6. 基线服务返回 `{snapshotId, origin, targetSource}`。诊断 consumer 调用现有 HAPI prepare 创建自身 worktree，保存环境/准备引用用于查询和释放；其 Git 生命周期由 HAPI 管理。C10 task 作为另一 consumer，继续既有 TaskFiles → TaskWorkspaces → context → start/resume，不复用诊断环境。

## HAPI 能力边界

HAPI 提供 repository export/import/inspect/release 机器操作，复用 namespace REST/RPC、路径策略、Git 子进程控制和仓库串行锁。分别声明 `repositoryExport:1`、`repositoryImport:1`，避免中间版本承诺尚未实现的导入。耗时操作先保存回执再后台执行；不另建通用执行器。

公共 WorkspaceSource 增加可选 `snapshot` 引用 `{importOperationId, manifestId}`，strict schema 显式接纳；原 source 没有此字段时行为不变。缓存来源的 `sourcePath = repositoryRoot = commonDir = 实际 bare cache`，baseRef 为不可变 snapshot ref、dirty=false、relativePath 为当前消费者的子目录；展示源 baseRef/dirty 使用 origin。

公共 WorkspaceManager 对 snapshot source 核对自有导入记录，然后用缓存资产 hydrate。各层 submodule URL/active 登记在对应 worktree 自身配置，URL 显式设为受控本地 cache，逐层 `update --init --checkout`，只在该命令允许 file 协议；不用一次 recursive 初始化，不使用 `.gitmodules` 的网络 URL/custom update。cache 路径永不回退到 `lfs pull`。

准备时校验 LFS oid/size 与实体；启动再校验沿现有 HEAD/clean/inputs，加 manifest/gitlink 关联和 LFS downloaded/checkout 标志，拒绝 pointer 文本冒充实体。避免每次启动额外全量散列大型 LFS 文件。原生进程和 session 行为不变；Runweft MCP 禁用和内置 subagent 的边界沿已验收实现。

## 中心记录、复用与保留

业务 state.sqlite 扩展到 v5，新增 snapshot、目标 import、LFS artifact 索引、consumer 和诊断记录五张表；任务轮次不迁移到这里。准备推进沿既有 serial/kick/启动对账模式；服务仅编排对象与 consumer，不复制 stop/finalize/resume 状态机。

- snapshot 按 namespace/sourceRepositoryId/baseCommit 复用，包含不可变 manifest、文件与传输回执。另一次 commit 使用完整 bundle；增量基线不是本次范围。LFS oid 已存在时只新增引用，不重复传输。
- consumer 类型是 diagnostic 或 task/result；记录 owner、source 相对 cwd/dirty/baseRef、target 与引用归属。C9 只创建 diagnostic，C10 登记 task/result。最后一个 consumer 解除后才 unpin 对应 snapshot；被其他快照引用的 LFS 不受影响。
- 复用前核实中心对象 available 或目标缓存有效；旧对象已过期/删除时不复活原 artifact ID，重新导出同 SHA 建立新的传输代次，旧回执保持原状态。没有可用源对象则报错。
- 目标 import 代次独立于中心快照；明确导入失败后，新消费者可创建新 import 并复用中心对象，原消费者仍关联原失败回执。目标离线或未知只影响该导入，不降低中心 available 状态。
- 源端 `HAPI_HOME/workspaces/exports/<op>/` 仅保留未交付候选与回执；目标 `workspaces/repositories/<origin-key>/` 保留仓库/内容缓存与归属。实际 worktree/inputs 沿原有 `workspaces/environments/<id>/`。key 隔离当前认证 namespace 与来源身份，不能由输入指定路径。
- 单文件、namespace 配额沿 artifacts 默认及现有配置；CLI 显示预计上传/复用字节。超大 bundle/LFS 给出明确限额与配置提示，本次不再增加文件切片/拼接协议。传输沿既有流式空闲超时。

中间副本回收失败可见，按原 release 操作对账；不能隐藏错误，也不能因清理失败重新导出/运行模型。长期恢复依据只有中心 pin 与目标缓存，源 Runner 离线不影响已发布快照的读取。

## 诊断释放

`workspace release` 查询并调用 HAPI 的公共 finalize/remove，不在 Runweft 再做进程停止证明。只允许无活动/未知执行且无未封存修改的环境；未执行的干净初始准备可做一次无改动封存，再 remove(expectedHead)。有变化的代码且尚无 C10 已持久交付证据时保留并报错，不能通过自动 checkpoint 然后删缓存丢掉改动。

HAPI finalize 的可选 `unchangedHead` 在任何 checkpoint 前要求 HEAD 精确匹配且工作树干净，诊断传入初始 SHA；省略时维持原有封存行为。公共 remove 保留的 base/round refs 由缓存回收核对：只允许删除已 removed 环境且全部成果仍等于初始 SHA 的引用；任何新增成果、未知 ref、外部 worktree 或未完成操作都保留缓存。import release 解除该导入的持有，其他导入仍存在时保留共享缓存并返回占用信息。

接收新 consumer 和最终释放共用 snapshot 串行边界，避免解除引用时并发接入新消费者。释放清理先完成目标 import，再清理源候选和中心 pin；失败保持 consumer 关联，详情分别显示环境已移除与剩余释放错误。已完全释放的 snapshot 在新准备中创建新代次，原请求不复活。HAPI 删除缓存先原子移入该 import 的自有目录，再递归删除；中断恢复不重删可被后续 import 复用的共享路径。

环境移除后解除 diagnostic consumer；中心确认最后消费者消失才释放该 snapshot pin。源端无需清理用户仓库 ref。目标缓存删除由 HAPI 检查：没有保留环境、其他导入引用、未知操作或未回收成果；公共 remove 留下的成果引用不能被忽略。不能证明就保留并显示占用/原因，不凭空闲时间删除。离线机器清理单列 pending，不阻止中心继续提供其他消费者需要的快照。

## 失败与重试

中心 snapshot 阶段为 exporting/uploading/available 及 failed/unknown；目标导入按 snapshot/目标机器单独记录 importing/available/failed/unknown，不把某机器离线写回中心已发布快照。诊断组合显示当前阶段，另有 preparing/ready/releasing/released。一次 request ID 的重试返回同一记录，断线先查原操作，不换身份重做模型。

明确失败需要修复时，用新 request ID 和详情给出的固定 SHA 再 prepare；已有可用 snapshot/资产自然复用，原失败记录保留。没有额外 retry/attempt API。未知或仍运行的 snapshot 操作先对账，不以新消费者绕过它并行重做。后续 C10 的原生启动未知仍沿现有 spawn receipt 查询。

非 Git/无 commit、缺 base、歧义 ref、shallow、缺对象、摘要错误、格式不支持、路径错误、配额或磁盘不足明确失败，无原生进程。源导出禁用 Git transport，partial clone 缺对象会失败，不自动懒取或取得凭据；独立对象复制可以复用已完整存在的 alternates。依赖安装留给 agent。

## 验证与环境

先验收源 export 和目标 import 两个无模型切片，再接中心复用、CLI 与释放。源 snapshot 导出不再额外做一次全量空库导入；完整性最终由目标独立导入/fsck 和资产匹配检查证明，测试会独立验证导出产物。

真实文件/RPC/SQLite 覆盖无 remote、未 push、linked worktree/子目录、移动分支、dirty、递归子模块/LFS、sha256、shallow/partial、损坏 bundle、重启/丢回执、同快照复用、多个工作树及留存保护。T5 的固定只读消息通过既有 ExecutionClient、preparedWorkspace 与原生附加目录通道验证附件/上下文、项目指令和 session 续接；不引入业务 probe 命令，不改 TaskCoordinator。

四平台配套编译/打包，本机 npm 候选实际安装。真实跨机物理网络与其他 OS 本轮未执行项明确单列，不冒称验收。
