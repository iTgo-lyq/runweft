# 远端工作区与基线

Runweft 使用既有 Agent/runtime 绑定，把主 Git 仓库的明确已提交基线传到另一 Runner，并用 HAPI 公共能力建立独立 worktree。诊断不启动模型、不接受任务消息或附件、不提供代码成果取回，正式远端 task/MCP 委派使用同一基线服务自动准备，并经[代码交付](../../results/spec.md)回收；不需要先运行诊断命令。

| 命令 | 行为 |
| --- | --- |
| `workspace prepare --base <ref> [--agent <uuid>]` | 从当前真实 cwd 准备，省略 Agent 用本人仓库/空间选择，可显式 runtime/remote；HEAD 可作为 base，不要求 Git URL、远端路径、手动 clone 或上传 bundle |
| `workspace preparations [--all]` | 默认列当前目录，all 列本人当前空间的准备 |
| `workspace inspect <id>` | 查询原记录的固定 SHA、阶段、传输/复用字节、目标目录、错误及保留状态 |
| `workspace release <id> [--discard-ignored]` | 显式释放诊断环境与其基线引用；接受后 inspect 确认最终结果 |

源/目标 Runner 的能力和 Agent 快照在受理前核对；目标与发起机相同则提示使用本机 worktree 委派。按 Hub 身份/空间、parent/cwd 及子执行拒绝规则校验；CLI 查询需已保存本机登记，Runner 可离线。

prepare 在副作用前输出 request ID；同 ID/参数返回原记录，冲突拒绝。未知结果和重启沿原操作查询，明确失败后按原固定 SHA 发起新请求，保留历史。详情分别展示中心快照与目标导入阶段，不把目标离线解释成中心恢复对象丢失。诊断的 nativeExecution 表示本诊断没有发起原生执行。

服务运行在现有 Runweft serve 内，业务记录位于 state.sqlite；HAPI 执行 Git 和文件动作，不另建 runtime 或调度框架。对象传输与配额沿[持久文件](../../artifacts/spec.md)。

## 远端固定基线

源必须是有 commit 的 Git 工作区，base 明确且无歧义；来源可以是 linked worktree 或已提交子目录。公共 resolve 固定源机器/仓库身份、准确 SHA、相对 cwd 和脏状态。源分支后续移动不改变本次基线，未提交及未跟踪内容不自动同步。完整 bundle 支持无 remote 或尚未 push 的提交。

HAPI `POST /api/machines/:id/repositories` 提供 export/import/inspect/release，分别要求 repositoryExport:1、repositoryImport:1。操作身份、参数与清单持久保存；相同操作返回原结果，未知状态对账，不盲目重发。Git 工作由原 Runner 管理和公共仓库锁串行协调。

export 在自有 scratch bare 中读取源 Git 对象，不修改源 refs、config、index 或工作文件，不初始化源子模块、不懒取缺失对象。清单包含根完整 Git 历史、固定树所引用的递归子模块 Git 对象及该基线需要的 LFS 实体，各文件有 sha256/size。sha1/sha256 可用；shallow、缺 Git/模块/LFS 对象、身份漂移或所需工具缺失明确失败。历史 Git 对象不代表历史 LFS 实体全部归档。

文件经已有 capture/deliver/materialize 通道和确定的最多 100 项批次传输，请求身份在动作前保存。成功发布并取得 recovery pin 后释放源候选；成功导入后释放目标下载副本，操作/清单回执保留。部分发布只释放已持久交付候选，失败清理单独显示，不重跑导出或模型。

目标先在无 alternates/promisor 的独立空 bare 中验证 bundle/ref/对象格式、闭包及清单，再进入来源共享缓存；已有 cache 不掩盖残缺或增量 bundle。模块和 LFS 只从导入资产初始化，不回退源 URL 或 lfs pull。source.snapshot 的 importOperationId/manifestId 关联自有导入回执，目标仓库身份和路径均为目标真实值，不能把源路径当目标路径。

中心 snapshot 按 namespace、sourceRepositoryId、baseCommit 复用，来源身份沿 machineId/commonDir/对象格式，不按 URL 合并仓库。相对 cwd、原 baseRef/dirty 和 parent 归属留在 consumer。同 SHA 复用完整快照；另一 commit 传完整 bundle，相同 namespace/oid/size 的 LFS 只增引用。恢复对象删除后新准备建立新代次，不复活 artifact ID 或改写旧请求。

各目标 import 有独立代次与状态；目标确定导入失败后新请求可复用中心快照创建新 import，原失败回执不改。中心服务不需要 Runner 或 Git，已发布恢复对象在源/目标离线时仍可下载。服务向消费者返回 snapshotId、origin、targetSource；输入附件和模型上下文不存入 snapshot。

## 导入工作区的准备与启动

目标导入成功后，公共 prepare 校验自有来源回执、准确基线、目录和输入，再初始化固定 gitlink 与真实 LFS 实体。准备失败或未知没有原生执行；依赖安装留给 agent。准备/成果生命周期继续沿[公共 Git 工作区](../spec.md)。

spawn/resume 携带当前 preparedWorkspace，在自动创建目录前及实际启动点核对 cwd、HEAD、干净状态、输入证据、模块清单/gitlink 和 LFS checkout 状态。旧引用、缺目录、HEAD/输入/模块漂移、只有 LFS 指针的工作树拒绝启动；不通过重建空目录或模型 prompt 修复准备。准备期间已完整验证资产摘要，启动不另做一次全量 LFS hash 扫描。

公共能力可接收已落地并验证的输入，复制到最终树外路径后回收下载中间副本；后续轮次经过 finalize → prepare → resume 使用新输入，复用可用原生会话。业务上下文仍由既有委派轮次负责，诊断 CLI 不接收附件或构造任务上下文。中心基线服务不替代原生启动回执、停止证明或结果处理。

正式远端委派在 parent.machineId/cwd 固定 origin，依原任务身份取得唯一基线 consumer；目标 source 仅来自该固定快照导入。输入、目录、Git 和上下文准备均在原生启动前完成，后轮继续原 worktree/session；不会重新读取主分支。捕获失败保留收尾并可 retry_result，首次基线确定失败按原固定 SHA 新发任务。

## 独立环境与基线留存

同一来源在目标共用 Git/子模块/LFS cache，各 environment 使用独立 branch、checkout 和树外输入。公共 prepare 在已导入来源上工作，后续轮次从上一封存成果继续，不重置改动；原生 session 与工作区生命周期分别保留。诊断环境不被业务任务接管。工作树用于分离写入，不额外改变执行权限。

诊断记录、worktree、中心 recovery pin 和目标缓存默认保留。release 先沿 HAPI 停止证明检查并以 unchangedHead 要求初始 SHA、干净工作树，才移除自有环境；不会通过自动 checkpoint 把诊断中的新增代码变成可删除内容。活跃/未知执行、未封存/新成果或未知 Git 操作保留并报告原因，ignored 文件需要显式 discardIgnored。

finalize/remove 身份持久保存；未知沿原回执对账，明确失败修复后显式重试。环境移除后才解除 consumer，失败时保留恢复引用并区分已移除目录与剩余清理错误。接收新 consumer 与最后释放共用 snapshot 串行边界。

同 import 还有 consumer 时不释放导入；同 snapshot 还有 consumer 时不解除中心 pin，另一快照共享的 LFS 引用不受影响。最后释放依次清理目标下载/import、剩余源候选和每个文件的 pin。解除 pin 不直接删除中心字节，仍沿[文件留存](../../artifacts/spec.md)规则。已完全释放的快照再次使用建立新代次，旧准备继续返回 released。

HAPI cache 回收要求所属环境均已移除、无未决操作、所有成果仍等于初始基线或已按精确 round/head 显式释放。其他 imports、外部 worktree、未知 ref 或未回收代码保留缓存并显示原因。已移除且无变化环境的 base/round refs 可随最终 cache 一起回收；已释放 ref 若重新出现，视为外部占用并拒绝缓存回收。业务成果的中心 pin 独立保护恢复，不随 task consumer 解除，见[代码留存](../../results/spec.md)。实际删除先原子移到本 import 的自有目录，恢复只续删该目录，不删除原路径后来新建的 cache。回执和历史记录继续保留。
